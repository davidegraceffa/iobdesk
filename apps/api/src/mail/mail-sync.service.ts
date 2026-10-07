import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  emptyTechStack,
  type ApplicationStatus,
  type JobSnapshot,
  type MailSyncIgnored,
  type MailSyncItem,
  type MailSyncRunDto,
  type MailSyncStatusDto,
} from '@jobagg/shared';
import { channelFromPortal, parseDate } from '../applications/import';
import { SettingsService } from '../config/settings.service';
import { PrismaService } from '../prisma/prisma.service';
import { countryOf } from './country';
import { GmailClient } from './gmail.client';
import { dayInTimeZone } from './gmail-message';
import { GoogleAuthService } from './google-auth.service';
import {
  classifyMail,
  classifyRejection,
  matchRejection,
  receivedQuery,
  rejectionMarker,
  rejectionQuery,
  sameApplication,
  type AppSummary,
  type MailItem,
  type SheetRow,
} from './parse';

export const MAIL_KEY_PREFIX = 'mail-';
export const MAIL_TRACKING_MODE = 'Da email';
const NO_COMPANY = 'Azienda non indicata';
const NO_TITLE = 'Posizione non indicata';
const KEEP_RUNS = 100;
const MAX_IGNORED = 100;

export interface MailSyncOptions {
  /** calcola cosa cambierebbe senza scrivere nulla */
  dryRun?: boolean;
  /** finestra in giorni, al posto di quella delle impostazioni */
  days?: number;
}

/** Candidatura dedotta da una mail e non ancora registrata. */
interface FreshRecord {
  key: string;
  date: string;
  company: string;
  title: string;
  location: string;
  portal: string;
  url: string;
  notes: string;
  country: string;
  status: 'applied' | 'rejected';
  subject: string;
  /** istante del rifiuto, quando la candidatura nasce già rifiutata */
  rejectedAt: number | null;
}

/** Cambio di stato di una candidatura già registrata. */
interface StatusUpdate {
  applicationId: string;
  row: SheetRow;
  previous: ApplicationStatus;
  notes: string;
  at: number;
  date: string;
  subject: string;
}

interface Outcome {
  examined: number;
  duplicates: number;
  fresh: FreshRecord[];
  updates: StatusUpdate[];
  ambiguous: string[];
  ignored: MailSyncIgnored[];
  ignoredCount: number;
}

const addNote = (notes: string, extra: string) => (notes.trim() ? `${notes.trim()} | ${extra}` : extra);
const byDate = (a: MailItem, b: MailItem) => a.date.localeCompare(b.date);

export function mailToRecord(
  m: MailItem,
  v: { company: string; title: string; location: string; portal: string },
): FreshRecord {
  return {
    key: `${MAIL_KEY_PREFIX}${m.threadId}`,
    date: m.date,
    company: v.company,
    title: v.title,
    location: v.location,
    portal: v.portal,
    url: `https://mail.google.com/mail/u/0/#all/${m.threadId}`,
    notes: `da mail: ${m.subject}`.slice(0, 300),
    country: countryOf({ location: v.location, title: v.title, hint: m.email }),
    status: 'applied',
    subject: m.subject,
    rejectedAt: null,
  };
}

/**
 * Legge da Gmail (sola lettura) le ricevute di candidatura e le risposte negative e tiene aggiornato
 * lo storico: una ricevuta nuova diventa una candidatura "Da email", un rifiuto porta a "Rifiutata" la
 * candidatura a cui si riferisce. È ciò che job-compiler faceva sul foglio Google, con le stesse regole.
 *
 * Idempotente: ogni conversazione Gmail ha la chiave `mail-<threadId>` (campo externalId) e ogni rifiuto
 * applicato lascia un marcatore nelle note, così non viene riapplicato se poi cambi lo stato a mano.
 */
@Injectable()
export class MailSyncService {
  private readonly logger = new Logger(MailSyncService.name);
  private current: Promise<MailSyncRunDto> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly auth: GoogleAuthService,
    private readonly gmail: GmailClient,
  ) {}

  isRunning(): boolean {
    return this.current !== null;
  }

  async run(trigger: string, options: MailSyncOptions = {}): Promise<MailSyncRunDto> {
    if (this.current) throw new ConflictException('Una sincronizzazione con Gmail è già in corso');
    this.current = this.execute(trigger, options).finally(() => {
      this.current = null;
    });
    return this.current;
  }

  private async execute(trigger: string, options: MailSyncOptions): Promise<MailSyncRunDto> {
    const dryRun = !!options.dryRun;
    const startedAt = new Date();
    const run = dryRun ? null : await this.prisma.mailSyncRun.create({ data: { trigger, startedAt } });
    try {
      const outcome = await this.collect(options.days);
      const details = dryRun ? this.preview(outcome) : await this.write(outcome);
      const dto: MailSyncRunDto = {
        id: run?.id ?? null,
        trigger,
        dryRun,
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        status: 'success',
        examined: outcome.examined,
        created: details.created.length,
        updated: details.updated.length,
        duplicates: outcome.duplicates + details.raced,
        ignored: outcome.ignoredCount,
        error: null,
        details: {
          created: details.created,
          updated: details.updated,
          ambiguous: outcome.ambiguous,
          ignored: outcome.ignored,
        },
      };
      if (run) {
        await this.prisma.mailSyncRun.update({
          where: { id: run.id },
          data: {
            finishedAt: new Date(),
            status: 'success',
            examined: dto.examined,
            created: dto.created,
            updated: dto.updated,
            duplicates: dto.duplicates,
            ignored: dto.ignored,
            details: dto.details as unknown as Prisma.InputJsonValue,
          },
        });
        await this.prune();
        this.logger.log(
          `Gmail: ${dto.examined} email esaminate, ${dto.created} candidature nuove, ${dto.updated} aggiornate` +
            (outcome.ambiguous.length ? `, ${outcome.ambiguous.length} rifiuti da abbinare a mano` : ''),
        );
      }
      return dto;
    } catch (err) {
      const message = (err as Error).message;
      if (run) {
        await this.prisma.mailSyncRun
          .update({ where: { id: run.id }, data: { finishedAt: new Date(), status: 'error', error: message } })
          .catch(() => undefined);
      }
      throw err;
    }
  }

  /** Tiene solo le ultime esecuzioni. */
  private async prune(): Promise<void> {
    const old = await this.prisma.mailSyncRun.findMany({
      orderBy: { startedAt: 'desc' },
      skip: KEEP_RUNS,
      select: { id: true },
    });
    if (old.length) await this.prisma.mailSyncRun.deleteMany({ where: { id: { in: old.map((r) => r.id) } } });
  }

  /** Legge candidature registrate e posta, e decide cosa creare e cosa aggiornare (senza scrivere). */
  private async collect(daysOverride?: number): Promise<Outcome> {
    const settings = await this.settings.get();
    const cfg = settings.mail_sync;
    const days = daysOverride ?? cfg.newer_than_days;
    const timeZone = settings.user.timezone ?? 'UTC';

    const applications = await this.prisma.application.findMany({
      select: { id: true, externalId: true, appliedAt: true, currentStatus: true, notes: true, snapshot: true },
      orderBy: { appliedAt: 'asc' },
    });
    const keys = new Set<string>();
    const known: AppSummary[] = [];
    const rows: SheetRow[] = [];
    applications.forEach((a, index) => {
      if (a.externalId) keys.add(a.externalId);
      // le candidature "saltate" non sono mai state inviate: una mail non può riferirsi a loro
      if (a.currentStatus === 'skipped') return;
      const snapshot = a.snapshot as unknown as JobSnapshot;
      const company = snapshot.company === NO_COMPANY ? '' : (snapshot.company ?? '');
      const title = snapshot.title === NO_TITLE ? '' : (snapshot.title ?? '');
      const date = dayInTimeZone(a.appliedAt.getTime(), timeZone);
      known.push({ date, company, title });
      rows.push({
        row: index,
        key: a.externalId ?? a.id,
        date,
        company,
        title,
        status: a.currentStatus,
        notes: a.notes ?? '',
      });
    });

    // ── ricevute di candidatura ──────────────────────────────────────────────────
    const receipts = await this.gmail.search(receivedQuery(days, cfg.extra_query), cfg.max_messages, timeZone);
    const fresh: FreshRecord[] = [];
    const ignored: MailSyncIgnored[] = [];
    let ignoredCount = 0;
    const seenThreads = new Set<string>();
    let duplicates = 0;

    // dalla più vecchia: se due email descrivono la stessa candidatura vince la prima
    for (const m of receipts.sort(byDate)) {
      const key = `${MAIL_KEY_PREFIX}${m.threadId}`;
      if (keys.has(key) || seenThreads.has(m.threadId)) {
        duplicates++;
        continue;
      }
      const v = classifyMail(m, cfg.ignore_senders);
      if (!v.accept) {
        // i rifiuti che ringraziano per la candidatura finiscono anche qui: li gestisce il passo successivo
        if (!v.reason.startsWith('esito negativo')) {
          ignoredCount++;
          if (ignored.length < MAX_IGNORED) {
            ignored.push({ date: m.date, sender: m.name || m.email, subject: m.subject, reason: v.reason });
          }
        }
        continue;
      }
      seenThreads.add(m.threadId);
      const summary = { company: v.company, title: v.title, date: m.date };
      if (known.some((k) => sameApplication(k, summary))) {
        // es. il "grazie per la candidatura" dell'azienda seguito dalla copia dell'ATS con il titolo
        const twin = fresh.find((r) => sameApplication({ company: r.company, title: r.title, date: r.date }, summary));
        if (twin) {
          twin.company ||= v.company;
          twin.title ||= v.title;
          twin.location ||= v.location;
          twin.country ||= countryOf({ location: twin.location, title: twin.title, hint: m.email });
        }
        duplicates++;
        continue;
      }
      fresh.push(mailToRecord(m, v));
      known.push(summary);
    }

    // ── rifiuti ──────────────────────────────────────────────────────────────────
    const rejections = await this.gmail.search(rejectionQuery(days, cfg.extra_query), cfg.max_messages, timeZone);
    const updates: StatusUpdate[] = [];
    const ambiguous: string[] = [];

    for (const m of rejections.sort(byDate)) {
      const marker = rejectionMarker(m.threadId);
      const done = [...rows.map((r) => r.notes), ...fresh.map((r) => r.notes)].some((n) => n.includes(marker));
      if (done) continue;
      const v = classifyRejection(m, cfg.ignore_senders);
      if (!v.accept) continue;
      const rejection = { company: v.company, title: v.title, date: m.date, threadId: m.threadId };
      const label = `${m.date} · ${v.company || '?'} — ${v.title || '?'}`;
      const at = m.timestamp ?? parseDate(m.date)?.getTime() ?? Date.now();

      const registered = matchRejection(rejection, rows);
      if (registered.kind === 'row') {
        const row = registered.row;
        const application = applications[row.row]!;
        const notes = addNote(row.notes, `${marker} (${m.date})`);
        updates.push({
          applicationId: application.id,
          row,
          previous: row.status as ApplicationStatus,
          notes,
          at,
          date: m.date,
          subject: m.subject,
        });
        row.status = 'rejected';
        row.notes = notes;
        continue;
      }
      if (registered.kind === 'ambiguous') {
        const candidates = registered.rows.map((r) => `${r.title || '?'} (${r.date})`).join(', ');
        ambiguous.push(
          `Rifiuto del ${label}: può riferirsi a più candidature — ${candidates}. Aggiorna lo stato a mano.`,
        );
        continue;
      }

      // non ancora registrata: forse è tra le ricevute trovate in questa stessa esecuzione
      const pending: SheetRow[] = fresh.map((r, i) => ({
        row: i,
        key: r.key,
        date: r.date,
        company: r.company,
        title: r.title,
        status: r.status,
        notes: r.notes,
      }));
      const inRun = matchRejection(rejection, pending);
      if (inRun.kind === 'row') {
        const record = fresh[inRun.row.row]!;
        record.status = 'rejected';
        record.rejectedAt = at;
        record.notes = addNote(record.notes, `${marker} (${m.date})`);
        continue;
      }
      if (inRun.kind === 'ambiguous') {
        ambiguous.push(`Rifiuto del ${label}: può riferirsi a più candidature nuove. Aggiorna lo stato a mano.`);
        continue;
      }
      // un rifiuto dimostra che la candidatura era stata inviata, anche senza ricevuta
      const record = mailToRecord(m, v);
      if (keys.has(record.key)) continue;
      fresh.push({ ...record, status: 'rejected', rejectedAt: at, notes: addNote(record.notes, marker) });
    }

    return {
      examined: receipts.length + rejections.length,
      duplicates,
      fresh,
      updates,
      ambiguous,
      ignored,
      ignoredCount,
    };
  }

  private freshItem(record: FreshRecord, applicationId: string | null): MailSyncItem {
    return {
      applicationId,
      date: record.date,
      company: record.company || NO_COMPANY,
      title: record.title || NO_TITLE,
      portal: record.portal,
      country: record.country,
      status: record.status,
      previousStatus: null,
      subject: record.subject,
    };
  }

  private updateItem(update: StatusUpdate): MailSyncItem {
    return {
      applicationId: update.applicationId,
      date: update.date,
      company: update.row.company || NO_COMPANY,
      title: update.row.title || NO_TITLE,
      portal: '',
      country: '',
      status: 'rejected',
      previousStatus: update.previous,
      subject: update.subject,
    };
  }

  private preview(outcome: Outcome): { created: MailSyncItem[]; updated: MailSyncItem[]; raced: number } {
    return {
      created: outcome.fresh.map((r) => this.freshItem(r, null)),
      updated: outcome.updates.map((u) => this.updateItem(u)),
      raced: 0,
    };
  }

  private async write(outcome: Outcome): Promise<{ created: MailSyncItem[]; updated: MailSyncItem[]; raced: number }> {
    const created: MailSyncItem[] = [];
    const updated: MailSyncItem[] = [];
    let raced = 0;

    for (const record of outcome.fresh) {
      const appliedAt = parseDate(record.date) ?? new Date();
      const events: Prisma.ApplicationEventCreateWithoutApplicationInput[] = [
        { at: appliedAt, fromStatus: null, toStatus: 'applied', note: 'Candidatura rilevata da una mail di conferma' },
      ];
      if (record.status === 'rejected') {
        const at = Math.max(record.rejectedAt ?? 0, appliedAt.getTime() + 60_000);
        events.push({
          at: new Date(at),
          fromStatus: 'applied',
          toStatus: 'rejected',
          note: 'Risposta negativa ricevuta via email',
        });
      }
      const snapshot: JobSnapshot = {
        title: record.title || NO_TITLE,
        company: record.company || NO_COMPANY,
        source: record.portal || 'gmail',
        sourceName: record.portal || undefined,
        sourceUrl: record.url,
        salaryFound: false,
        techStack: emptyTechStack(),
        contractType: 'unknown',
        location: record.location,
        descriptionOriginal: '',
      };
      try {
        const application = await this.prisma.application.create({
          data: {
            externalId: record.key,
            appliedAt,
            channel: channelFromPortal(record.portal),
            currentStatus: record.status,
            notes: record.notes,
            country: record.country || null,
            trackingMode: MAIL_TRACKING_MODE,
            snapshot: snapshot as unknown as Prisma.InputJsonValue,
            events: { create: events },
          },
        });
        created.push(this.freshItem(record, application.id));
      } catch (err) {
        // stessa conversazione registrata nel frattempo (es. da un import): non è un errore
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') raced++;
        else throw err;
      }
    }

    for (const update of outcome.updates) {
      const statusChanged = update.previous !== 'rejected';
      await this.prisma.application.update({
        where: { id: update.applicationId },
        data: {
          notes: update.notes,
          ...(statusChanged
            ? {
                currentStatus: 'rejected',
                events: {
                  create: {
                    at: new Date(update.at),
                    fromStatus: update.previous,
                    toStatus: 'rejected',
                    note: `Risposta negativa ricevuta via email: ${update.subject}`.slice(0, 300),
                  },
                },
              }
            : {}),
        },
      });
      if (statusChanged) updated.push(this.updateItem(update));
    }
    return { created, updated, raced };
  }

  // ── stato e storico ────────────────────────────────────────────────────────────

  private toDto(run: Prisma.MailSyncRunGetPayload<object>): MailSyncRunDto {
    const details = (run.details ?? {}) as Partial<MailSyncRunDto['details']>;
    return {
      id: run.id,
      trigger: run.trigger,
      dryRun: false,
      startedAt: run.startedAt.toISOString(),
      finishedAt: run.finishedAt?.toISOString() ?? null,
      status: run.status as MailSyncRunDto['status'],
      examined: run.examined,
      created: run.created,
      updated: run.updated,
      duplicates: run.duplicates,
      ignored: run.ignored,
      error: run.error,
      details: {
        created: details.created ?? [],
        updated: details.updated ?? [],
        ambiguous: details.ambiguous ?? [],
        ignored: details.ignored ?? [],
      },
    };
  }

  async listRuns(limit = 20): Promise<MailSyncRunDto[]> {
    const runs = await this.prisma.mailSyncRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: Math.min(Math.max(limit, 1), KEEP_RUNS),
    });
    return runs.map((r) => this.toDto(r));
  }

  async lastSuccessAt(): Promise<Date | null> {
    const run = await this.prisma.mailSyncRun.findFirst({
      where: { status: 'success' },
      orderBy: { startedAt: 'desc' },
      select: { finishedAt: true, startedAt: true },
    });
    return run ? (run.finishedAt ?? run.startedAt) : null;
  }

  async lastAttemptAt(): Promise<Date | null> {
    const run = await this.prisma.mailSyncRun.findFirst({
      orderBy: { startedAt: 'desc' },
      select: { startedAt: true },
    });
    return run?.startedAt ?? null;
  }

  /** All'avvio: le esecuzioni rimaste "in corso" per un riavvio vengono chiuse. */
  async closeStaleRuns(): Promise<void> {
    await this.prisma.mailSyncRun.updateMany({
      where: { status: 'running' },
      data: { status: 'error', finishedAt: new Date(), error: 'Interrotta dal riavvio dell’applicazione' },
    });
  }

  async status(): Promise<MailSyncStatusDto> {
    const settings = await this.settings.get();
    const [last] = await this.listRuns(1);
    const lastSuccess = await this.lastSuccessAt();
    return {
      ...this.auth.state(),
      enabled: settings.mail_sync.enabled,
      intervalMinutes: settings.mail_sync.interval_minutes,
      running: this.isRunning(),
      lastRun: last ?? null,
      lastSuccessAt: lastSuccess?.toISOString() ?? null,
    };
  }
}
