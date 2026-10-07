import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AppConfigModule } from '../config/config.module';
import { FetchRunsModule } from '../fetch-runs/fetch-runs.module';
import { MailModule } from '../mail/mail.module';
import { PipelineModule } from '../pipeline/pipeline.module';
import { PrismaModule } from '../prisma/prisma.module';
import { QueueModule } from '../queue/queue.module';
import { FetchCommand } from './fetch.command';
import { MailSyncCommand } from './mail-sync.command';
import { RecomputeCommand } from './recompute.command';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    AppConfigModule,
    QueueModule,
    PipelineModule,
    FetchRunsModule,
    MailModule,
  ],
  providers: [FetchCommand, RecomputeCommand, MailSyncCommand],
})
export class CliModule {}
