import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApplicationsService } from '../src/applications/applications.service';
import type { GmailClient } from '../src/mail/gmail.client';
import { GoogleAuthService } from '../src/mail/google-auth.service';
import { MailSyncService } from '../src/mail/mail-sync.service';
import type { MailItem } from '../src/mail/parse';
import type { PrismaService } from '../src/prisma/prisma.service';
import { SourcesRegistry } from '../src/sources/sources.registry';
import { connect, env, resetDatabase, seedSettings, testSettings } from './helpers';

const mail = (p: Partial<MailItem> & { threadId: string }): MailItem => ({
  name: '',
  email: '',
  subject: '',
  snippet: '',
  date: '2026-09-15',
  timestamp: Date.UTC(2026, 8, 15, 9, 30),
  ...p,
});

const receipt = (threadId: string, company: string, title: string, date = '2026-09-10') =>
  mail({
    threadId,
    date,
    name: `${company} Recruiting`,
    email: 'no-reply@us.greenhouse-mail.io',
    subject: `Thank you for applying to ${company}`,
    snippet: `Thanks for applying for the ${title} position at ${company}. We will review`,
  });

const rejection = (threadId: string, company: string, title: string, date = '2026-09-20') =>
  mail({
    threadId,
    date,
    timestamp: Date.parse(`${date}T08:00:00Z`),
    name: company,
    email: 'no-reply@greenhouse.io',
    subject: `Your application to ${company}`,
    body: `Hi Alex,\nThank you for applying for the ${title} position at ${company}. Unfortunately, we will not be moving forward.`,
  });

/** Sincronizzazione delle candidature da Gmail contro un PostgreSQL reale; la posta è finta (nessuna rete). */
describe('candidature da Gmail', () => {
  let prisma: PrismaService;
  let receipts: MailItem[];
  let rejections: MailItem[];
  let queries: string[];
  let sync: MailSyncService;
  let applications: ApplicationsService;

  beforeAll(async () => {
    prisma = await connect();
  });
  beforeEach(async () => {
    await resetDatabase(prisma);
    receipts = [];
    rejections = [];
    queries = [];
    const settings = await seedSettings(
      prisma,
      testSettings({ user: { country: 'IT', has_vat_number: true, timezone: 'Europe/Rome' } }),
    );
    const gmail = {
      search: async (query: string) => {
        queries.push(query);
        return (query.includes('unfortunately') ? rejections : receipts).map((m) => ({ ...m }));
      },
    } as unknown as GmailClient;
    const auth = new GoogleAuthService({ ...env, stateDir: mkdtempSync(join(tmpdir(), 'state-')) });
    sync = new MailSyncService(prisma, settings, auth, gmail);
    applications = new ApplicationsService(prisma, settings, new SourcesRegistry([]));
  });
  afterAll(() => prisma.$disconnect());

  it('una ricevuta diventa una candidatura "Da email"; rieseguire non crea doppioni', async () => {
    receipts = [receipt('t1', 'Northwind', 'Senior TypeScript Engineer')];

    const preview = await sync.run('manual', { dryRun: true });
    expect(preview).toMatchObject({ id: null, dryRun: true, created: 1, updated: 0 });
    expect(await prisma.application.count()).toBe(0);
    expect(await prisma.mailSyncRun.count()).toBe(0);

    const first = await sync.run('manual');
    expect(first).toMatchObject({ status: 'success', examined: 1, created: 1, updated: 0, duplicates: 0 });
    expect(queries[0]).toContain('newer_than:60d');
    const app = await prisma.application.findFirstOrThrow({ include: { events: true } });
    expect(app).toMatchObject({
      externalId: 'mail-t1',
      trackingMode: 'Da email',
      channel: 'ats',
      currentStatus: 'applied',
      notes: 'da mail: Thank you for applying to Northwind',
    });
    expect(app.appliedAt.toISOString()).toBe('2026-09-10T12:00:00.000Z');
    expect(app.snapshot).toMatchObject({
      company: 'Northwind',
      title: 'Senior TypeScript Engineer',
      sourceName: 'Greenhouse',
      sourceUrl: 'https://mail.google.com/mail/u/0/#all/t1',
    });
    expect(app.events.map((e) => e.toStatus)).toEqual(['applied']);

    const second = await sync.run('schedule');
    expect(second).toMatchObject({ created: 0, updated: 0, duplicates: 1 });
    expect(await prisma.application.count()).toBe(1);

    const status = await sync.status();
    expect(status).toMatchObject({ connected: false, running: false, enabled: false });
    expect(status.lastRun).toMatchObject({ trigger: 'schedule', status: 'success' });
    expect(await sync.listRuns()).toHaveLength(2);
  });

  it('non duplica le candidature importate dal foglio né quelle registrate dall’app', async () => {
    await applications.importCsv(
      [
        'ID offerta,Data candidatura,Azienda,Posizione,Portale,Modalità,Stato,Note',
        'mail-t1,2026-09-10,Northwind,Senior TypeScript Engineer,Greenhouse,Da email,INVIATA,da mail: Thank you',
      ].join('\n'),
      false,
    );
    await applications.createManual({
      title: 'Backend Developer',
      company: 'Contoso S.r.l.',
      appliedAt: '2026-09-09T10:00:00.000Z',
    } as never);
    receipts = [
      receipt('t1', 'Northwind', 'Senior TypeScript Engineer'),
      // stessa candidatura già registrata a mano: stessa azienda, titolo simile
      receipt('t2', 'Contoso', 'Backend Developer'),
    ];

    const run = await sync.run('manual');
    expect(run).toMatchObject({ created: 0, duplicates: 2 });
    expect(await prisma.application.count()).toBe(2);
  });

  it('un rifiuto porta la candidatura a "Rifiutata" una volta sola e non sovrascrive correzioni manuali', async () => {
    receipts = [receipt('t1', 'Northwind', 'Senior TypeScript Engineer')];
    await sync.run('manual');
    rejections = [rejection('t9', 'Northwind', 'Senior TypeScript Engineer')];

    const run = await sync.run('manual');
    expect(run).toMatchObject({ created: 0, updated: 1 });
    expect(run.details.updated[0]).toMatchObject({
      company: 'Northwind',
      previousStatus: 'applied',
      status: 'rejected',
    });
    const app = await prisma.application.findFirstOrThrow({ include: { events: { orderBy: { at: 'asc' } } } });
    expect(app.currentStatus).toBe('rejected');
    expect(app.notes).toBe('da mail: Thank you for applying to Northwind | rifiuto: mail-t9 (2026-09-20)');
    expect(app.events.map((e) => [e.fromStatus, e.toStatus])).toEqual([
      [null, 'applied'],
      ['applied', 'rejected'],
    ]);
    expect(app.events[1]!.at.toISOString()).toBe('2026-09-20T08:00:00.000Z');

    // l'utente corregge lo stato a mano: il marcatore nelle note impedisce di riapplicare il rifiuto
    await applications.update(app.id, { currentStatus: 'interview' } as never);
    const again = await sync.run('manual');
    expect(again).toMatchObject({ created: 0, updated: 0 });
    expect((await prisma.application.findFirstOrThrow()).currentStatus).toBe('interview');
  });

  it('rifiuto ambiguo: nessuna modifica, solo un avviso; rifiuto senza ricevuta: candidatura nuova già rifiutata', async () => {
    receipts = [
      receipt('t1', 'Acme', 'Backend Developer', '2026-09-01'),
      receipt('t2', 'Acme', 'Frontend Developer', '2026-09-05'),
    ];
    await sync.run('manual');
    rejections = [
      mail({
        threadId: 't7',
        date: '2026-09-20',
        name: 'Acme Recruiting',
        email: 'jobs@acme.it',
        subject: 'Aggiornamento sulla tua candidatura',
        body: 'Ciao Alex,\ngrazie per la tua candidatura.\nPurtroppo abbiamo deciso di proseguire con altri candidati.',
      }),
      rejection('t8', 'Fabrikam', 'Data Engineer'),
    ];

    const run = await sync.run('manual');
    expect(run).toMatchObject({ created: 1, updated: 0 });
    expect(run.details.ambiguous).toHaveLength(1);
    expect(run.details.ambiguous[0]).toContain('Acme');
    expect(await prisma.application.count({ where: { currentStatus: 'applied' } })).toBe(2);

    const fabrikam = await prisma.application.findUniqueOrThrow({
      where: { externalId: 'mail-t8' },
      include: { events: { orderBy: { at: 'asc' } } },
    });
    expect(fabrikam.currentStatus).toBe('rejected');
    expect(fabrikam.notes).toContain('rifiuto: mail-t8');
    expect(fabrikam.events.map((e) => e.toStatus)).toEqual(['applied', 'rejected']);

    // l'avviso resta finché la situazione non viene risolta, ma non si creano doppioni
    const again = await sync.run('manual');
    expect(again).toMatchObject({ created: 0, updated: 0 });
    expect(await prisma.application.count()).toBe(3);
  });

  it('ricevuta e rifiuto nella stessa esecuzione; i mittenti ignorati vengono saltati', async () => {
    const settings = await seedSettings(prisma, testSettings({ mail_sync: { ignore_senders: ['spam.example'] } }));
    const gmail = {
      search: async (query: string) => (query.includes('unfortunately') ? rejections : receipts),
    } as unknown as GmailClient;
    sync = new MailSyncService(prisma, settings, new GoogleAuthService(env), gmail);
    receipts = [
      receipt('t1', 'Northwind', 'Senior TypeScript Engineer'),
      { ...receipt('t2', 'Litware', 'Developer'), email: 'jobs@spam.example' },
    ];
    rejections = [rejection('t1', 'Northwind', 'Senior TypeScript Engineer')];

    const run = await sync.run('manual');
    expect(run).toMatchObject({ created: 1, updated: 0, ignored: 1 });
    expect(run.details.ignored[0]!.reason).toContain('mittente ignorato');
    const app = await prisma.application.findFirstOrThrow();
    expect(app).toMatchObject({ externalId: 'mail-t1', currentStatus: 'rejected' });
  });
});
