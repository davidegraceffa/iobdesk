/**
 * Tabella paesi: codice ISO 3166-1 alpha-2, nome inglese, fuso IANA di default,
 * valuta ISO 4217 e gruppo geografico da cui derivano regioni e appartenenza UE.
 *
 * Formato compatto `CODE|Name|Timezone|Currency|Group` per restare leggibile e
 * facile da correggere a mano.
 */

export type CountryGroup =
  | 'EU' // stato membro UE
  | 'EEA' // SEE non UE (NO, IS, LI)
  | 'EUR' // resto d'Europa
  | 'UK'
  | 'US'
  | 'CA'
  | 'MX'
  | 'LATAM'
  | 'CARIB'
  | 'ASIA'
  | 'OCE'
  | 'ME'
  | 'NAFR' // Nord Africa (MENA)
  | 'AFR';

export interface Country {
  code: string;
  name: string;
  timezone: string;
  currency: string;
  group: CountryGroup;
  eu: boolean;
}

const RAW = `
AT|Austria|Europe/Vienna|EUR|EU
BE|Belgium|Europe/Brussels|EUR|EU
BG|Bulgaria|Europe/Sofia|BGN|EU
HR|Croatia|Europe/Zagreb|EUR|EU
CY|Cyprus|Asia/Nicosia|EUR|EU
CZ|Czechia|Europe/Prague|CZK|EU
DK|Denmark|Europe/Copenhagen|DKK|EU
EE|Estonia|Europe/Tallinn|EUR|EU
FI|Finland|Europe/Helsinki|EUR|EU
FR|France|Europe/Paris|EUR|EU
DE|Germany|Europe/Berlin|EUR|EU
GR|Greece|Europe/Athens|EUR|EU
HU|Hungary|Europe/Budapest|HUF|EU
IE|Ireland|Europe/Dublin|EUR|EU
IT|Italy|Europe/Rome|EUR|EU
LV|Latvia|Europe/Riga|EUR|EU
LT|Lithuania|Europe/Vilnius|EUR|EU
LU|Luxembourg|Europe/Luxembourg|EUR|EU
MT|Malta|Europe/Malta|EUR|EU
NL|Netherlands|Europe/Amsterdam|EUR|EU
PL|Poland|Europe/Warsaw|PLN|EU
PT|Portugal|Europe/Lisbon|EUR|EU
RO|Romania|Europe/Bucharest|RON|EU
SK|Slovakia|Europe/Bratislava|EUR|EU
SI|Slovenia|Europe/Ljubljana|EUR|EU
ES|Spain|Europe/Madrid|EUR|EU
SE|Sweden|Europe/Stockholm|SEK|EU
NO|Norway|Europe/Oslo|NOK|EEA
IS|Iceland|Atlantic/Reykjavik|ISK|EEA
LI|Liechtenstein|Europe/Vaduz|CHF|EEA
GB|United Kingdom|Europe/London|GBP|UK
CH|Switzerland|Europe/Zurich|CHF|EUR
AL|Albania|Europe/Tirane|ALL|EUR
AD|Andorra|Europe/Andorra|EUR|EUR
AM|Armenia|Asia/Yerevan|AMD|EUR
AZ|Azerbaijan|Asia/Baku|AZN|EUR
BY|Belarus|Europe/Minsk|BYN|EUR
BA|Bosnia and Herzegovina|Europe/Sarajevo|BAM|EUR
GE|Georgia|Asia/Tbilisi|GEL|EUR
XK|Kosovo|Europe/Belgrade|EUR|EUR
MD|Moldova|Europe/Chisinau|MDL|EUR
MC|Monaco|Europe/Monaco|EUR|EUR
ME|Montenegro|Europe/Podgorica|EUR|EUR
MK|North Macedonia|Europe/Skopje|MKD|EUR
RU|Russia|Europe/Moscow|RUB|EUR
SM|San Marino|Europe/San_Marino|EUR|EUR
RS|Serbia|Europe/Belgrade|RSD|EUR
TR|Turkey|Europe/Istanbul|TRY|EUR
UA|Ukraine|Europe/Kyiv|UAH|EUR
VA|Vatican City|Europe/Vatican|EUR|EUR
US|United States|America/New_York|USD|US
CA|Canada|America/Toronto|CAD|CA
MX|Mexico|America/Mexico_City|MXN|MX
AR|Argentina|America/Argentina/Buenos_Aires|ARS|LATAM
BO|Bolivia|America/La_Paz|BOB|LATAM
BR|Brazil|America/Sao_Paulo|BRL|LATAM
CL|Chile|America/Santiago|CLP|LATAM
CO|Colombia|America/Bogota|COP|LATAM
CR|Costa Rica|America/Costa_Rica|CRC|LATAM
EC|Ecuador|America/Guayaquil|USD|LATAM
SV|El Salvador|America/El_Salvador|USD|LATAM
GT|Guatemala|America/Guatemala|GTQ|LATAM
HN|Honduras|America/Tegucigalpa|HNL|LATAM
NI|Nicaragua|America/Managua|NIO|LATAM
PA|Panama|America/Panama|PAB|LATAM
PY|Paraguay|America/Asuncion|PYG|LATAM
PE|Peru|America/Lima|PEN|LATAM
UY|Uruguay|America/Montevideo|UYU|LATAM
VE|Venezuela|America/Caracas|VES|LATAM
BZ|Belize|America/Belize|BZD|LATAM
GY|Guyana|America/Guyana|GYD|LATAM
SR|Suriname|America/Paramaribo|SRD|LATAM
BS|Bahamas|America/Nassau|BSD|CARIB
BB|Barbados|America/Barbados|BBD|CARIB
CU|Cuba|America/Havana|CUP|CARIB
DO|Dominican Republic|America/Santo_Domingo|DOP|CARIB
HT|Haiti|America/Port-au-Prince|HTG|CARIB
JM|Jamaica|America/Jamaica|JMD|CARIB
PR|Puerto Rico|America/Puerto_Rico|USD|CARIB
TT|Trinidad and Tobago|America/Port_of_Spain|TTD|CARIB
AF|Afghanistan|Asia/Kabul|AFN|ASIA
BD|Bangladesh|Asia/Dhaka|BDT|ASIA
BT|Bhutan|Asia/Thimphu|BTN|ASIA
BN|Brunei|Asia/Brunei|BND|ASIA
KH|Cambodia|Asia/Phnom_Penh|KHR|ASIA
CN|China|Asia/Shanghai|CNY|ASIA
HK|Hong Kong|Asia/Hong_Kong|HKD|ASIA
IN|India|Asia/Kolkata|INR|ASIA
ID|Indonesia|Asia/Jakarta|IDR|ASIA
JP|Japan|Asia/Tokyo|JPY|ASIA
KZ|Kazakhstan|Asia/Almaty|KZT|ASIA
KG|Kyrgyzstan|Asia/Bishkek|KGS|ASIA
LA|Laos|Asia/Vientiane|LAK|ASIA
MO|Macau|Asia/Macau|MOP|ASIA
MY|Malaysia|Asia/Kuala_Lumpur|MYR|ASIA
MV|Maldives|Indian/Maldives|MVR|ASIA
MN|Mongolia|Asia/Ulaanbaatar|MNT|ASIA
MM|Myanmar|Asia/Yangon|MMK|ASIA
NP|Nepal|Asia/Kathmandu|NPR|ASIA
PK|Pakistan|Asia/Karachi|PKR|ASIA
PH|Philippines|Asia/Manila|PHP|ASIA
SG|Singapore|Asia/Singapore|SGD|ASIA
KR|South Korea|Asia/Seoul|KRW|ASIA
LK|Sri Lanka|Asia/Colombo|LKR|ASIA
TW|Taiwan|Asia/Taipei|TWD|ASIA
TJ|Tajikistan|Asia/Dushanbe|TJS|ASIA
TH|Thailand|Asia/Bangkok|THB|ASIA
TM|Turkmenistan|Asia/Ashgabat|TMT|ASIA
UZ|Uzbekistan|Asia/Tashkent|UZS|ASIA
VN|Vietnam|Asia/Ho_Chi_Minh|VND|ASIA
AU|Australia|Australia/Sydney|AUD|OCE
NZ|New Zealand|Pacific/Auckland|NZD|OCE
FJ|Fiji|Pacific/Fiji|FJD|OCE
PG|Papua New Guinea|Pacific/Port_Moresby|PGK|OCE
BH|Bahrain|Asia/Bahrain|BHD|ME
IR|Iran|Asia/Tehran|IRR|ME
IQ|Iraq|Asia/Baghdad|IQD|ME
IL|Israel|Asia/Jerusalem|ILS|ME
JO|Jordan|Asia/Amman|JOD|ME
KW|Kuwait|Asia/Kuwait|KWD|ME
LB|Lebanon|Asia/Beirut|LBP|ME
OM|Oman|Asia/Muscat|OMR|ME
PS|Palestine|Asia/Hebron|ILS|ME
QA|Qatar|Asia/Qatar|QAR|ME
SA|Saudi Arabia|Asia/Riyadh|SAR|ME
SY|Syria|Asia/Damascus|SYP|ME
AE|United Arab Emirates|Asia/Dubai|AED|ME
YE|Yemen|Asia/Aden|YER|ME
DZ|Algeria|Africa/Algiers|DZD|NAFR
EG|Egypt|Africa/Cairo|EGP|NAFR
LY|Libya|Africa/Tripoli|LYD|NAFR
MA|Morocco|Africa/Casablanca|MAD|NAFR
TN|Tunisia|Africa/Tunis|TND|NAFR
AO|Angola|Africa/Luanda|AOA|AFR
BJ|Benin|Africa/Porto-Novo|XOF|AFR
BW|Botswana|Africa/Gaborone|BWP|AFR
BF|Burkina Faso|Africa/Ouagadougou|XOF|AFR
BI|Burundi|Africa/Bujumbura|BIF|AFR
CM|Cameroon|Africa/Douala|XAF|AFR
CV|Cape Verde|Atlantic/Cape_Verde|CVE|AFR
TD|Chad|Africa/Ndjamena|XAF|AFR
CD|DR Congo|Africa/Kinshasa|CDF|AFR
CG|Republic of the Congo|Africa/Brazzaville|XAF|AFR
CI|Ivory Coast|Africa/Abidjan|XOF|AFR
ET|Ethiopia|Africa/Addis_Ababa|ETB|AFR
GA|Gabon|Africa/Libreville|XAF|AFR
GM|Gambia|Africa/Banjul|GMD|AFR
GH|Ghana|Africa/Accra|GHS|AFR
GN|Guinea|Africa/Conakry|GNF|AFR
KE|Kenya|Africa/Nairobi|KES|AFR
LS|Lesotho|Africa/Maseru|LSL|AFR
LR|Liberia|Africa/Monrovia|LRD|AFR
MG|Madagascar|Indian/Antananarivo|MGA|AFR
MW|Malawi|Africa/Blantyre|MWK|AFR
ML|Mali|Africa/Bamako|XOF|AFR
MU|Mauritius|Indian/Mauritius|MUR|AFR
MZ|Mozambique|Africa/Maputo|MZN|AFR
NA|Namibia|Africa/Windhoek|NAD|AFR
NE|Niger|Africa/Niamey|XOF|AFR
NG|Nigeria|Africa/Lagos|NGN|AFR
RW|Rwanda|Africa/Kigali|RWF|AFR
SN|Senegal|Africa/Dakar|XOF|AFR
SL|Sierra Leone|Africa/Freetown|SLE|AFR
SO|Somalia|Africa/Mogadishu|SOS|AFR
ZA|South Africa|Africa/Johannesburg|ZAR|AFR
SD|Sudan|Africa/Khartoum|SDG|AFR
TZ|Tanzania|Africa/Dar_es_Salaam|TZS|AFR
TG|Togo|Africa/Lome|XOF|AFR
UG|Uganda|Africa/Kampala|UGX|AFR
ZM|Zambia|Africa/Lusaka|ZMW|AFR
ZW|Zimbabwe|Africa/Harare|USD|AFR
`;

export const COUNTRIES: Record<string, Country> = Object.fromEntries(
  RAW.trim()
    .split('\n')
    .map((line) => {
      const [code, name, timezone, currency, group] = line.split('|') as [string, string, string, string, CountryGroup];
      return [code, { code, name, timezone, currency, group, eu: group === 'EU' }];
    }),
);

/**
 * Alias testuali usati dagli annunci per indicare un paese.
 * Gli alias di 2-3 lettere (US, UK, UAE) nel testo libero sono accettati solo in maiuscolo.
 */
export const COUNTRY_ALIASES: Record<string, string[]> = {
  US: ['usa', 'us', 'u.s.', 'u.s.a.', 'united states of america', 'the states', 'american', 'stati uniti'],
  GB: ['uk', 'u.k.', 'great britain', 'britain', 'england', 'scotland', 'wales', 'british', 'regno unito'],
  AE: ['uae', 'emirates'],
  CZ: ['czech republic'],
  NL: ['the netherlands', 'holland', 'dutch'],
  DE: ['deutschland', 'german', 'germania'],
  IT: ['italia', 'italian'],
  FR: ['french', 'francia'],
  ES: ['españa', 'spanish', 'spagna'],
  PT: ['portuguese'],
  PL: ['polish'],
  CA: ['canadian'],
  AU: ['australian'],
  IN: ['indian'],
  BR: ['brasil', 'brazilian'],
  MX: ['méxico', 'mexican'],
  TR: ['türkiye', 'turkiye'],
  KR: ['korea', 'republic of korea'],
  RU: ['russian federation'],
  CH: ['swiss', 'svizzera'],
  IE: ['irish'],
  CD: ['democratic republic of the congo'],
  CI: ["côte d'ivoire", "cote d'ivoire"],
  MK: ['macedonia'],
  BA: ['bosnia'],
};

const US_STATES =
  'AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC';

/** "San Francisco, CA" / "Columbus, IN": città seguita dalla sigla di uno stato USA. */
export const US_STATE_SUFFIX = new RegExp(`[A-Za-z.]{3,},\\s?(?:${US_STATES})(?![A-Za-z])`);

export function getCountry(code: string | undefined | null): Country | undefined {
  if (!code) return undefined;
  return COUNTRIES[code.toUpperCase()];
}

export function listCountries(): Country[] {
  return Object.values(COUNTRIES).sort((a, b) => a.name.localeCompare(b.name));
}
