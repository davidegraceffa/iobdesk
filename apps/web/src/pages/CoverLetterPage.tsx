import type { CoverLetterDto } from '@jobagg/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Copy, Download, Loader2, RefreshCw, Save, Undo2 } from 'lucide-react';
import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { GenerateLetterDialog } from '@/components/jobs/GenerateLetterDialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { formatDateTime, languageLabel } from '@/lib/format';
import { errorMessage, keys, useLetter } from '@/lib/queries';
import { PageSkeleton } from '../App';

const PdfViewer = lazy(() => import('@/components/cv/PdfViewer'));

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Pagina "Lettera per [Ruolo] – [Azienda]": testo modificabile, anteprima PDF, download. */
export function CoverLetterPage() {
  const { id = '' } = useParams();
  const client = useQueryClient();
  const { data: letter, isPending, isError, error } = useLetter(id || undefined);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [regenerate, setRegenerate] = useState(false);

  // il testo salvato sostituisce la bozza locale quando la lettera arriva o viene salvata
  useEffect(() => {
    setSubject(letter?.subject ?? '');
    setBody(letter?.body ?? '');
  }, [letter?.id, letter?.subject, letter?.body]);

  const save = useMutation({
    mutationFn: () => api.letters.update(id, { subject, body }),
    onSuccess: (updated: CoverLetterDto) => {
      client.setQueryData(keys.letter(id), updated);
      if (updated.jobId) void client.invalidateQueries({ queryKey: keys.lettersForJob(updated.jobId) });
      toast.success('Lettera salvata');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (isPending) return <PageSkeleton />;
  if (isError || !letter) {
    return (
      <div className="p-6">
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(error)}
        </p>
        <Button asChild variant="outline" size="sm" className="mt-3">
          <Link to="/">
            <ArrowLeft /> Torna agli annunci
          </Link>
        </Button>
      </div>
    );
  }

  const dirty = subject !== letter.subject || body !== letter.body;
  const words = wordCount(body);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(body);
      toast.success('Testo copiato negli appunti');
    } catch {
      toast.error('Copia non riuscita: seleziona il testo e copialo a mano');
    }
  };

  return (
    <div className="p-4 md:p-6">
      <header className="mb-4 grid gap-3">
        <Link
          to={letter.jobId ? `/?job=${letter.jobId}` : '/'}
          className="inline-flex w-fit items-center gap-1 text-sm text-primary-text hover:underline"
        >
          <ArrowLeft className="size-4" /> {letter.jobId ? 'Torna all’annuncio' : 'Torna agli annunci'}
        </Link>
        <div className="flex flex-wrap items-start gap-3">
          <div className="mr-auto min-w-0">
            <h1 className="text-xl font-semibold">
              Lettera per {letter.jobTitle} – {letter.company}
            </h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              <Badge variant="secondary">{languageLabel(letter.language)}</Badge>
              <Badge variant="secondary">Versione {letter.version}</Badge>
              {letter.edited && <Badge variant="secondary">Ritoccata a mano</Badge>}
              <span>
                {letter.provider} · {letter.model} · {formatDateTime(letter.createdAt)}
              </span>
              {!letter.jobId && <span>· l’annuncio non esiste più</span>}
            </p>
          </div>
          {letter.status === 'ready' && (
            <div className="flex flex-wrap gap-2">
              {letter.hasPdf && !dirty && (
                <>
                  <Button asChild variant="outline" size="sm">
                    <a href={api.letters.pdfDownloadUrl(letter.id)} download={`${letter.fileName}.pdf`}>
                      <Download /> Scarica PDF
                    </a>
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <a href={api.letters.docxUrl(letter.id)} download={`${letter.fileName}.docx`}>
                      <Download /> Scarica DOCX
                    </a>
                  </Button>
                </>
              )}
              <Button variant="outline" size="sm" onClick={() => void copy()}>
                <Copy /> Copia il testo
              </Button>
              <Button variant="outline" size="sm" disabled={!letter.jobId} onClick={() => setRegenerate(true)}>
                <RefreshCw /> Riscrivi
              </Button>
            </div>
          )}
        </div>
        {letter.userInstructions && (
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Istruzioni:</span> {letter.userInstructions}
          </p>
        )}
      </header>

      {letter.status === 'generating' ? (
        <div
          className="mx-auto flex max-w-lg items-center gap-3 rounded-xl border bg-card p-6"
          role="status"
          aria-live="polite"
        >
          <Loader2 className="size-5 shrink-0 animate-spin text-muted-foreground" />
          <div>
            <h2 className="font-semibold">Scrittura in corso</h2>
            <p className="text-sm text-muted-foreground">
              Di solito serve meno di un minuto. Puoi lasciare questa pagina: la lettera resta nel dettaglio
              dell’annuncio.
            </p>
          </div>
        </div>
      ) : letter.status === 'failed' ? (
        <Alert variant="destructive" className="mx-auto max-w-2xl">
          <AlertTriangle />
          <AlertTitle>Scrittura non riuscita</AlertTitle>
          <AlertDescription>
            <p>{letter.error ?? 'Errore sconosciuto'}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2 w-fit"
              disabled={!letter.jobId}
              onClick={() => setRegenerate(true)}
            >
              <RefreshCw /> Riprova
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          <section aria-label="Testo della lettera" className="grid min-w-0 content-start gap-3">
            {letter.warning && (
              <Alert variant="warning">
                <AlertTriangle />
                <AlertTitle>Da controllare</AlertTitle>
                <AlertDescription>{letter.warning}</AlertDescription>
              </Alert>
            )}
            <div className="grid gap-2">
              <Label htmlFor="letter-subject">Oggetto</Label>
              <Input id="letter-subject" value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="letter-body">Testo</Label>
              <Textarea
                id="letter-body"
                value={body}
                maxLength={8000}
                rows={22}
                className="min-h-[55dvh] leading-relaxed"
                onChange={(e) => setBody(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {words} {words === 1 ? 'parola' : 'parole'} · separa i paragrafi con una riga vuota. Intestazione con
                nome e recapiti, data e azienda vengono aggiunte nel PDF.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" disabled={!dirty || !body.trim() || save.isPending} onClick={() => save.mutate()}>
                {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} Salva e aggiorna il PDF
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!dirty || save.isPending}
                onClick={() => {
                  setSubject(letter.subject);
                  setBody(letter.body);
                }}
              >
                <Undo2 /> Annulla le modifiche
              </Button>
              {dirty && <span className="text-xs text-muted-foreground">Modifiche non salvate</span>}
            </div>
          </section>

          <section aria-label="Anteprima" className="min-w-0">
            {letter.hasPdf ? (
              <Suspense fallback={<Skeleton className="h-[70dvh]" />}>
                <PdfViewer
                  url={api.letters.pdfUrl(letter.id, letter.updatedAt)}
                  title="Lettera di candidatura"
                  className="h-[75dvh]"
                />
              </Suspense>
            ) : (
              <p className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
                Anteprima PDF non disponibile: il testo qui a fianco si può comunque copiare e modificare.
              </p>
            )}
          </section>
        </div>
      )}

      <GenerateLetterDialog
        job={regenerate && letter.jobId ? { id: letter.jobId, title: letter.jobTitle, company: letter.company } : null}
        regenerateFrom={{ id: letter.id, language: letter.language, instructions: letter.userInstructions }}
        onClose={() => setRegenerate(false)}
      />
    </div>
  );
}
