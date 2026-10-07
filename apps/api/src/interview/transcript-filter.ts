/** Un pezzo della trascrizione così come lo restituisce Whisper. */
export interface WhisperSegment {
  text?: string;
  avg_logprob?: number;
  no_speech_prob?: number;
}

/** Frasi che Whisper inventa sull'audio muto o sul rumore (titoli di coda dei video su cui è stato addestrato). */
const PHANTOM_PHRASES = [
  /sottotitoli (creati|e revisione|a cura)/,
  /amara\.org/,
  /\bqtss\b/,
  /subtitles? by/,
  /thanks? for watching/,
  /grazie (a tutti )?per (la visione|aver guardato)/,
  /sous-titres (réalisés|faits)/,
  /merci d'avoir regardé/,
  /untertitel (der|von|im auftrag)/,
  /subtítulos (realizados|por la comunidad)/,
  /legendas pela comunidade/,
  /ondertite(ld|ls|ling) (door|ingediend)/,
];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Testo dei soli pezzi in cui Whisper ha sentito davvero qualcuno parlare. */
export function spokenText(segments: WhisperSegment[]): string {
  return segments
    .filter((s) => !((s.no_speech_prob ?? 0) > 0.6 && (s.avg_logprob ?? 0) < -1))
    .map((s) => s.text ?? '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * La trascrizione è un "fantasma"? Sull'audio quasi muto Whisper ripete un pezzo del suggerimento che gli
 * viene passato (titolo dell'annuncio, tecnologie) oppure una frase fatta: non è ciò che ha detto il candidato.
 */
export function isPhantomTranscript(text: string, hint = ''): boolean {
  const words = normalize(text);
  if (!words) return true;
  const count = words.split(' ').length;
  if (count <= 12 && PHANTOM_PHRASES.some((phrase) => phrase.test(text.toLowerCase()))) return true;
  // eco del suggerimento: poche parole che compaiono tali e quali, di seguito, nel suggerimento
  return count <= 6 && ` ${normalize(hint)} `.includes(` ${words} `);
}
