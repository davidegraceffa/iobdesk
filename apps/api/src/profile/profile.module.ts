import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module';
import { PipelineModule } from '../pipeline/pipeline.module';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';

@Module({
  imports: [LlmModule, PipelineModule],
  controllers: [ProfileController],
  providers: [ProfileService],
})
export class ProfileModule {}
