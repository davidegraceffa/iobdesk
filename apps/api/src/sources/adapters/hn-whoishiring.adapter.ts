import { Injectable } from '@nestjs/common';
import { parseLocationSpec, parseSalary, type ContractType, type RemoteType } from '@jobagg/shared';
import { SourceFormatError, type FetchContext, type JobInput, type RawJob, type SourceAdapter } from '../source.types';
import { asDate, asString, decodeEntities, mapContract } from './helpers';

interface AlgoliaResponse {
  hits?: RawJob[];
  nbPages?: number;
}

export interface HnHeadline {
  company: string;
  title: string;
  location: string;
  remote?: RemoteType;
  contract?: ContractType;
}

const ROLE_RE =
  /engineer|developer|programmer|designer|scientist|architect|manager|lead\b|founding|full[- ]?stack|front[- ]?end|back[- ]?end|devops|sre\b|analyst|researcher|product|intern|cto\b|head of|director|specialist|consultant|qa\b|roles\b|positions\b|technical staff/i;
const REMOTE_RE = /\bremote\b|\bonsite\b|\bon-site\b|\bhybrid\b|\bin[- ]office\b|\bin[- ]person\b/i;
const CONTRACT_RE = /\b(?:full|part)[- ]?time\b|\bcontract(?:or)?\b|\bfreelance\b|\binternship\b|^(?:ft|pt)$/i;
const URL_RE = /https?:\/\/|www\.|\S+@\S+\.\S+/i;
const CITY_STATE_RE = /^[A-Z][\p{L}. '-]+,\s?[A-Z]{2}\b/u;

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function remoteOf(segment: string): RemoteType | undefined {
  const s = segment.toLowerCase();
  const remote = /\bremote\b/.test(s);
  const onsite = /\bonsite\b|\bon-site\b|\bin[- ]office\b|\bin[- ]person\b/.test(s);
  if (/\bhybrid\b/.test(s) || (remote && onsite)) return 'hybrid';
  if (onsite) return 'onsite';
  if (remote) return 'full';
  return undefined;
}

/**
 * Interpreta la prima riga di un commento di "Who is hiring?", per convenzione
 * `Azienda | Ruolo | Località | REMOTE/ONSITE | Contratto | Stipendio | URL`,
 * con i campi in ordine libero. Restituisce `null` se la riga non segue la convenzione.
 */
export function parseHnHeadline(firstLineHtml: string): HnHeadline | null {
  const line = stripTags(firstLineHtml);
  const segments = line
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);
  if (segments.length < 3) return null;

  // "Tether (https://tether.io/)" → "Tether"; "Pango (YC S26)" resta com'è
  const company = (segments[0] as string)
    .replace(/\s*\(?\s*https?:\/\/\S+\s*\)?/gi, '')
    .replace(/\s*-\s*$/, '')
    .trim();
  if (!company || company.length > 80) return null;

  let title = '';
  let remote: RemoteType | undefined;
  let contract: ContractType | undefined;
  const locations: string[] = [];

  for (const segment of segments.slice(1)) {
    const isRemoteToken = REMOTE_RE.test(segment);
    if (isRemoteToken) {
      remote = remote ?? remoteOf(segment);
      locations.push(segment);
      continue;
    }
    if (CONTRACT_RE.test(segment) && segment.length < 45) {
      contract = contract ?? mapContract(segment.replace(/^ft$/i, 'full time').replace(/^pt$/i, 'part time'));
      continue;
    }
    if (URL_RE.test(segment)) continue;
    if (parseSalary(segment) && !ROLE_RE.test(segment)) continue;
    const spec = parseLocationSpec(segment);
    const looksLikePlace = spec.countries.length + spec.regions.length > 0 || CITY_STATE_RE.test(segment);
    if (!title && ROLE_RE.test(segment)) {
      title = segment;
      continue;
    }
    if (looksLikePlace) {
      locations.push(segment);
      continue;
    }
    if (!title && segment.length <= 120) title = segment;
  }

  return {
    company,
    title: title || `Posizioni aperte in ${company}`,
    location: [...new Set(locations)].join(' · '),
    remote,
    contract,
  };
}

/**
 * Hacker News "Ask HN: Who is hiring?": API Algolia di HN.
 * 1) trova l'ultimo thread pubblicato dall'utente `whoishiring`;
 * 2) scarica i commenti di primo livello (ogni commento è un annuncio in testo libero).
 */
@Injectable()
export class HnWhoIsHiringAdapter implements SourceAdapter {
  readonly id = 'hn_whoishiring';
  readonly displayName = 'Hacker News: Who is hiring?';
  readonly homepage = 'https://news.ycombinator.com/submitted?id=whoishiring';
  readonly relevantRegions = ['worldwide', 'north america'];
  readonly minIntervalMinutes = 180;

  static readonly THREADS_URL =
    'https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=10';
  static readonly MAX_PAGES = 10;

  static commentsUrl(storyId: string, page: number): string {
    return `https://hn.algolia.com/api/v1/search_by_date?tags=comment,story_${storyId}&numericFilters=parent_id=${storyId}&hitsPerPage=100&page=${page}`;
  }

  async fetchJobs(ctx: FetchContext): Promise<RawJob[]> {
    const threads = await ctx.http.getJson<AlgoliaResponse>(HnWhoIsHiringAdapter.THREADS_URL);
    if (!threads || !Array.isArray(threads.hits)) throw new SourceFormatError(this.id, 'campo "hits" assente');
    // i risultati sono in ordine di data decrescente: il primo "Who is hiring?" è il thread del mese
    const story = threads.hits.find((h) => /^Ask HN: Who is hiring\?/i.test(asString(h.title)));
    if (!story) throw new SourceFormatError(this.id, 'nessun thread "Who is hiring?" trovato');
    const storyId = asString(story.objectID);
    ctx.log(`thread: ${asString(story.title)} (${storyId})`);

    const comments: RawJob[] = [];
    for (let page = 0; page < HnWhoIsHiringAdapter.MAX_PAGES; page++) {
      const body = await ctx.http.getJson<AlgoliaResponse>(HnWhoIsHiringAdapter.commentsUrl(storyId, page));
      if (!body || !Array.isArray(body.hits)) throw new SourceFormatError(this.id, 'commenti: campo "hits" assente');
      comments.push(...body.hits);
      if (page + 1 >= (body.nbPages ?? 1)) break;
    }
    // solo i commenti che seguono la convenzione "Azienda | Ruolo | …": gli altri non sono annunci
    return comments.filter((c) => parseHnHeadline(this.firstLine(asString(c.comment_text))) !== null);
  }

  private firstLine(commentHtml: string): string {
    return commentHtml.split(/<p>|\n/i)[0] ?? '';
  }

  normalize(raw: RawJob): JobInput {
    const html = asString(raw.comment_text);
    const headline = parseHnHeadline(this.firstLine(html));
    if (!headline) throw new SourceFormatError(this.id, 'commento senza intestazione "Azienda | Ruolo | …"');
    const id = asString(raw.objectID);
    return {
      source: this.id,
      externalId: id,
      sourceUrl: `https://news.ycombinator.com/item?id=${id}`,
      title: headline.title,
      company: headline.company,
      // Algolia restituisce HTML con le entità codificate (&#x2F; ecc.): resta l'originale integrale
      descriptionOriginal: html,
      applyFromAnyLink: true,
      tags: [],
      location: headline.location,
      remoteHint: headline.remote,
      contractHint: headline.contract,
      publishedAt: asDate(raw.created_at),
    };
  }
}
