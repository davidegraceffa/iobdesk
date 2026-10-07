import { AlertTriangle, FilePlus2, Loader2, ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { GenerationProgress } from '@/components/cv/GenerationProgress';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { formatDateTime, languageLabel } from '@/lib/format';
import { errorMessage, keys, useManualCvOptions, useManualCvs } from '@/lib/queries';
import { useCvProgress } from '@/lib/useCvProgress';

/** come MIN_MANUAL_DESCRIPTION_CHARS dell'API */
const MIN_DESCRIPTION = 150;

export interface ManualCvInitial {
  title: string;
  company: string;
  description: string;
  language: string;
  instructions: string | null;
}

interface Props {
  open: boolean;
  /** valori di partenza quando si rigenera un CV nato da una descrizione incollata */
  initial?: ManualCvInitial;
  onClose: () => void;
}

/**
 * CV su misura per un annuncio che non è tra quelli raccolti: si incollano ruolo, azienda e descrizione
 * e la generazione procede come per gli altri annunci.
 */
export function ManualCvDialog({ open, initial, onClose }: Props) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const options = useManualCvOptions(open);
  const recent = useManualCvs(open && !initial);
  const [title, setTitle] = useState('');
  const [company, setCompany] = useState('');
  const [description, setDescription] = useState('');
  const [language, setLanguage] = useState('');
  const [instructions, setInstructions] = useState('');
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [generatedId, setGeneratedId] = useState<string | null>(null);
  const progress = useCvProgress(generatedId);

  useEffect(() => {
    if (!open) return;
    setGeneratedId(null);
    setConsent(false);
    setSubmitting(false);
    setTitle(initial?.title ?? '');
    setCompany(initial?.company ?? '');
    setDescription(initial?.description ?? '');
    setInstructions(initial?.instructions ?? '');
    setLanguage(initial?.language ?? '');
    // i valori iniziali contano solo all'apertura
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!options.data || language) return;
    setLanguage(options.data.suggestedLanguage ?? '');
  }, [options.data, language]);

  // a generazione conclusa si passa all'anteprima
  useEffect(() => {
    if (progress?.step !== 'ready' || !generatedId) return;
    void client.invalidateQueries({ queryKey: keys.manualCvs });
    void client.invalidateQueries({ queryKey: keys.profile });
    onClose();
    navigate(`/cv/${generatedId}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress?.step, generatedId]);

  const info = options.data;
  const needsConsent = !!info && info.external && !info.consentGiven;
  const descriptionShort = description.trim().length < MIN_DESCRIPTION;
  const ready = !!title.trim() && !!company.trim() && !descriptionShort && !!language && (!needsConsent || consent);

  const submit = async () => {
    if (!info || !ready) return;
    setSubmitting(true);
    try {
      const result = await api.cv.generateManual({
        title: title.trim(),
        company: company.trim(),
        description: description.trim(),
        language,
        instructions: instructions.trim() || undefined,
        consentExternal: needsConsent ? consent : undefined,
      });
      setGeneratedId(result.generatedCvId);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FilePlus2 className="size-5" /> {initial ? 'Rigenera CV' : 'CV da una descrizione'}
          </DialogTitle>
          <DialogDescription>
            Per un annuncio che non è nella lista: incolla la descrizione e genera il CV su misura.
          </DialogDescription>
        </DialogHeader>

        {generatedId ? (
          <>
            <GenerationProgress event={progress} />
            <DialogFooter>
              {progress?.step === 'failed' ? (
                <Button variant="outline" onClick={() => setGeneratedId(null)}>
                  Riprova
                </Button>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Puoi chiudere questa finestra: la generazione continua in background e il CV resta nell’elenco dei CV
                  da descrizione.
                </p>
              )}
            </DialogFooter>
          </>
        ) : options.isPending ? (
          <div className="grid gap-3">
            <Skeleton className="h-9" />
            <Skeleton className="h-24" />
          </div>
        ) : options.isError || !info ? (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage(options.error)}
          </p>
        ) : !info.available ? (
          <Alert variant="warning">
            <AlertTriangle />
            <AlertTitle>Generazione non disponibile</AlertTitle>
            <AlertDescription>
              <p>{info.reason}</p>
              <Button asChild variant="outline" size="sm" className="mt-1 w-fit">
                <Link to={info.languages.length === 0 ? '/profile?tab=cv' : '/profile?tab=avanzate'} onClick={onClose}>
                  Apri il Profilo
                </Link>
              </Button>
            </AlertDescription>
          </Alert>
        ) : (
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="mcv-title">Ruolo</Label>
                <Input
                  id="mcv-title"
                  value={title}
                  maxLength={200}
                  required
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Es. Senior Backend Engineer"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="mcv-company">Azienda</Label>
                <Input
                  id="mcv-company"
                  value={company}
                  maxLength={200}
                  required
                  onChange={(e) => setCompany(e.target.value)}
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="mcv-description">Descrizione dell’annuncio</Label>
              <Textarea
                id="mcv-description"
                rows={9}
                maxLength={30000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Incolla qui il testo dell’annuncio: responsabilità, requisiti, tecnologie…"
              />
              <p className="text-xs text-muted-foreground">
                {descriptionShort
                  ? `Servono almeno ${MIN_DESCRIPTION} caratteri (ora ${description.trim().length}).`
                  : `${description.trim().length} caratteri.`}
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="mcv-lang">Lingua del CV</Label>
              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger id="mcv-lang">
                  <SelectValue placeholder="Scegli la lingua" />
                </SelectTrigger>
                <SelectContent>
                  {info.languages.map((l) => (
                    <SelectItem key={l} value={l}>
                      {languageLabel(l)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Il CV viene scritto nella lingua scelta, usando il CV base di quella lingua, anche se l’annuncio è in
                un’altra.
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="mcv-instructions">Istruzioni aggiuntive (facoltative)</Label>
              <Textarea
                id="mcv-instructions"
                rows={2}
                maxLength={2000}
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="Es. metti in evidenza l’esperienza con NestJS"
              />
            </div>

            <div className="rounded-lg border p-3 text-sm">
              <p className="font-medium">
                Cosa viene inviato a {info.provider}
                <span className="font-normal text-muted-foreground"> · modello {info.model}</span>
              </p>
              <ul className="mt-1.5 list-disc pl-5 text-muted-foreground">
                {info.payloadSummary.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              {!info.external && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Provider locale: i dati non lasciano questo computer.
                </p>
              )}
            </div>

            {info.external && (
              <Alert variant="warning">
                <ShieldAlert />
                <AlertTitle>Provider esterno: {info.provider}</AlertTitle>
                <AlertDescription>
                  <p>
                    Il tuo CV contiene dati personali e verrà inviato a un servizio di terze parti, fuori da questo
                    computer.
                  </p>
                  {needsConsent ? (
                    <label className="mt-1 flex items-start gap-2 font-medium">
                      <Checkbox className="mt-0.5" checked={consent} onCheckedChange={(c) => setConsent(c === true)} />
                      Acconsento all’invio dell’annuncio e del mio CV a {info.provider}. Il consenso viene salvato nelle
                      impostazioni.
                    </label>
                  ) : (
                    <p className="text-xs">Hai già dato il consenso (revocabile da Profilo → Avanzate).</p>
                  )}
                </AlertDescription>
              </Alert>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Annulla
              </Button>
              <Button type="submit" disabled={submitting || !ready}>
                {submitting && <Loader2 className="animate-spin" />}
                Genera CV
              </Button>
            </DialogFooter>

            {recent.data && recent.data.length > 0 && (
              <section className="grid gap-2 border-t pt-3" aria-label="CV già generati da una descrizione">
                <h3 className="text-sm font-semibold">CV già generati da una descrizione</h3>
                <ul className="grid gap-1 text-sm">
                  {recent.data.slice(0, 6).map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-1.5">
                      <Link
                        to={`/cv/${c.id}`}
                        onClick={onClose}
                        className="min-w-0 truncate font-medium text-primary-text hover:underline"
                      >
                        {c.jobTitle} – {c.company}
                      </Link>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {languageLabel(c.language)} · v{c.version} ·{' '}
                        {c.status === 'ready'
                          ? formatDateTime(c.createdAt)
                          : c.status === 'failed'
                            ? 'non riuscita'
                            : 'in corso…'}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
