import { useCallback, useEffect, useRef, useState } from 'react';

/** Durata massima di una risposta registrata. */
export const MAX_RECORDING_SECONDS = 5 * 60;

export type RecorderState = 'idle' | 'requesting' | 'recording' | 'unsupported';

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  // Chrome e Firefox registrano in WebM/Opus, Safari in MP4/AAC
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find((t) =>
    MediaRecorder.isTypeSupported(t),
  );
}

/**
 * Registrazione dal microfono con MediaRecorder. L'audio resta in memoria nel browser finché non viene
 * inviato per la trascrizione; il microfono viene rilasciato appena la registrazione finisce.
 */
export function useAudioRecorder(onComplete: (audio: Blob, durationSec: number) => void) {
  const supported = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && !!pickMimeType();
  const [state, setState] = useState<RecorderState>(supported ? 'idle' : 'unsupported');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<number | null>(null);
  const startedAt = useRef(0);
  const callback = useRef(onComplete);
  callback.current = onComplete;

  const release = useCallback(() => {
    if (timer.current !== null) window.clearInterval(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }, []);

  const stop = useCallback(() => {
    if (recorder.current && recorder.current.state !== 'inactive') recorder.current.stop();
  }, []);

  const start = useCallback(async () => {
    if (!supported || state === 'recording' || state === 'requesting') return;
    setError(null);
    setState('requesting');
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch (err) {
      setState('idle');
      setError(
        (err as DOMException)?.name === 'NotAllowedError'
          ? 'Accesso al microfono negato: consentilo dalle impostazioni del browser per questo sito.'
          : 'Microfono non disponibile.',
      );
      return;
    }
    const mimeType = pickMimeType();
    const chunks: Blob[] = [];
    const rec = new MediaRecorder(stream.current, mimeType ? { mimeType, audioBitsPerSecond: 64_000 } : undefined);
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    rec.onstop = () => {
      const durationSec = Math.round((Date.now() - startedAt.current) / 1000);
      release();
      setState('idle');
      setElapsed(0);
      const audio = new Blob(chunks, { type: rec.mimeType || mimeType || 'audio/webm' });
      if (audio.size > 0) callback.current(audio, durationSec);
    };
    recorder.current = rec;
    startedAt.current = Date.now();
    setElapsed(0);
    rec.start(1000);
    setState('recording');
    timer.current = window.setInterval(() => {
      const seconds = Math.floor((Date.now() - startedAt.current) / 1000);
      setElapsed(seconds);
      if (seconds >= MAX_RECORDING_SECONDS) stop();
    }, 250);
  }, [release, state, stop, supported]);

  // uscendo dalla pagina il microfono va rilasciato
  useEffect(
    () => () => {
      if (recorder.current && recorder.current.state !== 'inactive') {
        recorder.current.onstop = null;
        recorder.current.stop();
      }
      release();
    },
    [release],
  );

  return { state, elapsed, error, start, stop };
}
