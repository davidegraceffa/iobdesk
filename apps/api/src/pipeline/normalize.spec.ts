import type { JobInput } from '../sources/source.types';
import {
  buildJobCore,
  canonicalUrl,
  detectContract,
  detectEor,
  detectRemote,
  detectRequiresVat,
  detectSeniority,
  htmlToText,
  normalizeCompany,
  normalizeTitle,
  stableJobId,
  toSafeHtml,
} from './normalize';

const base: JobInput = {
  source: 'test',
  externalId: '42',
  sourceUrl: 'https://jobs.example.com/42?utm_source=x',
  title: 'Senior Engineer',
  company: 'Acme Inc.',
  descriptionOriginal: '<p>Hello</p>',
  tags: [],
  location: '',
};

describe('descrizione', () => {
  it('conserva l’originale integrale e ne produce una versione sanitizzata', () => {
    const original =
      '<p class="x" style="color:red" onclick="evil()">Ciao <strong>mondo</strong></p><script>alert(1)</script><ul><li>uno</li></ul><a href="javascript:alert(1)">x</a><a href="https://a.io/jobs">apply</a>';
    const core = buildJobCore({ ...base, descriptionOriginal: original });
    expect(core.descriptionOriginal).toBe(original);
    expect(core.descriptionHtml).toBe(
      '<p>Ciao <strong>mondo</strong></p><ul><li>uno</li></ul><a target="_blank" rel="noopener noreferrer nofollow">x</a><a href="https://a.io/jobs" target="_blank" rel="noopener noreferrer nofollow">apply</a>',
    );
    expect(core.descriptionText).toBe('Ciao mondo\n• uno\n\nx apply');
  });

  it('il testo semplice diventa paragrafi con escape', () => {
    expect(toSafeHtml('riga 1\nriga 2\n\n<b>non html</b>', false)).toBe(
      '<p>riga 1<br />riga 2</p><p>&lt;b&gt;non html&lt;/b&gt;</p>',
    );
    expect(htmlToText('<p>a&amp;b</p><p>c&nbsp;d</p>')).toBe('a&b\nc d');
  });
});

describe('identità', () => {
  it('id stabile da fonte + id esterno (o URL canonico)', () => {
    expect(stableJobId('x', '1', 'https://a')).toBe(stableJobId('x', '1', 'https://b'));
    expect(stableJobId('x', undefined, 'https://a.io/j/1?utm_source=n')).toBe(
      stableJobId('x', undefined, 'https://www.a.io/j/1/'),
    );
    expect(stableJobId('x', '1', 'https://a')).not.toBe(stableJobId('y', '1', 'https://a'));
  });

  it('URL canonico senza tracking, frammento e slash finale', () => {
    expect(canonicalUrl('https://WWW.Example.com/jobs/1/?utm_source=a&gh_src=b&id=7#apply')).toBe(
      'https://example.com/jobs/1?id=7',
    );
    expect(canonicalUrl('mailto:a@b.c')).toBeNull();
    expect(canonicalUrl('not a url')).toBeNull();
  });

  it('normalizza azienda e titolo per la similarità', () => {
    expect(normalizeCompany('Proxify AB')).toBe('proxify');
    expect(normalizeCompany('Globex S.r.l.')).toBe('globex');
    expect(normalizeCompany('Pango (YC S26)')).toBe('pango');
    expect(normalizeTitle('Senior Frontend Developer (m/w/d) React, Next.js & TypeScript')).toBe(
      'senior frontend developer react next js typescript',
    );
  });
});

describe('euristiche', () => {
  it('remoto', () => {
    expect(detectRemote('Fully remote position')).toBe('full');
    expect(detectRemote('Hybrid, 2 days in the office')).toBe('hybrid');
    expect(detectRemote('ONSITE in Berlin')).toBe('onsite');
    expect(detectRemote('ONSITE+PART REMOTE')).toBe('hybrid');
    expect(detectRemote('Berlin')).toBe('unknown');
  });

  it('contratto', () => {
    expect(detectContract('Freelance React Developer', '')).toBe('freelance');
    expect(detectContract('Senior Software Engineer (Poland, Remote, B2B)', '')).toBe('contract');
    expect(detectContract('Engineer', 'This is a 6-month contract with possible extension')).toBe('contract');
    expect(detectContract('Engineer', 'You will sign a permanent employment contract. Full-time.')).toBe('full-time');
    expect(detectContract('B2B Sales Manager', 'We sell B2B SaaS')).toBe('unknown');
    expect(detectContract('Engineer', 'Great team')).toBe('unknown');
  });

  it('P.IVA: solo formule esplicite, non "B2B SaaS" o "invoicing software"', () => {
    expect(detectRequiresVat('contract', '')).toBe(true);
    expect(detectRequiresVat('unknown', 'You will issue a monthly invoice from your own company')).toBe(true);
    expect(detectRequiresVat('unknown', 'Collaborazione con Partita IVA')).toBe(true);
    expect(detectRequiresVat('full-time', 'We build B2B SaaS invoicing software')).toBe(false);
    expect(detectRequiresVat('unknown', 'We build B2B SaaS invoicing software')).toBeNull();
  });

  it('Employer of Record', () => {
    expect(detectEor('We hire through Deel in most countries', 'acme')).toBe(true);
    expect(detectEor('Contractors are employed via Remote.com', 'acme')).toBe(true);
    expect(detectEor('We use an Employer of Record (EOR)', 'acme')).toBe(true);
    expect(detectEor('Join Deel, the all-in-one HR platform', 'deel')).toBe(false);
    expect(detectEor('A great remote job', 'acme')).toBe(false);
  });

  it('seniority dal titolo', () => {
    expect(detectSeniority('Senior Backend Developer')).toBe('senior');
    expect(detectSeniority('Jr. Frontend Dev')).toBe('junior');
    expect(detectSeniority('Staff Engineer')).toBe('lead');
    expect(detectSeniority('Digital Marketing Intern')).toBe('intern');
    expect(detectSeniority('Mid-level Engineer')).toBe('mid');
    expect(detectSeniority('Software Engineer')).toBe('unknown');
  });
});

describe('link di candidatura', () => {
  const core = (overrides: Partial<JobInput>) => buildJobCore({ ...base, ...overrides });

  it('ATS noto nella descrizione', () => {
    const c = core({
      descriptionOriginal:
        '<p>See <a href="https://acme.com/blog">blog</a>. Apply at <a href="https://boards.greenhouse.io/acme/jobs/123?gh_src=abc">Greenhouse</a></p>',
    });
    expect(c).toMatchObject({ applyUrl: 'https://boards.greenhouse.io/acme/jobs/123?gh_src=abc', applyMethod: 'ats' });
    expect(c.canonicalUrl).toBe('https://boards.greenhouse.io/acme/jobs/123');
  });

  it('pagina careers, poi email', () => {
    expect(core({ descriptionOriginal: '<a href="https://acme.com/careers/senior-engineer">Apply</a>' })).toMatchObject(
      {
        applyUrl: 'https://acme.com/careers/senior-engineer',
        applyMethod: 'careers_page',
      },
    );
    expect(core({ descriptionOriginal: '<p>Send your CV to jobs@acme.com</p>' })).toMatchObject({
      applyUrl: 'mailto:jobs@acme.com',
      applyMethod: 'email',
    });
  });

  it('campo applyUrl della fonte su dominio esterno', () => {
    expect(core({ applyUrl: 'https://jobs.lever.co/acme/abc' })).toMatchObject({ applyMethod: 'ats' });
    expect(core({ applyUrl: 'https://acme.com/apply-now' })).toMatchObject({ applyMethod: 'careers_page' });
  });

  it('se non c’è nulla usa la pagina dell’annuncio sulla fonte', () => {
    const c = core({ descriptionOriginal: '<p>No links here</p>' });
    expect(c).toMatchObject({ applyUrl: base.sourceUrl, applyMethod: 'source_page' });
    expect(c.canonicalUrl).toBe('https://jobs.example.com/42');
  });

  it('applyViaSource ha la precedenza sui link nella descrizione', () => {
    const c = core({ applyViaSource: true, descriptionOriginal: '<a href="https://jobs.lever.co/acme/abc">x</a>' });
    expect(c.applyMethod).toBe('source_page');
  });
});

describe('retribuzione e vincoli', () => {
  it('prima i campi strutturati, poi il testo; nulla se non è scritta', () => {
    const structured = buildJobCore({
      ...base,
      descriptionOriginal: '<p>Salary $50k-$60k</p>',
      salary: { min: 100, max: 120, currency: 'EUR', period: 'hour', rawText: '100–120 EUR/hour' },
    });
    expect(structured).toMatchObject({ salaryFound: true, salaryMin: 100, salaryPeriod: 'hour' });
    const fromText = buildJobCore({ ...base, descriptionOriginal: '<p>Salary: €45k–55k gross/year</p>' });
    expect(fromText).toMatchObject({
      salaryFound: true,
      salaryMin: 45000,
      salaryMax: 55000,
      salaryRawText: '€45k–55k gross/year',
    });
    const none = buildJobCore({ ...base, descriptionOriginal: '<p>Competitive salary. We raised $20M.</p>' });
    expect(none).toMatchObject({ salaryFound: false, salaryMin: null, salaryRawText: null });
  });

  it('il vincolo strutturato della fonte vince sulle frasi nel testo', () => {
    const c = buildJobCore({
      ...base,
      location: 'Europe',
      descriptionOriginal: '<p>Our US-based candidates love us. (US)</p>',
    });
    expect(c).toMatchObject({ regions: ['europe'], restrictedCountries: [] });
    const w = buildJobCore({
      ...base,
      location: 'Anywhere in the World',
      descriptionOriginal: '<p>Remote (US) only.</p>',
    });
    expect(w.restrictedCountries).toEqual(['US']);
  });
});
