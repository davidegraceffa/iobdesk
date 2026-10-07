import { ApplicationsService } from '../src/applications/applications.service';
import { FetchService } from '../src/fetch-runs/fetch.service';
import { PipelineService } from '../src/pipeline/pipeline.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { SourceHttpService } from '../src/sources/source-http.service';
import { SourcesRegistry } from '../src/sources/sources.registry';
import { connect, env, fakeAdapter, jobInput, resetDatabase, seedSettings, testSettings } from './helpers';

/** Test di integrazione della pipeline contro un PostgreSQL reale (docker-compose.test.yml). */
describe('pipeline con PostgreSQL', () => {
  let prisma: PrismaService;
  let pipeline: PipelineService;

  beforeAll(async () => {
    prisma = await connect();
    pipeline = new PipelineService(prisma);
  });
  beforeEach(() => resetDatabase(prisma));
  afterAll(() => prisma.$disconnect());

  it('due raccolte consecutive non creano duplicati e non perdono stato e note', async () => {
    const settings = testSettings();
    const adapter = fakeAdapter('fake', [
      jobInput({ externalId: '1' }),
      jobInput({ externalId: '2', title: 'React Developer', company: 'Globex' }),
    ]);
    const raws = await adapter.fetchJobs({} as never);

    const first = await pipeline.ingest(adapter, raws, settings);
    expect(first).toMatchObject({ found: 2, created: 2, updated: 0, duplicates: 0 });
    expect(first.newAcceptedIds).toHaveLength(2);

    const job = await prisma.job.findFirstOrThrow({ where: { externalId: '1' } });
    await prisma.job.update({ where: { id: job.id }, data: { status: 'saved', notes: 'da ricontattare' } });

    const later = new Date(Date.now() + 60_000);
    const second = await pipeline.ingest(adapter, raws, settings, later);
    expect(second).toMatchObject({ found: 2, created: 0, updated: 2 });
    expect(second.newAcceptedIds).toEqual([]);
    expect(await prisma.job.count()).toBe(2);

    const after = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(after).toMatchObject({ status: 'saved', notes: 'da ricontattare' });
    expect(after.firstSeenAt).toEqual(job.firstSeenAt);
    expect(after.lastSeenAt.getTime()).toBe(later.getTime());
  });

  it('deduplica con pg_trgm lo stesso annuncio trovato su due fonti e tiene il più completo', async () => {
    const settings = testSettings();
    const short = fakeAdapter('board-a', [
      jobInput({
        externalId: 'a1',
        title: 'Senior TypeScript Engineer',
        company: 'Acme Inc.',
        descriptionOriginal: '<p>TypeScript.</p>',
      }),
    ]);
    const rich = fakeAdapter('board-b', [
      jobInput({
        externalId: 'b1',
        title: 'Senior TypeScript Engineer (m/f/d)',
        company: 'ACME',
        descriptionOriginal: `<p>${'We build APIs with Node.js, NestJS and PostgreSQL. '.repeat(80)}</p><p>Salary: €70k–90k gross/year. Apply at <a href="https://jobs.lever.co/acme/123">Lever</a></p>`,
      }),
    ]);
    const different = fakeAdapter('board-c', [
      jobInput({
        externalId: 'c1',
        title: 'Product Designer',
        company: 'Acme',
        descriptionOriginal: '<p>React design system</p>',
      }),
    ]);

    await pipeline.ingest(short, await short.fetchJobs({} as never), settings);
    const second = await pipeline.ingest(rich, await rich.fetchJobs({} as never), settings);
    await pipeline.ingest(different, await different.fetchJobs({} as never), settings);
    expect(second).toMatchObject({ created: 1, duplicates: 1 });

    const jobs = await prisma.job.findMany({ orderBy: { source: 'asc' } });
    const [a, b, c] = jobs as [(typeof jobs)[number], (typeof jobs)[number], (typeof jobs)[number]];
    // l'annuncio più completo diventa il principale; l'altro resta collegato
    expect(b.duplicateOfId).toBeNull();
    expect(a.duplicateOfId).toBe(b.id);
    expect(c.duplicateOfId).toBeNull();
    expect(b).toMatchObject({
      salaryFound: true,
      salaryMin: 70000,
      applyMethod: 'ats',
      canonicalUrl: 'https://jobs.lever.co/acme/123',
    });
  });

  it('se l’utente ha già lavorato sull’annuncio esistente, resta lui il principale', async () => {
    const settings = testSettings();
    const short = fakeAdapter('board-a', [
      jobInput({ externalId: 'a1', company: 'Acme', descriptionOriginal: '<p>TypeScript.</p>' }),
    ]);
    await pipeline.ingest(short, await short.fetchJobs({} as never), settings);
    const original = await prisma.job.findFirstOrThrow();
    await prisma.job.update({ where: { id: original.id }, data: { status: 'saved' } });

    const rich = fakeAdapter('board-b', [
      jobInput({
        externalId: 'b1',
        company: 'Acme',
        descriptionOriginal: `<p>${'TypeScript and Node.js. '.repeat(200)}</p>`,
      }),
    ]);
    await pipeline.ingest(rich, await rich.fetchJobs({} as never), settings);
    const dup = await prisma.job.findFirstOrThrow({ where: { source: 'board-b' } });
    expect(dup.duplicateOfId).toBe(original.id);
  });

  it('cambiando paese da IT a US il ricalcolo inverte "US only" ed "EU only", con motivi leggibili', async () => {
    const adapter = fakeAdapter('fake', [
      jobInput({ externalId: 'us', title: 'TypeScript Engineer (US only)', company: 'Initech', location: 'Remote' }),
      jobInput({
        externalId: 'eu',
        title: 'React Developer',
        company: 'Umbrella',
        location: 'Remote',
        descriptionOriginal: '<p>React and TypeScript. This role is EU only.</p>',
      }),
      jobInput({ externalId: 'ww', title: 'Node.js Developer', company: 'Hooli' }),
    ]);
    const italy = testSettings();
    await pipeline.ingest(adapter, await adapter.fetchJobs({} as never), italy);
    const reasons = async () =>
      Object.fromEntries((await prisma.job.findMany()).map((j) => [j.externalId, j.rejectedReason]));
    expect(await reasons()).toEqual({ us: 'Limitato a United States (il tuo paese: Italy)', eu: null, ww: null });

    const preview = await pipeline.previewAccepted(testSettings({ user: { country: 'US', has_vat_number: true } }));
    expect(preview).toEqual({ total: 3, acceptedNow: 2, acceptedAfter: 2 });

    const result = await pipeline.recomputeAll(testSettings({ user: { country: 'US', has_vat_number: true } }));
    expect(result).toMatchObject({ total: 3 });
    expect(await reasons()).toEqual({ us: null, eu: 'Limitato a EU (il tuo paese: United States)', ww: null });
  });

  it('senza P.IVA con policy penalize: badge e punteggio ridotto per i contract, non per quelli via EOR', async () => {
    const adapter = fakeAdapter('fake', [
      jobInput({
        externalId: 'contract',
        company: 'Initech',
        title: 'TypeScript Developer (B2B contract)',
        contractHint: 'contract',
      }),
      jobInput({
        externalId: 'eor',
        company: 'Hooli',
        title: 'React Contractor',
        contractHint: 'contract',
        descriptionOriginal: '<p>React contract role, hired via Deel (Employer of Record).</p>',
      }),
    ]);
    await pipeline.ingest(adapter, await adapter.fetchJobs({} as never), testSettings());
    const withVat = Object.fromEntries((await prisma.job.findMany()).map((j) => [j.externalId, j.ruleScore]));

    await pipeline.recomputeAll(testSettings({ user: { country: 'IT', has_vat_number: false } }));
    const jobs = Object.fromEntries((await prisma.job.findMany()).map((j) => [j.externalId, j]));
    expect(jobs.contract).toMatchObject({ requiresVat: true, viaEor: false, rejectedReason: null });
    expect(jobs.contract!.ruleScore).toBe(withVat.contract! - 20);
    expect(jobs.eor).toMatchObject({ requiresVat: true, viaEor: true, rejectedReason: null });
    expect(jobs.eor!.ruleScore).toBe(withVat.eor);
  });

  it('ricerca full-text sulla colonna tsvector generata', async () => {
    const adapter = fakeAdapter('fake', [
      jobInput({
        externalId: '1',
        title: 'Backend Engineer',
        company: 'Initech',
        descriptionOriginal: '<p>TypeScript services with event sourcing and Kafka.</p>',
      }),
      jobInput({
        externalId: '2',
        title: 'Frontend Engineer',
        company: 'Hooli',
        descriptionOriginal: '<p>React and TypeScript design systems.</p>',
      }),
    ]);
    await pipeline.ingest(adapter, await adapter.fetchJobs({} as never), testSettings());
    const hits = await prisma.$queryRaw<Array<{ externalId: string }>>`
      SELECT "externalId" FROM "Job" WHERE "searchVector" @@ websearch_to_tsquery('english', ${'kafka sourcing'})`;
    expect(hits.map((h) => h.externalId)).toEqual(['1']);
  });

  it('una fonte offline non fa fallire il run e l’errore resta visibile', async () => {
    const settings = await seedSettings(
      prisma,
      testSettings({ sources: { remotive: { enabled: true }, remoteok: { enabled: true } } }),
    );
    const ok = fakeAdapter('remotive', [jobInput({ externalId: '1' })]);
    const down = fakeAdapter('remoteok', new Error('getaddrinfo ENOTFOUND remoteok.com'));
    const registry = new SourcesRegistry([ok, down]);
    const noop = { isActive: async () => false, enqueue: async () => undefined, notifyJobs: async () => 0 };
    const fetch = new FetchService(
      prisma,
      settings,
      registry,
      new SourceHttpService(),
      pipeline,
      noop as never,
      noop as never,
    );

    const rows = await fetch.runAll('cli');
    expect(rows).toEqual([
      expect.objectContaining({ source: 'remotive', status: 'success', found: 1, created: 1 }),
      expect.objectContaining({ source: 'remoteok', status: 'error', error: 'getaddrinfo ENOTFOUND remoteok.com' }),
    ]);
    const status = await fetch.sourcesStatus();
    expect(status.find((s) => s.id === 'remoteok')).toMatchObject({
      lastError: 'getaddrinfo ENOTFOUND remoteok.com',
      lastRun: expect.objectContaining({ status: 'error' }),
    });
    expect(status.find((s) => s.id === 'remotive')).toMatchObject({ lastError: null, jobCount: 1 });

    // una seconda raccolta manuale ravvicinata riusa i dati salvati invece di interrogare di nuovo la fonte
    const again = await fetch.runAll('cli', 'remotive');
    expect(again[0]).toMatchObject({ status: 'skipped' });
    const forced = await fetch.runAll('cli', 'remotive', { force: true });
    expect(forced[0]).toMatchObject({ status: 'success', created: 0, updated: 1 });
  });

  it('finché l’onboarding non è completo non si raccoglie nulla', async () => {
    const settings = await seedSettings(prisma, testSettings({ user: {} }));
    const fetch = new FetchService(
      prisma,
      settings,
      new SourcesRegistry([]),
      new SourceHttpService(),
      pipeline,
      {} as never,
      {} as never,
    );
    await expect(fetch.runAll('cli')).rejects.toThrow(/onboarding/i);
  });

  it('impostazioni: seed da search.yaml, storico e ripristino', async () => {
    const { SettingsService } = await import('../src/config/settings.service');
    const service = new SettingsService(prisma, env);
    const seeded = await service.snapshot();
    expect(seeded.version).toBe(1);
    // il seed di esempio lascia paese e P.IVA da compilare nell'onboarding
    expect(seeded.settings.user.country).toBeUndefined();
    expect(seeded.settings.keywords.required_any).toContain('typescript');

    await service.save({ ...seeded.settings, user: { country: 'IT', has_vat_number: true } });
    await service.save({ ...seeded.settings, user: { country: 'US', has_vat_number: false } });
    await expect(service.save({ ...seeded.settings, user: { country: 'XX' } })).rejects.toMatchObject({
      response: { errors: [expect.objectContaining({ path: 'user.country' })] },
    });

    const history = await service.history();
    expect(history.map((h) => h.version)).toEqual([3, 2, 1]);
    expect(history[0]!.changes).toEqual([
      { path: 'user.country', before: 'IT', after: 'US' },
      { path: 'user.has_vat_number', before: true, after: false },
    ]);
    const restored = await service.restore(history[1]!.id);
    expect(restored).toMatchObject({ version: 4, settings: { user: { country: 'IT', has_vat_number: true } } });

    // un'altra istanza (riavvio del container) rilegge dal database, non dal file
    const fresh = new SettingsService(prisma, env);
    expect((await fresh.get()).user.country).toBe('IT');
  });

  it('import CSV delle candidature: anteprima, creazione, reimport senza duplicati, aggiornamento di stato', async () => {
    const settings = await seedSettings(prisma, testSettings());
    const applications = new ApplicationsService(prisma, settings, new SourcesRegistry([]));
    const header =
      'ID offerta,Data candidatura,Azienda,Posizione,Località,Portale,Link offerta,CV inviato,Lingua,Modalità,Stato,Note,Nazione';
    const csv = [
      header,
      'mail-a1,2026-08-17,Acme S.p.A,Tech Lead,"Milano, Lombardia",Indeed,https://mail.google.com/mail/u/0/#all/a1,,,Da email,INVIATA,da mail: Candidatura per Tech Lead,Italia',
      'mail-b2,2026-08-24,Globex,Back-End Developer,,Ashby,https://mail.google.com/mail/u/0/#all/b2,,,Da email,RIFIUTATA,"da mail: Thanks | rifiuto: mail-c3 (2026-09-01)",Belgio',
      'mail-d4,2026-09-21,Hooli,,,Sito aziendale,,,,Da email,SALTATA (account richiesto),da mail: We received your application,Svezia',
      'mail-e5,non-una-data,Initech,Dev,,,,,,,INVIATA,,',
    ].join('\n');

    // anteprima: nulla viene salvato
    const preview = await applications.importCsv(csv, true);
    expect(preview).toMatchObject({ dryRun: true, total: 3, created: 3, updated: 0, unchanged: 0 });
    expect(preview.errors).toEqual([{ row: 5, message: expect.stringMatching(/Data non valida/) }]);
    expect(await prisma.application.count()).toBe(0);

    const first = await applications.importCsv(csv, false);
    expect(first).toMatchObject({ dryRun: false, created: 3, updated: 0 });
    const all = await applications.list({});
    expect(all).toHaveLength(3);
    const byId = Object.fromEntries(all.map((a) => [a.externalId, a]));
    expect(byId['mail-a1']).toMatchObject({
      currentStatus: 'applied',
      channel: 'job_board',
      country: 'Italia',
      trackingMode: 'Da email',
      jobId: null,
      notes: 'da mail: Candidatura per Tech Lead',
      snapshot: {
        company: 'Acme S.p.A',
        title: 'Tech Lead',
        location: 'Milano, Lombardia',
        sourceName: 'Indeed',
        sourceUrl: 'https://mail.google.com/mail/u/0/#all/a1',
      },
    });
    expect(byId['mail-a1']!.appliedAt).toBe('2026-08-17T12:00:00.000Z');
    expect(byId['mail-d4']).toMatchObject({ currentStatus: 'skipped', snapshot: { title: 'Posizione non indicata' } });

    // il rifiuto ha la sua data nella timeline, presa dalle note
    const rejected = await applications.get(byId['mail-b2']!.id);
    expect(rejected.events!.map((e) => [e.toStatus, e.at.slice(0, 10)])).toEqual([
      ['applied', '2026-08-24'],
      ['rejected', '2026-09-01'],
    ]);
    // le candidature saltate non contano tra quelle inviate
    expect(await applications.stats()).toMatchObject({
      total: 2,
      responseRate: 50,
      byStatus: { applied: 1, rejected: 1, skipped: 1 },
    });
    expect(await applications.countries()).toEqual(['Belgio', 'Italia', 'Svezia']);
    expect((await applications.list({ country: 'italia' })).map((a) => a.externalId)).toEqual(['mail-a1']);

    // reimportare lo stesso file non cambia nulla
    expect(await applications.importCsv(csv, false)).toMatchObject({ created: 0, updated: 0, unchanged: 3 });
    expect(await prisma.application.count()).toBe(3);

    // le note scritte nell'app restano; lo stato aggiornato nel file genera un evento
    await applications.update(byId['mail-a1']!.id, { notes: 'richiamare lunedì' });
    // la RAL si inserisce e si toglie a mano dalla candidatura registrata
    const withSalary = await applications.update(byId['mail-a1']!.id, { salaryRawText: ' 45.000 € lordi ' });
    expect(withSalary.snapshot).toMatchObject({ salaryFound: true, salaryRawText: '45.000 € lordi' });
    expect(withSalary.notes).toBe('richiamare lunedì');
    const withoutSalary = await applications.update(byId['mail-a1']!.id, { salaryRawText: '' });
    expect(withoutSalary.snapshot.salaryFound).toBe(false);
    expect(withoutSalary.snapshot.salaryRawText).toBeUndefined();
    expect(withoutSalary.snapshot.title).toBe(withSalary.snapshot.title);
    const updatedCsv = csv.replace(
      'Da email,INVIATA,da mail: Candidatura per Tech Lead',
      'Da email,COLLOQUIO,da mail: altra nota',
    );
    expect(await applications.importCsv(updatedCsv, false)).toMatchObject({ created: 0, updated: 1, unchanged: 2 });
    const after = await applications.get(byId['mail-a1']!.id);
    expect(after).toMatchObject({ currentStatus: 'interview', notes: 'richiamare lunedì' });
    expect(after.events!.map((e) => [e.fromStatus, e.toStatus])).toEqual([[null, 'applied'], ['applied', 'interview']]); // prettier-ignore

    // l'export dell'app si può reimportare così com'è, senza creare doppioni
    const exported = await applications.exportCsv({});
    expect(exported.split('\r\n')[0]).toContain(
      'ID offerta,Data candidatura,Azienda,Posizione,Località,Portale,Link offerta,CV inviato,Lingua,Modalità,Stato,Note,Nazione',
    );
    expect(await applications.importCsv(exported, false)).toMatchObject({
      total: 3,
      created: 0,
      updated: 0,
      unchanged: 3,
      errors: [],
    });
  });

  it('la candidatura sopravvive alla cancellazione dell’annuncio, con snapshot e timeline', async () => {
    const settings = await seedSettings(prisma, testSettings());
    const adapter = fakeAdapter('fake', [
      jobInput({ externalId: '1', descriptionOriginal: '<p>TypeScript. Salary: €60k–70k gross/year</p>' }),
    ]);
    await pipeline.ingest(adapter, await adapter.fetchJobs({} as never), await settings.get());
    const job = await prisma.job.findFirstOrThrow();
    const applications = new ApplicationsService(prisma, settings, new SourcesRegistry([]));

    const created = await applications.applyToJob(job.id, { notes: 'inviata dal form' });
    expect(created).toMatchObject({ currentStatus: 'applied', channel: 'other', jobId: job.id });
    expect(created.events).toHaveLength(1);
    expect((await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe('applied');
    // niente candidature doppie
    await expect(applications.applyToJob(job.id, {})).rejects.toMatchObject({ status: 409 });

    await applications.update(created.id, { currentStatus: 'interview', eventNote: 'colloquio tecnico fissato' });
    await prisma.job.delete({ where: { id: job.id } });

    const after = await applications.get(created.id);
    expect(after.jobId).toBeNull();
    expect(after.snapshot).toMatchObject({
      title: 'Senior TypeScript Engineer',
      company: 'Acme',
      salaryFound: true,
      salaryRawText: '€60k–70k gross/year',
      descriptionOriginal: '<p>TypeScript. Salary: €60k–70k gross/year</p>',
    });
    expect(after.snapshot.techStack.languages).toEqual(['TypeScript']);
    expect(after.events!.map((e) => [e.fromStatus, e.toStatus, e.note])).toEqual([
      [null, 'applied', 'Candidatura inviata'],
      ['applied', 'interview', 'colloquio tecnico fissato'],
    ]);
    expect(after.events!.every((e) => !Number.isNaN(Date.parse(e.at)))).toBe(true);
    expect(await applications.stats()).toMatchObject({ total: 1, interviews: 1, responseRate: 100 });
  });
});
