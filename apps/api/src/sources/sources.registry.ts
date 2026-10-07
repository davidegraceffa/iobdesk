import { Inject, Injectable } from '@nestjs/common';
import { countryInRegion, getCountry, WORLDWIDE } from '@jobagg/shared';
import { SOURCE_ADAPTERS, type SourceAdapter } from './source.types';

/** Registro delle fonti: l'unico punto in cui il resto dell'app conosce gli adapter. */
@Injectable()
export class SourcesRegistry {
  private readonly byId: Map<string, SourceAdapter>;

  constructor(@Inject(SOURCE_ADAPTERS) adapters: SourceAdapter[]) {
    this.byId = new Map(adapters.map((a) => [a.id, a]));
  }

  all(): SourceAdapter[] {
    return [...this.byId.values()];
  }

  get(id: string): SourceAdapter | undefined {
    return this.byId.get(id);
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  /** Una fonte è rilevante se copre tutto il mondo, il paese dell'utente o una regione che lo contiene. */
  isRelevantFor(adapter: SourceAdapter, countryCode: string | undefined): boolean {
    if (!countryCode || !getCountry(countryCode)) return true;
    return adapter.relevantRegions.some(
      (r) => r === WORLDWIDE || r.toUpperCase() === countryCode.toUpperCase() || countryInRegion(countryCode, r),
    );
  }
}
