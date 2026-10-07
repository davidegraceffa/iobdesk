import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CoverLetterDto, CvGenerateInfo } from '@jobagg/shared';
import type { Response } from 'express';
import { CoverLetterService } from './cover-letter.service';
import { GenerateCvDto, RegenerateCvDto, UpdateCoverLetterDto } from './cv.dto';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function sendFile(res: Response, file: { buffer: Buffer; fileName: string }, type: string, download: boolean): void {
  res
    .setHeader('Content-Type', type)
    .setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${file.fileName}"`)
    .setHeader('Cache-Control', 'no-store')
    .send(file.buffer);
}

@ApiTags('cover-letters')
@Controller()
export class CoverLetterController {
  constructor(private readonly letters: CoverLetterService) {}

  @Get('jobs/:id/cover-letters/options')
  @ApiOperation({ summary: 'Lingue disponibili, provider LLM e riepilogo dei dati che verranno inviati' })
  options(@Param('id') jobId: string): Promise<CvGenerateInfo> {
    return this.letters.options(jobId);
  }

  @Post('jobs/:id/cover-letters')
  @HttpCode(202)
  @ApiOperation({ summary: 'Avvia la scrittura di una lettera di candidatura su misura' })
  generate(@Param('id') jobId: string, @Body() dto: GenerateCvDto): Promise<CoverLetterDto> {
    return this.letters.request(jobId, dto);
  }

  @Get('jobs/:id/cover-letters')
  @ApiOperation({ summary: 'Lettere scritte per l’annuncio' })
  listForJob(@Param('id') jobId: string): Promise<CoverLetterDto[]> {
    return this.letters.listForJob(jobId);
  }

  @Get('cover-letters/:id')
  detail(@Param('id') id: string): Promise<CoverLetterDto> {
    return this.letters.detail(id);
  }

  @Patch('cover-letters/:id')
  @ApiOperation({ summary: 'Salva i ritocchi al testo e rigenera DOCX e PDF' })
  update(@Param('id') id: string, @Body() dto: UpdateCoverLetterDto): Promise<CoverLetterDto> {
    return this.letters.update(id, dto);
  }

  @Post('cover-letters/:id/regenerate')
  @HttpCode(202)
  regenerate(@Param('id') id: string, @Body() dto: RegenerateCvDto): Promise<CoverLetterDto> {
    return this.letters.regenerate(id, dto);
  }

  @Delete('cover-letters/:id')
  @HttpCode(204)
  remove(@Param('id') id: string): Promise<void> {
    return this.letters.remove(id);
  }

  @Get('cover-letters/:id/pdf')
  async pdf(
    @Param('id') id: string,
    @Query('download') download: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    sendFile(res, await this.letters.file(id, 'pdf'), 'application/pdf', !!download);
  }

  @Get('cover-letters/:id/docx')
  async docx(@Param('id') id: string, @Res() res: Response): Promise<void> {
    sendFile(res, await this.letters.file(id, 'docx'), DOCX_MIME, true);
  }
}
