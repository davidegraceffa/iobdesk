import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  Param,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type {
  InterviewOptions,
  InterviewSessionDto,
  InterviewSessionSummary,
  InterviewSuggestionDto,
} from '@jobagg/shared';
import { AgainDto, AnswerDto, CreateInterviewDto, LiveTurnDto, SpeakDto, TranscribeDto } from './interview.dto';
import { InterviewService } from './interview.service';
import { SpeechToTextService } from './speech-to-text.service';
import { TextToSpeechService } from './text-to-speech.service';

/** circa 10 minuti di audio compresso: le risposte durano al massimo 5 minuti */
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

interface UploadedAudio {
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@ApiTags('colloqui')
@Controller()
export class InterviewController {
  constructor(
    private readonly interviews: InterviewService,
    private readonly stt: SpeechToTextService,
    private readonly tts: TextToSpeechService,
  ) {}

  @Get('jobs/:id/interview/options')
  @ApiOperation({
    summary: 'Cosa serve per simulare un colloquio su questo annuncio: LLM, consenso, lingua, trascrizione',
  })
  options(@Param('id') jobId: string): Promise<InterviewOptions> {
    return this.interviews.options({ kind: 'job', id: jobId });
  }

  @Get('applications/:id/interview/options')
  @ApiOperation({ summary: 'Come sopra, per una candidatura (anche senza annuncio collegato)' })
  applicationOptions(@Param('id') applicationId: string): Promise<InterviewOptions> {
    return this.interviews.options({ kind: 'application', id: applicationId });
  }

  @Post('jobs/:id/interviews')
  @ApiOperation({ summary: 'Crea un colloquio simulato: le domande vengono generate in background' })
  create(@Param('id') jobId: string, @Body() dto: CreateInterviewDto): Promise<InterviewSessionDto> {
    return this.interviews.create({ kind: 'job', id: jobId }, dto);
  }

  @Post('applications/:id/interviews')
  @ApiOperation({
    summary: 'Colloquio simulato su una candidatura; se manca la descrizione va passata in "description"',
  })
  createForApplication(
    @Param('id') applicationId: string,
    @Body() dto: CreateInterviewDto,
  ): Promise<InterviewSessionDto> {
    return this.interviews.create({ kind: 'application', id: applicationId }, dto);
  }

  @Get('interviews')
  list(
    @Query('jobId') jobId?: string,
    @Query('applicationId') applicationId?: string,
  ): Promise<InterviewSessionSummary[]> {
    return this.interviews.list({ jobId: jobId || undefined, applicationId: applicationId || undefined });
  }

  @Get('interviews/suggestion')
  @ApiOperation({ summary: 'Propone un colloquio su una candidatura passata scelta a caso' })
  suggestion(@Query('exclude') exclude?: string): Promise<InterviewSuggestionDto | null> {
    return this.interviews.suggestion(exclude);
  }

  @Get('interviews/speech-to-text')
  @ApiOperation({ summary: 'Il servizio locale di trascrizione è attivo?' })
  async speechToText(): Promise<{ available: boolean }> {
    return { available: await this.stt.available() };
  }

  @Get('interviews/text-to-speech')
  @ApiOperation({ summary: 'Lingue per cui è attiva la voce neurale locale dell’intervistatore' })
  async textToSpeech(): Promise<{ languages: string[] }> {
    return { languages: await this.tts.languages() };
  }

  @Post('interviews/speak')
  @HttpCode(200)
  @ApiOperation({ summary: 'Pronuncia un testo con la voce neurale locale (Piper): restituisce audio WAV' })
  async speak(@Body() dto: SpeakDto): Promise<StreamableFile> {
    return new StreamableFile(await this.tts.synthesize(dto.text, dto.language), { type: 'audio/wav' });
  }

  @Post('interviews/transcribe')
  @HttpCode(200)
  @ApiOperation({ summary: 'Trascrive una risposta vocale con Whisper in locale (l’audio non viene salvato)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { audio: { type: 'string', format: 'binary' }, language: { type: 'string' } },
    },
  })
  @UseInterceptors(FileInterceptor('audio', { limits: { fileSize: MAX_AUDIO_BYTES, files: 1 } }))
  transcribe(@UploadedFile() audio: UploadedAudio | undefined, @Body() dto: TranscribeDto): Promise<{ text: string }> {
    return this.interviews.transcribe(audio?.buffer, audio?.mimetype ?? '', dto.language, dto.sessionId);
  }

  @Get('interviews/:id')
  get(@Param('id') id: string): Promise<InterviewSessionDto> {
    return this.interviews.get(id);
  }

  @Post('interviews/:id/retry')
  @HttpCode(200)
  @ApiOperation({ summary: 'Riprova la generazione delle domande dopo un errore' })
  retry(@Param('id') id: string): Promise<InterviewSessionDto> {
    return this.interviews.retry(id);
  }

  @Post('interviews/:id/again')
  @ApiOperation({ summary: 'Nuovo tentativo sullo stesso annuncio o candidatura, con domande nuove' })
  again(@Param('id') id: string, @Body() dto: AgainDto): Promise<InterviewSessionDto> {
    return this.interviews.again(id, dto.consentExternal);
  }

  @Post('interviews/:id/live/start')
  @HttpCode(200)
  @ApiOperation({ summary: 'Conversazione: saluto e prima domanda dell’intervistatore' })
  liveStart(@Param('id') id: string): Promise<InterviewSessionDto> {
    return this.interviews.liveStart(id);
  }

  @Post('interviews/:id/live/turn/stream')
  @ApiOperation({
    summary:
      'Come live/turn, ma in streaming (text/event-stream): eventi "say" con la replica a pezzi, poi "done" con il colloquio o "error"',
  })
  async liveTurnStream(@Param('id') id: string, @Body() dto: LiveTurnDto, @Res() res: Response): Promise<void> {
    res.status(200).set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    try {
      send('done', await this.interviews.liveTurn(id, dto, (text) => send('say', { text })));
    } catch (error) {
      send('error', {
        message: (error as Error).message || 'Errore',
        status: error instanceof HttpException ? error.getStatus() : 500,
      });
    }
    res.end();
  }

  @Post('interviews/:id/live/turn')
  @HttpCode(200)
  @ApiOperation({ summary: 'Conversazione: battuta del candidato e replica dell’intervistatore' })
  liveTurn(@Param('id') id: string, @Body() dto: LiveTurnDto): Promise<InterviewSessionDto> {
    return this.interviews.liveTurn(id, dto);
  }

  @Post('interviews/:id/finish')
  @HttpCode(200)
  @ApiOperation({ summary: 'Chiude il colloquio e (ri)genera la valutazione finale: contenuti e tono' })
  finish(@Param('id') id: string): Promise<InterviewSessionDto> {
    return this.interviews.finish(id);
  }

  @Delete('interviews/:id')
  @HttpCode(204)
  remove(@Param('id') id: string): Promise<void> {
    return this.interviews.remove(id);
  }

  @Put('interviews/:id/answers/:questionId')
  @ApiOperation({ summary: 'Salva la risposta a una domanda e ne avvia la valutazione' })
  answer(
    @Param('id') id: string,
    @Param('questionId') questionId: string,
    @Body() dto: AnswerDto,
  ): Promise<InterviewSessionDto> {
    return this.interviews.answer(id, questionId, dto);
  }
}
