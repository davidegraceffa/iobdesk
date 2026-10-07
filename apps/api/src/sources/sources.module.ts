import { Module } from '@nestjs/common';
import { ArbeitnowAdapter } from './adapters/arbeitnow.adapter';
import { EmailAlertsAdapter } from './adapters/email-alerts.adapter';
import { HimalayasAdapter } from './adapters/himalayas.adapter';
import { HnWhoIsHiringAdapter } from './adapters/hn-whoishiring.adapter';
import { JobicyAdapter } from './adapters/jobicy.adapter';
import { RemoteOkAdapter } from './adapters/remoteok.adapter';
import { RemotiveAdapter } from './adapters/remotive.adapter';
import { WeWorkRemotelyAdapter } from './adapters/weworkremotely.adapter';
import { SourceHttpService } from './source-http.service';
import { SOURCE_ADAPTERS, type SourceAdapter } from './source.types';
import { SourcesRegistry } from './sources.registry';

/**
 * Per aggiungere una fonte: crea un file in `adapters/` e aggiungi la classe a questo elenco
 * (più una voce in `sources` nello schema delle impostazioni). Vedi SOURCES.md.
 */
const ADAPTERS = [
  RemotiveAdapter,
  RemoteOkAdapter,
  ArbeitnowAdapter,
  HimalayasAdapter,
  JobicyAdapter,
  WeWorkRemotelyAdapter,
  HnWhoIsHiringAdapter,
  EmailAlertsAdapter,
];

@Module({
  providers: [
    ...ADAPTERS,
    {
      provide: SOURCE_ADAPTERS,
      useFactory: (...adapters: SourceAdapter[]) => adapters,
      inject: ADAPTERS,
    },
    SourcesRegistry,
    SourceHttpService,
  ],
  exports: [SourcesRegistry, SourceHttpService],
})
export class SourcesModule {}
