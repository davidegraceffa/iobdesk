import { defaultSettings, type Settings } from '@jobagg/shared';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FetchContext, HttpRequestOptions, SourceHttpClient } from '../source.types';

const FIXTURES = join(__dirname, '../../../../../tests/fixtures/sources');

export function loadFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

/**
 * Client HTTP finto: serve le fixture salvate in tests/fixtures/sources in base all'URL richiesto.
 * Nei test non parte mai una richiesta di rete: un URL non previsto fa fallire il test.
 */
export class FixtureHttpClient implements SourceHttpClient {
  readonly requested: string[] = [];

  constructor(private readonly routes: Record<string, string | null | Error>) {}

  async getText(url: string, _options?: HttpRequestOptions): Promise<string | null> {
    this.requested.push(url);
    if (!(url in this.routes)) throw new Error(`URL non previsto nel test: ${url}`);
    const route = this.routes[url] as string | null | Error;
    if (route instanceof Error) throw route;
    return route === null ? null : loadFixture(route);
  }

  async getJson<T = unknown>(url: string, options?: HttpRequestOptions): Promise<T | null> {
    const text = await this.getText(url, options);
    return text === null ? null : (JSON.parse(text) as T);
  }
}

export function testContext(routes: Record<string, string | null | Error>, settings: Partial<Settings> = {}) {
  const http = new FixtureHttpClient(routes);
  const logs: string[] = [];
  const ctx: FetchContext = {
    http,
    settings: { ...defaultSettings(), ...settings },
    now: new Date('2026-10-01T12:00:00Z'),
    log: (m) => logs.push(m),
  };
  return { ctx, http, logs };
}
