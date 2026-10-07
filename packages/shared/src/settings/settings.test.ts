import { describe, expect, it } from 'vitest';
import {
  defaultSettings,
  diffSettings,
  formatZodIssues,
  isOnboardingComplete,
  parseExtraSkills,
  settingsSchema,
} from './schema';

describe('settingsSchema', () => {
  it("riempie i default: senza paese né P.IVA l'onboarding non è completo", () => {
    const s = defaultSettings();
    expect(s.user.country).toBeUndefined();
    expect(isOnboardingComplete(s)).toBe(false);
    expect(s.contract.without_vat_policy).toBe('penalize');
    expect(s.scoring.llm.enabled).toBe(false);
    expect(s.sources.remotive.enabled).toBe(true);
    expect(s.sources.email_alerts.enabled).toBe(false);
    expect(s.cv.languages).toEqual(['it', 'en']);
  });

  it('accetta una configurazione parziale e normalizza il paese', () => {
    const s = settingsSchema.parse({
      user: { country: 'it', has_vat_number: true },
      sources: { remoteok: { enabled: false } },
    });
    expect(s.user.country).toBe('IT');
    expect(isOnboardingComplete(s)).toBe(true);
    expect(s.sources.remoteok).toEqual({ enabled: false, interval_minutes: 120 });
  });

  it('segnala gli errori sul campo interessato', () => {
    const r = settingsSchema.safeParse({
      user: { country: 'XX', timezone: 'Mars/Olympus' },
      contract: { without_vat_policy: 'boh' },
      cv: { languages: ['it', 'en', 'es', 'de'] },
      sources: { remotive: { interval_minutes: 1 } },
    });
    expect(r.success).toBe(false);
    if (r.success) return;
    const paths = formatZodIssues(r.error).map((e) => e.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        'user.country',
        'user.timezone',
        'contract.without_vat_policy',
        'cv.languages',
        'sources.remotive.interval_minutes',
      ]),
    );
  });

  it('diffSettings elenca le differenze campo per campo', () => {
    const a = settingsSchema.parse({ user: { country: 'IT', has_vat_number: true } });
    const b = settingsSchema.parse({ user: { country: 'US', has_vat_number: true }, keywords: { boost: ['react'] } });
    expect(diffSettings(a, b)).toEqual([
      { path: 'keywords.boost', before: [], after: ['react'] },
      { path: 'user.country', before: 'IT', after: 'US' },
    ]);
    expect(diffSettings(a, a)).toEqual([]);
  });

  it('parseExtraSkills separa righe, virgole ed elenchi puntati', () => {
    expect(parseExtraSkills('- Kubernetes\n• Terraform, AWS Lambda\n\nKubernetes')).toEqual([
      'Kubernetes',
      'Terraform',
      'AWS Lambda',
    ]);
  });
});
