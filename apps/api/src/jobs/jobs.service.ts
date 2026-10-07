import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  canonicalTech,
  convertToLocal,
  getCountry,
  type ApplicationStatus,
  type JobDetail,
  type JobListItem,
  type Paginated,
  type ScoreBreakdown,
  type Settings,
  type StatsDto,
  type StoredSalaryEstimate,
  type TechStack,
} from '@jobagg/shared';
import { toCsv } from '../common/transforms';
import { SettingsService } from '../config/settings.service';
import { PrismaService } from '../prisma/prisma.service';
import { SourcesRegistry } from '../sources/sources.registry';
import type { JobsQueryDto, UpdateJobDto } from './jobs.dto';

const LIST_INCLUDE = {
  duplicates: { select: { id: true, source: true, sourceUrl: true } },
  applications: { select: { id: true, appliedAt: true, currentStatus: true }, orderBy: { appliedAt: 'desc' }, take: 1 },
  generatedCvs: {
    where: { status: 'ready' },
    select: { id: true, language: true, version: true },
    orderBy: { createdAt: 'desc' },
  },
} satisfies Prisma.JobInclude;

type JobRow = Prisma.JobGetPayload<{ include: typeof LIST_INCLUDE }>;

function preview(text: string, max = 320): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max).replace(/\s+\S*$/, '')}…` : flat;
}

@Injectable()
export class JobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly registry: SourcesRegistry,
  ) {}

  private sourceName(id: string): string {
    return this.registry.get(id)?.displayName ?? id;
  }

  private toListItem(job: JobRow, settings: Settings): JobListItem {
    const country = getCountry(settings.user.country);
    const application = job.applications[0];
    const estimate = job.salaryFound ? null : (job.salaryEstimate as unknown as StoredSalaryEstimate | null);
    const fx = settings.compensation.fx_rates_to_local;
    const toLocal = (amount: number) =>
      estimate && country ? convertToLocal(amount, estimate.currency, country.currency, fx) : null;
    return {
      id: job.id,
      source: job.source,
      sourceName: this.sourceName(job.source),
      attribution: this.registry.get(job.source)?.attribution ?? null,
      sourceUrl: job.sourceUrl,
      title: job.title,
      company: job.company,
      companyUrl: job.companyUrl,
      descriptionPreview: preview(job.descriptionText),
      applyUrl: job.applyUrl,
      applyMethod: job.applyMethod as JobListItem['applyMethod'],
      techStack: job.techStack as unknown as TechStack,
      salaryFound: job.salaryFound,
      salaryRawText: job.salaryRawText,
      salaryMin: job.salaryMin,
      salaryMax: job.salaryMax,
      salaryCurrency: job.salaryCurrency,
      salaryPeriod: job.salaryPeriod as JobListItem['salaryPeriod'],
      salaryLocalMin: job.salaryLocalMin,
      salaryLocalMax: job.salaryLocalMax,
      localCurrency: country?.currency ?? null,
      salaryEstimate: estimate
        ? { ...estimate, localMin: toLocal(estimate.min), localMax: toLocal(estimate.max) }
        : null,
      tags: job.tags,
      location: job.location,
      remote: job.remote as JobListItem['remote'],
      regions: job.regions,
      restrictedCountries: job.restrictedCountries,
      contractType: job.contractType as JobListItem['contractType'],
      requiresVat: job.requiresVat,
      viaEor: job.viaEor,
      vatBadge: job.requiresVat === true && !job.viaEor && settings.user.has_vat_number === false,
      seniority: job.seniority as JobListItem['seniority'],
      publishedAt: job.publishedAt?.toISOString() ?? null,
      firstSeenAt: job.firstSeenAt.toISOString(),
      lastSeenAt: job.lastSeenAt.toISOString(),
      ruleScore: job.ruleScore,
      llmScore: job.llmScore,
      rejectedReason: job.rejectedReason,
      status: job.status as JobListItem['status'],
      notes: job.notes,
      duplicateOfId: job.duplicateOfId,
      duplicates: job.duplicates.map((d) => ({ ...d, sourceName: this.sourceName(d.source) })),
      application: application
        ? {
            id: application.id,
            appliedAt: application.appliedAt.toISOString(),
            currentStatus: application.currentStatus as ApplicationStatus,
          }
        : null,
      generatedCvs: {
        count: job.generatedCvs.length,
        languages: [...new Set(job.generatedCvs.map((c) => c.language))],
        latestId: job.generatedCvs[0]?.id ?? null,
      },
    };
  }

  /** Id degli annunci che corrispondono alla ricerca: full-text (tsvector) più similarità su titolo e azienda. */
  private async searchIds(q: string): Promise<string[]> {
    const norm = q.toLowerCase().trim();
    // se la ricerca è una tecnologia nota ("nestjs", "postgres") si trova anche chi la scrive in altro modo ("Nest.js")
    const tech = canonicalTech(norm)?.name;
    const techPattern = tech ? `%"${tech.replace(/[%_]/g, '')}"%` : null;
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Job"
      WHERE "searchVector" @@ websearch_to_tsquery('english', ${q})
         OR (${techPattern}::text IS NOT NULL AND "techStack"::text ILIKE ${techPattern})
         OR "titleNorm" ILIKE ${`%${norm.replace(/[%_]/g, '')}%`}
         OR "companyNorm" ILIKE ${`%${norm.replace(/[%_]/g, '')}%`}
         OR similarity("titleNorm", ${norm}) > 0.45
         OR similarity("companyNorm", ${norm}) > 0.45
      ORDER BY ts_rank("searchVector", websearch_to_tsquery('english', ${q})) DESC
      LIMIT 3000`;
    return rows.map((r) => r.id);
  }

  private async buildWhere(query: JobsQueryDto, settings: Settings): Promise<Prisma.JobWhereInput> {
    const and: Prisma.JobWhereInput[] = [{ duplicateOfId: null }];
    if (!query.includeRejected) and.push({ rejectedReason: null });
    if (query.status) and.push({ status: query.status });
    else and.push({ status: { not: 'discarded' } });
    if (query.source) and.push({ OR: [{ source: query.source }, { duplicates: { some: { source: query.source } } }] });
    if (query.minScore !== undefined && query.minScore > 0) and.push({ ruleScore: { gte: query.minScore } });
    if (query.remote) and.push({ remote: query.remote });
    if (query.contractType) and.push({ contractType: query.contractType });
    if (query.vatCompatible && settings.user.has_vat_number === false) {
      and.push({ OR: [{ requiresVat: null }, { requiresVat: false }, { viaEor: true }] });
    }
    if (query.q?.trim()) and.push({ id: { in: await this.searchIds(query.q.trim()) } });
    return { AND: and };
  }

  private orderBy(sort: JobsQueryDto['sort']): Prisma.JobOrderByWithRelationInput[] {
    return sort === 'date'
      ? [{ publishedAt: { sort: 'desc', nulls: 'last' } }, { firstSeenAt: 'desc' }, { id: 'asc' }]
      : [{ ruleScore: 'desc' }, { publishedAt: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }];
  }

  async list(query: JobsQueryDto): Promise<Paginated<JobListItem>> {
    const settings = await this.settings.get();
    const where = await this.buildWhere(query, settings);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 30;
    const [total, rows] = await Promise.all([
      this.prisma.job.count({ where }),
      this.prisma.job.findMany({
        where,
        include: LIST_INCLUDE,
        orderBy: this.orderBy(query.sort),
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { items: rows.map((r) => this.toListItem(r, settings)), total, page, pageSize };
  }

  async get(id: string): Promise<JobDetail> {
    const settings = await this.settings.get();
    const job = await this.prisma.job.findUnique({ where: { id }, include: LIST_INCLUDE });
    if (!job) throw new NotFoundException('Annuncio non trovato');
    const country = getCountry(settings.user.country);
    return {
      ...this.toListItem(job, settings),
      descriptionOriginal: job.descriptionOriginal,
      descriptionHtml: job.descriptionHtml,
      language: job.language,
      scoreBreakdown: job.scoreBreakdown as unknown as ScoreBreakdown,
      llmReason: job.llmReason,
      llmRedFlags: job.llmRedFlags,
      timezoneOffsets: job.timezoneOffsets,
      // nota informativa, non consulenza: contratto B2B, utente in un paese UE con partita IVA
      euVatNote: !!country?.eu && settings.user.has_vat_number === true && job.requiresVat === true,
    };
  }

  async update(id: string, dto: UpdateJobDto): Promise<JobDetail> {
    const exists = await this.prisma.job.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException('Annuncio non trovato');
    await this.prisma.job.update({
      where: { id },
      data: {
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes.trim() || null } : {}),
      },
    });
    return this.get(id);
  }

  async exportCsv(query: JobsQueryDto): Promise<string> {
    const settings = await this.settings.get();
    const where = await this.buildWhere(query, settings);
    const rows = await this.prisma.job.findMany({
      where,
      include: LIST_INCLUDE,
      orderBy: this.orderBy(query.sort),
      take: 5000,
    });
    const headers = [
      'Titolo', 'Azienda', 'Fonte', 'Punteggio', 'Stato', 'Remoto', 'Contratto', 'Località', 'RAL (come da annuncio)',
      'RAL min (valuta locale)', 'RAL max (valuta locale)', 'Valuta locale', 'Periodo', 'Stack', 'Pubblicato',
      'Link candidatura', 'Link annuncio', 'Motivo scarto',
    ]; // prettier-ignore
    return toCsv(
      headers,
      rows.map((r) => {
        const j = this.toListItem(r, settings);
        return [
          j.title, j.company, j.sourceName, j.ruleScore, j.status, j.remote, j.contractType, j.location,
          j.salaryFound ? j.salaryRawText : 'Non indicata', j.salaryLocalMin, j.salaryLocalMax, j.localCurrency,
          j.salaryPeriod, Object.values(j.techStack).flat().join(' | '), j.publishedAt?.slice(0, 10),
          j.applyUrl, j.sourceUrl, j.rejectedReason,
        ]; // prettier-ignore
      }),
    );
  }

  async stats(): Promise<StatsDto> {
    const [total, accepted, rejected, duplicates, newCount, bySource, byStatus, lastRun] = await Promise.all([
      this.prisma.job.count(),
      this.prisma.job.count({ where: { rejectedReason: null, duplicateOfId: null } }),
      this.prisma.job.count({ where: { rejectedReason: { not: null }, duplicateOfId: null } }),
      this.prisma.job.count({ where: { duplicateOfId: { not: null } } }),
      this.prisma.job.count({ where: { rejectedReason: null, duplicateOfId: null, status: 'new' } }),
      this.prisma.job.groupBy({ by: ['source'], _count: { _all: true } }),
      this.prisma.job.groupBy({
        by: ['status'],
        where: { rejectedReason: null, duplicateOfId: null },
        _count: { _all: true },
      }),
      this.prisma.fetchRun.findFirst({ where: { status: 'success' }, orderBy: { finishedAt: 'desc' } }),
    ]);
    return {
      total,
      accepted,
      rejected,
      duplicates,
      newCount,
      bySource: Object.fromEntries(bySource.map((s) => [s.source, s._count._all])),
      byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])),
      lastFetchAt: lastRun?.finishedAt?.toISOString() ?? null,
    };
  }
}
