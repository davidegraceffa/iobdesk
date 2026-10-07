import type { FetchSummaryRow } from '@jobagg/shared';
import { Command, CommandRunner, Option } from 'nest-commander';
import { FetchService } from '../fetch-runs/fetch.service';

interface FetchOptions {
  source?: string;
  force?: boolean;
}

export function formatSummary(rows: FetchSummaryRow[]): string {
  const headers = ['Fonte', 'Esito', 'Trovati', 'Nuovi', 'Aggiornati', 'Duplicati', 'Scartati', 'Note / errori'];
  const table = rows.map((r) => [
    r.source,
    r.status === 'success' ? 'ok' : r.status === 'skipped' ? 'saltata' : 'ERRORE',
    String(r.found),
    String(r.created),
    String(r.updated),
    String(r.duplicates),
    String(r.rejected),
    r.error ?? r.message ?? '',
  ]);
  const widths = headers.map((h, i) => Math.max(h.length, ...table.map((row) => (i < 7 ? row[i]!.length : 0))));
  const line = (cells: string[]) => cells.map((c, i) => (i < 7 ? c.padEnd(widths[i]!) : c)).join('  ');
  const totals = rows.reduce(
    (t, r) => ({
      found: t.found + r.found,
      created: t.created + r.created,
      duplicates: t.duplicates + r.duplicates,
      rejected: t.rejected + r.rejected,
      errors: t.errors + (r.status === 'error' ? 1 : 0),
    }),
    { found: 0, created: 0, duplicates: 0, rejected: 0, errors: 0 },
  );
  return [
    line(headers),
    line(widths.map((w, i) => '-'.repeat(i < 7 ? w : 13))),
    ...table.map(line),
    '',
    `Totale: ${totals.found} trovati, ${totals.created} nuovi, ${totals.duplicates} duplicati, ${totals.rejected} scartati, ${totals.errors} fonti in errore`,
  ].join('\n');
}

@Command({ name: 'fetch', description: 'Raccolta manuale dalle fonti abilitate, con riepilogo per fonte' })
export class FetchCommand extends CommandRunner {
  constructor(private readonly fetch: FetchService) {
    super();
  }

  async run(_params: string[], options: FetchOptions): Promise<void> {
    try {
      const rows = await this.fetch.runAll('cli', options.source, { force: options.force });
      console.log(formatSummary(rows));
      // una fonte in errore non fa fallire il run: l'errore è nel riepilogo e nella pagina Fonti
    } catch (err) {
      console.error((err as Error).message);
      process.exitCode = 1;
    }
  }

  @Option({ flags: '-s, --source <id>', description: 'Raccoglie da una sola fonte (es. remotive)' })
  parseSource(value: string): string {
    return value;
  }

  @Option({ flags: '-f, --force', description: 'Ignora l’attesa minima tra due raccolte manuali' })
  parseForce(): boolean {
    return true;
  }
}
