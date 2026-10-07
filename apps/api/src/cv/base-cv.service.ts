import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CV_LANGUAGES,
  CV_SECTION_TYPES,
  type BaseCvDto,
  type BaseCvStructureDto,
  type CvSectionOverride,
  type CvSlotDto,
  type CvStructure,
} from '@jobagg/shared';
import { SettingsService } from '../config/settings.service';
import { PrismaService } from '../prisma/prisma.service';
import { CvStorageService } from './cv-storage.service';
import { DocxDocument, InvalidDocxError } from './docx/docx-document';
import { computeStructure, toRawParagraphs } from './docx/structure';
import { GotenbergService } from './gotenberg.service';
import { pdfPageCount } from './pdf-tools';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const ACCEPTED_MIME = new Set([
  DOCX_MIME,
  'application/octet-stream',
  'application/zip',
  'application/x-zip-compressed',
]);

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

type BaseCvRow = Prisma.BaseCvGetPayload<object>;

export function toBaseCvDto(row: BaseCvRow): BaseCvDto {
  return {
    id: row.id,
    language: row.language,
    version: row.version,
    isActive: row.isActive,
    originalFileName: row.originalFileName,
    pageCount: row.pageCount,
    uploadedAt: row.uploadedAt.toISOString(),
    hasPdf: !!row.pdfPath,
  };
}

/** CV di default: uno slot per lingua, ogni caricamento crea una nuova versione e archivia le precedenti. */
@Injectable()
export class BaseCvService {
  private readonly logger = new Logger(BaseCvService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly storage: CvStorageService,
    private readonly gotenberg: GotenbergService,
  ) {}

  async slots(): Promise<CvSlotDto[]> {
    const { cv } = await this.settings.get();
    const rows = await this.prisma.baseCv.findMany({ orderBy: [{ language: 'asc' }, { version: 'desc' }] });
    return cv.languages.map((language) => {
      const versions = rows.filter((r) => r.language === language);
      const active = versions.find((r) => r.isActive) ?? null;
      return {
        language,
        status: !active ? 'empty' : active.error ? 'error' : 'loaded',
        error: active?.error ?? null,
        active: active ? toBaseCvDto(active) : null,
        versions: versions.length,
      };
    });
  }

  /** Lingue con un CV base utilizzabile (caricato e convertito). */
  async availableLanguages(): Promise<string[]> {
    const { cv } = await this.settings.get();
    const rows = await this.prisma.baseCv.findMany({
      where: { isActive: true, error: null },
      select: { language: true },
    });
    const loaded = new Set(rows.map((r) => r.language));
    return cv.languages.filter((l) => loaded.has(l));
  }

  async activeFor(language: string): Promise<BaseCvRow | null> {
    return this.prisma.baseCv.findFirst({ where: { language, isActive: true, error: null } });
  }

  async upload(file: UploadedFile | undefined, language: string): Promise<BaseCvDto> {
    const { cv } = await this.settings.get();
    if (!(CV_LANGUAGES as readonly string[]).includes(language) || !(cv.languages as string[]).includes(language)) {
      throw new BadRequestException(`Lingua "${language}" non abilitata: attivala prima nella scheda CV del Profilo`);
    }
    if (!file?.buffer?.length) throw new BadRequestException('Nessun file ricevuto');
    const name = file.originalname ?? '';
    const isPdf =
      /\.pdf$/i.test(name) || file.mimetype === 'application/pdf' || file.buffer.subarray(0, 5).toString() === '%PDF-';
    if (isPdf) {
      throw new BadRequestException(
        'Serve il CV in formato DOCX, non PDF: solo il DOCX permette di modificare i testi mantenendo font, colori, colonne e impaginazione. Esportalo da Word, Google Docs o LibreOffice come .docx e ricaricalo.',
      );
    }
    if (!/\.docx$/i.test(name) || !ACCEPTED_MIME.has(file.mimetype)) {
      throw new BadRequestException('Formato non supportato: carica un file Word .docx');
    }

    return toBaseCvDto(await this.store(language, file.buffer, name.replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 150)));
  }

  /**
   * Salva un DOCX come CV base di una lingua: di norma è una nuova versione attiva (le precedenti restano
   * archiviate); con `replaceId` aggiorna invece il contenuto di una versione esistente, lasciandola attiva.
   */
  async store(language: string, buffer: Buffer, fileName: string, replaceId?: string): Promise<BaseCvRow> {
    let doc: DocxDocument;
    try {
      doc = await DocxDocument.load(buffer);
    } catch (err) {
      if (err instanceof InvalidDocxError) throw new BadRequestException(err.message);
      throw err;
    }
    const raws = doc.extractParagraphs();
    if (raws.length < 3) throw new BadRequestException('Il documento sembra vuoto: non contiene abbastanza testo');
    const structure = computeStructure(raws);

    const last = await this.prisma.baseCv.findFirst({ where: { language }, orderBy: { version: 'desc' } });
    const created = await this.prisma.$transaction(async (tx) => {
      await tx.baseCv.updateMany({ where: { language, isActive: true }, data: { isActive: false } });
      if (replaceId) {
        return tx.baseCv.update({
          where: { id: replaceId },
          // il contenuto cambia: la valutazione ATS fatta sul precedente non vale più
          data: {
            isActive: true,
            structure: structure as unknown as Prisma.InputJsonValue,
            uploadedAt: new Date(),
            atsReport: Prisma.DbNull,
          },
        });
      }
      return tx.baseCv.create({
        data: {
          language,
          version: (last?.version ?? 0) + 1,
          isActive: true,
          originalFileName: fileName,
          docxPath: '',
          structure: structure as unknown as Prisma.InputJsonValue,
        },
      });
    });

    // il file viene salvato così com'è: le versioni non vengono mai modificate dopo essere state usate
    const docxPath = this.storage.basePath(created.id, 'original.docx');
    await this.storage.write(docxPath, buffer);
    let pdfPath: string | null = null;
    let pageCount = 0;
    let error: string | null = null;
    try {
      const pdf = await this.gotenberg.docxToPdf(buffer, 'cv.docx');
      const path = this.storage.basePath(created.id, 'preview.pdf');
      await this.storage.write(path, pdf);
      pageCount = await pdfPageCount(this.storage.absolute(path));
      pdfPath = path;
    } catch (err) {
      error = `Anteprima PDF non generata: ${(err as Error).message}`;
      this.logger.warn(error);
    }
    return this.prisma.baseCv.update({
      where: { id: created.id },
      data: { docxPath, pdfPath, pageCount, error },
    });
  }

  /** Riporta attiva una versione archiviata (le altre della stessa lingua vengono archiviate). */
  async activate(id: string): Promise<BaseCvRow> {
    const row = await this.get(id);
    return this.prisma.$transaction(async (tx) => {
      await tx.baseCv.updateMany({ where: { language: row.language, isActive: true }, data: { isActive: false } });
      return tx.baseCv.update({ where: { id }, data: { isActive: true } });
    });
  }

  /** true se CV su misura o lettere sono stati generati da questa versione: il suo contenuto non va più toccato. */
  async isReferenced(id: string): Promise<boolean> {
    const [cvs, letters] = await Promise.all([
      this.prisma.generatedCv.count({ where: { baseCvId: id } }),
      this.prisma.coverLetter.count({ where: { baseCvId: id } }),
    ]);
    return cvs + letters > 0;
  }

  async docx(id: string): Promise<{ buffer: Buffer; fileName: string }> {
    const row = await this.get(id);
    const name = row.originalFileName.replace(/\.docx$/i, '');
    return { buffer: await this.storage.read(row.docxPath), fileName: `${name}_v${row.version}.docx` };
  }

  async get(id: string): Promise<BaseCvRow> {
    const row = await this.prisma.baseCv.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('CV base non trovato');
    return row;
  }

  async structure(id: string): Promise<BaseCvStructureDto> {
    const row = await this.get(id);
    return { baseCv: toBaseCvDto(row), structure: row.structure as unknown as CvStructure };
  }

  /** Correzioni manuali dell'assegnazione delle sezioni: la struttura viene ricalcolata. */
  async updateStructure(id: string, overrides: unknown): Promise<BaseCvStructureDto> {
    const row = await this.get(id);
    const current = row.structure as unknown as CvStructure;
    if (typeof overrides !== 'object' || overrides === null || Array.isArray(overrides)) {
      throw new BadRequestException('Correzioni non valide');
    }
    const valid: string[] = [...CV_SECTION_TYPES, 'not_heading'];
    const known = new Set(current.paragraphs.map((p) => p.id));
    const clean: Record<string, CvSectionOverride> = {};
    for (const [paragraphId, value] of Object.entries(overrides as Record<string, unknown>)) {
      if (!known.has(paragraphId)) throw new BadRequestException(`Paragrafo ${paragraphId} inesistente`);
      if (typeof value !== 'string' || !valid.includes(value))
        throw new BadRequestException(`Tipo di sezione non valido per ${paragraphId}`);
      clean[paragraphId] = value as CvSectionOverride;
    }
    const structure = computeStructure(toRawParagraphs(current), clean);
    const updated = await this.prisma.baseCv.update({
      where: { id },
      data: { structure: structure as unknown as Prisma.InputJsonValue },
    });
    return { baseCv: toBaseCvDto(updated), structure };
  }

  async versions(language: string): Promise<BaseCvDto[]> {
    const rows = await this.prisma.baseCv.findMany({ where: { language }, orderBy: { version: 'desc' } });
    return rows.map(toBaseCvDto);
  }

  async pdf(id: string): Promise<{ buffer: Buffer; fileName: string }> {
    const row = await this.get(id);
    if (!row.pdfPath) throw new NotFoundException(row.error ?? 'Anteprima PDF non disponibile');
    return {
      buffer: await this.storage.read(row.pdfPath),
      fileName: `${row.originalFileName.replace(/\.docx$/i, '')}.pdf`,
    };
  }
}
