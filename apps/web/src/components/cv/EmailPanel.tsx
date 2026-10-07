import type { GeneratedCvDetail } from '@jobagg/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Copy, Loader2, Mail, RefreshCw, Save, Send } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { formatDateTime, languageLabel } from '@/lib/format';
import { errorMessage, keys } from '@/lib/queries';

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copiato negli appunti`);
  } catch {
    toast.error('Copia non riuscita: seleziona il testo e copialo a mano');
  }
}

/**
 * Email di accompagnamento: il testo breve con cui inviare questo CV in allegato. Si genera su richiesta,
 * si può ritoccare, copiare o aprire già compilato nel programma di posta.
 */
export function EmailPanel({ cv }: { cv: GeneratedCvDetail }) {
  const client = useQueryClient();
  const email = cv.email;
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [instructions, setInstructions] = useState('');

  // il testo salvato sostituisce la bozza locale quando l'email viene scritta o salvata
  useEffect(() => {
    setSubject(email?.subject ?? '');
    setBody(email?.body ?? '');
  }, [cv.id, email?.subject, email?.body]);
  useEffect(() => setInstructions(email?.instructions ?? ''), [cv.id, email?.instructions]);

  const onSaved = (detail: GeneratedCvDetail) => client.setQueryData(keys.cvDetail(cv.id), detail);
  const generate = useMutation({
    mutationFn: () => api.cv.generateEmail(cv.id, instructions.trim() || undefined),
    onSuccess: onSaved,
    onError: (err) => toast.error(errorMessage(err)),
  });
  const save = useMutation({
    mutationFn: () => api.cv.updateEmail(cv.id, { subject, body }),
    onSuccess: (detail) => {
      onSaved(detail);
      toast.success('Email salvata');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const dirty = !!email && (subject !== email.subject || body !== email.body);
  const canGenerate = !!cv.jobId || cv.manual;

  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">
        Il testo breve dell’email con cui inviare questo CV in allegato, in {languageLabel(cv.language).toLowerCase()}.
        Usa l’annuncio e solo ciò che c’è nel tuo CV; la firma viene aggiunta in locale.
      </p>

      <div className="grid gap-2">
        <Label htmlFor="email-instructions">Istruzioni (facoltative)</Label>
        <Input
          id="email-instructions"
          value={instructions}
          maxLength={2000}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="Es. tono informale, cita la disponibilità da gennaio"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={email ? 'outline' : 'default'}
          disabled={generate.isPending || !canGenerate}
          onClick={() => generate.mutate()}
        >
          {generate.isPending ? <Loader2 className="animate-spin" /> : email ? <RefreshCw /> : <Mail />}
          {email ? 'Riscrivi l’email' : 'Scrivi l’email'}
        </Button>
        <span className="text-xs text-muted-foreground">
          {generate.isPending
            ? 'Scrittura in corso…'
            : !canGenerate
              ? 'L’annuncio non esiste più: non si può scrivere l’email.'
              : email
                ? `Scritta con ${email.model} · ${formatDateTime(email.createdAt)}${email.edited ? ' · ritoccata a mano' : ''}. Riscriverla sostituisce il testo attuale.`
                : 'Di solito servono pochi secondi.'}
        </span>
      </div>

      {email && (
        <>
          {email.warning && (
            <Alert variant="warning">
              <AlertTriangle />
              <AlertTitle>Da controllare</AlertTitle>
              <AlertDescription>{email.warning}</AlertDescription>
            </Alert>
          )}
          <div className="grid gap-2">
            <Label htmlFor="email-subject">Oggetto</Label>
            <Input id="email-subject" value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="email-body">Testo</Label>
            <Textarea
              id="email-body"
              value={body}
              rows={12}
              maxLength={5000}
              className="leading-relaxed"
              lang={cv.language}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={!dirty || !body.trim() || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} Salva
            </Button>
            <Button variant="outline" size="sm" onClick={() => void copy(subject, 'Oggetto')}>
              <Copy /> Copia l’oggetto
            </Button>
            <Button variant="outline" size="sm" onClick={() => void copy(body, 'Testo')}>
              <Copy /> Copia il testo
            </Button>
            <Button asChild variant="outline" size="sm">
              <a href={`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`}>
                <Send /> Apri nel programma di posta
              </a>
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {dirty ? 'Modifiche non salvate. ' : ''}Il CV non viene allegato da solo: scarica il PDF e aggiungilo
            all’email.
          </p>
        </>
      )}
    </div>
  );
}
