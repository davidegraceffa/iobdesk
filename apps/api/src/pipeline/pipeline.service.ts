import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { flattenTechStack, type Settings, type TechStack } from '@jobagg/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { RawJob, SourceAdapter } from '../sources/source.types';
import { evaluateJob, type EvaluableJob, type JobEvaluation } from './evaluate';
import { buildJobCore, type JobCore } from './normalize';

export interface IngestResult {
  found: number;
  created: number;
  updated: number;
  duplicates: number;
  rejected: number;
  invalid: number;
  /** annunci nuovi che hanno superato i filtri e non sono duplicati */
  newAcceptedIds: string[];
}

interface PrimaryCandidate {
  id: string;
  status: string;
  notes: string | null;
  descriptionText: string;
  salaryFound: boolean;
  applyMethod: string;
  techStack: Prisma.JsonValue;
  _count: { applications: number; generatedCvs: number };
}

const json = (value: unknown) => value as Prisma.InputJsonValue;

function completeness(job: {
  descriptionText: string;
  salaryFound: boolean;
  applyMethod: string;
  techStack: unknown;
}): number {
  return (
    Math.min(job.descriptionText.length / 1000, 5) +
    (job.salaryFound ? 3 : 0) +
    (job.applyMethod !== 'source_page' ? 2 : 0) +
    Math.min(flattenTechStack(job.techStack as TechStack).length * 0.2, 2)
  );
}

function evaluationData(ev: JobEvaluation) {
  return {
    salaryLocalMin: ev.salaryLocalMin,
    salaryLocalMax: ev.salaryLocalMax,
    rejectedReason: ev.rejectedReason,
    ruleScore: ev.ruleScore,
    scoreBreakdown: json(ev.scoreBreakdown),
  };
}

/** Normalizzazione → deduplicazione → filtri → punteggio → persistenza. */
@Injectable()
export class PipelineService {
  private readonly logger = new Logger(PipelineService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Cerca l'annuncio "principale" di cui `core` è un duplicato: stesso URL canonico di candidatura
   * (con titolo simile) oppure azienda e titolo normalizzati simili oltre la soglia (pg_trgm).
   */
  async findPrimary(core: JobCore, threshold: number): Promise<PrimaryCandidate | null> {
    if (!core.titleNorm) return null;
    let id: string | undefined;

    if (core.canonicalUrl && core.applyMethod === 'ats') {
      const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "Job"
        WHERE "id" <> ${core.id} AND "duplicateOfId" IS NULL
          AND "canonicalUrl" = ${core.canonicalUrl}
          AND similarity("titleNorm", ${core.titleNorm}) >= 0.45
        ORDER BY "firstSeenAt" ASC LIMIT 1`;
      id = rows[0]?.id;
    }
    if (!id && core.companyNorm) {
      const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "Job"
        WHERE "id" <> ${core.id} AND "duplicateOfId" IS NULL
          AND "companyNorm" % ${core.companyNorm}
          AND similarity("companyNorm", ${core.companyNorm}) >= ${threshold}
          AND similarity("titleNorm", ${core.titleNorm}) >= ${threshold}
        ORDER BY similarity("titleNorm", ${core.titleNorm}) DESC, "firstSeenAt" ASC LIMIT 1`;
      id = rows[0]?.id;
    }
    if (!id) return null;
    return this.prisma.job.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        notes: true,
        descriptionText: true,
        salaryFound: true,
        applyMethod: true,
        techStack: true,
        _count: { select: { applications: true, generatedCvs: true } },
      },
    });
  }

  /** Upsert degli annunci di una fonte. Non tocca mai stato, note e candidature dell'utente. */
  async ingest(
    adapter: SourceAdapter,
    raws: RawJob[],
    settings: Settings,
    now: Date = new Date(),
  ): Promise<IngestResult> {
    const result: IngestResult = {
      found: raws.length,
      created: 0,
      updated: 0,
      duplicates: 0,
      rejected: 0,
      invalid: 0,
      newAcceptedIds: [],
    };

    const cores = new Map<string, JobCore>();
    for (const raw of raws) {
      try {
        const core = buildJobCore(adapter.normalize(raw));
        cores.set(core.id, core);
      } catch (err) {
        result.invalid++;
        this.logger.debug(`${adapter.id}: elemento scartato (${(err as Error).message})`);
      }
    }

    for (const core of cores.values()) {
      const existing = await this.prisma.job.findUnique({
        where: { id: core.id },
        select: { id: true, firstSeenAt: true, duplicateOfId: true },
      });
      const ev = evaluateJob({ ...core, firstSeenAt: existing?.firstSeenAt ?? now }, settings, now);
      const content = { ...core, techStack: json(core.techStack) };

      if (existing) {
        const { id: _id, ...fields } = content;
        await this.prisma.job.update({
          where: { id: core.id },
          data: { ...fields, ...evaluationData(ev), lastSeenAt: now },
        });
        result.updated++;
        if (existing.duplicateOfId) result.duplicates++;
        if (ev.rejectedReason) result.rejected++;
        continue;
      }

      const primary = await this.findPrimary(core, settings.dedupe.similarity_threshold);
      // teniamo come principale l'annuncio più completo, a meno che l'utente abbia già lavorato sull'altro
      const untouched =
        !!primary &&
        primary.status === 'new' &&
        !primary.notes &&
        primary._count.applications === 0 &&
        primary._count.generatedCvs === 0;
      const takeOver = !!primary && untouched && completeness(core) > completeness(primary) + 1;

      await this.prisma.$transaction(async (tx) => {
        await tx.job.create({
          data: {
            ...content,
            ...evaluationData(ev),
            firstSeenAt: now,
            lastSeenAt: now,
            duplicateOfId: primary && !takeOver ? primary.id : null,
          },
        });
        if (primary && takeOver) {
          await tx.job.updateMany({
            where: { OR: [{ id: primary.id }, { duplicateOfId: primary.id }] },
            data: { duplicateOfId: core.id },
          });
        }
      });

      result.created++;
      if (primary) result.duplicates++;
      if (ev.rejectedReason) result.rejected++;
      if (!ev.rejectedReason && (!primary || takeOver)) result.newAcceptedIds.push(core.id);
    }
    return result;
  }

  /** Ricalcola filtri, punteggi e conversioni di tutti gli annunci con le impostazioni correnti. */
  async recomputeAll(settings: Settings, now: Date = new Date()): Promise<{ total: number; changed: number }> {
    let cursor: string | undefined;
    let total = 0;
    let changed = 0;
    for (;;) {
      const batch = await this.prisma.job.findMany({
        take: 250,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: 'asc' },
        select: EVALUABLE_SELECT,
      });
      if (batch.length === 0) break;
      cursor = batch[batch.length - 1]!.id;
      for (const row of batch) {
        total++;
        const ev = evaluateJob(toEvaluable(row), settings, now);
        const same =
          ev.ruleScore === row.ruleScore &&
          ev.rejectedReason === row.rejectedReason &&
          ev.salaryLocalMin === row.salaryLocalMin &&
          ev.salaryLocalMax === row.salaryLocalMax &&
          JSON.stringify(ev.scoreBreakdown) === JSON.stringify(row.scoreBreakdown);
        if (same) continue;
        await this.prisma.job.update({ where: { id: row.id }, data: evaluationData(ev) });
        changed++;
      }
    }
    this.logger.log(`Ricalcolo completato: ${changed} annunci aggiornati su ${total}`);
    return { total, changed };
  }

  /** Quanti annunci (non duplicati) passerebbero i filtri con nuove impostazioni, senza salvare nulla. */
  async previewAccepted(
    candidate: Settings,
    now: Date = new Date(),
  ): Promise<{ total: number; acceptedNow: number; acceptedAfter: number }> {
    let cursor: string | undefined;
    let total = 0;
    let acceptedNow = 0;
    let acceptedAfter = 0;
    for (;;) {
      const batch = await this.prisma.job.findMany({
        where: { duplicateOfId: null },
        take: 500,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: 'asc' },
        select: EVALUABLE_SELECT,
      });
      if (batch.length === 0) break;
      cursor = batch[batch.length - 1]!.id;
      for (const row of batch) {
        total++;
        if (!row.rejectedReason) acceptedNow++;
        if (!evaluateJob(toEvaluable(row), candidate, now).rejectedReason) acceptedAfter++;
      }
    }
    return { total, acceptedNow, acceptedAfter };
  }
}

const EVALUABLE_SELECT = {
  id: true,
  title: true,
  company: true,
  tags: true,
  descriptionText: true,
  techStack: true,
  location: true,
  remote: true,
  regions: true,
  restrictedCountries: true,
  timezoneOffsets: true,
  contractType: true,
  requiresVat: true,
  viaEor: true,
  seniority: true,
  salaryFound: true,
  salaryMin: true,
  salaryMax: true,
  salaryCurrency: true,
  salaryPeriod: true,
  salaryLocalMin: true,
  salaryLocalMax: true,
  publishedAt: true,
  firstSeenAt: true,
  ruleScore: true,
  rejectedReason: true,
  scoreBreakdown: true,
} satisfies Prisma.JobSelect;

type EvaluableRow = Prisma.JobGetPayload<{ select: typeof EVALUABLE_SELECT }>;

function toEvaluable(row: EvaluableRow): EvaluableJob {
  return {
    ...row,
    techStack: row.techStack as unknown as TechStack,
    remote: row.remote as EvaluableJob['remote'],
    contractType: row.contractType as EvaluableJob['contractType'],
    seniority: row.seniority as EvaluableJob['seniority'],
    salaryPeriod: row.salaryPeriod as EvaluableJob['salaryPeriod'],
  };
}
