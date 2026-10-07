import { Module } from '@nestjs/common';
import { GmailClient } from './gmail.client';
import { GoogleAuthService } from './google-auth.service';
import { MailController } from './mail.controller';
import { MailSyncScheduler } from './mail-sync.scheduler';
import { MailSyncService } from './mail-sync.service';

/** Candidature da Gmail: collegamento OAuth, lettura della posta e aggiornamento dello storico. */
@Module({
  controllers: [MailController],
  providers: [GoogleAuthService, GmailClient, MailSyncService, MailSyncScheduler],
  exports: [MailSyncService, GoogleAuthService],
})
export class MailModule {}
