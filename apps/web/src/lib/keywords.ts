import { canonicalTech, type Settings } from '@jobagg/shared';

export type KeywordList = 'boost' | 'required_any' | 'exclude';
type Keywords = Settings['keywords'];

/** Una keyword delle impostazioni indica questa tecnologia? Vale il nome canonico o un suo alias ("postgres" → PostgreSQL). */
function refersTo(keyword: string, tech: string): boolean {
  const k = keyword.trim().toLowerCase();
  return k === tech.toLowerCase() || canonicalTech(k)?.name === tech;
}

/** In quali elenchi delle preferenze compare già la tecnologia. */
export function keywordState(keywords: Keywords, tech: string): Record<KeywordList, boolean> {
  return {
    boost: keywords.boost.some((k) => refersTo(k, tech)),
    required_any: keywords.required_any.some((k) => refersTo(k, tech)),
    exclude: keywords.exclude.some((k) => refersTo(k, tech)),
  };
}

/**
 * Aggiunge la tecnologia a un elenco di keyword, o la toglie se c'è già.
 * "Escluse" è incompatibile con "preferite" e "richieste": aggiungerla da una parte la toglie dall'altra.
 */
export function toggleKeyword(keywords: Keywords, tech: string, list: KeywordList): Keywords {
  const without = (items: string[]) => items.filter((k) => !refersTo(k, tech));
  if (keywordState(keywords, tech)[list]) return { ...keywords, [list]: without(keywords[list]) };

  const next: Keywords = { ...keywords, [list]: [...keywords[list], tech.toLowerCase()] };
  if (list === 'exclude') {
    next.boost = without(next.boost);
    next.required_any = without(next.required_any);
  } else {
    next.exclude = without(next.exclude);
  }
  return next;
}
