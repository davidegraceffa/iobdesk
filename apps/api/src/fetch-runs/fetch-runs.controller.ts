import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { FetchRunDto, SourceStatusDto } from '@jobagg/shared';
import { FetchService } from './fetch.service';

@ApiTags('fonti')
@Controller()
export class FetchRunsController {
  constructor(private readonly fetch: FetchService) {}

  @Post('fetch')
  @HttpCode(202)
  @ApiOperation({ summary: 'Avvia la raccolta da tutte le fonti abilitate o da una sola (?source=)' })
  @ApiQuery({ name: 'source', required: false })
  start(@Query('source') source?: string): Promise<{ runIds: string[] }> {
    return this.fetch.start('manual', source || undefined);
  }

  @Get('fetch/runs')
  @ApiOperation({ summary: 'Ultime raccolte' })
  runs(@Query('source') source?: string, @Query('limit') limit?: string): Promise<FetchRunDto[]> {
    return this.fetch.listRuns(Number(limit) || 50, source || undefined);
  }

  @Get('fetch/runs/:id')
  run(@Param('id') id: string): Promise<FetchRunDto> {
    return this.fetch.getRun(id);
  }

  @Get('sources')
  @ApiOperation({ summary: 'Stato di ogni fonte e rilevanza per il paese dell’utente' })
  sources(): Promise<SourceStatusDto[]> {
    return this.fetch.sourcesStatus();
  }
}
