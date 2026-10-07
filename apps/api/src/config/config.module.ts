import { Global, Module } from '@nestjs/common';
import { ENV, loadEnv } from './env';
import { SettingsService } from './settings.service';

/** Profilo utente + criteri di ricerca (impostazioni) e variabili d'ambiente. */
@Global()
@Module({
  providers: [{ provide: ENV, useFactory: loadEnv }, SettingsService],
  exports: [ENV, SettingsService],
})
export class AppConfigModule {}
