import { loadEnv } from '../../config/env';
import { buildJobCore } from '../../pipeline/normalize';
import { EmailAlertsAdapter, parseAlertEmail } from './email-alerts.adapter';

/**
 * Email costruite a mano per i test (nessun dato reale): riproducono la struttura
 * "link all'annuncio + righe con azienda e località" usata dagli alert.
 */
const LINKEDIN = `
<table><tr><td>
  <a href="https://www.linkedin.com/comm/jobs/view/4012345678/?trackingId=abc&amp;refId=xyz"><img src="logo.png"></a>
  <a href="https://www.linkedin.com/comm/jobs/view/4012345678/?trackingId=abc&amp;refId=xyz">Senior TypeScript Engineer</a>
  <p>Acme Robotics · Italy (Remote)</p>
</td></tr><tr><td>
  <a href="https://www.linkedin.com/comm/jobs/view/4087654321/?trackingId=def">Full Stack Developer (React/Node.js)</a>
  <p>Globex S.r.l. · Milano, Lombardia</p>
  <a href="https://www.linkedin.com/comm/jobs/view/4087654321/?trackingId=def">View job</a>
</td></tr></table>
<a href="https://www.linkedin.com/comm/jobs/alerts">Manage alerts</a>`;

const INDEED = `
<div><a href="https://www.indeed.com/rc/clk?jk=abc123def456&amp;from=ja&amp;qd=xyz"><h2>Backend Developer NestJS</h2></a>
<div>Initech</div><div>Remote in Roma, Lazio</div><div>€45.000 - €55.000 all'anno</div></div>
<div><a href="https://it.indeed.com/viewjob?jk=fff000aaa111&amp;from=ja">React Developer</a>
<div>Umbrella Corp</div><div>Torino</div></div>`;

describe('parseAlertEmail', () => {
  it('LinkedIn: titolo dal link, azienda e località dalla riga successiva', () => {
    const jobs = parseAlertEmail({
      messageId: '1',
      from: 'LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>',
      subject: 'x',
      html: LINKEDIN,
    });
    expect(jobs).toEqual([
      {
        provider: 'linkedin',
        url: 'https://www.linkedin.com/jobs/view/4012345678',
        externalId: '4012345678',
        title: 'Senior TypeScript Engineer',
        company: 'Acme Robotics',
        location: 'Italy (Remote)',
      },
      {
        provider: 'linkedin',
        url: 'https://www.linkedin.com/jobs/view/4087654321',
        externalId: '4087654321',
        title: 'Full Stack Developer (React/Node.js)',
        company: 'Globex S.r.l.',
        location: 'Milano, Lombardia',
      },
    ]);
  });

  it('Indeed: azienda e località su righe separate', () => {
    const jobs = parseAlertEmail({ messageId: '2', from: 'Indeed <alert@indeed.com>', subject: 'x', html: INDEED });
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      provider: 'indeed',
      externalId: 'abc123def456',
      url: 'https://www.indeed.com/viewjob?jk=abc123def456',
      title: 'Backend Developer NestJS',
      company: 'Initech',
      location: 'Remote in Roma, Lazio',
    });
    expect(jobs[1]).toMatchObject({ title: 'React Developer', company: 'Umbrella Corp', location: 'Torino' });
  });

  it('ignora le email di mittenti non previsti', () => {
    expect(parseAlertEmail({ messageId: '3', from: 'newsletter@example.com', subject: 'x', html: LINKEDIN })).toEqual(
      [],
    );
  });
});

describe('EmailAlertsAdapter', () => {
  it('senza credenziali IMAP non è configurato e non tenta connessioni', async () => {
    const adapter = new EmailAlertsAdapter({
      ...loadEnv(),
      imap: { host: '', port: 993, user: '', password: '', mailbox: 'job-alerts' },
    });
    expect(adapter.isConfigured()).toBe(false);
    await expect(
      adapter.fetchJobs({ http: {} as never, settings: {} as never, now: new Date(), log: () => undefined }),
    ).rejects.toThrow(/IMAP non configurato/);
  });

  it('normalizza un annuncio estratto da un alert', () => {
    const adapter = new EmailAlertsAdapter(loadEnv());
    const [job] = parseAlertEmail({
      messageId: '1',
      from: 'jobalerts-noreply@linkedin.com',
      subject: 'Nuovi annunci',
      html: LINKEDIN,
    });
    const input = adapter.normalize({ ...job, receivedAt: '2026-09-30T08:00:00.000Z', subject: 'Nuovi annunci' });
    expect(input).toMatchObject({
      source: 'email_alerts',
      externalId: 'linkedin:4012345678',
      sourceUrl: 'https://www.linkedin.com/jobs/view/4012345678',
      title: 'Senior TypeScript Engineer',
      company: 'Acme Robotics',
      tags: ['LinkedIn'],
    });
    const core = buildJobCore(input);
    expect(core.applyMethod).toBe('source_page');
    expect(core.techStack.languages).toEqual(['TypeScript']);
  });
});
