import { buildJobCore } from '../../pipeline/normalize';
import { HnWhoIsHiringAdapter, parseHnHeadline } from './hn-whoishiring.adapter';
import { testContext } from './testing';

describe('parseHnHeadline (prime righe nel formato dei thread, con aziende fittizie)', () => {
  it.each([
    [
      'Moss Systems (YC S26) | Founding Software Engineer | On-site (hybrid) in Stockholm, Sweden | Full time',
      {
        company: 'Moss Systems (YC S26)',
        title: 'Founding Software Engineer',
        remote: 'hybrid',
        contract: 'full-time',
      },
    ],
    [
      'Nectar Works | Robotics &#x2F; Hardware Engineer | San Francisco, CA | ONSITE | Full-time | $130k–200k + equity | <a href="https:&#x2F;&#x2F;example.com" rel="nofollow">https:&#x2F;&#x2F;example.com</a>',
      { company: 'Nectar Works', title: 'Robotics / Hardware Engineer', remote: 'onsite', contract: 'full-time' },
    ],
    [
      'Opal Digital | Full-Stack Engineer | REMOTE (US time zones) | Contract or Full-time | <a href="https:&#x2F;&#x2F;example.com&#x2F;jobs&#x2F;full-stack-engineer">link</a>',
      { company: 'Opal Digital', title: 'Full-Stack Engineer', remote: 'full', location: 'REMOTE (US time zones)' },
    ],
    [
      'Birch Networks (Sequoia-backed, Series B) | Senior Member of Technical Staff | On-Site (New York, NY) | Full Time | $230,000–$300,000 + equity',
      {
        company: 'Birch Networks (Sequoia-backed, Series B)',
        title: 'Senior Member of Technical Staff',
        remote: 'onsite',
      },
    ],
    [
      'Ember Digital | London, UK | Full-Time | ONSITE+PART REMOTE | <a href="https:&#x2F;&#x2F;example.com">https:&#x2F;&#x2F;example.com</a>',
      { company: 'Ember Digital', title: 'Posizioni aperte in Ember Digital', remote: 'hybrid', contract: 'full-time' },
    ],
    [
      'SaaS Startup | Software Engineer | Full-Time | REMOTE (US) | $180,000 - $250,000 USD',
      { company: 'SaaS Startup', title: 'Software Engineer', remote: 'full', location: 'REMOTE (US)' },
    ],
    [
      'Juniper Works|Senior Performance Engineer|FT| Remote USA | 172-195',
      { company: 'Juniper Works', title: 'Senior Performance Engineer', remote: 'full', contract: 'full-time' },
    ],
    [
      'Birch Works (<a href="https:&#x2F;&#x2F;example.com&#x2F;">https:&#x2F;&#x2F;example.com&#x2F;</a>) | Technical Lead | Remote, worldwide',
      { company: 'Birch Works', title: 'Technical Lead', remote: 'full' },
    ],
  ])('%s', (line, expected) => {
    expect(parseHnHeadline(line)).toMatchObject(expected);
  });

  it('scarta i commenti che non sono annunci', () => {
    expect(parseHnHeadline('Location: London, UK')).toBeNull();
    expect(parseHnHeadline('We’re hiring at Flint Works — now part of Garnet Labs.')).toBeNull();
    expect(parseHnHeadline('Hiring: exception')).toBeNull();
    expect(parseHnHeadline('')).toBeNull();
  });
});

describe('HnWhoIsHiringAdapter', () => {
  const adapter = new HnWhoIsHiringAdapter();
  const STORY = '90000001';

  it('trova l’ultimo thread "Who is hiring?" e ne legge i commenti di primo livello', async () => {
    const { ctx, http, logs } = testContext({
      [HnWhoIsHiringAdapter.THREADS_URL]: 'hn-threads.json',
      [HnWhoIsHiringAdapter.commentsUrl(STORY, 0)]: 'hn-comments-p0.json',
    });
    const raws = await adapter.fetchJobs(ctx);
    // non deve scegliere "Who wants to be hired?" né un thread più vecchio
    expect(http.requested).toEqual([HnWhoIsHiringAdapter.THREADS_URL, HnWhoIsHiringAdapter.commentsUrl(STORY, 0)]);
    expect(logs[0]).toMatch(/Who is hiring\? \(September 2026\)/);
    expect(raws.length).toBeGreaterThan(10);
    expect(raws.length).toBeLessThan(40);

    for (const raw of raws) {
      const input = adapter.normalize(raw);
      expect(input.sourceUrl).toBe(`https://news.ycombinator.com/item?id=${String(raw.objectID)}`);
      expect(input.company).toBeTruthy();
      const core = buildJobCore(input);
      expect(core.descriptionOriginal).toBe(raw.comment_text);
      expect(core.descriptionText).not.toMatch(/&#x2F;/);
    }
  });

  it('estrae stipendio, restrizioni e link di candidatura dal testo libero', async () => {
    const { ctx } = testContext({
      [HnWhoIsHiringAdapter.THREADS_URL]: 'hn-threads.json',
      [HnWhoIsHiringAdapter.commentsUrl(STORY, 0)]: 'hn-comments-p0.json',
    });
    const cores = (await adapter.fetchJobs(ctx)).map((r) => buildJobCore(adapter.normalize(r)));

    const onsite = cores.find((c) => c.company === 'Nectar Works')!;
    expect(onsite).toMatchObject({
      remote: 'onsite',
      salaryFound: true,
      salaryMin: 130000,
      salaryMax: 200000,
      salaryCurrency: 'USD',
    });
    expect(onsite.salaryRawText).toBe('$130k–200k');
    expect(onsite.restrictedCountries).toEqual(['US']);

    const remoteUs = cores.find((c) => c.company === 'Opal Digital')!;
    expect(remoteUs.applyUrl).toBe('https://example.com/jobs/full-stack-engineer');
    expect(remoteUs.applyMethod).toBe('careers_page');
    expect(remoteUs.restrictedCountries).toEqual(['US']);
    expect(remoteUs.timezoneOffsets).toEqual([-8, -7, -6, -5]);

    // "172-195" senza valuta: nessuna retribuzione, non si stima
    const noCurrency = cores.find((c) => c.company === 'Juniper Works');
    if (noCurrency) expect(noCurrency.salaryFound).toBe(false);
  });

  it('errore esplicito se il thread non si trova', async () => {
    const { ctx } = testContext({ [HnWhoIsHiringAdapter.THREADS_URL]: 'hn-comments-p0.json' });
    await expect(adapter.fetchJobs(ctx)).rejects.toThrow(/nessun thread/);
  });
});
