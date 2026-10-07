import { APPLICATION_CHANNELS, type ApplicationChannel, type GeneratedCvDto, type JobListItem } from '@jobagg/shared';
import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
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
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api';
import { CHANNEL_LABEL, languageLabel, todayIso } from '@/lib/format';
import { errorMessage, useApplyToJob, useCvForJob } from '@/lib/queries';

const CHANNEL_BY_METHOD: Record<string, ApplicationChannel> = {
  ats: 'ats',
  careers_page: 'careers_page',
  email: 'email',
  source_page: 'other',
};
const NO_CV = '__none__';

interface AskProps {
  job: JobListItem | null;
  onAnswer: (applied: boolean) => void;
}

/** Al ritorno sulla scheda dopo il click su "Candidati": "Ti sei candidato?". */
export function AskAppliedDialog({ job, onAnswer }: AskProps) {
  return (
    <Dialog open={!!job} onOpenChange={(open) => !open && onAnswer(false)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Ti sei candidato?</DialogTitle>
          <DialogDescription>
            {job ? `${job.title} — ${job.company}` : ''}
            <br />
            Se sì, registro la candidatura nello storico con una copia dell’annuncio.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onAnswer(false)}>
            Non ancora
          </Button>
          <Button onClick={() => onAnswer(true)} autoFocus>
            Sì
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface Props {
  job: JobListItem | null;
  /** CV generato da collegare alla candidatura, se si arriva da "Usa per la candidatura" */
  presetCvId?: string;
  onClose: () => void;
}

/** Form precompilato per registrare la candidatura: data di oggi, canale dedotto dal metodo, note, contatto. */
export function ApplyDialog({ job, presetCvId, onClose }: Props) {
  const apply = useApplyToJob();
  const cvs = useCvForJob(job?.id ?? null);
  const [appliedAt, setAppliedAt] = useState(todayIso());
  const [channel, setChannel] = useState<ApplicationChannel>('other');
  const [notes, setNotes] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [cvId, setCvId] = useState<string>(NO_CV);

  useEffect(() => {
    if (!job) return;
    setAppliedAt(todayIso());
    setChannel(CHANNEL_BY_METHOD[job.applyMethod] ?? 'other');
    setNotes('');
    setContactName('');
    setContactEmail('');
    setCvId(presetCvId ?? NO_CV);
  }, [job, presetCvId]);

  const ready: GeneratedCvDto[] = (cvs.data ?? []).filter((c) => c.status === 'ready');
  const alreadyApplied = job?.application;

  const submit = () => {
    if (!job) return;
    apply.mutate(
      {
        jobId: job.id,
        input: {
          // mezzogiorno locale: la data resta quella scelta in qualunque fuso
          appliedAt: new Date(`${appliedAt}T12:00:00`).toISOString(),
          channel,
          notes: notes.trim() || undefined,
          contactName: contactName.trim() || undefined,
          contactEmail: contactEmail.trim() || undefined,
          generatedCvId: cvId === NO_CV ? undefined : cvId,
        },
      },
      {
        onSuccess: () => {
          toast.success('Candidatura registrata nello storico');
          onClose();
        },
        onError: (error) => {
          // candidatura doppia: avviso, nessun duplicato
          if (error instanceof ApiError && error.status === 409) toast.warning(error.message);
          else toast.error(errorMessage(error));
        },
      },
    );
  };

  return (
    <Dialog open={!!job} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registra candidatura</DialogTitle>
          <DialogDescription>{job ? `${job.title} — ${job.company}` : ''}</DialogDescription>
        </DialogHeader>
        {alreadyApplied ? (
          <p
            role="alert"
            className="rounded-md border border-warning-border bg-warning text-warning-foreground p-3 text-sm"
          >
            Ti sei già candidato a questo annuncio il {new Date(alreadyApplied.appliedAt).toLocaleDateString('it-IT')}:
            non creo una seconda candidatura. La trovi nello storico.
          </p>
        ) : (
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="ap-date">Data</Label>
                <Input
                  id="ap-date"
                  type="date"
                  value={appliedAt}
                  max={todayIso()}
                  onChange={(e) => setAppliedAt(e.target.value)}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ap-channel">Canale</Label>
                <Select value={channel} onValueChange={(v) => setChannel(v as ApplicationChannel)}>
                  <SelectTrigger id="ap-channel">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {APPLICATION_CHANNELS.map((c) => (
                      <SelectItem key={c} value={c}>
                        {CHANNEL_LABEL[c]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {ready.length > 0 && (
              <div className="grid gap-2">
                <Label htmlFor="ap-cv">CV inviato</Label>
                <Select value={cvId} onValueChange={setCvId}>
                  <SelectTrigger id="ap-cv">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_CV}>Nessun CV generato (ho usato un altro CV)</SelectItem>
                    {ready.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        CV su misura · {languageLabel(c.language)} · v{c.version}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="ap-contact">Contatto (facoltativo)</Label>
                <Input
                  id="ap-contact"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  placeholder="Nome del recruiter"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ap-email">Email del contatto</Label>
                <Input
                  id="ap-email"
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ap-notes">Note (facoltative)</Label>
              <Textarea id="ap-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Annulla
              </Button>
              <Button type="submit" disabled={apply.isPending}>
                {apply.isPending && <Loader2 className="animate-spin" />}
                Registra candidatura
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
