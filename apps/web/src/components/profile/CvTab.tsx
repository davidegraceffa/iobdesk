import {
  CV_LANGUAGES,
  CV_SECTION_TYPES,
  MAX_CV_LANGUAGES,
  type CvSectionOverride,
  type CvSectionType,
  type CvSlotDto,
  type Settings,
} from '@jobagg/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Eye, FileText, History, ListTree, Loader2, Upload } from 'lucide-react';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { formatDateTime, languageLabel } from '@/lib/format';
import { errorMessage, keys, useCvSlots } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { CheckboxGroupField, SectionCard, type SettingsForm } from './fields';

const PdfViewer = lazy(() => import('@/components/cv/PdfViewer'));

const SECTION_LABEL: Record<CvSectionType, string> = {
  personal: 'Dati personali',
  summary: 'Sommario / profilo',
  skills: 'Competenze',
  experience: 'Esperienze',
  education: 'Formazione',
  languages: 'Lingue',
  other: 'Altro',
};
const AUTO = '__auto__';

/** Struttura riconosciuta del CV base, con correzione manuale delle sezioni. */
function StructureDialog({ baseCvId, onClose }: { baseCvId: string | null; onClose: () => void }) {
  const client = useQueryClient();
  const { data, isPending } = useQuery({
    queryKey: keys.cvStructure(baseCvId ?? ''),
    queryFn: () => api.cv.structure(baseCvId!),
    enabled: !!baseCvId,
  });
  const [overrides, setOverrides] = useState<Record<string, CvSectionOverride>>({});
  useEffect(() => setOverrides(data?.structure.overrides ?? {}), [data]);

  const save = useMutation({
    mutationFn: () => api.cv.updateStructure(baseCvId!, overrides),
    onSuccess: (result) => {
      client.setQueryData(keys.cvStructure(baseCvId!), result);
      toast.success('Struttura aggiornata');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const structure = data?.structure;
  const sectionOf = new Map(structure?.sections.map((s) => [s.id, s]) ?? []);
  const dirty = JSON.stringify(overrides) !== JSON.stringify(structure?.overrides ?? {});

  return (
    <Dialog open={!!baseCvId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Struttura riconosciuta</DialogTitle>
          <DialogDescription>
            Controlla che le sezioni siano giuste: sommario, competenze e bullet delle esperienze sono le parti che il
            CV su misura può adattare; nome, contatti, ruoli, date e formazione restano sempre invariati. Se
            un’intestazione non è stata riconosciuta (o lo è stata per errore) correggila dal menu della riga.
          </DialogDescription>
        </DialogHeader>
        {isPending || !structure ? (
          <Skeleton className="h-64" />
        ) : (
          <ol className="grid gap-1 text-sm">
            {structure.paragraphs.map((p) => {
              const section = sectionOf.get(p.sectionId);
              const override = overrides[p.id];
              return (
                <li
                  key={p.id}
                  className={cn(
                    'grid items-start gap-2 rounded-md border px-2.5 py-1.5 sm:grid-cols-[1fr_13rem]',
                    p.isHeading && 'bg-accent font-semibold text-accent-foreground',
                  )}
                >
                  <div className="min-w-0">
                    <p className={cn('break-words', p.isBullet && 'pl-3')}>
                      {p.isBullet && <span aria-hidden="true">• </span>}
                      {p.text}
                    </p>
                    <p className="mt-0.5 flex flex-wrap gap-1.5 text-xs font-normal text-muted-foreground">
                      {p.isHeading ? (
                        <span>Intestazione: {SECTION_LABEL[section?.type ?? 'other']}</span>
                      ) : (
                        <span>{SECTION_LABEL[section?.type ?? 'other']}</span>
                      )}
                      {!p.isHeading &&
                        (p.mutable && p.editable ? (
                          <Badge variant="success">Adattabile</Badge>
                        ) : (
                          <Badge variant="muted">Invariato</Badge>
                        ))}
                      {p.mutable && !p.editable && <span>({p.notEditableReason})</span>}
                    </p>
                  </div>
                  <Select
                    value={override ?? AUTO}
                    onValueChange={(value) =>
                      setOverrides((current) => {
                        const next = { ...current };
                        if (value === AUTO) delete next[p.id];
                        else next[p.id] = value as CvSectionOverride;
                        return next;
                      })
                    }
                  >
                    <SelectTrigger
                      className="h-8 text-xs font-normal"
                      aria-label={`Ruolo del paragrafo: ${p.text.slice(0, 40)}`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={AUTO}>
                        Automatico{p.autoHeading ? ` (intestazione: ${SECTION_LABEL[p.autoHeading]})` : ' (contenuto)'}
                      </SelectItem>
                      {CV_SECTION_TYPES.filter((t) => t !== 'personal').map((type) => (
                        <SelectItem key={type} value={type}>
                          Inizio sezione: {SECTION_LABEL[type]}
                        </SelectItem>
                      ))}
                      <SelectItem value="not_heading">Non è un’intestazione</SelectItem>
                    </SelectContent>
                  </Select>
                </li>
              );
            })}
          </ol>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Chiudi
          </Button>
          <Button disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
            {save.isPending && <Loader2 className="animate-spin" />}
            Salva correzioni
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VersionsDialog({ language, onClose }: { language: string | null; onClose: () => void }) {
  const { data, isPending } = useQuery({
    queryKey: keys.cvVersions(language ?? ''),
    queryFn: () => api.cv.versions(language!),
    enabled: !!language,
  });
  return (
    <Dialog open={!!language} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Versioni del CV · {languageLabel(language)}</DialogTitle>
          <DialogDescription>
            Le versioni precedenti restano archiviate: i CV già generati continuano a riferirsi a quella da cui sono
            nati.
          </DialogDescription>
        </DialogHeader>
        {isPending ? (
          <Skeleton className="h-24" />
        ) : (
          <ul className="grid gap-1.5 text-sm">
            {(data ?? []).map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2">
                <span className="font-medium">Versione {v.version}</span>
                {v.isActive && <Badge>In uso</Badge>}
                <span className="text-muted-foreground">
                  {v.originalFileName} · {v.pageCount} pag. · {formatDateTime(v.uploadedAt)}
                </span>
                {v.hasPdf && (
                  <a
                    href={api.cv.basePdfUrl(v.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-auto text-primary-text underline underline-offset-2"
                  >
                    PDF
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Slot({
  slot,
  onPreview,
  onStructure,
  onVersions,
}: {
  slot: CvSlotDto;
  onPreview: () => void;
  onStructure: () => void;
  onVersions: () => void;
}) {
  const client = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const upload = useMutation({
    mutationFn: (file: File) => api.cv.upload(file, slot.language),
    onSuccess: () => {
      setProblem(null);
      toast.success(`CV ${languageLabel(slot.language).toLowerCase()} caricato`);
      void client.invalidateQueries({ queryKey: ['cv'] });
    },
    onError: (error) => setProblem(errorMessage(error)),
  });

  const pick = (file: File | undefined) => {
    if (!file) return;
    if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
      // il PDF non viene nemmeno inviato: si spiega subito perché serve il DOCX
      setProblem(
        'Serve il CV in formato DOCX, non PDF: solo il DOCX permette di modificare i testi mantenendo font, colori, colonne e impaginazione. Esportalo da Word, Google Docs o LibreOffice come .docx.',
      );
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setProblem('File troppo grande (massimo 10 MB).');
      return;
    }
    upload.mutate(file);
  };

  const active = slot.active;
  return (
    <li className="grid gap-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">{languageLabel(slot.language)}</h3>
        {slot.status === 'loaded' && <Badge variant="success">Caricato</Badge>}
        {slot.status === 'empty' && <Badge variant="muted">Vuoto</Badge>}
        {slot.status === 'error' && <Badge variant="destructive">In errore</Badge>}
        {active && (
          <span className="text-sm text-muted-foreground">
            {active.originalFileName} · versione {active.version}
            {active.pageCount > 0
              ? ` · ${active.pageCount} ${active.pageCount === 1 ? 'pagina' : 'pagine'}`
              : ''} · {formatDateTime(active.uploadedAt)}
          </span>
        )}
      </div>
      {slot.error && (
        <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {slot.error}
        </p>
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          pick(e.dataTransfer.files[0]);
        }}
        className={cn(
          'flex flex-col items-center gap-2 rounded-lg border border-dashed border-input p-4 text-center text-sm',
          dragging && 'border-primary bg-accent',
        )}
      >
        {upload.isPending ? (
          <span className="inline-flex items-center gap-2 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Analisi del documento e anteprima PDF…
          </span>
        ) : (
          <>
            <span className="text-muted-foreground">Trascina qui il file .docx oppure</span>
            <Button variant="outline" size="sm" onClick={() => input.current?.click()}>
              <Upload /> {active ? 'Sostituisci il CV' : 'Scegli il file'}
            </Button>
          </>
        )}
        <input
          ref={input}
          type="file"
          accept=".docx,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="sr-only"
          tabIndex={-1}
          aria-label={`File DOCX del CV in ${languageLabel(slot.language).toLowerCase()}`}
          onChange={(e) => {
            pick(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>
      {problem && (
        <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {problem}
        </p>
      )}

      {active && (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" disabled={!active.hasPdf} onClick={onPreview}>
            <Eye /> Anteprima PDF
          </Button>
          <Button variant="secondary" size="sm" onClick={onStructure}>
            <ListTree /> Struttura riconosciuta
          </Button>
          <Button variant="ghost" size="sm" onClick={onVersions}>
            <History /> Versioni ({slot.versions})
          </Button>
        </div>
      )}
    </li>
  );
}

export function CvTab({ form, saved }: { form: SettingsForm; saved: Settings }) {
  const slots = useCvSlots();
  const [preview, setPreview] = useState<{ id: string; title: string } | null>(null);
  const [structureId, setStructureId] = useState<string | null>(null);
  const [versionsOf, setVersionsOf] = useState<string | null>(null);
  const pendingLanguages = form.watch('cv.languages').filter((l) => !saved.cv.languages.includes(l));

  return (
    <div className="grid gap-4">
      <SectionCard
        title="CV di default"
        description="Un CV per lingua, in formato DOCX: è la base da cui nascono i CV su misura, che ne mantengono stile grafico e numero di pagine. Il file originale non viene mai modificato."
      >
        <CheckboxGroupField
          form={form}
          name="cv.languages"
          label={`Lingue abilitate (massimo ${MAX_CV_LANGUAGES})`}
          max={MAX_CV_LANGUAGES}
          options={CV_LANGUAGES.map((l) => ({ value: l, label: languageLabel(l) }))}
        />
        {pendingLanguages.length > 0 && (
          <p className="text-sm text-muted-foreground">
            Salva per poter caricare il CV in: {pendingLanguages.map(languageLabel).join(', ')}.
          </p>
        )}
        {slots.isPending ? (
          <Skeleton className="h-40" />
        ) : (
          <ul className="grid gap-3">
            {(slots.data ?? []).map((slot) => (
              <Slot
                key={slot.language}
                slot={slot}
                onPreview={() =>
                  slot.active &&
                  setPreview({
                    id: slot.active.id,
                    title: `${slot.active.originalFileName} (${languageLabel(slot.language)})`,
                  })
                }
                onStructure={() => slot.active && setStructureId(slot.active.id)}
                onVersions={() => setVersionsOf(slot.language)}
              />
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title="Competenze ed esperienze aggiuntive">
        <FormField
          control={form.control}
          name="cv.extra_skills"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Competenze reali che non compaiono nel CV</FormLabel>
              <FormControl>
                <Textarea
                  rows={5}
                  placeholder={'Una per riga, es.\nKubernetes\nGestione di un team di 4 persone'}
                  {...field}
                  value={field.value ?? ''}
                />
              </FormControl>
              <FormDescription>
                Facoltativo ma consigliato. Il CV su misura può attingere solo al CV base e a questo elenco: tutto il
                resto viene scartato come invenzione. Una voce per riga (o separate da virgola).
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      </SectionCard>

      <Dialog open={!!preview} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="size-5" /> Anteprima del CV base
            </DialogTitle>
            <DialogDescription>Conversione in PDF del documento caricato.</DialogDescription>
          </DialogHeader>
          {preview && (
            <Suspense fallback={<Skeleton className="h-96" />}>
              <PdfViewer url={api.cv.basePdfUrl(preview.id)} title={preview.title} className="max-h-[70dvh]" />
            </Suspense>
          )}
        </DialogContent>
      </Dialog>
      <StructureDialog baseCvId={structureId} onClose={() => setStructureId(null)} />
      <VersionsDialog language={versionsOf} onClose={() => setVersionsOf(null)} />
    </div>
  );
}
