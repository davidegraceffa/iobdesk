import { describe, expect, it } from 'vitest';
import { convertToLocal, parseSalary, salaryFromFields, toDaily, toYearly } from './index';

describe('parseSalary: esempi reali dagli annunci', () => {
  it.each([
    // Hacker News "Who is hiring?"
    ['Lumen Labs | Robotics Engineer | SF | ONSITE | Full-time | $130k–200k + equity', 130000, 200000, 'USD', 'year'],
    [
      'Anterior | Senior MTS | On-Site (New York, NY) | Full Time | $230,000–$300,000 + equity',
      230000,
      300000,
      'USD',
      'year',
    ],
    ['Matterhaul | Founding Applied AI Engineer | San Francisco, CA | $200-260K', 200000, 260000, 'USD', 'year'],
    [
      'SaaS Startup | Software Engineer | Full-Time | REMOTE (US) | $180,000 - $250,000 USD',
      180000,
      250000,
      'USD',
      'year',
    ],
    // Remotive (campo salary)
    ['$90k - $105k', 90000, 105000, 'USD', 'year'],
    ['$90 - $150 /hour', 90, 150, 'USD', 'hour'],
    // annunci europei / italiani
    ['Salary: €45k–55k gross/year', 45000, 55000, 'EUR', 'year'],
    ['RAL 35-40k', 35000, 40000, 'EUR', 'year'],
    ['RAL: 40.000 - 50.000 €', 40000, 50000, 'EUR', 'year'],
    ['Offriamo 45.000 € lordi annui', 45000, 45000, 'EUR', 'year'],
    ['Compensation: 60,000 - 80,000 EUR per year', 60000, 80000, 'EUR', 'year'],
    ['£70,000 per annum', 70000, 70000, 'GBP', 'year'],
    ['Daily rate: €400-500', 400, 500, 'EUR', 'day'],
    ['Tariffa giornaliera 350 € al giorno', 350, 350, 'EUR', 'day'],
    ['Rate: 500 EUR/day', 500, 500, 'EUR', 'day'],
    ['$60/hr, 20h per week', 60, 60, 'USD', 'hour'],
    ['Pay: $45 - $65 per hour', 45, 65, 'USD', 'hour'],
    ['€4.500 - €5.500 al mese', 4500, 5500, 'EUR', 'month'],
    ['CHF 120k - 140k', 120000, 140000, 'CHF', 'year'],
    ['Salary range: USD 100,000 to 130,000 annually', 100000, 130000, 'USD', 'year'],
    ['CA$110k–130k', 110000, 130000, 'CAD', 'year'],
  ])('%s', (text, min, max, currency, period) => {
    const s = parseSalary(text);
    expect(s).not.toBeNull();
    expect(s).toMatchObject({ min, max, currency, period });
    expect(text).toContain(s!.rawText.split(' ')[0]);
  });

  it('"up to": valorizza solo il massimo', () => {
    const s = parseSalary('ALBERT | REMOTE | Hiring principal engineers | up to ~ $750k');
    expect(s).toMatchObject({ max: 750000, currency: 'USD', period: 'year' });
    expect(s?.min).toBeUndefined();
    expect(s?.rawText).toMatch(/^up to/);
  });

  it('conserva il frammento originale', () => {
    expect(parseSalary('We pay €45k–55k gross/year plus benefits.')?.rawText).toBe('€45k–55k gross/year');
    expect(parseSalary('Pay: $45 - $65 per hour, remote')?.rawText).toBe('$45 - $65 per hour');
  });
});

describe('parseSalary: non stima e non scambia altre cifre per stipendi', () => {
  it.each([
    'Turquoise|Senior Performance Engineer|FT| Remote USA | 172-195', // nessuna valuta
    'We raised $20M in Series A',
    'Backed by $5 million in funding from top investors',
    'We process $2B in payments every year',
    '$1,000 signing bonus',
    'Home office budget of €500',
    '401k matching and great benefits',
    'More than 10k customers',
    'Competitive salary',
    'Join a team of 50 engineers',
    '',
  ])('%s', (text) => {
    expect(parseSalary(text)).toBeNull();
  });

  it('salta le cifre di funding e trova lo stipendio vero', () => {
    const s = parseSalary('We raised $30M last year. Salary: $140k - $170k.');
    expect(s).toMatchObject({ min: 140000, max: 170000 });
  });
});

describe('campi strutturati e conversioni', () => {
  it('salaryFromFields usa solo valori presenti', () => {
    expect(salaryFromFields({ min: 300900, max: 354000, currency: 'PLN', period: 'yearly' })).toMatchObject({
      min: 300900,
      max: 354000,
      currency: 'PLN',
      period: 'year',
      rawText: '300,900–354,000 PLN/year',
    });
    expect(salaryFromFields({ min: 0, max: 0, currency: 'USD', period: 'year' })).toBeNull();
    expect(salaryFromFields({ min: null, max: null, currency: null, period: 'annual' })).toBeNull();
    expect(salaryFromFields({ min: 50, max: 70, currency: 'usd', period: 'hourly' })?.period).toBe('hour');
    expect(salaryFromFields({ min: 1000, max: 2000, currency: 'USD', period: 'weekly' })).toBeNull();
  });

  it('convertToLocal applica i tassi statici', () => {
    const fx = { USD: 0.92, GBP: 1.17 };
    expect(convertToLocal(100000, 'USD', 'EUR', fx)).toBe(92000);
    expect(convertToLocal(50000, 'EUR', 'EUR', fx)).toBe(50000);
    expect(convertToLocal(50000, 'PLN', 'EUR', fx)).toBeNull();
    expect(convertToLocal(undefined, 'USD', 'EUR', fx)).toBeNull();
  });

  it('riporta a base annua o giornaliera', () => {
    expect(toYearly(4000, 'month')).toBe(48000);
    expect(toYearly(400, 'day')).toBeNull();
    expect(toDaily(50, 'hour')).toBe(400);
    expect(toDaily(60000, 'year')).toBeNull();
  });
});
