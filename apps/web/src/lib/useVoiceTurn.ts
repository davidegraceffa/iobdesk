import { useCallback, useEffect, useRef, useState } from 'react';

/** Volume (RMS, 0-1) oltre il quale si considera che qualcuno stia parlando. */
const VOICE_THRESHOLD = 0.018;
/** Silenzio dopo il quale, a mani libere, la risposta si considera finita. */
const END_OF_TURN_MS = 2200;
/** Pausa breve su cui si può tagliare un pezzo da trascrivere subito, mentre si continua a parlare. */
const SEGMENT_PAUSE_MS = 550;
const MIN_SEGMENT_MS = 4000;
/**
 * Oltre questa durata il pezzo si taglia anche su una pausa minima: Whisper rallenta molto sui pezzi lunghi
 * (misurato: 4 s per 22 s di audio, oltre un minuto per 52 s) e a fine risposta deve restare poco da trascrivere.
 */
const LONG_SEGMENT_MS = 10_000;
const LONG_SEGMENT_PAUSE_MS = 280;
const MAX_TURN_MS = 4 * 60_000;
const TICK_MS = 80;
/** Campioni sopra soglia (quasi consecutivi) per considerarla voce: un colpo, un clic o un respiro non bastano. */
const VOICE_CONFIRM_TICKS = 3;
/** Subito dopo che l'intervistatore ha finito, la coda della sua voce nelle casse non va scambiata per la risposta. */
const SETTLE_MS = 400;

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find((t) =>
    MediaRecorder.isTypeSupported(t),
  );
}

export const voiceTurnSupported =
  typeof navigator !== 'undefined' &&
  !!navigator.mediaDevices?.getUserMedia &&
  typeof AudioContext !== 'undefined' &&
  !!pickMimeType();

interface Handlers {
  /** un pezzo di risposta pronto da trascrivere (i pezzi arrivano in ordine) */
  onSegment: (audio: Blob, seconds: number) => void;
  /** la risposta è finita: per silenzio (a mani libere) o perché l'utente l'ha chiusa */
  onTurnEnd: () => void;
}

/**
 * Ascolto di una risposta a voce in una conversazione: tiene aperto il microfono tra un turno e l'altro,
 * rileva quando si parla e quando si tace, e spezza l'audio sulle pause così la trascrizione procede
 * mentre si sta ancora parlando. L'audio resta nel browser finché non viene inviato per la trascrizione.
 */
export function useVoiceTurn(handlers: Handlers, handsFree: boolean) {
  const [listening, setListening] = useState(false);
  const [voiced, setVoiced] = useState(false);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const stream = useRef<MediaStream | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<number | null>(null);
  const state = useRef({
    turnStart: 0,
    segmentStart: 0,
    lastVoice: 0,
    loudTicks: 0,
    segmentHasSpeech: false,
    turnHasSpeech: false,
  });
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const handsFreeRef = useRef(handsFree);
  handsFreeRef.current = handsFree;

  const ensureStream = useCallback(async () => {
    if (stream.current) return;
    stream.current = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    audioContext.current = new AudioContext();
    analyser.current = audioContext.current.createAnalyser();
    analyser.current.fftSize = 1024;
    audioContext.current.createMediaStreamSource(stream.current).connect(analyser.current);
  }, []);

  /** Ferma il registratore corrente; se `emit`, il pezzo registrato viene consegnato (solo se contiene voce). */
  const stopRecorder = useCallback((emit: boolean, after?: () => void) => {
    const rec = recorder.current;
    recorder.current = null;
    if (!rec || rec.state === 'inactive') {
      after?.();
      return;
    }
    const { segmentStart, lastVoice, segmentHasSpeech } = state.current;
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    rec.onstop = () => {
      if (emit && segmentHasSpeech && chunks.length > 0) {
        const seconds = Math.max(1, Math.round((lastVoice - segmentStart) / 1000) + 1);
        handlersRef.current.onSegment(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }), seconds);
      }
      after?.();
    };
    rec.stop();
  }, []);

  const startRecorder = useCallback(() => {
    if (!stream.current) return;
    const mimeType = pickMimeType();
    const rec = new MediaRecorder(stream.current, mimeType ? { mimeType, audioBitsPerSecond: 48_000 } : undefined);
    recorder.current = rec;
    state.current.segmentStart = Date.now();
    state.current.segmentHasSpeech = false;
    rec.start();
  }, []);

  const clearTimer = useCallback(() => {
    if (timer.current !== null) window.clearInterval(timer.current);
    timer.current = null;
  }, []);

  /** Chiude il turno: consegna l'ultimo pezzo e poi segnala la fine. */
  const end = useCallback(() => {
    if (timer.current === null) return;
    clearTimer();
    setListening(false);
    setVoiced(false);
    setLevel(0);
    stopRecorder(true, () => handlersRef.current.onTurnEnd());
  }, [clearTimer, stopRecorder]);

  /** Smette di ascoltare senza consegnare nulla (es. l'utente ha scritto la risposta). */
  const cancel = useCallback(() => {
    clearTimer();
    setListening(false);
    setVoiced(false);
    setLevel(0);
    stopRecorder(false);
  }, [clearTimer, stopRecorder]);

  const begin = useCallback(async () => {
    if (timer.current !== null) return;
    setError(null);
    try {
      await ensureStream();
      await audioContext.current?.resume();
    } catch (err) {
      setError(
        (err as DOMException)?.name === 'NotAllowedError'
          ? 'Accesso al microfono negato: consentilo dalle impostazioni del browser per questo sito.'
          : 'Microfono non disponibile.',
      );
      return;
    }
    const now = Date.now();
    state.current = {
      turnStart: now,
      segmentStart: now,
      lastVoice: now,
      loudTicks: 0,
      segmentHasSpeech: false,
      turnHasSpeech: false,
    };
    startRecorder();
    setListening(true);
    const samples = new Float32Array(analyser.current!.fftSize);
    let ticks = 0;
    timer.current = window.setInterval(() => {
      const node = analyser.current;
      if (!node) return;
      node.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const v of samples) sum += v * v;
      const rms = Math.sqrt(sum / samples.length);
      const t = Date.now();
      const s = state.current;
      const loud = rms > VOICE_THRESHOLD && t - s.turnStart > SETTLE_MS;
      s.loudTicks = loud ? Math.min(VOICE_CONFIRM_TICKS, s.loudTicks + 1) : Math.max(0, s.loudTicks - 1);
      if (loud && s.loudTicks >= VOICE_CONFIRM_TICKS) {
        // voce vera: un rumore isolato non fa partire il conto del silenzio di fine risposta
        s.lastVoice = t;
        s.segmentHasSpeech = true;
        s.turnHasSpeech = true;
      }
      if (++ticks % 2 === 0) {
        setLevel(Math.min(1, rms * 8));
        setVoiced(t - s.lastVoice < 400 && s.turnHasSpeech);
      }
      const silence = t - s.lastVoice;
      if (t - s.turnStart > MAX_TURN_MS || (handsFreeRef.current && s.turnHasSpeech && silence > END_OF_TURN_MS)) {
        end();
      } else if (
        s.segmentHasSpeech &&
        t - s.segmentStart > MIN_SEGMENT_MS &&
        silence > (t - s.segmentStart > LONG_SEGMENT_MS ? LONG_SEGMENT_PAUSE_MS : SEGMENT_PAUSE_MS)
      ) {
        // pausa naturale: il pezzo fin qui va subito in trascrizione, la registrazione riparte
        stopRecorder(true);
        startRecorder();
      }
    }, TICK_MS);
  }, [end, ensureStream, startRecorder, stopRecorder]);

  // uscendo dalla pagina il microfono va rilasciato
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearInterval(timer.current);
      if (recorder.current && recorder.current.state !== 'inactive') {
        recorder.current.onstop = null;
        recorder.current.stop();
      }
      stream.current?.getTracks().forEach((track) => track.stop());
      void audioContext.current?.close();
    },
    [],
  );

  return { listening, voiced, level, error, begin, end, cancel };
}
