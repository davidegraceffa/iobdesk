import { salaryEstimateSchema } from '@jobagg/shared';
import { buildSalaryEstimatePrompt } from './salary-estimate.service';

describe('stima della RAL', () => {
  it('il prompt porta ruolo, seniority, stack e area geografica dell’annuncio', () => {
    const prompt = buildSalaryEstimatePrompt({
      title: 'Senior Backend Engineer',
      company: 'Meridian Freight',
      location: 'Berlin, Germany',
      remote: 'hybrid',
      regions: ['eu'],
      restrictedCountries: ['DE'],
      contractType: 'full-time',
      seniority: 'senior',
      techStack: { languages: ['TypeScript', 'Go'] } as never,
      descriptionText: 'x'.repeat(7000),
    });
    expect(prompt.system).toContain('geographic area the posting comes from');
    expect(prompt.user).toContain('Location: Berlin, Germany (remote: hybrid)');
    expect(prompt.user).toContain('Restricted to countries: DE');
    expect(prompt.user).toContain('Seniority: senior');
    expect(prompt.user).toContain('Tech stack: TypeScript, Go');
    expect(prompt.user).toContain('[truncated]');
  });

  it('lo schema normalizza valuta e affidabilità e rifiuta importi assurdi', () => {
    expect(
      salaryEstimateSchema.parse({ min: '52000', max: 68000, currency: 'eur', confidence: 'boh', reasoning: 'ok' }),
    ).toMatchObject({ min: 52000, max: 68000, currency: 'EUR', confidence: 'low', market: '' });
    expect(() => salaryEstimateSchema.parse({ min: 50, max: 70, currency: 'EUR' })).toThrow();
    expect(() => salaryEstimateSchema.parse({ min: 50000, max: 70000, currency: 'euro' })).toThrow();
  });
});
