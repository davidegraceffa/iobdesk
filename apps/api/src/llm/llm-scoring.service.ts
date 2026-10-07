import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { getCountry, llmScoreSchema, type Settings } from '@jobagg/shared';
import { SettingsService } from '../config/settings.service';
import { TelegramService } from '../notifications/telegram.service';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUES, QueueService } from '../queue/queue.service';
import { LlmService } from './llm.service';

const MAX_DESCRIPTION_CHARS = 6000;

export function buildScorePrompt(
  settings: Settings,
  job: {
    title: string;
    company: string;
    location: string;
    contractType: string;
    remote: string;
    descriptionText: string;
  },
): { system: string; user: string } {
  const country = getCountry(settings.user.country);
  const system = [
    'Valuti quanto un annuncio di lavoro è adatto a un candidato specifico.',
    'Rispondi SOLO con un oggetto JSON: {"score": numero da 0 a 100, "reason": "motivazione in italiano, massimo 3 frasi", "red_flags": ["eventuali segnali negativi"]}.',
    'Basati esclusivamente sul testo fornito: non inventare informazioni sull’azienda o sulla retribuzione.',
  ].join('\n');
  const description =
    job.descriptionText.length > MAX_DESCRIPTION_CHARS
      ? `${job.descriptionText.slice(0, MAX_DESCRIPTION_CHARS)}\n[descrizione troncata]`
      : job.descriptionText;
  const user = [
    '## Candidato',
    `Titolo: ${settings.profile.title || 'non indicato'}`,
    `Sommario: ${settings.profile.summary || 'non indicato'}`,
    `Paese di residenza: ${country?.name ?? 'non indicato'}`,
    `Può fatturare con partita IVA / VAT: ${settings.user.has_vat_number ? 'sì' : 'no'}`,
    `Competenze cercate: ${settings.keywords.required_any.join(', ') || 'non indicate'}`,
    `Competenze preferite: ${settings.keywords.boost.join(', ') || 'non indicate'}`,
    `Seniority: ${settings.seniority.include.join(', ')}`,
    `Contratti accettati: ${settings.contract.types.join(', ')}`,
    `Solo remoto: ${settings.location.remote_only ? 'sì' : 'no'}`,
    '',
    '## Annuncio',
    `Titolo: ${job.title}`,
    `Azienda: ${job.company}`,
    `Località: ${job.location || 'non indicata'} (remoto: ${job.remote})`,
    `Contratto: ${job.contractType}`,
    '',
    description,
  ].join('\n');
  return { system, user };
}

/** Punteggio LLM opzionale: solo per annunci nuovi che hanno superato i filtri. */
@Injectable()
export class LlmScoringService implements OnApplicationBootstrap {
  private readonly logger = new Logger(LlmScoringService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly llm: LlmService,
    private readonly queue: QueueService,
    private readonly telegram: TelegramService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.work<{ jobId: string }>(QUEUES.llmScore, ({ jobId }) => this.scoreJob(jobId));
  }

  /** true se lo scoring LLM è attivo e utilizzabile con le impostazioni correnti. */
  async isActive(): Promise<boolean> {
    return this.llm.status(await this.settings.get()).ready;
  }

  async enqueue(jobIds: string[]): Promise<void> {
    for (const jobId of jobIds) await this.queue.send(QUEUES.llmScore, { jobId }, { singletonKey: `score:${jobId}` });
  }

  async scoreJob(jobId: string): Promise<void> {
    const settings = await this.settings.get();
    if (!this.llm.status(settings).ready) return;
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job || job.rejectedReason || job.duplicateOfId || job.llmScore !== null) return;
    try {
      const prompt = buildScorePrompt(settings, job);
      const result = await this.llm.completeJson(settings, llmScoreSchema, {
        task: 'score',
        ...prompt,
        maxTokens: 4000,
      });
      await this.prisma.job.update({
        where: { id: jobId },
        data: { llmScore: Math.round(result.score), llmReason: result.reason, llmRedFlags: result.red_flags },
      });
    } catch (err) {
      // lo scoring LLM è un extra: un errore non deve bloccare né la coda né le notifiche
      this.logger.warn(`Scoring LLM non riuscito per ${jobId}: ${(err as Error).message}`);
    }
    await this.telegram.notifyJobs([jobId]);
  }
}
