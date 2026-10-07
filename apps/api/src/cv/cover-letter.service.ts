import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  coverLetterSchema,
  parseExtraSkills,
  type CoverLetterDto,
  type CvGenerateInfo,
  type CvStructure,
  type TechStack,
} from '@jobagg/shared';
import { ENV, type Env } from '../config/env';
import { SettingsService } from '../config/settings.service';
import { LlmService } from '../llm/llm.service';
import { PrismaService } from '../prisma/prisma.service';
import { inventedTechnologies } from './anti-invention';
import { BaseCvService } from './base-cv.service';
import { buildCoverLetterDocx, contactLine, splitParagraphs } from './cover-letter-docx';
import { slug } from './cv-generation.service';
import { CvStorageService } from './cv-storage.service';
import { GotenbergService } from './gotenberg.service';
import { buildCoverLetterPrompt, composeLetterBody, describeLetterPayload } from './prompts';

const WITH_BASE = { baseCv: true } satisfies Prisma.CoverLetterInclude;
type LetterRow = Prisma.CoverLetterGetPayload<{ include: typeof WITH_BASE }>;

export interface CoverLetterRequest {
  language: string;
  instructions?: string;
  consentExternal?: boolean;
}

/** `Lettera_<Nome>_<Azienda>_<Ruolo>_<lingua>_v<n>` senza caratteri non sicuri. */
export function letterFileName(parts: {
  name: string;
  company: string;
  title: string;
  language: string;
  version: number;
}): string {
  return `Lettera_${slug(parts.name)}_${slug(parts.company)}_${slug(parts.title)}_${parts.language}_v${parts.version}`;
}

function longDate(language: string): string {
  try {
    return new Intl.DateTimeFormat(language, { dateStyle: 'long' }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/**
 * Lettera di candidatura su misura per un annuncio: l'LLM la scrive a partire dai contenuti del CV base,
 * l'utente può ritoccare il testo e scaricarla in PDF o DOCX.
 */
@Injectable()
export class CoverLetterService {
  private readonly logger = new Logger(CoverLetterService.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly llm: LlmService,
    private readonly storage: CvStorageService,
    private readonly gotenberg: GotenbergService,
    private readonly baseCvs: BaseCvService,
  ) {}

  // ── richiesta ─────────────────────────────────────────────────────────────────

  /**
   * La lettera si può scrivere in ogni lingua abilitata nel Profilo: i fatti vengono presi dal CV base
   * di quella lingua o, se manca, dal primo CV base disponibile.
   */
  async options(jobId: string): Promise<CvGenerateInfo> {
    const job = await this.prisma.job.findUnique({ where: { id: jobId }, select: { language: true } });
    if (!job) throw new NotFoundException('Annuncio non trovato');
    const settings = await this.settings.get();
    const status = this.llm.status(settings);
    const withCv = await this.baseCvs.availableLanguages();
    const languages: string[] = withCv.length > 0 ? settings.cv.languages : [];
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
      suggestedLanguage: job.language && languages.includes(job.language) ? job.language : (withCv[0] ?? null),
      provider: status.provider,
      model: status.model,
      external: status.external,
      consentGiven: status.consentGiven,
      payloadSummary: describeLetterPayload(parseExtraSkills(settings.cv.extra_skills).length > 0),
    };
  }

  async request(jobId: string, input: CoverLetterRequest): Promise<CoverLetterDto> {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Annuncio non trovato');
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

    if (!(settings.cv.languages as string[]).includes(input.language)) {
      throw new BadRequestException(`Lingua "${input.language}" non abilitata nella scheda CV del Profilo`);
    }
    const fallback = (await this.baseCvs.availableLanguages())[0];
    const baseCv =
      (await this.baseCvs.activeFor(input.language)) ?? (fallback ? await this.baseCvs.activeFor(fallback) : null);
    if (!baseCv) throw new BadRequestException('Nessun CV base caricato: aggiungine uno nella scheda CV del Profilo');

    const last = await this.prisma.coverLetter.findFirst({ where: { jobId }, orderBy: { version: 'desc' } });
    const created = await this.prisma.coverLetter.create({
      data: {
        jobId,
        baseCvId: baseCv.id,
        language: input.language,
        version: (last?.version ?? 0) + 1,
        userInstructions: input.instructions?.trim() || null,
        provider: status.provider,
        model: status.model,
        jobTitle: job.title,
        company: job.company,
      },
      include: WITH_BASE,
    });
    void this.generate(created.id);
    return this.toDto(created);
  }

  /** Riscrive la lettera con nuove istruzioni: crea una nuova versione per lo stesso annuncio. */
  async regenerate(id: string, input: Partial<CoverLetterRequest>): Promise<CoverLetterDto> {
    const letter = await this.load(id);
    if (!letter.jobId)
      throw new ConflictException('L’annuncio di questa lettera non esiste più: non si può rigenerare');
    return this.request(letter.jobId, {
      language: input.language ?? letter.language,
      instructions: input.instructions ?? letter.userInstructions ?? undefined,
      consentExternal: input.consentExternal,
    });
  }

  // ── generazione ───────────────────────────────────────────────────────────────

  /** Eseguita in background dopo la richiesta: non lancia mai, l'esito finisce nello stato della lettera. */
  async generate(id: string): Promise<void> {
    try {
      const letter = await this.prisma.coverLetter.findUnique({ where: { id }, include: { baseCv: true, job: true } });
      if (!letter || letter.status !== 'generating') return;
      if (!letter.job) throw new Error('L’annuncio non esiste più');
      const settings = await this.settings.get();
      const structure = letter.baseCv.structure as unknown as CvStructure;
      const extraSkills = parseExtraSkills(settings.cv.extra_skills);
      const job = {
        title: letter.job.title,
        company: letter.job.company,
        descriptionText: letter.job.descriptionText,
        seniority: letter.job.seniority,
        techStack: letter.job.techStack as unknown as TechStack,
      };

      let subject = '';
      let body = '';
      let invented: string[] = [];
      // se la prima proposta cita tecnologie assenti dal CV si chiede una seconda stesura
      for (let attempt = 0; attempt < 2; attempt++) {
        const draft = await this.llm.completeJson(settings, coverLetterSchema, {
          task: 'cover_letter',
          ...buildCoverLetterPrompt({
            language: letter.language,
            job,
            structure,
            extraSkills,
            userInstructions: letter.userInstructions ?? undefined,
            inventedTechnologies: invented.length > 0 ? invented : undefined,
          }),
          maxTokens: 8000,
          mockContext: { title: job.title, company: job.company },
        });
        subject = draft.subject.trim();
        body = composeLetterBody(draft, structure.candidateName);
        invented = inventedTechnologies(`${subject}\n${body}`, structure, extraSkills);
        if (invented.length === 0) break;
      }

      const files = await this.build(letter, subject, body);
      await this.prisma.coverLetter.update({
        where: { id },
        data: {
          status: 'ready',
          subject,
          body,
          edited: false,
          ...files.paths,
          warning: this.warning(invented, files.error),
        },
      });
    } catch (err) {
      const message = (err as Error).message.slice(0, 1000);
      this.logger.error(`Generazione lettera ${id} fallita: ${message}`);
      await this.prisma.coverLetter
        .update({ where: { id }, data: { status: 'failed', error: message } })
        .catch(() => undefined);
    }
  }

  private warning(invented: string[], conversionError: string | null): string | null {
    const notes: string[] = [];
    if (invented.length > 0) {
      notes.push(
        `La lettera cita tecnologie non presenti nel tuo CV: ${invented.join(', ')}. Controlla che non ti attribuisca competenze che non hai.`,
      );
    }
    if (conversionError)
      notes.push(`PDF e DOCX non generati (${conversionError}): salva di nuovo il testo per riprovare.`);
    return notes.join(' ') || null;
  }

  /**
   * Impagina la lettera in DOCX e la converte in PDF. Se la conversione non riesce il testo resta
   * comunque disponibile: l'errore viene riportato come avviso.
   */
  private async build(
    letter: LetterRow,
    subject: string,
    body: string,
  ): Promise<{ paths: { docxPath: string | null; pdfPath: string | null }; error: string | null }> {
    const structure = letter.baseCv.structure as unknown as CvStructure;
    try {
      const docx = await buildCoverLetterDocx({
        candidateName: structure.candidateName,
        contacts: contactLine(structure),
        date: longDate(letter.language),
        company: letter.company,
        subject,
        body,
      });
      const pdf = await this.gotenberg.docxToPdf(docx, 'letter.docx');
      const docxPath = this.storage.letterPath(letter.id, 'letter.docx');
      const pdfPath = this.storage.letterPath(letter.id, 'letter.pdf');
      await this.storage.write(docxPath, docx);
      await this.storage.write(pdfPath, pdf);
      return { paths: { docxPath, pdfPath }, error: null };
    } catch (err) {
      const message = (err as Error).message.slice(0, 300);
      this.logger.warn(`Impaginazione lettera ${letter.id} fallita: ${message}`);
      return { paths: { docxPath: null, pdfPath: null }, error: message };
    }
  }

  // ── lettura e revisione ───────────────────────────────────────────────────────

  private toDto(letter: LetterRow): CoverLetterDto {
    const structure = letter.baseCv.structure as unknown as CvStructure;
    return {
      id: letter.id,
      jobId: letter.jobId,
      language: letter.language,
      version: letter.version,
      status: letter.status as CoverLetterDto['status'],
      error: letter.error,
      warning: letter.warning,
      userInstructions: letter.userInstructions,
      provider: letter.provider,
      model: letter.model,
      jobTitle: letter.jobTitle,
      company: letter.company,
      subject: letter.subject,
      body: letter.body,
      edited: letter.edited,
      hasPdf: !!letter.pdfPath,
      createdAt: letter.createdAt.toISOString(),
      updatedAt: letter.updatedAt.toISOString(),
      fileName: letterFileName({
        name: structure.candidateName || 'Lettera',
        company: letter.company,
        title: letter.jobTitle,
        language: letter.language,
        version: letter.version,
      }),
    };
  }

  private async load(id: string): Promise<LetterRow> {
    const letter = await this.prisma.coverLetter.findUnique({ where: { id }, include: WITH_BASE });
    if (!letter) throw new NotFoundException('Lettera di candidatura non trovata');
    return letter;
  }

  async listForJob(jobId: string): Promise<CoverLetterDto[]> {
    const rows = await this.prisma.coverLetter.findMany({
      where: { jobId },
      include: WITH_BASE,
      orderBy: { version: 'desc' },
    });
    return rows.map((r) => this.toDto(r));
  }

  async detail(id: string): Promise<CoverLetterDto> {
    return this.toDto(await this.load(id));
  }

  /** Ritocchi a mano dell'utente: salva il testo e rigenera DOCX e PDF. */
  async update(id: string, input: { subject?: string; body?: string }): Promise<CoverLetterDto> {
    const letter = await this.load(id);
    if (letter.status !== 'ready') throw new ConflictException('La lettera non è ancora pronta');
    const subject = input.subject !== undefined ? input.subject.trim() : letter.subject;
    const body = input.body !== undefined ? splitParagraphs(input.body).join('\n\n') : letter.body;
    if (!body) throw new BadRequestException('Il testo della lettera non può essere vuoto');

    const settings = await this.settings.get();
    const structure = letter.baseCv.structure as unknown as CvStructure;
    // i ritocchi manuali sono sotto la responsabilità dell'utente: si segnala soltanto
    const invented = inventedTechnologies(`${subject}\n${body}`, structure, parseExtraSkills(settings.cv.extra_skills));
    const files = await this.build(letter, subject, body);
    const updated = await this.prisma.coverLetter.update({
      where: { id },
      data: {
        subject,
        body,
        edited: letter.edited || subject !== letter.subject || body !== letter.body,
        ...files.paths,
        warning: this.warning(invented, files.error),
      },
      include: WITH_BASE,
    });
    return this.toDto(updated);
  }

  async remove(id: string): Promise<void> {
    await this.load(id);
    await this.prisma.coverLetter.delete({ where: { id } });
  }

  async file(id: string, kind: 'pdf' | 'docx'): Promise<{ buffer: Buffer; fileName: string }> {
    const letter = await this.load(id);
    const path = kind === 'pdf' ? letter.pdfPath : letter.docxPath;
    if (!path) throw new NotFoundException('File non ancora disponibile');
    return { buffer: await this.storage.read(path), fileName: `${this.toDto(letter).fileName}.${kind}` };
  }

  /** All'avvio: le lettere rimaste a metà per un riavvio vengono chiuse con un errore chiaro. */
  async closeInterrupted(): Promise<void> {
    if (this.env.cliMode) return;
    await this.prisma.coverLetter.updateMany({
      where: { status: 'generating' },
      data: { status: 'failed', error: 'Generazione interrotta dal riavvio dell’applicazione: rigenera la lettera' },
    });
  }
}
