export type SalaryPeriod = 'year' | 'month' | 'day' | 'hour';

export interface ParsedSalary {
  min?: number;
  max?: number;
  currency: string;
  period: SalaryPeriod;
  /** frammento originale da cui è stata estratta la retribuzione */
  rawText: string;
}

const PREFIX_CURRENCIES: Array<[RegExp, string]> = [
  [/^(?:US\$|USD)/i, 'USD'],
  [/^(?:CA\$|C\$|CAD)/i, 'CAD'],
  [/^(?:AU\$|A\$|AUD)/i, 'AUD'],
  [/^(?:R\$|BRL)/i, 'BRL'],
  [/^\$/, 'USD'],
  [/^(?:€|EUR)/i, 'EUR'],
  [/^(?:£|GBP)/i, 'GBP'],
  [/^(?:₹|INR)/i, 'INR'],
  [/^(?:¥|JPY)/i, 'JPY'],
  [/^(?:zł|PLN)/i, 'PLN'],
];
const CODES = 'USD|EUR|GBP|CHF|CAD|AUD|NZD|SGD|PLN|SEK|NOK|DKK|CZK|HUF|RON|INR|JPY|BRL|MXN|ZAR|ILS|AED';

const CUR_PRE = `(?:US\\$|CA\\$|C\\$|AU\\$|A\\$|R\\$|\\$|€|£|₹|¥|(?:${CODES})(?![A-Za-z])\\s?\\$?)`;
const CUR_POST = `(?:€|£|euros?(?![A-Za-z])|zł|(?:${CODES})(?![A-Za-z]))`;
const NUM = '\\d{1,3}(?:[.,]\\d{3})+(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d+)?';
const K = '(\\s?[kK](?![A-Za-z]))?';
const SEP = '\\s*(?:-|–|—|\\bto\\b|\\ba\\b|\\band\\b)\\s*';

/** "$120k - $150k", "€45.000–55.000", "USD 90,000", "$90 - $150 /hour" */
const RE_PREFIX = new RegExp(
  `(${CUR_PRE})\\s?(${NUM})${K}\\+?(?:${SEP}(?:${CUR_PRE})?\\s?(${NUM})${K})?(?:\\s?(${CODES})(?![A-Za-z]))?`,
  'g',
);
/** "45-55k EUR", "40.000 € lordi annui", "300 EUR/day" */
const RE_SUFFIX = new RegExp(`(?<![\\w.,$€£])(${NUM})${K}(?:${SEP}(${NUM})${K})?\\s?(${CUR_POST})`, 'gi');
/** "RAL 35-40k", "RAL: 40.000 - 50.000" (RAL è per definizione annua e, salvo indicazione, in euro) */
const RE_RAL = new RegExp(`\\bRAL\\b[^\\d\\n€$£]{0,30}(${NUM})${K}(?:${SEP}(${NUM})${K})?(?:\\s?(${CUR_POST}))?`, 'g');

const PERIOD_AFTER: Array<[SalaryPeriod, RegExp]> = [
  [
    'year',
    /\/\s?(?:yr|year|anno|annum|y)\b|\bper\s+(?:year|annum)\b|\ba\s+year\b|\bannual(?:ly)?\b|\byearly\b|\bp\.a\.|\bpa\b|\bannui\b|\ball['’]anno\b|\bRAL\b/i,
  ],
  ['month', /\/\s?(?:mo|month|mese|mth)\b|\bper\s+month\b|\ba\s+month\b|\bmonthly\b|\bal\s+mese\b|\bmensil[ei]\b/i],
  [
    'day',
    /\/\s?(?:day|d|giorno|gg)\b|\bper\s+day\b|\ba\s+day\b|\bdaily\b|\bper\s+diem\b|\bal\s+giorno\b|\bgiornalier[oai]\b/i,
  ],
  ['hour', /\/\s?(?:hr|hour|h|ora)\b|\bper\s+hour\b|\ban\s+hour\b|\bhourly\b|\ball['’]ora\b|\borari[oa]\b/i],
];
const PERIOD_BEFORE: Array<[SalaryPeriod, RegExp]> = [
  ['day', /\b(?:daily|day)\s+rate\b|\btariffa\s+giornaliera\b/i],
  ['hour', /\bhourly\s+rate\b|\btariffa\s+oraria\b/i],
  ['month', /\bmonthly\s+(?:salary|rate|pay)\b/i],
  ['year', /\b(?:annual|yearly|base)\s+(?:salary|compensation|pay)\b|\bRAL\b|\bOTE\b/i],
];

/** Cifre che non sono retribuzioni: finanziamenti, fatturato, bonus, benefit. */
const NOT_SALARY_BEFORE =
  /\b(?:raised|raising|funding|funded|revenue|arr|valuation|valued|series\s+[a-f]|seed|round|bonus|budget|stipend|allowance|grant|worth|over|processed|aum|saved?|customers|users)\b[^.\n]{0,25}$/i;
const NOT_SALARY_AFTER =
  /^\s*(?:\+\s*)?(?:m\b|mm\b|b\b|bn\b|million|billion|mln|mld|in\s+(?:funding|revenue|arr|sales|equity|bonus)|(?:signing|sign-on|annual|performance|referral|welcome)?\s*bonus|stipend|allowance|budget|funding|revenue|arr\b|seed|series)/i;
const UP_TO_BEFORE = /\b(?:up\s+to|fino\s+a|max\.?|maximum)\s*~?\s*$/i;

const LIMITS: Record<SalaryPeriod, [number, number]> = {
  year: [10_000, 2_000_000],
  month: [300, 60_000],
  day: [50, 5_000],
  hour: [5, 1_000],
};

function parseNum(raw: string, k: boolean): number {
  let value: number;
  if (/^\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?$/.test(raw)) {
    const withoutDecimals = raw.replace(/[.,]\d{1,2}$/, '');
    value = Number(withoutDecimals.replace(/[.,]/g, ''));
  } else {
    value = Number(raw.replace(',', '.'));
  }
  return k ? value * 1000 : value;
}

function prefixCurrency(token: string): string | undefined {
  const t = token.trim();
  const known = PREFIX_CURRENCIES.find(([re]) => re.test(t))?.[1];
  if (known) return known;
  const code = new RegExp(`^(${CODES})`, 'i').exec(t);
  return code ? (code[1] as string).toUpperCase() : undefined;
}

function suffixCurrency(token: string): string | undefined {
  const t = token.trim().toLowerCase();
  if (t === '€' || t.startsWith('euro')) return 'EUR';
  if (t === '£') return 'GBP';
  if (t === 'zł') return 'PLN';
  return t.length === 3 ? t.toUpperCase() : undefined;
}

interface Candidate {
  index: number;
  end: number;
  min: number;
  max?: number;
  currency: string;
  forcedPeriod?: SalaryPeriod;
}

function findPeriod(text: string, c: Candidate): { period?: SalaryPeriod; extraEnd: number } {
  // subito dopo la cifra, senza oltrepassare la fine della frase
  const after = text.slice(c.end, c.end + 45).split(/[\n;]|\.\s/)[0] ?? '';
  let best: { period: SalaryPeriod; idx: number; len: number } | undefined;
  for (const [period, re] of PERIOD_AFTER) {
    const m = re.exec(after);
    if (m && (!best || m.index < best.idx)) best = { period, idx: m.index, len: m[0].length };
  }
  if (best) return { period: best.period, extraEnd: best.idx + best.len };
  const before = text.slice(Math.max(0, c.index - 45), c.index);
  for (const [period, re] of PERIOD_BEFORE) {
    if (re.test(before)) return { period, extraEnd: 0 };
  }
  return { extraEnd: 0 };
}

function evaluate(text: string, c: Candidate): ParsedSalary | null {
  const before = text.slice(Math.max(0, c.index - 40), c.index);
  const after = text.slice(c.end, c.end + 30);
  if (NOT_SALARY_AFTER.test(after) || NOT_SALARY_BEFORE.test(before)) return null;

  const found = findPeriod(text, c);
  let period = c.forcedPeriod ?? found.period;
  const top = c.max ?? c.min;
  if (!period) {
    // senza periodo esplicito accettiamo solo cifre chiaramente annue: non si tira a indovinare
    if (c.min >= LIMITS.year[0]) period = 'year';
    else return null;
  }
  const [lo, hi] = LIMITS[period];
  if (c.min < lo || top > hi || (c.max !== undefined && c.max < c.min)) return null;

  const upTo = UP_TO_BEFORE.exec(before);
  const start = upTo ? c.index - upTo[0].length : c.index;
  const rawText = text
    .slice(start, c.end + found.extraEnd)
    .replace(/\s+/g, ' ')
    .trim();
  if (upTo && c.max === undefined) return { max: c.min, currency: c.currency, period, rawText };
  return { min: c.min, max: c.max ?? c.min, currency: c.currency, period, rawText };
}

function range(a: string, ak: boolean, b: string | undefined, bk: boolean): { min: number; max?: number } {
  let min = parseNum(a, ak);
  if (b === undefined) return { min };
  let max = parseNum(b, bk);
  // "45-55k" / "$200-260K": il moltiplicatore vale per entrambi gli estremi
  if (bk && !ak && min < 1000) min *= 1000;
  if (ak && !bk && max < 1000) max *= 1000;
  return { min, max };
}

function collect(text: string): Candidate[] {
  const out: Candidate[] = [];
  let m: RegExpExecArray | null;

  RE_PREFIX.lastIndex = 0;
  while ((m = RE_PREFIX.exec(text)) !== null) {
    const currency = (m[6] ? m[6].toUpperCase() : undefined) ?? prefixCurrency(m[1] as string);
    if (!currency) continue;
    out.push({ index: m.index, end: m.index + m[0].length, currency, ...range(m[2] as string, !!m[3], m[4], !!m[5]) });
  }
  RE_SUFFIX.lastIndex = 0;
  while ((m = RE_SUFFIX.exec(text)) !== null) {
    const currency = suffixCurrency(m[5] as string);
    if (!currency) continue;
    out.push({ index: m.index, end: m.index + m[0].length, currency, ...range(m[1] as string, !!m[2], m[3], !!m[4]) });
  }
  RE_RAL.lastIndex = 0;
  while ((m = RE_RAL.exec(text)) !== null) {
    const currency = (m[5] ? suffixCurrency(m[5]) : undefined) ?? 'EUR';
    out.push({
      index: m.index,
      end: m.index + m[0].length,
      currency,
      forcedPeriod: 'year',
      ...range(m[1] as string, !!m[2], m[3], !!m[4]),
    });
  }
  return out.sort((a, b) => a.index - b.index);
}

/**
 * Estrae la retribuzione dal testo di un annuncio. Restituisce `null` se non è scritta
 * in modo esplicito: la funzione non stima mai.
 */
export function parseSalary(text: string | null | undefined): ParsedSalary | null {
  if (!text) return null;
  for (const candidate of collect(text)) {
    const parsed = evaluate(text, candidate);
    if (parsed) return parsed;
  }
  return null;
}

const PERIOD_ALIASES: Record<string, SalaryPeriod> = {
  year: 'year',
  yearly: 'year',
  annual: 'year',
  annually: 'year',
  annum: 'year',
  month: 'month',
  monthly: 'month',
  day: 'day',
  daily: 'day',
  hour: 'hour',
  hourly: 'hour',
};

export function normalizePeriod(raw: string | null | undefined): SalaryPeriod | undefined {
  if (!raw) return undefined;
  return PERIOD_ALIASES[raw.trim().toLowerCase()];
}

const PERIOD_LABEL: Record<SalaryPeriod, string> = { year: 'year', month: 'month', day: 'day', hour: 'hour' };

/** Retribuzione da campi strutturati della fonte (non dal testo). */
export function salaryFromFields(fields: {
  min?: number | null;
  max?: number | null;
  currency?: string | null;
  period?: string | null;
}): ParsedSalary | null {
  const min = fields.min && fields.min > 0 ? fields.min : undefined;
  const max = fields.max && fields.max > 0 ? fields.max : undefined;
  const currency = fields.currency?.trim().toUpperCase();
  const period = normalizePeriod(fields.period);
  if ((min === undefined && max === undefined) || !currency || !period) return null;
  const fmt = (n: number) => n.toLocaleString('en-US');
  const amount =
    min !== undefined && max !== undefined && min !== max ? `${fmt(min)}–${fmt(max)}` : fmt((min ?? max) as number);
  return {
    min: min ?? max,
    max: max ?? min,
    currency,
    period,
    rawText: `${amount} ${currency}/${PERIOD_LABEL[period]}`,
  };
}

/**
 * Converte un importo nella valuta dell'utente con i tassi statici delle impostazioni
 * (`fx_rates_to_local`: 1 unità di valuta estera = N unità di valuta locale).
 * Restituisce `null` se il tasso non è configurato.
 */
export function convertToLocal(
  amount: number | undefined | null,
  currency: string | undefined | null,
  localCurrency: string,
  fxRates: Record<string, number>,
): number | null {
  if (amount === undefined || amount === null || !currency) return null;
  if (currency.toUpperCase() === localCurrency.toUpperCase()) return Math.round(amount);
  const rate = fxRates[currency.toUpperCase()];
  if (!rate || rate <= 0) return null;
  return Math.round(amount * rate);
}

/** Porta un importo a base annua o giornaliera per confrontarlo con le soglie minime. */
export function toYearly(amount: number, period: SalaryPeriod): number | null {
  if (period === 'year') return amount;
  if (period === 'month') return amount * 12;
  return null;
}

export function toDaily(amount: number, period: SalaryPeriod): number | null {
  if (period === 'day') return amount;
  if (period === 'hour') return amount * 8;
  return null;
}
