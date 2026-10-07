import { Injectable } from '@nestjs/common';
import { salaryFromFields } from '@jobagg/shared';
import { SourceFormatError, type FetchContext, type JobInput, type RawJob, type SourceAdapter } from '../source.types';
import { asDate, asNumber, asString, asStringArray, decodeEntities, mapContract, mapSeniority } from './helpers';

/**
 * Jobicy: API pubblica JSON di lavori remoti (v2). Filtro per industria "dev" (sviluppo software);
 * area geografica (`jobGeo`) e retribuzione sono campi strutturati.
 * La fonte chiede attribuzione con link e che il pulsante di candidatura porti alla pagina originale.
 */
@Injectable()
export class JobicyAdapter implements SourceAdapter {
  readonly id = 'jobicy';
  readonly displayName = 'Jobicy';
  readonly homepage = 'https://jobicy.com';
  readonly relevantRegions = ['worldwide'];
  readonly attribution = 'Fonte: Jobicy (jobicy.com). Candidati dalla pagina originale.';
  readonly minIntervalMinutes = 60;

  static readonly URL = 'https://jobicy.com/api/v2/remote-jobs?count=100&industry=dev';

  async fetchJobs(ctx: FetchContext): Promise<RawJob[]> {
    const body = await ctx.http.getJson<{ jobs?: unknown; success?: boolean }>(JobicyAdapter.URL);
    if (!body || !Array.isArray(body.jobs)) throw new SourceFormatError(this.id, 'campo "jobs" assente');
    return body.jobs as RawJob[];
  }

  normalize(raw: RawJob): JobInput {
    const url = asString(raw.url);
    return {
      source: this.id,
      externalId: asString(raw.id),
      sourceUrl: url,
      title: decodeEntities(asString(raw.jobTitle)),
      company: decodeEntities(asString(raw.companyName)),
      descriptionOriginal: asString(raw.jobDescription) || asString(raw.jobExcerpt),
      applyUrl: url,
      applyViaSource: true,
      tags: asStringArray(raw.jobIndustry).map(decodeEntities),
      location: asString(raw.jobGeo).replace(/\s*,\s*/g, ', '),
      remoteHint: 'full',
      contractHint: asStringArray(raw.jobType).map(mapContract).find(Boolean),
      seniorityHint: mapSeniority(asString(raw.jobLevel)),
      salary: salaryFromFields({
        min: asNumber(raw.salaryMin),
        max: asNumber(raw.salaryMax),
        currency: asString(raw.salaryCurrency),
        period: asString(raw.salaryPeriod),
      }),
      publishedAt: asDate(raw.pubDate),
    };
  }
}
