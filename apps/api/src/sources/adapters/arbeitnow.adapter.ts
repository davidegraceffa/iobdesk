import { Injectable } from '@nestjs/common';
import { SourceFormatError, type FetchContext, type JobInput, type RawJob, type SourceAdapter } from '../source.types';
import { asDate, asNumber, asString, asStringArray, mapContract, mapSeniority } from './helpers';

const HYBRID_RE = /\bhybrid|\bhome[- ]?office\b|\bremote\b|\bmobiles? arbeiten\b/i;

interface ArbeitnowPage {
  data?: unknown;
  links?: { next?: string | null };
}

/**
 * Arbeitnow: API pubblica JSON, mercato europeo (soprattutto Germania), con flag `remote`.
 * Paginazione tramite `links.next`; ogni pagina ha circa 300 annunci.
 */
@Injectable()
export class ArbeitnowAdapter implements SourceAdapter {
  readonly id = 'arbeitnow';
  readonly displayName = 'Arbeitnow';
  readonly homepage = 'https://www.arbeitnow.com';
  readonly relevantRegions = ['europe', 'de', 'dach'];
  readonly attribution = 'Annunci forniti da Arbeitnow';
  readonly minIntervalMinutes = 60;

  static readonly URL = 'https://www.arbeitnow.com/api/job-board-api';
  static readonly MAX_PAGES = 2;

  async fetchJobs(ctx: FetchContext): Promise<RawJob[]> {
    const jobs: RawJob[] = [];
    let url: string | null = ArbeitnowAdapter.URL;
    for (let page = 1; url && page <= ArbeitnowAdapter.MAX_PAGES; page++) {
      const body: ArbeitnowPage | null = await ctx.http.getJson<ArbeitnowPage>(url);
      if (!body || !Array.isArray(body.data)) throw new SourceFormatError(this.id, 'campo "data" assente');
      jobs.push(...(body.data as RawJob[]));
      const next: string | null | undefined = body.links?.next;
      url = next && next.startsWith(ArbeitnowAdapter.URL) ? next : null;
    }
    return jobs;
  }

  normalize(raw: RawJob): JobInput {
    const jobTypes = asStringArray(raw.job_types);
    const tags = asStringArray(raw.tags);
    const isRemote = raw.remote === true;
    return {
      source: this.id,
      externalId: asString(raw.slug),
      sourceUrl: asString(raw.url),
      title: asString(raw.title),
      company: asString(raw.company_name),
      descriptionOriginal: asString(raw.description),
      tags: [...tags, ...jobTypes],
      location: asString(raw.location),
      // remote: false è un'indicazione esplicita della fonte: non è full remote (ibrido se il testo lo dice)
      remoteHint: isRemote
        ? 'full'
        : HYBRID_RE.test(`${asString(raw.title)} ${asString(raw.description)}`)
          ? 'hybrid'
          : 'onsite',
      contractHint: jobTypes.map(mapContract).find(Boolean),
      seniorityHint: jobTypes.map(mapSeniority).find(Boolean),
      publishedAt: asDate(asNumber(raw.created_at)),
    };
  }
}
