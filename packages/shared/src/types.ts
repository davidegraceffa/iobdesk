import type {
  AppliedCvEdit,
  CvEdit,
  CvEdits,
  CvProgressStep,
  CvStructure,
  RejectedCvEdit,
  StoredSalaryEstimate,
} from './cv/edits';
import type { SalaryPeriod } from './salary/parse';
import type { FieldError, Settings, SettingsDiffEntry } from './settings/schema';
import type { TechStack } from './tech/extract';

export const REMOTE_TYPES = ['full', 'hybrid', 'onsite', 'unknown'] as const;
export type RemoteType = (typeof REMOTE_TYPES)[number];

export const JOB_CONTRACT_TYPES = ['full-time', 'part-time', 'contract', 'freelance', 'unknown'] as const;
export type ContractType = (typeof JOB_CONTRACT_TYPES)[number];

export const JOB_SENIORITIES = ['intern', 'junior', 'mid', 'senior', 'lead', 'unknown'] as const;
export type Seniority = (typeof JOB_SENIORITIES)[number];

export const JOB_STATUSES = ['new', 'saved', 'applied', 'interview', 'rejected', 'discarded'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const APPLY_METHODS = ['ats', 'careers_page', 'email', 'source_page'] as const;
export type ApplyMethod = (typeof APPLY_METHODS)[number];

export const APPLICATION_CHANNELS = [
  'ats',
  'careers_page',
  'job_board',
  'email',
  'linkedin',
  'referral',
  'other',
] as const;
export type ApplicationChannel = (typeof APPLICATION_CHANNELS)[number];

export const APPLICATION_STATUSES = [
  'applied',
  'screening',
  'interview',
  'offer',
  'accepted',
  'rejected',
  'withdrawn',
  'no_response',
  // candidatura non completata (es. il portale richiedeva un account): non conta tra quelle inviate
  'skipped',
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export interface ScoreItem {
  key: string;
  label: string;
  points: number;
  max: number;
  detail?: string;
}

export interface ScoreBreakdown {
  items: ScoreItem[];
  total: number;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface JobDuplicateRef {
  id: string;
  source: string;
  sourceName: string;
  sourceUrl: string;
}

/** Stima della RAL generata dall'LLM (lorda annua), con la conversione nella valuta dell'utente se il tasso è configurato. */
export interface SalaryEstimateDto extends StoredSalaryEstimate {
  localMin: number | null;
  localMax: number | null;
}

export interface JobListItem {
  id: string;
  source: string;
  sourceName: string;
  /** testo di attribuzione richiesto dalla fonte (es. Remote OK), se previsto */
  attribution: string | null;
  sourceUrl: string;
  title: string;
  company: string;
  companyUrl: string | null;
  /** anteprima testuale della descrizione originale */
  descriptionPreview: string;
  applyUrl: string | null;
  applyMethod: ApplyMethod;
  techStack: TechStack;
  salaryFound: boolean;
  salaryRawText: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: SalaryPeriod | null;
  salaryLocalMin: number | null;
  salaryLocalMax: number | null;
  /** valuta del paese dell'utente usata per salaryLocal* */
  localCurrency: string | null;
  /** stima generata su richiesta quando l'annuncio non indica la retribuzione: mai usata da filtri e punteggi */
  salaryEstimate: SalaryEstimateDto | null;
  tags: string[];
  location: string;
  remote: RemoteType;
  regions: string[];
  restrictedCountries: string[];
  contractType: ContractType;
  requiresVat: boolean | null;
  viaEor: boolean;
  /** true se il ruolo richiede P.IVA, l'utente non ce l'ha e non passa da un EOR */
  vatBadge: boolean;
  seniority: Seniority;
  publishedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  ruleScore: number;
  llmScore: number | null;
  rejectedReason: string | null;
  status: JobStatus;
  notes: string | null;
  duplicateOfId: string | null;
  duplicates: JobDuplicateRef[];
  application: { id: string; appliedAt: string; currentStatus: ApplicationStatus } | null;
  generatedCvs: { count: number; languages: string[]; latestId: string | null };
}

export interface JobDetail extends JobListItem {
  descriptionOriginal: string;
  descriptionHtml: string;
  /** lingua rilevata della descrizione (ISO 639-1) */
  language: string | null;
  scoreBreakdown: ScoreBreakdown;
  llmReason: string | null;
  llmRedFlags: string[];
  timezoneOffsets: number[];
  /** nota "fatturazione B2B UE: reverse charge" applicabile */
  euVatNote: boolean;
}

export interface JobsQuery {
  q?: string;
  status?: JobStatus | '';
  source?: string;
  minScore?: number;
  remote?: RemoteType | '';
  contractType?: ContractType | '';
  vatCompatible?: boolean;
  includeRejected?: boolean;
  sort?: 'score' | 'date';
  page?: number;
  pageSize?: number;
}

export interface JobSnapshot {
  title: string;
  company: string;
  /** id della fonte (o testo libero per le candidature manuali) */
  source: string;
  /** nome leggibile della fonte al momento della candidatura */
  sourceName?: string;
  sourceUrl: string;
  applyUrl?: string;
  salaryFound: boolean;
  salaryRawText?: string;
  salaryMin?: number;
  salaryMax?: number;
  salaryCurrency?: string;
  salaryPeriod?: SalaryPeriod;
  techStack: TechStack;
  contractType: string;
  location: string;
  descriptionOriginal: string;
  descriptionHtml?: string;
}

export interface ApplicationEventDto {
  id: string;
  at: string;
  fromStatus: string | null;
  toStatus: string;
  note: string | null;
}

export interface ApplicationDto {
  id: string;
  jobId: string | null;
  appliedAt: string;
  channel: ApplicationChannel;
  currentStatus: ApplicationStatus;
  notes: string | null;
  contactName: string | null;
  contactEmail: string | null;
  generatedCvId: string | null;
  /** id nel file da cui è stata importata, se importata */
  externalId: string | null;
  country: string | null;
  cvSent: string | null;
  cvLanguage: string | null;
  trackingMode: string | null;
  snapshot: JobSnapshot;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
  daysSinceLastActivity: number;
  /** nessuna risposta da più giorni della soglia configurata */
  needsFollowUp: boolean;
  events?: ApplicationEventDto[];
}

export interface ApplicationImportRow {
  /** numero di riga nel file (la prima riga di dati è la 2) */
  row: number;
  message: string;
}

export interface ApplicationImportResult {
  dryRun: boolean;
  total: number;
  created: number;
  updated: number;
  unchanged: number;
  errors: ApplicationImportRow[];
  warnings: ApplicationImportRow[];
  /** colonne del file riconosciute e colonne ignorate */
  recognizedColumns: string[];
  ignoredColumns: string[];
  preview: Array<{
    row: number;
    action: 'create' | 'update' | 'unchanged';
    company: string;
    title: string;
    appliedAt: string;
    status: ApplicationStatus;
    portal: string;
    country: string;
  }>;
}

/** Una candidatura creata o aggiornata dalla sincronizzazione con Gmail. */
export interface MailSyncItem {
  /** assente nell'anteprima per le candidature non ancora create */
  applicationId: string | null;
  /** AAAA-MM-GG della mail */
  date: string;
  company: string;
  title: string;
  portal: string;
  country: string;
  status: ApplicationStatus;
  previousStatus: ApplicationStatus | null;
  subject: string;
}

export interface MailSyncIgnored {
  date: string;
  sender: string;
  subject: string;
  reason: string;
}

export interface MailSyncRunDto {
  /** null per le anteprime, che non vengono salvate */
  id: string | null;
  trigger: string;
  dryRun: boolean;
  startedAt: string;
  finishedAt: string | null;
  status: 'running' | 'success' | 'error';
  /** email esaminate (ricevute + rifiuti) */
  examined: number;
  created: number;
  updated: number;
  duplicates: number;
  ignored: number;
  error: string | null;
  details: {
    created: MailSyncItem[];
    updated: MailSyncItem[];
    /** rifiuti che potrebbero riferirsi a più candidature: lo stato va aggiornato a mano */
    ambiguous: string[];
    ignored: MailSyncIgnored[];
  };
}

export interface MailSyncStatusDto {
  /** GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET presenti in .env */
  configured: boolean;
  connected: boolean;
  needsReconnect: boolean;
  account: string | null;
  connectedAt: string | null;
  /** indirizzo di ritorno usato per l'autorizzazione Google */
  redirectUri: string;
  enabled: boolean;
  intervalMinutes: number;
  running: boolean;
  lastRun: MailSyncRunDto | null;
  lastSuccessAt: string | null;
}

export interface ApplicationStats {
  total: number;
  thisMonth: number;
  responseRate: number;
  interviews: number;
  offers: number;
  needsFollowUp: number;
  byStatus: Record<string, number>;
}

export interface FetchRunDto {
  id: string;
  source: string;
  trigger: string;
  startedAt: string;
  finishedAt: string | null;
  status: 'running' | 'success' | 'error' | 'skipped';
  found: number;
  created: number;
  updated: number;
  duplicates: number;
  rejected: number;
  error: string | null;
  message: string | null;
}

export interface SourceStatusDto {
  id: string;
  displayName: string;
  homepage: string;
  relevantRegions: string[];
  /** la fonte è rilevante per il paese dell'utente */
  relevant: boolean;
  enabled: boolean;
  intervalMinutes: number;
  /** intervallo minimo imposto dall'adapter per rispettare la fonte */
  minIntervalMinutes: number;
  attribution: string | null;
  /** false se mancano credenziali richieste (es. IMAP) */
  configured: boolean;
  lastSuccessAt: string | null;
  lastRun: FetchRunDto | null;
  lastError: string | null;
  jobCount: number;
  running: boolean;
}

export interface CountryDto {
  code: string;
  name: string;
  timezone: string;
  currency: string;
  eu: boolean;
}

export interface ProfileResponse {
  settings: Settings;
  version: number;
  updatedAt: string | null;
  onboardingComplete: boolean;
  derived: {
    acceptedRegions: string[];
    timezone: string;
    utcOffsetHours: number;
    currency: string | null;
    eu: boolean;
    countryName: string | null;
  };
  /** i segreti restano in .env: qui si vede solo se sono configurati */
  secrets: { telegram: boolean; imap: boolean; anthropic: boolean; openai: boolean };
  llm: {
    /** provider effettivo (può essere forzato da LLM_PROVIDER in .env) */
    provider: string;
    model: string;
    enabled: boolean;
    external: boolean;
    forcedByEnv: boolean;
    /** pronto all'uso: abilitato, chiave presente se serve, consenso dato se esterno */
    ready: boolean;
    notReadyReason: string | null;
  };
}

export interface ProfileSaveError {
  message: string;
  errors: FieldError[];
}

export interface ProfileHistoryEntry {
  id: string;
  version: number;
  savedAt: string;
  reason: string;
  changes: SettingsDiffEntry[];
}

export interface ProfileImportPreview {
  valid: boolean;
  errors: FieldError[];
  changes: SettingsDiffEntry[];
  settings?: Settings;
}

export interface ProfilePreviewResult {
  total: number;
  acceptedNow: number;
  acceptedAfter: number;
}

export interface BaseCvDto {
  id: string;
  language: string;
  version: number;
  isActive: boolean;
  originalFileName: string;
  pageCount: number;
  uploadedAt: string;
  hasPdf: boolean;
}

export interface CvSlotDto {
  language: string;
  status: 'empty' | 'loaded' | 'error';
  error: string | null;
  active: BaseCvDto | null;
  versions: number;
}

export interface BaseCvStructureDto {
  baseCv: BaseCvDto;
  structure: CvStructure;
}

export interface GeneratedCvDto {
  id: string;
  jobId: string | null;
  baseCvId: string;
  language: string;
  version: number;
  status: 'queued' | 'running' | 'ready' | 'failed';
  step: CvProgressStep;
  error: string | null;
  /** avviso non bloccante, es. il PDF supera le pagine del CV base */
  warning: string | null;
  userInstructions: string | null;
  provider: string;
  model: string;
  jobTitle: string;
  company: string;
  /** true se il CV nasce da una descrizione incollata a mano, senza un annuncio raccolto */
  manual: boolean;
  pageCount: number | null;
  basePageCount: number;
  createdAt: string;
  fileName: string;
}

/** applied: la modifica è nel documento generato; done: gestita a mano; dismissed: ignorata */
export type CvReviewSuggestionStatus = 'open' | 'applied' | 'done' | 'dismissed';

/** Una proposta di miglioramento del CV base. */
export interface CvReviewSuggestion {
  id: string;
  /** rewrite: riformula un paragrafo; add: qualcosa da aggiungere se è vero; remove: da togliere; structure: ordine e impostazione */
  kind: 'rewrite' | 'add' | 'remove' | 'structure';
  title: string;
  reason: string;
  priority: 'high' | 'medium' | 'low';
  sectionTitle: string | null;
  /** testo attuale del paragrafo interessato */
  originalText: string | null;
  /** testo proposto, nella lingua del CV */
  proposedText: string | null;
  /** true se l'app può applicarla da sola al documento, generando una nuova versione del CV base */
  applicable: boolean;
  /** perché l'ultima applicazione non è riuscita, se è successo */
  applyError?: string | null;
  status: CvReviewSuggestionStatus;
}

/** Proposta come viene salvata: con la modifica da applicare al documento. */
export interface StoredCvReviewSuggestion extends CvReviewSuggestion {
  edit?: CvEdit | null;
}

/** Esito dell'applicazione di una o più proposte. */
export interface CvReviewApplyResult {
  review: CvReviewDto;
  applied: number;
  /** proposte che il documento non ha potuto ricevere, con il motivo */
  failed: Array<{ title: string; reason: string }>;
  /** versione del CV base ora attiva */
  baseCv: BaseCvDto;
  /** avviso non bloccante, es. il documento ha più pagine di prima */
  warning: string | null;
}

export interface CvReviewDto {
  id: string;
  baseCvId: string;
  language: string;
  trigger: 'schedule' | 'manual';
  status: 'running' | 'ready' | 'failed';
  error: string | null;
  provider: string;
  model: string;
  summary: string;
  suggestions: CvReviewSuggestion[];
  createdAt: string;
  /** true se nel frattempo è stato caricato un altro CV base per quella lingua */
  outdated: boolean;
  /** versione del CV base generata applicando le proposte di questo controllo */
  resultBaseCvId: string | null;
}

/** Compatibilità di un CV base con i sistemi di selezione automatica (ATS). */
export interface CvAtsReport {
  status: 'running' | 'ready' | 'failed';
  error: string | null;
  /** da 0 a 100 */
  score: number | null;
  summary: string;
  categories: Array<{ name: string; score: number; comment: string }>;
  issues: Array<{ severity: 'high' | 'medium' | 'low'; title: string; fix: string }>;
  keywordsPresent: string[];
  keywordsMissing: string[];
  provider: string;
  model: string;
  createdAt: string;
}

/** Tutto ciò che serve alla sezione "Migliora CV". */
export interface CvReviewOverview {
  enabled: boolean;
  intervalDays: number;
  /** false se l'LLM non è utilizzabile: `reason` dice cosa manca */
  available: boolean;
  reason: string | null;
  provider: string;
  model: string;
  external: boolean;
  languages: Array<{
    language: string;
    baseCv: BaseCvDto;
    review: CvReviewDto | null;
    /** valutazione ATS della versione attiva, se è stata chiesta */
    ats: CvAtsReport | null;
    /** quando è previsto il prossimo controllo automatico */
    nextRunAt: string | null;
  }>;
  /** competenze ed esperienze reali da usare nei CV su misura, oltre a quanto c'è nel CV base */
  extraSkills: string[];
  /** tecnologie più richieste negli annunci compatibili recenti che non compaiono né nel CV né tra le aggiunte */
  market: Array<{ name: string; jobs: number }>;
  /** requisiti che i CV su misura generati non hanno potuto coprire, dal più frequente */
  gaps: Array<{ requirement: string; count: number }>;
  marketJobs: number;
}

/** Testo dell'email con cui inviare un CV generato (il CV va in allegato). */
export interface CvEmailDto {
  subject: string;
  /** dal saluto alla firma, paragrafi separati da una riga vuota */
  body: string;
  /** avviso non bloccante, es. tecnologie citate ma assenti dal CV */
  warning: string | null;
  /** true se l'utente ha ritoccato il testo proposto */
  edited: boolean;
  instructions: string | null;
  model: string;
  createdAt: string;
}

export interface GeneratedCvDetail extends GeneratedCvDto {
  edits: AppliedCvEdit[];
  rejectedEdits: RejectedCvEdit[];
  manualEdits: Record<string, string>;
  gaps: CvEdits['gaps'];
  matchSummary: CvEdits['matchSummary'];
  /** testi originali dei paragrafi toccati dalle modifiche, per il diff prima/dopo */
  originals: Record<string, { text: string; sectionId: string; sectionTitle: string }>;
  /** candidatura a cui il CV è collegato, se presente */
  applicationId: string | null;
  /** descrizione incollata a mano (solo per i CV `manual`), riproposta quando si rigenera */
  descriptionText: string | null;
  /** email di accompagnamento, se è stata scritta */
  email: CvEmailDto | null;
}

export interface CvGenerateRequest {
  language: string;
  instructions?: string;
  /** conferma esplicita dell'invio a un provider esterno */
  consentExternal?: boolean;
}

/** CV su misura a partire da una descrizione incollata a mano. */
export interface CvManualGenerateRequest extends CvGenerateRequest {
  title: string;
  company: string;
  description: string;
}

export interface CvGenerateInfo {
  available: boolean;
  reason: string | null;
  languages: string[];
  detectedLanguage: string | null;
  suggestedLanguage: string | null;
  provider: string;
  model: string;
  external: boolean;
  consentGiven: boolean;
  /** elenco leggibile di ciò che viene inviato all'LLM */
  payloadSummary: string[];
}

export interface CoverLetterDto {
  id: string;
  jobId: string | null;
  language: string;
  version: number;
  status: 'generating' | 'ready' | 'failed';
  error: string | null;
  /** avviso non bloccante, es. tecnologie citate ma assenti dal CV, PDF non generato */
  warning: string | null;
  userInstructions: string | null;
  provider: string;
  model: string;
  jobTitle: string;
  company: string;
  subject: string;
  /** testo della lettera, dal saluto alla firma: paragrafi separati da una riga vuota */
  body: string;
  /** true se l'utente ha ritoccato il testo proposto */
  edited: boolean;
  hasPdf: boolean;
  createdAt: string;
  updatedAt: string;
  fileName: string;
}

// ── colloqui simulati ─────────────────────────────────────────────────────────────

export const INTERVIEW_QUESTION_KINDS = ['technical', 'behavioral'] as const;
export type InterviewQuestionKind = (typeof INTERVIEW_QUESTION_KINDS)[number];

export interface InterviewQuestion {
  id: string;
  kind: InterviewQuestionKind;
  /** nella lingua del colloquio */
  text: string;
  /** in italiano: cosa valuta chi fa la domanda e cosa contiene una buona risposta */
  focus: string;
  /** piccoli aiuti da offrire, in ordine, a chi è bloccato; assenti nei colloqui creati prima che esistessero */
  hints?: string[];
}

export interface InterviewFeedback {
  /** da 1 a 5 */
  score: number;
  summary: string;
  strengths: string[];
  improvements: string[];
  /** versione migliorata della risposta, nella lingua del colloquio, senza fatti inventati */
  sampleAnswer: string;
}

export type InterviewMode = 'live' | 'turns';

/** Una battuta della conversazione (solo testo: l'audio non viene conservato). */
export interface InterviewTurn {
  id: string;
  role: 'interviewer' | 'candidate';
  kind: 'question' | 'follow_up' | 'clarify' | 'hint' | 'closing' | 'answer';
  /** domanda principale a cui la battuta si riferisce */
  questionId: string | null;
  text: string;
  /** secondi di parlato, per le risposte a voce */
  durationSec: number | null;
  at: string;
}

/**
 * Valutazione finale del colloquio: correttezza dei contenuti e tono. Lessico e grammatica non vengono
 * giudicati: la trascrizione automatica non riporta abbastanza fedelmente ciò che è stato detto.
 */
export interface InterviewReport {
  /** da 1 a 5 */
  overallScore: number;
  summary: string;
  content: {
    summary: string;
    items: Array<{
      questionId: string;
      score: number;
      correct: string[];
      /** affermazioni sbagliate o imprecise, con la correzione */
      incorrect: string[];
      missing: string[];
    }>;
  };
  tone: { summary: string; traits: string[]; suggestions: string[] };
  /** le cose più importanti su cui lavorare */
  priorities: string[];
  /** misure oggettive calcolate dall'app, non dall'LLM */
  delivery: { answers: number; words: number; speakingSeconds: number; wordsPerMinute: number | null };
}

export interface InterviewAnswerDto {
  questionId: string;
  transcript: string;
  inputMode: 'audio' | 'text';
  durationSec: number | null;
  status: 'pending' | 'ready' | 'failed';
  feedback: InterviewFeedback | null;
  error: string | null;
  updatedAt: string;
}

export interface InterviewSessionSummary {
  id: string;
  jobId: string | null;
  applicationId: string | null;
  /** numero del tentativo per lo stesso annuncio o candidatura */
  attempt: number;
  mode: InterviewMode;
  finishedAt: string | null;
  /** voto complessivo della valutazione finale, da 1 a 5 */
  overallScore: number | null;
  jobTitle: string;
  company: string;
  language: string;
  status: 'generating' | 'ready' | 'failed';
  questionCount: number;
  answeredCount: number;
  /** media dei punteggi delle risposte valutate, da 1 a 5 */
  averageScore: number | null;
  createdAt: string;
}

/** Temi principali del colloquio, ricavati dalla descrizione dell'annuncio: si leggono prima di iniziare. */
export interface InterviewBrief {
  /** una o due frasi su cosa cerca il ruolo */
  summary: string;
  topics: Array<{ title: string; detail: string }>;
}

/** Colloquio proposto in homepage: una candidatura passata scelta a caso su cui esercitarsi. */
export interface InterviewSuggestionDto {
  applicationId: string;
  jobId: string | null;
  title: string;
  company: string;
  location: string;
  appliedAt: string;
  currentStatus: ApplicationStatus;
  techStack: string[];
  /** lingua rilevata dell'annuncio (ISO 639-1), quella in cui si terrebbe il colloquio */
  language: string | null;
  previousAttempts: number;
  lastInterviewAt: string | null;
  /** voto della valutazione finale dell'ultimo colloquio valutato, da 1 a 5 */
  lastOverallScore: number | null;
  /** altre candidature tra cui si può pescare una proposta diversa */
  alternatives: number;
}

export interface InterviewSessionDto extends InterviewSessionSummary {
  /** null per i colloqui creati prima che esistesse */
  brief: InterviewBrief | null;
  transcript: InterviewTurn[];
  report: InterviewReport | null;
  reportStatus: 'pending' | 'ready' | 'failed' | null;
  reportError: string | null;
  error: string | null;
  provider: string;
  model: string;
  questions: InterviewQuestion[];
  answers: InterviewAnswerDto[];
}

export interface InterviewOptions {
  available: boolean;
  reason: string | null;
  title: string;
  company: string;
  /** false: la descrizione dell'annuncio va incollata */
  descriptionAvailable: boolean;
  /** colloqui già fatti per lo stesso annuncio o candidatura */
  previousAttempts: number;
  detectedLanguage: string | null;
  /** 'auto' quando la lingua va rilevata dalla descrizione incollata */
  suggestedLanguage: string;
  provider: string;
  model: string;
  external: boolean;
  consentGiven: boolean;
  /** elenco leggibile di ciò che viene inviato all'LLM */
  payloadSummary: string[];
  /** trascrizione locale delle risposte vocali disponibile */
  speechToText: boolean;
}

export interface StatsDto {
  total: number;
  accepted: number;
  rejected: number;
  duplicates: number;
  newCount: number;
  bySource: Record<string, number>;
  byStatus: Record<string, number>;
  lastFetchAt: string | null;
}

export interface FetchSummaryRow {
  source: string;
  status: 'success' | 'error' | 'skipped';
  found: number;
  created: number;
  updated: number;
  duplicates: number;
  rejected: number;
  error?: string;
  message?: string;
}
