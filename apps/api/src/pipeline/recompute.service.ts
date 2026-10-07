import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Subscription } from 'rxjs';
import { SettingsService } from '../config/settings.service';
import { QUEUES, QueueService } from '../queue/queue.service';
import { PipelineService } from './pipeline.service';

/**
 * Quando le impostazioni vengono salvate, filtri e punteggi di tutti gli annunci esistenti
 * vengono ricalcolati in background (coda pg-boss).
 */
@Injectable()
export class RecomputeService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(RecomputeService.name);
  private subscription?: Subscription;
  private lastResult: { at: Date; total: number; changed: number } | null = null;

  constructor(
    private readonly settings: SettingsService,
    private readonly pipeline: PipelineService,
    private readonly queue: QueueService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.work<{ version: number }>(QUEUES.recompute, async () => {
      await this.run();
    });
    this.subscription = this.settings.changes$.subscribe(({ version }) => {
      this.queue
        .send(QUEUES.recompute, { version })
        .catch((err: Error) => this.logger.error(`Impossibile accodare il ricalcolo: ${err.message}`));
    });
  }

  onModuleDestroy(): void {
    this.subscription?.unsubscribe();
  }

  async run(): Promise<{ total: number; changed: number }> {
    const result = await this.pipeline.recomputeAll(await this.settings.get());
    this.lastResult = { at: new Date(), ...result };
    return result;
  }

  getLastResult() {
    return this.lastResult;
  }
}
