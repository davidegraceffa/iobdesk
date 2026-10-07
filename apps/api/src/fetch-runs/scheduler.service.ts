import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import type { SourceId } from '@jobagg/shared';
import { isOnboardingComplete } from '@jobagg/shared';
import { Subscription } from 'rxjs';
import { ENV, type Env } from '../config/env';
import { SettingsService } from '../config/settings.service';
import { PrismaService } from '../prisma/prisma.service';
import { SourcesRegistry } from '../sources/sources.registry';
import { effectiveIntervalMinutes, FetchService } from './fetch.service';

const PREFIX = 'fetch:';

/**
 * Scheduling dinamico: un intervallo per fonte, letto dalle impostazioni e riprogrammato
 * a ogni salvataggio. Finché l'onboarding non è completo non parte nessuna raccolta.
 */
@Injectable()
export class SchedulerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);
  private subscription?: Subscription;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly registry: SchedulerRegistry,
    private readonly sources: SourcesRegistry,
    private readonly settings: SettingsService,
    private readonly prisma: PrismaService,
    private readonly fetch: FetchService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.env.cliMode) return;
    await this.fetch.closeStaleRuns();
    await this.reschedule();
    this.subscription = this.settings.changes$.subscribe(() => {
      this.reschedule().catch((err: Error) => this.logger.error(`Riprogrammazione fallita: ${err.message}`));
    });
  }

  onModuleDestroy(): void {
    this.subscription?.unsubscribe();
    this.clear();
  }

  private clear(): void {
    for (const name of this.registry.getIntervals()) {
      if (name.startsWith(PREFIX)) this.registry.deleteInterval(name);
    }
    for (const name of this.registry.getTimeouts()) {
      if (name.startsWith(PREFIX)) this.registry.deleteTimeout(name);
    }
  }

  async reschedule(): Promise<void> {
    this.clear();
    const settings = await this.settings.get();
    if (!isOnboardingComplete(settings)) {
      this.logger.log('Onboarding non completato: nessuna raccolta programmata');
      return;
    }
    const states = new Map((await this.prisma.sourceState.findMany()).map((s) => [s.source, s]));
    let stagger = 0;
    for (const adapter of this.sources.all()) {
      if (!settings.sources[adapter.id as SourceId]?.enabled) continue;
      if (adapter.isConfigured && !adapter.isConfigured()) continue;
      const intervalMs = effectiveIntervalMinutes(adapter, settings) * 60_000;
      const run = () => {
        this.fetch
          .runById(adapter.id, 'schedule')
          .catch((err: Error) => this.logger.error(`${adapter.id}: ${err.message}`));
      };
      this.registry.addInterval(`${PREFIX}${adapter.id}`, setInterval(run, intervalMs));

      // recupero: se l'ultima raccolta riuscita è più vecchia dell'intervallo (o non c'è mai stata),
      // parte subito, scaglionata di qualche secondo tra una fonte e l'altra
      const last = states.get(adapter.id)?.lastSuccessAt?.getTime() ?? 0;
      const lastAttempt = states.get(adapter.id)?.lastAttemptAt?.getTime() ?? 0;
      const dueNow = Date.now() - last >= intervalMs && Date.now() - lastAttempt >= 10 * 60_000;
      if (dueNow) {
        const delay = 3000 + stagger++ * 4000;
        this.registry.addTimeout(`${PREFIX}${adapter.id}:catchup`, setTimeout(run, delay));
      }
    }
    this.logger.log(
      `Raccolte programmate per ${this.registry.getIntervals().filter((n) => n.startsWith(PREFIX)).length} fonti`,
    );
  }
}
