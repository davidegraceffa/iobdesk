import { Module } from '@nestjs/common';
import { PipelineService } from './pipeline.service';
import { RecomputeService } from './recompute.service';

@Module({
  providers: [PipelineService, RecomputeService],
  exports: [PipelineService, RecomputeService],
})
export class PipelineModule {}
