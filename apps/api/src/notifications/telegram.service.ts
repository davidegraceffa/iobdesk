import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Settings } from '@jobagg/shared';
import { ENV, type Env } from '../config/env';
import { SettingsService } from '../config/settings.service';
import { PrismaService } from '../prisma/prisma.service';

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Notifiche Telegram opzionali per i nuovi annunci sopra soglia. Token e chat id solo in .env. */
@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  isConfigured(): boolean {
    return !!this.env.telegram.botToken && !!this.env.telegram.chatId;
  }

  isActive(settings: Settings): boolean {
    return settings.notifications.telegram.enabled && this.isConfigured();
  }

  /**
   * Notifica gli annunci indicati che superano le soglie e non sono già stati notificati.
   * Se lo scoring LLM ha prodotto un punteggio, deve superare anche `min_score_to_notify`.
   */
  async notifyJobs(jobIds: string[]): Promise<number> {
    const settings = await this.settings.get();
    if (!this.isActive(settings) || jobIds.length === 0) return 0;
    const jobs = await this.prisma.job.findMany({
      where: {
        id: { in: jobIds },
        notifiedAt: null,
        rejectedReason: null,
        duplicateOfId: null,
        ruleScore: { gte: settings.notifications.telegram.min_score },
      },
      orderBy: { ruleScore: 'desc' },
      take: 20,
    });
    let sent = 0;
    for (const job of jobs) {
      if (job.llmScore !== null && job.llmScore < settings.scoring.llm.min_score_to_notify) continue;
      const lines = [
        `<b>${escapeHtml(job.title)}</b>`,
        `${escapeHtml(job.company)} · ${escapeHtml(job.location || 'località non indicata')}`,
        `Punteggio ${job.ruleScore}/100${job.llmScore !== null ? ` · LLM ${job.llmScore}/100` : ''}`,
        job.salaryFound && job.salaryRawText ? `Retribuzione: ${escapeHtml(job.salaryRawText)}` : 'RAL non indicata',
        `<a href="${escapeHtml(job.applyUrl ?? job.sourceUrl)}">Apri l’annuncio</a>`,
      ];
      if (await this.send(lines.join('\n'))) {
        await this.prisma.job.update({ where: { id: job.id }, data: { notifiedAt: new Date() } });
        sent++;
      }
    }
    return sent;
  }

  private async send(html: string): Promise<boolean> {
    try {
      const response = await fetch(`https://api.telegram.org/bot${this.env.telegram.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.env.telegram.chatId,
          text: html,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) this.logger.warn(`Telegram ha risposto HTTP ${response.status}`);
      return response.ok;
    } catch (err) {
      this.logger.warn(`Notifica Telegram non inviata: ${(err as Error).message}`);
      return false;
    }
  }
}
