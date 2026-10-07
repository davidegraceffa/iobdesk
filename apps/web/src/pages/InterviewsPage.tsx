import type { InterviewSessionSummary } from '@jobagg/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, MessagesSquare, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
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
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '@/lib/api';
import { formatDateTime, languageLabel } from '@/lib/format';
import { errorMessage, useInterviews } from '@/lib/queries';

function Status({ session }: { session: InterviewSessionSummary }) {
  if (session.status === 'generating') return <Badge variant="secondary">Domande in preparazione</Badge>;
  if (session.status === 'failed') return <Badge variant="destructive">Non riuscito</Badge>;
  if (session.finishedAt || session.answeredCount >= session.questionCount)
    return <Badge variant="success">Completato</Badge>;
  return <Badge variant="muted">In corso</Badge>;
}

/** Storico dei colloqui simulati, con punteggio medio delle risposte. */
export function InterviewsPage() {
  const client = useQueryClient();
  const { data, isPending, isError, error } = useInterviews();
  const [toDelete, setToDelete] = useState<InterviewSessionSummary | null>(null);
  // un gruppo per annuncio o candidatura, con i tentativi dal più recente
  const groups = useMemo(() => {
    const byTarget = new Map<string, InterviewSessionSummary[]>();
    for (const session of data ?? []) {
      const key = session.jobId ?? session.applicationId ?? session.id;
      byTarget.set(key, [...(byTarget.get(key) ?? []), session]);
    }
    return [...byTarget.values()];
  }, [data]);
  const remove = useMutation({
    mutationFn: (id: string) => api.interviews.remove(id),
    onSuccess: () => {
      toast.success('Colloquio eliminato');
      setToDelete(null);
      void client.invalidateQueries({ queryKey: ['interviews'] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <div className="p-4 md:p-6">
      <header className="mb-4">
        <h1 className="text-xl font-semibold">Colloqui simulati</h1>
        <p className="text-sm text-muted-foreground">
          Domande tecniche e umane costruite sull’annuncio, nella sua lingua, diverse a ogni tentativo. Per iniziarne
          uno premi “Simula colloquio” nel dettaglio di un annuncio o di una candidatura.
        </p>
      </header>

      {isPending ? (
        <Skeleton className="h-40" />
      ) : isError ? (
        <p className="text-sm text-destructive">{errorMessage(error)}</p>
      ) : !data || data.length === 0 ? (
        <div className="grid justify-items-center gap-3 rounded-xl border p-10 text-center">
          <MessagesSquare className="size-8 text-muted-foreground" />
          <p className="font-medium">Nessun colloquio simulato</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Apri un annuncio dalla lista e premi “Simula colloquio”: le domande vengono preparate su quell’offerta e
            puoi rispondere a voce.
          </p>
          <Button asChild>
            <Link to="/">Vai agli annunci</Link>
          </Button>
        </div>
      ) : (
        <div className="grid gap-3">
          {groups.map((group) => {
            const latest = group[0]!;
            const scores = group.map((g) => g.overallScore ?? g.averageScore).filter((v): v is number => v !== null);
            return (
              <section key={latest.jobId ?? latest.applicationId ?? latest.id} className="rounded-xl border p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <h2 className="font-semibold">{latest.jobTitle}</h2>
                    <p className="text-sm text-muted-foreground">{latest.company}</p>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {group.length === 1 ? '1 colloquio' : `${group.length} colloqui`}
                    {scores.length > 0 ? ` · migliore valutazione ${Math.max(...scores)}/5` : ''}
                  </p>
                </div>
                <Table className="mt-2">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tentativo</TableHead>
                      <TableHead>Data</TableHead>
                      <TableHead>Lingua</TableHead>
                      <TableHead>Modalità</TableHead>
                      <TableHead>Risposte</TableHead>
                      <TableHead>Valutazione</TableHead>
                      <TableHead>Stato</TableHead>
                      <TableHead>
                        <span className="sr-only">Azioni</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {group.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell>
                          <Link to={`/interviews/${s.id}`} className="font-medium hover:underline">
                            #{s.attempt}
                          </Link>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{formatDateTime(s.createdAt)}</TableCell>
                        <TableCell>{languageLabel(s.language)}</TableCell>
                        <TableCell>{s.mode === 'live' ? 'Conversazione' : 'Domande e risposte'}</TableCell>
                        <TableCell className="tabular-nums">
                          {s.answeredCount}/{s.questionCount}
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {(s.overallScore ?? s.averageScore) !== null ? `${s.overallScore ?? s.averageScore}/5` : '—'}
                        </TableCell>
                        <TableCell>
                          <Status session={s} />
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Elimina il tentativo ${s.attempt} per ${s.jobTitle}`}
                            onClick={() => setToDelete(s)}
                          >
                            <Trash2 />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </section>
            );
          })}
        </div>
      )}

      <Dialog open={!!toDelete} onOpenChange={(open) => !open && setToDelete(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Eliminare il colloquio?</DialogTitle>
            <DialogDescription>
              {toDelete ? `${toDelete.jobTitle} — ${toDelete.company}. ` : ''}Domande, risposte e valutazioni verranno
              cancellate.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setToDelete(null)}>
              Annulla
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => toDelete && remove.mutate(toDelete.id)}
            >
              {remove.isPending && <Loader2 className="animate-spin" />}
              Elimina
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
