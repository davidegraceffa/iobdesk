import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { isOnboardingComplete } from '@jobagg/shared';
import { loadEnv } from './env';
import { dropNulls, SettingsService } from './settings.service';

const CONFIG_DIR = join(__dirname, '../../../../config');

describe('seed config/search.yaml', () => {
  const service = new SettingsService({} as never, { ...loadEnv(), configDir: CONFIG_DIR });

  it('il file di esempio è valido e lascia paese e P.IVA all’onboarding', () => {
    const seed = service.readSeed();
    expect(isOnboardingComplete(seed)).toBe(false);
    expect(seed.keywords.required_any).toEqual(expect.arrayContaining(['typescript', 'nestjs']));
    expect(seed.compensation).toMatchObject({
      min_yearly: 45000,
      fx_rates_to_local: { USD: 0.92, GBP: 1.17, CHF: 1.05 },
    });
    expect(seed.sources.email_alerts).toEqual({ enabled: false, interval_minutes: 60 });
    expect(seed.scoring.llm.enabled).toBe(false);
  });

  it('con paese e P.IVA valorizzati nel seed l’onboarding risulta già completo', () => {
    const raw = parseYaml(readFileSync(join(CONFIG_DIR, 'search.yaml'), 'utf8')) as Record<string, unknown>;
    const result = service.validate({ ...raw, user: { country: 'it', has_vat_number: false } });
    expect(result.success && isOnboardingComplete(result.settings)).toBe(true);
  });

  it('le chiavi YAML senza valore valgono come assenti', () => {
    expect(dropNulls({ user: null, a: { b: null, c: [1, null, 2] }, d: 0, e: false })).toEqual({
      a: { c: [1, 2] },
      d: 0,
      e: false,
    });
    expect(service.validate({ user: null, keywords: { boost: null } })).toMatchObject({ success: true });
  });

  it('un seed assente non blocca l’avvio: si parte dai default', () => {
    const missing = new SettingsService({} as never, { ...loadEnv(), configDir: '/nonexistent' });
    expect(missing.readSeed().keywords.required_any).toEqual([]);
  });

  it('segnala gli errori di validazione per campo', () => {
    expect(service.validate({ user: { country: 'XX' } })).toEqual({
      success: false,
      errors: [expect.objectContaining({ path: 'user.country' })],
    });
  });
});
