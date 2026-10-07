import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Loader2, MessagesSquare, Mic, ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
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
import { api, type InterviewTarget } from '@/lib/api';
import { LANGUAGE_LABEL, languageLabel } from '@/lib/format';
import { errorMessage, keys, useInterviewOptions } from '@/lib/queries';

const COUNTS = [4, 6, 8, 10, 12];
/** come MIN_DESCRIPTION_CHARS dell'API */
const MIN_DESCRIPTION = 150;

/**
 * Avvio di un colloquio simulato su un annuncio o una candidatura: lingua (di default quella dell'annuncio),
 * numero di domande, consenso; se l'annuncio non ha descrizione la si incolla qui. Ogni avvio è un nuovo
 * tentativo, con domande nuove.
 */
export function StartInterviewDialog({ target, onClose }: { target: InterviewTarget | null; onClose: () => void }) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const options = useInterviewOptions(target);
  const [language, setLanguage] = useState('');
  const [count, setCount] = useState(8);
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [description, setDescription] = useState('');
  const [mode, setMode] = useState<'live' | 'turns'>('live');
  const info = options.data;
  const needsDescription = !!info && !info.descriptionAvailable;
  const descriptionShort = needsDescription && description.trim().length < MIN_DESCRIPTION;
  const needsConsent = !!info && info.external && !info.consentGiven;

  useEffect(() => {
    setLanguage('');
    setConsent(false);
    setSubmitting(false);
    setDescription('');
  }, [target?.kind, target?.id]);

  useEffect(() => {
    if (info && !language) setLanguage(info.suggestedLanguage);
  }, [info, language]);

  const submit = async () => {
    if (!target || !language) return;
    setSubmitting(true);
    try {
      const session = await api.interviews.create(target, {
        language,
        questionCount: count,
        mode,
        consentExternal: needsConsent ? consent : undefined,
        description: needsDescription ? description.trim() : undefined,
      });
      void client.invalidateQueries({ queryKey: ['interviews'] });
      void client.invalidateQueries({ queryKey: keys.profile });
      onClose();
      navigate(`/interviews/${session.id}`);
    } catch (error) {
      toast.error(errorMessage(error));
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessagesSquare className="size-5" /> Simula un colloquio
          </DialogTitle>
          <DialogDescription>
            {info ? `${info.title} — ${info.company}` : ''}
            {info && info.previousAttempts > 0
              ? ` · tentativo ${info.previousAttempts + 1}: le domande saranno diverse dai precedenti`
              : ''}
          </DialogDescription>
        </DialogHeader>

        {options.isPending ? (
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
            <AlertTitle>Serve un LLM</AlertTitle>
            <AlertDescription>
              <p>Le domande e le valutazioni vengono generate dall’LLM. {info.reason}</p>
              <Button asChild variant="outline" size="sm" className="mt-1 w-fit">
                <Link to="/profile?tab=avanzate" onClick={onClose}>
                  Apri Profilo → Avanzate
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
            <p className="text-sm text-muted-foreground">
              Domande tecniche e comportamentali costruite su questo annuncio, a cui rispondi a voce (o per iscritto).
            </p>
            {needsDescription && (
              <div className="grid gap-2">
                <Label htmlFor="iv-description">Descrizione dell’annuncio</Label>
                <Textarea
                  id="iv-description"
                  rows={8}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Incolla qui il testo dell’offerta (responsabilità, requisiti, tecnologie, azienda)"
                />
                <p className="text-xs text-muted-foreground">
                  Questa candidatura non ha la descrizione dell’annuncio: incollala dalla pagina dell’offerta o dalla
                  mail. Resta salvata con la candidatura, così i prossimi tentativi non la richiedono.
                  {descriptionShort && description.trim()
                    ? ` Ancora troppo corta (almeno ${MIN_DESCRIPTION} caratteri).`
                    : ''}
                </p>
              </div>
            )}
            <div className="grid gap-2">
              <Label htmlFor="iv-mode">Modalità</Label>
              <Select value={mode} onValueChange={(v) => setMode(v as 'live' | 'turns')}>
                <SelectTrigger id="iv-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="live">
                    Conversazione a voce: l’intervistatore risponde e fa contro-domande
                  </SelectItem>
                  <SelectItem value="turns">
                    Domande e risposte: una alla volta, con valutazione di ogni risposta
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                In entrambe, alla fine ricevi la valutazione di correttezza dei contenuti e tono.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="iv-language">Lingua del colloquio</Label>
                <Select value={language} onValueChange={setLanguage}>
                  <SelectTrigger id="iv-language">
                    <SelectValue placeholder="Scegli" />
                  </SelectTrigger>
                  <SelectContent>
                    {needsDescription && <SelectItem value="auto">Automatica (lingua della descrizione)</SelectItem>}
                    {Object.entries(LANGUAGE_LABEL).map(([code, label]) => (
                      <SelectItem key={code} value={code}>
                        {label}
                        {code === info.detectedLanguage ? ' (lingua dell’annuncio)' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!info.detectedLanguage && !needsDescription && (
                  <p className="text-xs text-muted-foreground">
                    Lingua dell’annuncio {languageLabel(null)}: proposto l’inglese.
                  </p>
                )}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="iv-count">Numero di domande</Label>
                <Select value={String(count)} onValueChange={(v) => setCount(Number(v))}>
                  <SelectTrigger id="iv-count">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COUNTS.map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n} domande ({Math.ceil(n / 2)} tecniche, {n - Math.ceil(n / 2)} umane)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <p className="flex items-start gap-2 rounded-md bg-muted p-3 text-sm">
              <Mic className="mt-0.5 size-4 shrink-0" />
              {info.speechToText
                ? 'Le risposte vocali vengono trascritte in locale (Whisper): l’audio non lascia il computer e non viene salvato.'
                : 'Trascrizione vocale non attiva: potrai rispondere per iscritto. Per rispondere a voce avvia il servizio locale con  docker compose --profile stt up -d.'}
            </p>

            <div className="rounded-lg border p-3 text-sm">
              <p className="font-medium">
                Cosa viene inviato a {info.provider} ({info.model})
              </p>
              <ul className="mt-1 list-disc pl-5 text-muted-foreground">
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
                  {needsConsent ? (
                    <label className="mt-1 flex items-start gap-2 font-medium">
                      <Checkbox className="mt-0.5" checked={consent} onCheckedChange={(c) => setConsent(c === true)} />
                      Acconsento all’invio dell’annuncio, del mio profilo e delle mie risposte a {info.provider}. Il
                      consenso viene salvato nelle impostazioni.
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
              <Button
                type="submit"
                disabled={submitting || !language || descriptionShort || (needsConsent && !consent)}
              >
                {submitting && <Loader2 className="animate-spin" />}
                Inizia il colloquio
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
