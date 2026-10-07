import { htmlToText, type MailItem } from './parse';

/** Sottoinsieme della risposta `users.messages.get` (format=full) dell'API Gmail che ci serve. */
export interface GmailMessagePart {
  mimeType?: string | null;
  filename?: string | null;
  headers?: Array<{ name?: string | null; value?: string | null }> | null;
  body?: { data?: string | null; attachmentId?: string | null } | null;
  parts?: GmailMessagePart[] | null;
}

export interface GmailMessage {
  id?: string | null;
  threadId?: string | null;
  internalDate?: string | null;
  snippet?: string | null;
  payload?: GmailMessagePart | null;
}

/** AAAA-MM-GG nel fuso indicato: la data di una mail è quella che l'utente vede nella sua casella. */
export function dayInTimeZone(ms: number, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('sv-SE', { timeZone }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

const decode = (data?: string | null) => (data ? Buffer.from(data, 'base64url').toString('utf8') : '');

/** Primi corpi text/html e text/plain, in profondità nei messaggi multipart (allegati esclusi). */
function findBodies(part: GmailMessagePart | null | undefined, out: { html?: string; text?: string } = {}) {
  if (!part) return out;
  const type = (part.mimeType ?? '').toLowerCase();
  const isAttachment = !!part.filename;
  if (!isAttachment && type === 'text/html' && out.html === undefined) out.html = decode(part.body?.data);
  if (!isAttachment && type === 'text/plain' && out.text === undefined) out.text = decode(part.body?.data);
  for (const p of part.parts ?? []) findBodies(p, out);
  return out;
}

/** `"Acme Careers" <jobs@acme.com>` → nome e indirizzo. */
export function parseFrom(from: string): { name: string; email: string } {
  const m = from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1]!.trim(), email: m[2]!.trim() };
  return { name: '', email: from.trim() };
}

export function messageToItem(msg: GmailMessage, timeZone = 'UTC'): MailItem | null {
  if (!msg.id || !msg.threadId) return null;
  const header = (n: string) => msg.payload?.headers?.find((h) => h.name?.toLowerCase() === n)?.value ?? '';
  const { name, email } = parseFrom(header('from'));
  const { html, text } = findBodies(msg.payload);
  const timestamp = Number(msg.internalDate) || Date.now();
  return {
    threadId: msg.threadId,
    name,
    email,
    subject: header('subject').trim(),
    // l'API restituisce l'anteprima con le entità HTML ("Thank you for applying &amp; …")
    snippet: htmlToText(msg.snippet ?? ''),
    date: dayInTimeZone(timestamp, timeZone),
    timestamp,
    // prima l'HTML: il parser di Indeed si basa sulla disposizione in righe della mail renderizzata
    body: html ? htmlToText(html) : (text ?? '').trim(),
  };
}
