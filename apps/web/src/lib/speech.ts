import { useEffect, useState } from 'react';
import { api } from './api';

const LOCALES: Record<string, string> = {
  it: 'it-IT',
  en: 'en-US',
  es: 'es-ES',
  de: 'de-DE',
  fr: 'fr-FR',
  pt: 'pt-PT',
  nl: 'nl-NL',
};

export const speechSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

/** Voce del sistema per la lingua indicata, preferendo quelle locali (nessuna rete). */
function voiceFor(language: string): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith(language));
  return voices.find((v) => v.localService) ?? voices[0];
}

const NEURAL_CHECK_TTL_MS = 30_000;
let neural: { at: number; languages: Promise<string[]> } | null = null;

/** Lingue per cui è attiva la voce neurale locale (Piper); nessuna se il servizio non è avviato. */
function neuralLanguages(): Promise<string[]> {
  if (!neural || Date.now() - neural.at > NEURAL_CHECK_TTL_MS) {
    neural = {
      at: Date.now(),
      languages: api.interviews
        .textToSpeech()
        .then((r) => r.languages)
        .catch(() => []),
    };
  }
  return neural.languages;
}

/** Ogni nuova lettura (o uno stop) invalida quelle in corso. */
let generation = 0;
let player: HTMLAudioElement | null = null;
let finishClip: (() => void) | null = null;

function playClip(clip: Blob): Promise<void> {
  return new Promise((resolve, reject) => {
    player ??= new Audio();
    const audio = player;
    const url = URL.createObjectURL(clip);
    const cleanup = () => {
      finishClip = null;
      audio.onended = null;
      audio.onerror = null;
      URL.revokeObjectURL(url);
    };
    finishClip = () => {
      cleanup();
      resolve();
    };
    audio.onended = finishClip;
    audio.onerror = () => {
      cleanup();
      reject(new Error('audio'));
    };
    audio.src = url;
    audio.play().catch(() => {
      cleanup();
      reject(new Error('audio'));
    });
  });
}

function speakWithBrowser(text: string, language: string): Promise<void> {
  if (!speechSupported) return Promise.resolve();
  return new Promise((resolve) => {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = LOCALES[language] ?? language;
    const voice = voiceFor(language);
    if (voice) utterance.voice = voice;
    utterance.rate = 1;
    // alcuni browser non emettono "end" se la sintesi si blocca: non restare in attesa per sempre
    const guard = window.setTimeout(resolve, Math.max(8000, text.length * 120));
    const done = () => {
      window.clearTimeout(guard);
      resolve();
    };
    utterance.onend = done;
    utterance.onerror = done;
    window.speechSynthesis.speak(utterance);
  });
}

/** Una frase va in sintesi appena è completa, purché non sia troppo corta per suonare naturale da sola. */
const MIN_CHUNK_CHARS = 30;

export interface SpeechStream {
  /** altro testo della battuta, man mano che arriva */
  push(text: string): void;
  /** il testo è finito: si risolve quando è stato pronunciato tutto (o subito, se viene interrotto) */
  end(): Promise<void>;
}

/**
 * Pronuncia un testo che arriva a pezzi: ogni frase parte appena è completa, e le successive vengono generate
 * mentre la prima sta già suonando. Usa la voce neurale locale se è attiva per la lingua, altrimenti (o se
 * cede) la sintesi vocale del browser.
 */
export function speakStream(language: string): SpeechStream {
  stopSpeaking();
  const turn = generation;
  let buffer = '';
  let synthesis: Promise<unknown> = Promise.resolve();
  let playback: Promise<void> = Promise.resolve();

  const say = (part: string) => {
    // una richiesta di sintesi alla volta, in ordine
    const clip = synthesis.then(async () => {
      if (turn !== generation || !(await neuralLanguages()).includes(language)) return null;
      return api.interviews.speak(part, language);
    });
    synthesis = clip.catch(() => undefined);
    playback = playback.then(async () => {
      if (turn !== generation) return;
      try {
        const audio = await clip;
        if (turn !== generation) return;
        if (audio) {
          await playClip(audio);
          return;
        }
      } catch {
        neural = null;
      }
      if (turn === generation) await speakWithBrowser(part, language);
    });
  };

  const drain = () => {
    for (;;) {
      const boundary = /[.!?…]+\s+/g;
      let cut = -1;
      for (let match = boundary.exec(buffer); match; match = boundary.exec(buffer)) {
        if (match.index + match[0].length >= MIN_CHUNK_CHARS) {
          cut = match.index + match[0].length;
          break;
        }
      }
      if (cut === -1) return;
      say(buffer.slice(0, cut).trim());
      buffer = buffer.slice(cut);
    }
  };

  return {
    push(text) {
      buffer += text;
      drain();
    },
    end() {
      const rest = buffer.trim();
      buffer = '';
      if (rest) say(rest);
      return playback;
    },
  };
}

/**
 * Pronuncia un testo e si risolve quando ha finito (o subito, se la sintesi vocale non c'è o viene interrotta).
 * Serve alla conversazione: l'ascolto riparte solo quando l'intervistatore ha smesso di parlare.
 */
export function speakOnce(text: string, language: string): Promise<void> {
  const stream = speakStream(language);
  stream.push(text);
  return stream.end();
}

export function stopSpeaking(): void {
  generation++;
  if (player) player.pause();
  finishClip?.();
  if (speechSupported) window.speechSynthesis.cancel();
}

/** Lettura ad alta voce (voce neurale locale, oppure sintesi vocale del browser): un solo testo alla volta. */
export function useSpeaker() {
  const [speakingId, setSpeakingId] = useState<string | null>(null);

  useEffect(() => () => stopSpeaking(), []);

  const speak = (id: string, text: string, language: string) => {
    if (speakingId === id) {
      stopSpeaking();
      setSpeakingId(null);
      return;
    }
    setSpeakingId(id);
    void speakOnce(text, language).then(() => setSpeakingId((current) => (current === id ? null : current)));
  };

  const stop = () => {
    stopSpeaking();
    setSpeakingId(null);
  };

  return { speakingId, speak, stop, supported: true };
}
