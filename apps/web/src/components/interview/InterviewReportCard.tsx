import type { InterviewSessionDto } from '@jobagg/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Check, Loader2, RefreshCw, X, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { errorMessage, keys } from '@/lib/queries';

const SCORE_LABEL: Record<number, string> = {
  1: 'Insufficiente',
  2: 'Debole',
  3: 'Sufficiente',
  4: 'Buono',
  5: 'Ottimo',
};
function Score({ value }: { value: number }) {
  return (
    <Badge variant={value >= 4 ? 'success' : value === 3 ? 'secondary' : 'warning'}>
      {value}/5 · {SCORE_LABEL[value] ?? ''}
    </Badge>
  );
}

function Bullets({ items, icon }: { items: string[]; icon: 'ok' | 'no' | 'todo' }) {
  if (items.length === 0) return null;
  const Icon = icon === 'ok' ? Check : icon === 'no' ? X : ArrowRight;
  return (
    <ul className="grid gap-1 text-sm">
      {items.map((item) => (
        <li key={item} className="flex gap-2">
          <Icon
            className={`mt-0.5 size-4 shrink-0 ${icon === 'ok' ? 'text-success' : icon === 'no' ? 'text-destructive' : 'text-muted-foreground'}`}
          />
          {item}
        </li>
      ))}
    </ul>
  );
}

/**
 * Valutazione finale del colloquio: correttezza dei contenuti domanda per domanda e tono. Prima che esista offre il pulsante per chiederla.
 */
export function InterviewReportCard({ session }: { session: InterviewSessionDto }) {
  const client = useQueryClient();
  const request = useMutation({
    mutationFn: () => api.interviews.finish(session.id),
    onSuccess: (updated) => {
      client.setQueryData(keys.interview(session.id), updated);
      void client.invalidateQueries({ queryKey: ['interviews', 'list'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const hasAnswers =
    session.mode === 'live' ? session.transcript.some((t) => t.role === 'candidate') : session.answers.length > 0;

  if (session.reportStatus === 'pending') {
    return (
      <p className="flex items-center gap-2 rounded-xl border p-5 text-sm text-muted-foreground" aria-live="polite">
        <Loader2 className="size-4 animate-spin" /> Preparo la valutazione finale: contenuti e tono. Può volerci un
        minuto.
      </p>
    );
  }
  if (session.reportStatus === 'failed') {
    return (
      <Alert variant="warning">
        <XCircle />
        <AlertTitle>Valutazione finale non riuscita</AlertTitle>
        <AlertDescription>
          <p>{session.reportError}</p>
          <Button variant="outline" size="sm" className="mt-1 w-fit" onClick={() => request.mutate()}>
            <RefreshCw /> Riprova
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
  const report = session.report;
  if (!report) {
    if (!hasAnswers) return null;
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-xl border p-5">
        <p className="mr-auto text-sm text-muted-foreground">
          Valutazione finale: correttezza di ciò che hai detto e tono.
        </p>
        <Button onClick={() => request.mutate()} disabled={request.isPending}>
          {request.isPending && <Loader2 className="animate-spin" />}
          {session.mode === 'live' ? 'Termina e valuta' : 'Genera la valutazione finale'}
        </Button>
      </div>
    );
  }

  const questions = new Map(session.questions.map((q, i) => [q.id, { ...q, number: i + 1 }]));
  const { delivery } = report;
  return (
    <section className="grid gap-5 rounded-xl border bg-card p-5" aria-label="Valutazione finale">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-lg font-semibold">Valutazione finale</h2>
        <Score value={report.overallScore} />
        <Button variant="ghost" size="sm" onClick={() => request.mutate()} disabled={request.isPending}>
          <RefreshCw /> Rigenera
        </Button>
      </div>
      <p className="text-sm">{report.summary}</p>

      {report.priorities.length > 0 && (
        <div className="rounded-lg bg-muted p-3">
          <h3 className="mb-1 text-sm font-semibold">Su cosa lavorare prima di un colloquio vero</h3>
          <ol className="list-decimal pl-5 text-sm">
            {report.priorities.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ol>
        </div>
      )}

      <div className="grid gap-3">
        <h3 className="font-semibold">Correttezza dei contenuti</h3>
        <p className="text-sm">{report.content.summary}</p>
        <ul className="grid gap-3">
          {report.content.items.map((item) => {
            const question = questions.get(item.questionId);
            return (
              <li key={item.questionId} className="grid gap-2 rounded-lg border p-3">
                <div className="flex flex-wrap items-start gap-2">
                  <p className="mr-auto min-w-0 flex-1 text-sm font-medium" lang={session.language}>
                    {question ? `${question.number}. ${question.text}` : item.questionId}
                  </p>
                  <Score value={item.score} />
                </div>
                <Bullets items={item.correct} icon="ok" />
                <Bullets items={item.incorrect} icon="no" />
                <Bullets items={item.missing} icon="todo" />
              </li>
            );
          })}
        </ul>
        <p className="text-xs text-muted-foreground">
          ✓ corretto · ✗ sbagliato o impreciso, con la correzione · → cosa mancava
        </p>
      </div>

      <div className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold">Tono</h3>
          {report.tone.traits.map((t) => (
            <Badge key={t} variant="outline">
              {t}
            </Badge>
          ))}
        </div>
        <p className="text-sm">{report.tone.summary}</p>
        <Bullets items={report.tone.suggestions} icon="todo" />
        <p className="text-xs text-muted-foreground">
          {delivery.answers} risposte, {delivery.words} parole
          {delivery.speakingSeconds > 0 ? `, ${Math.round(delivery.speakingSeconds / 60)} min di parlato` : ''}
          {delivery.wordsPerMinute ? `, circa ${delivery.wordsPerMinute} parole al minuto (naturale: 120-160)` : ''}. Il
          tono è valutato dalle parole e dal ritmo: pronuncia e intonazione non vengono analizzate.
        </p>
      </div>
    </section>
  );
}
