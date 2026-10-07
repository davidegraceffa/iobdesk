import { COUNTRIES, type Country, type CountryGroup } from './countries';

/**
 * Regioni normalizzate: ogni regione ha un token canonico, gli alias con cui
 * compare negli annunci e una regola di appartenenza per paese.
 */
export interface RegionDef {
  id: string;
  aliases: string[];
  includes: (c: Country) => boolean;
}

const inGroups =
  (...groups: CountryGroup[]) =>
  (c: Country) =>
    groups.includes(c.group);
const inCodes =
  (...codes: string[]) =>
  (c: Country) =>
    codes.includes(c.code);

const EUROPE: CountryGroup[] = ['EU', 'EEA', 'EUR', 'UK'];
const CET_ZONES = new Set([
  'Europe/Rome',
  'Europe/Berlin',
  'Europe/Paris',
  'Europe/Madrid',
  'Europe/Vienna',
  'Europe/Brussels',
  'Europe/Amsterdam',
  'Europe/Luxembourg',
  'Europe/Zurich',
  'Europe/Vaduz',
  'Europe/Stockholm',
  'Europe/Oslo',
  'Europe/Copenhagen',
  'Europe/Warsaw',
  'Europe/Prague',
  'Europe/Bratislava',
  'Europe/Budapest',
  'Europe/Ljubljana',
  'Europe/Zagreb',
  'Europe/Belgrade',
  'Europe/Sarajevo',
  'Europe/Podgorica',
  'Europe/Skopje',
  'Europe/Tirane',
  'Europe/Malta',
  'Europe/Monaco',
  'Europe/Andorra',
  'Europe/San_Marino',
  'Europe/Vatican',
]);

export const WORLDWIDE = 'worldwide';

export const REGIONS: RegionDef[] = [
  {
    id: WORLDWIDE,
    aliases: [
      'worldwide',
      'world wide',
      'anywhere in the world',
      'anywhere',
      'global',
      'globally',
      'international',
      'work from anywhere',
      'fully remote worldwide',
      'ovunque',
    ],
    includes: () => true,
  },
  { id: 'europe', aliases: ['europe', 'european', 'europa'], includes: inGroups(...EUROPE) },
  {
    id: 'eu',
    aliases: ['eu', 'e.u.', 'european union', 'unione europea', 'ue'],
    includes: inGroups('EU'),
  },
  { id: 'eea', aliases: ['eea', 'european economic area'], includes: inGroups('EU', 'EEA') },
  { id: 'emea', aliases: ['emea'], includes: inGroups(...EUROPE, 'ME', 'NAFR', 'AFR') },
  { id: 'dach', aliases: ['dach'], includes: inCodes('DE', 'AT', 'CH') },
  { id: 'nordics', aliases: ['nordics', 'nordic', 'scandinavia'], includes: inCodes('SE', 'NO', 'DK', 'FI', 'IS') },
  { id: 'benelux', aliases: ['benelux'], includes: inCodes('BE', 'NL', 'LU') },
  { id: 'cet', aliases: ['cet', 'cest', 'central european time'], includes: (c) => CET_ZONES.has(c.timezone) },
  {
    id: 'north america',
    aliases: ['north america', 'northern america', 'north american', 'nord america'],
    includes: inGroups('US', 'CA', 'MX'),
  },
  {
    id: 'americas',
    aliases: ['americas', 'the americas'],
    includes: inGroups('US', 'CA', 'MX', 'LATAM', 'CARIB'),
  },
  {
    id: 'latam',
    aliases: ['latam', 'latin america', 'latin american', 'south america', 'south american', 'central america'],
    includes: inGroups('MX', 'LATAM', 'CARIB'),
  },
  {
    id: 'apac',
    aliases: ['apac', 'asia pacific', 'asia-pacific'],
    includes: inGroups('ASIA', 'OCE'),
  },
  { id: 'asia', aliases: ['asia', 'asian'], includes: inGroups('ASIA') },
  { id: 'oceania', aliases: ['oceania', 'anz'], includes: inGroups('OCE') },
  { id: 'middle east', aliases: ['middle east', 'gcc'], includes: inGroups('ME') },
  { id: 'mena', aliases: ['mena'], includes: inGroups('ME', 'NAFR') },
  { id: 'africa', aliases: ['africa', 'african'], includes: inGroups('NAFR', 'AFR') },
];

const REGION_BY_ID = new Map(REGIONS.map((r) => [r.id, r]));

export function getRegion(id: string): RegionDef | undefined {
  return REGION_BY_ID.get(id.toLowerCase());
}

export function countryInRegion(countryCode: string, regionId: string): boolean {
  const country = COUNTRIES[countryCode.toUpperCase()];
  const region = getRegion(regionId);
  if (!country || !region) return false;
  return region.includes(country);
}

/**
 * Regioni accettate per un paese, es. IT → italy, europe, eu, eea, emea, cet, worldwide.
 * Per gli USA includiamo anche gli alias più usati negli annunci ("usa").
 */
export function acceptedRegionsFor(countryCode: string): string[] {
  const country = COUNTRIES[countryCode.toUpperCase()];
  if (!country) return [WORLDWIDE];
  const own = [country.name.toLowerCase()];
  if (country.code === 'US') own.push('usa');
  if (country.code === 'GB') own.push('uk');
  const regions = REGIONS.filter((r) => r.id !== WORLDWIDE && r.includes(country)).map((r) => r.id);
  return [...own, ...regions, WORLDWIDE];
}
