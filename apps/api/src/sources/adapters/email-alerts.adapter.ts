import { Inject, Injectable } from '@nestjs/common';
import { ENV, type Env } from '../../config/env';
import { type FetchContext, type JobInput, type RawJob, type SourceAdapter } from '../source.types';
import { asDate, asString, decodeEntities } from './helpers';

export interface AlertEmail {
  messageId: string;
  from: string;
  subject: string;
  date?: Date;
  html: string;
}

export interface AlertJob {
  provider: 'linkedin' | 'indeed' | 'glassdoor';
  url: string;
  externalId: string;
  title: string;
  company: string;
  location: string;
}

const PROVIDERS: Array<{
  provider: AlertJob['provider'];
  from: RegExp;
  link: RegExp;
  id: (url: URL) => string | null;
}> = [
  {
    provider: 'linkedin',
    from: /linkedin\.com/i,
    link: /^https?:\/\/(?:[a-z]+\.)?linkedin\.com\/(?:comm\/)?jobs\/view\/\d+/i,
    id: (u) => /\/jobs\/view\/(\d+)/.exec(u.pathname)?.[1] ?? null,
  },
  {
    provider: 'indeed',
    from: /indeed\.com/i,
    link: /^https?:\/\/(?:[a-z]+\.)?indeed\.com\/(?:rc\/clk|viewjob|pagead\/clk|m\/viewjob)/i,
    id: (u) => u.searchParams.get('jk'),
  },
  {
    provider: 'glassdoor',
    from: /glassdoor\./i,
    link: /^https?:\/\/(?:www\.)?glassdoor\.[a-z.]+\/(?:partner\/jobListing|job-listing|Job)/i,
    id: (u) => u.searchParams.get('jobListingId') ?? u.searchParams.get('jl'),
  },
];

function textOf(html: string): string {
  return decodeEntities(html.replace(/<(?:br|\/p|\/div|\/tr|\/td|\/li|\/h\d)[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' '))
    .replace(/[ \t\u00a0]+/g, ' ')
    .trim();
}

/**
 * Estrae gli annunci da un'email di alert (LinkedIn, Indeed, Glassdoor).
 * Euristica: ogni link a una pagina annuncio è un annuncio; il testo del link è il titolo,
 * le righe di testo che seguono (fino al link successivo) sono azienda e località.
 * Non viene mai fatta alcuna richiesta a questi siti: si legge solo l'email ricevuta.
 */
export function parseAlertEmail(email: AlertEmail): AlertJob[] {
  const spec = PROVIDERS.find((p) => p.from.test(email.from));
  if (!spec) return [];
  const anchors = [...email.html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  const jobs = new Map<string, AlertJob>();
  for (let i = 0; i < anchors.length; i++) {
    const m = anchors[i] as RegExpMatchArray;
    const href = decodeEntities(m[1] as string);
    if (!spec.link.test(href)) continue;
    let url: URL;
    try {
      url = new URL(href);
    } catch {
      continue;
    }
    const externalId = spec.id(url);
    if (!externalId) continue;
    const title =
      textOf(m[2] as string)
        .split('\n')[0]
        ?.trim() ?? '';
    // link "Visualizza offerta", loghi e simili: senza un titolo vero non è la voce principale
    if (title.length < 4 || /^(?:view|see|apply|visualizza|vedi|candidati)\b/i.test(title)) continue;
    if (jobs.has(externalId)) continue;

    const start = (m.index ?? 0) + m[0].length;
    const next = anchors.slice(i + 1).find((a) => spec.link.test(decodeEntities(a[1] as string)));
    const end = next?.index ?? Math.min(email.html.length, start + 1500);
    const lines = textOf(email.html.slice(start, end))
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 1 && l.length < 120);
    // LinkedIn usa "Azienda · Località"; Indeed e Glassdoor due righe distinte
    const [first = '', second = ''] = lines;
    const parts = first.split(/\s+[·•|]\s+|\s+-\s+/);
    const company = (parts[0] ?? '').trim();
    const location = (parts.length > 1 ? parts.slice(1).join(', ') : second).trim();

    const canonical =
      spec.provider === 'linkedin'
        ? `https://www.linkedin.com/jobs/view/${externalId}`
        : spec.provider === 'indeed'
          ? `https://www.indeed.com/viewjob?jk=${externalId}`
          : (href.split('&utm_')[0] ?? href);
    jobs.set(externalId, { provider: spec.provider, url: canonical, externalId, title, company, location });
  }
  return [...jobs.values()];
}

/**
 * Import opzionale delle email di alert di LinkedIn/Indeed/Glassdoor da una cartella IMAP dedicata.
 * È l'unico modo previsto per questi siti: nessuno scraping. Credenziali solo in `.env`.
 */
@Injectable()
export class EmailAlertsAdapter implements SourceAdapter {
  readonly id = 'email_alerts';
  readonly displayName = 'Alert via email (LinkedIn, Indeed, Glassdoor)';
  readonly homepage = '';
  readonly relevantRegions = ['worldwide'];
  readonly minIntervalMinutes = 15;

  static readonly LOOKBACK_DAYS = 14;
  static readonly MAX_MESSAGES = 60;

  constructor(@Inject(ENV) private readonly env: Env) {}

  isConfigured(): boolean {
    const { host, user, password } = this.env.imap;
    return !!host && !!user && !!password;
  }

  async fetchJobs(ctx: FetchContext): Promise<RawJob[]> {
    if (!this.isConfigured()) {
      throw new Error('IMAP non configurato: imposta IMAP_HOST, IMAP_USER e IMAP_PASSWORD nel file .env');
    }
    const emails = await this.readMailbox(ctx);
    const out: RawJob[] = [];
    for (const email of emails) {
      for (const job of parseAlertEmail(email)) {
        out.push({ ...job, receivedAt: email.date?.toISOString() ?? null, subject: email.subject });
      }
    }
    return out;
  }

  /** Legge in sola lettura i messaggi recenti della cartella dedicata. */
  private async readMailbox(ctx: FetchContext): Promise<AlertEmail[]> {
    // import locale: le dipendenze IMAP servono solo se la fonte è abilitata
    const { ImapFlow } = await import('imapflow');
    const { simpleParser } = await import('mailparser');
    const { host, port, user, password, mailbox } = this.env.imap;
    const client = new ImapFlow({ host, port, secure: port === 993, auth: { user, pass: password }, logger: false });
    const emails: AlertEmail[] = [];
    await client.connect();
    try {
      const lock = await client.getMailboxLock(mailbox, { readOnly: true });
      try {
        const since = new Date(ctx.now.getTime() - EmailAlertsAdapter.LOOKBACK_DAYS * 86_400_000);
        const uids = (await client.search({ since }, { uid: true })) || [];
        const recent = uids.slice(-EmailAlertsAdapter.MAX_MESSAGES);
        if (recent.length === 0) return emails;
        for await (const message of client.fetch(recent, { source: true, envelope: true }, { uid: true })) {
          if (!message.source) continue;
          const parsed = await simpleParser(message.source);
          emails.push({
            messageId: parsed.messageId ?? String(message.uid),
            from: parsed.from?.text ?? '',
            subject: parsed.subject ?? '',
            date: parsed.date ?? undefined,
            html: typeof parsed.html === 'string' ? parsed.html : (parsed.textAsHtml ?? ''),
          });
        }
      } finally {
        lock.release();
      }
    } finally {
      await client.logout().catch(() => undefined);
    }
    ctx.log(`${emails.length} email lette da "${mailbox}"`);
    return emails;
  }

  normalize(raw: RawJob): JobInput {
    const provider = asString(raw.provider);
    const label = provider === 'linkedin' ? 'LinkedIn' : provider === 'indeed' ? 'Indeed' : 'Glassdoor';
    const url = asString(raw.url);
    return {
      source: this.id,
      externalId: `${provider}:${asString(raw.externalId)}`,
      sourceUrl: url,
      title: asString(raw.title),
      company: asString(raw.company) || 'Azienda non indicata',
      // l'email di alert contiene solo titolo, azienda e località: la descrizione completa resta sul sito
      descriptionOriginal: `Annuncio ricevuto tramite alert email di ${label}${
        raw.subject ? ` ("${asString(raw.subject)}")` : ''
      }. La descrizione completa è disponibile sulla pagina originale.`,
      descriptionIsHtml: false,
      applyUrl: url,
      tags: [label],
      location: asString(raw.location),
      publishedAt: asDate(raw.receivedAt),
    };
  }
}
