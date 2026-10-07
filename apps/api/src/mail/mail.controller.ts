import {
  BadGatewayException,
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  Logger,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { MailSyncRunDto, MailSyncStatusDto } from '@jobagg/shared';
import type { Response } from 'express';
import { GoogleAuthError, GoogleAuthService } from './google-auth.service';
import { MailSyncScheduler } from './mail-sync.scheduler';
import { MailSyncService } from './mail-sync.service';

const isTrue = (value?: string) => value === 'true' || value === '1';

@ApiTags('gmail')
@Controller('mail')
export class MailController {
  private readonly logger = new Logger(MailController.name);

  constructor(
    private readonly auth: GoogleAuthService,
    private readonly sync: MailSyncService,
    private readonly scheduler: MailSyncScheduler,
  ) {}

  @Get('status')
  @ApiOperation({ summary: 'Collegamento a Gmail e ultima sincronizzazione delle candidature' })
  status(): Promise<MailSyncStatusDto> {
    return this.sync.status();
  }

  @Post('oauth/start')
  @HttpCode(200)
  @ApiOperation({ summary: 'URL della pagina di consenso Google (sola lettura di Gmail)' })
  start(): { url: string } {
    return { url: this.auth.startLogin() };
  }

  @Get('oauth/callback')
  @ApiOperation({ summary: 'Ritorno dall’autorizzazione Google: salva il collegamento e torna al Profilo' })
  async callback(
    @Res() res: Response,
    @Query('state') state?: string,
    @Query('code') code?: string,
    @Query('error') error?: string,
  ): Promise<void> {
    const back = (outcome: string) => res.redirect(302, `/profile?tab=fonti&gmail=${outcome}`);
    if (error || !state || !code) return back(error === 'access_denied' ? 'denied' : 'error');
    try {
      await this.auth.completeLogin(state, code);
    } catch (err) {
      this.logger.warn(`Collegamento a Gmail non riuscito: ${(err as Error).message}`);
      return back('error');
    }
    await this.scheduler.reschedule().catch(() => undefined);
    back('connected');
  }

  @Delete('connection')
  @HttpCode(204)
  @ApiOperation({ summary: 'Scollega Gmail: revoca l’autorizzazione e cancella il token locale' })
  async disconnect(): Promise<void> {
    await this.auth.disconnect();
  }

  @Post('sync')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sincronizza subito le candidature da Gmail; con dryRun=true solo l’anteprima' })
  @ApiQuery({ name: 'dryRun', required: false })
  @ApiQuery({ name: 'days', required: false })
  async run(@Query('dryRun') dryRun?: string, @Query('days') days?: string): Promise<MailSyncRunDto> {
    const n = Number(days);
    try {
      return await this.sync.run('manual', {
        dryRun: isTrue(dryRun),
        days: Number.isInteger(n) && n >= 1 && n <= 365 ? n : undefined,
      });
    } catch (err) {
      // il messaggio (collegamento mancante, autorizzazione scaduta, errore di Gmail) va mostrato all'utente
      if (err instanceof HttpException) throw err;
      if (err instanceof GoogleAuthError) throw new BadRequestException(err.message);
      throw new BadGatewayException((err as Error).message);
    }
  }

  @Get('runs')
  @ApiOperation({ summary: 'Ultime sincronizzazioni' })
  runs(@Query('limit') limit?: string): Promise<MailSyncRunDto[]> {
    return this.sync.listRuns(Number(limit) || 20);
  }
}
