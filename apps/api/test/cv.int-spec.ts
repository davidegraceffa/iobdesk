import type { CvEdits } from '@jobagg/shared';
import { readFileSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyEditsToDocx } from '../src/cv/apply-edits';
import { BaseCvService } from '../src/cv/base-cv.service';
import { CoverLetterService } from '../src/cv/cover-letter.service';
import { CvGenerationService } from '../src/cv/cv-generation.service';
import { CvReviewService } from '../src/cv/cv-review.service';
import { CvStorageService } from '../src/cv/cv-storage.service';
import { GotenbergService } from '../src/cv/gotenberg.service';
import { pdfFonts, pdfPageCount } from '../src/cv/pdf-tools';
import type { LlmStatus } from '../src/llm/llm.service';
import type { LlmRequest } from '../src/llm/llm.types';
import { PipelineService } from '../src/pipeline/pipeline.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { ProgressService } from '../src/queue/progress.service';
import { connect, env, fakeAdapter, jobInput, resetDatabase, seedSettings, testSettings } from './helpers';

const FIXTURES = join(__dirname, '../../../tests/fixtures/cv');
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const upload = (name: string) => ({
  originalname: name,
  mimetype: DOCX_MIME,
  size: 0,
  buffer: readFileSync(join(FIXTURES, name)),
});

/** Test di integrazione con Gotenberg: l'LLM è sostituito da un mock che restituisce CvEdits fissi. */
describe('CV su misura con Gotenberg', () => {
  let prisma: PrismaService;
  const gotenberg = new GotenbergService(env);
  const storage = new CvStorageService(env);

  beforeAll(async () => {
    prisma = await connect();
  });
  beforeEach(() => resetDatabase(prisma));
  afterAll(() => prisma.$disconnect());

  async function toPdf(docx: Buffer): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'cv-'));
    const path = join(dir, 'cv.pdf');
    await writeFile(path, await gotenberg.docxToPdf(docx));
    return path;
  }

  it.each(['cv-one-column-en.docx', 'cv-two-columns-it.docx'])(
    '%s: il PDF modificato ha le stesse pagine e gli stessi font del base',
    async (name) => {
      const base = readFileSync(join(FIXTURES, name));
      const basePdf = await toPdf(base);

      const { DocxDocument } = await import('../src/cv/docx/docx-document');
      const { computeStructure } = await import('../src/cv/docx/structure');
      const structure = computeStructure((await DocxDocument.load(base)).extractParagraphs());
      const targets = structure.paragraphs.filter((p) => p.mutable && p.editable).slice(0, 3);
      expect(targets.length).toBe(3);
      const edited = await applyEditsToDocx(
        base,
        targets.map((p, i) => ({
          id: `e${i}`,
          status: 'accepted' as const,
          op: 'replace' as const,
          paragraphId: p.id,
          // testo riformulato della stessa lunghezza: parole in ordine inverso
          newText: p.text.split(' ').reverse().join(' '),
          sourceParagraphIds: [p.id],
          reason: '',
        })),
      );
      expect(edited.failed).toEqual([]);
      const editedPdf = await toPdf(edited.buffer);

      expect(await pdfPageCount(editedPdf)).toBe(await pdfPageCount(basePdf));
      const fonts = await pdfFonts(basePdf);
      expect(fonts.length).toBeGreaterThan(0);
      expect(await pdfFonts(editedPdf)).toEqual(fonts);
    },
  );

  it('flusso completo: upload del CV base, generazione, scarti anti-invenzione, revisione dell’utente', async () => {
    const settings = await seedSettings(
      prisma,
      testSettings({
        scoring: { llm: { enabled: true, provider: 'ollama', model: 'mock' } },
        cv: { languages: ['en', 'it'], extra_skills: 'Kafka' },
      }),
    );
    const baseCvs = new BaseCvService(prisma, settings, storage, gotenberg);

    // PDF rifiutato con spiegazione; DOCX accettato
    await expect(
      baseCvs.upload(
        { originalname: 'cv.pdf', mimetype: 'application/pdf', size: 5, buffer: Buffer.from('%PDF-') },
        'en',
      ),
    ).rejects.toThrow(/DOCX, non PDF/);
    await expect(baseCvs.upload(upload('cv-one-column-en.docx'), 'fr')).rejects.toThrow(/non abilitata/);
    const base = await baseCvs.upload(upload('cv-one-column-en.docx'), 'en');
    expect(base).toMatchObject({ language: 'en', version: 1, isActive: true, hasPdf: true, pageCount: 1 });
    expect((await baseCvs.slots()).map((s) => [s.language, s.status])).toEqual([['en', 'loaded'], ['it', 'empty']]); // prettier-ignore

    const { structure } = await baseCvs.structure(base.id);
    const text = (needle: string) => structure.paragraphs.find((p) => p.text.includes(needle))!;
    const summary = text('Full-stack developer with 6 years');
    const bullet = text('Introduced CI/CD');
    const experience = structure.sections.find((s) => s.type === 'experience')!;

    // annuncio di esempio
    const pipeline = new PipelineService(prisma);
    const adapter = fakeAdapter('fake', [
      jobInput({
        externalId: '1',
        title: 'Senior Backend Engineer (Node.js / NestJS)',
        company: 'Meridian Freight',
        descriptionOriginal: readFileSync(join(FIXTURES, 'job-description.txt'), 'utf8'),
        descriptionIsHtml: false,
      }),
    ]);
    await pipeline.ingest(adapter, await adapter.fetchJobs({} as never), await settings.get());
    const job = await prisma.job.findFirstOrThrow();
    expect(job.language).toBe('en');

    // LLM finto: una modifica valida, un riordino, una con tecnologia inventata, una senza fonte
    const fixed: CvEdits = {
      edits: [
        {
          op: 'replace',
          paragraphId: summary.id,
          newText:
            'Backend-focused full-stack developer with 6 years of experience building APIs with TypeScript, Node.js and NestJS.',
          sourceParagraphIds: [summary.id, text('Backend: Node.js').id],
          reason: 'Allinea il sommario al ruolo backend',
        },
        {
          op: 'reorder',
          sectionId: experience.id,
          paragraphIds: [bullet.id, text('Built REST APIs').id],
          reason: 'CI/CD in evidenza',
        },
        {
          op: 'replace',
          paragraphId: bullet.id,
          newText: 'Introduced CI/CD pipelines with GitHub Actions, Docker and Kubernetes.',
          sourceParagraphIds: [bullet.id],
          reason: 'L’annuncio chiede Kubernetes',
        },
        {
          op: 'replace',
          paragraphId: text('Led the migration').id,
          newText: 'Led a frontend migration.',
          sourceParagraphIds: [],
          reason: 'Più sintetico',
        },
      ],
      gaps: [
        {
          requirement: 'Kubernetes',
          importance: 'preferred',
          suggestion: 'Se hai esperienza con Kubernetes, aggiungila alle competenze aggiuntive nel Profilo.',
        },
      ],
      matchSummary: { covered: ['NestJS', 'PostgreSQL'], partiallyCovered: ['CI/CD'], missing: ['Kubernetes'] },
    };
    const calls: LlmRequest[] = [];
    const llm = {
      status: (): LlmStatus => ({
        provider: 'mock',
        model: 'mock',
        enabled: true,
        external: false,
        forcedByEnv: false,
        consentGiven: false,
        ready: true,
        notReadyReason: null,
      }),
      completeJson: async (_s: unknown, schema: { parse: (v: unknown) => unknown }, request: LlmRequest) => {
        calls.push(request);
        if (request.task === 'cv_email') {
          return schema.parse({
            subject: 'Application for Backend Engineer',
            greeting: 'Hello Initech team,',
            paragraphs: ['I am applying for the role.', 'My CV is attached.'],
            closing: 'Kind regards,',
          });
        }
        return schema.parse(
          request.task === 'analysis'
            ? { requiredRequirements: ['NestJS'], preferredRequirements: ['Kubernetes'] }
            : fixed,
        );
      },
    };
    const queued: string[] = [];
    const queue = {
      work: async () => undefined,
      send: async (_q: string, data: { generatedCvId: string }) => (queued.push(data.generatedCvId), 'queue-1'),
    };
    const progress = new ProgressService();
    const generation = new CvGenerationService(
      env,
      prisma,
      settings,
      llm as never,
      queue as never,
      progress,
      storage,
      gotenberg,
      baseCvs,
    );

    const options = await generation.options(job.id);
    expect(options).toMatchObject({
      available: true,
      languages: ['en'],
      detectedLanguage: 'en',
      suggestedLanguage: 'en',
      external: false,
    });

    const { generatedCvId } = await generation.request(job.id, {
      language: 'en',
      instructions: 'Metti in evidenza NestJS',
    });
    expect(queued).toEqual([generatedCvId]);
    const steps: string[] = [];
    const subscription = progress.forCv(generatedCvId).subscribe((e) => steps.push(e.step));
    await generation.process(generatedCvId);
    subscription.unsubscribe();
    expect(steps).toEqual(['analysis', 'adaptation', 'layout', 'preview', 'ready']);
    expect(calls.map((c) => c.task)).toEqual(['analysis', 'cv_edits']);
    expect(calls[1]!.user).toContain('Metti in evidenza NestJS');
    expect(calls[1]!.user).not.toContain('alex@example.com');

    const detail = await generation.detail(generatedCvId);
    expect(detail).toMatchObject({
      status: 'ready',
      language: 'en',
      version: 1,
      pageCount: 1,
      basePageCount: 1,
      warning: null,
    });
    expect(detail.fileName).toBe('CV_Alex-Example_Meridian-Freight_Senior-Backend-Engineer-Node-js-NestJS_en_v1');
    expect(detail.edits.map((e) => [e.op, e.status])).toEqual([['replace', 'accepted'], ['reorder', 'accepted']]); // prettier-ignore
    expect(detail.rejectedEdits.map((r) => r.reason)).toEqual([
      'Tecnologia non presente nel CV: Kubernetes',
      'Modifica senza fonte: non cita né paragrafi del CV né competenze aggiuntive',
    ]);
    expect(detail.gaps[0]).toMatchObject({ requirement: 'Kubernetes' });
    expect(detail.originals[summary.id]).toMatchObject({ text: summary.text, sectionTitle: 'Summary' });

    // il DOCX generato contiene le modifiche accettate e nessuna tecnologia estranea
    const { buffer: docx, fileName } = await generation.file(generatedCvId, 'docx');
    expect(fileName).toMatch(/\.docx$/);
    const { DocxDocument } = await import('../src/cv/docx/docx-document');
    const generatedText = (await DocxDocument.load(docx)).fullText();
    expect(generatedText).toContain('Backend-focused full-stack developer');
    expect(generatedText).not.toContain('Kubernetes');
    expect(generatedText.indexOf('Introduced CI/CD')).toBeLessThan(generatedText.indexOf('Built REST APIs'));
    expect(generatedText).toContain('Alex Example');
    // il file base non è stato toccato
    expect(
      (await storage.read(storage.basePath(base.id, 'original.docx'))).equals(upload('cv-one-column-en.docx').buffer),
    ).toBe(true);

    const pdf = await generation.file(generatedCvId, 'pdf');
    expect(pdf.buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect((await generation.thumbnail(generatedCvId, 1)).subarray(1, 4).toString()).toBe('PNG');

    // revisione: rifiutando una modifica il paragrafo torna all'originale; il ritocco manuale viene applicato
    const replaceId = detail.edits[0]!.id;
    const rejected = await generation.patchEdits(generatedCvId, [{ editId: replaceId, status: 'rejected' }]);
    expect(rejected.edits[0]!.status).toBe('rejected');
    expect((await DocxDocument.load((await generation.file(generatedCvId, 'docx')).buffer)).fullText()).toContain(
      summary.text,
    );

    const manual = await generation.patchEdits(generatedCvId, [
      { editId: replaceId, status: 'accepted', manualText: 'Backend developer focused on NestJS APIs.' },
    ]);
    expect(manual.manualEdits).toEqual({ [replaceId]: 'Backend developer focused on NestJS APIs.' });
    expect((await DocxDocument.load((await generation.file(generatedCvId, 'docx')).buffer)).fullText()).toContain(
      'Backend developer focused on NestJS APIs.',
    );
    expect(manual.pageCount).toBe(1);

    // CV da descrizione incollata: nessun annuncio, stessa generazione; rigenerare crea la versione 2
    await expect(
      generation.requestManual({
        title: 'Backend Engineer',
        company: 'Initech',
        description: 'troppo corta',
        language: 'en',
      }),
    ).rejects.toThrow(/troppo corta/);
    const manualRequest = {
      title: 'Backend Engineer',
      company: 'Initech',
      description: readFileSync(join(FIXTURES, 'job-description.txt'), 'utf8'),
      language: 'en',
    };
    const pasted = await generation.requestManual(manualRequest);
    await generation.process(pasted.generatedCvId);
    const manualDetail = await generation.detail(pasted.generatedCvId);
    expect(manualDetail).toMatchObject({
      status: 'ready',
      manual: true,
      jobId: null,
      jobTitle: 'Backend Engineer',
      company: 'Initech',
      version: 1,
      pageCount: 1,
    });
    expect(manualDetail.descriptionText).toContain(manualRequest.description.trim().slice(0, 40));
    expect(calls.at(-1)!.user).toContain('Initech');
    // email di accompagnamento: scritta sul CV (anche manuale), ritoccabile, con avviso sulle tecnologie estranee
    await expect(generation.updateEmail(pasted.generatedCvId, { body: 'x' })).rejects.toThrow(
      /non è ancora stata scritta/,
    );
    const withEmail = await generation.generateEmail(pasted.generatedCvId, { instructions: 'Tono diretto' });
    expect(calls.at(-1)).toMatchObject({ task: 'cv_email' });
    expect(calls.at(-1)!.user).toContain('Tono diretto');
    expect(calls.at(-1)!.user).not.toContain('alex@example.com');
    expect(withEmail.email).toMatchObject({
      subject: 'Application for Backend Engineer',
      edited: false,
      warning: null,
    });
    expect(withEmail.email!.body).toBe(
      'Hello Initech team,\n\nI am applying for the role.\n\nMy CV is attached.\n\nKind regards,\nAlex Example',
    );
    const editedEmail = await generation.updateEmail(pasted.generatedCvId, {
      body: `${withEmail.email!.body}\n\nP.S. I also know Kubernetes.`,
    });
    expect(editedEmail.email).toMatchObject({ edited: true, subject: 'Application for Backend Engineer' });
    expect(editedEmail.email!.warning).toContain('Kubernetes');

    const manualAgain = await generation.regenerate(pasted.generatedCvId, {});
    await generation.process(manualAgain.generatedCvId);
    expect((await generation.listManual()).map((c) => [c.company, c.version, c.status])).toEqual([
      ['Initech', 2, 'ready'],
      ['Initech', 1, 'ready'],
    ]);
    expect(detail.manual).toBe(false);

    // rigenerare crea una nuova versione; sostituire il CV base archivia la precedente
    const again = await generation.regenerate(generatedCvId, { instructions: 'Più sintetico' });
    await generation.process(again.generatedCvId);
    expect((await generation.listForJob(job.id)).map((c) => [c.version, c.status])).toEqual([[2, 'ready'], [1, 'ready']]); // prettier-ignore

    const replaced = await baseCvs.upload(upload('cv-one-column-en.docx'), 'en');
    expect(replaced.version).toBe(2);
    expect((await baseCvs.versions('en')).map((v) => [v.version, v.isActive])).toEqual([[2, true], [1, false]]); // prettier-ignore
    expect((await generation.detail(generatedCvId)).baseCvId).toBe(base.id);

    // il CV resta disponibile anche se l'annuncio viene eliminato
    await prisma.job.delete({ where: { id: job.id } });
    const orphan = await generation.detail(generatedCvId);
    expect(orphan).toMatchObject({
      jobId: null,
      jobTitle: 'Senior Backend Engineer (Node.js / NestJS)',
      company: 'Meridian Freight',
    });
    expect((await generation.file(generatedCvId, 'pdf')).buffer.length).toBeGreaterThan(1000);
  });

  it('lettera di candidatura: scrittura, controllo delle tecnologie, ritocchi, PDF e DOCX', async () => {
    const settings = await seedSettings(
      prisma,
      testSettings({
        scoring: { llm: { enabled: true, provider: 'ollama', model: 'mock' } },
        cv: { languages: ['en', 'it'] },
      }),
    );
    const baseCvs = new BaseCvService(prisma, settings, storage, gotenberg);
    await baseCvs.upload(upload('cv-one-column-en.docx'), 'en');
    const pipeline = new PipelineService(prisma);
    const adapter = fakeAdapter('fake', [
      jobInput({
        externalId: '1',
        title: 'Senior Backend Engineer (Node.js / NestJS)',
        company: 'Meridian Freight',
        descriptionOriginal: readFileSync(join(FIXTURES, 'job-description.txt'), 'utf8'),
        descriptionIsHtml: false,
      }),
    ]);
    await pipeline.ingest(adapter, await adapter.fetchJobs({} as never), await settings.get());
    const job = await prisma.job.findFirstOrThrow();

    // LLM finto: la prima stesura cita Kubernetes (assente dal CV), la seconda no
    const calls: LlmRequest[] = [];
    const llm = {
      status: (): LlmStatus => ({
        provider: 'mock',
        model: 'mock',
        enabled: true,
        external: false,
        forcedByEnv: false,
        consentGiven: false,
        ready: true,
        notReadyReason: null,
      }),
      completeJson: async (_s: unknown, schema: { parse: (v: unknown) => unknown }, request: LlmRequest) => {
        calls.push(request);
        return schema.parse({
          subject: 'Candidatura per Senior Backend Engineer',
          greeting: 'Gentile team di Meridian Freight,',
          paragraphs: [
            calls.length === 1
              ? 'Negli ultimi anni ho costruito API con Node.js e NestJS su Kubernetes.'
              : 'Negli ultimi anni ho costruito API con Node.js e NestJS.',
            'Sarei felice di approfondire in un colloquio.',
          ],
          closing: 'Cordiali saluti,',
        });
      },
    };
    const letters = new CoverLetterService(env, prisma, settings, llm as never, storage, gotenberg, baseCvs);

    // la lettera si può scrivere anche in una lingua senza CV base: i fatti arrivano dal CV disponibile
    expect(await letters.options(job.id)).toMatchObject({
      available: true,
      languages: ['en', 'it'],
      suggestedLanguage: 'en',
    });
    await expect(letters.request(job.id, { language: 'fr' })).rejects.toThrow(/non abilitata/);

    const created = await letters.request(job.id, { language: 'it', instructions: 'Tono diretto' });
    expect(created).toMatchObject({ status: 'generating', language: 'it', version: 1 });
    // la generazione parte in background alla richiesta: si attende che finisca
    let letter = await letters.detail(created.id);
    for (let i = 0; i < 100 && letter.status === 'generating'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      letter = await letters.detail(created.id);
    }
    expect(calls.map((c) => c.task)).toEqual(['cover_letter', 'cover_letter']);
    expect(calls[0]!.user).toContain('Tono diretto');
    expect(calls[0]!.user).not.toContain('alex@example.com');
    expect(calls[1]!.user).toContain('Kubernetes');
    expect(letter).toMatchObject({ status: 'ready', warning: null, edited: false, hasPdf: true });
    expect(letter.body).toBe(
      'Gentile team di Meridian Freight,\n\nNegli ultimi anni ho costruito API con Node.js e NestJS.\n\nSarei felice di approfondire in un colloquio.\n\nCordiali saluti,\nAlex Example',
    );
    expect(letter.fileName).toBe('Lettera_Alex-Example_Meridian-Freight_Senior-Backend-Engineer-Node-js-NestJS_it_v1');

    const pdf = await letters.file(letter.id, 'pdf');
    expect(pdf.buffer.subarray(0, 5).toString()).toBe('%PDF-');
    const dir = await mkdtemp(join(tmpdir(), 'letter-'));
    await writeFile(join(dir, 'letter.pdf'), pdf.buffer);
    expect(await pdfPageCount(join(dir, 'letter.pdf'))).toBe(1);
    const { DocxDocument } = await import('../src/cv/docx/docx-document');
    const text = (await DocxDocument.load((await letters.file(letter.id, 'docx')).buffer)).fullText();
    expect(text).toContain('Alex Example');
    expect(text).toContain('alex@example.com');
    expect(text).toContain('Candidatura per Senior Backend Engineer');

    // ritocco manuale: il testo viene salvato, i file rigenerati, le tecnologie estranee solo segnalate
    const edited = await letters.update(letter.id, { body: `${letter.body}\n\nP.S. Conosco anche Kubernetes.` });
    expect(edited).toMatchObject({ edited: true, hasPdf: true });
    expect(edited.warning).toContain('Kubernetes');
    expect((await DocxDocument.load((await letters.file(letter.id, 'docx')).buffer)).fullText()).toContain('P.S.');
    await expect(letters.update(letter.id, { body: '   ' })).rejects.toThrow(/vuoto/);

    // rigenerare crea una nuova versione; la lettera resta anche se l'annuncio viene eliminato
    const again = await letters.regenerate(letter.id, {});
    expect(again).toMatchObject({ version: 2, language: 'it', userInstructions: 'Tono diretto' });
    for (let i = 0; i < 100 && (await letters.detail(again.id)).status === 'generating'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    expect((await letters.listForJob(job.id)).map((l) => [l.version, l.status])).toEqual([[2, 'ready'], [1, 'ready']]); // prettier-ignore
    await prisma.job.delete({ where: { id: job.id } });
    expect(await letters.detail(letter.id)).toMatchObject({ jobId: null, company: 'Meridian Freight' });
  });

  it('migliora CV: controllo periodico, proposte verificate, stato delle proposte e cose da aggiungere', async () => {
    const settings = await seedSettings(
      prisma,
      testSettings({
        scoring: { llm: { enabled: true, provider: 'ollama', model: 'mock' } },
        cv: { languages: ['en'], extra_skills: 'Kafka' },
      }),
    );
    const baseCvs = new BaseCvService(prisma, settings, storage, gotenberg);
    const base = await baseCvs.upload(upload('cv-one-column-en.docx'), 'en');
    const { structure } = await baseCvs.structure(base.id);
    const byText = (needle: string) => structure.paragraphs.find((p) => p.text.includes(needle))!;
    const summary = byText('Full-stack developer with 6 years');
    const ciBullet = byText('Introduced CI/CD');
    const apiBullet = byText('Built REST APIs');
    const experience = structure.sections.find((x) => x.type === 'experience')!;
    const NEW_SUMMARY =
      'Backend-focused full-stack developer with 6 years of experience building APIs with TypeScript, Node.js and NestJS.';
    const { DocxDocument } = await import('../src/cv/docx/docx-document');
    const activeText = async () => {
      const active = (await baseCvs.slots())[0]!.active!;
      return (await DocxDocument.load((await baseCvs.docx(active.id)).buffer)).fullText();
    };
    const pipeline = new PipelineService(prisma);
    const adapter = fakeAdapter(
      'fake',
      ['1', '2', '3'].map((externalId) =>
        jobInput({
          externalId,
          title: `Backend Engineer ${externalId}`,
          company: `Company ${externalId}`,
          descriptionOriginal: '<p>TypeScript and Node.js services deployed on Kubernetes. Fully remote.</p>',
        }),
      ),
    );
    await pipeline.ingest(adapter, await adapter.fetchJobs({} as never), await settings.get());

    const calls: LlmRequest[] = [];
    const llm = {
      status: (): LlmStatus => ({
        provider: 'mock',
        model: 'mock',
        enabled: true,
        external: false,
        forcedByEnv: false,
        consentGiven: false,
        ready: true,
        notReadyReason: null,
      }),
      completeJson: async (_s: unknown, schema: { parse: (v: unknown) => unknown }, request: LlmRequest) => {
        calls.push(request);
        if (request.task === 'cv_ats') {
          return schema.parse({
            score: '81.6',
            summary: 'Leggibile.',
            categories: [{ name: 'Parole chiave', score: 70, comment: 'c' }],
            issues: [{ severity: 'boh', title: 'Manca Kubernetes', fix: 'Aggiungilo se lo conosci' }],
            keywordsPresent: ['TypeScript'],
            keywordsMissing: ['Kubernetes'],
          });
        }
        return schema.parse({
          summary: 'Buon CV, sommario migliorabile.',
          suggestions: [
            {
              kind: 'rewrite',
              title: 'Rendi il sommario più diretto',
              reason: 'r',
              priority: 'high',
              edit: {
                op: 'replace',
                paragraphId: summary.id,
                newText: NEW_SUMMARY,
                sourceParagraphIds: [summary.id, byText('Backend: Node.js').id],
              },
            },
            {
              kind: 'rewrite',
              title: 'Cita Kubernetes',
              reason: 'r',
              priority: 'high',
              edit: {
                op: 'replace',
                paragraphId: summary.id,
                newText: 'Full-stack developer running Kubernetes clusters.',
                sourceParagraphIds: [summary.id],
              },
            },
            {
              kind: 'remove',
              title: 'Paragrafo inesistente',
              reason: 'r',
              priority: 'low',
              edit: { op: 'remove', paragraphId: 'p9999' },
            },
            { kind: 'rewrite', title: 'Riformula senza dire come', reason: 'r', priority: 'low' },
            {
              kind: 'structure',
              title: 'Metti in evidenza CI/CD',
              reason: 'r',
              priority: 'medium',
              edit: { op: 'reorder', sectionId: experience.id, paragraphIds: [ciBullet.id, apiBullet.id] },
            },
            {
              kind: 'add',
              title: 'Se hai esperienza con Kubernetes, aggiungila',
              reason: 'Richiesta spesso',
              priority: 'medium',
            },
          ],
        });
      },
    };
    const reviews = new CvReviewService(env, prisma, settings, llm as never, baseCvs, storage);

    // il mercato: Kubernetes è richiesto in tutti gli annunci compatibili e non è nel CV
    const before = await reviews.overview();
    expect(before).toMatchObject({ enabled: true, intervalDays: 7, available: true, extraSkills: ['Kafka'] });
    expect(before.languages.map((l) => [l.language, l.review])).toEqual([['en', null]]);
    expect(before.market.find((m) => m.name === 'Kubernetes')).toMatchObject({ jobs: 3 });
    expect(before.market.find((m) => m.name === 'TypeScript')).toBeUndefined();

    // valutazione ATS: in background, salvata sulla versione attiva; al modello vanno i dati tecnici del file
    expect(await reviews.requestAts('en')).toMatchObject({ status: 'running', score: null });
    await expect(reviews.requestAts('fr')).rejects.toThrow(/Nessun CV base/);
    for (let i = 0; i < 100 && (await reviews.overview()).languages[0]!.ats?.status === 'running'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect((await reviews.overview()).languages[0]!.ats).toMatchObject({
      status: 'ready',
      score: 82,
      issues: [{ severity: 'medium', title: 'Manca Kubernetes' }],
      keywordsMissing: ['Kubernetes'],
    });
    const atsCall = calls.find((c) => c.task === 'cv_ats')!;
    expect(atsCall.user).toContain('"paragraphsInTextBoxes": 0');
    expect(atsCall.user).toContain('"emailFound": true');
    expect(atsCall.user).not.toContain('alex@example.com');
    calls.length = 0;

    // controllo periodico: parte perché non ce n'è mai stato uno, poi aspetta l'intervallo
    expect(await reviews.runDue()).toHaveLength(1);
    expect(await reviews.runDue()).toHaveLength(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.task).toBe('cv_review');
    expect(calls[0]!.user).toContain('Kubernetes');
    expect(calls[0]!.user).not.toContain('alex@example.com');
    const review = (await reviews.overview()).languages[0]!.review!;
    expect(review).toMatchObject({ status: 'ready', trigger: 'schedule', outdated: false });
    // scartate: tecnologia non dichiarata, paragrafo inesistente, riformulazione senza modifica
    expect(review.suggestions.map((x) => [x.kind, x.title, x.applicable, x.status])).toEqual([
      ['rewrite', 'Rendi il sommario più diretto', true, 'open'],
      ['structure', 'Metti in evidenza CI/CD', true, 'open'],
      ['add', 'Se hai esperienza con Kubernetes, aggiungila', false, 'open'],
    ]);
    expect(review.suggestions[0]).toMatchObject({
      originalText: summary.text,
      proposedText: NEW_SUMMARY,
      sectionTitle: 'Summary',
    });
    expect(review.suggestions[1]).toMatchObject({
      originalText: `${apiBullet.text}\n${ciBullet.text}`,
      proposedText: `${ciBullet.text}\n${apiBullet.text}`,
    });

    // applica tutte: nasce la versione 2 del CV base, attiva; il file caricato resta com'è
    await expect(reviews.setSuggestionStatus(review.id, 's3', 'applied')).rejects.toThrow(/non si può applicare/);
    const all = await reviews.applyAll(review.id);
    expect(all).toMatchObject({
      applied: 2,
      failed: [],
      warning: null,
      baseCv: { version: 2, isActive: true, pageCount: 1 },
    });
    expect(all.review).toMatchObject({ outdated: false, resultBaseCvId: all.baseCv.id });
    expect(all.review.suggestions.map((x) => x.status)).toEqual(['applied', 'applied', 'open']);
    let text = await activeText();
    expect(text).toContain(NEW_SUMMARY);
    expect(text.indexOf('Introduced CI/CD')).toBeLessThan(text.indexOf('Built REST APIs'));
    expect(text).toContain('Alex Example');
    expect(
      (await storage.read(storage.basePath(base.id, 'original.docx'))).equals(upload('cv-one-column-en.docx').buffer),
    ).toBe(true);
    await expect(reviews.applyAll(review.id)).rejects.toThrow(/Non ci sono proposte/);

    // annullare una proposta rigenera la stessa versione (nessun CV su misura la usa ancora)
    const undone = await reviews.setSuggestionStatus(review.id, 's1', 'open');
    expect(undone).toMatchObject({ applied: 1, baseCv: { id: all.baseCv.id, version: 2 } });
    text = await activeText();
    expect(text).toContain(summary.text);
    expect(text.indexOf('Introduced CI/CD')).toBeLessThan(text.indexOf('Built REST APIs'));
    // annullate tutte: torna attiva la versione di partenza e quella generata sparisce
    const none = await reviews.setSuggestionStatus(review.id, 's2', 'open');
    expect(none).toMatchObject({ applied: 0, baseCv: { id: base.id, version: 1 } });
    expect(none.review.resultBaseCvId).toBeNull();
    // la valutazione ATS appartiene alla versione su cui è stata fatta
    expect((await reviews.overview()).languages[0]!.ats).toMatchObject({ status: 'ready', score: 82 });
    expect((await baseCvs.versions('en')).map((v) => [v.version, v.isActive])).toEqual([[1, true]]);
    // una sola proposta: di nuovo una versione 2
    const one = await reviews.setSuggestionStatus(review.id, 's1', 'applied');
    expect(one).toMatchObject({ applied: 1, baseCv: { version: 2, isActive: true } });
    expect(await activeText()).toContain(NEW_SUMMARY);
    expect((await reviews.overview()).languages[0]!.ats).toBeNull();

    // proposte applicate o ignorate: non vengono riproposte al controllo successivo, passato l'intervallo
    await reviews.setSuggestionStatus(review.id, 's3', 'dismissed');
    expect(await reviews.runDue(new Date(Date.now() + 8 * 86_400_000))).toHaveLength(1);
    expect(calls[1]!.user).toContain('Rendi il sommario più diretto');
    expect(calls[1]!.user).toContain('Se hai esperienza con Kubernetes');
    const second = (await reviews.overview()).languages[0]!.review!;
    expect(second.baseCvId).toBe(one.baseCv.id);
    expect(second.suggestions.map((x) => x.title)).toEqual(['Metti in evidenza CI/CD']);

    // cose da aggiungere nei CV: stesso elenco del Profilo; ciò che dichiari esce dal "mercato"
    const added = await reviews.setExtraSkills(['Kafka', 'Kubernetes', 'kafka']);
    expect(added.extraSkills).toEqual(['Kafka', 'Kubernetes']);
    expect((await settings.get()).cv.extra_skills).toBe('Kafka\nKubernetes');
    expect(added.market.find((m) => m.name === 'Kubernetes')).toBeUndefined();
    // una voce con virgole resta una voce sola
    const phrase = await reviews.setExtraSkills([...added.extraSkills, 'Esperienza con AWS, GCP;  Azure']);
    expect(phrase.extraSkills).toEqual(['Kafka', 'Kubernetes', 'Esperienza con AWS GCP Azure']);

    // disattivato: nessun controllo automatico; a mano si può sempre
    expect(await reviews.updateSchedule({ enabled: false, intervalDays: 14 })).toMatchObject({
      enabled: false,
      intervalDays: 14,
    });
    expect(await reviews.runDue(new Date(Date.now() + 60 * 86_400_000))).toHaveLength(0);
    const manual = await reviews.request('en');
    expect(manual).toHaveLength(1);
    // il controllo chiesto a mano prosegue in background: si attende che finisca
    for (let i = 0; i < 100 && (await reviews.overview()).languages[0]!.review?.status === 'running'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect((await reviews.overview()).languages[0]!.review).toMatchObject({ status: 'ready', trigger: 'manual' });
    // sostituito il CV base, le proposte precedenti risultano superate
    await baseCvs.upload(upload('cv-one-column-en.docx'), 'en');
    expect((await reviews.overview()).languages[0]!.review).toMatchObject({ outdated: true });
  });

  it('provider esterno: senza consenso esplicito la generazione non parte; con il consenso viene salvato', async () => {
    const settings = await seedSettings(
      prisma,
      testSettings({
        scoring: { llm: { enabled: true, provider: 'anthropic', model: 'claude-opus-5-5' } },
        cv: { languages: ['en'] },
      }),
    );
    const baseCvs = new BaseCvService(prisma, settings, storage, gotenberg);
    await baseCvs.upload(upload('cv-one-column-en.docx'), 'en');
    const pipeline = new PipelineService(prisma);
    const adapter = fakeAdapter('fake', [jobInput({ externalId: '1' })]);
    await pipeline.ingest(adapter, await adapter.fetchJobs({} as never), await settings.get());
    const job = await prisma.job.findFirstOrThrow();

    const { LlmService } = await import('../src/llm/llm.service');
    const llm = new LlmService({ ...env, llmProviderOverride: '', anthropicApiKey: 'test-key' });
    const queue = { work: async () => undefined, send: async () => 'q' };
    const generation = new CvGenerationService(
      env,
      prisma,
      settings,
      llm,
      queue as never,
      new ProgressService(),
      storage,
      gotenberg,
      baseCvs,
    );

    expect(await generation.options(job.id)).toMatchObject({
      available: true,
      external: true,
      consentGiven: false,
      provider: 'anthropic',
    });
    await expect(generation.request(job.id, { language: 'en' })).rejects.toMatchObject({
      response: { code: 'consent_required' },
    });
    expect(await prisma.generatedCv.count()).toBe(0);

    await generation.request(job.id, { language: 'en', consentExternal: true });
    expect((await settings.get()).scoring.llm.external_consent).toBe(true);
    expect(await prisma.generatedCv.count()).toBe(1);
  });
});
