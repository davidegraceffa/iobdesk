import { Injectable } from '@nestjs/common';
import { parseSalary } from '@jobagg/shared';
import { SourceFormatError, type FetchContext, type JobInput, type RawJob, type SourceAdapter } from '../source.types';
import { asDate, asString, asStringArray, mapContract } from './helpers';

/**
 * Remotive: API pubblica JSON.
 * Verificato il 2026-10-01: la risposta contiene un campione ridotto di annunci di tutte le categorie
 * e ignora i parametri `category`, `search` e `limit`; il filtro per keyword lo fa la pipeline.
 * Remotive chiede di non interrogare l'API più di qualche volta al giorno: da qui l'intervallo minimo.
 */
@Injectable()
export class RemotiveAdapter implements SourceAdapter {
  readonly id = 'remotive';
  readonly displayName = 'Remotive';
  readonly homepage = 'https://remotive.com';
  readonly relevantRegions = ['worldwide'];
  readonly attribution = 'Annunci forniti da Remotive';
  readonly minIntervalMinutes = 360;

  static readonly URL = 'https://remotive.com/api/remote-jobs?category=software-dev';

  async fetchJobs(ctx: FetchContext): Promise<RawJob[]> {
    const body = await ctx.http.getJson<{ jobs?: unknown }>(RemotiveAdapter.URL);
    if (!body || !Array.isArray(body.jobs)) throw new SourceFormatError(this.id, 'campo "jobs" assente');
    return body.jobs as RawJob[];
  }

  normalize(raw: RawJob): JobInput {
    const jobType = asString(raw.job_type);
    return {
      source: this.id,
      externalId: asString(raw.id),
      sourceUrl: asString(raw.url),
      title: asString(raw.title),
      company: asString(raw.company_name),
      descriptionOriginal: asString(raw.description),
      tags: [...asStringArray(raw.tags), asString(raw.category)].filter(Boolean),
      location: asString(raw.candidate_required_location),
      remoteHint: 'full',
      contractHint: mapContract(jobType),
      seniorityHint: jobType === 'internship' ? 'intern' : undefined,
      // "salary" è un campo testuale libero della fonte: "$90k - $105k", "$90 - $150 /hour"
      salary: parseSalary(asString(raw.salary)),
      publishedAt: asDate(raw.publication_date),
    };
  }
}
