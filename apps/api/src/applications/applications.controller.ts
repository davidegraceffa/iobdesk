import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { ApplicationDto, ApplicationImportResult, ApplicationStats } from '@jobagg/shared';
import type { Response } from 'express';
import {
  ApplicationsQueryDto,
  ApplyDto,
  CreateManualApplicationDto,
  ImportApplicationsDto,
  UpdateApplicationDto,
} from './applications.dto';
import { ApplicationsService } from './applications.service';

@ApiTags('candidature')
@Controller()
export class ApplicationsController {
  constructor(private readonly applications: ApplicationsService) {}

  @Post('jobs/:id/apply')
  @ApiOperation({ summary: 'Registra la candidatura a un annuncio (snapshot + primo evento)' })
  apply(@Param('id') jobId: string, @Body() dto: ApplyDto): Promise<ApplicationDto> {
    return this.applications.applyToJob(jobId, dto);
  }

  @Get('applications')
  list(@Query() query: ApplicationsQueryDto): Promise<ApplicationDto[]> {
    return this.applications.list(query);
  }

  @Get('applications/stats')
  stats(): Promise<ApplicationStats> {
    return this.applications.stats();
  }

  @Get('applications/export')
  @ApiOperation({ summary: 'Export CSV dello storico candidature' })
  async export(@Query() query: ApplicationsQueryDto, @Res() res: Response): Promise<void> {
    const csv = await this.applications.exportCsv(query);
    res
      .setHeader('Content-Type', 'text/csv; charset=utf-8')
      .setHeader('Content-Disposition', 'attachment; filename="candidature.csv"')
      .send(`\uFEFF${csv}`);
  }

  @Get('applications/countries')
  @ApiOperation({ summary: 'Nazioni presenti nello storico (per il filtro)' })
  countries(): Promise<string[]> {
    return this.applications.countries();
  }

  @Post('applications/import')
  @HttpCode(200)
  @ApiOperation({ summary: 'Importa candidature da CSV; con dryRun=true restituisce solo l’anteprima' })
  @ApiQuery({ name: 'dryRun', required: false })
  import(@Body() dto: ImportApplicationsDto, @Query('dryRun') dryRun?: string): Promise<ApplicationImportResult> {
    return this.applications.importCsv(dto.content, dryRun === 'true' || dryRun === '1');
  }

  @Post('applications')
  @ApiOperation({ summary: 'Candidatura manuale per annunci trovati altrove' })
  create(@Body() dto: CreateManualApplicationDto): Promise<ApplicationDto> {
    return this.applications.createManual(dto);
  }

  @Get('applications/:id')
  get(@Param('id') id: string): Promise<ApplicationDto> {
    return this.applications.get(id);
  }

  @Patch('applications/:id')
  update(@Param('id') id: string, @Body() dto: UpdateApplicationDto): Promise<ApplicationDto> {
    return this.applications.update(id, dto);
  }
}
