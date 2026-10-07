import { Injectable } from '@nestjs/common';
import { XMLParser } from 'fast-xml-parser';
import { SourceFormatError, type FetchContext, type JobInput, type RawJob, type SourceAdapter } from '../source.types';
import { asDate, asString, decodeEntities, mapContract } from './helpers';

const FEEDS = [
  'remote-programming-jobs',
  'remote-full-stack-programming-jobs',
  'remote-back-end-programming-jobs',
  'remote-front-end-programming-jobs',
];

/**
 * We Work Remotely: feed RSS pubblici per categoria. Supportano ETag: se un feed non è
 * cambiato dall'ultima raccolta la fonte risponde 304 e non viene riscaricato.
 */
@Injectable()
export class WeWorkRemotelyAdapter implements SourceAdapter {
  readonly id = 'weworkremotely';
  readonly displayName = 'We Work Remotely';
  readonly homepage = 'https://weworkremotely.com';
  readonly relevantRegions = ['worldwide', 'north america'];
  readonly attribution = 'Annunci dal feed RSS di We Work Remotely';
  readonly minIntervalMinutes = 60;

  static readonly FEED_URLS = FEEDS.map((f) => `https://weworkremotely.com/categories/${f}.rss`);

  private readonly parser = new XMLParser({
    ignoreAttributes: true,
    // il testo resta com'è: le entità dell'HTML nella descrizione le decodifichiamo noi una volta sola
    processEntities: false,
    parseTagValue: false,
    trimValues: true,
    isArray: (name) => name === 'item',
  });

  async fetchJobs(ctx: FetchContext): Promise<RawJob[]> {
    const byGuid = new Map<string, RawJob>();
    for (const url of WeWorkRemotelyAdapter.FEED_URLS) {
      const xml = await ctx.http.getText(url, { conditional: true, accept: 'application/rss+xml, application/xml' });
      if (xml === null) {
        ctx.log(`${url}: non modificato (304)`);
        continue;
      }
      for (const item of this.parseFeed(xml)) byGuid.set(asString(item.guid) || asString(item.link), item);
    }
    return [...byGuid.values()];
  }

  parseFeed(xml: string): RawJob[] {
    const doc = this.parser.parse(xml) as { rss?: { channel?: { item?: unknown } } };
    const channel = doc.rss?.channel;
    if (!channel) throw new SourceFormatError(this.id, 'feed RSS senza <channel>');
    return Array.isArray(channel.item) ? (channel.item as RawJob[]) : [];
  }

  normalize(raw: RawJob): JobInput {
    // il titolo ha la forma "Azienda: Ruolo"
    const fullTitle = decodeEntities(asString(raw.title));
    const sep = fullTitle.indexOf(': ');
    const company = sep > 0 ? fullTitle.slice(0, sep).trim() : '';
    const title = sep > 0 ? fullTitle.slice(sep + 2).trim() : fullTitle;
    const link = asString(raw.link) || asString(raw.guid);
    const region = decodeEntities(asString(raw.region));
    const skills = decodeEntities(asString(raw.skills))
      .split(/,\s*(?:and\s+)?|\s+and\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    return {
      source: this.id,
      externalId: asString(raw.guid) || link,
      sourceUrl: link,
      title,
      company: company || 'Azienda non indicata',
      // nel feed la descrizione è HTML con le entità codificate
      descriptionOriginal: decodeEntities(asString(raw.description)),
      tags: [...skills, decodeEntities(asString(raw.category))].filter(Boolean),
      location: region,
      remoteHint: 'full',
      contractHint: mapContract(asString(raw.type)),
      publishedAt: asDate(raw.pubDate),
    };
  }
}
