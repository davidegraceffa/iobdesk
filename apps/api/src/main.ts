import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { SettingsService } from './config/settings.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: false });
  app.setGlobalPrefix('api');
  app.useBodyParser('json', { limit: '2mb' });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidUnknownValues: false }));
  app.enableShutdownHooks();
  app.disable('x-powered-by');

  const config = new DocumentBuilder()
    .setTitle('Iobdesk API')
    .setDescription('API locale: annunci, profilo, fonti, candidature e CV su misura')
    .setVersion('0.1.0')
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));

  // seed delle impostazioni da config/search.yaml al primo avvio, prima di accettare richieste
  await app.get(SettingsService).snapshot();

  const port = Number(process.env.PORT) || 3000;
  await app.listen(port, '0.0.0.0');
  new Logger('Bootstrap').log(`API in ascolto sulla porta ${port} (documentazione su /api/docs)`);
}

bootstrap().catch((err) => {
  console.error('Avvio fallito:', err);
  process.exit(1);
});
