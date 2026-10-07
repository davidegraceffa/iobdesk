import { settingsSchema, type Settings } from '@jobagg/shared';
import type { JobInput } from '../sources/source.types';
import { evaluateJob } from './evaluate';
import { buildJobCore } from './normalize';

const NOW = new Date('2026-10-01T12:00:00Z');

function settings(overrides: Record<string, unknown> = {}): Settings {
  return settingsSchema.parse({
    user: { country: 'IT', has_vat_number: true },
    keywords: {
      required_any: ['typescript', 'node.js', 'react'],
      boost: ['typescript', 'nestjs', 'postgres'],
      exclude: ['php', 'unpaid'],
    },
    compensation: {
      min_yearly: 45000,
      min_daily_rate: 300,
      allow_missing: true,
      fx_rates_to_local: { USD: 0.92, GBP: 1.17 },
    },
    ...overrides,
  });
}

function job(overrides: Partial<JobInput> = {}) {
  return buildJobCore({
    source: 'test',
    externalId: '1',
    sourceUrl: 'https://example.com/jobs/1',
    title: 'Senior TypeScript Engineer',
    company: 'Acme',
    descriptionOriginal: '<p>We build APIs with Node.js, NestJS and PostgreSQL. Fully remote team.</p>',
    tags: [],
    location: 'Worldwide',
    remoteHint: 'full',
    contractHint: 'full-time',
    publishedAt: new Date('2026-09-29T12:00:00Z'),
    ...overrides,
  });
}

const evalJob = (j: ReturnType<typeof job>, s: Settings) => evaluateJob(j, s, NOW);
const item = (ev: ReturnType<typeof evaluateJob>, key: string) => ev.scoreBreakdown.items.find((i) => i.key === key)!;

describe('evaluateJob: profilo geografico', () => {
  it('"US only" è scartato per IT e accettato per US, con motivo leggibile', () => {
    const usOnly = job({
      location: 'Remote',
      descriptionOriginal: '<p>TypeScript role. This position is US only.</p>',
    });
    expect(usOnly.restrictedCountries).toEqual(['US']);
    const forIt = evalJob(usOnly, settings());
    expect(forIt.rejectedReason).toBe('Limitato a United States (il tuo paese: Italy)');
    const forUs = evalJob(usOnly, settings({ user: { country: 'US', has_vat_number: true } }));
    expect(forUs.rejectedReason).toBeNull();
    expect(item(forUs, 'location').points).toBe(15);
  });

  it('"EU only" è accettato per IT e scartato per US', () => {
    const euOnly = job({ location: 'Remote', descriptionOriginal: '<p>React and TypeScript. EU only.</p>' });
    expect(evalJob(euOnly, settings()).rejectedReason).toBeNull();
    expect(evalJob(euOnly, settings({ user: { country: 'US', has_vat_number: true } })).rejectedReason).toBe(
      'Limitato a EU (il tuo paese: United States)',
    );
  });

  it('le regioni extra accettate evitano lo scarto', () => {
    const na = job({ location: 'North America Only' });
    expect(evalJob(na, settings()).rejectedReason).toMatch(/Limitato a North America/);
    const s = settings({ location: { extra_accepted_regions: ['north america'] } });
    expect(evalJob(na, s).rejectedReason).toBeNull();
  });

  it('aziende bloccate: nome intero, senza maiuscole né forma societaria', () => {
    const s = settings({ companies: { blocked: ['acme', 'Globex Corporation'] } });
    expect(evalJob(job({ company: 'ACME Inc.' }), s).rejectedReason).toBe('Azienda bloccata: ACME Inc.');
    expect(evalJob(job({ company: 'Globex' }), s).rejectedReason).toBe('Azienda bloccata: Globex');
    expect(evalJob(job({ company: 'Acme Robotics' }), s).rejectedReason).toBeNull();
    expect(evalJob(job({ company: 'Acme' }), settings()).rejectedReason).toBeNull();
  });

  it('pattern esclusi a mano', () => {
    const s = settings({ location: { extra_rejected_patterns: ['security clearance'] } });
    const j = job({ descriptionOriginal: '<p>TypeScript. Active Security Clearance required.</p>' });
    expect(evalJob(j, s).rejectedReason).toBe('Corrisponde al pattern escluso "security clearance"');
  });

  it('fuso orario: scarta oltre max_timezone_offset_hours', () => {
    const est = job({ descriptionOriginal: '<p>TypeScript. Must overlap with EST working hours.</p>' });
    expect(est.timezoneOffsets).toEqual([-5]);
    expect(evalJob(est, settings()).rejectedReason).toMatch(
      /^Fuso orario incompatibile: richiede UTC-5, tu sei a UTC\+2/,
    );
    const wide = settings({ location: { max_timezone_offset_hours: 8 } });
    expect(evalJob(est, wide).rejectedReason).toBeNull();
    const cet = job({ descriptionOriginal: '<p>TypeScript. 4 hours overlap with CET required.</p>' });
    expect(evalJob(cet, settings()).rejectedReason).toBeNull();
  });

  it('senza onboarding (paese assente) non applica i filtri del profilo', () => {
    const usOnly = job({ location: 'USA' });
    const s = settingsSchema.parse({ keywords: { required_any: ['typescript'] } });
    expect(evaluateJob(usOnly, s, NOW).rejectedReason).toBeNull();
  });
});

describe('evaluateJob: P.IVA ed EOR', () => {
  const contract = job({ contractHint: 'contract', title: 'TypeScript Developer (B2B contract)' });
  const viaEor = job({
    contractHint: 'contract',
    descriptionOriginal: '<p>TypeScript contract role. You will be hired via Deel as our Employer of Record.</p>',
  });

  it('rileva i ruoli che richiedono P.IVA e quelli via EOR', () => {
    expect(contract).toMatchObject({ requiresVat: true, viaEor: false });
    expect(viaEor).toMatchObject({ requiresVat: true, viaEor: true });
    expect(job()).toMatchObject({ requiresVat: false, viaEor: false });
  });

  it('con P.IVA: punteggio normale', () => {
    const ev = evalJob(contract, settings());
    expect(ev.rejectedReason).toBeNull();
    expect(item(ev, 'vat').points).toBe(5);
  });

  it('senza P.IVA, policy penalize: visibile con punteggio ridotto; via EOR no', () => {
    const noVat = settings({ user: { country: 'IT', has_vat_number: false } });
    const withVat = evalJob(contract, settings());
    const penalized = evalJob(contract, noVat);
    expect(penalized.rejectedReason).toBeNull();
    expect(item(penalized, 'vat').points).toBe(-15);
    expect(penalized.ruleScore).toBe(withVat.ruleScore - 20);

    const eor = evalJob(viaEor, noVat);
    expect(item(eor, 'vat').points).toBe(5);
    expect(eor.ruleScore).toBe(evalJob(viaEor, settings()).ruleScore);
  });

  it('policy exclude scarta, policy keep non ha effetto', () => {
    const exclude = settings({
      user: { country: 'IT', has_vat_number: false },
      contract: { without_vat_policy: 'exclude' },
    });
    expect(evalJob(contract, exclude).rejectedReason).toBe('Richiede P.IVA/VAT e non ce l’hai');
    expect(evalJob(viaEor, exclude).rejectedReason).toBeNull();
    const keep = settings({ user: { country: 'IT', has_vat_number: false }, contract: { without_vat_policy: 'keep' } });
    expect(evalJob(contract, keep).ruleScore).toBe(evalJob(contract, settings()).ruleScore);
  });
});

describe('evaluateJob: criteri di ricerca', () => {
  it('keyword escluse e richieste', () => {
    expect(evalJob(job({ title: 'PHP / TypeScript Developer' }), settings()).rejectedReason).toBe(
      'Contiene la parola esclusa "php"',
    );
    const unrelated = job({ title: 'Account Executive', descriptionOriginal: '<p>Sell things.</p>' });
    expect(evalJob(unrelated, settings()).rejectedReason).toBe('Nessuna delle keyword richieste è presente');
  });

  it('una keyword tecnologica trova anche gli alias nello stack ("postgres" → PostgreSQL)', () => {
    const ev = evalJob(job(), settings());
    expect(item(ev, 'boost').detail).toContain('postgres');
    expect(item(ev, 'keywords').detail).toContain('anche nel titolo');
  });

  it('seniority esclusa, remoto, contratto', () => {
    expect(evalJob(job({ title: 'Junior TypeScript Developer' }), settings()).rejectedReason).toBe(
      'Seniority esclusa: junior',
    );
    expect(evalJob(job({ remoteHint: 'hybrid' }), settings()).rejectedReason).toBe('Non è full remote: lavoro ibrido');
    expect(
      evalJob(job({ remoteHint: 'onsite' }), settings({ location: { remote_only: false } })).rejectedReason,
    ).toBeNull();
    const onlyFullTime = settings({ contract: { types: ['full-time'] } });
    expect(evalJob(job({ contractHint: 'part-time' }), onlyFullTime).rejectedReason).toBe(
      'Tipo di contratto non richiesto: part-time',
    );
  });

  it('retribuzione: converte nella valuta dell’utente e applica la soglia minima', () => {
    const low = job({ salary: { min: 30000, max: 40000, currency: 'USD', period: 'year', rawText: '$30k-$40k' } });
    const evLow = evalJob(low, settings());
    expect(evLow).toMatchObject({ salaryLocalMin: 27600, salaryLocalMax: 36800 });
    expect(evLow.rejectedReason).toMatch(/^Retribuzione sotto la soglia: 36\.800 EUR\/anno/);

    const good = job({ salary: { min: 90000, max: 120000, currency: 'USD', period: 'year', rawText: '$90k-$120k' } });
    const evGood = evalJob(good, settings());
    expect(evGood.rejectedReason).toBeNull();
    expect(item(evGood, 'salary').points).toBe(10);

    const daily = job({ salary: { min: 200, max: 250, currency: 'EUR', period: 'day', rawText: '€200-250/day' } });
    expect(evalJob(daily, settings()).rejectedReason).toMatch(/250 EUR\/giorno/);
  });

  it('retribuzione assente: accettata o scartata secondo allow_missing, mai stimata', () => {
    const ev = evalJob(job(), settings());
    expect(ev).toMatchObject({ salaryLocalMin: null, salaryLocalMax: null, rejectedReason: null });
    expect(item(ev, 'salary').detail).toBe('Retribuzione non indicata');
    const strict = settings({ compensation: { allow_missing: false } });
    expect(evalJob(job(), strict).rejectedReason).toBe('Retribuzione non indicata');
  });

  it('valuta senza tasso di cambio: non converte e non scarta', () => {
    const pln = job({
      salary: { min: 10000, max: 12000, currency: 'PLN', period: 'year', rawText: '10,000–12,000 PLN/year' },
    });
    const ev = evalJob(pln, settings());
    expect(ev.salaryLocalMax).toBeNull();
    expect(ev.rejectedReason).toBeNull();
  });

  it('freschezza', () => {
    const old = job({ publishedAt: new Date('2026-08-01T00:00:00Z') });
    expect(evalJob(old, settings()).rejectedReason).toBe('Annuncio più vecchio di 21 giorni');
  });

  it('troppe tecnologie fuori dalle keyword abbassano il punteggio; poche o nessuna no', () => {
    const base = evalJob(job(), settings());
    expect(item(base, 'other_tech')).toMatchObject({ points: 0, max: 0, detail: 'Tutte tra le tue keyword' });

    // una sola estranea: nessuna penalità
    const few = evalJob(
      job({ descriptionOriginal: '<p>Node.js, NestJS and PostgreSQL, deployed on AWS.</p>' }),
      settings(),
    );
    expect(item(few, 'other_tech').points).toBe(0);
    expect(item(few, 'other_tech').detail).toContain('nessuna penalità');

    const many = evalJob(
      job({
        descriptionOriginal:
          '<p>TypeScript and Node.js are a plus. Our stack: Java, Kotlin, Spring, Go, Kafka, Kubernetes, Terraform, Python.</p>',
      }),
      settings(),
    );
    const penalty = item(many, 'other_tech');
    expect(penalty.points).toBeLessThanOrEqual(-15);
    expect(penalty.points).toBeGreaterThanOrEqual(-25);
    expect(many.ruleScore).toBeLessThan(base.ruleScore - 14);
    expect(penalty.detail).toMatch(/fuori dalle tue keyword: .*Java/);
    expect(many.rejectedReason).toBeNull();

    // le stesse tecnologie, messe tra le preferite, non penalizzano più
    const liked = evalJob(
      job({ descriptionOriginal: '<p>Our stack: Java, Kotlin, Spring, Go, Kafka, Kubernetes, Terraform, Python.</p>' }),
      settings({
        keywords: {
          required_any: ['typescript'],
          boost: ['java', 'kotlin', 'spring', 'go', 'kafka', 'kubernetes', 'terraform', 'python'],
          exclude: [],
        },
      }),
    );
    expect(item(liked, 'other_tech').points).toBe(0);

    // senza keyword configurate non c'è nulla con cui confrontare
    const none = evalJob(
      job({ descriptionOriginal: '<p>Java, Kotlin, Spring, Go, Kafka.</p>' }),
      settings({ keywords: { required_any: [], boost: [], exclude: [] } }),
    );
    expect(item(none, 'other_tech').points).toBe(0);
  });

  it('il punteggio resta tra 0 e 100 ed è la somma trasparente delle voci', () => {
    const ev = evalJob(job(), settings());
    expect(ev.ruleScore).toBeGreaterThan(60);
    expect(ev.ruleScore).toBeLessThanOrEqual(100);
    expect(ev.scoreBreakdown.items.reduce((s, i) => s + i.max, 0)).toBe(100);
    expect(ev.scoreBreakdown.total).toBe(ev.scoreBreakdown.items.reduce((s, i) => s + i.points, 0));
  });
});
