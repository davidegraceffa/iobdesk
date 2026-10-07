import { cvEditsSchema, type AppliedCvEdit, type CvEdit, type CvStructure } from '@jobagg/shared';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { detect } from 'tinyld';
import { buildJobCore } from '../pipeline/normalize';
import { allowedTechnologies, validateEdits } from './anti-invention';
import { applyEditsToDocx } from './apply-edits';
import { cvFileName } from './cv-generation.service';
import { DocxDocument, DocxEditError, InvalidDocxError } from './docx/docx-document';
import { computeStructure, toRawParagraphs } from './docx/structure';
import { buildCvEditsPrompt } from './prompts';

const FIXTURES = join(__dirname, '../../../../tests/fixtures/cv');
const ONE_COLUMN = readFileSync(join(FIXTURES, 'cv-one-column-en.docx'));
const TWO_COLUMNS = readFileSync(join(FIXTURES, 'cv-two-columns-it.docx'));
const JOB_DESCRIPTION = readFileSync(join(FIXTURES, 'job-description.txt'), 'utf8');

async function load(buffer: Buffer) {
  const doc = await DocxDocument.load(buffer);
  const structure = computeStructure(doc.extractParagraphs());
  const byText = (needle: string) => {
    const p = structure.paragraphs.find((x) => x.text.includes(needle));
    if (!p) throw new Error(`Paragrafo non trovato: ${needle}`);
    return p;
  };
  return { doc, structure, byText };
}

const applied = (edit: CvEdit, id = 'e1'): AppliedCvEdit => ({ ...edit, id, status: 'accepted' });
const parse = (edits: unknown[]) => cvEditsSchema.parse({ edits }).edits;

describe('estrazione della struttura', () => {
  it('CV a una colonna: sezioni, bullet, id stabili', async () => {
    const { structure, byText } = await load(ONE_COLUMN);
    expect(structure.sections.map((s) => [s.type, s.title])).toEqual([
      ['personal', 'Dati personali'],
      ['summary', 'Summary'],
      ['skills', 'Skills'],
      ['experience', 'Experience'],
      ['education', 'Education'],
      ['languages', 'Languages'],
    ]);
    expect(structure.candidateName).toBe('Alex Example');
    expect(structure.paragraphs[0]).toMatchObject({ id: 'p0', text: 'Alex Example', mutable: false });

    // run spezzati con lo stesso stile: testo ricomposto e modificabile
    const summary = byText('Full-stack developer with 6 years');
    expect(summary.text).toBe(
      'Full-stack developer with 6 years of experience building web applications with TypeScript, Node.js and React. I care about clean APIs, automated tests and reliable delivery.',
    );
    expect(summary).toMatchObject({ editable: true, mutable: true, isBullet: false });

    // esperienze: solo i bullet sono modificabili; ruolo, azienda e date no
    expect(byText('Built REST APIs')).toMatchObject({ isBullet: true, mutable: true, editable: true });
    expect(byText('Senior Developer — Northwind Labs')).toMatchObject({ isBullet: false, mutable: false });
    expect(byText('Senior Developer — Northwind Labs').text).toBe('Senior Developer — Northwind Labs\t2021 – 2025');
    // stili misti nello stesso paragrafo: mutabile per regola, ma il testo non è sostituibile
    expect(byText('Mentored')).toMatchObject({ mutable: true, editable: false });
    expect(byText('Mentored').notEditableReason).toMatch(/più stili/);
    expect(byText('BSc Computer Science')).toMatchObject({ mutable: false });

    // rileggere lo stesso file produce gli stessi id
    const again = await load(ONE_COLUMN);
    expect(again.structure.paragraphs.map((p) => p.id)).toEqual(structure.paragraphs.map((p) => p.id));
  });

  it('CV a due colonne (tabella di layout): sezioni in entrambe le colonne', async () => {
    const { structure, byText } = await load(TWO_COLUMNS);
    expect(structure.sections.map((s) => s.type)).toEqual([
      'personal', 'skills', 'languages', 'summary', 'experience', 'education',
    ]); // prettier-ignore
    expect(structure.candidateName).toBe('Giulia Esempio');
    expect(byText('Node.js, NestJS, Express')).toMatchObject({ mutable: true, editable: true });
    expect(byText('example.com/giulia')).toMatchObject({ editable: false, mutable: false });
    expect(byText('example.com/giulia').notEditableReason).toMatch(/link/);
    expect(byText('Sviluppatrice full-stack con 8 anni')).toMatchObject({ mutable: true, editable: true });
    expect(byText('Laurea in Informatica')).toMatchObject({ mutable: false });
  });

  it('le correzioni manuali dell’utente ricalcolano le sezioni', async () => {
    const { structure, byText } = await load(ONE_COLUMN);
    const skillsHeading = structure.sections.find((s) => s.type === 'skills')!.headingParagraphId!;
    const firstBullet = byText('Built REST APIs');
    const corrected = computeStructure(toRawParagraphs(structure), {
      [skillsHeading]: 'other',
      [firstBullet.id]: 'not_heading',
      [byText('Languages: TypeScript').id]: 'skills',
    });
    expect(corrected.sections.find((s) => s.headingParagraphId === skillsHeading)?.type).toBe('other');
    expect(
      corrected.sections.some((s) => s.title === 'Languages: TypeScript, JavaScript, SQL' && s.type === 'skills'),
    ).toBe(true);
    // senza correzioni si torna alla struttura automatica
    expect(computeStructure(toRawParagraphs(structure)).sections).toEqual(structure.sections);
  });

  it('rifiuta file che non sono DOCX', async () => {
    await expect(DocxDocument.load(Buffer.from('%PDF-1.7 not a docx'))).rejects.toBeInstanceOf(InvalidDocxError);
    await expect(DocxDocument.load(Buffer.from('PK\u0003\u0004 broken zip'))).rejects.toBeInstanceOf(InvalidDocxError);
  });
});

describe('applicazione delle modifiche al DOCX', () => {
  it('replace: cambia solo il testo, preserva w:pPr e w:rPr, fonde i run con lo stesso stile', async () => {
    const { doc, byText } = await load(ONE_COLUMN);
    const bullet = byText('Built REST APIs');
    const before = doc.paragraphXml(bullet.id);
    doc.replaceText(bullet.id, 'Designed and built REST APIs with NestJS and PostgreSQL.');
    const after = doc.paragraphXml(bullet.id);
    const pPr = (xml: string) => /<w:pPr>.*?<\/w:pPr>/.exec(xml)?.[0];
    expect(pPr(after)).toBe(pPr(before));
    expect(pPr(after)).toContain('<w:numPr>');
    expect(doc.getText(bullet.id)).toBe('Designed and built REST APIs with NestJS and PostgreSQL.');

    const summary = byText('Full-stack developer with 6 years');
    doc.replaceText(summary.id, 'Backend-focused developer.');
    const xml = doc.paragraphXml(summary.id);
    expect(xml.match(/<w:r[ >]/g)).toHaveLength(1);
    expect(xml).toContain('w:rsidRPr="00A1B2C3"');
    expect(xml).toContain('<w:t xml:space="preserve">Backend-focused developer.</w:t>');
  });

  it('replace su un paragrafo con stili misti viene rifiutato', async () => {
    const { doc, byText } = await load(ONE_COLUMN);
    expect(() => doc.replaceText(byText('Mentored').id, 'x')).toThrow(DocxEditError);
    expect(doc.getText(byText('Mentored').id)).toBe('Mentored 2 junior developers on testing with Jest.');
  });

  it('reorder, remove e insert_after operano su paragrafi esistenti dello stesso tipo', async () => {
    const { byText, structure } = await load(ONE_COLUMN);
    const [a, b, c] = ['Built REST APIs', 'Led the migration', 'Introduced CI/CD'].map((t) => byText(t));
    const experience = structure.sections.find((s) => s.type === 'experience')!;
    const edits: AppliedCvEdit[] = [
      applied({ op: 'reorder', sectionId: experience.id, paragraphIds: [c!.id, a!.id, b!.id], reason: '' }, 'e1'),
      applied({ op: 'remove', paragraphId: byText('Developed React components').id, reason: '' }, 'e2'),
      applied(
        {
          op: 'insert_after',
          afterParagraphId: b!.id,
          cloneStyleFrom: a!.id,
          newText: 'Reviewed code and documented the APIs.',
          sourceParagraphIds: [a!.id],
          reason: '',
        },
        'e3',
      ),
    ];
    const result = await applyEditsToDocx(ONE_COLUMN, edits);
    expect(result.failed).toEqual([]);
    const lines = result.finalText.split('\n');
    const at = (text: string) => lines.findIndex((l) => l.includes(text));
    expect(at('Introduced CI/CD')).toBeLessThan(at('Built REST APIs'));
    expect(at('Built REST APIs')).toBeLessThan(at('Led the migration'));
    expect(at('Reviewed code')).toBe(at('Led the migration') + 1);
    expect(at('Developed React components')).toBe(-1);
    // l'intestazione del ruolo resta prima dei suoi bullet
    expect(at('Senior Developer — Northwind Labs')).toBeLessThan(at('Introduced CI/CD'));

    // il paragrafo inserito è un clone: stesso stile ed elenco puntato dell'originale
    const reread = await DocxDocument.load(result.buffer);
    const inserted = reread.extractParagraphs().find((p) => p.text === 'Reviewed code and documented the APIs.')!;
    expect(inserted).toMatchObject({ style: 'ListParagraph', isBullet: true });
  });

  it('le modifiche rifiutate dall’utente non vengono applicate e i ritocchi manuali hanno la precedenza', async () => {
    const { byText } = await load(ONE_COLUMN);
    const p = byText('Introduced CI/CD');
    const base: CvEdit = {
      op: 'replace',
      paragraphId: p.id,
      newText: 'Automated releases.',
      sourceParagraphIds: [p.id],
      reason: '',
    };
    const rejected = await applyEditsToDocx(ONE_COLUMN, [{ ...applied(base), status: 'rejected' }]);
    expect(rejected.finalText).toContain('Introduced CI/CD pipelines with GitHub Actions and Docker.');
    const manual = await applyEditsToDocx(ONE_COLUMN, [
      { ...applied(base), manualText: 'Automated releases with Docker.' },
    ]);
    expect(manual.finalText).toContain('Automated releases with Docker.');
    expect(manual.finalText).not.toContain('Introduced CI/CD');
  });

  it('due colonne: non tocca tabella di layout, sfondi, stili e link', async () => {
    const { byText } = await load(TWO_COLUMNS);
    const skill = byText('Node.js, NestJS, Express');
    const result = await applyEditsToDocx(TWO_COLUMNS, [
      applied({
        op: 'replace',
        paragraphId: skill.id,
        newText: 'NestJS, Node.js, Express',
        sourceParagraphIds: [skill.id],
        reason: '',
      }),
    ]);
    const reread = await DocxDocument.load(result.buffer);
    const xml = (await (await import('jszip')).default.loadAsync(result.buffer))
      .file('word/document.xml')!
      .async('string');
    const text = await xml;
    expect(text).toContain('<w:shd w:val="clear" w:color="auto" w:fill="1F3A5F"/>');
    expect(text).toContain('<w:hyperlink r:id="rId3">');
    expect(text.match(/<w:tc>/g)).toHaveLength(2);
    expect(reread.extractParagraphs().find((p) => p.text === 'NestJS, Node.js, Express')).toMatchObject({
      style: 'Sidebar',
    });
    // l'unico paragrafo di una cella non si può rimuovere; nelle celle con più paragrafi sì
    expect(() => reread.remove(skill.id)).not.toThrow();
  });

  it('un’operazione impossibile non blocca le altre: finisce tra le modifiche non applicate', async () => {
    const { byText, structure } = await load(TWO_COLUMNS);
    const left = byText('Node.js, NestJS, Express');
    const right = byText('Automatizzato rilasci');
    const result = await applyEditsToDocx(TWO_COLUMNS, [
      // paragrafi in colonne diverse: non sono fratelli
      applied(
        { op: 'reorder', sectionId: structure.sections[1]!.id, paragraphIds: [left.id, right.id], reason: '' },
        'e1',
      ),
      applied(
        {
          op: 'replace',
          paragraphId: right.id,
          newText: 'Automatizzato i rilasci con Docker.',
          sourceParagraphIds: [right.id],
          reason: '',
        },
        'e2',
      ),
    ]);
    expect(result.failed).toEqual([{ editId: 'e1', reason: expect.stringMatching(/stesso blocco/) }]);
    expect(result.finalText).toContain('Automatizzato i rilasci con Docker.');
  });
});

describe('controllo anti-invenzione', () => {
  const extraSkills = ['Kafka', 'Team leadership'];
  let structure: CvStructure;
  let id: (text: string) => string;

  beforeAll(async () => {
    const loaded = await load(ONE_COLUMN);
    structure = loaded.structure;
    id = (text) => loaded.byText(text).id;
  });

  const run = (edits: unknown[]) => validateEdits(parse(edits), { structure, extraSkills, language: 'en' });

  it('le tecnologie ammesse sono quelle del CV base più le competenze aggiuntive', () => {
    const allowed = allowedTechnologies(structure, extraSkills);
    for (const tech of ['TypeScript', 'NestJS', 'PostgreSQL', 'React', 'Docker', 'Kafka'])
      expect(allowed.has(tech)).toBe(true);
    expect(allowed.has('Kubernetes')).toBe(false);
  });

  it('accetta una riformulazione che cita le fonti e usa solo contenuti esistenti', () => {
    const { accepted, rejected } = run([
      {
        op: 'replace',
        paragraphId: id('Built REST APIs'),
        newText: 'Designed REST APIs with NestJS and PostgreSQL for 40 internal teams.',
        sourceParagraphIds: [id('Built REST APIs')],
        reason: 'Mette in evidenza NestJS',
      },
    ]);
    expect(rejected).toEqual([]);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toMatchObject({ id: 'e1', status: 'accepted' });
  });

  it('scarta una tecnologia non presente nel CV', () => {
    const { accepted, rejected } = run([
      {
        op: 'replace',
        paragraphId: id('Introduced CI/CD'),
        newText: 'Introduced CI/CD pipelines with GitHub Actions, Docker and Kubernetes.',
        sourceParagraphIds: [id('Introduced CI/CD')],
        reason: 'L’annuncio chiede Kubernetes',
      },
    ]);
    expect(accepted).toEqual([]);
    expect(rejected[0]!.reason).toBe('Tecnologia non presente nel CV: Kubernetes');
  });

  it('accetta una tecnologia delle competenze aggiuntive solo se citata come fonte valida', () => {
    const edit = {
      op: 'insert_after',
      afterParagraphId: id('Introduced CI/CD'),
      cloneStyleFrom: id('Introduced CI/CD'),
      newText: 'Integrated services through Kafka.',
      sourceParagraphIds: [],
      reason: '',
    };
    expect(run([{ ...edit, extraSkills: ['Kafka'] }]).accepted).toHaveLength(1);
    expect(run([edit]).rejected[0]!.reason).toMatch(/senza fonte/);
    expect(run([{ ...edit, extraSkills: ['RabbitMQ'] }]).rejected[0]!.reason).toMatch(
      /non è tra le competenze aggiuntive/,
    );
  });

  it('scarta numeri, aziende e certificazioni inventati', () => {
    const target = id('Built REST APIs');
    const withSource = (newText: string) =>
      run([{ op: 'replace', paragraphId: target, newText, sourceParagraphIds: [target], reason: '' }]);
    expect(withSource('Built REST APIs with NestJS used by 400 internal teams.').rejected[0]!.reason).toBe(
      'Dato numerico non presente nelle fonti citate: 400',
    );
    expect(withSource('Built REST APIs with NestJS for Globex and other teams.').rejected[0]!.reason).toBe(
      'Termine non presente nel CV: Globex',
    );
    expect(withSource('Built REST APIs with NestJS as a Certified Scrum Master.').rejected[0]!.reason).toMatch(
      /non presente nel CV/,
    );
  });

  it('i dati immutabili non si toccano: nome, ruoli, date, formazione, intestazioni', () => {
    const attempt = (text: string) =>
      run([
        { op: 'replace', paragraphId: id(text), newText: 'Something else', sourceParagraphIds: [id(text)], reason: '' },
      ]).rejected[0]?.reason;
    expect(attempt('Alex Example')).toMatch(/non è modificabile/);
    expect(attempt('Senior Developer — Northwind Labs')).toMatch(/non è modificabile/);
    expect(attempt('BSc Computer Science')).toMatch(/non è modificabile/);
    expect(attempt('Experience')).toMatch(/intestazione/);
    expect(run([{ op: 'remove', paragraphId: id('BSc Computer Science'), reason: '' }]).rejected).toHaveLength(1);
  });

  it('scarta modifiche senza fonte, con fonti inesistenti o su paragrafi non sostituibili', () => {
    const target = id('Built REST APIs');
    expect(
      run([{ op: 'replace', paragraphId: target, newText: 'Built APIs.', sourceParagraphIds: [], reason: '' }])
        .rejected[0]!.reason,
    ).toMatch(/senza fonte/);
    expect(
      run([{ op: 'replace', paragraphId: target, newText: 'Built APIs.', sourceParagraphIds: ['p999'], reason: '' }])
        .rejected[0]!.reason,
    ).toMatch(/Fonte inesistente/);
    expect(
      run([{ op: 'replace', paragraphId: 'p999', newText: 'x', sourceParagraphIds: [target], reason: '' }]).rejected[0]!
        .reason,
    ).toMatch(/inesistente/);
    expect(
      run([
        {
          op: 'replace',
          paragraphId: id('Mentored'),
          newText: 'Mentored developers.',
          sourceParagraphIds: [id('Mentored')],
          reason: '',
        },
      ]).rejected[0]!.reason,
    ).toMatch(/più stili/);
  });

  it('riordino valido solo dentro una sezione e su paragrafi modificabili', () => {
    const experience = structure.sections.find((s) => s.type === 'experience')!;
    const ok = run([
      {
        op: 'reorder',
        sectionId: experience.id,
        paragraphIds: [id('Led the migration'), id('Built REST APIs')],
        reason: '',
      },
    ]);
    expect(ok.accepted).toHaveLength(1);
    const cross = run([
      {
        op: 'reorder',
        sectionId: experience.id,
        paragraphIds: [id('Built REST APIs'), id('Backend: Node.js')],
        reason: '',
      },
    ]);
    expect(cross.rejected[0]!.reason).toMatch(/non appartiene alla sezione/);
    const immutable = run([
      {
        op: 'reorder',
        sectionId: experience.id,
        paragraphIds: [id('Senior Developer — Northwind'), id('Built REST APIs')],
        reason: '',
      },
    ]);
    expect(immutable.rejected[0]!.reason).toMatch(/non è modificabile/);
  });

  it('il testo finale del documento non contiene tecnologie estranee', async () => {
    const { accepted } = run([
      {
        op: 'replace',
        paragraphId: id('Backend: Node.js'),
        newText: 'Backend: NestJS, Node.js, PostgreSQL, Redis',
        sourceParagraphIds: [id('Backend: Node.js')],
        reason: '',
      },
      {
        op: 'replace',
        paragraphId: id('Cloud and tooling'),
        newText: 'Cloud and tooling: Kubernetes, Terraform, AWS',
        sourceParagraphIds: [id('Cloud and tooling')],
        reason: '',
      },
    ]);
    expect(accepted).toHaveLength(1);
    const result = await applyEditsToDocx(ONE_COLUMN, accepted);
    expect(result.finalText).toContain('Backend: NestJS, Node.js, PostgreSQL, Redis');
    expect(result.finalText).not.toMatch(/Kubernetes|Terraform/);
  });
});

describe('lingua e prompt', () => {
  it('rileva la lingua della job description', () => {
    expect(buildJobCore({
      source: 't', sourceUrl: 'https://e.com/1', title: 'Senior Backend Engineer', company: 'Meridian Freight',
      descriptionOriginal: JOB_DESCRIPTION, descriptionIsHtml: false, tags: [], location: 'Europe',
    }).language).toBe('en'); // prettier-ignore
    expect(
      detect(
        'Cerchiamo una sviluppatrice o uno sviluppatore full-stack con esperienza in TypeScript, per lavorare da remoto con il nostro team di prodotto.',
      ),
    ).toBe('it');
    expect(
      detect('Wir suchen eine erfahrene Entwicklerin oder einen erfahrenen Entwickler für unser Team in Berlin.'),
    ).toBe('de');
  });

  it('il prompt non contiene nome e contatti, e indica quali paragrafi sono modificabili', async () => {
    const { structure } = await load(ONE_COLUMN);
    const prompt = buildCvEditsPrompt({
      language: 'en',
      job: {
        title: 'Senior Backend Engineer',
        company: 'Meridian Freight',
        descriptionText: JOB_DESCRIPTION,
        seniority: 'senior',
        techStack: {} as never,
      },
      analysis: {
        requiredRequirements: ['NestJS'],
        preferredRequirements: ['Kubernetes'],
        atsKeywords: [],
        seniority: 'senior',
      },
      structure,
      extraSkills: ['Kafka'],
      userInstructions: 'Metti in evidenza NestJS',
    });
    expect(prompt.user).not.toContain('alex@example.com');
    expect(prompt.user).not.toContain('Alex Example');
    expect(prompt.user).toContain('"additionalSkills": [\n  "Kafka"\n ]');
    expect(prompt.user).toContain('Metti in evidenza NestJS');
    const payload = JSON.parse(prompt.user) as {
      cv: { sections: Array<{ type: string; paragraphs: Array<{ text: string; mutable: boolean }> }> };
    };
    const experience = payload.cv.sections.find((s) => s.type === 'experience')!;
    expect(experience.paragraphs.find((p) => p.text.startsWith('Built REST APIs'))?.mutable).toBe(true);
    expect(experience.paragraphs.find((p) => p.text.startsWith('Senior Developer'))?.mutable).toBe(false);
    expect(experience.paragraphs.find((p) => p.text.startsWith('Mentored'))?.mutable).toBe(false);
    expect(prompt.system).toContain('Write every "newText" in English');
  });

  it('nome dei file scaricati senza caratteri non sicuri', () => {
    expect(
      cvFileName({
        name: 'Giulia Esempio',
        company: 'Aurora Software S.r.l.',
        title: 'Sviluppatrice Sénior (Node.js / NestJS)',
        language: 'it',
        version: 2,
      }),
    ).toBe('CV_Giulia-Esempio_Aurora-Software-S-r-l_Sviluppatrice-Senior-Node-js-NestJS_it_v2');
  });
});
