import { z } from 'zod';
import { getCountry } from '../geo/countries';
import { isValidTimezone } from '../geo/timezone';

// messaggi di validazione in italiano, mostrati così come sono nel form del Profilo
z.config(z.locales.it());

export const SOURCE_IDS = [
  'remotive',
  'remoteok',
  'arbeitnow',
  'himalayas',
  'jobicy',
  'weworkremotely',
  'hn_whoishiring',
  'email_alerts',
] as const;
export type SourceId = (typeof SOURCE_IDS)[number];

export const SENIORITY_LEVELS = ['intern', 'junior', 'mid', 'senior', 'lead'] as const;
export const CONTRACT_TYPES = ['full-time', 'part-time', 'contract', 'freelance'] as const;
export const VAT_POLICIES = ['penalize', 'exclude', 'keep'] as const;
export const LLM_PROVIDERS = ['ollama', 'anthropic', 'openai'] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];
export const EXTERNAL_LLM_PROVIDERS: readonly string[] = ['anthropic', 'openai'];

/** Lingue per cui è previsto uno slot di CV di default. */
export const CV_LANGUAGES = ['it', 'en', 'es', 'de', 'fr', 'pt', 'nl'] as const;
export type CvLanguage = (typeof CV_LANGUAGES)[number];
export const MAX_CV_LANGUAGES = 3;

const stringList = z.array(z.string().trim().min(1).max(100)).max(100);

const sourceSchema = (enabled: boolean, interval: number) =>
  z
    .object({
      enabled: z.boolean().default(enabled),
      interval_minutes: z.number().int().min(15, 'Minimo 15 minuti').max(10_080).default(interval),
    })
    .prefault({});

const userSchema = z
  .object({
    country: z
      .string()
      .trim()
      .toUpperCase()
      .refine((c) => !!getCountry(c), { message: 'Paese non riconosciuto (codice ISO 3166-1 alpha-2)' })
      .optional(),
    timezone: z
      .string()
      .trim()
      .refine((tz) => isValidTimezone(tz), { message: 'Fuso orario IANA non valido' })
      .optional(),
    has_vat_number: z.boolean().optional(),
  })
  .prefault({});

export const settingsSchema = z.object({
  user: userSchema,
  profile: z
    .object({
      title: z.string().trim().max(200).default(''),
      summary: z.string().trim().max(4000).default(''),
    })
    .prefault({}),
  keywords: z
    .object({
      required_any: stringList.default([]),
      boost: stringList.default([]),
      exclude: stringList.default([]),
    })
    .prefault({}),
  seniority: z
    .object({
      include: z.array(z.enum(SENIORITY_LEVELS)).default(['mid', 'senior']),
      exclude: z.array(z.enum(SENIORITY_LEVELS)).default(['intern', 'junior']),
    })
    .prefault({}),
  companies: z
    .object({
      /** aziende di cui non si vogliono vedere le offerte: confronto sul nome, senza maiuscole né forma societaria */
      blocked: stringList.default([]),
    })
    .prefault({}),
  location: z
    .object({
      remote_only: z.boolean().default(true),
      extra_accepted_regions: stringList.default([]),
      extra_rejected_patterns: stringList.default([]),
      max_timezone_offset_hours: z.number().min(0).max(24).default(3),
    })
    .prefault({}),
  contract: z
    .object({
      types: z.array(z.enum(CONTRACT_TYPES)).default(['full-time', 'contract', 'freelance', 'part-time']),
      without_vat_policy: z.enum(VAT_POLICIES).default('penalize'),
    })
    .prefault({}),
  compensation: z
    .object({
      min_yearly: z.number().min(0).default(0),
      min_daily_rate: z.number().min(0).default(0),
      allow_missing: z.boolean().default(true),
      fx_rates_to_local: z
        .record(z.string().trim().toUpperCase().length(3, 'Codice valuta di 3 lettere'), z.number().positive())
        .default({}),
    })
    .prefault({}),
  freshness: z
    .object({
      max_age_days: z.number().int().min(1).max(365).default(21),
    })
    .prefault({}),
  dedupe: z
    .object({
      similarity_threshold: z.number().min(0.3).max(1).default(0.8),
    })
    .prefault({}),
  scoring: z
    .object({
      llm: z
        .object({
          enabled: z.boolean().default(false),
          provider: z.enum(LLM_PROVIDERS).default('ollama'),
          model: z.string().trim().min(1).max(100).default('llama3.1'),
          /** modello rapido per i turni della conversazione nei colloqui simulati; vuoto = scelta automatica */
          fast_model: z.string().trim().max(100).default(''),
          min_score_to_notify: z.number().min(0).max(100).default(70),
          /** consenso esplicito all'invio di annunci e CV a un provider esterno */
          external_consent: z.boolean().default(false),
        })
        .prefault({}),
    })
    .prefault({}),
  notifications: z
    .object({
      telegram: z
        .object({
          enabled: z.boolean().default(false),
          min_score: z.number().min(0).max(100).default(70),
        })
        .prefault({}),
    })
    .prefault({}),
  applications: z
    .object({
      followup_days: z.number().int().min(1).max(180).default(14),
    })
    .prefault({}),
  /** lettura di Gmail (sola lettura) per registrare le candidature e i rifiuti arrivati via email */
  mail_sync: z
    .object({
      enabled: z.boolean().default(false),
      interval_minutes: z.number().int().min(15, 'Minimo 15 minuti').max(10_080).default(180),
      /** guarda solo le email degli ultimi N giorni */
      newer_than_days: z.number().int().min(1).max(365).default(60),
      /** tetto ai messaggi letti a ogni sincronizzazione */
      max_messages: z.number().int().min(10).max(2000).default(500),
      /** termini di ricerca Gmail aggiuntivi, es. "-from:newsletter@esempio.com" */
      extra_query: z.string().trim().max(500).default(''),
      /** parti di indirizzi mittente da ignorare */
      ignore_senders: stringList.default([]),
    })
    .prefault({}),
  cv: z
    .object({
      languages: z
        .array(z.enum(CV_LANGUAGES))
        .min(1, 'Almeno una lingua')
        .max(MAX_CV_LANGUAGES, `Massimo ${MAX_CV_LANGUAGES} lingue`)
        .refine((l) => new Set(l).size === l.length, { message: 'Lingue duplicate' })
        .default(['it', 'en']),
      /** competenze ed esperienze reali non presenti nel CV, una per riga o separate da virgola */
      extra_skills: z.string().max(6000).default(''),
      /** controllo periodico dei CV base con proposte di miglioramento */
      review: z
        .object({
          enabled: z.boolean().default(true),
          interval_days: z.number().int().min(1, 'Minimo 1 giorno').max(90, 'Massimo 90 giorni').default(7),
        })
        .prefault({}),
    })
    .prefault({}),
  sources: z
    .object({
      remotive: sourceSchema(true, 120),
      remoteok: sourceSchema(true, 120),
      arbeitnow: sourceSchema(true, 180),
      himalayas: sourceSchema(true, 180),
      jobicy: sourceSchema(true, 180),
      weworkremotely: sourceSchema(true, 120),
      hn_whoishiring: sourceSchema(true, 720),
      email_alerts: sourceSchema(false, 60),
    })
    .prefault({}),
});

export type Settings = z.infer<typeof settingsSchema>;
export type SettingsInput = z.input<typeof settingsSchema>;

export function defaultSettings(): Settings {
  return settingsSchema.parse({});
}

/** L'onboarding è completo quando conosciamo paese e stato della P.IVA. */
export function isOnboardingComplete(settings: Pick<Settings, 'user'> | null | undefined): boolean {
  return !!settings?.user?.country && typeof settings.user.has_vat_number === 'boolean';
}

export interface FieldError {
  path: string;
  message: string;
}

export function formatZodIssues(error: z.ZodError): FieldError[] {
  return error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
}

export interface SettingsDiffEntry {
  path: string;
  before: unknown;
  after: unknown;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Differenze campo per campo tra due versioni delle impostazioni (per anteprima import e storico). */
export function diffSettings(before: unknown, after: unknown, prefix = ''): SettingsDiffEntry[] {
  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    return keys.flatMap((k) => diffSettings(before[k], after[k], prefix ? `${prefix}.${k}` : k));
  }
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  return [{ path: prefix, before, after }];
}

/** Elenco di competenze aggiuntive a partire dal testo libero del Profilo. */
export function parseExtraSkills(text: string | undefined | null): string[] {
  if (!text) return [];
  return [
    ...new Set(
      text
        .split(/[\n,;]+/)
        .map((s) => s.replace(/^[\s\-•*]+/, '').trim())
        .filter(Boolean),
    ),
  ];
}
