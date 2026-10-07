import { Injectable } from '@nestjs/common';
import { salaryFromFields } from '@jobagg/shared';
import { SourceFormatError, type FetchContext, type JobInput, type RawJob, type SourceAdapter } from '../source.types';
import { asDate, asNumber, asString, asStringArray, fixMojibake } from './helpers';

/**
 * Remote OK: endpoint JSON pubblico. Il primo elemento dell'array è la nota legale.
 * I termini d'uso richiedono di citare Remote OK come fonte e di linkare l'annuncio originale.
 */
@Injectable()
export class RemoteOkAdapter implements SourceAdapter {
  readonly id = 'remoteok';
  readonly displayName = 'Remote OK';
  readonly homepage = 'https://remoteok.com';
  readonly relevantRegions = ['worldwide'];
  readonly attribution = 'Fonte: Remote OK (remoteok.com). Candidati dalla pagina originale.';

  static readonly URL = 'https://remoteok.com/api';

  async fetchJobs(ctx: FetchContext): Promise<RawJob[]> {
    const body = await ctx.http.getJson<unknown>(RemoteOkAdapter.URL);
    if (!Array.isArray(body)) throw new SourceFormatError(this.id, 'attesa una lista');
    // il primo elemento è metadata legale: gli annunci hanno sempre id e position
    return (body as RawJob[]).filter((item) => item && item.id !== undefined && item.position !== undefined);
  }

  normalize(raw: RawJob): JobInput {
    const url = asString(raw.url).replace(/^https?:\/\/remoteok\.com/i, 'https://remoteok.com');
    const applyUrl = asString(raw.apply_url).replace(/^https?:\/\/remoteok\.com/i, 'https://remoteok.com');
    return {
      source: this.id,
      externalId: asString(raw.id),
      sourceUrl: url,
      title: fixMojibake(asString(raw.position)),
      company: fixMojibake(asString(raw.company)),
      descriptionOriginal: fixMojibake(asString(raw.description)),
      // i termini d'uso chiedono di candidarsi passando dalla pagina di Remote OK
      applyUrl: applyUrl || url,
      applyViaSource: true,
      tags: asStringArray(raw.tags),
      location: fixMojibake(asString(raw.location)),
      remoteHint: 'full',
      salary: salaryFromFields({
        min: asNumber(raw.salary_min),
        max: asNumber(raw.salary_max),
        currency: 'USD',
        period: 'year',
      }),
      publishedAt: asDate(raw.date) ?? asDate(asNumber(raw.epoch)),
    };
  }
}
