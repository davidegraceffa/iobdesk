import { Injectable } from '@nestjs/common';
import { parseLocationSpec, salaryFromFields, WORLDWIDE, type LocationSpec } from '@jobagg/shared';
import { SourceFormatError, type FetchContext, type JobInput, type RawJob, type SourceAdapter } from '../source.types';
import { asDate, asNumber, asString, asStringArray, mapContract, mapSeniority } from './helpers';

/**
 * Himalayas: endpoint JSON pubblico. Il feed completo ha ~100.000 annunci (20 per pagina),
 * quindi usiamo la ricerca per keyword (`/jobs/api/search`) con le prime keyword del profilo,
 * ordinata per data. Le restrizioni geografiche e di fuso sono campi strutturati.
 */
@Injectable()
export class HimalayasAdapter implements SourceAdapter {
  readonly id = 'himalayas';
  readonly displayName = 'Himalayas';
  readonly homepage = 'https://himalayas.app';
  readonly relevantRegions = ['worldwide'];
  readonly attribution = 'Annunci forniti da Himalayas';
  readonly minIntervalMinutes = 60;

  static readonly SEARCH_URL = 'https://himalayas.app/jobs/api/search';
  static readonly MAX_KEYWORDS = 3;
  static readonly PAGES_PER_KEYWORD = 2;
  static readonly DEFAULT_KEYWORDS = ['software engineer'];

  static searchUrl(keyword: string, page: number): string {
    return `${HimalayasAdapter.SEARCH_URL}?q=${encodeURIComponent(keyword)}&sort=recent&page=${page}`;
  }

  async fetchJobs(ctx: FetchContext): Promise<RawJob[]> {
    const keywords = [...new Set(ctx.settings.keywords.required_any.map((k) => k.toLowerCase()))].slice(
      0,
      HimalayasAdapter.MAX_KEYWORDS,
    );
    const queries = keywords.length > 0 ? keywords : HimalayasAdapter.DEFAULT_KEYWORDS;
    const byGuid = new Map<string, RawJob>();
    for (const keyword of queries) {
      for (let page = 1; page <= HimalayasAdapter.PAGES_PER_KEYWORD; page++) {
        const body = await ctx.http.getJson<{ jobs?: unknown }>(HimalayasAdapter.searchUrl(keyword, page));
        if (!body || !Array.isArray(body.jobs)) throw new SourceFormatError(this.id, 'campo "jobs" assente');
        const jobs = body.jobs as RawJob[];
        for (const job of jobs) byGuid.set(asString(job.guid) || asString(job.applicationLink), job);
        if (jobs.length === 0) break;
      }
    }
    return [...byGuid.values()];
  }

  normalize(raw: RawJob): JobInput {
    const restrictions = asStringArray(raw.locationRestrictions);
    const locationSpec: LocationSpec =
      restrictions.length === 0 ? { regions: [WORLDWIDE], countries: [] } : parseLocationSpec(restrictions.join(', '));
    // un elenco con (quasi) tutti gli offset equivale a "nessun vincolo di fuso"
    const tz = Array.isArray(raw.timezoneRestrictions)
      ? (raw.timezoneRestrictions as unknown[]).map(asNumber).filter((n): n is number => n !== undefined)
      : [];
    const slug = asString(raw.companySlug);
    const url = asString(raw.guid) || asString(raw.applicationLink);
    return {
      source: this.id,
      externalId: url,
      sourceUrl: url,
      title: asString(raw.title),
      company: asString(raw.companyName),
      companyUrl: slug ? `https://himalayas.app/companies/${slug}` : undefined,
      descriptionOriginal: asString(raw.description) || asString(raw.excerpt),
      applyUrl: asString(raw.applicationLink) || undefined,
      tags: asStringArray(raw.parentCategories),
      location: restrictions.length > 0 ? restrictions.join(', ') : 'Worldwide',
      remoteHint: 'full',
      contractHint: mapContract(asString(raw.employmentType)),
      seniorityHint: asStringArray(raw.seniority).map(mapSeniority).find(Boolean),
      locationSpec,
      timezoneOffsets: tz.length > 0 && tz.length < 20 ? tz : [],
      salary: salaryFromFields({
        min: asNumber(raw.minSalary),
        max: asNumber(raw.maxSalary),
        currency: asString(raw.currency),
        period: asString(raw.salaryPeriod),
      }),
      publishedAt: asDate(asNumber(raw.pubDate)),
    };
  }
}
