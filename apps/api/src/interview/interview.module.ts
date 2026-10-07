import { Module, OnApplicationBootstrap } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module';
import { InterviewController } from './interview.controller';
import { InterviewService } from './interview.service';
import { SpeechToTextService } from './speech-to-text.service';
import { TextToSpeechService } from './text-to-speech.service';

/** Colloqui simulati: domande dall'LLM, risposte a voce trascritte in locale, valutazione di ogni risposta. */
@Module({
  imports: [LlmModule],
  controllers: [InterviewController],
  providers: [InterviewService, SpeechToTextService, TextToSpeechService],
})
export class InterviewModule implements OnApplicationBootstrap {
  constructor(private readonly interviews: InterviewService) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.interviews.closeInterrupted();
  }
}
