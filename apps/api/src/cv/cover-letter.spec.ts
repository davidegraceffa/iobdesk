import { coverLetterSchema } from '@jobagg/shared';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildCoverLetterDocx, contactLine, splitParagraphs } from './cover-letter-docx';
import { letterFileName } from './cover-letter.service';
import { DocxDocument } from './docx/docx-document';
import { computeStructure } from './docx/structure';
import { buildCoverLetterPrompt, composeLetterBody } from './prompts';

const FIXTURES = join(__dirname, '../../../../tests/fixtures/cv');
const ONE_COLUMN = readFileSync(join(FIXTURES, 'cv-one-column-en.docx'));

async function structureOf(buffer: Buffer) {
  return computeStructure((await DocxDocument.load(buffer)).extractParagraphs());
}

const job = {
  title: 'Senior Backend Engineer',
  company: 'Meridian Freight',
  descriptionText: 'We build APIs with Node.js and NestJS.',
  seniority: 'senior',
  techStack: { languages: [], frameworks: [], databases: [], cloud: [], tools: [], other: [] } as never,
};

describe('lettera di candidatura', () => {
  it('il prompt contiene annuncio, CV e istruzioni ma non nome e contatti', async () => {
    const structure = await structureOf(ONE_COLUMN);
    const prompt = buildCoverLetterPrompt({
      language: 'it',
      job,
      structure,
      extraSkills: ['Kafka'],
      userInstructions: 'Tono informale',
    });
    expect(prompt.system).toContain('Write the whole letter in Italian');
    expect(prompt.user).toContain('Meridian Freight');
    expect(prompt.user).toContain('Full-stack developer with 6 years');
    expect(prompt.user).toContain('Kafka');
    expect(prompt.user).toContain('Tono informale');
    expect(prompt.user).not.toContain('alex@example.com');
    expect(prompt.user).not.toContain('Alex Example');

    const retry = buildCoverLetterPrompt({
      language: 'it',
      job,
      structure,
      extraSkills: [],
      inventedTechnologies: ['Kubernetes'],
    });
    expect(retry.user).toContain('not in the CV nor in the additional skills: Kubernetes');
  });

  it('compone il testo con saluto, paragrafi, chiusura e firma', () => {
    const draft = coverLetterSchema.parse({
      subject: 'Candidatura',
      greeting: 'Gentile team, ',
      paragraphs: ['Primo. ', 'Secondo.'],
      closing: 'Cordiali saluti,',
    });
    expect(composeLetterBody(draft, 'Alex Example')).toBe(
      'Gentile team,\n\nPrimo.\n\nSecondo.\n\nCordiali saluti,\nAlex Example',
    );
    expect(splitParagraphs('Uno\r\n\r\n\r\n  Due  \nTre\n\n')).toEqual(['Uno', 'Due\nTre']);
    expect(() =>
      coverLetterSchema.parse({ subject: 'x', greeting: 'x', paragraphs: ['solo uno'], closing: 'x' }),
    ).toThrow();
  });

  it('prende i recapiti dalla parte iniziale del CV, non dal resto', async () => {
    const structure = await structureOf(ONE_COLUMN);
    const contacts = contactLine(structure);
    expect(contacts).toContain('alex@example.com');
    expect(contacts).not.toContain('Alex Example');
    expect(contacts).not.toContain('Full-stack developer');
  });

  it('il DOCX contiene intestazione, oggetto e testo, con i caratteri speciali intatti', async () => {
    const docx = await buildCoverLetterDocx({
      candidateName: 'Alex Example',
      contacts: 'alex@example.com · +39 333 1234567',
      date: '5 ottobre 2026',
      company: 'Smith & Sons <Ltd>',
      subject: 'Candidatura per Senior Backend Engineer',
      body: 'Gentile team,\n\nHo lavorato su API con Node.js & NestJS.\n\nCordiali saluti,\nAlex Example',
    });
    const paragraphs = (await DocxDocument.load(docx)).extractParagraphs().map((p) => p.text);
    expect(paragraphs).toEqual([
      'Alex Example',
      'alex@example.com · +39 333 1234567',
      '5 ottobre 2026',
      'Smith & Sons <Ltd>',
      'Candidatura per Senior Backend Engineer',
      'Gentile team,',
      'Ho lavorato su API con Node.js & NestJS.',
      expect.stringMatching(/^Cordiali saluti,\s*Alex Example$/),
    ]);
  });

  it('nome del file senza caratteri non sicuri', () => {
    expect(
      letterFileName({
        name: 'Alex Example',
        company: 'Meridian Freight',
        title: 'Senior Dev (Node.js)',
        language: 'en',
        version: 2,
      }),
    ).toBe('Lettera_Alex-Example_Meridian-Freight_Senior-Dev-Node-js_en_v2');
  });
});
