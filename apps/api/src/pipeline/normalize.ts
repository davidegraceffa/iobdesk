import {
  detectRestrictions,
  extractTechStack,
  isEmptySpec,
  parseLocationSpec,
  parseSalary,
  parseTimezoneRequirement,
  WORLDWIDE,
  type ApplyMethod,
  type ContractType,
  type LocationSpec,
  type ParsedSalary,
  type RemoteType,
  type SalaryPeriod,
  type Seniority,
  type TechStack,
} from '@jobagg/shared';
import { createHash } from 'node:crypto';
import sanitizeHtml from 'sanitize-html';
import { detect as detectLanguage } from 'tinyld';
import { decodeEntities } from '../sources/adapters/helpers';
import type { JobInput } from '../sources/source.types';

/** Campi dell'annuncio che non dipendono dalle impostazioni dell'utente. */
export interface JobCore {
  id: string;
  source: string;
  sourceUrl: string;
  canonicalUrl: string | null;
  externalId: string | null;
  title: string;
  company: string;
  companyUrl: string | null;
  titleNorm: string;
  companyNorm: string;
  descriptionOriginal: string;
  descriptionHtml: string;
  descriptionText: string;
  language: string | null;
  applyUrl: string | null;
  applyMethod: ApplyMethod;
  techStack: TechStack;
  salaryFound: boolean;
  salaryRawText: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: SalaryPeriod | null;
  tags: string[];
  location: string;
  remote: RemoteType;
  regions: string[];
  restrictedCountries: string[];
  timezoneOffsets: number[];
  contractType: ContractType;
  requiresVat: boolean | null;
  viaEor: boolean;
  seniority: Seniority;
  publishedAt: Date | null;
}

// ── HTML ────────────────────────────────────────────────────────────────────────

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p', 'br', 'hr', 'ul', 'ol', 'li', 'strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'code', 'a', 'div', 'span',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
  ], // prettier-ignore
  allowedAttributes: { a: ['href', 'target', 'rel'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { target: '_blank', rel: 'noopener noreferrer nofollow' }),
  },
};

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Descrizione sicura da mostrare: stessa formattazione, senza script, stili o attributi attivi. */
export function toSafeHtml(original: string, isHtml: boolean): string {
  if (!original.trim()) return '';
  const html = isHtml
    ? original
    : original
        .split(/\n{2,}/)
        .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
        .join('');
  return sanitizeHtml(html, SANITIZE_OPTIONS).trim();
}

/** Testo semplice a partire dall'HTML, con gli a capo dei blocchi preservati. */
export function htmlToText(html: string): string {
  const withBreaks = html
    .replace(/<\s*(?:br|hr)\s*\/?>/gi, '\n')
    .replace(/<\/\s*(?:p|div|li|ul|ol|h[1-6]|tr|blockquote|pre|table)\s*>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(withBreaks)
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── Identità e deduplicazione ───────────────────────────────────────────────────

const TRACKING_PARAMS = /^(?:utm_|ref$|ref_|source$|src$|gh_src$|lever-source|trk|tracking|fbclid|gclid|mc_)/i;

/** URL canonico: host minuscolo, niente frammento, parametri di tracking e slash finale. */
export function canonicalUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.hash = '';
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    for (const key of [...url.searchParams.keys()]) if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
    url.searchParams.sort();
    const path = url.pathname.replace(/\/+$/, '');
    const query = url.searchParams.toString();
    return `https://${url.hostname}${path}${query ? `?${query}` : ''}`;
  } catch {
    return null;
  }
}

export function stableJobId(source: string, externalId: string | undefined, sourceUrl: string): string {
  const key = `${source}|${externalId?.trim() || canonicalUrl(sourceUrl) || sourceUrl}`;
  return createHash('sha1').update(key).digest('hex').slice(0, 24);
}

const COMPANY_SUFFIXES =
  /\b(?:inc|llc|ltd|limited|gmbh|ag|se|srl|s\.r\.l|spa|s\.p\.a|bv|b\.v|ab|oy|sas|sa|corp|corporation|co|company|plc|pty|kg|ug|technologies|technology|labs)\b\.?/g;

export function normalizeCompany(company: string): string {
  return company
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(COMPANY_SUFFIXES, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\((?:m\/w\/d|w\/m\/d|f\/m\/d|m\/f\/d|m\/f\/x|f\/m\/x|all genders|d\/f\/m|gn)\)/g, ' ')
    .replace(/[^\p{L}\p{N}+#]+/gu, ' ')
    .trim();
}

// ── Euristiche sul testo ────────────────────────────────────────────────────────

export function detectRemote(text: string): RemoteType {
  const s = text.toLowerCase();
  const hybrid = /\bhybrid\b|\bibrido\b|\bdays? (?:per week )?in (?:the )?office\b/.test(s);
  const onsite = /\bon[- ]?site\b|\bin[- ]office\b|\bin[- ]person\b|\bin sede\b|\bno remote\b/.test(s);
  const remote = /\bremote\b|\bremoto\b|\bwork from (?:home|anywhere)\b|\bdistributed team\b|\btelelavoro\b/.test(s);
  if (hybrid) return 'hybrid';
  if (onsite && remote) return 'hybrid';
  if (onsite) return 'onsite';
  if (remote) return 'full';
  return 'unknown';
}

const CONTRACT_TEXT_RE =
  /\bcontract(?:or)?[- ](?:role|position|basis|opportunity|engagement|job|work)\b|\bindependent contractor\b|\b(?:\d+[- ]months?|long[- ]term|short[- ]term|fixed[- ]term|initial)\s+contract\b|\bcontract[- ]to[- ]hire\b|\bc2c\b|\b1099\b|\bb2b (?:contract|agreement|cooperation|basis)\b|\bpartita iva\b|\bp\.\s?iva\b/;

/** Tipo di contratto: il titolo è il segnale più forte, poi le formule esplicite nel testo. */
export function detectContract(title: string, text: string): ContractType {
  const t = title.toLowerCase();
  if (/\bfreelanc(?:e|er|ing)\b/.test(t)) return 'freelance';
  if (/\bcontract(?:or)?\b|[,(/|]\s*b2b\s*[,)/|]|\bb2b contract\b/.test(t)) return 'contract';
  if (/\bpart[- ]time\b/.test(t)) return 'part-time';
  if (/\bfull[- ]time\b|\bpermanent\b/.test(t)) return 'full-time';

  const head = text.slice(0, 2000).toLowerCase();
  if (
    /\bfreelance (?:role|position|contract|basis|opportunity|project)\b|\blooking for (?:a |an )?(?:\w+ )?freelancer\b/.test(
      head,
    )
  )
    return 'freelance';
  if (CONTRACT_TEXT_RE.test(head)) return 'contract';
  if (/\bpart[- ]time\b/.test(head) && !/\bfull[- ]time\b/.test(head)) return 'part-time';
  if (/\bfull[- ]time\b|\bpermanent\b|\btempo indeterminato\b|\bvollzeit\b|\bfestanstellung\b|\bunbefristet/.test(head))
    return 'full-time';
  return 'unknown';
}

const VAT_RE =
  /\bb2b (?:contract|agreement|cooperation|basis|employment)\b|\b(?:contract|employment)(?: type)?:?\s*b2b\b|\bon (?:a )?b2b\b|\b(?:issue|send|submit|able to|will|must)\s+(?:us\s+)?(?:an? |monthly |your )?invoic(?:e|es|ing)\b|\bown (?:company|legal entity|business)\b|\bself[- ]employed\b|\bindependent contractor\b|\bpartita iva\b|\bp\.\s?iva\b|\bvat (?:number|id|registered)\b|\bfreelance basis\b|\bas (?:a|an independent) contractor\b/i;

/** true: contract/B2B che richiede di fatturare; false: rapporto dipendente; null: non si sa. */
export function detectRequiresVat(contractType: ContractType, text: string): boolean | null {
  if (contractType === 'contract' || contractType === 'freelance') return true;
  if (VAT_RE.test(text)) return true;
  if (contractType === 'full-time' || contractType === 'part-time') return false;
  return null;
}

const EOR_RE =
  /\bemployer of record\b|\bEOR\b|\b(?:via|through|using|with|we use|hired? (?:via|through)|employed (?:via|through)|contract(?:ed)? (?:via|through)|paid (?:via|through))\s+(?:an?\s+)?(?:Deel|Remote\.com|Oyster(?:\s?HR)?|Rippling|Papaya Global|Globalization Partners|Velocity Global|Multiplier|Remofirst)\b|\bDeel\b|\bOyster\s?HR\b|\bRemote\.com\b/;
const EOR_COMPANIES = new Set(['deel', 'oyster', 'oyster hr', 'remote', 'remote com', 'rippling', 'multiplier']);

/** Contratto erogato tramite Employer of Record: non richiede partita IVA. */
export function detectEor(text: string, companyNorm: string): boolean {
  if (EOR_COMPANIES.has(companyNorm)) return false;
  return EOR_RE.test(text);
}

export function detectSeniority(title: string): Seniority {
  const s = title.toLowerCase();
  if (
    /\bintern(?:ship)?\b|\bstagista\b|\bstage\b|\btirocin|\bwerkstudent|\bworking student\b|\btrainee\b|\bapprentice/.test(
      s,
    )
  )
    return 'intern';
  if (/\bjunior\b|\bjr\.?\b|\bentry[- ]level\b|\bgraduate\b|\bassociate\b/.test(s)) return 'junior';
  if (
    /\blead\b|\bprincipal\b|\bstaff\b|\bhead of\b|\bdirector\b|\bvp\b|\barchitect\b|\bmanager\b|\bfounding\b|\bcto\b/.test(
      s,
    )
  )
    return 'lead';
  if (/\bsenior\b|\bsr\.?\b|\bexpert\b/.test(s)) return 'senior';
  if (/\bmid\b|\bmid[- ]level\b|\bmidweight\b|\bintermediate\b|\bmedior\b/.test(s)) return 'mid';
  return 'unknown';
}

// ── Link di candidatura ─────────────────────────────────────────────────────────

const ATS_HOSTS =
  /(?:^|\.)(?:greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|teamtailor\.com|smartrecruiters\.com|personio\.(?:de|com)|recruitee\.com|bamboohr\.com|myworkdayjobs\.com|jobvite\.com|breezy\.hr|pinpointhq\.com|applytojob\.com|icims\.com|join\.com|dover\.com|gem\.com|rippling\.com|workatastartup\.com|factorialhr\.com|homerun\.co|jobs\.eu\.lever\.co)$/i;
const CAREERS_RE =
  /(?:^|\/\/)(?:careers?|jobs?|join|work|hiring|apply)\.|\/(?:careers?|jobs?|join(?:-us)?|open-positions|opportunities|work-with-us|hiring|apply|lavora-con-noi|karriere)(?:[/?#-]|$)/i;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const IGNORED_EMAIL = /no-?reply|donotreply|example\.(?:com|org)|privacy@|unsubscribe|press@|abuse@/i;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function classifyUrl(url: string): ApplyMethod | null {
  if (/^mailto:/i.test(url)) return 'email';
  const host = hostOf(url);
  if (!host) return null;
  if (ATS_HOSTS.test(host)) return 'ats';
  if (CAREERS_RE.test(url)) return 'careers_page';
  return null;
}

export function extractLinks(html: string): string[] {
  const links = [...html.matchAll(/<a\b[^>]*\bhref\s*=\s*"([^"]+)"/gi)].map((m) => decodeEntities(m[1] as string));
  return [...new Set(links)];
}

export interface ApplyTarget {
  applyUrl: string | null;
  applyMethod: ApplyMethod;
}

/**
 * Link diretto per candidarsi: campo della fonte, poi link ad ATS noti / pagine careers /
 * email nella descrizione. Se non c'è nulla si usa la pagina dell'annuncio sulla fonte.
 */
export function extractApplyTarget(input: JobInput, safeHtml: string, text: string): ApplyTarget {
  const sourceHost = hostOf(input.sourceUrl);
  const fallback: ApplyTarget = { applyUrl: input.applyUrl || input.sourceUrl || null, applyMethod: 'source_page' };
  if (input.applyViaSource) return fallback;

  if (input.applyUrl && hostOf(input.applyUrl) !== sourceHost) {
    return { applyUrl: input.applyUrl, applyMethod: classifyUrl(input.applyUrl) ?? 'careers_page' };
  }

  const links = extractLinks(safeHtml).filter((l) => /^mailto:/i.test(l) || hostOf(l) !== sourceHost);
  const web = links.filter((l) => /^https?:/i.test(l));
  const ats = web.find((l) => classifyUrl(l) === 'ats');
  if (ats) return { applyUrl: ats, applyMethod: 'ats' };
  const careers = web.find((l) => classifyUrl(l) === 'careers_page');
  if (careers) return { applyUrl: careers, applyMethod: 'careers_page' };

  const mailto = links.find((l) => /^mailto:/i.test(l) && !IGNORED_EMAIL.test(l));
  if (mailto) return { applyUrl: mailto.split('?')[0] as string, applyMethod: 'email' };
  const email = (text.match(EMAIL_RE) ?? []).find((e) => !IGNORED_EMAIL.test(e));
  if (email && /\b(?:apply|send|email|e-mail|cv|resume|résumé|reach out|contact|candidat|invia|scrivi)/i.test(text)) {
    return { applyUrl: `mailto:${email}`, applyMethod: 'email' };
  }

  if (input.applyFromAnyLink && web[0]) return { applyUrl: web[0], applyMethod: 'careers_page' };
  if (input.applyFromAnyLink && email) return { applyUrl: `mailto:${email}`, applyMethod: 'email' };
  return fallback;
}

// ── Località ────────────────────────────────────────────────────────────────────

/**
 * Vincolo geografico: i campi strutturati della fonte vincono se indicano paesi o aree precise;
 * altrimenti si cercano frasi esplicite nel testo ("US only", "must reside in…").
 */
export function resolveLocationSpec(input: JobInput, title: string, text: string): LocationSpec {
  const structured = input.locationSpec ?? parseLocationSpec(input.location);
  const specific = structured.countries.length > 0 || structured.regions.some((r) => r !== WORLDWIDE);
  if (specific) return structured;
  const fromText = detectRestrictions(`${title}\n${input.location}\n${text}`);
  return isEmptySpec(fromText) ? structured : fromText;
}

// ── Assemblaggio ────────────────────────────────────────────────────────────────

function cleanInline(text: string): string {
  return decodeEntities(text).replace(/\s+/g, ' ').trim();
}

/** Lingua ISO 639-1 di un testo abbastanza lungo, o null. */
export function safeLanguage(text: string): string | null {
  if (text.length < 80) return null;
  try {
    return detectLanguage(text.slice(0, 3000)) || null;
  } catch {
    return null;
  }
}

/** Normalizzazione comune a tutte le fonti: da `JobInput` al modello dell'annuncio. */
export function buildJobCore(input: JobInput): JobCore {
  const title = cleanInline(input.title);
  const company = cleanInline(input.company);
  if (!title || !input.sourceUrl) throw new Error('Annuncio senza titolo o senza URL');

  const descriptionHtml = toSafeHtml(input.descriptionOriginal, input.descriptionIsHtml !== false);
  const descriptionText = htmlToText(descriptionHtml);
  const companyNorm = normalizeCompany(company);

  const remote = input.remoteHint ?? detectRemote(`${title}\n${input.location}\n${descriptionText.slice(0, 2500)}`);
  const contractType = input.contractHint ?? detectContract(title, descriptionText);
  const viaEor = detectEor(descriptionText, companyNorm);
  const requiresVat = detectRequiresVat(contractType, `${title}\n${descriptionText}`);

  // prima i campi strutturati della fonte, poi il testo (titolo, quindi descrizione). Mai stime.
  const salary: ParsedSalary | null = input.salary ?? parseSalary(title) ?? parseSalary(descriptionText);
  const spec = resolveLocationSpec(input, title, descriptionText);
  const apply = extractApplyTarget(input, descriptionHtml, descriptionText);
  const dedupeUrl =
    apply.applyMethod === 'ats' || apply.applyMethod === 'careers_page' ? apply.applyUrl : input.sourceUrl;

  return {
    id: stableJobId(input.source, input.externalId, input.sourceUrl),
    source: input.source,
    sourceUrl: input.sourceUrl,
    canonicalUrl: canonicalUrl(dedupeUrl),
    externalId: input.externalId?.trim() || null,
    title,
    company,
    companyUrl: input.companyUrl ?? null,
    titleNorm: normalizeTitle(title),
    companyNorm,
    descriptionOriginal: input.descriptionOriginal,
    descriptionHtml,
    descriptionText,
    language: safeLanguage(descriptionText),
    applyUrl: apply.applyUrl,
    applyMethod: apply.applyMethod,
    techStack: extractTechStack({ title, description: descriptionText, tags: input.tags }),
    salaryFound: salary !== null,
    salaryRawText: salary?.rawText ?? null,
    salaryMin: salary?.min ?? null,
    salaryMax: salary?.max ?? null,
    salaryCurrency: salary?.currency ?? null,
    salaryPeriod: salary?.period ?? null,
    tags: [...new Set(input.tags.map(cleanInline).filter(Boolean))].slice(0, 40),
    location: cleanInline(input.location),
    remote,
    regions: spec.regions,
    restrictedCountries: spec.countries,
    timezoneOffsets: input.timezoneOffsets ?? parseTimezoneRequirement(`${input.location}\n${descriptionText}`),
    contractType,
    requiresVat,
    viaEor,
    seniority: input.seniorityHint ?? detectSeniority(title),
    publishedAt: input.publishedAt ?? null,
  };
}
