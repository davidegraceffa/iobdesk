import { Injectable, Logger } from '@nestjs/common';
import { APP_USER_AGENT } from '../common/app-user-agent';
import type { HttpRequestOptions, SourceHttpClient } from './source.types';

export interface HttpValidators {
  etag?: string;
  lastModified?: string;
}
export type HttpCache = Record<string, HttpValidators>;

const MIN_GAP_MS = 1500;
const TIMEOUT_MS = 30_000;
const MAX_BODY_BYTES = 25 * 1024 * 1024;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Client HTTP verso le fonti: User-Agent descrittivo, una richiesta alla volta per fonte con
 * pausa minima tra le richieste, timeout, un solo retry su errori temporanei, e richieste
 * condizionali (ETag / Last-Modified) per non riscaricare ciò che non è cambiato.
 */
@Injectable()
export class SourceHttpService {
  private readonly logger = new Logger(SourceHttpService.name);
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly lastRequestAt = new Map<string, number>();

  /** Client per una singola raccolta. I nuovi validatori vanno salvati solo se la raccolta riesce. */
  createClient(sourceId: string, cache: HttpCache = {}): RunHttpClient {
    return new RunHttpClient(sourceId, cache, (fn) => this.enqueue(sourceId, fn), this.logger);
  }

  private enqueue<T>(sourceId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(sourceId) ?? Promise.resolve();
    const run = previous
      .catch(() => undefined)
      .then(async () => {
        const wait = (this.lastRequestAt.get(sourceId) ?? 0) + MIN_GAP_MS - Date.now();
        if (wait > 0) await sleep(wait);
        try {
          return await fn();
        } finally {
          this.lastRequestAt.set(sourceId, Date.now());
        }
      });
    this.queues.set(sourceId, run);
    return run;
  }
}

export class RunHttpClient implements SourceHttpClient {
  /** validatori ricevuti in questa raccolta, da persistere a raccolta riuscita */
  readonly newValidators: HttpCache = {};
  requestCount = 0;
  notModifiedCount = 0;

  constructor(
    private readonly sourceId: string,
    private readonly cache: HttpCache,
    private readonly schedule: <T>(fn: () => Promise<T>) => Promise<T>,
    private readonly logger: Logger,
  ) {}

  async getJson<T = unknown>(url: string, options: HttpRequestOptions = {}): Promise<T | null> {
    const text = await this.getText(url, { accept: 'application/json', ...options });
    if (text === null) return null;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`Risposta non JSON da ${url} (inizia con: ${text.slice(0, 80).replace(/\s+/g, ' ')})`);
    }
  }

  getText(url: string, options: HttpRequestOptions = {}): Promise<string | null> {
    return this.schedule(() => this.request(url, options, true));
  }

  private async request(url: string, options: HttpRequestOptions, mayRetry: boolean): Promise<string | null> {
    const headers: Record<string, string> = {
      'User-Agent': APP_USER_AGENT,
      Accept: options.accept ?? '*/*',
    };
    const validators = options.conditional ? this.cache[url] : undefined;
    if (validators?.etag) headers['If-None-Match'] = validators.etag;
    if (validators?.lastModified) headers['If-Modified-Since'] = validators.lastModified;

    this.requestCount++;
    let response: Response;
    try {
      response = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (err) {
      if (mayRetry) {
        await sleep(3000);
        return this.request(url, options, false);
      }
      const cause = (err as { cause?: { code?: string } }).cause?.code;
      throw new Error(
        `Richiesta fallita verso ${new URL(url).host}: ${(err as Error).message}${cause ? ` (${cause})` : ''}`,
        { cause: err },
      );
    }

    if (response.status === 304) {
      this.notModifiedCount++;
      return null;
    }
    if ((response.status === 429 || response.status >= 500) && mayRetry) {
      const retryAfter = Number(response.headers.get('retry-after'));
      await sleep(Math.min(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 5000, 30_000));
      return this.request(url, options, false);
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} da ${new URL(url).host}${new URL(url).pathname}`);
    }

    const length = Number(response.headers.get('content-length') ?? 0);
    if (length > MAX_BODY_BYTES) throw new Error(`Risposta troppo grande da ${new URL(url).host} (${length} byte)`);
    const body = await response.text();

    if (options.conditional) {
      const etag = response.headers.get('etag') ?? undefined;
      const lastModified = response.headers.get('last-modified') ?? undefined;
      if (etag || lastModified) this.newValidators[url] = { etag, lastModified };
    }
    this.logger.debug(`${this.sourceId}: GET ${url} → ${response.status} (${body.length} caratteri)`);
    return body;
  }
}
