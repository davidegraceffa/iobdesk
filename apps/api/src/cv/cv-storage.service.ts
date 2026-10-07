import { Inject, Injectable } from '@nestjs/common';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { ENV, type Env } from '../config/env';

/**
 * File dei CV nel volume `cvdata`: i percorsi salvati nel database sono relativi alla radice
 * del volume, così i dati restano validi anche se il punto di mount cambia.
 */
@Injectable()
export class CvStorageService {
  private readonly root: string;

  constructor(@Inject(ENV) env: Env) {
    this.root = resolve(env.cvDataDir);
  }

  absolute(relativePath: string): string {
    const full = resolve(this.root, relativePath);
    if (full !== this.root && !full.startsWith(this.root + sep)) throw new Error('Percorso non valido');
    return full;
  }

  basePath(baseCvId: string, file: 'original.docx' | 'preview.pdf'): string {
    return join('base', baseCvId, file);
  }

  generatedPath(generatedCvId: string, file: string): string {
    return join('generated', generatedCvId, file);
  }

  letterPath(coverLetterId: string, file: 'letter.docx' | 'letter.pdf'): string {
    return join('letters', coverLetterId, file);
  }

  async write(relativePath: string, data: Buffer): Promise<void> {
    const full = this.absolute(relativePath);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, data);
  }

  async ensureDir(relativeDir: string): Promise<string> {
    const full = this.absolute(relativeDir);
    await mkdir(full, { recursive: true });
    return full;
  }

  read(relativePath: string): Promise<Buffer> {
    return readFile(this.absolute(relativePath));
  }
}
