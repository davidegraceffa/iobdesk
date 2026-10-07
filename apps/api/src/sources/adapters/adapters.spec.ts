import { buildJobCore } from '../../pipeline/normalize';
import type { JobInput, RawJob, SourceAdapter } from '../source.types';
import { ArbeitnowAdapter } from './arbeitnow.adapter';
import { HimalayasAdapter } from './himalayas.adapter';
import { JobicyAdapter } from './jobicy.adapter';
import { RemoteOkAdapter } from './remoteok.adapter';
import { RemotiveAdapter } from './remotive.adapter';
import { testContext } from './testing';
import { WeWorkRemotelyAdapter } from './weworkremotely.adapter';

/**
 * Le fixture sono risposte delle fonti rese anonime (aziende, link, contatti e identificativi fittizi,
 * descrizioni accorciate): la struttura è quella reale.
 */

/** Ogni elemento della fixture deve attraversare normalize + normalizzazione comune senza errori. */
function normalizeAll(adapter: SourceAdapter, raws: RawJob[]): JobInput[] {
  return raws.map((raw) => {
    const input = adapter.normalize(raw);
    expect(input.source).toBe(adapter.id);
    expect(input.title).toBeTruthy();
    expect(input.sourceUrl).toMatch(/^https?:\/\//);
    const core = buildJobCore(input);
    expect(core.id).toHaveLength(24);
    expect(core.descriptionOriginal).toBe(input.descriptionOriginal);
    expect(core.descriptionHtml).not.toMatch(/<script|onclick=|style=/i);
    return input;
  });
}

describe('RemotiveAdapter', () => {
  const adapter = new RemotiveAdapter();

  it('legge la risposta della fonte e normalizza tutti gli annunci', async () => {
    const { ctx, http } = testContext({ [RemotiveAdapter.URL]: 'remotive.json' });
    const raws = await adapter.fetchJobs(ctx);
    expect(http.requested).toEqual([RemotiveAdapter.URL]);
    expect(raws).toHaveLength(16);
    const jobs = normalizeAll(adapter, raws);

    const first = jobs[0]!;
    expect(first).toMatchObject({
      externalId: '9100001',
      title: 'Content Reviewer - United States',
      company: 'Amber Systems',
      location: 'USA',
      remoteHint: 'full',
      contractHint: 'part-time',
    });
    expect(first.publishedAt?.toISOString()).toBe('2026-09-21T12:55:11.000Z');
  });

  it('usa il campo salary della fonte, senza inventare quando è vuoto', async () => {
    const { ctx } = testContext({ [RemotiveAdapter.URL]: 'remotive.json' });
    const jobs = (await adapter.fetchJobs(ctx)).map((r) => adapter.normalize(r));
    const yearly = jobs.find((j) => j.salary?.rawText === '$90k - $105k');
    expect(yearly?.salary).toMatchObject({ min: 90000, max: 105000, currency: 'USD', period: 'year' });
    const hourly = jobs.find((j) => j.salary?.period === 'hour');
    expect(hourly?.salary).toMatchObject({ min: 90, max: 150, currency: 'USD' });
    expect(jobs[0]!.salary).toBeNull();
  });

  it('segnala un formato inatteso invece di inventarlo', async () => {
    const { ctx } = testContext({ [RemotiveAdapter.URL]: 'hn-threads.json' });
    await expect(adapter.fetchJobs(ctx)).rejects.toThrow(/Formato inatteso/);
  });
});

describe('RemoteOkAdapter', () => {
  const adapter = new RemoteOkAdapter();

  it('scarta il primo elemento (nota legale) e normalizza gli annunci', async () => {
    const { ctx } = testContext({ [RemoteOkAdapter.URL]: 'remoteok.json' });
    const raws = await adapter.fetchJobs(ctx);
    expect(raws.length).toBeGreaterThan(5);
    expect(raws.every((r) => r.legal === undefined)).toBe(true);
    const jobs = normalizeAll(adapter, raws);
    for (const job of jobs) {
      expect(job.sourceUrl).toMatch(/^https:\/\/remoteok\.com\/remote-jobs\//);
      // i termini d'uso chiedono di candidarsi dalla pagina originale
      expect(job.applyViaSource).toBe(true);
      expect(buildJobCore(job).applyMethod).toBe('source_page');
    }
    expect(adapter.attribution).toMatch(/Remote OK/);
  });

  it('stipendio solo quando i campi della fonte sono valorizzati', async () => {
    const { ctx } = testContext({ [RemoteOkAdapter.URL]: 'remoteok.json' });
    const jobs = (await adapter.fetchJobs(ctx)).map((r) => adapter.normalize(r));
    const withSalary = jobs.filter((j) => j.salary);
    expect(withSalary.length).toBeGreaterThan(0);
    expect(withSalary[0]!.salary).toMatchObject({ currency: 'USD', period: 'year' });
    const director = jobs.find((j) => j.title === 'Director Payment Integrity');
    expect(director?.salary).toBeNull();
    expect(director?.location).toBe('Reed - Columbus, IN');
    expect(buildJobCore(director!).restrictedCountries).toEqual(['US']);
  });

  it('ripara il testo UTF-8 danneggiato dalla fonte', async () => {
    const { ctx } = testContext({ [RemoteOkAdapter.URL]: 'remoteok.json' });
    const jobs = (await adapter.fetchJobs(ctx)).map((r) => adapter.normalize(r));
    expect(jobs.some((j) => /Ã/.test(j.title))).toBe(false);
  });
});

describe('ArbeitnowAdapter', () => {
  const adapter = new ArbeitnowAdapter();
  const page2 = `${ArbeitnowAdapter.URL}?page=2`;

  it('segue la paginazione links.next e normalizza gli annunci', async () => {
    const { ctx, http } = testContext({
      [ArbeitnowAdapter.URL]: 'arbeitnow-page1.json',
      [page2]: 'arbeitnow-page2.json',
    });
    const raws = await adapter.fetchJobs(ctx);
    expect(http.requested).toEqual([ArbeitnowAdapter.URL, page2]);
    const jobs = normalizeAll(adapter, raws);
    expect(jobs.length).toBeGreaterThan(10);

    const remote = jobs.filter((j) => j.remoteHint === 'full');
    expect(remote.length).toBeGreaterThan(0);
    // remote: false nella fonte → mai "full remote"
    expect(
      jobs.filter((j) => j.remoteHint !== 'full').every((j) => j.remoteHint === 'onsite' || j.remoteHint === 'hybrid'),
    ).toBe(true);
    expect(jobs.some((j) => j.remoteHint === 'onsite')).toBe(true);
    const first = jobs[0]!;
    expect(first).toMatchObject({ title: 'Software Engineer', company: 'Delta Studio', location: 'Berlin' });
    expect(first.contractHint).toBe('full-time');
    expect(first.publishedAt?.getUTCFullYear()).toBe(2026);
  });
});

describe('HimalayasAdapter', () => {
  const adapter = new HimalayasAdapter();

  it('cerca per le keyword del profilo, pagina per pagina, senza duplicati', async () => {
    const routes = {
      [HimalayasAdapter.searchUrl('typescript', 1)]: 'himalayas-search-p1.json',
      [HimalayasAdapter.searchUrl('typescript', 2)]: 'himalayas-search-p2.json',
      [HimalayasAdapter.searchUrl('react', 1)]: 'himalayas-search-p1.json',
      [HimalayasAdapter.searchUrl('react', 2)]: 'himalayas-search-p2.json',
    };
    const { ctx, http } = testContext(routes);
    ctx.settings.keywords.required_any = ['TypeScript', 'react'];
    const raws = await adapter.fetchJobs(ctx);
    expect(http.requested).toHaveLength(4);
    expect(raws).toHaveLength(14);
    const jobs = normalizeAll(adapter, raws);
    expect(jobs.every((j) => j.remoteHint === 'full')).toBe(true);
  });

  it('usa restrizioni geografiche e stipendio strutturati', async () => {
    const { ctx } = testContext({
      [HimalayasAdapter.searchUrl('software engineer', 1)]: 'himalayas-search-p1.json',
      [HimalayasAdapter.searchUrl('software engineer', 2)]: 'himalayas-search-p2.json',
    });
    const jobs = (await adapter.fetchJobs(ctx)).map((r) => adapter.normalize(r));
    const usOnly = jobs.find((j) => j.locationSpec?.countries.length === 1 && j.locationSpec.countries[0] === 'US');
    expect(usOnly).toBeDefined();
    expect(buildJobCore(usOnly!).restrictedCountries).toEqual(['US']);
    const multi = jobs.find((j) => (j.locationSpec?.countries.length ?? 0) > 20);
    expect(multi?.locationSpec?.countries).toEqual(expect.arrayContaining(['IT', 'US', 'DE']));
    for (const j of jobs.filter((x) => x.salary)) {
      expect(j.salary!.currency).toMatch(/^[A-Z]{3}$/);
      expect(j.salary!.rawText).toContain(j.salary!.currency);
    }
  });
});

describe('JobicyAdapter', () => {
  const adapter = new JobicyAdapter();

  it('normalizza annunci, area geografica e stipendio strutturato', async () => {
    const { ctx } = testContext({ [JobicyAdapter.URL]: 'jobicy.json' });
    const raws = await adapter.fetchJobs(ctx);
    expect(raws).toHaveLength(14);
    const jobs = normalizeAll(adapter, raws);
    const first = jobs[0]!;
    expect(first).toMatchObject({
      externalId: '9500001',
      title: 'Software Engineer I, Agentic Platform EMEA (Poland, Remote, B2B)',
      company: 'Onyx Works',
      location: 'Poland',
      contractHint: 'full-time',
      remoteHint: 'full',
    });
    expect(first.salary).toMatchObject({ min: 300900, max: 354000, currency: 'PLN', period: 'year' });
    const core = buildJobCore(first);
    expect(core.restrictedCountries).toEqual(['PL']);
    expect(core.salaryRawText).toBe('300,900–354,000 PLN/year');
    expect(core.applyMethod).toBe('source_page');
    expect(jobs.find((j) => j.location === 'Argentina, Canada, UK')).toBeDefined();
    expect(jobs.some((j) => j.seniorityHint === 'senior')).toBe(true);
  });
});

describe('WeWorkRemotelyAdapter', () => {
  const adapter = new WeWorkRemotelyAdapter();
  const [programming, fullstack, backend, frontend] = WeWorkRemotelyAdapter.FEED_URLS as [
    string,
    string,
    string,
    string,
  ];

  it('legge i feed RSS per categoria e separa azienda e ruolo', async () => {
    const { ctx, http } = testContext({
      [programming]: 'wwr-programming.rss',
      [fullstack]: 'wwr-fullstack.rss',
      [backend]: 'wwr-backend.rss',
      [frontend]: 'wwr-frontend.rss',
    });
    const raws = await adapter.fetchJobs(ctx);
    expect(http.requested).toHaveLength(4);
    const jobs = normalizeAll(adapter, raws);
    expect(jobs.length).toBeGreaterThan(10);

    const nestJob = jobs.find((j) => j.company === 'Yarrow Studio' && /Nest\.js/.test(j.title));
    expect(nestJob).toMatchObject({
      title: 'Senior Backend Developer (Node.js / Nest.js)',
      location: 'Anywhere in the World',
      contractHint: 'full-time',
    });
    expect(nestJob!.tags).toEqual(expect.arrayContaining(['Node.js', 'Nest.js']));
    expect(nestJob!.publishedAt?.toISOString()).toBe('2026-09-15T09:06:31.000Z');
    const core = buildJobCore(nestJob!);
    expect(core.regions).toEqual(['worldwide']);
    expect(core.techStack.backend).toEqual(expect.arrayContaining(['Node.js', 'NestJS']));

    // la descrizione nel feed è HTML con entità codificate: va decodificata una volta sola
    const withDescription = jobs.find((j) => j.descriptionOriginal.length > 200)!;
    expect(withDescription.descriptionOriginal).toMatch(/<p>|<li>|<strong>/);
    expect(withDescription.descriptionOriginal).not.toMatch(/&lt;p&gt;/);
  });

  it('un feed non modificato (304) viene saltato senza errori', async () => {
    const { ctx, logs } = testContext({
      [programming]: null,
      [fullstack]: null,
      [backend]: 'wwr-backend.rss',
      [frontend]: null,
    });
    const raws = await adapter.fetchJobs(ctx);
    expect(raws).toHaveLength(5);
    expect(logs.filter((l) => /304/.test(l))).toHaveLength(3);
  });

  it('un feed non valido genera un errore esplicito', () => {
    expect(() => adapter.parseFeed('<html><body>Service unavailable</body></html>')).toThrow(/Formato inatteso/);
  });
});
