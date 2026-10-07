import type { ContractType, Seniority } from '@jobagg/shared';

export function asString(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  return '';
}

export function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(asString).filter(Boolean);
  const s = asString(value);
  return s ? [s] : [];
}

export function asNumber(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

export function asDate(value: unknown): Date | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  // epoch in secondi o millisecondi
  if (typeof value === 'number') return new Date(value < 1e12 ? value * 1000 : value);
  if (typeof value === 'string') {
    // date senza fuso (Remotive: "2026-09-21T12:55:11") vanno lette come UTC
    const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value) ? `${value}Z` : value;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  return undefined;
}

/** "full_time", "Full-Time", "Full Time", "Contractor"… → tipo di contratto normalizzato. */
export function mapContract(raw: string | undefined): ContractType | undefined {
  const s = (raw ?? '').toLowerCase().replace(/[_-]+/g, ' ').trim();
  if (!s) return undefined;
  if (/freelanc/.test(s)) return 'freelance';
  if (/contract/.test(s)) return 'contract';
  if (/part time/.test(s)) return 'part-time';
  if (/full time|permanent|vollzeit/.test(s)) return 'full-time';
  return undefined;
}

/** "Senior", "Midweight", "Entry-Level, Junior", "Mid-level", "Intern"… → seniority normalizzata. */
export function mapSeniority(raw: string | undefined): Seniority | undefined {
  const s = (raw ?? '').toLowerCase();
  if (!s || s === 'any') return undefined;
  if (/intern|working student|werkstudent|trainee/.test(s)) return 'intern';
  if (/junior|entry/.test(s)) return 'junior';
  if (/lead|principal|staff|director|executive|manager|head/.test(s)) return 'lead';
  if (/senior/.test(s)) return 'senior';
  if (/mid/.test(s)) return 'mid';
  return undefined;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  euro: '€',
  pound: '£',
  trade: '™',
  reg: '®',
  copy: '©',
  middot: '·',
  bull: '•',
};

/** Decodifica le entità HTML più comuni (nominali, decimali, esadecimali). */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === '#') {
      const n = code[1]?.toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x10ffff ? String.fromCodePoint(n) : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

/**
 * Ripara il testo UTF-8 letto come Latin-1 ("MecÃ¡nico" → "Mecánico"), che alcune fonti
 * restituiscono già danneggiato. Interviene solo se trova le sequenze tipiche.
 */
export function fixMojibake(text: string): string {
  if (!/[ÃÂâ][\u0080-\u00bf]/.test(text)) return text;
  try {
    const bytes = Uint8Array.from([...text].map((ch) => ch.charCodeAt(0)));
    if ([...text].some((ch) => ch.charCodeAt(0) > 0xff)) return text;
    const fixed = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return fixed;
  } catch {
    return text;
  }
}
