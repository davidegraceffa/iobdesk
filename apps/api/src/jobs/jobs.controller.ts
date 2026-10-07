import { Body, Controller, Get, Header, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { JobDetail, JobListItem, Paginated, StatsDto } from '@jobagg/shared';
import { JobsQueryDto, UpdateJobDto } from './jobs.dto';
import { JobsService } from './jobs.service';
import { SalaryEstimateService } from './salary-estimate.service';

@ApiTags('annunci')
@Controller()
export class JobsController {
  constructor(
    private readonly jobs: JobsService,
    private readonly salaryEstimates: SalaryEstimateService,
  ) {}

  @Get('jobs')
  @ApiOperation({ summary: 'Elenco annunci con filtri, ricerca full-text e paginazione' })
  list(@Query() query: JobsQueryDto): Promise<Paginated<JobListItem>> {
    return this.jobs.list(query);
  }

  @Get('jobs/export')
  @ApiOperation({ summary: 'Export CSV degli annunci filtrati' })
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="annunci.csv"')
  async export(@Query() query: JobsQueryDto): Promise<string> {
    // BOM: Excel riconosce l'UTF-8
    return `\uFEFF${await this.jobs.exportCsv(query)}`;
  }

  @Get('jobs/:id')
  get(@Param('id') id: string): Promise<JobDetail> {
    return this.jobs.get(id);
  }

  @Patch('jobs/:id')
  @ApiOperation({ summary: 'Aggiorna stato e note di un annuncio' })
  update(@Param('id') id: string, @Body() dto: UpdateJobDto): Promise<JobDetail> {
    return this.jobs.update(id, dto);
  }

  @Post('jobs/:id/salary-estimate')
  @ApiOperation({ summary: 'Stima con l’LLM una RAL plausibile per un annuncio che non la indica' })
  estimateSalary(@Param('id') id: string): Promise<JobDetail> {
    return this.salaryEstimates.estimate(id);
  }

  @Get('stats')
  stats(): Promise<StatsDto> {
    return this.jobs.stats();
  }
}
