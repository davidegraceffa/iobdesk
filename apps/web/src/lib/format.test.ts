import { describe, expect, it } from 'vitest';
import { formatLocalSalary, formatRelative, scoreBand } from './format';

describe('format', () => {
  it('conversione nella valuta dell’utente con periodo', () => {
    expect(formatLocalSalary(82800, 110400, 'EUR', 'year')).toMatch(/^≈ 82\.800\s€ – 110\.400\s€ \/ anno$/);
    expect(formatLocalSalary(400, 400, 'EUR', 'day')).toMatch(/^≈ 400\s€ \/ giorno$/);
    expect(formatLocalSalary(null, 690000, 'EUR', 'year')).toMatch(/^≈ fino a 690\.000\s€ \/ anno$/);
    expect(formatLocalSalary(null, null, 'EUR', 'year')).toBeNull();
    expect(formatLocalSalary(1, 2, null, 'year')).toBeNull();
  });

  it('punteggio con etichetta testuale, non solo colore', () => {
    expect(scoreBand(85)).toEqual({ band: 'high', label: 'Alto' });
    expect(scoreBand(55)).toEqual({ band: 'mid', label: 'Medio' });
    expect(scoreBand(20)).toEqual({ band: 'low', label: 'Basso' });
  });

  it('date relative in italiano', () => {
    const now = new Date('2026-10-01T12:00:00Z');
    expect(formatRelative('2026-09-28T12:00:00Z', now)).toBe('3 giorni fa');
    expect(formatRelative('2026-10-01T11:59:40Z', now)).toBe('adesso');
    expect(formatRelative(null, now)).toBe('—');
  });
});
