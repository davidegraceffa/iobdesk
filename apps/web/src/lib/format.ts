import type {
  ApplicationChannel,
  ApplicationStatus,
  ApplyMethod,
  ContractType,
  JobStatus,
  RemoteType,
  SalaryPeriod,
  Seniority,
  TechCategory,
} from '@jobagg/shared';

const dateFmt = new Intl.DateTimeFormat('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('it-IT', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const relative = new Intl.RelativeTimeFormat('it', { numeric: 'auto' });

export function formatDate(iso: string | null | undefined): string {
  return iso ? dateFmt.format(new Date(iso)) : '—';
}

export function formatDateTime(iso: string | null | undefined): string {
  return iso ? dateTimeFmt.format(new Date(iso)) : '—';
}

/** "3 giorni fa", "tra 2 ore", "ieri". */
export function formatRelative(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '—';
  const seconds = (new Date(iso).getTime() - now.getTime()) / 1000;
  const abs = Math.abs(seconds);
  if (abs < 60) return 'adesso';
  if (abs < 3600) return relative.format(Math.round(seconds / 60), 'minute');
  if (abs < 86_400) return relative.format(Math.round(seconds / 3600), 'hour');
  if (abs < 86_400 * 30) return relative.format(Math.round(seconds / 86_400), 'day');
  if (abs < 86_400 * 365) return relative.format(Math.round(seconds / (86_400 * 30)), 'month');
  return relative.format(Math.round(seconds / (86_400 * 365)), 'year');
}

export function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('it-IT', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${Math.round(amount).toLocaleString('it-IT')} ${currency}`;
  }
}

export const PERIOD_LABEL: Record<SalaryPeriod, string> = { year: 'anno', month: 'mese', day: 'giorno', hour: 'ora' };

/** Conversione nella valuta dell'utente, es. "≈ 82.800 € – 110.400 € / anno". */
export function formatLocalSalary(
  min: number | null,
  max: number | null,
  currency: string | null,
  period: SalaryPeriod | null,
): string | null {
  if (!currency || !period || (min === null && max === null)) return null;
  const lo = min ?? max!;
  const hi = max ?? min!;
  const range = lo === hi ? formatMoney(lo, currency) : `${formatMoney(lo, currency)} – ${formatMoney(hi, currency)}`;
  return `≈ ${min === null ? 'fino a ' : ''}${range} / ${PERIOD_LABEL[period]}`;
}

/** Intervallo senza prefissi, es. "55.000 € – 70.000 €". */
export function formatMoneyRange(min: number, max: number, currency: string): string {
  return min === max ? formatMoney(min, currency) : `${formatMoney(min, currency)} – ${formatMoney(max, currency)}`;
}

export const REMOTE_LABEL: Record<RemoteType, string> = {
  full: 'Full remote',
  hybrid: 'Ibrido',
  onsite: 'In sede',
  unknown: 'Remoto non indicato',
};

export const CONTRACT_LABEL: Record<ContractType, string> = {
  'full-time': 'Full-time',
  'part-time': 'Part-time',
  contract: 'Contract',
  freelance: 'Freelance',
  unknown: 'Contratto non indicato',
};

export const SENIORITY_LABEL: Record<Seniority, string> = {
  intern: 'Stage',
  junior: 'Junior',
  mid: 'Mid',
  senior: 'Senior',
  lead: 'Lead',
  unknown: 'Seniority non indicata',
};

export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  new: 'Nuovo',
  saved: 'Salvato',
  applied: 'Candidato',
  interview: 'Colloquio',
  rejected: 'Rifiutato',
  discarded: 'Scartato',
};

export const APPLY_METHOD_LABEL: Record<ApplyMethod, string> = {
  ats: 'Form ATS',
  careers_page: 'Pagina careers',
  email: 'Email',
  source_page: 'Pagina della fonte',
};

export const CHANNEL_LABEL: Record<ApplicationChannel, string> = {
  ats: 'Form ATS',
  careers_page: 'Pagina careers',
  job_board: 'Portale di annunci',
  email: 'Email',
  linkedin: 'LinkedIn',
  referral: 'Referral',
  other: 'Altro',
};

export const APPLICATION_STATUS_LABEL: Record<ApplicationStatus, string> = {
  applied: 'Candidatura inviata',
  screening: 'Screening',
  interview: 'Colloquio',
  offer: 'Offerta',
  accepted: 'Accettata',
  rejected: 'Rifiutata',
  withdrawn: 'Ritirata',
  no_response: 'Nessuna risposta',
  skipped: 'Saltata',
};

export const TECH_CATEGORY_LABEL: Record<TechCategory, string> = {
  frontend: 'Frontend',
  backend: 'Backend',
  languages: 'Linguaggi',
  database: 'Database',
  cloudDevops: 'Cloud/DevOps',
  testing: 'Testing',
  mobile: 'Mobile',
  other: 'Altro',
};

export const LANGUAGE_LABEL: Record<string, string> = {
  it: 'Italiano',
  en: 'Inglese',
  es: 'Spagnolo',
  de: 'Tedesco',
  fr: 'Francese',
  pt: 'Portoghese',
  nl: 'Olandese',
};

export function languageLabel(code: string | null | undefined): string {
  if (!code) return 'non rilevata';
  return LANGUAGE_LABEL[code] ?? code.toUpperCase();
}

const regionNames = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(['it'], { type: 'region' }) : null;

/** Nome italiano di un paese dal codice ISO, con ripiego sul nome inglese. */
export function countryName(code: string, fallback?: string): string {
  try {
    return regionNames?.of(code) ?? fallback ?? code;
  } catch {
    return fallback ?? code;
  }
}

/** Fascia del punteggio: sempre con etichetta testuale, mai solo colore. */
export function scoreBand(score: number): { band: 'low' | 'mid' | 'high'; label: string } {
  if (score >= 70) return { band: 'high', label: 'Alto' };
  if (score >= 45) return { band: 'mid', label: 'Medio' };
  return { band: 'low', label: 'Basso' };
}
