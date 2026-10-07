import {
  canonicalTech,
  checkLocation,
  convertToLocal,
  describeSpec,
  flattenTechStack,
  getCountry,
  resolveTimezone,
  timezoneDistance,
  toDaily,
  toYearly,
  tzOffsetHours,
  type ScoreBreakdown,
  type ScoreItem,
  type Settings,
} from '@jobagg/shared';
import type { JobCore } from './normalize';
import { normalizeCompany } from './normalize';

/** Campi dell'annuncio che dipendono dalle impostazioni: si ricalcolano a ogni salvataggio del Profilo. */
export interface JobEvaluation {
  salaryLocalMin: number | null;
  salaryLocalMax: number | null;
  rejectedReason: string | null;
  ruleScore: number;
  scoreBreakdown: ScoreBreakdown;
}

export type EvaluableJob = Pick<
  JobCore,
  | 'title'
  | 'company'
  | 'tags'
  | 'descriptionText'
  | 'techStack'
  | 'location'
  | 'remote'
  | 'regions'
  | 'restrictedCountries'
  | 'timezoneOffsets'
  | 'contractType'
  | 'requiresVat'
  | 'viaEor'
  | 'seniority'
  | 'salaryFound'
  | 'salaryMin'
  | 'salaryMax'
  | 'salaryCurrency'
  | 'salaryPeriod'
  | 'publishedAt'
> & { firstSeenAt?: Date | null };

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Testi in cui cercare le keyword, già in minuscolo. */
interface Haystack {
  title: string;
  full: string;
  tech: Set<string>;
}

function buildHaystack(job: EvaluableJob): Haystack {
  const tech = new Set(flattenTechStack(job.techStack).map((t) => t.toLowerCase()));
  return {
    title: job.title.toLowerCase(),
    full: `${job.title}\n${job.tags.join('\n')}\n${job.descriptionText}`.toLowerCase(),
    tech,
  };
}

/**
 * Match di una keyword: parola intera nel testo, oppure — se è una tecnologia nota —
 * presenza nello stack estratto (così "postgres" trova anche "PostgreSQL").
 */
export function matchesKeyword(haystack: Haystack, keyword: string, where: 'title' | 'full' = 'full'): boolean {
  const kw = keyword.trim().toLowerCase();
  if (!kw) return false;
  const text = where === 'title' ? haystack.title : haystack.full;
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(kw).replace(/\s+/g, '[\\s-]+')}(?![\\p{L}\\p{N}])`, 'u');
  if (re.test(text)) return true;
  if (where === 'full') {
    const tech = canonicalTech(kw);
    if (tech && haystack.tech.has(tech.name.toLowerCase())) return true;
  }
  return false;
}

function fmtOffset(o: number): string {
  return `UTC${o >= 0 ? '+' : ''}${o}`;
}

function ageInDays(job: EvaluableJob, now: Date): number | null {
  const ref = job.publishedAt ?? job.firstSeenAt ?? null;
  if (!ref) return null;
  return Math.max(0, (now.getTime() - ref.getTime()) / 86_400_000);
}

const CONTRACT_LABEL: Record<string, string> = {
  'full-time': 'full-time',
  'part-time': 'part-time',
  contract: 'contract',
  freelance: 'freelance',
  unknown: 'non indicato',
};

/** Penalità massima per le tecnologie dello stack che non sono tra le keyword dell'utente (preferite o richieste). */
const OTHER_TECH_MAX_PENALTY = 25;
/** Una sola tecnologia estranea non toglie nulla. */
const OTHER_TECH_MIN = 2;
/** Numero di tecnologie estranee oltre il quale conta solo la loro quota sullo stack. */
const OTHER_TECH_FULL_COUNT = 6;

/**
 * Applica filtri rigidi e punteggio a regole (0-100) a un annuncio, in base a profilo e criteri.
 * Funzione pura: stessi input, stesso risultato. Finché l'onboarding non è completo
 * (paese/P.IVA assenti) i filtri che dipendono dal profilo non vengono applicati.
 */
export function evaluateJob(job: EvaluableJob, settings: Settings, now: Date = new Date()): JobEvaluation {
  const country = getCountry(settings.user.country);
  const hasVat = settings.user.has_vat_number;
  const haystack = buildHaystack(job);
  const items: ScoreItem[] = [];
  let rejectedReason: string | null = null;
  const reject = (reason: string) => {
    rejectedReason ??= reason;
  };

  // ── stipendio nella valuta dell'utente ────────────────────────────────────────
  const localCurrency = country?.currency;
  const fx = settings.compensation.fx_rates_to_local;
  const salaryLocalMin = localCurrency ? convertToLocal(job.salaryMin, job.salaryCurrency, localCurrency, fx) : null;
  const salaryLocalMax = localCurrency ? convertToLocal(job.salaryMax, job.salaryCurrency, localCurrency, fx) : null;

  // ── aziende bloccate ──────────────────────────────────────────────────────────
  // nome intero, senza maiuscole né forma societaria: "Acme" blocca "ACME Inc." ma non "Acme Robotics"
  const companyNorm = normalizeCompany(job.company);
  const blocked = companyNorm
    ? settings.companies.blocked.find((name) => normalizeCompany(name) === companyNorm)
    : undefined;
  if (blocked) reject(`Azienda bloccata: ${job.company}`);

  // ── keyword ───────────────────────────────────────────────────────────────────
  const excluded = settings.keywords.exclude.find((k) => matchesKeyword(haystack, k));
  if (excluded) reject(`Contiene la parola esclusa "${excluded}"`);

  const required = settings.keywords.required_any;
  const matchedRequired = required.filter((k) => matchesKeyword(haystack, k));
  const inTitle = required.some((k) => matchesKeyword(haystack, k, 'title'));
  if (required.length > 0 && matchedRequired.length === 0) reject('Nessuna delle keyword richieste è presente');
  const keywordPoints =
    required.length === 0
      ? 15
      : Math.min(25, [0, 13, 18, 22][Math.min(matchedRequired.length, 3)]! + (inTitle ? 3 : 0));
  items.push({
    key: 'keywords',
    label: 'Keyword richieste',
    points: keywordPoints,
    max: 25,
    detail:
      required.length === 0
        ? 'Nessuna keyword richiesta configurata'
        : matchedRequired.length > 0
          ? `${matchedRequired.join(', ')}${inTitle ? ' (anche nel titolo)' : ''}`
          : 'Nessuna trovata',
  });

  const boost = settings.keywords.boost;
  const matchedBoost = boost.filter((k) => matchesKeyword(haystack, k));
  const boostPoints =
    boost.length === 0 ? 8 : Math.round((Math.min(matchedBoost.length, 4) / Math.min(boost.length, 4)) * 15);
  items.push({
    key: 'boost',
    label: 'Keyword preferite',
    points: boostPoints,
    max: 15,
    detail: matchedBoost.length > 0 ? matchedBoost.join(', ') : 'Nessuna trovata',
  });

  // ── tecnologie fuori dai preferiti ────────────────────────────────────────────
  // un annuncio che cita qualche tua keyword ma il cui stack è in gran parte altro perde punti
  const preferred = new Set<string>();
  for (const keyword of [...boost, ...required]) {
    const kw = keyword.trim().toLowerCase();
    if (!kw) continue;
    preferred.add(kw);
    const tech = canonicalTech(kw);
    if (tech) preferred.add(tech.name.toLowerCase());
  }
  const stack = flattenTechStack(job.techStack);
  const otherTech = stack.filter((t) => !preferred.has(t.toLowerCase()));
  const otherShare = stack.length > 0 ? otherTech.length / stack.length : 0;
  // quota estranea dello stack × quanto sono numerose: 6 su 14 pesa più di 3 su 7, 5 su 7 più di 5 su 14
  const otherPenalty =
    preferred.size === 0 || otherTech.length < OTHER_TECH_MIN
      ? 0
      : Math.round(OTHER_TECH_MAX_PENALTY * otherShare * Math.min(1, otherTech.length / OTHER_TECH_FULL_COUNT));
  items.push({
    key: 'other_tech',
    label: 'Tecnologie non preferite',
    points: otherPenalty === 0 ? 0 : -otherPenalty,
    max: 0,
    detail:
      stack.length === 0
        ? 'Nessuna tecnologia riconosciuta'
        : otherTech.length === 0
          ? 'Tutte tra le tue keyword'
          : `${otherTech.length} su ${stack.length} fuori dalle tue keyword${otherPenalty === 0 ? ' (nessuna penalità)' : ''}: ` +
            `${otherTech.slice(0, 8).join(', ')}${otherTech.length > 8 ? '…' : ''}`,
  });

  // ── seniority ─────────────────────────────────────────────────────────────────
  if (job.seniority !== 'unknown' && (settings.seniority.exclude as string[]).includes(job.seniority)) {
    reject(`Seniority esclusa: ${job.seniority}`);
  }
  const seniorityPoints =
    job.seniority === 'unknown' ? 6 : (settings.seniority.include as string[]).includes(job.seniority) ? 10 : 3;
  items.push({
    key: 'seniority',
    label: 'Seniority',
    points: seniorityPoints,
    max: 10,
    detail: job.seniority === 'unknown' ? 'Non indicata' : job.seniority,
  });

  // ── remoto ────────────────────────────────────────────────────────────────────
  if (settings.location.remote_only && (job.remote === 'onsite' || job.remote === 'hybrid')) {
    reject(job.remote === 'hybrid' ? 'Non è full remote: lavoro ibrido' : 'Non è remoto: lavoro in sede');
  }

  // ── contratto ─────────────────────────────────────────────────────────────────
  const acceptedContracts = settings.contract.types as string[];
  if (job.contractType !== 'unknown' && !acceptedContracts.includes(job.contractType)) {
    reject(`Tipo di contratto non richiesto: ${CONTRACT_LABEL[job.contractType]}`);
  }
  items.push({
    key: 'contract',
    label: 'Tipo di contratto',
    points: job.contractType === 'unknown' ? 5 : acceptedContracts.includes(job.contractType) ? 10 : 0,
    max: 10,
    detail: CONTRACT_LABEL[job.contractType],
  });

  // ── area geografica ───────────────────────────────────────────────────────────
  const spec = { regions: job.regions, countries: job.restrictedCountries };
  let locationPoints = 8;
  let locationDetail = 'Profilo non ancora configurato';
  if (country) {
    const loc = checkLocation(country.code, spec, settings.location.extra_accepted_regions);
    if (!loc.ok) {
      reject(`Limitato a ${loc.restrictedTo} (il tuo paese: ${country.name})`);
      locationPoints = 0;
      locationDetail = `Limitato a ${loc.restrictedTo}`;
    } else if (loc.match === 'country') {
      locationPoints = 15;
      locationDetail = `Aperto esplicitamente a ${country.name}`;
    } else if (loc.match === 'region') {
      locationPoints = 13;
      locationDetail = `Area compatibile: ${describeSpec(spec)}`;
    } else if (loc.match === 'worldwide') {
      locationPoints = 12;
      locationDetail = 'Aperto in tutto il mondo';
    } else {
      locationPoints = 8;
      locationDetail = 'Nessun vincolo geografico indicato';
    }
  }
  items.push({ key: 'location', label: 'Area geografica', points: locationPoints, max: 15, detail: locationDetail });

  const locationText = `${job.title}\n${job.location}\n${job.descriptionText}`.toLowerCase();
  const rejectedPattern = settings.location.extra_rejected_patterns.find((p) => locationText.includes(p.toLowerCase()));
  if (rejectedPattern) reject(`Corrisponde al pattern escluso "${rejectedPattern}"`);

  // ── fuso orario ───────────────────────────────────────────────────────────────
  let tzPoints = 4;
  let tzDetail = 'Nessun vincolo di orario indicato';
  if (country && job.timezoneOffsets.length > 0) {
    const userOffset = tzOffsetHours(resolveTimezone(country.code, settings.user.timezone), now);
    const distance = timezoneDistance(userOffset, job.timezoneOffsets) ?? 0;
    const max = settings.location.max_timezone_offset_hours;
    const wanted =
      job.timezoneOffsets.length === 1
        ? fmtOffset(job.timezoneOffsets[0]!)
        : `${fmtOffset(Math.min(...job.timezoneOffsets))}…${fmtOffset(Math.max(...job.timezoneOffsets))}`;
    if (distance > max) {
      reject(
        `Fuso orario incompatibile: richiede ${wanted}, tu sei a ${fmtOffset(userOffset)} (massimo ${max}h di scarto)`,
      );
      tzPoints = 0;
    } else {
      tzPoints = max === 0 ? 5 : Math.round(5 - (distance / max) * 3);
    }
    tzDetail = `Richiede ${wanted}, scarto ${distance}h`;
  }
  items.push({ key: 'timezone', label: 'Fuso orario', points: tzPoints, max: 5, detail: tzDetail });

  // ── P.IVA ─────────────────────────────────────────────────────────────────────
  const needsVat = job.requiresVat === true && !job.viaEor;
  let vatPoints = 5;
  let vatDetail = 'Non richiede P.IVA';
  if (job.viaEor) vatDetail = 'Contratto tramite Employer of Record: P.IVA non necessaria';
  else if (job.requiresVat === null) {
    vatPoints = 4;
    vatDetail = 'Non è chiaro se serva la P.IVA';
  }
  if (needsVat && hasVat === true) vatDetail = 'Richiede P.IVA: ce l’hai';
  if (needsVat && hasVat === false) {
    const policy = settings.contract.without_vat_policy;
    if (policy === 'exclude') {
      reject('Richiede P.IVA/VAT e non ce l’hai');
      vatPoints = 0;
      vatDetail = 'Richiede P.IVA/VAT';
    } else if (policy === 'penalize') {
      vatPoints = -15;
      vatDetail = 'Richiede P.IVA/VAT: punteggio ridotto';
    } else {
      vatDetail = 'Richiede P.IVA/VAT (nessuna penalità configurata)';
    }
  }
  items.push({ key: 'vat', label: 'Compatibilità P.IVA', points: vatPoints, max: 5, detail: vatDetail });

  // ── retribuzione ──────────────────────────────────────────────────────────────
  let salaryPoints = 4;
  let salaryDetail = 'Retribuzione non indicata';
  if (!job.salaryFound) {
    if (!settings.compensation.allow_missing) reject('Retribuzione non indicata');
  } else if (job.salaryPeriod && (salaryLocalMax ?? salaryLocalMin) !== null) {
    const top = (salaryLocalMax ?? salaryLocalMin) as number;
    const yearly = toYearly(top, job.salaryPeriod);
    const daily = toDaily(top, job.salaryPeriod);
    const threshold = yearly !== null ? settings.compensation.min_yearly : settings.compensation.min_daily_rate;
    const value = yearly ?? daily ?? 0;
    const unit = yearly !== null ? 'anno' : 'giorno';
    if (threshold > 0 && value < threshold) {
      reject(
        `Retribuzione sotto la soglia: ${Math.round(value).toLocaleString('it-IT')} ${localCurrency}/${unit} (minimo ${threshold.toLocaleString('it-IT')})`,
      );
      salaryPoints = 0;
      salaryDetail = 'Sotto la soglia minima';
    } else {
      const ratio = threshold > 0 ? value / threshold : 1.15;
      salaryPoints = ratio >= 1.3 ? 10 : ratio >= 1.15 ? 9 : ratio >= 1 ? 8 : 7;
      salaryDetail = `${Math.round(value).toLocaleString('it-IT')} ${localCurrency}/${unit}`;
    }
  } else {
    salaryPoints = 6;
    salaryDetail = localCurrency
      ? `Indicata in ${job.salaryCurrency}: tasso di cambio non configurato`
      : 'Indicata (valuta locale non ancora configurata)';
  }
  items.push({ key: 'salary', label: 'Retribuzione', points: salaryPoints, max: 10, detail: salaryDetail });

  // ── freschezza ────────────────────────────────────────────────────────────────
  const age = ageInDays(job, now);
  const maxAge = settings.freshness.max_age_days;
  let freshPoints = 3;
  if (age !== null) {
    if (age > maxAge) reject(`Annuncio più vecchio di ${maxAge} giorni`);
    freshPoints = age > maxAge ? 0 : age <= 2 ? 5 : Math.max(1, Math.round(5 - (age / maxAge) * 4));
  }
  items.push({
    key: 'freshness',
    label: 'Freschezza',
    points: freshPoints,
    max: 5,
    detail: age === null ? 'Data non indicata' : `${Math.floor(age)} giorni fa`,
  });

  const total = Math.max(0, Math.min(100, Math.round(items.reduce((sum, i) => sum + i.points, 0))));
  return { salaryLocalMin, salaryLocalMax, rejectedReason, ruleScore: total, scoreBreakdown: { items, total } };
}
