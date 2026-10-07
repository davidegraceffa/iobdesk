import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
  Sse,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type {
  BaseCvDto,
  BaseCvStructureDto,
  CvGenerateInfo,
  CvProgressEvent,
  CvSlotDto,
  GeneratedCvDetail,
  GeneratedCvDto,
} from '@jobagg/shared';
import type { Response } from 'express';
import type { Observable } from 'rxjs';
import { BaseCvService, type UploadedFile as UploadedCvFile } from './base-cv.service';
import { CvGenerationService } from './cv-generation.service';
import {
  GenerateCvDto,
  GenerateCvEmailDto,
  UpdateCvEmailDto,
  GenerateManualCvDto,
  PatchEditsDto,
  RegenerateCvDto,
  UpdateStructureDto,
  UploadBaseCvDto,
} from './cv.dto';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function sendFile(res: Response, file: { buffer: Buffer; fileName: string }, type: string, download: boolean): void {
  res
    .setHeader('Content-Type', type)
    .setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${file.fileName}"`)
    .setHeader('Cache-Control', 'no-store')
    .send(file.buffer);
}

@ApiTags('cv')
@Controller()
export class CvController {
  constructor(
    private readonly baseCvs: BaseCvService,
    private readonly generation: CvGenerationService,
  ) {}

  // ── CV di default ─────────────────────────────────────────────────────────────

  @Get('cv/base')
  @ApiOperation({ summary: 'Slot per lingua con la versione attiva' })
  slots(): Promise<CvSlotDto[]> {
    return this.baseCvs.slots();
  }

  @Post('cv/base')
  @ApiOperation({ summary: 'Carica un CV base DOCX per una lingua (max 10 MB)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' }, language: { type: 'string' } },
    },
  })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  upload(@UploadedFile() file: UploadedCvFile | undefined, @Body() dto: UploadBaseCvDto): Promise<BaseCvDto> {
    return this.baseCvs.upload(file, dto.language);
  }

  @Get('cv/base/:id/structure')
  structure(@Param('id') id: string): Promise<BaseCvStructureDto> {
    return this.baseCvs.structure(id);
  }

  @Put('cv/base/:id/structure')
  @ApiOperation({ summary: 'Correzioni manuali delle sezioni riconosciute' })
  updateStructure(@Param('id') id: string, @Body() dto: UpdateStructureDto): Promise<BaseCvStructureDto> {
    return this.baseCvs.updateStructure(id, dto.overrides);
  }

  @Get('cv/base/:id/pdf')
  async basePdf(@Param('id') id: string, @Res() res: Response): Promise<void> {
    sendFile(res, await this.baseCvs.pdf(id), 'application/pdf', false);
  }

  @Get('cv/base/:id/docx')
  @ApiOperation({ summary: 'Scarica il DOCX di una versione del CV base' })
  async baseDocx(@Param('id') id: string, @Res() res: Response): Promise<void> {
    sendFile(res, await this.baseCvs.docx(id), DOCX_MIME, true);
  }

  @Get('cv/base/:language/versions')
  versions(@Param('language') language: string): Promise<BaseCvDto[]> {
    return this.baseCvs.versions(language);
  }

  // ── CV su misura per un annuncio ──────────────────────────────────────────────

  @Get('jobs/:id/cv/options')
  @ApiOperation({ summary: 'Lingue disponibili, provider LLM e riepilogo dei dati che verranno inviati' })
  options(@Param('id') jobId: string): Promise<CvGenerateInfo> {
    return this.generation.options(jobId);
  }

  @Post('jobs/:id/cv')
  @HttpCode(202)
  @ApiOperation({ summary: 'Accoda la generazione di un CV su misura' })
  generate(
    @Param('id') jobId: string,
    @Body() dto: GenerateCvDto,
  ): Promise<{ generatedCvId: string; queueJobId: string | null }> {
    return this.generation.request(jobId, dto);
  }

  @Get('jobs/:id/cv')
  @ApiOperation({ summary: 'Versioni generate per l’annuncio' })
  listForJob(@Param('id') jobId: string): Promise<GeneratedCvDto[]> {
    return this.generation.listForJob(jobId);
  }

  // ── CV da descrizione incollata a mano ────────────────────────────────────────

  @Get('cv/manual/options')
  @ApiOperation({ summary: 'Come le opzioni per un annuncio, per un CV da descrizione incollata' })
  manualOptions(): Promise<CvGenerateInfo> {
    return this.generation.manualOptions();
  }

  @Get('cv/manual')
  @ApiOperation({ summary: 'CV generati da una descrizione incollata, dal più recente' })
  listManual(): Promise<GeneratedCvDto[]> {
    return this.generation.listManual();
  }

  @Post('cv/manual')
  @HttpCode(202)
  @ApiOperation({ summary: 'Accoda la generazione di un CV su misura da una descrizione incollata' })
  generateManual(@Body() dto: GenerateManualCvDto): Promise<{ generatedCvId: string; queueJobId: string | null }> {
    return this.generation.requestManual(dto);
  }

  @Get('cv/generated/:id')
  detail(@Param('id') id: string): Promise<GeneratedCvDetail> {
    return this.generation.detail(id);
  }

  @Sse('cv/generated/:id/events')
  @ApiOperation({ summary: 'Avanzamento della generazione (Server-Sent Events)' })
  events(@Param('id') id: string): Observable<{ data: CvProgressEvent }> {
    return this.generation.events(id);
  }

  @Patch('cv/generated/:id/edits')
  @ApiOperation({ summary: 'Accetta, rifiuta o ritocca singole modifiche e rigenera DOCX e PDF' })
  patchEdits(@Param('id') id: string, @Body() dto: PatchEditsDto): Promise<GeneratedCvDetail> {
    return this.generation.patchEdits(id, dto.changes);
  }

  @Post('cv/generated/:id/email')
  @ApiOperation({ summary: 'Scrive (o riscrive) il testo dell’email con cui inviare questo CV' })
  generateEmail(@Param('id') id: string, @Body() dto: GenerateCvEmailDto): Promise<GeneratedCvDetail> {
    return this.generation.generateEmail(id, dto);
  }

  @Patch('cv/generated/:id/email')
  @ApiOperation({ summary: 'Salva i ritocchi al testo dell’email' })
  updateEmail(@Param('id') id: string, @Body() dto: UpdateCvEmailDto): Promise<GeneratedCvDetail> {
    return this.generation.updateEmail(id, dto);
  }

  @Post('cv/generated/:id/regenerate')
  @HttpCode(202)
  regenerate(
    @Param('id') id: string,
    @Body() dto: RegenerateCvDto,
  ): Promise<{ generatedCvId: string; queueJobId: string | null }> {
    return this.generation.regenerate(id, dto);
  }

  @Get('cv/generated/:id/pdf')
  async pdf(
    @Param('id') id: string,
    @Query('download') download: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    sendFile(res, await this.generation.file(id, 'pdf'), 'application/pdf', !!download);
  }

  @Get('cv/generated/:id/docx')
  async docx(@Param('id') id: string, @Res() res: Response): Promise<void> {
    sendFile(res, await this.generation.file(id, 'docx'), DOCX_MIME, true);
  }

  @Get('cv/generated/:id/thumbnails/:page')
  async thumbnail(
    @Param('id') id: string,
    @Param('page', ParseIntPipe) page: number,
    @Res() res: Response,
  ): Promise<void> {
    const png = await this.generation.thumbnail(id, page);
    res.setHeader('Content-Type', 'image/png').setHeader('Cache-Control', 'no-store').send(png);
  }
}
