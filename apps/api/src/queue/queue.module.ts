import { Global, Module } from '@nestjs/common';
import { ProgressService } from './progress.service';
import { QueueService } from './queue.service';

@Global()
@Module({
  providers: [QueueService, ProgressService],
  exports: [QueueService, ProgressService],
})
export class QueueModule {}
