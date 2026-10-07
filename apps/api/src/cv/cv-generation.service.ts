import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  cvEditsSchema,
  cvEmailSchema,
  jobAnalysisSchema,
  parseExtraSkills,
  type AppliedCvEdit,
  type CvEdits,
  type CvEmailDto,
  type CvGenerateInfo,
  type CvProgressEvent,
  type CvProgressStep,
  type CvStructure,
  type GeneratedCvDetail,
  type GeneratedCvDto,
  type JobAnalysis,
  type RejectedCvEdit,
  type TechStack,
  extractTechStack,
  flattenTechStack,
} from '@jobagg/shared';
import { defer, from, merge, Observable } from 'rxjs';
import { distinctUntilChanged, map, takeWhile } from 'rxjs/operators';
import { ENV, type Env } from '../config/env';
import { SettingsService } from '../config/settings.service';
import { LlmService } from '../llm/llm.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProgressService } from '../queue/progress.service';
import { QUEUES, QueueService } from '../queue/queue.service';
import { inventedTechnologies, validateEdits } from './anti-invention';
import { applyEditsToDocx } from './apply-edits';
import { BaseCvService } from './base-cv.service';
import { CvStorageService } from './cv-storage.service';
import { GotenbergService } from './gotenberg.service';
import { pdfPageCount, pdfThumbnail, removeQuietly } from './pdf-tools';
import { splitParagraphs } from './cover-letter-docx';
import {
  buildAnalysisPrompt,
  buildCvEditsPrompt,
  buildCvEmailPrompt,
  composeLetterBody,
  describePayload,
} from './prompts';

const MAX_SHORTEN_RETRIES = 2;
/** sotto questa lunghezza una descrizione incollata non basta per adattare un CV */
export const MIN_MANUAL_DESCRIPTION_CHARS = 150;
const WITH_BASE = { baseCv: true } satisfies Prisma.GeneratedCvInclude;
type CvRow = Prisma.GeneratedCvGetPayload<{ include: typeof WITH_BASE }>;

export interface EditChange {
  editId: string;
  status?: 'accepted' | 'rejected';
  manualText?: string | null;
}

export function slug(text: string, max = 40): string {
  return (
    text
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, max)
      .replace(/-+$/, '') || 'x'
  );
}

/** `CV_<Nome>_<Azienda>_<Ruolo>_<lingua>_v<n>` senza caratteri non sicuri. */
export function cvFileName(parts: {
  name: string;
  company: string;
  title: string;
  language: string;
  version: number;
}): string {
  return `CV_${slug(parts.name)}_${slug(parts.company)}_${slug(parts.title)}_${parts.language}_v${parts.version}`;
}

const TERMINAL: CvProgressStep[] = ['ready', 'failed'];

@Injectable()
export class CvGenerationService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CvGenerationService.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly llm: LlmService,
    private readonly queue: QueueService,
    private readonly progress: ProgressService,
    private readonly storage: CvStorageService,
    private readonly gotenberg: GotenbergService,
    private readonly baseCvs: BaseCvService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.work<{ generatedCvId: string }>(QUEUES.cvGenerate, ({ generatedCvId }) =>
      this.process(generatedCvId),
    );
  }

  // ── richiesta ─────────────────────────────────────────────────────────────────

  /** Cosa serve sapere prima di generare: lingue disponibili, provider, consenso, dati inviati. */
  async options(jobId: string): Promise<CvGenerateInfo> {
    const job = await this.prisma.job.findUnique({ where: { id: jobId }, select: { language: true } });
    if (!job) throw new NotFoundException('Annuncio non trovato');
    return this.optionsFor(job.language);
  }

  /** Come `options`, per un CV da descrizione incollata: la lingua non è ancora nota. */
  manualOptions(): Promise<CvGenerateInfo> {
    return this.optionsFor(null);
  }

  private async optionsFor(jobLanguage: string | null): Promise<CvGenerateInfo> {
    const job = { language: jobLanguage };
    const settings = await this.settings.get();
    const status = this.llm.status(settings);
    const languages = await this.baseCvs.availableLanguages();
    // il consenso mancante non rende l'azione indisponibile: viene chiesto nel dialog
    const onlyConsentMissing = !status.ready && status.enabled && status.external && !status.consentGiven;
    let reason: string | null = null;
    if (languages.length === 0) reason = 'Carica almeno un CV base (DOCX) nella scheda CV del Profilo';
    if (!status.ready && !onlyConsentMissing) reason = status.notReadyReason;
    return {
      available: reason === null,
      reason,
      languages,
      detectedLanguage: job.language,
      // lingua dell'annuncio se esiste un CV base in quella lingua, altrimenti la prima disponibile
      suggestedLanguage: job.language && languages.includes(job.language) ? job.language : (languages[0] ?? null),
      provider: status.provider,
      model: status.model,
      external: status.external,
      consentGiven: status.consentGiven,
      payloadSummary: describePayload(parseExtraSkills(settings.cv.extra_skills).length > 0, true),
    };
  }

  async request(
    jobId: string,
    input: { language: string; instructions?: string; consentExternal?: boolean },
  ): Promise<{ generatedCvId: string; queueJobId: string | null }> {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Annuncio non trovato');
    const last = await this.prisma.generatedCv.findFirst({ where: { jobId }, orderBy: { version: 'desc' } });
    return this.enqueue(input, {
      jobId,
      jobTitle: job.title,
      company: job.company,
      descriptionText: null,
      version: (last?.version ?? 0) + 1,
    });
  }

  /** CV su misura da una descrizione incollata a mano, senza un annuncio raccolto. */
  async requestManual(input: {
    title: string;
    company: string;
    description: string;
    language: string;
    instructions?: string;
    consentExternal?: boolean;
  }): Promise<{ generatedCvId: string; queueJobId: string | null }> {
    const jobTitle = input.title.trim();
    const company = input.company.trim();
    const descriptionText = input.description.trim();
    if (!jobTitle || !company) throw new BadRequestException('Servono il ruolo e l’azienda');
    if (descriptionText.length < MIN_MANUAL_DESCRIPTION_CHARS) {
      throw new BadRequestException(
        `La descrizione è troppo corta: incolla il testo dell’annuncio (almeno ${MIN_MANUAL_DESCRIPTION_CHARS} caratteri)`,
      );
    }
    // le versioni si contano tra i CV manuali per lo stesso ruolo e la stessa azienda
    const last = await this.prisma.generatedCv.findFirst({
      where: { jobId: null, descriptionText: { not: null }, jobTitle, company },
      orderBy: { version: 'desc' },
    });
    return this.enqueue(input, { jobId: null, jobTitle, company, descriptionText, version: (last?.version ?? 0) + 1 });
  }

  /** CV generati da una descrizione incollata, dal più recente. */
  async listManual(): Promise<GeneratedCvDto[]> {
    const rows = await this.prisma.generatedCv.findMany({
      where: { jobId: null, descriptionText: { not: null } },
      include: WITH_BASE,
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return rows.map((r) => this.toDto(r));
  }

  private async enqueue(
    input: { language: string; instructions?: string; consentExternal?: boolean },
    target: {
      jobId: string | null;
      jobTitle: string;
      company: string;
      descriptionText: string | null;
      version: number;
    },
  ): Promise<{ generatedCvId: string; queueJobId: string | null }> {
    let settings = await this.settings.get();
    let status = this.llm.status(settings);

    // provider esterno: serve un consenso esplicito, che viene salvato nelle impostazioni
    if (status.enabled && status.external && !status.consentGiven) {
      if (!input.consentExternal) {
        throw new ConflictException({
          message: `Il CV verrà inviato a un provider esterno (${status.provider}): serve il tuo consenso esplicito`,
          code: 'consent_required',
        });
      }
      const next = structuredClone(settings);
      next.scoring.llm.external_consent = true;
      settings = (await this.settings.save(next, 'consent')).settings;
      status = this.llm.status(settings);
    }
    if (!status.ready) throw new ConflictException(status.notReadyReason ?? 'LLM non disponibile');

    const baseCv = await this.baseCvs.activeFor(input.language);
    if (!baseCv) throw new BadRequestException(`Nessun CV base caricato per la lingua "${input.language}"`);

    const created = await this.prisma.generatedCv.create({
      data: {
        ...target,
        baseCvId: baseCv.id,
        language: input.language,
        status: 'queued',
        step: 'queued',
        userInstructions: input.instructions?.trim() || null,
        provider: status.provider,
        model: status.model,
      },
    });
    const queueJobId = await this.queue.send(QUEUES.cvGenerate, { generatedCvId: created.id });
    return { generatedCvId: created.id, queueJobId };
  }

  /** Rigenera con nuove istruzioni: crea una nuova versione per lo stesso annuncio. */
  async regenerate(id: string, input: { language?: string; instructions?: string; consentExternal?: boolean }) {
    const cv = await this.prisma.generatedCv.findUnique({ where: { id } });
    if (!cv) throw new NotFoundException('CV generato non trovato');
    if (!cv.jobId && cv.descriptionText) {
      return this.requestManual({
        title: cv.jobTitle,
        company: cv.company,
        description: cv.descriptionText,
        language: input.language ?? cv.language,
        instructions: input.instructions ?? cv.userInstructions ?? undefined,
        consentExternal: input.consentExternal,
      });
    }
    if (!cv.jobId) throw new ConflictException('L’annuncio di questo CV non esiste più: non si può rigenerare');
    return this.request(cv.jobId, {
      language: input.language ?? cv.language,
      instructions: input.instructions ?? cv.userInstructions ?? undefined,
      consentExternal: input.consentExternal,
    });
  }

  // ── elaborazione in coda ──────────────────────────────────────────────────────

  private async step(id: string, step: CvProgressStep, message?: string): Promise<void> {
    await this.prisma.generatedCv.update({
      where: { id },
      data: { step, status: step === 'ready' ? 'ready' : step === 'failed' ? 'failed' : 'running' },
    });
    this.progress.emit({ generatedCvId: id, step, message });
  }

  async process(id: string): Promise<void> {
    const cv = await this.prisma.generatedCv.findUnique({ where: { id }, include: { baseCv: true, job: true } });
    if (!cv || cv.status === 'ready') return;
    try {
      if (!cv.job && !cv.descriptionText) throw new Error('L’annuncio non esiste più');
      const settings = await this.settings.get();
      const structure = cv.baseCv.structure as unknown as CvStructure;
      const extraSkills = parseExtraSkills(settings.cv.extra_skills);
      // senza annuncio raccolto vale la descrizione incollata: lo stack si ricava dal testo
      const job = cv.job
        ? {
            title: cv.job.title,
            company: cv.job.company,
            descriptionText: cv.job.descriptionText,
            seniority: cv.job.seniority,
            techStack: cv.job.techStack as unknown as TechStack,
          }
        : {
            title: cv.jobTitle,
            company: cv.company,
            descriptionText: cv.descriptionText ?? '',
            seniority: 'unknown',
            techStack: extractTechStack({ title: cv.jobTitle, description: cv.descriptionText ?? '', tags: [] }),
          };

      await this.step(id, 'analysis', 'Analisi dell’annuncio');
      const analysis: JobAnalysis = await this.llm.completeJson(settings, jobAnalysisSchema, {
        task: 'analysis',
        ...buildAnalysisPrompt(job),
        maxTokens: 8000,
      });
      await this.prisma.generatedCv.update({
        where: { id },
        data: { analysis: analysis as unknown as Prisma.InputJsonValue },
      });

      let shortenBecause: { pages: number; maxPages: number } | undefined;
      let warning: string | null = null;
      for (let attempt = 0; attempt <= MAX_SHORTEN_RETRIES; attempt++) {
        await this.step(id, 'adaptation', attempt === 0 ? 'Adattamento dei contenuti' : 'Versione più sintetica');
        const proposal: CvEdits = await this.llm.completeJson(settings, cvEditsSchema, {
          task: 'cv_edits',
          ...buildCvEditsPrompt({
            language: cv.language,
            job,
            analysis,
            structure,
            extraSkills,
            userInstructions: cv.userInstructions ?? undefined,
            shortenBecause,
          }),
          maxTokens: 32000,
          mockContext: { structure, jobTech: flattenTechStack(job.techStack) },
        });
        const { accepted, rejected } = validateEdits(proposal.edits, { structure, extraSkills, language: cv.language });

        await this.step(id, 'layout', 'Impaginazione');
        const built = await this.build(cv, accepted, rejected, structure, extraSkills, () =>
          this.step(id, 'preview', 'Anteprima'),
        );
        await this.prisma.generatedCv.update({
          where: { id },
          data: {
            edits: built.edits as unknown as Prisma.InputJsonValue,
            rejectedEdits: built.rejected as unknown as Prisma.InputJsonValue,
            manualEdits: {},
            gaps: proposal.gaps as unknown as Prisma.InputJsonValue,
            matchSummary: proposal.matchSummary as unknown as Prisma.InputJsonValue,
            docxPath: built.docxPath,
            pdfPath: built.pdfPath,
            pageCount: built.pageCount,
            warning: built.warning,
          },
        });
        warning = built.warning;
        if (built.pageCount <= cv.baseCv.pageCount || cv.baseCv.pageCount === 0) break;
        shortenBecause = { pages: built.pageCount, maxPages: cv.baseCv.pageCount };
        if (attempt === MAX_SHORTEN_RETRIES) {
          // dopo due tentativi non si forza: il problema viene segnalato all'utente
          warning = `Il CV generato occupa ${built.pageCount} pagine contro ${cv.baseCv.pageCount} del CV base anche dopo ${MAX_SHORTEN_RETRIES} tentativi di sintesi: rifiuta qualche modifica, accorcia a mano o rigenera con istruzioni più precise.`;
          await this.prisma.generatedCv.update({ where: { id }, data: { warning } });
        }
      }
      await this.step(id, 'ready', warning ?? undefined);
    } catch (err) {
      const message = (err as Error).message.slice(0, 1000);
      this.logger.error(`Generazione CV ${id} fallita: ${message}`);
      await this.prisma.generatedCv.update({
        where: { id },
        data: { status: 'failed', step: 'failed', error: message },
      });
      this.progress.emit({ generatedCvId: id, step: 'failed', message });
    }
  }

  /** Applica le modifiche al DOCX base, converte in PDF e conta le pagine. */
  private async build(
    cv: CvRow,
    edits: AppliedCvEdit[],
    rejected: RejectedCvEdit[],
    structure: CvStructure,
    extraSkills: string[],
    onPreview?: () => Promise<void>,
  ) {
    const baseDocx = await this.storage.read(cv.baseCv.docxPath);
    const applied = await applyEditsToDocx(baseDocx, edits);
    // ciò che il documento non ha potuto ricevere passa tra gli scarti, con il motivo
    const failedIds = new Set(applied.failed.map((f) => f.editId));
    const kept = edits.filter((e) => !failedIds.has(e.id));
    const allRejected = [
      ...rejected,
      ...applied.failed.map((f) => {
        const { id: _id, status: _status, manualText: _manual, ...edit } = edits.find((e) => e.id === f.editId)!;
        return { edit, reason: f.reason };
      }),
    ];

    const docxPath = this.storage.generatedPath(cv.id, 'cv.docx');
    await this.storage.write(docxPath, applied.buffer);
    if (onPreview) await onPreview();
    const pdf = await this.gotenberg.docxToPdf(applied.buffer, 'cv.docx');
    const pdfPath = this.storage.generatedPath(cv.id, 'cv.pdf');
    await this.storage.write(pdfPath, pdf);
    const pageCount = await pdfPageCount(this.storage.absolute(pdfPath));
    await removeQuietly(this.storage.absolute(this.storage.generatedPath(cv.id, 'thumbs')));

    const notes: string[] = [];
    // i ritocchi manuali sono sotto la responsabilità dell'utente: si segnala soltanto
    const invented = inventedTechnologies(applied.finalText, structure, extraSkills);
    if (invented.length > 0)
      notes.push(`Il testo contiene tecnologie non presenti nel CV base: ${invented.join(', ')}.`);
    if (cv.baseCv.pageCount > 0 && pageCount > cv.baseCv.pageCount) {
      notes.push(`Il CV occupa ${pageCount} pagine contro ${cv.baseCv.pageCount} del CV base.`);
    }
    return { edits: kept, rejected: allRejected, docxPath, pdfPath, pageCount, warning: notes.join(' ') || null };
  }

  // ── lettura ───────────────────────────────────────────────────────────────────

  private toDto(cv: CvRow): GeneratedCvDto {
    const structure = cv.baseCv.structure as unknown as CvStructure;
    return {
      id: cv.id,
      jobId: cv.jobId,
      baseCvId: cv.baseCvId,
      language: cv.language,
      version: cv.version,
      status: cv.status as GeneratedCvDto['status'],
      step: cv.step as CvProgressStep,
      error: cv.error,
      warning: cv.warning,
      userInstructions: cv.userInstructions,
      provider: cv.provider,
      model: cv.model,
      jobTitle: cv.jobTitle,
      company: cv.company,
      manual: !cv.jobId && !!cv.descriptionText,
      pageCount: cv.pageCount,
      basePageCount: cv.baseCv.pageCount,
      createdAt: cv.createdAt.toISOString(),
      fileName: cvFileName({
        name: structure.candidateName || 'CV',
        company: cv.company,
        title: cv.jobTitle,
        language: cv.language,
        version: cv.version,
      }),
    };
  }

  private async load(id: string): Promise<CvRow> {
    const cv = await this.prisma.generatedCv.findUnique({ where: { id }, include: WITH_BASE });
    if (!cv) throw new NotFoundException('CV generato non trovato');
    return cv;
  }

  async listForJob(jobId: string): Promise<GeneratedCvDto[]> {
    const rows = await this.prisma.generatedCv.findMany({
      where: { jobId },
      include: WITH_BASE,
      orderBy: { version: 'desc' },
    });
    return rows.map((r) => this.toDto(r));
  }

  async detail(id: string): Promise<GeneratedCvDetail> {
    const cv = await this.load(id);
    const structure = cv.baseCv.structure as unknown as CvStructure;
    const edits = cv.edits as unknown as AppliedCvEdit[];
    const sectionTitle = new Map(structure.sections.map((s) => [s.id, s.title]));
    const originals: GeneratedCvDetail['originals'] = {};
    const touch = (paragraphId: string) => {
      const p = structure.paragraphs.find((x) => x.id === paragraphId);
      if (p)
        originals[p.id] = { text: p.text, sectionId: p.sectionId, sectionTitle: sectionTitle.get(p.sectionId) ?? '' };
    };
    for (const edit of edits) {
      if (edit.op === 'replace' || edit.op === 'remove') touch(edit.paragraphId);
      else if (edit.op === 'insert_after') touch(edit.afterParagraphId);
      else edit.paragraphIds.forEach(touch);
    }
    const application = await this.prisma.application.findFirst({ where: { generatedCvId: id }, select: { id: true } });
    return {
      ...this.toDto(cv),
      edits,
      rejectedEdits: cv.rejectedEdits as unknown as RejectedCvEdit[],
      manualEdits: cv.manualEdits as unknown as Record<string, string>,
      gaps: cv.gaps as unknown as CvEdits['gaps'],
      matchSummary: { covered: [], partiallyCovered: [], missing: [], ...(cv.matchSummary as object) },
      originals,
      applicationId: application?.id ?? null,
      descriptionText: cv.jobId ? null : cv.descriptionText,
      email: (cv.email as unknown as CvEmailDto | null) ?? null,
    };
  }

  /** Avanzamento per Server-Sent Events: prima lo stato corrente, poi gli eventi in tempo reale. */
  events(id: string): Observable<{ data: CvProgressEvent }> {
    const current = defer(() =>
      from(
        this.prisma.generatedCv
          .findUnique({ where: { id }, select: { step: true, error: true, warning: true } })
          .then((cv): CvProgressEvent =>
            cv
              ? { generatedCvId: id, step: cv.step as CvProgressStep, message: cv.error ?? cv.warning ?? undefined }
              : { generatedCvId: id, step: 'failed', message: 'CV generato non trovato' },
          ),
      ),
    );
    return merge(this.progress.forCv(id), current).pipe(
      distinctUntilChanged((a, b) => a.step === b.step && a.message === b.message),
      takeWhile((event) => !TERMINAL.includes(event.step), true),
      map((event) => ({ data: event })),
    );
  }

  // ── revisione dell'utente ─────────────────────────────────────────────────────

  /** Accetta/rifiuta/ritocca singole modifiche e rigenera DOCX e PDF. */
  async patchEdits(id: string, changes: EditChange[]): Promise<GeneratedCvDetail> {
    const cv = await this.load(id);
    if (cv.status !== 'ready') throw new ConflictException('Il CV non è ancora pronto');
    const edits = cv.edits as unknown as AppliedCvEdit[];
    const manualEdits = { ...(cv.manualEdits as unknown as Record<string, string>) };
    for (const change of changes) {
      const edit = edits.find((e) => e.id === change.editId);
      if (!edit) throw new BadRequestException(`Modifica ${change.editId} inesistente`);
      if (change.status) edit.status = change.status;
      if (change.manualText !== undefined) {
        if (edit.op !== 'replace' && edit.op !== 'insert_after') {
          throw new BadRequestException('Il testo si può ritoccare solo nelle modifiche di sostituzione o inserimento');
        }
        const text = change.manualText?.trim();
        if (text && text !== edit.newText) {
          edit.manualText = text.slice(0, 2000);
          manualEdits[edit.id] = edit.manualText;
        } else {
          delete edit.manualText;
          delete manualEdits[edit.id];
        }
      }
    }
    const settings = await this.settings.get();
    const structure = cv.baseCv.structure as unknown as CvStructure;
    const built = await this.build(
      cv,
      edits,
      cv.rejectedEdits as unknown as RejectedCvEdit[],
      structure,
      parseExtraSkills(settings.cv.extra_skills),
    );
    // una modifica che il documento rifiuta in questa combinazione resta nell'elenco, segnata come rifiutata
    const keptIds = new Set(built.edits.map((e) => e.id));
    const next = edits.map((e) => (keptIds.has(e.id) ? e : { ...e, status: 'rejected' as const }));
    await this.prisma.generatedCv.update({
      where: { id },
      data: {
        edits: next as unknown as Prisma.InputJsonValue,
        manualEdits: manualEdits as unknown as Prisma.InputJsonValue,
        docxPath: built.docxPath,
        pdfPath: built.pdfPath,
        pageCount: built.pageCount,
        warning: built.warning,
      },
    });
    return this.detail(id);
  }

  // ── email di accompagnamento ──────────────────────────────────────────────────

  private emailWarning(text: string, structure: CvStructure, extraSkills: string[]): string | null {
    const invented = inventedTechnologies(text, structure, extraSkills);
    return invented.length > 0
      ? `L’email cita tecnologie non presenti nel tuo CV: ${invented.join(', ')}. Controlla che non ti attribuisca competenze che non hai.`
      : null;
  }

  /**
   * Scrive il testo dell'email con cui inviare questo CV in allegato: breve, nella lingua del CV,
   * solo con fatti presenti nel CV base. Riscriverla sostituisce la precedente.
   */
  async generateEmail(id: string, input: { instructions?: string } = {}): Promise<GeneratedCvDetail> {
    const cv = await this.prisma.generatedCv.findUnique({ where: { id }, include: { baseCv: true, job: true } });
    if (!cv) throw new NotFoundException('CV generato non trovato');
    if (cv.status !== 'ready') throw new ConflictException('Il CV non è ancora pronto');
    const descriptionText = cv.job?.descriptionText ?? cv.descriptionText;
    if (!descriptionText)
      throw new ConflictException('L’annuncio di questo CV non esiste più: non si può scrivere l’email');
    const settings = await this.settings.get();
    const status = this.llm.status(settings);
    if (!status.ready) throw new ConflictException(status.notReadyReason ?? 'LLM non disponibile');

    const structure = cv.baseCv.structure as unknown as CvStructure;
    const extraSkills = parseExtraSkills(settings.cv.extra_skills);
    const job = {
      title: cv.jobTitle,
      company: cv.company,
      descriptionText,
      seniority: cv.job?.seniority ?? 'unknown',
      techStack: cv.job
        ? (cv.job.techStack as unknown as TechStack)
        : extractTechStack({ title: cv.jobTitle, description: descriptionText, tags: [] }),
    };
    const instructions = input.instructions?.trim() || null;

    let subject = '';
    let body = '';
    let invented: string[] = [];
    // se la prima proposta cita tecnologie assenti dal CV si chiede una seconda stesura
    for (let attempt = 0; attempt < 2; attempt++) {
      const draft = await this.llm.completeJson(settings, cvEmailSchema, {
        task: 'cv_email',
        ...buildCvEmailPrompt({
          language: cv.language,
          job,
          structure,
          extraSkills,
          userInstructions: instructions ?? undefined,
          inventedTechnologies: invented.length > 0 ? invented : undefined,
        }),
        maxTokens: 4000,
        mockContext: { title: job.title, company: job.company },
      });
      subject = draft.subject.trim();
      body = composeLetterBody(draft, structure.candidateName);
      invented = inventedTechnologies(`${subject}\n${body}`, structure, extraSkills);
      if (invented.length === 0) break;
    }
    const email: CvEmailDto = {
      subject,
      body,
      warning: this.emailWarning(`${subject}\n${body}`, structure, extraSkills),
      edited: false,
      instructions,
      model: status.model,
      createdAt: new Date().toISOString(),
    };
    await this.prisma.generatedCv.update({ where: { id }, data: { email: email as unknown as Prisma.InputJsonValue } });
    return this.detail(id);
  }

  /** Ritocchi a mano dell'utente al testo dell'email. */
  async updateEmail(id: string, input: { subject?: string; body?: string }): Promise<GeneratedCvDetail> {
    const cv = await this.load(id);
    const current = cv.email as unknown as CvEmailDto | null;
    if (!current) throw new ConflictException('L’email non è ancora stata scritta');
    const subject = input.subject !== undefined ? input.subject.trim() : current.subject;
    const body = input.body !== undefined ? splitParagraphs(input.body).join('\n\n') : current.body;
    if (!body) throw new BadRequestException('Il testo dell’email non può essere vuoto');
    const settings = await this.settings.get();
    const email: CvEmailDto = {
      ...current,
      subject,
      body,
      edited: current.edited || subject !== current.subject || body !== current.body,
      // i ritocchi manuali sono sotto la responsabilità dell'utente: si segnala soltanto
      warning: this.emailWarning(
        `${subject}\n${body}`,
        cv.baseCv.structure as unknown as CvStructure,
        parseExtraSkills(settings.cv.extra_skills),
      ),
    };
    await this.prisma.generatedCv.update({ where: { id }, data: { email: email as unknown as Prisma.InputJsonValue } });
    return this.detail(id);
  }

  async file(id: string, kind: 'pdf' | 'docx'): Promise<{ buffer: Buffer; fileName: string }> {
    const cv = await this.load(id);
    const path = kind === 'pdf' ? cv.pdfPath : cv.docxPath;
    if (!path) throw new NotFoundException('File non ancora disponibile');
    return { buffer: await this.storage.read(path), fileName: `${this.toDto(cv).fileName}.${kind}` };
  }

  async thumbnail(id: string, page: number): Promise<Buffer> {
    const cv = await this.load(id);
    if (!cv.pdfPath || !cv.pageCount) throw new NotFoundException('Anteprima non ancora disponibile');
    if (!Number.isInteger(page) || page < 1 || page > cv.pageCount) throw new NotFoundException('Pagina inesistente');
    const cached = this.storage.generatedPath(cv.id, `thumbs/page-${page}.png`);
    try {
      return await this.storage.read(cached);
    } catch {
      await this.storage.ensureDir(this.storage.generatedPath(cv.id, 'thumbs'));
      const outBase = this.storage.absolute(cached).replace(/\.png$/, '');
      return pdfThumbnail(this.storage.absolute(cv.pdfPath), page, outBase);
    }
  }

  /** All'avvio: le generazioni rimaste a metà per un riavvio vengono chiuse con un errore chiaro. */
  async closeInterrupted(): Promise<void> {
    if (this.env.cliMode) return;
    await this.prisma.generatedCv.updateMany({
      where: { status: 'running' },
      data: {
        status: 'failed',
        step: 'failed',
        error: 'Generazione interrotta dal riavvio dell’applicazione: rigenera il CV',
      },
    });
  }
}
