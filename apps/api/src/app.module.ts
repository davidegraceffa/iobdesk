import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ApplicationsModule } from './applications/applications.module';
import { AppConfigModule } from './config/config.module';
import { CvModule } from './cv/cv.module';
import { FetchRunsModule } from './fetch-runs/fetch-runs.module';
import { HealthModule } from './health/health.module';
import { InterviewModule } from './interview/interview.module';
import { JobsModule } from './jobs/jobs.module';
import { LlmModule } from './llm/llm.module';
import { MailModule } from './mail/mail.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PipelineModule } from './pipeline/pipeline.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProfileModule } from './profile/profile.module';
import { QueueModule } from './queue/queue.module';
import { SourcesModule } from './sources/sources.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    AppConfigModule,
    QueueModule,
    SourcesModule,
    PipelineModule,
    NotificationsModule,
    LlmModule,
    FetchRunsModule,
    JobsModule,
    ProfileModule,
    ApplicationsModule,
    MailModule,
    CvModule,
    InterviewModule,
    HealthModule,
  ],
})
export class AppModule {}
