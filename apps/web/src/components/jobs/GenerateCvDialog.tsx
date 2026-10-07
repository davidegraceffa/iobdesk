import type { JobListItem } from '@jobagg/shared';
import { AlertTriangle, FileText, Loader2, ShieldAlert } from 'lucide-react';
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
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { languageLabel } from '@/lib/format';
import { errorMessage, keys, useCvOptions } from '@/lib/queries';
import { useCvProgress } from '@/lib/useCvProgress';

interface Props {
  job: Pick<JobListItem, 'id' | 'title' | 'company'> | null;
  /** rigenerazione di un CV esistente: stesse scelte, nuove istruzioni, nuova versione */
  regenerateFrom?: { id: string; language: string; instructions: string | null };
  onClose: () => void;
}

/** Dialog "Genera CV": lingua, istruzioni facoltative, riepilogo di cosa viene inviato e a quale provider. */
export function GenerateCvDialog({ job, regenerateFrom, onClose }: Props) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const options = useCvOptions(job?.id ?? null);
  const [language, setLanguage] = useState<string>('');
  const [instructions, setInstructions] = useState('');
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [generatedId, setGeneratedId] = useState<string | null>(null);
  const progress = useCvProgress(generatedId);

  useEffect(() => {
    if (!job) return;
    setGeneratedId(null);
    setConsent(false);
    setSubmitting(false);
    setInstructions(regenerateFrom?.instructions ?? '');
    setLanguage('');
    // dipende solo dagli id: gli oggetti passati dal chiamante cambiano identità a ogni render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id, regenerateFrom?.id]);

  useEffect(() => {
    if (!options.data || language) return;
    setLanguage(regenerateFrom?.language ?? options.data.suggestedLanguage ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.data, language, regenerateFrom?.id]);

  // a generazione conclusa si passa all'anteprima
  useEffect(() => {
    if (progress?.step !== 'ready' || !generatedId || !job) return;
    void client.invalidateQueries({ queryKey: ['jobs'] });
    void client.invalidateQueries({ queryKey: keys.cvForJob(job.id) });
    void client.invalidateQueries({ queryKey: keys.profile });
    onClose();
    navigate(`/cv/${generatedId}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress?.step, generatedId, job?.id]);

  const info = options.data;
  const needsConsent = !!info && info.external && !info.consentGiven;

  const submit = async () => {
    if (!job || !info || !language) return;
    setSubmitting(true);
    try {
      const input = {
        language,
        instructions: instructions.trim() || undefined,
        consentExternal: needsConsent ? consent : undefined,
      };
      const result = regenerateFrom
        ? await api.cv.regenerate(regenerateFrom.id, input)
        : await api.cv.generate(job.id, input);
      setGeneratedId(result.generatedCvId);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={!!job} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="size-5" /> {regenerateFrom ? 'Rigenera CV' : 'Genera CV su misura'}
          </DialogTitle>
          <DialogDescription>{job ? `${job.title} — ${job.company}` : ''}</DialogDescription>
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
                  Puoi chiudere questa finestra: la generazione continua in background.
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
            <div className="grid gap-2">
              <Label htmlFor="cv-lang">Lingua del CV</Label>
              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger id="cv-lang">
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
                Lingua rilevata dell’annuncio: {languageLabel(info.detectedLanguage)}.
                {info.detectedLanguage && !info.languages.includes(info.detectedLanguage)
                  ? ' Non hai un CV base in questa lingua: viene proposta la prima disponibile.'
                  : ''}{' '}
                Il CV viene scritto nella lingua scelta anche se l’annuncio è in un’altra.
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="cv-instructions">Istruzioni aggiuntive (facoltative)</Label>
              <Textarea
                id="cv-instructions"
                rows={3}
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
              <Button type="submit" disabled={submitting || !language || (needsConsent && !consent)}>
                {submitting && <Loader2 className="animate-spin" />}
                {regenerateFrom ? 'Rigenera' : 'Genera CV'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
