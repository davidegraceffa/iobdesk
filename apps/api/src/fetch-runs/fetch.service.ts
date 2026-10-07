import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { FetchRunDto, FetchSummaryRow, Settings, SourceId, SourceStatusDto } from '@jobagg/shared';
import { SettingsService } from '../config/settings.service';
import { LlmScoringService } from '../llm/llm-scoring.service';
import { TelegramService } from '../notifications/telegram.service';
import { PipelineService } from '../pipeline/pipeline.service';
import { PrismaService } from '../prisma/prisma.service';
import { SourceHttpService, type HttpCache } from '../sources/source-http.service';
import type { SourceAdapter } from '../sources/source.types';
import { SourcesRegistry } from '../sources/sources.registry';

export type FetchTrigger = 'schedule' | 'manual' | 'cli';

/** Le raccolte manuali ravvicinate riusano i dati già in database invece di interrogare di nuovo la fonte. */
const MANUAL_MIN_GAP_MINUTES = 5;
const MAX_CONCURRENT_SOURCES = 3;

export function effectiveIntervalMinutes(adapter: SourceAdapter, settings: Settings): number {
  const configured = settings.sources[adapter.id as SourceId]?.interval_minutes ?? 180;
  return Math.max(configured, adapter.minIntervalMinutes ?? 15);
}

function toRunDto(run: Prisma.FetchRunGetPayload<object>): FetchRunDto {
  return {
    id: run.id,
    source: run.source,
    trigger: run.trigger,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
    status: run.status as FetchRunDto['status'],
    found: run.found,
    created: run.created,
    updated: run.updated,
    duplicates: run.duplicates,
    rejected: run.rejected,
    error: run.error,
    message: run.message,
  };
}

/** Raccolta dalle fonti: una fonte che fallisce non blocca le altre, e ogni errore resta visibile. */
@Injectable()
export class FetchService {
  private readonly logger = new Logger(FetchService.name);
  private readonly running = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly registry: SourcesRegistry,
    private readonly http: SourceHttpService,
    private readonly pipeline: PipelineService,
    private readonly llmScoring: LlmScoringService,
    private readonly telegram: TelegramService,
  ) {}

  isRunning(sourceId: string): boolean {
    return this.running.has(sourceId);
  }

  private isEnabled(settings: Settings, sourceId: string): boolean {
    return settings.sources[sourceId as SourceId]?.enabled === true;
  }

  /** Fonti da raccogliere: quella richiesta oppure tutte le abilitate. */
  private async selectSources(only?: string): Promise<SourceAdapter[]> {
    if (!(await this.settings.isOnboarded())) {
      throw new ConflictException('Completa prima l’onboarding (paese e P.IVA): i filtri dipendono dal tuo profilo');
    }
    if (only) {
      const adapter = this.registry.get(only);
      if (!adapter) throw new NotFoundException(`Fonte sconosciuta: ${only}`);
      return [adapter];
    }
    const settings = await this.settings.get();
    return this.registry.all().filter((a) => this.isEnabled(settings, a.id));
  }

  /** Avvia la raccolta in background e restituisce subito gli id dei run (per `POST /fetch`). */
  async start(trigger: FetchTrigger, only?: string): Promise<{ runIds: string[] }> {
    const adapters = await this.selectSources(only);
    const runs = await Promise.all(
      adapters.map((a) => this.prisma.fetchRun.create({ data: { source: a.id, trigger, status: 'running' } })),
    );
    void this.pool(adapters.map((adapter, i) => () => this.runSource(adapter, trigger, { runId: runs[i]!.id }))).catch(
      (err: Error) => this.logger.error(`Raccolta in background fallita: ${err.message}`),
    );
    return { runIds: runs.map((r) => r.id) };
  }

  /** Esegue la raccolta e attende il riepilogo per fonte (CLI e scheduler). */
  async runAll(trigger: FetchTrigger, only?: string, options: { force?: boolean } = {}): Promise<FetchSummaryRow[]> {
    const adapters = await this.selectSources(only);
    return this.pool(adapters.map((adapter) => () => this.runSource(adapter, trigger, options)));
  }

  async runById(sourceId: string, trigger: FetchTrigger): Promise<FetchSummaryRow | null> {
    const adapter = this.registry.get(sourceId);
    if (!adapter || !(await this.settings.isOnboarded())) return null;
    return this.runSource(adapter, trigger);
  }

  private async pool<T>(tasks: Array<() => Promise<T>>): Promise<T[]> {
    const results: T[] = new Array(tasks.length);
    let next = 0;
    const worker = async () => {
      while (next < tasks.length) {
        const index = next++;
        results[index] = await tasks[index]!();
      }
    };
    await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_SOURCES, tasks.length) }, worker));
    return results;
  }

  private async finish(runId: string, row: FetchSummaryRow): Promise<FetchSummaryRow> {
    await this.prisma.fetchRun.update({
      where: { id: runId },
      data: {
        finishedAt: new Date(),
        status: row.status,
        found: row.found,
        created: row.created,
        updated: row.updated,
        duplicates: row.duplicates,
        rejected: row.rejected,
        error: row.error ?? null,
        message: row.message ?? null,
      },
    });
    return row;
  }

  async runSource(
    adapter: SourceAdapter,
    trigger: FetchTrigger,
    options: { runId?: string; force?: boolean } = {},
  ): Promise<FetchSummaryRow> {
    const settings = await this.settings.get();
    const empty = { source: adapter.id, found: 0, created: 0, updated: 0, duplicates: 0, rejected: 0 };
    const runId =
      options.runId ??
      (await this.prisma.fetchRun.create({ data: { source: adapter.id, trigger, status: 'running' } })).id;

    if (!this.isEnabled(settings, adapter.id)) {
      return this.finish(runId, { ...empty, status: 'skipped', message: 'Fonte disattivata nelle impostazioni' });
    }
    if (adapter.isConfigured && !adapter.isConfigured()) {
      const error = 'Fonte non configurata: mancano le credenziali nel file .env';
      await this.saveState(adapter.id, { lastAttemptAt: new Date(), lastError: error });
      return this.finish(runId, { ...empty, status: 'error', error });
    }
    if (this.running.has(adapter.id)) {
      return this.finish(runId, { ...empty, status: 'skipped', message: 'Raccolta già in corso per questa fonte' });
    }

    const state = await this.prisma.sourceState.findUnique({ where: { source: adapter.id } });
    if (trigger !== 'schedule' && !options.force && state?.lastSuccessAt) {
      const minutes = (Date.now() - state.lastSuccessAt.getTime()) / 60_000;
      if (minutes < MANUAL_MIN_GAP_MINUTES) {
        return this.finish(runId, {
          ...empty,
          status: 'skipped',
          message: `Raccolta eseguita ${Math.max(1, Math.round(minutes))} min fa: uso i dati già salvati (minimo ${MANUAL_MIN_GAP_MINUTES} min tra due raccolte manuali)`,
        });
      }
    }

    this.running.add(adapter.id);
    const now = new Date();
    try {
      const client = this.http.createClient(adapter.id, (state?.httpCache as HttpCache | null) ?? {});
      const raws = await adapter.fetchJobs({
        http: client,
        settings,
        now,
        log: (message) => this.logger.log(`${adapter.id}: ${message}`),
      });
      const result = await this.pipeline.ingest(adapter, raws, settings, now);
      await this.saveState(adapter.id, {
        lastAttemptAt: now,
        lastSuccessAt: now,
        lastError: null,
        httpCache: {
          ...((state?.httpCache as HttpCache | null) ?? {}),
          ...client.newValidators,
        } as Prisma.InputJsonValue,
      });

      if (result.newAcceptedIds.length > 0) {
        // con lo scoring LLM attivo la notifica parte dopo il punteggio; altrimenti subito
        if (await this.llmScoring.isActive()) await this.llmScoring.enqueue(result.newAcceptedIds);
        else await this.telegram.notifyJobs(result.newAcceptedIds);
      }

      const notModified = client.requestCount > 0 && client.notModifiedCount === client.requestCount;
      const notes = [
        notModified ? 'Nessuna novità dalla fonte (304 Not Modified)' : '',
        result.invalid > 0 ? `${result.invalid} elementi non interpretabili ignorati` : '',
      ].filter(Boolean);
      this.logger.log(
        `${adapter.id}: trovati ${result.found}, nuovi ${result.created}, aggiornati ${result.updated}, duplicati ${result.duplicates}, scartati ${result.rejected}`,
      );
      return await this.finish(runId, {
        source: adapter.id,
        status: 'success',
        found: result.found,
        created: result.created,
        updated: result.updated,
        duplicates: result.duplicates,
        rejected: result.rejected,
        message: notes.join('; ') || undefined,
      });
    } catch (err) {
      const error = (err as Error).message.slice(0, 1000);
      this.logger.error(`${adapter.id}: raccolta fallita: ${error}`);
      await this.saveState(adapter.id, { lastAttemptAt: now, lastError: error }).catch(() => undefined);
      return await this.finish(runId, { ...empty, status: 'error', error });
    } finally {
      this.running.delete(adapter.id);
    }
  }

  private async saveState(source: string, data: Omit<Prisma.SourceStateUncheckedCreateInput, 'source'>): Promise<void> {
    await this.prisma.sourceState.upsert({ where: { source }, create: { source, ...data }, update: data });
  }

  async listRuns(limit = 50, source?: string): Promise<FetchRunDto[]> {
    const runs = await this.prisma.fetchRun.findMany({
      where: source ? { source } : undefined,
      orderBy: { startedAt: 'desc' },
      take: Math.min(limit, 200),
    });
    return runs.map(toRunDto);
  }

  async getRun(id: string): Promise<FetchRunDto> {
    const run = await this.prisma.fetchRun.findUnique({ where: { id } });
    if (!run) throw new NotFoundException('Run non trovato');
    return toRunDto(run);
  }

  /** Stato di ogni fonte e rilevanza per il paese dell'utente (pagina Fonti). */
  async sourcesStatus(): Promise<SourceStatusDto[]> {
    const settings = await this.settings.get();
    const [states, counts] = await Promise.all([
      this.prisma.sourceState.findMany(),
      this.prisma.job.groupBy({ by: ['source'], _count: { _all: true } }),
    ]);
    const stateBy = new Map(states.map((s) => [s.source, s]));
    const countBy = new Map(counts.map((c) => [c.source, c._count._all]));
    return Promise.all(
      this.registry.all().map(async (adapter) => {
        const lastRun = await this.prisma.fetchRun.findFirst({
          where: { source: adapter.id, status: { not: 'skipped' } },
          orderBy: { startedAt: 'desc' },
        });
        const state = stateBy.get(adapter.id);
        return {
          id: adapter.id,
          displayName: adapter.displayName,
          homepage: adapter.homepage,
          relevantRegions: adapter.relevantRegions,
          relevant: this.registry.isRelevantFor(adapter, settings.user.country),
          enabled: this.isEnabled(settings, adapter.id),
          intervalMinutes: effectiveIntervalMinutes(adapter, settings),
          minIntervalMinutes: adapter.minIntervalMinutes ?? 15,
          attribution: adapter.attribution ?? null,
          configured: adapter.isConfigured ? adapter.isConfigured() : true,
          lastSuccessAt: state?.lastSuccessAt?.toISOString() ?? null,
          lastRun: lastRun ? toRunDto(lastRun) : null,
          lastError: state?.lastError ?? null,
          jobCount: countBy.get(adapter.id) ?? 0,
          running: this.running.has(adapter.id),
        } satisfies SourceStatusDto;
      }),
    );
  }

  /** All'avvio: i run rimasti "running" per un riavvio del container vengono chiusi come interrotti. */
  async closeStaleRuns(): Promise<void> {
    await this.prisma.fetchRun.updateMany({
      where: { status: 'running' },
      data: { status: 'error', error: 'Interrotto dal riavvio dell’applicazione', finishedAt: new Date() },
    });
  }
}
