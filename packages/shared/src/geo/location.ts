import { COUNTRIES, COUNTRY_ALIASES, US_STATE_SUFFIX } from './countries';
import { REGIONS, WORLDWIDE, countryInRegion, getRegion } from './regions';

/** Vincolo geografico normalizzato di un annuncio. */
export interface LocationSpec {
  /** token di regione normalizzati (incluso "worldwide") */
  regions: string[];
  /** codici ISO dei paesi a cui l'annuncio è limitato */
  countries: string[];
}

interface Alias {
  alias: string;
  kind: 'country' | 'region';
  value: string;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const ALIASES: Alias[] = (() => {
  const out: Alias[] = [];
  for (const c of Object.values(COUNTRIES)) {
    out.push({ alias: c.name.toLowerCase(), kind: 'country', value: c.code });
    for (const a of COUNTRY_ALIASES[c.code] ?? []) out.push({ alias: a, kind: 'country', value: c.code });
  }
  for (const r of REGIONS) {
    for (const a of r.aliases) out.push({ alias: a, kind: 'region', value: r.id });
  }
  // alias più lunghi prima, così "latin america" vince su "america"
  return out.sort((a, b) => b.alias.length - a.alias.length);
})();

const ALIAS_MAP = new Map(ALIASES.map((a) => [a.alias, a]));

/** Alternanza regex di tutti gli alias (i più lunghi prima). */
const ALIAS_ALT = ALIASES.map((a) => escapeRe(a.alias)).join('|');
const ALIAS_RE = new RegExp(`(?<![\\p{L}\\p{N}])(${ALIAS_ALT})(?![\\p{L}\\p{N}])`, 'giu');

/** Georgia (stato USA) e simili: parole che in un indirizzo USA non indicano un paese. */
const AMBIGUOUS_WITH_US_STATE = new Set(['GE']);

/**
 * Alias fino a 3 lettere (us, uk, eu, ue, uae, cet…) nel testo libero valgono solo se scritti
 * in maiuscolo: "US only" sì, "join us" no.
 */
function isShortAliasValid(original: string): boolean {
  const letters = original.replace(/[^\p{L}]/gu, '');
  if (letters.length > 3) return true;
  return letters === letters.toUpperCase();
}

function emptySpec(): LocationSpec {
  return { regions: [], countries: [] };
}

function addMatch(spec: LocationSpec, a: Alias): void {
  if (a.kind === 'country') {
    if (!spec.countries.includes(a.value)) spec.countries.push(a.value);
  } else if (!spec.regions.includes(a.value)) {
    spec.regions.push(a.value);
  }
}

function scanAliases(text: string, strictCase: boolean): LocationSpec {
  const spec = emptySpec();
  ALIAS_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ALIAS_RE.exec(text)) !== null) {
    const raw = m[1] as string;
    const alias = ALIAS_MAP.get(raw.toLowerCase());
    if (!alias) continue;
    if (strictCase && !isShortAliasValid(raw)) continue;
    addMatch(spec, alias);
  }
  return spec;
}

/**
 * Interpreta un campo "location" breve di una fonte (es. "USA, Canada",
 * "Anywhere in the World", "Remote - Americas", "San Francisco, CA").
 * Ciò che non è riconosciuto (città, sigle) viene ignorato: nessun vincolo.
 */
export function parseLocationSpec(text: string | null | undefined): LocationSpec {
  if (!text) return emptySpec();
  const spec = scanAliases(text, false);
  if (US_STATE_SUFFIX.test(text)) {
    if (!spec.countries.includes('US')) spec.countries.push('US');
    spec.countries = spec.countries.filter((c) => !AMBIGUOUS_WITH_US_STATE.has(c));
  }
  return spec;
}

const LIST = `((?:(?:the\\s+)?(?:${ALIAS_ALT})(?:\\s*(?:,|/|&|\\+|\\bor\\b|\\band\\b)\\s*)*)+)`;
const B = '(?<![\\p{L}\\p{N}])';
const E = '(?![\\p{L}\\p{N}])';

/** Frasi che esprimono una restrizione di residenza/area nel testo libero. */
const RESTRICTION_PATTERNS: RegExp[] = [
  // "US only", "US-only", "USA or Canada only", "Europe only", "US residents only", "US-based only"
  new RegExp(`${B}${LIST}[\\s-]*(?:residents?|citizens?|based|candidates|applicants)?[\\s-]*only${E}`, 'giu'),
  // "only in the US", "only open to candidates in Europe", "only for residents of Canada"
  new RegExp(
    `${B}only\\s+(?:open\\s+to\\s+|available\\s+to\\s+|hiring\\s+|considering\\s+|for\\s+)?(?:candidates\\s+|applicants\\s+|residents\\s+|people\\s+)?(?:in|within|from|of|based\\s+in|located\\s+in)\\s+${LIST}`,
    'giu',
  ),
  // "must reside in the US", "must be based in Canada", "must be located within the United States"
  new RegExp(
    `${B}(?:must|need\\s+to|needs\\s+to|have\\s+to|required\\s+to|should)\\s+(?:be\\s+)?(?:currently\\s+)?(?:legally\\s+)?(?:reside|residing|live|living|located|based|resident|a\\s+resident)\\s+(?:in|within|of)\\s+${LIST}`,
    'giu',
  ),
  // "authorized to work in the US", "eligible to work in the UK", "right to work in the EU"
  new RegExp(
    `${B}(?:authorized|authorised|eligible|eligibility|permitted|able|right|permission)\\s+to\\s+work\\s+(?:lawfully\\s+)?(?:in|within)\\s+${LIST}`,
    'giu',
  ),
  // "Remote (US)", "Remote - US", "Remote in Europe", "REMOTE (US time zones)", "Remote USA"
  new RegExp(`${B}remote\\s*[(\\-–—:,]?\\s*(?:in|within|from|across)?\\s*${LIST}`, 'giu'),
  // "US-based candidates", "EU based applicants"
  new RegExp(`${B}${LIST}[\\s-]*based\\s+(?:candidates|applicants|engineers|developers|talent)`, 'giu'),
  // "(US)" / "[EU]" tipici nei titoli
  new RegExp(`[(\\[]\\s*${LIST}\\s*[)\\]]`, 'giu'),
];

/**
 * Cerca nel testo libero (titolo, descrizione) frasi che limitano l'annuncio
 * a determinati paesi o aree. Restituisce uno spec vuoto se non trova nulla.
 */
export function detectRestrictions(text: string | null | undefined): LocationSpec {
  const spec = emptySpec();
  if (!text) return spec;
  for (const re of RESTRICTION_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const captured = m[1];
      if (!captured) continue;
      const found = scanAliases(captured, true);
      for (const c of found.countries) if (!spec.countries.includes(c)) spec.countries.push(c);
      for (const r of found.regions) if (!spec.regions.includes(r)) spec.regions.push(r);
    }
  }
  return spec;
}

export function isEmptySpec(spec: LocationSpec): boolean {
  return spec.regions.length === 0 && spec.countries.length === 0;
}

export type LocationMatch = 'country' | 'region' | 'worldwide' | 'unknown';

export interface LocationCompatibility {
  ok: boolean;
  match?: LocationMatch;
  /** descrizione leggibile dell'area a cui è limitato l'annuncio, se incompatibile */
  restrictedTo?: string;
}

export function describeSpec(spec: LocationSpec): string {
  const names = [
    ...spec.countries.map((c) => COUNTRIES[c]?.name ?? c),
    ...spec.regions.map((r) => (r.length <= 4 ? r.toUpperCase() : r.replace(/\b\p{L}/gu, (ch) => ch.toUpperCase()))),
  ];
  return names.join(', ');
}

/**
 * Verifica se un annuncio con il vincolo `spec` è aperto a chi risiede in `countryCode`.
 * `extraAcceptedRegions` sono regioni/paesi aggiunti a mano nelle impostazioni.
 */
export function checkLocation(
  countryCode: string,
  spec: LocationSpec,
  extraAcceptedRegions: string[] = [],
): LocationCompatibility {
  const code = countryCode.toUpperCase();
  if (isEmptySpec(spec)) return { ok: true, match: 'unknown' };
  if (spec.countries.includes(code)) return { ok: true, match: 'country' };

  const extra = extraAcceptedRegions.map((r) => r.trim().toLowerCase()).filter(Boolean);
  const extraCountries = new Set(
    extra
      .map((e) => ALIAS_MAP.get(e))
      .filter((a): a is Alias => a?.kind === 'country')
      .map((a) => a.value),
  );
  if (spec.countries.some((c) => extraCountries.has(c))) return { ok: true, match: 'country' };

  const regional = spec.regions.filter((r) => r !== WORLDWIDE);
  if (regional.some((r) => countryInRegion(code, r) || extra.includes(r) || extra.includes(getRegion(r)?.id ?? '')))
    return { ok: true, match: 'region' };
  if (spec.regions.includes(WORLDWIDE)) return { ok: true, match: 'worldwide' };

  return { ok: false, restrictedTo: describeSpec(spec) };
}
