import type { MailSyncRunDto } from '@jobagg/shared';
import { Command, CommandRunner, Option } from 'nest-commander';
import { MailSyncService } from '../mail/mail-sync.service';

interface MailSyncCliOptions {
  dryRun?: boolean;
  days?: number;
}

export function formatMailSync(run: MailSyncRunDto): string {
  const lines = [
    `${run.dryRun ? '[anteprima] ' : ''}${run.examined} email esaminate: ${run.created} candidature nuove, ` +
      `${run.updated} aggiornate, ${run.duplicates} già registrate, ${run.ignored} scartate`,
  ];
  for (const item of run.details.created) {
    const rejected = item.status === 'rejected' ? '  → rifiutata' : '';
    lines.push(`  + ${item.date}  ${item.company} — ${item.title}  (${item.portal})${rejected}`);
  }
  for (const item of run.details.updated) {
    lines.push(`  ~ ${item.date}  ${item.company} — ${item.title}  ${item.previousStatus} → ${item.status}`);
  }
  for (const warning of run.details.ambiguous) lines.push(`  ! ${warning}`);
  return lines.join('\n');
}

@Command({
  name: 'mail-sync',
  description: 'Legge da Gmail ricevute e rifiuti e aggiorna le candidature (Gmail va prima collegata dal Profilo)',
})
export class MailSyncCommand extends CommandRunner {
  constructor(private readonly sync: MailSyncService) {
    super();
  }

  async run(_params: string[], options: MailSyncCliOptions): Promise<void> {
    try {
      console.log(formatMailSync(await this.sync.run('cli', options)));
    } catch (err) {
      console.error((err as Error).message);
      process.exitCode = 1;
    }
  }

  @Option({ flags: '-n, --dry-run', description: 'Mostra cosa cambierebbe senza scrivere nulla' })
  parseDryRun(): boolean {
    return true;
  }

  @Option({ flags: '-d, --days <n>', description: 'Guarda le email degli ultimi N giorni' })
  parseDays(value: string): number | undefined {
    const n = Number(value);
    return Number.isInteger(n) && n >= 1 && n <= 365 ? n : undefined;
  }
}
