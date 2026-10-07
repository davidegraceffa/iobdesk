import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  emptyTechStack,
  type ApplicationChannel,
  type ApplicationDto,
  type ApplicationImportResult,
  type ApplicationStats,
  type ApplicationStatus,
  type JobSnapshot,
  type TechStack,
  parseSalary,
} from '@jobagg/shared';
import { toCsv } from '../common/transforms';
import { SettingsService } from '../config/settings.service';
import { PrismaService } from '../prisma/prisma.service';
import { SourcesRegistry } from '../sources/sources.registry';
import type {
  ApplicationsQueryDto,
  ApplyDto,
  CreateManualApplicationDto,
  UpdateApplicationDto,
} from './applications.dto';
import { parseApplicationsCsv, type ImportedApplication } from './import';

const WITH_EVENTS = { events: { orderBy: { at: 'asc' } } } satisfies Prisma.ApplicationInclude;
type ApplicationRow = Prisma.ApplicationGetPayload<{ include: typeof WITH_EVENTS }>;

/** Stati in cui si sta ancora aspettando una risposta dall'azienda. */
const WAITING: ApplicationStatus[] = ['applied', 'screening'];
/** Stati che contano come "risposta ricevuta". */
const RESPONDED: ApplicationStatus[] = ['screening', 'interview', 'offer', 'accepted', 'rejected'];

const CHANNEL_BY_METHOD: Record<string, ApplicationChannel> = {
  ats: 'ats',
  careers_page: 'careers_page',
  email: 'email',
  source_page: 'other',
};

const STATUS_LABEL: Record<string, string> = {
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

@Injectable()
export class ApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly registry: SourcesRegistry,
  ) {}

  private toDto(row: ApplicationRow, followupDays: number, withEvents: boolean): ApplicationDto {
    const lastActivity = row.events.length > 0 ? row.events[row.events.length - 1]!.at : row.appliedAt;
    const days = Math.max(0, Math.floor((Date.now() - lastActivity.getTime()) / 86_400_000));
    return {
      id: row.id,
      jobId: row.jobId,
      appliedAt: row.appliedAt.toISOString(),
      channel: row.channel as ApplicationChannel,
      currentStatus: row.currentStatus as ApplicationStatus,
      notes: row.notes,
      contactName: row.contactName,
      contactEmail: row.contactEmail,
      generatedCvId: row.generatedCvId,
      externalId: row.externalId,
      country: row.country,
      cvSent: row.cvSent,
      cvLanguage: row.cvLanguage,
      trackingMode: row.trackingMode,
      snapshot: row.snapshot as unknown as JobSnapshot,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      lastActivityAt: lastActivity.toISOString(),
      daysSinceLastActivity: days,
      needsFollowUp: WAITING.includes(row.currentStatus as ApplicationStatus) && days > followupDays,
      ...(withEvents
        ? {
            events: row.events.map((e) => ({
              id: e.id,
              at: e.at.toISOString(),
              fromStatus: e.fromStatus,
              toStatus: e.toStatus,
              note: e.note,
            })),
          }
        : {}),
    };
  }

  private async followupDays(): Promise<number> {
    return (await this.settings.get()).applications.followup_days;
  }

  /**
   * Registra la candidatura a un annuncio: snapshot dell'annuncio, primo evento della timeline
   * e stato dell'annuncio ad "applied". Un annuncio non può avere due candidature.
   */
  async applyToJob(jobId: string, dto: ApplyDto): Promise<ApplicationDto> {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Annuncio non trovato');
    const existing = await this.prisma.application.findFirst({ where: { jobId } });
    if (existing) {
      throw new ConflictException({
        message: `Ti sei già candidato a questo annuncio il ${existing.appliedAt.toLocaleDateString('it-IT')}`,
        applicationId: existing.id,
      });
    }
    if (dto.generatedCvId) await this.assertCvExists(dto.generatedCvId);

    const snapshot: JobSnapshot = {
      title: job.title,
      company: job.company,
      source: job.source,
      sourceName: this.registry.get(job.source)?.displayName ?? job.source,
      sourceUrl: job.sourceUrl,
      applyUrl: job.applyUrl ?? undefined,
      salaryFound: job.salaryFound,
      salaryRawText: job.salaryRawText ?? undefined,
      salaryMin: job.salaryMin ?? undefined,
      salaryMax: job.salaryMax ?? undefined,
      salaryCurrency: job.salaryCurrency ?? undefined,
      salaryPeriod: (job.salaryPeriod as JobSnapshot['salaryPeriod']) ?? undefined,
      techStack: job.techStack as unknown as TechStack,
      contractType: job.contractType,
      location: job.location,
      descriptionOriginal: job.descriptionOriginal,
      descriptionHtml: job.descriptionHtml,
    };
    const appliedAt = dto.appliedAt ? new Date(dto.appliedAt) : new Date();
    const created = await this.prisma.$transaction(async (tx) => {
      const application = await tx.application.create({
        data: {
          jobId,
          appliedAt,
          channel: dto.channel ?? CHANNEL_BY_METHOD[job.applyMethod] ?? 'other',
          currentStatus: 'applied',
          notes: dto.notes?.trim() || null,
          contactName: dto.contactName?.trim() || null,
          contactEmail: dto.contactEmail?.trim() || null,
          generatedCvId: dto.generatedCvId ?? null,
          snapshot: snapshot as unknown as Prisma.InputJsonValue,
          events: { create: { at: appliedAt, fromStatus: null, toStatus: 'applied', note: 'Candidatura inviata' } },
        },
        include: WITH_EVENTS,
      });
      await tx.job.update({ where: { id: jobId }, data: { status: 'applied' } });
      return application;
    });
    return this.toDto(created, await this.followupDays(), true);
  }

  /** Candidatura manuale per annunci trovati altrove (nessun annuncio collegato). */
  async createManual(dto: CreateManualApplicationDto): Promise<ApplicationDto> {
    if (dto.generatedCvId) await this.assertCvExists(dto.generatedCvId);
    const snapshot: JobSnapshot = {
      title: dto.title.trim(),
      company: dto.company.trim(),
      source: dto.source?.trim() || 'manuale',
      sourceUrl: dto.url ?? '',
      applyUrl: dto.url,
      salaryFound: !!dto.salaryRawText?.trim(),
      salaryRawText: dto.salaryRawText?.trim() || undefined,
      techStack: emptyTechStack(),
      contractType: 'unknown',
      location: dto.location?.trim() ?? '',
      descriptionOriginal: dto.description ?? '',
    };
    const appliedAt = dto.appliedAt ? new Date(dto.appliedAt) : new Date();
    const created = await this.prisma.application.create({
      data: {
        appliedAt,
        channel: dto.channel ?? 'other',
        currentStatus: 'applied',
        notes: dto.notes?.trim() || null,
        contactName: dto.contactName?.trim() || null,
        contactEmail: dto.contactEmail?.trim() || null,
        generatedCvId: dto.generatedCvId ?? null,
        country: dto.country?.trim() || null,
        cvSent: dto.cvSent?.trim() || null,
        cvLanguage: dto.cvLanguage?.trim() || null,
        snapshot: snapshot as unknown as Prisma.InputJsonValue,
        events: { create: { at: appliedAt, fromStatus: null, toStatus: 'applied', note: 'Candidatura inviata' } },
      },
      include: WITH_EVENTS,
    });
    return this.toDto(created, await this.followupDays(), true);
  }

  private async assertCvExists(id: string): Promise<void> {
    const cv = await this.prisma.generatedCv.findUnique({ where: { id }, select: { id: true } });
    if (!cv) throw new NotFoundException('CV generato non trovato');
  }

  private async find(query: ApplicationsQueryDto): Promise<ApplicationRow[]> {
    const where: Prisma.ApplicationWhereInput = {
      ...(query.status ? { currentStatus: query.status } : {}),
      ...(query.country ? { country: { equals: query.country, mode: 'insensitive' } } : {}),
      ...(query.from || query.to
        ? {
            appliedAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(new Date(query.to).getTime() + 86_399_999) } : {}),
            },
          }
        : {}),
    };
    const rows = await this.prisma.application.findMany({
      where,
      include: WITH_EVENTS,
      orderBy: { appliedAt: query.order ?? 'desc' },
    });
    // azienda, fonte e testo libero vivono nello snapshot JSON: si filtra in memoria (volumi piccoli)
    const has = (value: string | undefined, needle: string) =>
      (value ?? '').toLowerCase().includes(needle.toLowerCase());
    return rows.filter((row) => {
      const s = row.snapshot as unknown as JobSnapshot;
      if (query.company && !has(s.company, query.company)) return false;
      if (query.source && s.source !== query.source && s.sourceName !== query.source) return false;
      if (query.q) {
        const hay = [s.title, s.company, s.location, row.country ?? '', row.notes ?? '', row.contactName ?? ''].join(
          ' ',
        );
        if (!has(hay, query.q)) return false;
      }
      return true;
    });
  }

  async list(query: ApplicationsQueryDto): Promise<ApplicationDto[]> {
    const days = await this.followupDays();
    return (await this.find(query)).map((row) => this.toDto(row, days, false));
  }

  async get(id: string): Promise<ApplicationDto> {
    const row = await this.prisma.application.findUnique({ where: { id }, include: WITH_EVENTS });
    if (!row) throw new NotFoundException('Candidatura non trovata');
    return this.toDto(row, await this.followupDays(), true);
  }

  /** Ogni cambio di stato (o aggiornamento con nota) genera un evento nella timeline. */
  async update(id: string, dto: UpdateApplicationDto): Promise<ApplicationDto> {
    const current = await this.prisma.application.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Candidatura non trovata');
    if (dto.generatedCvId) await this.assertCvExists(dto.generatedCvId);
    const statusChanged = dto.currentStatus !== undefined && dto.currentStatus !== current.currentStatus;
    const note = dto.eventNote?.trim();
    // la RAL sta nella copia dell'annuncio: inserirla o correggerla a mano aggiorna quella
    let snapshot: JobSnapshot | undefined;
    if (dto.salaryRawText !== undefined) {
      const text = dto.salaryRawText.trim();
      const parsed = text ? parseSalary(text) : null;
      snapshot = {
        ...(current.snapshot as unknown as JobSnapshot),
        salaryFound: !!text,
        salaryRawText: text || undefined,
        salaryMin: parsed?.min,
        salaryMax: parsed?.max,
        salaryCurrency: parsed?.currency,
        salaryPeriod: parsed?.period,
      };
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.application.update({
        where: { id },
        data: {
          ...(dto.currentStatus !== undefined ? { currentStatus: dto.currentStatus } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes.trim() || null } : {}),
          ...(dto.contactName !== undefined ? { contactName: dto.contactName.trim() || null } : {}),
          ...(dto.contactEmail !== undefined ? { contactEmail: dto.contactEmail.trim() || null } : {}),
          ...(dto.appliedAt !== undefined ? { appliedAt: new Date(dto.appliedAt) } : {}),
          ...(dto.generatedCvId !== undefined ? { generatedCvId: dto.generatedCvId } : {}),
          ...(dto.country !== undefined ? { country: dto.country.trim() || null } : {}),
          ...(dto.cvSent !== undefined ? { cvSent: dto.cvSent.trim() || null } : {}),
          ...(dto.cvLanguage !== undefined ? { cvLanguage: dto.cvLanguage.trim() || null } : {}),
          ...(snapshot ? { snapshot: snapshot as unknown as Prisma.InputJsonValue } : {}),
        },
      });
      if (statusChanged || note) {
        await tx.applicationEvent.create({
          data: {
            applicationId: id,
            fromStatus: current.currentStatus,
            toStatus: dto.currentStatus ?? current.currentStatus,
            note: note || null,
          },
        });
      }
      if (statusChanged && current.jobId) {
        const jobStatus =
          dto.currentStatus === 'interview' || dto.currentStatus === 'offer' || dto.currentStatus === 'accepted'
            ? 'interview'
            : dto.currentStatus === 'rejected'
              ? 'rejected'
              : 'applied';
        await tx.job.update({ where: { id: current.jobId }, data: { status: jobStatus } });
      }
    });
    return this.get(id);
  }

  async stats(): Promise<ApplicationStats> {
    const days = await this.followupDays();
    // le candidature saltate (mai inviate) non entrano nei conteggi
    const all = await this.prisma.application.findMany({ include: WITH_EVENTS });
    const rows = all.filter((r) => r.currentStatus !== 'skipped');
    const dtos = rows.map((r) => this.toDto(r, days, false));
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const reached = (row: ApplicationRow, statuses: string[]) =>
      statuses.includes(row.currentStatus) || row.events.some((e) => statuses.includes(e.toStatus));
    const responded = rows.filter((r) => reached(r, RESPONDED)).length;
    const byStatus: Record<string, number> = {};
    for (const row of all) byStatus[row.currentStatus] = (byStatus[row.currentStatus] ?? 0) + 1;
    return {
      total: rows.length,
      thisMonth: rows.filter((r) => r.appliedAt >= monthStart).length,
      responseRate: rows.length > 0 ? Math.round((responded / rows.length) * 100) : 0,
      interviews: rows.filter((r) => reached(r, ['interview', 'offer', 'accepted'])).length,
      offers: rows.filter((r) => reached(r, ['offer', 'accepted'])).length,
      needsFollowUp: dtos.filter((d) => d.needsFollowUp).length,
      byStatus,
    };
  }

  /**
   * Export CSV con le stesse colonne del foglio di tracciamento (più qualche colonna in coda):
   * il file esportato si può reimportare così com'è.
   */
  async exportCsv(query: ApplicationsQueryDto): Promise<string> {
    const days = await this.followupDays();
    const rows = (await this.find(query)).map((r) => this.toDto(r, days, false));
    return toCsv(
      [
        'ID offerta',
        'Data candidatura',
        'Azienda',
        'Posizione',
        'Località',
        'Portale',
        'Link offerta',
        'CV inviato',
        'Lingua',
        'Modalità',
        'Stato',
        'Note',
        'Nazione',
        'Canale',
        'RAL',
        'Contatto',
        'Email',
        'Giorni dall’ultima attività',
      ],
      rows.map((a) => [
        a.externalId ?? a.id,
        a.appliedAt.slice(0, 10),
        a.snapshot.company,
        a.snapshot.title,
        a.snapshot.location,
        a.snapshot.sourceName ?? a.snapshot.source,
        a.snapshot.applyUrl ?? a.snapshot.sourceUrl,
        a.cvSent ?? (a.generatedCvId ? 'CV su misura generato dall’app' : ''),
        a.cvLanguage,
        a.trackingMode,
        STATUS_LABEL[a.currentStatus] ?? a.currentStatus,
        a.notes,
        a.country,
        a.channel,
        a.snapshot.salaryFound ? a.snapshot.salaryRawText : '',
        a.contactName,
        a.contactEmail,
        a.daysSinceLastActivity,
      ]),
    );
  }

  // ── import da file ────────────────────────────────────────────────────────────

  private importSnapshot(item: ImportedApplication): JobSnapshot {
    return {
      title: item.title || 'Posizione non indicata',
      company: item.company || 'Azienda non indicata',
      source: item.portal || 'import',
      sourceName: item.portal || undefined,
      sourceUrl: item.url,
      salaryFound: !!item.salaryRawText,
      salaryRawText: item.salaryRawText || undefined,
      techStack: emptyTechStack(),
      contractType: 'unknown',
      location: item.location,
      descriptionOriginal: '',
    };
  }

  /**
   * Importa candidature da un CSV (es. il foglio di tracciamento esportato da Google Sheets).
   * Idempotente: una riga già importata (stesso "ID offerta") viene aggiornata, non duplicata.
   * In aggiornamento cambia lo stato (con evento in timeline) e riempie solo i campi ancora vuoti,
   * così ciò che hai scritto nell'app non viene sovrascritto. Con `dryRun` non salva nulla.
   */
  async importCsv(content: string, dryRun: boolean): Promise<ApplicationImportResult> {
    const parsed = parseApplicationsCsv(content);
    const result: ApplicationImportResult = {
      dryRun,
      total: parsed.rows.length,
      created: 0,
      updated: 0,
      unchanged: 0,
      errors: parsed.errors,
      warnings: parsed.warnings,
      recognizedColumns: parsed.recognizedColumns,
      ignoredColumns: parsed.ignoredColumns,
      preview: [],
    };
    // una riga corrisponde a una candidatura già presente per "ID offerta" oppure, per i file esportati
    // dall'app, per id interno
    const ids = parsed.rows.map((r) => r.externalId);
    const found = await this.prisma.application.findMany({
      where: { OR: [{ externalId: { in: ids } }, { id: { in: ids } }] },
    });
    const existing = new Map(
      found.flatMap((a) => [[a.id, a] as const, ...(a.externalId ? [[a.externalId, a] as const] : [])]),
    );

    for (const item of parsed.rows) {
      const current = existing.get(item.externalId);
      const statusNote = [
        item.statusDetail ?? STATUS_LABEL[item.status],
        item.statusDate
          ? null
          : item.status !== 'applied' && item.status !== 'skipped'
            ? 'data del cambio non indicata nel file'
            : null,
      ]
        .filter(Boolean)
        .join(' · ');
      let action: 'create' | 'update' | 'unchanged';

      if (!current) {
        action = 'create';
        if (!dryRun) {
          const events: Prisma.ApplicationEventCreateWithoutApplicationInput[] =
            item.status === 'skipped'
              ? [{ at: item.appliedAt, fromStatus: null, toStatus: 'skipped', note: statusNote }]
              : [{ at: item.appliedAt, fromStatus: null, toStatus: 'applied', note: 'Candidatura inviata' }];
          if (item.status !== 'applied' && item.status !== 'skipped') {
            events.push({
              at: item.statusDate ?? item.appliedAt,
              fromStatus: 'applied',
              toStatus: item.status,
              note: statusNote,
            });
          }
          await this.prisma.application.create({
            data: {
              externalId: item.externalId,
              appliedAt: item.appliedAt,
              channel: item.channel,
              currentStatus: item.status,
              notes: item.notes || null,
              contactName: item.contactName || null,
              contactEmail: item.contactEmail || null,
              country: item.country || null,
              cvSent: item.cvSent || null,
              cvLanguage: item.cvLanguage || null,
              trackingMode: item.trackingMode || null,
              snapshot: this.importSnapshot(item) as unknown as Prisma.InputJsonValue,
              events: { create: events },
            },
          });
        }
      } else {
        const snapshot = current.snapshot as unknown as JobSnapshot;
        const fill: Prisma.ApplicationUpdateInput = {};
        if (!current.notes && item.notes) fill.notes = item.notes;
        if (!current.country && item.country) fill.country = item.country;
        if (!current.cvSent && item.cvSent) fill.cvSent = item.cvSent;
        if (!current.cvLanguage && item.cvLanguage) fill.cvLanguage = item.cvLanguage;
        if (!current.trackingMode && item.trackingMode) fill.trackingMode = item.trackingMode;
        if (!current.contactName && item.contactName) fill.contactName = item.contactName;
        if (!current.contactEmail && item.contactEmail) fill.contactEmail = item.contactEmail;
        const incoming = this.importSnapshot(item);
        const nextSnapshot: JobSnapshot = {
          ...snapshot,
          title: snapshot.title === 'Posizione non indicata' ? incoming.title : snapshot.title,
          company: snapshot.company === 'Azienda non indicata' ? incoming.company : snapshot.company,
          location: snapshot.location || incoming.location,
          sourceUrl: snapshot.sourceUrl || incoming.sourceUrl,
        };
        if (JSON.stringify(nextSnapshot) !== JSON.stringify(snapshot)) {
          fill.snapshot = nextSnapshot as unknown as Prisma.InputJsonValue;
        }
        const statusChanged = current.currentStatus !== item.status;
        action = statusChanged || Object.keys(fill).length > 0 ? 'update' : 'unchanged';
        if (action === 'update' && !dryRun) {
          await this.prisma.application.update({
            where: { id: current.id },
            data: {
              ...fill,
              ...(statusChanged
                ? {
                    currentStatus: item.status,
                    events: {
                      create: {
                        at: item.statusDate ?? new Date(),
                        fromStatus: current.currentStatus,
                        toStatus: item.status,
                        note: `${statusNote || STATUS_LABEL[item.status]} (aggiornato dall’import)`,
                      },
                    },
                  }
                : {}),
            },
          });
        }
      }

      result[action === 'create' ? 'created' : action === 'update' ? 'updated' : 'unchanged']++;
      if (result.preview.length < 200) {
        result.preview.push({
          row: item.row,
          action,
          company: item.company || 'Azienda non indicata',
          title: item.title || 'Posizione non indicata',
          appliedAt: item.appliedAt.toISOString(),
          status: item.status,
          portal: item.portal,
          country: item.country,
        });
      }
    }
    return result;
  }

  /** Nazioni presenti nello storico, per il filtro. */
  async countries(): Promise<string[]> {
    const rows = await this.prisma.application.findMany({
      where: { country: { not: null } },
      distinct: ['country'],
      select: { country: true },
      orderBy: { country: 'asc' },
    });
    return rows.map((r) => r.country as string);
  }
}
