/**
 * Riconoscimento delle email di candidatura (ricevute e rifiuti) e abbinamento alle candidature
 * già registrate. Logica pura, senza rete: portata da job-compiler, dove scriveva su un foglio Google.
 */

/** lowercase + strip accents + collapse whitespace. */
export function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s\u00a0]+/g, ' ')
    .trim();
}

/** One received message, as returned by the Gmail API. */
export interface MailItem {
  threadId: string;
  /** Sender display name and address. */
  name: string;
  email: string;
  subject: string;
  snippet: string;
  /** YYYY-MM-DD */
  date: string;
  /** Istante di ricezione (ms), quando noto. */
  timestamp?: number;
  /** Plain-text body (HTML converted with htmlToText). */
  body?: string;
}

export interface MailVerdict {
  accept: boolean;
  reason: string;
  company: string;
  title: string;
  location: string;
  portal: string;
}

/** lowercase, no accents, punctuation collapsed to spaces: for phrase matching only. */
const flat = (s: string) =>
  ` ${norm(s)
    .replace(/[^a-z0-9+#]+/g, ' ')
    .trim()} `;
const hasAny = (hay: string, phrases: string[]) => phrases.find((p) => hay.includes(` ${p} `));

/* ------------------------------------------------------------------ */
/* Gmail searches                                                       */
/* ------------------------------------------------------------------ */

/**
 * Phrases that only an application receipt contains (it / fr / en).
 * They are both the Gmail search and the local check a mail must pass to be counted.
 */
const RECEIPT_PHRASES = [
  'candidatura inviata',
  'candidatura è stata inviata',
  'candidatura eseguita con successo',
  'grazie per la candidatura',
  'grazie per la tua candidatura',
  'grazie per esserti candidato',
  'grazie per esserti candidata',
  'abbiamo ricevuto la tua candidatura',
  'candidatura è stata ricevuta',
  'candidature envoyée',
  'candidature a été envoyée',
  'candidature a bien été reçue',
  'merci pour votre candidature',
  'bien reçu votre candidature',
  'application was sent',
  'application has been submitted',
  'application submitted',
  'submitted successfully',
  'application has been received',
  'application received',
  'received successfully',
  'received your application',
  'thank you for applying',
  'thanks for applying',
  'thank you for your application',
  'thanks for your application',
  'Indeed Application',
];
const RECEIPT_FLAT = RECEIPT_PHRASES.map((p) => flat(p).trim());

/** Received mail only: your own sent mail is never a receipt. */
export function receivedQuery(days: number, extra = ''): string {
  const phrases = RECEIPT_PHRASES.map((p) => `"${p}"`).join(' OR ');
  return `-in:sent -in:drafts -in:chats newer_than:${days}d (${phrases}) ${extra}`.trim();
}

/* ------------------------------------------------------------------ */
/* Classification                                                       */
/* ------------------------------------------------------------------ */

/** Checked on subject + preview only: bodies carry footers ("similar jobs", "newsletter",
 * "never accept an offer without an interview") that would reject real receipts. */
const IGNORE_HEAD: { reason: string; phrases: string[] }[] = [
  {
    reason: 'avviso di offerte',
    phrases: [
      'nuove offerte',
      'offerte di lavoro per te',
      'offerte simili',
      'lavori consigliati',
      'offerte consigliate',
      'job alert',
      'jobs for you',
      'recommended jobs',
      'similar jobs',
      'offres d emploi',
      'nouvelles offres',
      'offres similaires',
      'offres recommandees',
      'newsletter',
    ],
  },
  {
    reason: 'candidatura non completata',
    phrases: [
      'completa la tua candidatura',
      'completa la candidatura',
      'complete your application',
      'finish your application',
      'terminez votre candidature',
      'finalisez votre candidature',
    ],
  },
  {
    reason: 'invito a colloquio',
    phrases: [
      'invito a colloquio',
      'invito al colloquio',
      'fissare un colloquio',
      'interview invitation',
      'invitation to interview',
      'schedule an interview',
      'schedule a call',
      'invitation a un entretien',
      'convocation a un entretien',
      'planifier un entretien',
    ],
  },
  {
    reason: 'promemoria del portale',
    phrases: [
      'distinguiti',
      'distinguerti',
      'distinguez vous',
      'stand out',
      'conferma il tuo interesse',
      'confirm your interest',
      'confirmez votre interet',
    ],
  },
  {
    reason: 'non è una candidatura di lavoro',
    phrases: [
      'payment confirmation',
      'conferma di pagamento',
      'conferma pagamento',
      'travel authorisation',
      'travel authorization',
      'visa application',
      'confirmation de paiement',
    ],
  },
];

/** Wording of a rejection (it / fr / en), already flattened (no accents or punctuation). */
const REJECTION_PHRASES = [
  'purtroppo',
  'unfortunately',
  'malheureusement',
  'non e stata selezionata',
  'non e stato selezionato',
  // "altri candidati" alone also appears in portal nudges ("distinguerti dagli altri candidati")
  'non proseguire',
  'non procedere',
  'non dare seguito',
  'con altri candidati',
  'con altri profili',
  'profilo non in linea',
  'posizione e stata chiusa',
  'non e stata accolta',
  'not to move forward',
  'not moving forward',
  'will not be moving forward',
  'not been selected',
  'not been successful',
  'was unsuccessful',
  'with other candidates',
  'regret to inform',
  'decided to proceed with',
  'decided not to proceed',
  'position has been filled',
  'no longer considering',
  'pas ete retenue',
  'pas ete retenu',
  'ne pas donner suite',
  'pas pu donner suite',
  'retenir d autres',
  'ne correspond pas',
  'deciso di proseguire con',
];

/** Rejections often open with "thanks for your application…": also check the first lines of the body. */
const IGNORE_OPENING = { reason: 'esito negativo', phrases: REJECTION_PHRASES };
/** How much of the body counts as its opening. */
const OPENING_CHARS = 500;

/** Senders whose display name is the portal, not the company. */
const PORTALS: { match: string; name: string }[] = [
  { match: 'indeed', name: 'Indeed' },
  { match: 'linkedin', name: 'LinkedIn' },
  { match: 'welcometothejungle', name: 'Welcome to the Jungle' },
  { match: 'glassdoor', name: 'Glassdoor' },
  { match: 'infojobs', name: 'InfoJobs' },
  { match: 'monster', name: 'Monster' },
  { match: 'hellowork', name: 'HelloWork' },
  { match: 'apec.fr', name: 'APEC' },
  { match: 'francetravail', name: 'France Travail' },
  { match: 'jobteaser', name: 'JobTeaser' },
  { match: 'subito', name: 'Subito' },
];

/** Applicant-tracking systems: the display name is usually the company, the domain is not. */
const ATS: { match: string; name: string }[] = [
  { match: 'greenhouse', name: 'Greenhouse' },
  { match: 'lever.co', name: 'Lever' },
  { match: 'workday', name: 'Workday' },
  { match: 'smartrecruiters', name: 'SmartRecruiters' },
  { match: 'teamtailor', name: 'Teamtailor' },
  { match: 'recruitee', name: 'Recruitee' },
  { match: 'personio', name: 'Personio' },
  { match: 'workable', name: 'Workable' },
  { match: 'ashbyhq', name: 'Ashby' },
  { match: 'breezy', name: 'Breezy' },
  { match: 'bamboohr', name: 'BambooHR' },
  { match: 'successfactors', name: 'SuccessFactors' },
  { match: 'icims', name: 'iCIMS' },
  { match: 'taleo', name: 'Taleo' },
  { match: 'inrecruiting', name: 'inRecruiting' },
];

const WEBMAIL = [
  'gmail.',
  'googlemail.',
  'outlook.',
  'hotmail.',
  'live.',
  'yahoo.',
  'icloud.',
  'libero.it',
  'virgilio.it',
  'orange.fr',
  'free.fr',
];

// Lookahead shared by every capture: stop at end, sentence punctuation or a separator.
// A dot only ends a sentence when followed by a space, so "Node.js" survives.
const END = String.raw`(?=$|[\n!|;?]|[.,:](?:\s|$)|\s[-–·]\s`;
// Titles also stop before the verb: "candidatura per X è stata inoltrata…".
// "…pour le poste X et nous vous en remercions": a conjunction followed by a pronoun ends it too.
const TEND = String.raw`${END}|\s+(?:è|e'|ha|has|have|was|is|a|est|shortly|\(Ref)\b|\s+(?:et|and|e)\s+(?:nous|vous|we|you|ti|vi)\b`;
const CAP = String.raw`([A-Z0-9À-Ý][^\n!|;?]{1,60}?)`;

const COMPANY_RES: RegExp[] = [
  new RegExp(String.raw`(?:inviata|inoltrata|inviati)\s+(?:a|ad)\s+(.+?)${END}|\s+per\s|\s+tramite\s)`, 'i'),
  new RegExp(String.raw`envoy[ée]e?s?\s+(?:à|a|chez)\s+(.+?)${END}|\s+pour\s|\s+via\s)`, 'i'),
  new RegExp(String.raw`(?:sent|submitted)\s+to\s+(.+?)${END}|\s+for\s|\s+via\s)`, 'i'),
  // company names start with a capital: no 'i' flag from here on
  new RegExp(String.raw`(?:[Ii]nterest in joining|[Ii]nteresse per|[Ii]ntérêt pour)\s+${CAP}${END}|\s+and\s)`),
  new RegExp(String.raw`(?:applying|applied|application)\s+(?:to|with|at)\s+(?:join\s+)?${CAP}${END}|\s+for\s|\s+—\s)`),
  new RegExp(String.raw`\b(?:at|presso|chez)\s+${CAP}${END})`),
  // subject "AI Engineer position - AISG - Alex …": the company follows the dash
  /^.+?\s+(?:position|role|posizione)\s+[-–]\s+([A-Z0-9][^\n|]{1,40}?)(?=\s+[-–]\s|$)/m,
];

const TITLE_RES: RegExp[] = [
  /^(?:indeed application|candidatura indeed|candidatures? (?:via )?indeed)\s*[:\-–]\s*(.+)$/im,
  /^candidatura per (.+?) attraverso indeed/im,
  /^candidature pour (.+?) via indeed/im,
  // Workable: "Your application for the X job was submitted" — X may contain " - "
  /application for the\s+(.+?)\s+(?:job|position|role)\b/i,
  new RegExp(String.raw`(?:for|of)\s+the\s+position\s+of\s+(.+?)${TEND})`, 'i'),
  new RegExp(
    String.raw`review(?:ed)? your application for\s+(?:the\s+)?(?:(?:position|role)\s+(?:of\s+)?)?(.+?)${TEND})`,
    'i',
  ),
  // subject "AI Engineer position - AISG - Alex …"
  /^(.+?)\s+(?:position|role|posizione)\s+[-–]\s+/im,
  /interest in the\s+(.+?)\s+(?:position|role|job)\b/i,
  new RegExp(String.raw`con successo per\s+(.+?)${TEND})`, 'i'),
  new RegExp(
    String.raw`(?:posizione|ruolo|figura)\s+(?:di\s+|come\s+)?["«“']?(.+?)["»”']?${TEND}|\s+(?:presso|at|chez|in)\s)`,
    'i',
  ),
  new RegExp(String.raw`poste\s+(?:de\s+|d')\s*["«“]?(.+?)["»”]?${TEND}|\s+(?:chez|au sein|à)\s)`, 'i'),
  // tempered token: in "applying for the X position" the capture must not swallow "applying for"
  /\bfor\s+(?:the\s+)?["“']?((?:(?!\bfor\b)[^"”'\n]){3,80}?)["”']?\s+(?:position|role)\b/i,
  new RegExp(String.raw`(?:position|role)\s*[:\-–]\s*(.+?)${TEND}|\s+(?:at|presso|chez)\s)`, 'i'),
  new RegExp(
    String.raw`(?:application|candidatura|candidature)\s+(?:for|per|pour)\s+(?:the\s+|la\s+|le\s+)?(?:poste\s+(?:de\s+|d')?|posizione\s+(?:di\s+)?|position\s+(?:of\s+)?)?["“']?(.+?)["”']?${TEND}|\s+(?:at|presso|chez|@)\s)`,
    'i',
  ),
  /^(?:(?:re|fwd?|r|i):\s*)*(?:candidatura|candidature|application)(?:\s+spontanea|\s+spontan[ée]e)?\s*[:\-–]\s*(.+?)(?:\s[-–]\s.*)?$/im,
];

function clean(s: string | undefined): string {
  const v = (s ?? '')
    .replace(/^[\s"'«“]+|[\s"'»”.:!,;\-–]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return v.length >= 2 && v.length <= 90 ? v : '';
}

/** "application for a job", "candidature pour ce poste": a match, but not a job title. */
const GENERIC_TITLE =
  /^(?:a|an|the|this|our|your|un|une|ce|cette|le|la|il|lo|questa|questo)?\s*(?:job|position|role|opening|vacancy|poste|offre|posizione|ruolo|offerta|annuncio)?$/i;

function firstMatch(res: RegExp[], text: string): string {
  for (const re of res) {
    const v = clean(text.match(re)?.[1]);
    if (v && !GENERIC_TITLE.test(v)) return v;
  }
  return '';
}

function domainOf(email: string): string {
  return (email.split('@')[1] ?? '').toLowerCase();
}

function lookup(table: { match: string; name: string }[], email: string, name: string): string {
  const hay = `${domainOf(email)} ${name.toLowerCase().replace(/\s+/g, '')}`;
  return table.find((t) => hay.includes(t.match))?.name ?? '';
}

/** "Acme Careers" → "Acme"; "noreply@careers.acme-group.it" → "Acme Group". */
export function companyFromSender(name: string, email: string): string {
  const fromName = clean(
    name
      .replace(/\b(via|tramite)\s+\S+.*$/i, '')
      .replace(
        /\b(careers?|carri[eè]res?|recruiting|recruitment|recrutement|talent acquisition|talent|hr|rh|human resources|ressources humaines|risorse umane|hiring team|hiring|jobs?|team|no-?reply|notifications?|recruiter)\b/gi,
        ' ',
      ),
  );
  // "marine.paraire" is a person's address shown as the name: fall back to the domain.
  const looksLikeAddress = /^[a-z0-9]+(?:[._-][a-z0-9]+)+$/.test(fromName);
  if (fromName && !fromName.includes('@') && !looksLikeAddress) return fromName;

  const domain = domainOf(email);
  if (!domain || WEBMAIL.some((w) => domain.includes(w)) || lookup(ATS, email, '')) return '';
  const parts = domain.split('.');
  const root = parts.length >= 2 ? parts[parts.length - 2]! : parts[0]!;
  return root
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/* ------------------------------------------------------------------ */
/* HTML to text                                                         */
/* ------------------------------------------------------------------ */

const ENTITIES: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Mail HTML to plain text, keeping one line per block so layouts like Indeed's stay readable. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(?:p|div|tr|li|h\d|table)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&(\w+);/g, (m, n: string) => ENTITIES[n] ?? m)
    .replace(/[\u200b-\u200d]|\u034f|\u00ad|\ufeff|\u2060/g, '')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n[\s]*/g, '\n')
    .trim();
}

/* ------------------------------------------------------------------ */
/* Classification                                                       */
/* ------------------------------------------------------------------ */

const INDEED_SENT_TO =
  /(?:were sent to|sono stati inviati a|ont été envoyés à|wurden an)\s+(.+?)(?:\.(?:\s|$)|\s+gesendet)/i;

/**
 * Indeed confirmations have a fixed layout in every language:
 *   <status> / <title> / <company> / - <location> / [N reviews] / "…sent to <company>."
 */
export function parseIndeedBody(body: string): { company: string; title: string; location: string } {
  const out = { company: '', title: '', location: '' };
  const lines = body
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const i = lines.findIndex((l) => INDEED_SENT_TO.test(l));
  if (i < 0) return out;
  out.company = clean(lines[i]!.match(INDEED_SENT_TO)![1]);
  for (let k = i - 1; k >= 2; k--) {
    if (!lines[k]!.startsWith('- ')) continue;
    out.location = clean(lines[k]!.slice(2));
    if (normCompany(lines[k - 1]!) === normCompany(out.company)) out.title = clean(lines[k - 2]);
    break;
  }
  return out;
}

export function classifyMail(m: MailItem, ignoreSenders: string[] = []): MailVerdict {
  const none = { company: '', title: '', location: '', portal: '' };
  const body = m.body ?? '';
  // HTML mails wrap sentences over several lines: regexes run on the flattened text.
  const bodyText = body.replace(/\s*\n\s*/g, ' ');
  const head = flat(`${m.subject}\n${m.snippet}`);

  const ignoredSender = ignoreSenders.find((s) => m.email.toLowerCase().includes(s.toLowerCase()));
  if (ignoredSender) return { accept: false, reason: `mittente ignorato (${ignoredSender})`, ...none };

  for (const rule of IGNORE_HEAD) {
    const hit = hasAny(head, rule.phrases);
    if (hit) return { accept: false, reason: `${rule.reason} ("${hit}")`, ...none };
  }
  const rejected = hasAny(
    flat(`${m.subject}\n${m.snippet}\n${bodyText.slice(0, OPENING_CHARS)}`),
    IGNORE_OPENING.phrases,
  );
  if (rejected) return { accept: false, reason: `${IGNORE_OPENING.reason} ("${rejected}")`, ...none };

  // Gmail's match is loose (stemming, any part of the thread): require the phrase in this mail.
  const receipt = hasAny(flat(`${m.subject}\n${m.snippet}\n${bodyText}`), RECEIPT_FLAT);
  if (!receipt) return { accept: false, reason: 'nessuna frase di ricevuta candidatura', ...none };

  const found = extractApplication(m);
  if (!found.company && !found.title)
    return { accept: false, reason: 'né azienda né posizione riconoscibili', ...none };
  return { accept: true, reason: 'ok', ...found };
}

/** Company, job title, location and portal of the application a mail talks about. */
function extractApplication(m: MailItem): { company: string; title: string; location: string; portal: string } {
  const body = m.body ?? '';
  const portal = lookup(PORTALS, m.email, m.name) || lookup(ATS, m.email, m.name);
  const isPortal = !!lookup(PORTALS, m.email, m.name);

  const indeed = domainOf(m.email).includes('indeed')
    ? parseIndeedBody(body)
    : { company: '', title: '', location: '' };
  let { company, title } = indeed;
  const { location } = indeed;

  // The preview is cut mid-sentence ("…your application for Senior"): prefer the body.
  const text = body.replace(/\s*\n\s*/g, ' ').slice(0, 2000) || m.snippet;
  title ||= firstMatch(TITLE_RES, m.subject) || firstMatch(TITLE_RES, text);
  company ||= firstMatch(COMPANY_RES, m.subject) || firstMatch(COMPANY_RES, text);
  if (company && title && norm(company) === norm(title)) company = '';
  if (!company && !isPortal) company = companyFromSender(m.name, m.email);
  return { company, title, location, portal: portal || 'Sito aziendale' };
}

/* ------------------------------------------------------------------ */
/* Rejections                                                           */
/* ------------------------------------------------------------------ */

/** The rejection must be about an application, not "unfortunately your payment failed". */
const APPLICATION_CONTEXT = [
  'candidatura',
  'candidature',
  'candidato',
  'candidata',
  'application',
  'applying',
  'applied',
  'posizione',
  'position',
  'poste',
  'role',
  'ruolo',
  'selezione',
  'recrutement',
  'recruitment',
];
/** Rejections can open with a long thank-you: look a bit further than for receipts. */
const REJECTION_WINDOW = 1500;

/** Received mail with rejection wording (Gmail side; classifyRejection decides). */
export function rejectionQuery(days: number, extra = ''): string {
  const words = [
    'purtroppo',
    'unfortunately',
    'malheureusement',
    '"not moving forward"',
    '"not to move forward"',
    '"not been selected"',
    '"with other candidates"',
    '"con altri candidati"',
    '"d\'autres candidats"',
    '"pas été retenue"',
    '"ne pas donner suite"',
    '"regret to inform"',
    '"position has been filled"',
  ].join(' OR ');
  return `-in:sent -in:drafts -in:chats newer_than:${days}d (candidatura OR candidature OR application OR applying) (${words}) ${extra}`.trim();
}

export function classifyRejection(m: MailItem, ignoreSenders: string[] = []): MailVerdict {
  const none = { company: '', title: '', location: '', portal: '' };
  if (ignoreSenders.some((s) => m.email.toLowerCase().includes(s.toLowerCase()))) {
    return { accept: false, reason: 'mittente ignorato', ...none };
  }
  const head = flat(`${m.subject}\n${m.snippet}`);
  for (const rule of IGNORE_HEAD.filter((r) => r.reason !== 'invito a colloquio')) {
    const hit = hasAny(head, rule.phrases);
    if (hit) return { accept: false, reason: `${rule.reason} ("${hit}")`, ...none };
  }
  const opening = flat(
    `${m.subject}\n${m.snippet}\n${(m.body ?? '').replace(/\s*\n\s*/g, ' ').slice(0, REJECTION_WINDOW)}`,
  );
  const hit = hasAny(opening, REJECTION_PHRASES);
  if (!hit) return { accept: false, reason: 'nessuna frase di rifiuto', ...none };
  if (!hasAny(opening, APPLICATION_CONTEXT)) return { accept: false, reason: 'non parla di una candidatura', ...none };
  const found = extractApplication(m);
  if (!found.company && !found.title)
    return { accept: false, reason: 'né azienda né posizione riconoscibili', ...none };
  return { accept: true, reason: `rifiuto ("${hit}")`, ...found };
}

/** A sheet row, as far as matching a rejection is concerned. `row` is the 1-based sheet row. */
export interface SheetRow {
  row: number;
  key: string;
  date: string;
  company: string;
  title: string;
  status: string;
  notes: string;
}

export const REJECTED = 'RIFIUTATA';
/** Statuses that already mean "rejected", whoever wrote them. */
const REJECTED_FLAT = ['rifiutata', 'rifiutato', 'rejected', 'refusee', 'refuse', 'scartata', 'respinta'];
export const isRejectedStatus = (s: string) => !!hasAny(flat(s), REJECTED_FLAT);

/** Marker left in the Note column so a rejection mail is applied once, even if you edit the status later. */
export const rejectionMarker = (threadId: string) => `rifiuto: mail-${threadId}`;

export type RejectionMatch =
  { kind: 'row'; row: SheetRow } | { kind: 'ambiguous'; rows: SheetRow[] } | { kind: 'none' };

/**
 * The application a rejection refers to. The same company is required; when the mail
 * names the job, the title must be similar too. Rejections arrive weeks later, so dates
 * only exclude rows written after the rejection. Several candidates with no way to tell
 * them apart → ambiguous, and nothing is changed.
 */
export function matchRejection(rej: AppSummary & { threadId: string }, rows: SheetRow[]): RejectionMatch {
  const sameThread = rows.find((r) => r.key === `mail-${rej.threadId}`);
  if (sameThread) return { kind: 'row', row: sameThread };

  let candidates = rows.filter(
    (r) =>
      sameCompany(r.company, rej.company) &&
      !isRejectedStatus(r.status) &&
      !(Date.parse(r.date) > Date.parse(rej.date) + 86_400_000),
  );
  if (rej.title) {
    const titled = candidates.filter((r) => r.title && similarTitle(r.title, rej.title));
    if (titled.length) candidates = titled;
    else candidates = candidates.filter((r) => !r.title);
  }
  if (candidates.length === 1) return { kind: 'row', row: candidates[0]! };
  if (candidates.length > 1) return { kind: 'ambiguous', rows: candidates };
  return { kind: 'none' };
}

/* ------------------------------------------------------------------ */
/* Duplicate detection                                                  */
/* ------------------------------------------------------------------ */

const LEGAL =
  /\b(s ?r ?l ?s?|s ?p ?a|s ?a ?s|s ?n ?c|sarl|sas|sa|ltd|limited|inc|llc|gmbh|group|gruppo|groupe|italia|italy|france|spa|srl)\b/g;

export function normCompany(s: string): string {
  return flat(s).replace(LEGAL, ' ').replace(/\s+/g, ' ').trim();
}

const words = (s: string) =>
  new Set(
    flat(s)
      .trim()
      .split(' ')
      .filter((w) => w.length > 1),
  );

function sameCompany(a: string, b: string): boolean {
  const ca = normCompany(a);
  const cb = normCompany(b);
  if (!ca || !cb) return false;
  return ca === cb || (Math.min(ca.length, cb.length) >= 4 && (ca.includes(cb) || cb.includes(ca)));
}

function similarTitle(a: string, b: string): boolean {
  const na = flat(a).trim();
  const nb = flat(b).trim();
  if (!na || !nb) return false;
  if (na.includes(nb) || nb.includes(na)) return true;
  const wa = words(a);
  const wb = words(b);
  const common = [...wa].filter((w) => wb.has(w)).length;
  return common / Math.min(wa.size, wb.size) >= 0.6;
}

const dayDiff = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;

export interface AppSummary {
  company: string;
  title: string;
  date: string;
}

/**
 * Same application seen twice (e.g. a row the bot wrote after applying on Indeed,
 * and Indeed's confirmation email for it). Company must match; then the titles must be
 * similar, or — when one side has no title — the dates must be within 3 days.
 */
export function sameApplication(a: AppSummary, b: AppSummary): boolean {
  if (normCompany(a.company) && normCompany(b.company)) {
    if (!sameCompany(a.company, b.company)) return false;
    if (a.title && b.title) return similarTitle(a.title, b.title);
    const d = dayDiff(a.date, b.date);
    return Number.isFinite(d) && d <= 3;
  }
  // No company on one side: only an identical title on nearby dates counts.
  if (!a.title || !b.title || flat(a.title) !== flat(b.title)) return false;
  const d = dayDiff(a.date, b.date);
  return Number.isFinite(d) && d <= 3;
}
