import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module';
import { SourcesModule } from '../sources/sources.module';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { SalaryEstimateService } from './salary-estimate.service';

@Module({
  imports: [SourcesModule, LlmModule],
  controllers: [JobsController],
  providers: [JobsService, SalaryEstimateService],
  exports: [JobsService],
})
export class JobsModule {}
