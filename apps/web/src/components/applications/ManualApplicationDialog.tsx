import { APPLICATION_CHANNELS, type ApplicationChannel } from '@jobagg/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
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
import { api } from '@/lib/api';
import { CHANNEL_LABEL, todayIso } from '@/lib/format';
import { errorMessage } from '@/lib/queries';

const EMPTY = {
  title: '',
  company: '',
  url: '',
  source: '',
  location: '',
  country: '',
  salaryRawText: '',
  description: '',
  notes: '',
};

/** Candidatura manuale per annunci trovati altrove (LinkedIn, passaparola, sito dell'azienda…). */
export function ManualApplicationDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const client = useQueryClient();
  const [form, setForm] = useState(EMPTY);
  const [appliedAt, setAppliedAt] = useState(todayIso());
  const [channel, setChannel] = useState<ApplicationChannel>('other');

  useEffect(() => {
    if (open) {
      setForm(EMPTY);
      setAppliedAt(todayIso());
      setChannel('other');
    }
  }, [open]);

  const create = useMutation({
    mutationFn: () =>
      api.applications.create({
        title: form.title.trim(),
        company: form.company.trim(),
        url: form.url.trim() || undefined,
        source: form.source.trim() || undefined,
        location: form.location.trim() || undefined,
        country: form.country.trim() || undefined,
        salaryRawText: form.salaryRawText.trim() || undefined,
        description: form.description.trim() || undefined,
        notes: form.notes.trim() || undefined,
        channel,
        appliedAt: new Date(`${appliedAt}T12:00:00`).toISOString(),
      }),
    onSuccess: () => {
      toast.success('Candidatura aggiunta allo storico');
      void client.invalidateQueries({ queryKey: ['applications'] });
      onOpenChange(false);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const field = (key: keyof typeof EMPTY) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value })),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Aggiungi candidatura</DialogTitle>
          <DialogDescription>Per annunci trovati fuori da questa app.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="ma-title">Ruolo</Label>
              <Input id="ma-title" required maxLength={300} {...field('title')} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ma-company">Azienda</Label>
              <Input id="ma-company" required maxLength={300} {...field('company')} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ma-date">Data candidatura</Label>
              <Input
                id="ma-date"
                type="date"
                required
                max={todayIso()}
                value={appliedAt}
                onChange={(e) => setAppliedAt(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ma-channel">Canale</Label>
              <Select value={channel} onValueChange={(v) => setChannel(v as ApplicationChannel)}>
                <SelectTrigger id="ma-channel">
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
            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="ma-url">Link all’annuncio (facoltativo)</Label>
              <Input id="ma-url" type="url" placeholder="https://…" {...field('url')} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ma-source">Dove l’hai trovato</Label>
              <Input id="ma-source" placeholder="Es. LinkedIn" {...field('source')} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ma-location">Località</Label>
              <Input id="ma-location" {...field('location')} />
            </div>
            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="ma-country">Nazione</Label>
              <Input id="ma-country" placeholder="Es. Italia, Remoto" {...field('country')} />
            </div>
            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="ma-salary">RAL / retribuzione, se indicata</Label>
              <Input id="ma-salary" placeholder="Es. €45k–55k lordi/anno" {...field('salaryRawText')} />
            </div>
            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="ma-desc">Descrizione dell’annuncio (facoltativa)</Label>
              <Textarea
                id="ma-desc"
                rows={4}
                placeholder="Incolla qui il testo: resterà consultabile anche se l’annuncio sparisce"
                {...field('description')}
              />
            </div>
            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="ma-notes">Note</Label>
              <Textarea id="ma-notes" rows={2} {...field('notes')} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Annulla
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending && <Loader2 className="animate-spin" />}
              Aggiungi
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
