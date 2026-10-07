import type {
  CvReviewApplyResult,
  CvReviewOverview,
  CvReviewSuggestion,
  CvReviewSuggestionStatus,
} from '@jobagg/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Check,
  Download,
  EyeOff,
  Loader2,
  PenLine,
  Plus,
  RefreshCw,
  RotateCcw,
  ScanSearch,
  Undo2,
  Wand2,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Diff } from '@/components/cv/EditsPanel';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { formatDateTime, formatRelative, languageLabel } from '@/lib/format';
import { errorMessage, keys, useCvReview } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { PageSkeleton } from '../App';

const KIND_LABEL: Record<CvReviewSuggestion['kind'], string> = {
  rewrite: 'Riformula',
  add: 'Da aggiungere',
  remove: 'Da togliere',
  structure: 'Struttura',
};
const PRIORITY_LABEL: Record<CvReviewSuggestion['priority'], string> = { high: 'Alta', medium: 'Media', low: 'Bassa' };
const INTERVALS = [1, 3, 7, 14, 30];

function useOverviewMutation<T>(fn: (input: T) => Promise<CvReviewOverview>, success?: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (overview) => {
      client.setQueryData(keys.cvReview, overview);
      // l'elenco delle aggiunte è lo stesso della scheda CV del Profilo
      void client.invalidateQueries({ queryKey: keys.profile });
      if (success) toast.success(success);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

function SuggestionCard({
  suggestion,
  language,
  busy,
  locked,
  onStatus,
  onAdd,
}: {
  suggestion: CvReviewSuggestion;
  language: string;
  busy: boolean;
  /** il controllo si riferisce a un CV che non è più quello attivo: le proposte non si possono più applicare */
  locked: boolean;
  onStatus: (status: CvReviewSuggestionStatus) => void;
  /** per le domande "se è vero, aggiungilo": porta il testo nel campo delle aggiunte, da confermare */
  onAdd: () => void;
}) {
  const applied = suggestion.status === 'applied';
  const closed = suggestion.status === 'done' || suggestion.status === 'dismissed';
  const reordered = suggestion.kind === 'structure' && !!suggestion.originalText && !!suggestion.proposedText;
  return (
    <li className={cn('grid gap-2 rounded-xl border bg-card p-4', closed && 'opacity-70', applied && 'border-success')}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{KIND_LABEL[suggestion.kind]}</Badge>
        <Badge variant={suggestion.priority === 'high' ? 'warning' : 'muted'}>
          Priorità {PRIORITY_LABEL[suggestion.priority].toLowerCase()}
        </Badge>
        {suggestion.sectionTitle && <span className="text-xs text-muted-foreground">{suggestion.sectionTitle}</span>}
        {applied && <Badge variant="success">Applicata al documento</Badge>}
        {suggestion.status === 'done' && <Badge variant="success">Fatta</Badge>}
        {suggestion.status === 'dismissed' && <Badge variant="muted">Ignorata</Badge>}
        {!suggestion.applicable && !closed && <Badge variant="outline">Serve una tua scelta</Badge>}
      </div>
      <h3 className="font-medium">{suggestion.title}</h3>
      {suggestion.reason && <p className="text-sm text-muted-foreground">{suggestion.reason}</p>}
      {reordered ? (
        <div className="grid gap-2 text-sm sm:grid-cols-2" lang={language}>
          {[
            { label: 'Ordine attuale', text: suggestion.originalText! },
            { label: 'Ordine proposto', text: suggestion.proposedText! },
          ].map((side) => (
            <div key={side.label} className="rounded-md border p-2">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">{side.label}</span>
              <ol className="list-decimal pl-5">
                {side.text.split('\n').map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      ) : suggestion.originalText && suggestion.proposedText ? (
        <div lang={language}>
          <Diff before={suggestion.originalText} after={suggestion.proposedText} />
        </div>
      ) : suggestion.proposedText ? (
        <p className="rounded-md border p-2 text-sm" lang={language}>
          <span className="mb-1 block text-xs font-medium text-muted-foreground">Nuovo paragrafo</span>
          <span className="rounded-sm bg-diff-added font-medium">{suggestion.proposedText}</span>
        </p>
      ) : (
        suggestion.originalText && (
          <p className="rounded-md border p-2 text-sm" lang={language}>
            <span className="mb-1 block text-xs font-medium text-muted-foreground">Paragrafo da togliere</span>
            <span className="rounded-sm bg-diff-removed line-through decoration-1">{suggestion.originalText}</span>
          </p>
        )
      )}
      {suggestion.applyError && (
        <p role="alert" className="text-sm text-destructive">
          Non applicata: {suggestion.applyError}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {applied ? (
          <Button variant="outline" size="sm" disabled={busy || locked} onClick={() => onStatus('open')}>
            <Undo2 /> Annulla l’applicazione
          </Button>
        ) : closed ? (
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => onStatus('open')}>
            <RotateCcw /> Riapri
          </Button>
        ) : (
          <>
            {suggestion.applicable ? (
              <Button size="sm" disabled={busy || locked} onClick={() => onStatus('applied')}>
                <Wand2 /> Applica al CV
              </Button>
            ) : (
              <>
                {suggestion.kind === 'add' && (
                  <Button variant="outline" size="sm" onClick={onAdd}>
                    <PenLine /> È vero: scrivilo tra le aggiunte
                  </Button>
                )}
                <Button variant="outline" size="sm" disabled={busy} onClick={() => onStatus('done')}>
                  <Check /> Fatta
                </Button>
              </>
            )}
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => onStatus('dismissed')}>
              <EyeOff /> Ignora
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

const SEVERITY_LABEL = { high: 'Grave', medium: 'Medio', low: 'Lieve' } as const;

/** Compatibilità ATS della versione attiva: punteggio, cinque aree, problemi con la correzione, parole chiave. */
function AtsCard({ entry, available }: { entry: CvReviewOverview['languages'][number]; available: boolean }) {
  const client = useQueryClient();
  const ats = entry.ats;
  const run = useMutation({
    mutationFn: () => api.cvReview.ats(entry.language),
    onSuccess: () => void client.invalidateQueries({ queryKey: keys.cvReview }),
    onError: (err) => toast.error(errorMessage(err)),
  });
  const running = ats?.status === 'running' || run.isPending;
  const score = ats?.status === 'ready' ? ats.score : null;
  return (
    <section className="grid gap-3 rounded-xl border bg-card p-4" aria-label="Compatibilità ATS">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto min-w-0">
          <h2 className="font-semibold">Compatibilità ATS</h2>
          <p className="text-sm text-muted-foreground">
            Come un sistema di selezione automatica leggerebbe e classificherebbe questo CV per i ruoli che cerchi.
          </p>
        </div>
        {score !== null && (
          <p
            className={cn(
              'rounded-lg px-3 py-1 text-2xl font-semibold tabular-nums',
              score >= 80
                ? 'bg-score-high text-score-high-foreground'
                : score >= 60
                  ? 'bg-score-mid text-score-mid-foreground'
                  : 'bg-score-low text-score-low-foreground',
            )}
            aria-label={`Punteggio ATS ${score} su 100`}
          >
            {score}
            <span className="text-sm font-normal">/100</span>
          </p>
        )}
        <Button
          size="sm"
          variant={ats ? 'outline' : 'default'}
          disabled={running || !available}
          onClick={() => run.mutate()}
        >
          {running ? <Loader2 className="animate-spin" /> : <ScanSearch />}
          {running ? 'Valutazione in corso…' : ats ? 'Rivaluta' : 'Valuta ATS'}
        </Button>
      </div>

      {ats?.status === 'failed' && (
        <p role="alert" className="text-sm text-destructive">
          Valutazione non riuscita: {ats.error ?? 'errore sconosciuto'}
        </p>
      )}
      {ats?.status === 'ready' && (
        <>
          {ats.summary && <p className="text-sm">{ats.summary}</p>}
          {ats.categories.length > 0 && (
            <ul className="grid gap-2">
              {ats.categories.map((c) => (
                <li key={c.name} className="grid gap-1 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{c.name}</span>
                    <span className="tabular-nums text-muted-foreground">{c.score}/100</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                    <div
                      className={cn(
                        'h-full rounded-full',
                        c.score >= 80 ? 'bg-score-high' : c.score >= 60 ? 'bg-score-mid' : 'bg-score-low',
                      )}
                      style={{ width: `${Math.max(2, Math.min(100, c.score))}%` }}
                    />
                  </div>
                  {c.comment && <p className="text-muted-foreground">{c.comment}</p>}
                </li>
              ))}
            </ul>
          )}
          {ats.issues.length > 0 && (
            <div className="grid gap-2">
              <h3 className="text-sm font-semibold">Da sistemare</h3>
              <ul className="grid gap-2">
                {ats.issues.map((issue) => (
                  <li key={issue.title} className="rounded-md border p-2 text-sm">
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      <Badge
                        variant={
                          issue.severity === 'high' ? 'destructive' : issue.severity === 'medium' ? 'warning' : 'muted'
                        }
                      >
                        {SEVERITY_LABEL[issue.severity]}
                      </Badge>
                      {issue.title}
                    </p>
                    {issue.fix && <p className="mt-1 text-muted-foreground">{issue.fix}</p>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {(ats.keywordsPresent.length > 0 || ats.keywordsMissing.length > 0) && (
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              {[
                { title: 'Parole chiave trovate', items: ats.keywordsPresent, missing: false },
                { title: 'Parole chiave assenti', items: ats.keywordsMissing, missing: true },
              ].map((group) => (
                <div key={group.title}>
                  <h3 className="mb-1 font-semibold">{group.title}</h3>
                  {group.items.length === 0 ? (
                    <p className="text-muted-foreground">Nessuna.</p>
                  ) : (
                    <ul className="flex flex-wrap gap-1.5">
                      {group.items.map((k) => (
                        <li
                          key={k}
                          className={cn(
                            'rounded-full border px-2 py-0.5 text-xs',
                            group.missing && 'border-dashed text-muted-foreground',
                          )}
                        >
                          {k}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Stima di {ats.model} sul testo del CV e sui dati tecnici del file ({formatDateTime(ats.createdAt)}), per la
            versione {entry.baseCv.version}: ogni ATS si comporta in modo diverso, non è un punteggio ufficiale.
          </p>
        </>
      )}
    </section>
  );
}

function ReviewPanel({
  entry,
  available,
  onAdd,
}: {
  entry: CvReviewOverview['languages'][number];
  available: boolean;
  onAdd: (text: string) => void;
}) {
  const client = useQueryClient();
  const review = entry.review;
  const run = useMutation({
    mutationFn: () => api.cvReview.run(entry.language),
    onSuccess: () => void client.invalidateQueries({ queryKey: keys.cvReview }),
    onError: (err) => toast.error(errorMessage(err)),
  });
  const onApplied = (result: CvReviewApplyResult) => {
    client.setQueryData<CvReviewOverview>(keys.cvReview, (old) =>
      old
        ? {
            ...old,
            languages: old.languages.map((l) =>
              l.language === result.review.language ? { ...l, review: result.review, baseCv: result.baseCv } : l,
            ),
          }
        : old,
    );
    // il CV base attivo è cambiato: slot del Profilo e generazione dei CV devono vederlo
    void client.invalidateQueries({ queryKey: keys.cvSlots });
    void client.invalidateQueries({ queryKey: ['cv', 'versions'] });
    for (const f of result.failed) toast.error(`“${f.title}” non applicata: ${f.reason}`);
    if (result.applied > 0 && result.review.resultBaseCvId === result.baseCv.id) {
      toast.success(
        `CV aggiornato: versione ${result.baseCv.version} con ${result.applied} ${result.applied === 1 ? 'proposta applicata' : 'proposte applicate'}`,
      );
    }
    if (result.warning) toast.warning(result.warning);
  };
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: CvReviewSuggestionStatus }) =>
      api.cvReview.setSuggestionStatus(review!.id, id, status),
    onSuccess: onApplied,
    onError: (err) => toast.error(errorMessage(err)),
  });
  const applyAll = useMutation({
    mutationFn: () => api.cvReview.applyAll(review!.id),
    onSuccess: onApplied,
    onError: (err) => toast.error(errorMessage(err)),
  });
  const busy = setStatus.isPending || applyAll.isPending;
  const running = review?.status === 'running' || run.isPending;
  const open = review?.suggestions.filter((s) => s.status === 'open') ?? [];
  const appliedList = review?.suggestions.filter((s) => s.status === 'applied') ?? [];
  const closed = review?.suggestions.filter((s) => s.status === 'done' || s.status === 'dismissed') ?? [];
  const applicable = open.filter((s) => s.applicable);
  const locked = !!review?.outdated;
  const generated = !!review?.resultBaseCvId && review.resultBaseCvId === entry.baseCv.id;

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-sm text-muted-foreground">
          {entry.baseCv.originalFileName} · versione {entry.baseCv.version}
          {review && review.status !== 'running'
            ? ` · ultimo controllo ${formatRelative(review.createdAt)} (${review.trigger === 'manual' ? 'richiesto da te' : 'automatico'}, ${review.model})`
            : ''}
          {entry.nextRunAt && !running ? ` · prossimo controllo automatico ${formatRelative(entry.nextRunAt)}` : ''}
        </p>
        <Button size="sm" disabled={running || !available} onClick={() => run.mutate()}>
          {running ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          {running ? 'Controllo in corso…' : 'Controlla ora'}
        </Button>
      </div>

      {!review ? (
        <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          Questo CV non è ancora stato controllato. Premi “Controlla ora” oppure aspetta il primo controllo automatico.
        </p>
      ) : review.status === 'running' ? (
        <p className="flex items-center gap-2 rounded-xl border bg-card p-4 text-sm" role="status" aria-live="polite">
          <Loader2 className="size-4 animate-spin text-muted-foreground" /> Sto rileggendo il CV: di solito serve meno
          di un minuto.
        </p>
      ) : review.status === 'failed' ? (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>Controllo non riuscito</AlertTitle>
          <AlertDescription>{review.error ?? 'Errore sconosciuto'}</AlertDescription>
        </Alert>
      ) : (
        <>
          {review.outdated && (
            <Alert variant="warning">
              <AlertTriangle />
              <AlertTitle>Il CV base è cambiato</AlertTitle>
              <AlertDescription>
                Queste proposte si riferiscono a un’altra versione e non si possono più applicare: premi “Controlla ora”
                per averne di nuove.
              </AlertDescription>
            </Alert>
          )}
          {review.summary && <p className="rounded-xl bg-muted p-4 text-sm">{review.summary}</p>}
          {generated && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-success bg-card p-3 text-sm">
              <p className="mr-auto">
                <span className="font-medium">Versione {entry.baseCv.version} generata da queste proposte</span> (
                {appliedList.length} {appliedList.length === 1 ? 'applicata' : 'applicate'}): è il CV base in uso
                {entry.baseCv.pageCount > 0
                  ? `, ${entry.baseCv.pageCount} ${entry.baseCv.pageCount === 1 ? 'pagina' : 'pagine'}`
                  : ''}
                . La versione di partenza resta archiviata.
              </p>
              {entry.baseCv.hasPdf && (
                <Button asChild variant="outline" size="sm">
                  <a href={api.cv.basePdfUrl(entry.baseCv.id)} target="_blank" rel="noreferrer">
                    Apri il PDF
                  </a>
                </Button>
              )}
              <Button asChild variant="outline" size="sm">
                <a href={api.cv.baseDocxUrl(entry.baseCv.id)} download>
                  <Download /> Scarica DOCX
                </a>
              </Button>
            </div>
          )}
          {applicable.length > 0 && !locked && (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" disabled={busy} onClick={() => applyAll.mutate()}>
                {applyAll.isPending ? <Loader2 className="animate-spin" /> : <Wand2 />}
                Applica tutte le proposte ({applicable.length})
              </Button>
              <span className="text-xs text-muted-foreground">
                Viene generata una nuova versione del CV base, con lo stesso aspetto. Ogni proposta si può annullare.
              </span>
            </div>
          )}
          {open.length === 0 ? (
            <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              {review.suggestions.length === 0
                ? 'Nessuna proposta: per i ruoli che cerchi il CV è già a posto.'
                : 'Nessuna proposta ancora aperta in questo controllo.'}
            </p>
          ) : (
            <ul className="grid gap-3" aria-label="Proposte aperte">
              {open.map((s) => (
                <SuggestionCard
                  key={s.id}
                  suggestion={s}
                  language={entry.language}
                  busy={busy}
                  locked={locked}
                  onStatus={(status) => setStatus.mutate({ id: s.id, status })}
                  onAdd={() => onAdd(s.title)}
                />
              ))}
            </ul>
          )}
          {appliedList.length > 0 && (
            <details open>
              <summary className="cursor-pointer text-sm font-medium">
                Proposte applicate al documento ({appliedList.length})
              </summary>
              <ul className="mt-2 grid gap-3">
                {appliedList.map((s) => (
                  <SuggestionCard
                    key={s.id}
                    suggestion={s}
                    language={entry.language}
                    busy={busy}
                    locked={locked}
                    onStatus={(status) => setStatus.mutate({ id: s.id, status })}
                    onAdd={() => onAdd(s.title)}
                  />
                ))}
              </ul>
            </details>
          )}
          {closed.length > 0 && (
            <details>
              <summary className="cursor-pointer text-sm font-medium">Proposte già gestite ({closed.length})</summary>
              <ul className="mt-2 grid gap-3">
                {closed.map((s) => (
                  <SuggestionCard
                    key={s.id}
                    suggestion={s}
                    language={entry.language}
                    busy={busy}
                    locked={locked}
                    onStatus={(status) => setStatus.mutate({ id: s.id, status })}
                    onAdd={() => onAdd(s.title)}
                  />
                ))}
              </ul>
            </details>
          )}
          <p className="text-xs text-muted-foreground">
            Applicando una proposta l’app modifica una copia del documento e la salva come nuova versione del CV base:
            il file che hai caricato non viene toccato. Controllo del {formatDateTime(review.createdAt)}.
          </p>
        </>
      )}
    </div>
  );
}

/**
 * Sezione "Migliora CV": controllo periodico dei CV base con proposte di modifica, cosa chiedono gli annunci
 * che il CV non mostra, e l'elenco delle cose da aggiungere nei CV su misura.
 */
export function CvImprovePage() {
  const { data, isPending, isError, error } = useCvReview();
  const [draft, setDraft] = useState('');
  const draftInput = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState('');
  const schedule = useOverviewMutation(api.cvReview.schedule);
  const saveSkills = useOverviewMutation(api.cvReview.setExtraSkills);

  useEffect(() => {
    if (!tab && data?.languages[0]) setTab(data.languages[0].language);
  }, [data, tab]);

  if (isPending) return <PageSkeleton />;
  if (isError || !data) {
    return (
      <p role="alert" className="p-6 text-sm text-destructive">
        {errorMessage(error)}
      </p>
    );
  }

  const skills = data.extraSkills;
  // come il server: una voce sta su una riga sola, senza virgole
  const key = (text: string) =>
    text
      .replace(/[\n,;]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  const has = (text: string) => skills.some((s) => key(s) === key(text));
  const add = (text: string) => {
    const value = text.trim();
    if (!value || has(value)) return;
    saveSkills.mutate([...skills, value], {
      onSuccess: () => toast.success(`“${value}” aggiunto: i prossimi CV potranno usarlo`),
    });
  };
  /** porta un testo nel campo delle aggiunte, da riscrivere con parole proprie prima di confermare */
  const edit = (text: string) => {
    setDraft(text);
    draftInput.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    draftInput.current?.focus({ preventScroll: true });
    toast.info('Testo portato nel campo “Cosa aggiungere nei CV”: riscrivilo e premi Aggiungi');
  };
  const remove = (text: string) => saveSkills.mutate(skills.filter((s) => s !== text));

  return (
    <div className="p-4 md:p-6">
      <header className="mb-4 flex flex-wrap items-start gap-4">
        <div className="mr-auto min-w-0">
          <h1 className="text-xl font-semibold">Migliora CV</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            I tuoi CV base vengono riletti periodicamente rispetto ai ruoli che cerchi e a ciò che chiedono gli annunci:
            qui trovi cosa è migliorabile e le modifiche proposte, che l’app applica per te generando una nuova versione
            del documento, e cosa aggiungere nei CV su misura.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card px-3 py-2">
          <Label htmlFor="review-enabled" className="flex items-center gap-2 text-sm">
            <Switch
              id="review-enabled"
              checked={data.enabled}
              disabled={schedule.isPending}
              onCheckedChange={(enabled) => schedule.mutate({ enabled })}
            />
            Controllo automatico
          </Label>
          <Select
            value={String(data.intervalDays)}
            disabled={!data.enabled || schedule.isPending}
            onValueChange={(v) => schedule.mutate({ intervalDays: Number(v) })}
          >
            <SelectTrigger className="w-40" aria-label="Frequenza del controllo">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[...new Set([...INTERVALS, data.intervalDays])]
                .sort((a, b) => a - b)
                .map((d) => (
                  <SelectItem key={d} value={String(d)}>
                    {d === 1 ? 'ogni giorno' : `ogni ${d} giorni`}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
      </header>

      {!data.available && (
        <Alert variant="warning" className="mb-4">
          <AlertTriangle />
          <AlertTitle>Controllo non disponibile</AlertTitle>
          <AlertDescription>
            <p>{data.reason}</p>
            <Button asChild variant="outline" size="sm" className="mt-1 w-fit">
              <Link to="/profile?tab=avanzate">Apri il Profilo</Link>
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {data.available && data.external && (
        <p className="mb-4 text-xs text-muted-foreground">
          A ogni controllo il testo del CV (senza nome e contatti) viene inviato a {data.provider} · {data.model}, come
          per i CV su misura.
        </p>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(20rem,2fr)]">
        <section aria-label="Proposte di modifica" className="min-w-0">
          {data.languages.length === 0 ? (
            <div className="rounded-xl border border-dashed p-8 text-center">
              <p className="text-sm text-muted-foreground">Carica almeno un CV base per ricevere proposte.</p>
              <Button asChild variant="outline" size="sm" className="mt-3">
                <Link to="/profile?tab=cv">Apri la scheda CV del Profilo</Link>
              </Button>
            </div>
          ) : (
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList>
                {data.languages.map((l) => {
                  const openCount = l.review?.suggestions.filter((s) => s.status === 'open').length ?? 0;
                  return (
                    <TabsTrigger key={l.language} value={l.language}>
                      CV {languageLabel(l.language).toLowerCase()}
                      {l.review?.status === 'ready' && openCount > 0 ? ` (${openCount})` : ''}
                    </TabsTrigger>
                  );
                })}
              </TabsList>
              {data.languages.map((l) => (
                <TabsContent key={l.language} value={l.language}>
                  <div className="grid gap-4">
                    <AtsCard entry={l} available={data.available} />
                    <ReviewPanel entry={l} available={data.available} onAdd={edit} />
                  </div>
                </TabsContent>
              ))}
            </Tabs>
          )}
        </section>

        <aside className="grid content-start gap-4" aria-label="Cosa aggiungere nei CV">
          <section className="grid gap-3 rounded-xl border bg-card p-4">
            <div>
              <h2 className="font-semibold">Cosa aggiungere nei CV</h2>
              <p className="text-sm text-muted-foreground">
                Competenze ed esperienze reali che il CV base non mostra. I CV su misura, le lettere e le email possono
                usare solo il CV base e questo elenco.
              </p>
            </div>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                add(draft);
                setDraft('');
              }}
            >
              <Label htmlFor="skill-draft" className="sr-only">
                Nuova voce
              </Label>
              <Input
                id="skill-draft"
                ref={draftInput}
                value={draft}
                maxLength={300}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Es. Kubernetes in produzione per 2 anni"
              />
              <Button type="submit" size="sm" disabled={!draft.trim() || has(draft) || saveSkills.isPending}>
                <Plus /> Aggiungi
              </Button>
            </form>
            {skills.length === 0 ? (
              <p className="text-sm text-muted-foreground">Ancora nessuna voce.</p>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {skills.map((s) => (
                  <li key={s} className="inline-flex items-center gap-1 rounded-full border py-0.5 pr-1 pl-2.5 text-sm">
                    {s}
                    <button
                      type="button"
                      className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                      disabled={saveSkills.isPending}
                      onClick={() => remove(s)}
                      aria-label={`Togli ${s}`}
                    >
                      <X className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="grid gap-3 rounded-xl border bg-card p-4">
            <div>
              <h2 className="font-semibold">Richieste spesso, assenti dal tuo CV</h2>
              <p className="text-sm text-muted-foreground">
                Tecnologie più presenti nei {data.marketJobs} annunci compatibili degli ultimi 60 giorni che non
                compaiono né nel CV né tra le aggiunte. Aggiungile solo se le conosci davvero.
              </p>
            </div>
            {data.market.length === 0 ? (
              <p className="text-sm text-muted-foreground">Niente da segnalare.</p>
            ) : (
              <ul className="grid gap-1.5">
                {data.market.map((m) => (
                  <li key={m.name} className="flex items-center justify-between gap-2 text-sm">
                    <span>
                      <span className="font-medium">{m.name}</span>{' '}
                      <span className="text-muted-foreground">
                        · {m.jobs} {m.jobs === 1 ? 'annuncio' : 'annunci'}
                      </span>
                    </span>
                    <Button variant="ghost" size="sm" disabled={saveSkills.isPending} onClick={() => add(m.name)}>
                      <Plus /> La conosco
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {data.gaps.length > 0 && (
            <section className="grid gap-3 rounded-xl border bg-card p-4">
              <div>
                <h2 className="font-semibold">Requisiti non coperti nei CV generati</h2>
                <p className="text-sm text-muted-foreground">
                  Ciò che i CV su misura non hanno potuto dichiarare perché non c’è nel CV base. Se un requisito ti
                  appartiene, aggiungilo così com’è oppure riscrivilo con parole tue.
                </p>
              </div>
              <ul className="grid gap-1.5">
                {data.gaps.map((g) => (
                  <li key={g.requirement} className="flex items-center justify-between gap-2 text-sm">
                    <span>
                      {g.requirement}{' '}
                      <span className="text-muted-foreground">
                        · {g.count} {g.count === 1 ? 'volta' : 'volte'}
                      </span>
                    </span>
                    <span className="flex shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={saveSkills.isPending}
                        onClick={() => add(g.requirement)}
                      >
                        <Plus /> Ce l’ho
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => edit(g.requirement)}
                        aria-label={`Riscrivi “${g.requirement}” prima di aggiungerlo`}
                        title="Riscrivilo con parole tue"
                      >
                        <PenLine />
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
