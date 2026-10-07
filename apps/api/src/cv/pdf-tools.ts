import { execFile } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { promisify } from 'node:util';

const exec = promisify(execFile);

/** Numero di pagine di un PDF (poppler `pdfinfo`). */
export async function pdfPageCount(pdfPath: string): Promise<number> {
  const { stdout } = await exec('pdfinfo', [pdfPath], { timeout: 20_000 });
  const pages = Number(/^Pages:\s+(\d+)/m.exec(stdout)?.[1]);
  if (!Number.isInteger(pages) || pages < 1) throw new Error('Impossibile leggere il numero di pagine del PDF');
  return pages;
}

/** Nomi dei font usati in un PDF, senza il prefisso di subset (poppler `pdffonts`). */
export async function pdfFonts(pdfPath: string): Promise<string[]> {
  const { stdout } = await exec('pdffonts', [pdfPath], { timeout: 20_000 });
  const fonts = stdout
    .split('\n')
    .slice(2)
    .map((line) => line.trim().split(/\s+/)[0] ?? '')
    .filter(Boolean)
    .map((name) => name.replace(/^[A-Z]{6}\+/, ''));
  return [...new Set(fonts)].sort();
}

/** Miniatura PNG di una pagina (poppler `pdftoppm`). */
export async function pdfThumbnail(pdfPath: string, page: number, outBase: string, dpi = 70): Promise<Buffer> {
  await exec(
    'pdftoppm',
    ['-png', '-r', String(dpi), '-f', String(page), '-l', String(page), '-singlefile', pdfPath, outBase],
    {
      timeout: 30_000,
    },
  );
  return readFile(`${outBase}.png`);
}

export async function removeQuietly(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true }).catch(() => undefined);
}
