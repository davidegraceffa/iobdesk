import { getCountry } from './countries';

/** Offset UTC in ore (es. 1 per Europe/Rome in inverno, 5.5 per Asia/Kolkata). */
export function tzOffsetHours(timeZone: string, at: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round(((asUtc - at.getTime()) / 3_600_000) * 4) / 4;
}

export function isValidTimezone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Fuso dell'utente: quello esplicito se valido, altrimenti quello di default del paese. */
export function resolveTimezone(country: string | undefined, timezone?: string | null): string {
  if (timezone && isValidTimezone(timezone)) return timezone;
  return getCountry(country)?.timezone ?? 'UTC';
}

const NAMED_ZONES: Record<string, number[]> = {
  PST: [-8],
  PDT: [-8],
  MST: [-7],
  MDT: [-7],
  CST: [-6],
  CDT: [-6],
  EST: [-5],
  EDT: [-5],
  ET: [-5],
  GMT: [0],
  UTC: [0],
  BST: [0],
  WET: [0],
  CET: [1],
  CEST: [1],
  EET: [2],
  EEST: [2],
  AEST: [10],
  AEDT: [10],
  JST: [9],
  SGT: [8],
};

const AREA_ZONES: Array<[RegExp, number[]]> = [
  [
    /\b(?:US|U\.S\.|USA|North\s+American?|American)\s+(?:time\s?zones?|hours|business\s+hours|working\s+hours)/i,
    [-8, -7, -6, -5],
  ],
  [/\bEastern\s+(?:Standard\s+)?Time\b|\bEast\s+Coast\s+(?:time|hours)/i, [-5]],
  [/\bPacific\s+(?:Standard\s+)?Time\b|\bWest\s+Coast\s+(?:time|hours)/i, [-8]],
  [/\bCentral\s+(?:Standard\s+)?Time\b/i, [-6]],
  [/\bEuropean\s+(?:time\s?zones?|hours|business\s+hours|working\s+hours)/i, [0, 1, 2]],
  [/\b(?:APAC|Asian?)\s+(?:time\s?zones?|hours)/i, [5.5, 7, 8, 9]],
];

const CONTEXT_RE =
  /time\s?-?zones?|overlap|working\s+hours|business\s+hours|core\s+hours|hours\s+of|\bhours\b|fuso\s+orario/i;
const UTC_RE = /\b(?:UTC|GMT)\s?([+\-−–]\s?\d{1,2})(?::?(30|45))?/g;
const UTC_RANGE_RE =
  /\b(?:UTC|GMT)\s?([+\-−–]\s?\d{1,2})\s*(?:to|through|and|–|—|-|\/)\s*(?:UTC|GMT)\s?([+\-−–]\s?\d{1,2})/g;
const NAMED_RE = new RegExp(`\\b(${Object.keys(NAMED_ZONES).join('|')})\\b`, 'g');

function parseSigned(raw: string): number {
  return Number(raw.replace(/\s/g, '').replace(/[−–]/, '-'));
}

/**
 * Estrae dal testo gli offset UTC in cui l'annuncio chiede di lavorare o di avere overlap.
 * Considera solo le frasi che parlano esplicitamente di orari/fusi, per evitare falsi positivi
 * (es. "ET" o "CT" fuori contesto). Restituisce [] se l'annuncio non indica nulla.
 */
export function parseTimezoneRequirement(text: string | null | undefined): number[] {
  if (!text) return [];
  const offsets = new Set<number>();
  const sentences = text.split(/(?<=[.!?\n|])\s+|\n|\|/);
  for (const sentence of sentences) {
    if (!CONTEXT_RE.test(sentence)) continue;

    UTC_RANGE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = UTC_RANGE_RE.exec(sentence)) !== null) {
      const a = parseSigned(m[1] as string);
      const b = parseSigned(m[2] as string);
      if (Number.isNaN(a) || Number.isNaN(b) || Math.abs(a) > 14 || Math.abs(b) > 14) continue;
      for (let o = Math.min(a, b); o <= Math.max(a, b); o++) offsets.add(o);
    }
    UTC_RE.lastIndex = 0;
    while ((m = UTC_RE.exec(sentence)) !== null) {
      const base = parseSigned(m[1] as string);
      if (Number.isNaN(base) || Math.abs(base) > 14) continue;
      const frac = m[2] ? Number(m[2]) / 60 : 0;
      offsets.add(base < 0 ? base - frac : base + frac);
    }
    for (const [re, zones] of AREA_ZONES) {
      if (re.test(sentence)) zones.forEach((z) => offsets.add(z));
    }
    NAMED_RE.lastIndex = 0;
    while ((m = NAMED_RE.exec(sentence)) !== null) {
      const name = m[1] as string;
      // "UTC"/"GMT" seguiti da un offset sono già stati gestiti sopra
      if ((name === 'UTC' || name === 'GMT') && /^\s?[+\-−–]\s?\d/.test(sentence.slice(m.index + name.length)))
        continue;
      NAMED_ZONES[name]?.forEach((z) => offsets.add(z));
    }
  }
  return [...offsets].sort((a, b) => a - b);
}

/** Distanza minima in ore tra il fuso dell'utente e quelli richiesti dall'annuncio. */
export function timezoneDistance(userOffset: number, requiredOffsets: number[]): number | null {
  if (requiredOffsets.length === 0) return null;
  return Math.min(...requiredOffsets.map((o) => Math.abs(o - userOffset)));
}
