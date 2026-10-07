import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PipelineModule } from '../pipeline/pipeline.module';
import { SourcesModule } from '../sources/sources.module';
import { FetchRunsController } from './fetch-runs.controller';
import { FetchService } from './fetch.service';
import { SchedulerService } from './scheduler.service';

@Module({
  imports: [SourcesModule, PipelineModule, LlmModule, NotificationsModule],
  controllers: [FetchRunsController],
  providers: [FetchService, SchedulerService],
  exports: [FetchService],
})
export class FetchRunsModule {}
