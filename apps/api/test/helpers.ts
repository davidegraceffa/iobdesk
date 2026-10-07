import { settingsSchema, type Settings } from '@jobagg/shared';
import { loadEnv, type Env } from '../src/config/env';
import { SettingsService } from '../src/config/settings.service';
import { PrismaService } from '../src/prisma/prisma.service';
import type { JobInput, RawJob, SourceAdapter } from '../src/sources/source.types';

export const env: Env = loadEnv();

export async function connect(): Promise<PrismaService> {
  const prisma = new PrismaService();
  await prisma.$connect();
  return prisma;
}

/** Svuota tutte le tabelle applicative (il database di test è usa e getta). */
export async function resetDatabase(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "InterviewAnswer", "InterviewSession", "ApplicationEvent", "Application", "CvReview", "CoverLetter", "GeneratedCv", "BaseCv", "Job", "FetchRun", "MailSyncRun", "SourceState", "UserSettingsHistory", "UserSettings" RESTART IDENTITY CASCADE',
  );
}

export function testSettings(overrides: Record<string, unknown> = {}): Settings {
  return settingsSchema.parse({
    user: { country: 'IT', has_vat_number: true },
    keywords: { required_any: ['typescript', 'node.js', 'react'], boost: ['nestjs'], exclude: ['php'] },
    freshness: { max_age_days: 365 },
    ...overrides,
  });
}

export async function seedSettings(prisma: PrismaService, settings: Settings): Promise<SettingsService> {
  const service = new SettingsService(prisma, env);
  await service.snapshot();
  await service.save(settings);
  return service;
}

export function jobInput(overrides: Partial<JobInput> & { externalId: string }): JobInput {
  return {
    source: 'fake',
    sourceUrl: `https://fake.example/jobs/${overrides.externalId}`,
    title: 'Senior TypeScript Engineer',
    company: 'Acme',
    descriptionOriginal: '<p>We build APIs with Node.js, NestJS and PostgreSQL. Fully remote team.</p>',
    tags: [],
    location: 'Worldwide',
    remoteHint: 'full',
    contractHint: 'full-time',
    publishedAt: new Date(),
    ...overrides,
  };
}

/** Adapter finto: restituisce gli annunci dati, oppure fallisce come una fonte offline. */
export function fakeAdapter(id: string, jobs: JobInput[] | Error): SourceAdapter {
  return {
    id,
    displayName: id,
    homepage: 'https://fake.example',
    relevantRegions: ['worldwide'],
    async fetchJobs(): Promise<RawJob[]> {
      if (jobs instanceof Error) throw jobs;
      return jobs.map((j) => ({ ...j, source: id }) as unknown as RawJob);
    },
    normalize(raw: RawJob): JobInput {
      return raw as unknown as JobInput;
    },
  };
}
