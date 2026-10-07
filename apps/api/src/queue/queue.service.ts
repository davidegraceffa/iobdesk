import { Inject, Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import PgBoss from 'pg-boss';
import { ENV, type Env } from '../config/env';

export const QUEUES = {
  cvGenerate: 'cv-generate',
  recompute: 'recompute',
  llmScore: 'llm-score',
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

type Handler<T> = (data: T) => Promise<void>;

/**
 * Code di lavoro per i task lunghi (generazione CV, ricalcolo punteggi, scoring LLM) con pg-boss:
 * usa lo stesso PostgreSQL dell'app (schema `pgboss`), nessun Redis aggiuntivo.
 */
@Injectable()
export class QueueService implements OnApplicationShutdown {
  private readonly logger = new Logger(QueueService.name);
  private boss: PgBoss | null = null;
  private starting: Promise<PgBoss> | null = null;

  constructor(@Inject(ENV) private readonly env: Env) {}

  private start(): Promise<PgBoss> {
    this.starting ??= (async () => {
      const url = new URL(this.env.databaseUrl);
      // "schema" è un parametro di Prisma, non di PostgreSQL
      url.searchParams.delete('schema');
      const boss = new PgBoss({ connectionString: url.toString(), schema: 'pgboss', max: 4 });
      boss.on('error', (err) => this.logger.error(`pg-boss: ${err.message}`));
      await boss.start();
      for (const name of Object.values(QUEUES)) await boss.createQueue(name);
      this.boss = boss;
      this.logger.log('Code pg-boss pronte');
      return boss;
    })();
    return this.starting;
  }

  /** Accoda un lavoro. Con `singletonKey` un secondo lavoro uguale ancora in coda viene ignorato. */
  async send<T extends object>(
    queue: QueueName,
    data: T,
    options: { singletonKey?: string; retryLimit?: number } = {},
  ): Promise<string | null> {
    const boss = await this.start();
    return boss.send(queue, data, {
      retryLimit: options.retryLimit ?? 0,
      expireInSeconds: 60 * 30,
      ...(options.singletonKey ? { singletonKey: options.singletonKey } : {}),
    });
  }

  /** Registra un worker. Nella CLI i worker non partono: i lavori restano in coda per l'api. */
  async work<T extends object>(
    queue: QueueName,
    handler: Handler<T>,
    options: { concurrency?: number } = {},
  ): Promise<void> {
    if (this.env.cliMode) return;
    const boss = await this.start();
    const workers = options.concurrency ?? 1;
    for (let i = 0; i < workers; i++) {
      await boss.work<T>(queue, { pollingIntervalSeconds: 1 }, async (jobs) => {
        for (const job of jobs) {
          try {
            await handler(job.data);
          } catch (err) {
            this.logger.error(`Lavoro ${queue}/${job.id} fallito: ${(err as Error).message}`);
            throw err;
          }
        }
      });
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.boss) await this.boss.stop({ graceful: true, timeout: 5000 }).catch(() => undefined);
  }
}
