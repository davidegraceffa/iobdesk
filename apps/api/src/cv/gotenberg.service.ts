import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV, type Env } from '../config/env';

export class ConversionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConversionError';
  }
}

/** Conversione DOCX → PDF con Gotenberg (LibreOffice headless), raggiungibile solo sulla rete interna. */
@Injectable()
export class GotenbergService {
  private readonly logger = new Logger(GotenbergService.name);

  constructor(@Inject(ENV) private readonly env: Env) {}

  async docxToPdf(docx: Buffer, fileName = 'cv.docx'): Promise<Buffer> {
    const form = new FormData();
    form.append(
      'files',
      new Blob([new Uint8Array(docx)], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
      fileName,
    );
    let lastError = '';
    // all'avvio dello stack Gotenberg può non essere ancora pronto: qualche tentativo ravvicinato
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const response = await fetch(`${this.env.gotenbergUrl}/forms/libreoffice/convert`, {
          method: 'POST',
          body: form,
          signal: AbortSignal.timeout(90_000),
        });
        if (response.ok) return Buffer.from(await response.arrayBuffer());
        lastError = `HTTP ${response.status} ${(await response.text()).slice(0, 200)}`;
        if (response.status < 500) break;
      } catch (err) {
        lastError = (err as Error).message;
      }
      await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
    }
    this.logger.error(`Conversione DOCX → PDF fallita: ${lastError}`);
    throw new ConversionError(`Conversione in PDF non riuscita (Gotenberg: ${lastError})`);
  }
}
