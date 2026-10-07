import { parseCsv } from '../common/csv';
import { channelFromPortal, mapStatus, parseApplicationsCsv, parseDate } from './import';

/** Righe inventate, nello stesso formato del foglio di tracciamento delle candidature. */
const SHEET = `ID offerta,Data candidatura,Azienda,Posizione,Località,Portale,Link offerta,CV inviato,Lingua,Modalità,Stato,Note,Nazione
mail-aaa111,2026-08-17,Acme S.p.A,Tech Lead,"Milano, Lombardia (Italia)",Indeed,https://mail.google.com/mail/u/0/#all/aaa111,,,Da email,RIFIUTATA,da mail: Candidatura per Tech Lead attraverso Indeed,Italia
mail-bbb222,2026-08-24,Globex,(Senior) Back-End Developer (Node.js),,Ashby,https://mail.google.com/mail/u/0/#all/bbb222,,,Da email,RIFIUTATA,"da mail: Globex | Thanks for your application! | rifiuto: mail-ccc333 (2026-09-01)",Belgio
mail-ddd444,2026-09-01,Initech,Senior Full Stack Developer,,Sito aziendale,https://mail.google.com/mail/u/0/#all/ddd444,CV_inglese.pdf,en,Da email,COLLOQUIO,da mail: Candidatura eseguita,Italia
mail-eee555,2026-09-21,Hooli,,,Sito aziendale,https://mail.google.com/mail/u/0/#all/eee555,,,Da email,SALTATA (account richiesto),da mail: We received your application,Svezia
mail-fff666,2026-09-18,,Medior Back-End Developer,,Workday,,,,Da email,INVIATA,da mail: Grazie per la tua candidatura!,
`;

describe('parseCsv', () => {
  it('gestisce virgolette, virgole e a capo dentro i campi, BOM e righe vuote', () => {
    expect(parseCsv('\uFEFFa,b\r\n"x, y","dice ""ciao"""\r\n\r\n"riga\n2",z\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'dice "ciao"'],
      ['riga\n2', 'z'],
    ]);
  });

  it('riconosce il separatore punto e virgola e la tabulazione', () => {
    expect(parseCsv('a;b;c\n1;2;3')).toEqual([['a', 'b', 'c'], ['1', '2', '3']]); // prettier-ignore
    expect(parseCsv('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']]); // prettier-ignore
  });
});

describe('mappature', () => {
  it('stati del foglio → stati dell’app', () => {
    expect(mapStatus('INVIATA')).toBe('applied');
    expect(mapStatus('RIFIUTATA')).toBe('rejected');
    expect(mapStatus('COLLOQUIO')).toBe('interview');
    expect(mapStatus('SALTATA (account richiesto)')).toBe('skipped');
    expect(mapStatus('Nessuna risposta')).toBe('no_response');
    expect(mapStatus('')).toBe('applied');
    expect(mapStatus('boh')).toBeNull();
  });

  it('portale → canale', () => {
    expect(channelFromPortal('Indeed')).toBe('job_board');
    expect(channelFromPortal('LinkedIn')).toBe('linkedin');
    expect(channelFromPortal('Sito aziendale')).toBe('careers_page');
    for (const ats of ['Workday', 'Ashby', 'Workable', 'SmartRecruiters', 'Lever', 'Teamtailor']) {
      expect(channelFromPortal(ats)).toBe('ats');
    }
    expect(channelFromPortal('')).toBe('other');
  });

  it('date ISO e italiane, senza slittamenti di giorno', () => {
    expect(parseDate('2026-08-17')?.toISOString()).toBe('2026-08-17T12:00:00.000Z');
    expect(parseDate('17/08/2026')?.toISOString()).toBe('2026-08-17T12:00:00.000Z');
    expect(parseDate('2026-02-31')).toBeNull();
    expect(parseDate('ieri')).toBeNull();
  });
});

describe('parseApplicationsCsv', () => {
  it('mappa tutte le colonne del foglio', () => {
    const result = parseApplicationsCsv(SHEET);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.ignoredColumns).toEqual([]);
    expect(result.recognizedColumns).toHaveLength(13);
    expect(result.rows).toHaveLength(5);

    expect(result.rows[0]).toMatchObject({
      row: 2,
      externalId: 'mail-aaa111',
      company: 'Acme S.p.A',
      title: 'Tech Lead',
      location: 'Milano, Lombardia (Italia)',
      portal: 'Indeed',
      channel: 'job_board',
      url: 'https://mail.google.com/mail/u/0/#all/aaa111',
      trackingMode: 'Da email',
      status: 'rejected',
      statusDetail: null,
      statusDate: null,
      notes: 'da mail: Candidatura per Tech Lead attraverso Indeed',
      country: 'Italia',
    });
    expect(result.rows[0]!.appliedAt.toISOString()).toBe('2026-08-17T12:00:00.000Z');
  });

  it('ricava la data del rifiuto dalle note, il CV inviato e il dettaglio dello stato', () => {
    const [, rejected, interview, skipped, noCompany] = parseApplicationsCsv(SHEET).rows;
    expect(rejected).toMatchObject({ status: 'rejected', channel: 'ats', country: 'Belgio' });
    expect(rejected!.statusDate?.toISOString()).toBe('2026-09-01T12:00:00.000Z');
    expect(interview).toMatchObject({
      status: 'interview',
      cvSent: 'CV_inglese.pdf',
      cvLanguage: 'en',
      channel: 'careers_page',
    });
    expect(skipped).toMatchObject({ status: 'skipped', statusDetail: 'SALTATA (account richiesto)', title: '' });
    expect(noCompany).toMatchObject({ company: '', title: 'Medior Back-End Developer', url: '', country: '' });
  });

  it('senza ID ne deriva uno stabile; gli ID ripetuti vengono ignorati con un avviso', () => {
    const csv = 'Data;Azienda;Ruolo\n01/09/2026;Acme;Developer\n01/09/2026;Acme;Developer\n';
    const a = parseApplicationsCsv(csv);
    const b = parseApplicationsCsv(csv);
    expect(a.rows).toHaveLength(1);
    expect(a.rows[0]!.externalId).toMatch(/^import-[0-9a-f]{16}$/);
    expect(a.rows[0]!.externalId).toBe(b.rows[0]!.externalId);
    expect(a.warnings).toEqual([{ row: 3, message: expect.stringMatching(/ripetuto/) }]);
  });

  it('segnala righe e file non validi senza importarli a metà', () => {
    const bad = parseApplicationsCsv(
      'Data candidatura,Azienda,Posizione,Stato,Extra\nnon-una-data,Acme,Dev,INVIATA,x\n2026-09-01,,,INVIATA,x\n2026-09-02,Acme,Dev,IN FORSE,x\n',
    );
    expect(bad.errors).toEqual([
      { row: 2, message: expect.stringMatching(/Data non valida/) },
      { row: 3, message: 'Riga senza azienda né posizione' },
    ]);
    expect(bad.warnings).toEqual([{ row: 4, message: expect.stringMatching(/Stato "IN FORSE" non riconosciuto/) }]);
    expect(bad.rows).toHaveLength(1);
    expect(bad.ignoredColumns).toEqual(['Extra']);

    expect(parseApplicationsCsv('foo,bar\n1,2').errors[0]!.message).toMatch(/Intestazioni non riconosciute/);
    expect(parseApplicationsCsv('Azienda,Posizione\nAcme,Dev').errors[0]!.message).toMatch(/Data candidatura/);
    expect(parseApplicationsCsv('').errors[0]!.message).toBe('Il file è vuoto');
  });
});
