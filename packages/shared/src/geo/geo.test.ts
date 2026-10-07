import { describe, expect, it } from 'vitest';
import {
  acceptedRegionsFor,
  checkLocation,
  COUNTRIES,
  countryInRegion,
  detectRestrictions,
  getCountry,
  parseLocationSpec,
  parseTimezoneRequirement,
  resolveTimezone,
  timezoneDistance,
  tzOffsetHours,
} from './index';

describe('countries', () => {
  it('conosce paese, fuso, valuta e appartenenza UE', () => {
    expect(getCountry('it')).toMatchObject({ name: 'Italy', timezone: 'Europe/Rome', currency: 'EUR', eu: true });
    expect(getCountry('US')).toMatchObject({ currency: 'USD', eu: false });
    expect(getCountry('GB')?.eu).toBe(false);
    expect(getCountry('ZZ')).toBeUndefined();
  });

  it('ha fusi orari IANA validi per tutti i paesi', () => {
    for (const c of Object.values(COUNTRIES)) {
      expect(() => new Intl.DateTimeFormat('en', { timeZone: c.timezone }), c.code).not.toThrow();
      expect(c.currency, c.code).toMatch(/^[A-Z]{3}$/);
    }
  });
});

describe('acceptedRegionsFor', () => {
  it('IT → italy, europe, eu, emea, cet, worldwide', () => {
    const regions = acceptedRegionsFor('IT');
    for (const r of ['italy', 'europe', 'eu', 'emea', 'cet', 'worldwide']) expect(regions).toContain(r);
    expect(regions).not.toContain('americas');
  });

  it('US → united states, usa, north america, americas, worldwide', () => {
    const regions = acceptedRegionsFor('US');
    for (const r of ['united states', 'usa', 'north america', 'americas', 'worldwide']) expect(regions).toContain(r);
    expect(regions).not.toContain('europe');
  });

  it('appartenenza alle regioni', () => {
    expect(countryInRegion('IT', 'eu')).toBe(true);
    expect(countryInRegion('CH', 'eu')).toBe(false);
    expect(countryInRegion('CH', 'europe')).toBe(true);
    expect(countryInRegion('GB', 'emea')).toBe(true);
    expect(countryInRegion('BR', 'latam')).toBe(true);
    expect(countryInRegion('JP', 'apac')).toBe(true);
    expect(countryInRegion('US', 'emea')).toBe(false);
  });
});

describe('parseLocationSpec (campi location delle fonti)', () => {
  it.each([
    ['USA', { countries: ['US'], regions: [] }],
    ['Worldwide', { countries: [], regions: ['worldwide'] }],
    ['Anywhere in the World', { countries: [], regions: ['worldwide'] }],
    ['Europe', { countries: [], regions: ['europe'] }],
    ['North America Only', { countries: [], regions: ['north america'] }],
    ['Remote - Americas', { countries: [], regions: ['americas'] }],
    ['Northern America, LATAM, Europe, APAC', { countries: [], regions: ['north america', 'latam', 'europe', 'apac'] }],
    ['Argentina,  Canada,  UK', { countries: ['AR', 'CA', 'GB'], regions: [] }],
    ['SIHO - Columbus, IN', { countries: ['US'], regions: [] }],
    ['San Francisco, CA', { countries: ['US'], regions: [] }],
    ['Berlin', { countries: [], regions: [] }],
    ['', { countries: [], regions: [] }],
  ])('%s', (input, expected) => {
    const spec = parseLocationSpec(input);
    expect([...spec.countries].sort()).toEqual([...expected.countries].sort());
    expect([...spec.regions].sort()).toEqual([...expected.regions].sort());
  });

  it('USA, Canada, Argentina, Mexico, Peru', () => {
    expect(parseLocationSpec('USA, Canada, Argentina, Mexico, Peru').countries.sort()).toEqual(
      ['AR', 'CA', 'MX', 'PE', 'US'].sort(),
    );
  });
});

describe('detectRestrictions (testo libero)', () => {
  it.each([
    ['This position is US only.', ['US']],
    ['Remote (US)', ['US']],
    ['REMOTE (US time zones)', ['US']],
    ['Candidates must reside in Canada.', ['CA']],
    ['UK residents only', ['GB']],
    ['You must be authorized to work in the United States', ['US']],
    ['Remote USA', ['US']],
    ['Open to US-based candidates', ['US']],
    ['Senior Engineer (US or Canada only)', ['US', 'CA']],
    ['Must be located in the United Kingdom', ['GB']],
  ])('%s', (text, countries) => {
    expect(detectRestrictions(text).countries.sort()).toEqual([...countries].sort());
  });

  it('riconosce le aree', () => {
    expect(detectRestrictions('This role is EU only').regions).toEqual(['eu']);
    expect(detectRestrictions('Remote in Europe').regions).toEqual(['europe']);
    expect(detectRestrictions('Remote - EMEA').regions).toEqual(['emea']);
  });

  it('non scambia parole comuni per paesi', () => {
    expect(detectRestrictions('Join us only if you love remote work. Contact us.')).toEqual({
      regions: [],
      countries: [],
    });
    expect(detectRestrictions('We are a remote team with customers in the US and Europe.')).toEqual({
      regions: [],
      countries: [],
    });
    expect(detectRestrictions('Work with us remotely, in a great team')).toEqual({ regions: [], countries: [] });
  });
});

describe('checkLocation', () => {
  it('"US only": scartato per IT, accettato per US', () => {
    const spec = detectRestrictions('US only');
    expect(checkLocation('IT', spec)).toMatchObject({ ok: false, restrictedTo: 'United States' });
    expect(checkLocation('US', spec)).toMatchObject({ ok: true, match: 'country' });
  });

  it('"EU only": accettato per IT, scartato per US', () => {
    const spec = detectRestrictions('EU only');
    expect(checkLocation('IT', spec)).toMatchObject({ ok: true, match: 'region' });
    expect(checkLocation('US', spec)).toMatchObject({ ok: false, restrictedTo: 'EU' });
  });

  it('worldwide e vincolo assente sono sempre compatibili', () => {
    expect(checkLocation('IT', parseLocationSpec('Worldwide'))).toMatchObject({ ok: true, match: 'worldwide' });
    expect(checkLocation('IT', parseLocationSpec('Berlin'))).toMatchObject({ ok: true, match: 'unknown' });
  });

  it('le regioni extra delle impostazioni allargano i vincoli accettati', () => {
    const spec = parseLocationSpec('North America Only');
    expect(checkLocation('IT', spec).ok).toBe(false);
    expect(checkLocation('IT', spec, ['north america']).ok).toBe(true);
    expect(checkLocation('IT', parseLocationSpec('Switzerland'), ['Switzerland']).ok).toBe(true);
  });

  it("elenco di paesi che include quello dell'utente", () => {
    expect(checkLocation('IT', parseLocationSpec('Germany, Italy, Spain')).match).toBe('country');
  });
});

describe('fusi orari', () => {
  const winter = new Date('2026-01-15T12:00:00Z');
  const summer = new Date('2026-07-15T12:00:00Z');

  it("calcola l'offset UTC, anche frazionario e con ora legale", () => {
    expect(tzOffsetHours('Europe/Rome', winter)).toBe(1);
    expect(tzOffsetHours('Europe/Rome', summer)).toBe(2);
    expect(tzOffsetHours('America/New_York', winter)).toBe(-5);
    expect(tzOffsetHours('Asia/Kolkata', winter)).toBe(5.5);
  });

  it('deriva il fuso dal paese se non indicato o non valido', () => {
    expect(resolveTimezone('IT')).toBe('Europe/Rome');
    expect(resolveTimezone('IT', 'Europe/Lisbon')).toBe('Europe/Lisbon');
    expect(resolveTimezone('US', 'Not/AZone')).toBe('America/New_York');
  });

  it('estrae i fusi richiesti dalle frasi che parlano di orari', () => {
    expect(parseTimezoneRequirement('Must overlap with EST working hours')).toEqual([-5]);
    expect(parseTimezoneRequirement('Time zone: UTC-8 to UTC-5')).toEqual([-8, -7, -6, -5]);
    expect(parseTimezoneRequirement('We work in US time zones')).toEqual([-8, -7, -6, -5]);
    expect(parseTimezoneRequirement('4 hours overlap with CET required')).toEqual([1]);
    expect(parseTimezoneRequirement('Working hours: GMT+2')).toEqual([2]);
  });

  it('ignora sigle fuori contesto', () => {
    expect(parseTimezoneRequirement('We use the EST framework and PST files.')).toEqual([]);
    expect(parseTimezoneRequirement('')).toEqual([]);
  });

  it("distanza dal fuso dell'utente", () => {
    expect(timezoneDistance(1, [-8, -5])).toBe(6);
    expect(timezoneDistance(1, [0, 1, 2])).toBe(0);
    expect(timezoneDistance(1, [])).toBeNull();
  });
});
