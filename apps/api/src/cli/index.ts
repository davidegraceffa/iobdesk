// CLI: `docker compose exec api node dist/cli fetch [--source remotive] [--force]`
//      `docker compose exec api node dist/cli mail-sync [--dry-run] [--days 30]`
process.env.APP_MODE = 'cli';

import 'reflect-metadata';
import { CommandFactory } from 'nest-commander';
import { CliModule } from './cli.module';

CommandFactory.run(CliModule, { logger: ['error', 'warn'] })
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
