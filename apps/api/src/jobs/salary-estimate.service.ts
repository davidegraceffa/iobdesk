import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  flattenTechStack,
  salaryEstimateSchema,
  type JobDetail,
  type StoredSalaryEstimate,
  type TechStack,
} from '@jobagg/shared';
import { SettingsService } from '../config/settings.service';
import { LlmService } from '../llm/llm.service';
import { PrismaService } from '../prisma/prisma.service';
import { JobsService } from './jobs.service';

const MAX_DESCRIPTION_CHARS = 6000;

export interface SalaryPromptJob {
  title: string;
  company: string;
  location: string;
  remote: string;
  regions: string[];
  restrictedCountries: string[];
  contractType: string;
  seniority: string;
  techStack: TechStack;
  descriptionText: string;
}

export function buildSalaryEstimatePrompt(job: SalaryPromptJob): { system: string; user: string } {
  const system = [
    'You estimate a plausible gross yearly salary range for a job posting that does not state the salary.',
    'Respond ONLY with a JSON object of this shape:',
    '{"min": number, "max": number, "currency": "ISO 4217 code", "market": string, "confidence": "low" | "medium" | "high", "reasoning": string}',
    '- min, max: gross yearly salary for a full-time position, as plain numbers without separators (for example 52000).',
    '  Keep the range realistic and reasonably narrow: max should not exceed about 1.4 times min.',
    '- market: the geographic labour market the estimate refers to (for example "Germania", "Stati Uniti", "Italia").',
    '- currency: the currency normally used for salaries in that market.',
    '- reasoning: two or three sentences in Italian explaining the estimate (role, seniority, market, stack).',
    '',
    'RULES',
    '1. Base the estimate on the geographic area the posting comes from: the job location, the country of the company or',
    '   the countries and regions candidates must be based in. For a remote role open worldwide, use the market where the',
    '   company is based if the posting reveals it; otherwise use the main hiring region mentioned.',
    '2. Take into account role, seniority, tech stack, contract type and the kind of company described.',
    '3. If the area cannot be determined or the posting is too vague, still give your best estimate and set',
    '   "confidence" to "low", saying in "reasoning" what is missing.',
    '4. Never present the figures as stated by the company: this is an estimate from general market knowledge.',
  ].join('\n');
  const description =
    job.descriptionText.length > MAX_DESCRIPTION_CHARS
      ? `${job.descriptionText.slice(0, MAX_DESCRIPTION_CHARS)}\n[truncated]`
      : job.descriptionText;
  const user = [
    `Job title: ${job.title}`,
    `Company: ${job.company}`,
    `Location: ${job.location || 'not stated'} (remote: ${job.remote})`,
    `Candidate regions: ${job.regions.join(', ') || 'not stated'}`,
    `Restricted to countries: ${job.restrictedCountries.join(', ') || 'not stated'}`,
    `Contract: ${job.contractType}`,
    `Seniority: ${job.seniority}`,
    `Tech stack: ${flattenTechStack(job.techStack).join(', ') || 'not stated'}`,
    '',
    description,
  ].join('\n');
  return { system, user };
}

/**
 * Stima della RAL per gli annunci che non la indicano: la propone l'LLM in base a ruolo, seniority e
 * area geografica dell'offerta. È un dato a parte, mai usato da filtri e punteggi.
 */
@Injectable()
export class SalaryEstimateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly llm: LlmService,
    private readonly jobs: JobsService,
  ) {}

  async estimate(jobId: string): Promise<JobDetail> {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Annuncio non trovato');
    if (job.salaryFound) throw new ConflictException('L’annuncio indica già la retribuzione: non serve una stima');
    const settings = await this.settings.get();
    const status = this.llm.status(settings);
    if (!status.ready) throw new ConflictException(status.notReadyReason ?? 'LLM non disponibile');

    const techStack = job.techStack as unknown as TechStack;
    const result = await this.llm.completeJson(settings, salaryEstimateSchema, {
      task: 'salary_estimate',
      ...buildSalaryEstimatePrompt({ ...job, techStack }),
      maxTokens: 4000,
    });
    const estimate: StoredSalaryEstimate = {
      min: Math.round(Math.min(result.min, result.max)),
      max: Math.round(Math.max(result.min, result.max)),
      currency: result.currency,
      market: result.market.trim(),
      confidence: result.confidence,
      reasoning: result.reasoning.trim(),
      provider: status.provider,
      model: status.model,
      createdAt: new Date().toISOString(),
    };
    await this.prisma.job.update({
      where: { id: jobId },
      data: { salaryEstimate: estimate as unknown as Prisma.InputJsonValue },
    });
    return this.jobs.get(jobId);
  }
}
