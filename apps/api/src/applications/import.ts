import type { ApplicationChannel, ApplicationImportRow, ApplicationStatus } from '@jobagg/shared';
import { createHash } from 'node:crypto';
import { parseCsv } from '../common/csv';

/** Una candidatura letta dal file, già mappata sui campi dell'app. */
export interface ImportedApplication {
  row: number;
  externalId: string;
  appliedAt: Date;
  company: string;
  title: string;
  location: string;
  portal: string;
  url: string;
  cvSent: string;
  cvLanguage: string;
  trackingMode: string;
  status: ApplicationStatus;
  /** stato come scritto nel file, se dice più dello stato normalizzato (es. "SALTATA (account richiesto)") */
  statusDetail: string | null;
  /** data del cambio di stato, quando il file la riporta (es. "rifiuto: … (2026-09-01)") */
  statusDate: Date | null;
  notes: string;
  country: string;
  channel: ApplicationChannel;
  salaryRawText: string;
  contactName: string;
  contactEmail: string;
}

export interface ImportParseResult {
  rows: ImportedApplication[];
  errors: ApplicationImportRow[];
  warnings: ApplicationImportRow[];
  recognizedColumns: string[];
  ignoredColumns: string[];
}

type Field =
  | 'externalId'
  | 'appliedAt'
  | 'company'
  | 'title'
  | 'location'
  | 'portal'
  | 'url'
  | 'cvSent'
  | 'cvLanguage'
  | 'trackingMode'
  | 'status'
  | 'notes'
  | 'country'
  | 'channel'
  | 'salaryRawText'
  | 'contactName'
  | 'contactEmail';

/** Intestazioni riconosciute (senza accenti, minuscole): quelle del foglio "candidature" e quelle dell'export dell'app. */
const HEADERS: Record<Field, string[]> = {
  externalId: ['id offerta', 'id candidatura', 'id'],
  appliedAt: ['data candidatura', 'data', 'date'],
  company: ['azienda', 'company', 'societa'],
  title: ['posizione', 'ruolo', 'position', 'title', 'titolo'],
  location: ['localita', 'location', 'sede', 'luogo'],
  portal: ['portale', 'fonte', 'source'],
  url: ['link offerta', 'link', 'url'],
  cvSent: ['cv inviato', 'cv'],
  cvLanguage: ['lingua', 'lingua cv'],
  trackingMode: ['modalita'],
  status: ['stato', 'status'],
  notes: ['note', 'notes'],
  country: ['nazione', 'paese', 'country'],
  channel: ['canale', 'channel'],
  salaryRawText: ['ral', 'retribuzione', 'salary'],
  contactName: ['contatto', 'contact'],
  contactEmail: ['email', 'email contatto', 'e-mail'],
};

const normalize = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const STATUS_PATTERNS: Array<[RegExp, ApplicationStatus]> = [
  [/^saltat|^skip/, 'skipped'],
  [/^rifiut|^reject|^scartat/, 'rejected'],
  [/^colloqui|^interview/, 'interview'],
  [/^screening/, 'screening'],
  [/^offert|^offer/, 'offer'],
  [/^accettat|^accepted/, 'accepted'],
  [/^ritirat|^withdrawn/, 'withdrawn'],
  [/^nessuna risposta|^no[ _]response/, 'no_response'],
  [/^inviat|^candidatura inviata|^applied|^sent/, 'applied'],
];

export function mapStatus(raw: string): ApplicationStatus | null {
  const s = normalize(raw);
  if (!s) return 'applied';
  return STATUS_PATTERNS.find(([re]) => re.test(s))?.[1] ?? null;
}

const ATS =
  /workday|ashby|workable|smartrecruiters|lever|teamtailor|greenhouse|personio|recruitee|bamboohr|jobvite|icims/;
const JOB_BOARDS =
  /indeed|glassdoor|infojobs|monster|welcome to the jungle|stepstone|remote ?ok|remotive|jobicy|himalayas/;

/** Canale della candidatura dedotto dal portale indicato nel file. */
export function channelFromPortal(portal: string): ApplicationChannel {
  const p = normalize(portal);
  if (!p) return 'other';
  if (p.includes('linkedin')) return 'linkedin';
  if (ATS.test(p)) return 'ats';
  if (JOB_BOARDS.test(p)) return 'job_board';
  if (/sito aziendale|careers?|company site|sito/.test(p)) return 'careers_page';
  if (/e-?mail/.test(p)) return 'email';
  if (/referral|passaparola|segnalazione/.test(p)) return 'referral';
  return 'other';
}

/** Date nei formati AAAA-MM-GG (anche con orario) e GG/MM/AAAA; mezzogiorno UTC per non slittare di giorno. */
export function parseDate(raw: string): Date | null {
  const s = raw.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  let parts: [number, number, number] | null = m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  if (!parts) {
    m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(s);
    if (m) parts = [Number(m[3]), Number(m[2]), Number(m[1])];
  }
  if (!parts) return null;
  const [y, mo, d] = parts;
  const date = new Date(Date.UTC(y, mo - 1, d, 12));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d ? date : null;
}

const CHANNELS: ApplicationChannel[] = ['ats', 'careers_page', 'job_board', 'email', 'linkedin', 'referral', 'other'];

/**
 * Legge un CSV di candidature (es. il foglio "ID offerta, Data candidatura, Azienda, Posizione, Località,
 * Portale, Link offerta, CV inviato, Lingua, Modalità, Stato, Note, Nazione") e lo mappa sui campi dell'app.
 * Funzione pura: non tocca il database. Le righe non interpretabili finiscono in `errors`, mai importate a metà.
 */
export function parseApplicationsCsv(content: string): ImportParseResult {
  const result: ImportParseResult = { rows: [], errors: [], warnings: [], recognizedColumns: [], ignoredColumns: [] };
  const table = parseCsv(content);
  const header = table[0];
  if (!header) {
    result.errors.push({ row: 1, message: 'Il file è vuoto' });
    return result;
  }

  const columns = new Map<Field, number>();
  header.forEach((name, index) => {
    const key = normalize(name);
    if (!key) return;
    const field = (Object.keys(HEADERS) as Field[]).find((f) => HEADERS[f].includes(key) && !columns.has(f));
    if (field) {
      columns.set(field, index);
      result.recognizedColumns.push(name.trim());
    } else result.ignoredColumns.push(name.trim());
  });
  if (!columns.has('company') && !columns.has('title')) {
    result.errors.push({ row: 1, message: 'Intestazioni non riconosciute: servono almeno "Azienda" o "Posizione"' });
    return result;
  }
  if (!columns.has('appliedAt')) {
    result.errors.push({ row: 1, message: 'Manca la colonna "Data candidatura"' });
    return result;
  }

  const seen = new Set<string>();
  table.slice(1).forEach((cells, i) => {
    const row = i + 2;
    const get = (field: Field) =>
      columns.has(field) ? (cells[columns.get(field)!] ?? '').replace(/\s+/g, ' ').trim() : '';
    const company = get('company');
    const title = get('title');
    if (!company && !title) {
      result.errors.push({ row, message: 'Riga senza azienda né posizione' });
      return;
    }
    const appliedAt = parseDate(get('appliedAt'));
    if (!appliedAt) {
      result.errors.push({ row, message: `Data non valida: "${get('appliedAt')}" (attesa AAAA-MM-GG o GG/MM/AAAA)` });
      return;
    }
    const statusRaw = get('status');
    let status = mapStatus(statusRaw);
    if (!status) {
      result.warnings.push({ row, message: `Stato "${statusRaw}" non riconosciuto: importata come "inviata"` });
      status = 'applied';
    }
    // senza ID nel file se ne deriva uno stabile, così reimportare lo stesso file non crea doppioni
    const externalId =
      get('externalId') ||
      `import-${createHash('sha1')
        .update(`${normalize(company)}|${normalize(title)}|${appliedAt.toISOString().slice(0, 10)}`)
        .digest('hex')
        .slice(0, 16)}`;
    if (seen.has(externalId)) {
      result.warnings.push({ row, message: `ID "${externalId}" ripetuto nel file: riga ignorata` });
      return;
    }
    seen.add(externalId);

    const notes = get('notes');
    const statusDate = /\((\d{4}-\d{2}-\d{2})\)/.exec(
      notes.slice(notes.search(/rifiut|reject|colloqui|interview/i)),
    )?.[1];
    const portal = get('portal');
    const channelRaw = normalize(get('channel')).replace(/ /g, '_') as ApplicationChannel;
    const url = get('url');
    result.rows.push({
      row,
      externalId,
      appliedAt,
      company,
      title,
      location: get('location'),
      portal,
      url: /^https?:\/\//i.test(url) ? url : '',
      cvSent: get('cvSent'),
      cvLanguage: get('cvLanguage'),
      trackingMode: get('trackingMode'),
      status,
      statusDetail: statusRaw && /[(:-]/.test(statusRaw) ? statusRaw : null,
      statusDate: status !== 'applied' && statusDate ? parseDate(statusDate) : null,
      notes,
      country: get('country'),
      channel: CHANNELS.includes(channelRaw) ? channelRaw : channelFromPortal(portal),
      salaryRawText: /^non indicata$/i.test(get('salaryRawText')) ? '' : get('salaryRawText'),
      contactName: get('contactName'),
      contactEmail: get('contactEmail'),
    });
    if (url && !/^https?:\/\//i.test(url)) result.warnings.push({ row, message: 'Link non valido: ignorato' });
  });
  return result;
}
