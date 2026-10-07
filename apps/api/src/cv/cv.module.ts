import { Module, OnApplicationBootstrap } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module';
import { BaseCvService } from './base-cv.service';
import { CoverLetterController } from './cover-letter.controller';
import { CoverLetterService } from './cover-letter.service';
import { CvGenerationService } from './cv-generation.service';
import { CvReviewController } from './cv-review.controller';
import { CvReviewService } from './cv-review.service';
import { CvStorageService } from './cv-storage.service';
import { CvController } from './cv.controller';
import { GotenbergService } from './gotenberg.service';

@Module({
  imports: [LlmModule],
  controllers: [CvController, CoverLetterController, CvReviewController],
  providers: [
    CvStorageService,
    GotenbergService,
    BaseCvService,
    CvGenerationService,
    CoverLetterService,
    CvReviewService,
  ],
  exports: [BaseCvService, CvGenerationService],
})
export class CvModule implements OnApplicationBootstrap {
  constructor(
    private readonly generation: CvGenerationService,
    private readonly letters: CoverLetterService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.generation.closeInterrupted();
    await this.letters.closeInterrupted();
  }
}
