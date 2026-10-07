import type { InterviewSessionDto } from '@jobagg/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ear, Loader2, Mic, PhoneOff, Play, RotateCcw, Send, Volume2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/api';
import { playCue } from '@/lib/cues';
import { errorMessage, keys } from '@/lib/queries';
import { speakOnce, speakStream, speechSupported, stopSpeaking } from '@/lib/speech';
import { useVoiceTurn, voiceTurnSupported } from '@/lib/useVoiceTurn';
import { cn } from '@/lib/utils';

type Phase = 'idle' | 'speaking' | 'listening' | 'thinking';

const KIND_LABEL: Record<string, string> = {
  follow_up: 'Contro-domanda',
  clarify: 'Chiarimento',
  hint: 'Suggerimento',
  closing: 'Chiusura',
};

/**
 * Conversazione a voce con l'intervistatore: lui parla (sintesi vocale del browser), tu rispondi al microfono,
 * la risposta viene trascritta in locale a pezzi mentre parli, e la replica arriva dal modello rapido.
 * A mani libere il turno si chiude da solo dopo un paio di secondi di silenzio.
 */
export function LiveInterview({ session }: { session: InterviewSessionDto }) {
  const client = useQueryClient();
  const stt = useQuery({ queryKey: ['interviews', 'speech-to-text'], queryFn: api.interviews.speechToText });
  // una volta vista attiva, la trascrizione resta buona per tutta la conversazione: il controllo periodico può
  // fallire mentre Whisper è occupato a trascrivere, e a quel punto il microfono non ripartiva più
  const sttSeen = useRef(false);
  if (stt.data?.available) sttSeen.current = true;
  const canListen = sttSeen.current && voiceTurnSupported;
  const [phase, setPhase] = useState<Phase>('idle');
  const [handsFree, setHandsFree] = useState(true);
  const [interim, setInterim] = useState<string[]>([]);
  /** replica dell'intervistatore mentre sta arrivando, prima che entri nella trascrizione */
  const [reply, setReply] = useState('');
  const [typed, setTyped] = useState('');
  const pending = useRef<Array<Promise<string>>>([]);
  const seconds = useRef(0);
  const bottom = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  const finished = !!session.finishedAt;
  const started = session.transcript.length > 0;

  const update = useCallback(
    (next: InterviewSessionDto) => {
      client.setQueryData(keys.interview(session.id), next);
      return next;
    },
    [client, session.id],
  );

  /** L'intervistatore ha finito di parlare: se il colloquio continua si torna ad ascoltare. */
  const afterSpeaking = useCallback(
    (current: InterviewSessionDto, listen: () => void) => {
      if (!alive.current) return;
      if (current.finishedAt) {
        setPhase('idle');
        void client.invalidateQueries({ queryKey: ['interviews', 'list'] });
      } else listen();
    },
    [client],
  );

  /** L'intervistatore dice la sua ultima battuta; poi, se il colloquio continua, si torna ad ascoltare. */
  const sayThenListen = useCallback(
    async (current: InterviewSessionDto, listen: () => void) => {
      const line = [...current.transcript].reverse().find((t) => t.role === 'interviewer');
      setPhase('speaking');
      if (line) await speakOnce(line.text, current.language);
      afterSpeaking(current, listen);
    },
    [afterSpeaking],
  );

  /** Invia la risposta: la replica arriva a pezzi e l'intervistatore inizia a parlare mentre viene ancora scritta. */
  const submit = useCallback(
    async (text: string, durationSec: number | undefined, listen: () => void) => {
      setPhase('thinking');
      const speech = speakStream(session.language);
      let spoken = '';
      try {
        const next = update(
          await api.interviews.liveTurnStream(session.id, { text, durationSec }, (delta) => {
            if (!alive.current) return;
            if (!spoken) setPhase('speaking');
            spoken += delta;
            setReply(spoken);
            speech.push(delta);
          }),
        );
        setInterim([]);
        setReply('');
        setPhase('speaking');
        const squeeze = (s: string) => s.replace(/\s+/g, ' ').trim();
        const line = squeeze([...next.transcript].reverse().find((t) => t.role === 'interviewer')?.text ?? '');
        if (line.startsWith(squeeze(spoken))) {
          // il resto della battuta (tutta, se il modello non l'ha mandata a pezzi)
          speech.push(line.slice(squeeze(spoken).length));
          await speech.end();
        } else {
          // la battuta definitiva è diversa da quella anticipata (il modello ha dovuto riprovare)
          await speakOnce(line, next.language);
        }
        afterSpeaking(next, listen);
      } catch (error) {
        stopSpeaking();
        toast.error(errorMessage(error));
        setInterim([]);
        setReply('');
        if (alive.current) listen();
      }
    },
    [afterSpeaking, session.id, session.language, update],
  );

  const voice = useVoiceTurn(
    {
      onSegment: (audio, secs) => {
        seconds.current += secs;
        const index = pending.current.length;
        pending.current.push(
          api.interviews
            .transcribe(audio, session.language, session.id)
            .then(({ text }) => {
              // la trascrizione compare man mano, mentre stai ancora parlando
              setInterim((previous) => {
                const copy = [...previous];
                copy[index] = text;
                return copy;
              });
              return text;
            })
            .catch(() => ''),
        );
      },
      onTurnEnd: () => {
        const parts = pending.current;
        const spoken = seconds.current;
        pending.current = [];
        seconds.current = 0;
        setPhase('thinking');
        playCue('done');
        void Promise.all(parts).then((texts) => {
          if (!alive.current) return;
          const text = texts.filter(Boolean).join(' ').trim();
          if (!text) {
            toast.warning('Non ho sentito nulla: riprova, oppure scrivi la risposta');
            setInterim([]);
            listen();
            return;
          }
          void submit(text, spoken, listen);
        });
      },
    },
    handsFree,
  );

  const listen = useCallback(() => {
    setPhase('listening');
    if (sttSeen.current && voiceTurnSupported) {
      playCue('listen');
      void voice.begin();
    }
  }, [voice]);

  const start = async () => {
    try {
      const current = started ? session : update(await api.interviews.liveStart(session.id));
      await sayThenListen(current, listen);
    } catch (error) {
      toast.error(errorMessage(error));
      setPhase('idle');
    }
  };

  const sendTyped = () => {
    const text = typed.trim();
    if (!text) return;
    voice.cancel();
    pending.current = [];
    seconds.current = 0;
    setTyped('');
    setInterim([text]);
    void submit(text, undefined, listen);
  };

  const hangUp = async () => {
    voice.cancel();
    stopSpeaking();
    setPhase('idle');
    try {
      update(await api.interviews.finish(session.id));
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      stopSpeaking();
    };
  }, []);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [session.transcript.length, interim, reply, phase]);

  const interimText = interim.filter(Boolean).join(' ');
  const inProgress = phase !== 'idle';

  return (
    <section className="grid gap-4 rounded-xl border p-4 md:p-5" aria-label="Conversazione">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto flex items-center gap-2 text-sm font-medium" aria-live="polite">
          {phase === 'speaking' && (
            <>
              <Volume2 className="size-4" /> L’intervistatore sta parlando
            </>
          )}
          {phase === 'listening' && (
            <>
              <Ear className="size-4" />
              {canListen ? (voice.voiced ? 'Ti ascolto…' : 'Tocca a te: parla pure') : 'Tocca a te: scrivi la risposta'}
            </>
          )}
          {phase === 'thinking' && (
            <>
              <Loader2 className="size-4 animate-spin" /> Un momento…
            </>
          )}
          {phase === 'idle' &&
            (finished
              ? 'Colloquio concluso'
              : started
                ? 'Conversazione in pausa'
                : 'L’intervistatore ti saluta e fa la prima domanda')}
        </div>
        {canListen && !finished && (
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Switch checked={handsFree} onCheckedChange={setHandsFree} />
            Mani libere
          </label>
        )}
      </div>

      {(started || interimText || reply) && (
        <div className="grid max-h-[26rem] gap-3 overflow-y-auto rounded-lg bg-muted/40 p-3" role="log">
          {session.transcript.map((turn) => (
            <div
              key={turn.id}
              className={cn(
                'max-w-[85%] rounded-xl px-3 py-2 text-sm',
                turn.role === 'interviewer' ? 'justify-self-start border bg-card' : 'justify-self-end bg-accent',
              )}
            >
              {turn.role === 'interviewer' && KIND_LABEL[turn.kind] && (
                <Badge variant="muted" className="mb-1">
                  {KIND_LABEL[turn.kind]}
                </Badge>
              )}
              <p lang={session.language}>{turn.text}</p>
            </div>
          ))}
          {interimText && (
            <div className="max-w-[85%] justify-self-end rounded-xl bg-accent/60 px-3 py-2 text-sm italic">
              <p lang={session.language}>{interimText}…</p>
            </div>
          )}
          {reply && (
            <div className="max-w-[85%] justify-self-start rounded-xl border bg-card px-3 py-2 text-sm">
              <p lang={session.language}>{reply}</p>
            </div>
          )}
          <div ref={bottom} />
        </div>
      )}

      {phase === 'listening' && canListen && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-2 text-sm">
            <Mic className={cn('size-4', voice.voiced && 'text-destructive')} />
            <span className="h-2 w-28 overflow-hidden rounded-full bg-muted" aria-hidden>
              <span
                className="block h-full rounded-full bg-primary transition-[width] duration-100"
                style={{ width: `${Math.round(voice.level * 100)}%` }}
              />
            </span>
          </span>
          <Button type="button" onClick={voice.end}>
            Ho finito di rispondere
          </Button>
          <span className="text-xs text-muted-foreground">
            {handsFree ? 'Oppure resta in silenzio un paio di secondi.' : 'Prenditi il tempo che serve per pensare.'}
          </span>
        </div>
      )}
      {voice.error && <p className="text-sm text-destructive">{voice.error}</p>}

      {!finished && (
        <div className="flex flex-wrap items-center gap-2">
          {!inProgress && (
            <Button type="button" size="lg" onClick={() => void start()}>
              <Play /> {started ? 'Riprendi la conversazione' : 'Inizia il colloquio'}
            </Button>
          )}
          {phase === 'listening' && (
            <form
              className="flex min-w-0 flex-1 gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                sendTyped();
              }}
            >
              <Input
                value={typed}
                lang={session.language}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={canListen ? 'Oppure scrivi la risposta' : 'Scrivi la tua risposta'}
                aria-label="Risposta scritta"
              />
              <Button type="submit" variant="outline" disabled={!typed.trim()}>
                <Send /> Invia
              </Button>
            </form>
          )}
          {phase === 'listening' && speechSupported && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                voice.cancel();
                pending.current = [];
                seconds.current = 0;
                setInterim([]);
                void sayThenListen(session, listen);
              }}
            >
              <RotateCcw /> Ripeti
            </Button>
          )}
          {started && (
            <Button type="button" variant="outline" className="ml-auto" onClick={() => void hangUp()}>
              <PhoneOff /> Termina e valuta
            </Button>
          )}
        </div>
      )}

      {!started && (
        <p className="text-xs text-muted-foreground">
          {canListen
            ? 'Usa le cuffie se puoi: così il microfono non riprende la voce dell’intervistatore. Il browser chiederà il permesso di usare il microfono.'
            : stt.isPending
              ? ''
              : 'Trascrizione vocale non attiva (docker compose --profile stt up -d): puoi comunque fare la conversazione scrivendo le risposte.'}
        </p>
      )}
    </section>
  );
}
