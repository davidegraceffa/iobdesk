import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Subscription } from 'rxjs';
import { ENV, type Env } from '../config/env';
import { SettingsService } from '../config/settings.service';
import { GoogleAuthService } from './google-auth.service';
import { MailSyncService } from './mail-sync.service';

const INTERVAL = 'mail-sync';
const CATCHUP = 'mail-sync:catchup';

/**
 * Sincronizzazione periodica con Gmail: intervallo letto dalle impostazioni e riprogrammato a ogni
 * salvataggio. Senza collegamento a Gmail (o con l'autorizzazione scaduta) non parte nulla.
 */
@Injectable()
export class MailSyncScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(MailSyncScheduler.name);
  private subscription?: Subscription;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly registry: SchedulerRegistry,
    private readonly settings: SettingsService,
    private readonly auth: GoogleAuthService,
    private readonly sync: MailSyncService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.env.cliMode) return;
    await this.sync.closeStaleRuns();
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
    if (this.registry.doesExist('interval', INTERVAL)) this.registry.deleteInterval(INTERVAL);
    if (this.registry.doesExist('timeout', CATCHUP)) this.registry.deleteTimeout(CATCHUP);
  }

  private tick(): void {
    // il collegamento può arrivare (o scadere) dopo la programmazione: si controlla a ogni giro
    if (!this.auth.isConnected() || this.sync.isRunning()) return;
    this.sync.run('schedule').catch((err: Error) => this.logger.error(`Sincronizzazione Gmail: ${err.message}`));
  }

  /** Da richiamare anche dopo il collegamento a Gmail, per non aspettare un intervallo intero. */
  async reschedule(): Promise<void> {
    this.clear();
    if (this.env.cliMode) return;
    const { mail_sync: cfg } = await this.settings.get();
    if (!cfg.enabled) return;
    const intervalMs = cfg.interval_minutes * 60_000;
    this.registry.addInterval(
      INTERVAL,
      setInterval(() => this.tick(), intervalMs),
    );
    this.logger.log(`Sincronizzazione Gmail programmata ogni ${cfg.interval_minutes} minuti`);

    // recupero: se l'ultima sincronizzazione riuscita è più vecchia dell'intervallo parte quasi subito
    const lastSuccess = (await this.sync.lastSuccessAt())?.getTime() ?? 0;
    const lastAttempt = (await this.sync.lastAttemptAt())?.getTime() ?? 0;
    if (Date.now() - lastSuccess >= intervalMs && Date.now() - lastAttempt >= 10 * 60_000) {
      this.registry.addTimeout(
        CATCHUP,
        setTimeout(() => this.tick(), 20_000),
      );
    }
  }
}
