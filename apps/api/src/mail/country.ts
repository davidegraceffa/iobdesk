/**
 * Country of a job from the free-text location Indeed or the mail gives
 * ("Bron, Auvergne-Rhône-Alpes, FR", "MILANO (MI)", "Lausanne, Vaud, 1003", "Remote"),
 * falling back to hints: "H/F" in a French title, the Indeed domain, the sender's TLD.
 * Returns '' when nothing points anywhere.
 */

export const REMOTE = 'Remoto';

const NAMES: [RegExp, string][] = [
  [/\b(italia|italy|italie)\b/i, 'Italia'],
  [/\b(france|francia)\b/i, 'Francia'],
  [/\b(belgique|belgium|belgio|belgi[eë])\b/i, 'Belgio'],
  [/\b(suisse|switzerland|svizzera|schweiz)\b/i, 'Svizzera'],
  [/\b(ireland|irlanda|irlande)\b/i, 'Irlanda'],
  [/\b(germany|germania|deutschland|allemagne)\b/i, 'Germania'],
  [/\b(spain|spagna|espa[nñ]a|espagne)\b/i, 'Spagna'],
  [/\b(luxembourg|lussemburgo)\b/i, 'Lussemburgo'],
  [/\b(netherlands|paesi bassi|nederland|pays[- ]bas)\b/i, 'Paesi Bassi'],
  [/\b(united kingdom|regno unito|royaume[- ]uni|england|uk)\b/i, 'Regno Unito'],
  [/\b(portugal|portogallo)\b/i, 'Portogallo'],
  [/\b(austria|österreich|autriche)\b/i, 'Austria'],
  [/\b(usa|united states|stati uniti)\b/i, 'Stati Uniti'],
];

const CODES: Record<string, string> = {
  IT: 'Italia',
  FR: 'Francia',
  BE: 'Belgio',
  CH: 'Svizzera',
  IE: 'Irlanda',
  DE: 'Germania',
  ES: 'Spagna',
  LU: 'Lussemburgo',
  NL: 'Paesi Bassi',
  GB: 'Regno Unito',
  UK: 'Regno Unito',
  PT: 'Portogallo',
  AT: 'Austria',
  US: 'Stati Uniti',
};

/** Regions and big cities, for locations that name no country. */
const PLACES: [RegExp, string][] = [
  [
    /\b(lombardia|lazio|piemonte|veneto|emilia|toscana|campania|sicilia|puglia|liguria|trentino|friuli|marche|umbria|abruzzo|sardegna|calabria|milano|roma|torino|bologna|firenze|napoli|genova|padova|verona|bergamo|brescia|monza|lodi|mapello)\b/i,
    'Italia',
  ],
  [
    /\b(auvergne|rh[oô]ne|[iî]le[- ]de[- ]france|grand est|bretagne|occitanie|nouvelle[- ]aquitaine|hauts[- ]de[- ]france|normandie|pays de la loire|bourgogne|provence|centre[- ]val|paris|lyon|marseille|toulouse|bordeaux|nantes|lille|strasbourg|montpellier|rennes|grenoble)\b/i,
    'Francia',
  ],
  [
    /\b(ticino|vaud|gen[eè]ve|geneva|ginevra|z[uü]rich|lugano|lausanne|bern|berne|basel|b[aâ]le|neuch[aâ]tel|fribourg|valais)\b/i,
    'Svizzera',
  ],
  [
    /\b(bruxelles|brussels|waterloo|antwerp(en)?|anvers|gent|ghent|gand|li[eè]ge|wallonie|flanders|namur|leuven|louvain)\b/i,
    'Belgio',
  ],
  [/\b(dublin|dublino|cork|galway|limerick)\b/i, 'Irlanda'],
  [/\b(london|londra|londres|manchester|edinburgh)\b/i, 'Regno Unito'],
  [/\b(berlin|berlino|m[uü]nchen|munich|monaco di baviera|hamburg|frankfurt)\b/i, 'Germania'],
  [/\b(madrid|barcelona|barcellona|valencia)\b/i, 'Spagna'],
  [/\b(amsterdam|rotterdam|utrecht|eindhoven)\b/i, 'Paesi Bassi'],
];

const TLDS: Record<string, string> = {
  it: 'Italia',
  fr: 'Francia',
  be: 'Belgio',
  ch: 'Svizzera',
  ie: 'Irlanda',
  de: 'Germania',
  es: 'Spagna',
  lu: 'Lussemburgo',
  nl: 'Paesi Bassi',
  uk: 'Regno Unito',
  pt: 'Portogallo',
  at: 'Austria',
};

/** "it.indeed.com" → Italia, "jobs@acme.fr" → Francia, "acme.com" → ''. */
export function countryFromHost(hostOrEmail: string): string {
  // also accepts the Portale column as the bot writes it: "Indeed it.indeed.com"
  const host = (hostOrEmail.trim().split(/\s+/).pop()?.split('@').pop() ?? '').toLowerCase();
  if (!host) return '';
  const labels = host.split('.');
  const tld = labels[labels.length - 1] ?? '';
  if (TLDS[tld]) return TLDS[tld]!;
  // Indeed and similar portals put the country in front: it.indeed.com, fr.indeed.com
  const first = labels[0] ?? '';
  return labels.length > 2 && TLDS[first] ? TLDS[first]! : '';
}

export function countryOf(opts: { location?: string; title?: string; hint?: string }): string {
  const loc = (opts.location ?? '').trim();
  if (loc) {
    for (const [re, name] of NAMES) if (re.test(loc)) return name;
    const code = loc.match(/[,\s]([A-Z]{2})\s*$/)?.[1];
    if (code && CODES[code]) return CODES[code]!;
    for (const [re, name] of PLACES) if (re.test(loc)) return name;
    if (/\([A-Z]{2}\)/.test(loc)) return 'Italia'; // province code: "MILANO (MI)"
    if (/\(\d{2,3}\)/.test(loc)) return 'Francia'; // département: "Chambéry (73)"
    if (/\b(remote|remoto|full[- ]remote|t[ée]l[ée]travail|da remoto|anywhere)\b/i.test(loc)) return REMOTE;
  }
  const title = opts.title ?? '';
  if (/\bH\s*\/\s*F\b|\bF\s*\/\s*H\b/.test(title)) return 'Francia'; // "Développeur (H/F)"
  if (/\bm\s*\/\s*w\s*\/\s*d\b/i.test(title)) return 'Germania';
  return countryFromHost(opts.hint ?? '');
}
