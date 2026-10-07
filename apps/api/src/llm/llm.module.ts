import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { LlmScoringService } from './llm-scoring.service';
import { LlmService } from './llm.service';

@Module({
  imports: [NotificationsModule],
  providers: [LlmService, LlmScoringService],
  exports: [LlmService, LlmScoringService],
})
export class LlmModule {}
