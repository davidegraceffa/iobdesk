import type { ContractType, LocationSpec, ParsedSalary, RemoteType, Seniority, Settings } from '@jobagg/shared';

/** Elemento grezzo così come restituito dalla fonte. */
export type RawJob = Record<string, unknown>;

/** Annuncio nel modello comune, prima della normalizzazione condivisa della pipeline. */
export interface JobInput {
  source: string;
  externalId?: string;
  sourceUrl: string;
  title: string;
  company: string;
  companyUrl?: string;
  /** testo o HTML originale, integrale */
  descriptionOriginal: string;
  /** false se la descrizione è testo semplice (default: HTML) */
  descriptionIsHtml?: boolean;
  applyUrl?: string;
  /** la fonte chiede che la candidatura passi dalla sua pagina (es. Remote OK, Jobicy) */
  applyViaSource?: boolean;
  /** testo libero (es. Hacker News): qualunque link esterno nel testo vale come link di candidatura */
  applyFromAnyLink?: boolean;
  tags: string[];
  /** testo originale della località */
  location: string;
  /** indicazioni strutturate della fonte: hanno la precedenza sulle euristiche sul testo */
  remoteHint?: RemoteType;
  contractHint?: ContractType;
  seniorityHint?: Seniority;
  locationSpec?: LocationSpec;
  timezoneOffsets?: number[];
  /** retribuzione dai campi strutturati della fonte */
  salary?: ParsedSalary | null;
  publishedAt?: Date;
}

export interface HttpRequestOptions {
  /** usa ETag / Last-Modified salvati: se la fonte risponde 304 il risultato è `null` */
  conditional?: boolean;
  accept?: string;
}

/** Client HTTP legato a una fonte: User-Agent, rate limit e richieste condizionali. */
export interface SourceHttpClient {
  getJson<T = unknown>(url: string, options?: HttpRequestOptions): Promise<T | null>;
  getText(url: string, options?: HttpRequestOptions): Promise<string | null>;
}

export interface FetchContext {
  http: SourceHttpClient;
  settings: Settings;
  now: Date;
  log: (message: string) => void;
}

export interface SourceAdapter {
  id: string;
  displayName: string;
  homepage: string;
  /** paesi/regioni per cui la fonte è più rilevante, es. ["worldwide"], ["europe", "de"] */
  relevantRegions: string[];
  /** testo di attribuzione da mostrare nella UI, se la fonte lo richiede */
  attribution?: string;
  /** intervallo minimo tra due raccolte, per rispettare i limiti dichiarati dalla fonte */
  minIntervalMinutes?: number;
  /** false se mancano credenziali o configurazione (es. IMAP) */
  isConfigured?(): boolean;
  fetchJobs(ctx: FetchContext): Promise<RawJob[]>;
  normalize(raw: RawJob): JobInput;
}

export const SOURCE_ADAPTERS = Symbol('SOURCE_ADAPTERS');

export class SourceFormatError extends Error {
  constructor(source: string, detail: string) {
    super(`Formato inatteso dalla fonte ${source}: ${detail}`);
    this.name = 'SourceFormatError';
  }
}
