import { Command, CommandRunner } from 'nest-commander';
import { RecomputeService } from '../pipeline/recompute.service';

@Command({
  name: 'recompute',
  description: 'Ricalcola filtri e punteggi di tutti gli annunci con le impostazioni correnti',
})
export class RecomputeCommand extends CommandRunner {
  constructor(private readonly recompute: RecomputeService) {
    super();
  }

  async run(): Promise<void> {
    const { total, changed } = await this.recompute.run();
    console.log(`Ricalcolo completato: ${changed} annunci aggiornati su ${total}`);
  }
}
