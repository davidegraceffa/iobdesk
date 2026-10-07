import type { InterviewAnswerDto, InterviewQuestion, InterviewSessionDto } from '@jobagg/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronLeft,
  LifeBuoy,
  Lightbulb,
  Loader2,
  Mic,
  PenLine,
  RefreshCw,
  Shuffle,
  Square,
  Volume2,
  VolumeX,
  XCircle,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { InterviewBriefCard } from '@/components/interview/InterviewBriefCard';
import { InterviewReportCard } from '@/components/interview/InterviewReportCard';
import { LiveInterview } from '@/components/interview/LiveInterview';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { formatDateTime, languageLabel } from '@/lib/format';
import { errorMessage, keys, useInterview, useInterviews } from '@/lib/queries';
import { useSpeaker } from '@/lib/speech';
import { MAX_RECORDING_SECONDS, useAudioRecorder } from '@/lib/useAudioRecorder';
import { cn } from '@/lib/utils';

const KIND_LABEL = { technical: 'Tecnica', behavioral: 'Umana' } as const;
const SCORE_LABEL: Record<number, string> = {
  1: 'Insufficiente',
  2: 'Debole',
  3: 'Sufficiente',
  4: 'Buona',
  5: 'Ottima',
};

type Speaker = ReturnType<typeof useSpeaker>;

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

function ScoreBadge({ score }: { score: number }) {
  return (
    <Badge variant={score >= 4 ? 'success' : score === 3 ? 'secondary' : 'warning'}>
      {score}/5 · {SCORE_LABEL[score] ?? ''}
    </Badge>
  );
}

function ListenButton({
  id,
  text,
  language,
  speaker,
  label,
}: {
  id: string;
  text: string;
  language: string;
  speaker: Speaker;
  label: string;
}) {
  if (!speaker.supported) return null;
  const speaking = speaker.speakingId === id;
  return (
    <Button type="button" variant="outline" size="sm" onClick={() => speaker.speak(id, text, language)}>
      {speaking ? <VolumeX /> : <Volume2 />} {speaking ? 'Ferma' : label}
    </Button>
  );
}

function Feedback({
  answer,
  language,
  speaker,
  onRetry,
  retrying,
}: {
  answer: InterviewAnswerDto;
  language: string;
  speaker: Speaker;
  onRetry: () => void;
  retrying: boolean;
}) {
  if (answer.status === 'pending') {
    return (
      <p className="flex items-center gap-2 rounded-lg border p-4 text-sm text-muted-foreground" aria-live="polite">
        <Loader2 className="size-4 animate-spin" /> Valutazione della risposta in corso…
      </p>
    );
  }
  if (answer.status === 'failed' || !answer.feedback) {
    return (
      <Alert variant="warning">
        <XCircle />
        <AlertTitle>Valutazione non riuscita</AlertTitle>
        <AlertDescription>
          <p>{answer.error}</p>
          <Button variant="outline" size="sm" className="mt-1 w-fit" onClick={onRetry} disabled={retrying}>
            <RefreshCw /> Riprova la valutazione
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
  const f = answer.feedback;
  return (
    <section className="grid gap-4 rounded-xl border bg-card p-5" aria-label="Valutazione">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">Valutazione</h3>
        <ScoreBadge score={f.score} />
      </div>
      <p className="text-sm">{f.summary}</p>
      <div className="grid gap-4 md:grid-cols-2">
        {f.strengths.length > 0 && (
          <div>
            <h4 className="mb-1 text-sm font-medium">Punti di forza</h4>
            <ul className="grid gap-1 text-sm">
              {f.strengths.map((s) => (
                <li key={s} className="flex gap-2">
                  <Check className="mt-0.5 size-4 shrink-0 text-success" /> {s}
                </li>
              ))}
            </ul>
          </div>
        )}
        {f.improvements.length > 0 && (
          <div>
            <h4 className="mb-1 text-sm font-medium">Cosa migliorare</h4>
            <ul className="grid gap-1 text-sm">
              {f.improvements.map((s) => (
                <li key={s} className="flex gap-2">
                  <ArrowRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" /> {s}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {f.sampleAnswer && (
        <div className="grid gap-2 rounded-lg bg-muted p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-medium">Una risposta più efficace</h4>
            <ListenButton
              id={`sample-${answer.questionId}`}
              text={f.sampleAnswer}
              language={language}
              speaker={speaker}
              label="Ascolta"
            />
          </div>
          <p className="text-sm whitespace-pre-line" lang={language}>
            {f.sampleAnswer}
          </p>
          <p className="text-xs text-muted-foreground">
            Costruita solo su ciò che hai detto e sul tuo profilo: le parti tra [parentesi] sono da completare con un
            tuo esempio reale.
          </p>
        </div>
      )}
    </section>
  );
}

function AnswerPanel({
  session,
  question,
  answer,
  speechToText,
  speaker,
}: {
  session: InterviewSessionDto;
  question: InterviewQuestion;
  answer: InterviewAnswerDto | undefined;
  speechToText: boolean;
  speaker: Speaker;
}) {
  const client = useQueryClient();
  const [editing, setEditing] = useState(!answer);
  const [draft, setDraft] = useState('');
  const [mode, setMode] = useState<'audio' | 'text'>('audio');
  const [duration, setDuration] = useState<number | undefined>(undefined);
  const [transcribing, setTranscribing] = useState(false);

  const submit = useMutation({
    mutationFn: (input: { transcript: string; inputMode: 'audio' | 'text'; durationSec?: number }) =>
      api.interviews.answer(session.id, question.id, input),
    onSuccess: (updated) => {
      client.setQueryData(keys.interview(session.id), updated);
      void client.invalidateQueries({ queryKey: ['interviews', 'list'] });
      setEditing(false);
      setDraft('');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const recorder = useAudioRecorder(async (audio, durationSec) => {
    setTranscribing(true);
    try {
      const { text } = await api.interviews.transcribe(audio, session.language, session.id);
      if (!text) toast.warning('Non ho sentito nulla: controlla il microfono e riprova');
      setDraft((previous) => (previous.trim() && text ? `${previous.trim()} ${text}` : text || previous));
      setMode('audio');
      setDuration((previous) => (previous ?? 0) + durationSec);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setTranscribing(false);
    }
  });

  const canRecord = speechToText && recorder.state !== 'unsupported';
  const recording = recorder.state === 'recording';

  if (answer && !editing) {
    return (
      <div className="grid gap-4">
        <section className="grid gap-2 rounded-xl border p-5" aria-label="La tua risposta">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">La tua risposta</h3>
            <span className="text-xs text-muted-foreground">
              {answer.inputMode === 'audio' ? 'A voce' : 'Per iscritto'}
              {answer.durationSec ? ` · ${clock(answer.durationSec)}` : ''} · {formatDateTime(answer.updatedAt)}
            </span>
          </div>
          <p className="text-sm whitespace-pre-line" lang={session.language}>
            {answer.transcript}
          </p>
          <div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setEditing(true);
                setDraft('');
                setDuration(undefined);
              }}
            >
              <RefreshCw /> Rispondi di nuovo
            </Button>
          </div>
        </section>
        <Feedback
          answer={answer}
          language={session.language}
          speaker={speaker}
          retrying={submit.isPending}
          onRetry={() =>
            submit.mutate({
              transcript: answer.transcript,
              inputMode: answer.inputMode,
              durationSec: answer.durationSec ?? undefined,
            })
          }
        />
      </div>
    );
  }

  return (
    <section className="grid gap-4 rounded-xl border p-5" aria-label="Rispondi">
      {canRecord ? (
        <div className="flex flex-wrap items-center gap-3">
          {recording ? (
            <Button type="button" variant="destructive" size="lg" onClick={recorder.stop}>
              <Square /> Ferma la registrazione
            </Button>
          ) : (
            <Button
              type="button"
              size="lg"
              onClick={() => {
                speaker.stop();
                void recorder.start();
              }}
              disabled={transcribing || recorder.state === 'requesting' || submit.isPending}
            >
              <Mic /> {draft ? 'Registra ancora (si aggiunge al testo)' : 'Rispondi a voce'}
            </Button>
          )}
          {recording && (
            <span className="flex items-center gap-2 text-sm tabular-nums" aria-live="polite">
              <span className="size-2.5 animate-pulse rounded-full bg-destructive" aria-hidden />
              Registrazione {clock(recorder.elapsed)} / {clock(MAX_RECORDING_SECONDS)}
            </span>
          )}
          {transcribing && (
            <span className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
              <Loader2 className="size-4 animate-spin" /> Trascrizione in corso…
            </span>
          )}
        </div>
      ) : (
        <p className="flex items-start gap-2 rounded-md bg-muted p-3 text-sm">
          <PenLine className="mt-0.5 size-4 shrink-0" />
          {recorder.state === 'unsupported'
            ? 'Questo browser non permette di registrare l’audio: rispondi per iscritto.'
            : 'Trascrizione vocale non attiva: rispondi per iscritto, oppure avvia il servizio locale con  docker compose --profile stt up -d  e ricarica la pagina.'}
        </p>
      )}
      {recorder.error && <p className="text-sm text-destructive">{recorder.error}</p>}

      <div className="grid gap-2">
        <Label htmlFor={`answer-${question.id}`}>
          {mode === 'audio' && draft
            ? 'Trascrizione: correggila se serve prima di inviarla'
            : 'Oppure scrivi la risposta'}
        </Label>
        <Textarea
          id={`answer-${question.id}`}
          rows={6}
          lang={session.language}
          value={draft}
          disabled={recording || transcribing}
          onChange={(e) => {
            setDraft(e.target.value);
            if (!duration) setMode('text');
          }}
          placeholder={canRecord ? 'La trascrizione della tua risposta comparirà qui' : 'Scrivi qui la tua risposta'}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={!draft.trim() || recording || transcribing || submit.isPending}
          onClick={() =>
            submit.mutate({ transcript: draft, inputMode: duration ? 'audio' : 'text', durationSec: duration })
          }
        >
          {submit.isPending && <Loader2 className="animate-spin" />}
          Invia per la valutazione
        </Button>
        {answer && (
          <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
            Annulla
          </Button>
        )}
      </div>
    </section>
  );
}

/** Colloquio simulato: una domanda alla volta, risposta a voce o scritta, valutazione di ogni risposta. */
export function InterviewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const client = useQueryClient();
  const { data: session, isPending, isError, error } = useInterview(id);
  const history = useInterviews(
    { jobId: session?.jobId ?? undefined, applicationId: session?.applicationId ?? undefined },
    !!session && (!!session.jobId || !!session.applicationId),
  );
  const again = useMutation({
    mutationFn: () => api.interviews.again(id!),
    onSuccess: (created) => {
      void client.invalidateQueries({ queryKey: ['interviews', 'list'] });
      setIndex(0);
      navigate(`/interviews/${created.id}`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const stt = useQuery({
    queryKey: ['interviews', 'speech-to-text'],
    queryFn: api.interviews.speechToText,
    refetchInterval: 30_000,
  });
  const speaker = useSpeaker();
  const [index, setIndex] = useState(0);
  const [showFocus, setShowFocus] = useState(false);
  /** quanti piccoli aiuti della domanda corrente sono stati scoperti */
  const [hintsShown, setHintsShown] = useState(0);
  const retry = useMutation({
    mutationFn: () => api.interviews.retry(id!),
    onSuccess: (updated) => client.setQueryData(keys.interview(id!), updated),
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (isPending) {
    return (
      <div className="grid gap-3 p-6">
        <Skeleton className="h-8 w-80" />
        <Skeleton className="h-40" />
      </div>
    );
  }
  if (isError || !session) {
    return (
      <div className="p-6">
        <p className="text-sm text-destructive">{errorMessage(error)}</p>
        <Button asChild variant="outline" size="sm" className="mt-3">
          <Link to="/interviews">Torna ai colloqui</Link>
        </Button>
      </div>
    );
  }

  const answers = new Map(session.answers.map((a) => [a.questionId, a]));
  const current = session.questions[Math.min(index, session.questions.length - 1)];
  const hints = current?.hints ?? [];
  const goTo = (i: number) => {
    speaker.stop();
    setShowFocus(false);
    setHintsShown(0);
    setIndex(i);
  };

  return (
    <div className="p-4 md:p-6">
      <header className="mb-4 grid gap-1">
        <Link to="/interviews" className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:underline">
          <ChevronLeft className="size-4" /> Colloqui
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="mr-auto text-xl font-semibold">Colloquio simulato · {session.jobTitle}</h1>
          <Button variant="outline" size="sm" onClick={() => again.mutate()} disabled={again.isPending}>
            {again.isPending ? <Loader2 className="animate-spin" /> : <Shuffle />} Nuovo tentativo con altre domande
          </Button>
        </div>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <span>{session.company}</span>
          <span>
            {session.mode === 'live' ? 'Conversazione' : 'Domande e risposte'} · tentativo {session.attempt}
            {history.data && history.data.length > 1 ? ` di ${history.data.length}` : ''}
          </span>
          <span>Lingua: {languageLabel(session.language)}</span>
          {session.status === 'ready' && (
            <span>
              Risposte: {session.answeredCount}/{session.questionCount}
            </span>
          )}
          {session.averageScore !== null && <span>Media: {session.averageScore}/5</span>}
          {session.overallScore !== null && <span>Valutazione: {session.overallScore}/5</span>}
          {session.jobId && (
            <Link to={`/?job=${session.jobId}`} className="hover:underline">
              Apri l’annuncio
            </Link>
          )}
          {session.applicationId && (
            <Link to={`/applications?open=${session.applicationId}`} className="hover:underline">
              Apri la candidatura
            </Link>
          )}
        </p>
        {history.data && history.data.length > 1 && (
          <nav aria-label="Tentativi precedenti" className="mt-2 flex flex-wrap items-center gap-1.5 text-sm">
            <span className="text-muted-foreground">Storico:</span>
            {[...history.data].reverse().map((h) => (
              <Button
                key={h.id}
                asChild
                variant={h.id === session.id ? 'secondary' : 'ghost'}
                size="sm"
                aria-current={h.id === session.id ? 'page' : undefined}
              >
                <Link to={`/interviews/${h.id}`} onClick={() => setIndex(0)}>
                  #{h.attempt}
                  {h.averageScore !== null ? ` · ${h.averageScore}/5` : ''}
                </Link>
              </Button>
            ))}
          </nav>
        )}
      </header>

      {session.status === 'generating' && (
        <div className="flex items-center gap-3 rounded-xl border p-6 text-sm" aria-live="polite">
          <Loader2 className="size-5 animate-spin" />
          <div>
            <p className="font-medium">Preparo le domande sull’annuncio…</p>
            <p className="text-muted-foreground">
              {session.provider} · {session.model}. Di solito basta meno di un minuto.
            </p>
          </div>
        </div>
      )}

      {session.status === 'failed' && (
        <Alert variant="warning">
          <XCircle />
          <AlertTitle>Domande non generate</AlertTitle>
          <AlertDescription>
            <p>{session.error}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-1 w-fit"
              onClick={() => retry.mutate()}
              disabled={retry.isPending}
            >
              <RefreshCw /> Riprova
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {session.status === 'ready' && session.mode === 'live' && (
        <div className="grid gap-4">
          {session.brief && session.transcript.length === 0 && <InterviewBriefCard brief={session.brief} />}
          <LiveInterview key={session.id} session={session} />
          {session.finishedAt && <InterviewReportCard session={session} />}
        </div>
      )}

      {session.status === 'ready' && session.mode === 'turns' && session.brief && session.answers.length === 0 && (
        <InterviewBriefCard brief={session.brief} />
      )}

      {session.status === 'ready' && session.mode === 'turns' && current && (
        <div className="grid gap-6 lg:grid-cols-[17rem_minmax(0,1fr)]">
          <nav aria-label="Domande" className="order-2 lg:order-1">
            <ol className="grid gap-1">
              {session.questions.map((q, i) => {
                const a = answers.get(q.id);
                return (
                  <li key={q.id}>
                    <button
                      type="button"
                      onClick={() => goTo(i)}
                      aria-current={q.id === current.id ? 'step' : undefined}
                      className={cn(
                        'flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted',
                        q.id === current.id && 'bg-accent text-accent-foreground',
                      )}
                    >
                      <span className="w-5 shrink-0 text-right tabular-nums text-muted-foreground">{i + 1}.</span>
                      <span className="line-clamp-2 min-w-0 flex-1" lang={session.language}>
                        {q.text}
                      </span>
                      {a?.status === 'ready' && a.feedback ? (
                        <span className="shrink-0 text-xs font-medium tabular-nums">{a.feedback.score}/5</span>
                      ) : a?.status === 'pending' ? (
                        <Loader2
                          className="size-4 shrink-0 animate-spin text-muted-foreground"
                          aria-label="In valutazione"
                        />
                      ) : a ? (
                        <CheckCircle2 className="size-4 shrink-0 text-muted-foreground" aria-label="Risposta data" />
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>

          <div className="order-1 grid content-start gap-4 lg:order-2">
            <section className="grid gap-3 rounded-xl border bg-card p-5" aria-label="Domanda">
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <span>
                  Domanda {index + 1} di {session.questions.length}
                </span>
                <Badge variant={current.kind === 'technical' ? 'default' : 'secondary'}>
                  {KIND_LABEL[current.kind]}
                </Badge>
              </div>
              <p className="text-lg leading-relaxed font-medium" lang={session.language}>
                {current.text}
              </p>
              <div className="flex flex-wrap gap-2">
                <ListenButton
                  id={`question-${current.id}`}
                  text={current.text}
                  language={session.language}
                  speaker={speaker}
                  label="Ascolta la domanda"
                />
                <Button type="button" variant="ghost" size="sm" onClick={() => setShowFocus((v) => !v)}>
                  <Lightbulb /> {showFocus ? 'Nascondi cosa vogliono sentire' : 'Cosa vogliono sentire?'}
                </Button>
                {hints.length > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={hintsShown >= hints.length}
                    onClick={() => setHintsShown((n) => n + 1)}
                  >
                    <LifeBuoy />{' '}
                    {hintsShown === 0
                      ? 'Dammi un aiuto'
                      : hintsShown < hints.length
                        ? 'Un altro aiuto'
                        : 'Aiuti finiti'}
                  </Button>
                )}
              </div>
              {hintsShown > 0 && (
                <ol className="grid gap-1.5 rounded-md border border-dashed p-3 text-sm" aria-label="Piccoli aiuti">
                  {hints.slice(0, hintsShown).map((hint, i) => (
                    <li key={hint} className="flex gap-2" lang={session.language}>
                      <span className="font-medium text-muted-foreground">{i + 1}.</span>
                      {hint}
                    </li>
                  ))}
                </ol>
              )}
              {showFocus && <p className="rounded-md bg-muted p-3 text-sm">{current.focus}</p>}
            </section>

            <AnswerPanel
              key={current.id}
              session={session}
              question={current}
              answer={answers.get(current.id)}
              speechToText={!!stt.data?.available}
              speaker={speaker}
            />

            <div className="flex justify-between gap-2">
              <Button variant="outline" disabled={index === 0} onClick={() => goTo(index - 1)}>
                <ArrowLeft /> Precedente
              </Button>
              <Button
                variant="outline"
                disabled={index >= session.questions.length - 1}
                onClick={() => goTo(index + 1)}
              >
                Successiva <ArrowRight />
              </Button>
            </div>

            <InterviewReportCard session={session} />
          </div>
        </div>
      )}
    </div>
  );
}
