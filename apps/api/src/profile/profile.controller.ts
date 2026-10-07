import { Body, Controller, Get, Param, Post, Put, Query, Res } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type {
  CountryDto,
  ProfileHistoryEntry,
  ProfileImportPreview,
  ProfilePreviewResult,
  ProfileResponse,
} from '@jobagg/shared';
import type { Response } from 'express';
import { ProfileService } from './profile.service';

@ApiTags('profilo')
@Controller('profile')
export class ProfileController {
  constructor(private readonly profile: ProfileService) {}

  @Get()
  @ApiOperation({ summary: 'Impostazioni correnti, valori derivati dal paese e stato dei segreti' })
  get(): Promise<ProfileResponse> {
    return this.profile.get();
  }

  @Put()
  @ApiOperation({ summary: 'Salvataggio validato (schema Zod condiviso): crea una voce di storico' })
  @ApiBody({
    description: 'Oggetto impostazioni completo, nel formato di config/search.yaml',
    schema: { type: 'object' },
  })
  save(@Body() body: Record<string, unknown>): Promise<ProfileResponse> {
    return this.profile.save(body);
  }

  @Post('preview')
  @ApiOperation({ summary: 'Quanti annunci passerebbero i filtri con queste impostazioni (non salva)' })
  @ApiBody({ schema: { type: 'object' } })
  preview(@Body() body: Record<string, unknown>): Promise<ProfilePreviewResult> {
    return this.profile.preview(body);
  }

  @Get('history')
  history(): Promise<ProfileHistoryEntry[]> {
    return this.profile.history();
  }

  @Post('history/:id/restore')
  restore(@Param('id') id: string): Promise<ProfileResponse> {
    return this.profile.restore(id);
  }

  @Get('export')
  @ApiQuery({ name: 'format', enum: ['yaml', 'json'], required: false })
  async export(@Query('format') format: string | undefined, @Res() res: Response): Promise<void> {
    const fmt = format === 'json' ? 'json' : 'yaml';
    const body = await this.profile.export(fmt);
    res
      .setHeader('Content-Type', fmt === 'json' ? 'application/json; charset=utf-8' : 'application/yaml; charset=utf-8')
      .setHeader('Content-Disposition', `attachment; filename="iobdesk-settings.${fmt}"`)
      .send(body);
  }

  @Post('import')
  @ApiOperation({ summary: 'Import da file YAML/JSON; con dryRun=true restituisce solo l’anteprima delle differenze' })
  @ApiQuery({ name: 'dryRun', required: false })
  @ApiBody({ schema: { type: 'object', properties: { content: { type: 'string' } } } })
  import(@Body() body: { content?: unknown }, @Query('dryRun') dryRun?: string): Promise<ProfileImportPreview> {
    return this.profile.import(body?.content ?? body, dryRun === 'true' || dryRun === '1');
  }

  @Get('countries')
  countries(): CountryDto[] {
    return this.profile.countries();
  }
}
