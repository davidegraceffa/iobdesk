import { TECH_CATEGORIES, TECH_DICTIONARY, type TechCategory, type TechEntry } from './dictionary';

export type TechStack = Record<TechCategory, string[]>;

export function emptyTechStack(): TechStack {
  return {
    frontend: [],
    backend: [],
    languages: [],
    database: [],
    cloudDevops: [],
    testing: [],
    mobile: [],
    other: [],
  };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface Compiled {
  entry: TechEntry;
  textRe: RegExp;
}

const COMPILED: Compiled[] = TECH_DICTIONARY.map((entry) => {
  if (entry.textPattern) return { entry, textRe: entry.textPattern };
  const alts = [entry.name, ...(entry.aliases ?? [])]
    .sort((a, b) => b.length - a.length)
    .map((a) => escapeRe(a).replace(/\\?\s+/g, '\\s+'));
  // parola intera: non preceduta/seguita da lettere, cifre, o simboli che formano altri nomi (C++, C#, .NET)
  const textRe = new RegExp(`(?<![\\w+#-])(?:${alts.join('|')})(?![\\w+#]|-\\w)`, 'i');
  return { entry, textRe };
});

/** alias (minuscolo) → voce del dizionario, per il match esatto dei tag */
const ALIAS_INDEX: Map<string, TechEntry> = (() => {
  const map = new Map<string, TechEntry>();
  for (const entry of TECH_DICTIONARY) {
    for (const a of [entry.name, ...(entry.aliases ?? [])]) map.set(a.toLowerCase(), entry);
  }
  return map;
})();

const CANONICAL = new Map(TECH_DICTIONARY.map((e) => [e.name.toLowerCase(), e]));

/** Normalizza un nome libero (tag, risposta LLM) sul nome canonico del dizionario. */
export function canonicalTech(name: string): TechEntry | undefined {
  return ALIAS_INDEX.get(name.trim().toLowerCase());
}

export function getTechEntry(canonicalName: string): TechEntry | undefined {
  return CANONICAL.get(canonicalName.toLowerCase());
}

/** Elenco piatto dei nomi canonici trovati nel testo libero. */
export function findTechInText(text: string | null | undefined): string[] {
  if (!text) return [];
  const found: string[] = [];
  for (const { entry, textRe } of COMPILED) {
    textRe.lastIndex = 0;
    if (textRe.test(text)) found.push(entry.name);
  }
  return found;
}

export interface TechSources {
  title?: string;
  description?: string;
  tags?: string[];
}

/** Estrae le tecnologie da titolo, tag e descrizione e le raggruppa per categoria. */
export function extractTechStack({ title, description, tags }: TechSources): TechStack {
  const names = new Set<string>();
  for (const tag of tags ?? []) {
    const entry = canonicalTech(tag);
    if (entry) names.add(entry.name);
  }
  for (const n of findTechInText(title)) names.add(n);
  for (const n of findTechInText(description)) names.add(n);
  return groupTech([...names]);
}

/** Raggruppa per categoria nomi (anche non canonici): quelli sconosciuti vengono scartati. */
export function groupTech(names: string[]): TechStack {
  const stack = emptyTechStack();
  for (const raw of names) {
    const entry = canonicalTech(raw);
    if (!entry) continue;
    const bucket = stack[entry.category];
    if (!bucket.includes(entry.name)) bucket.push(entry.name);
  }
  return stack;
}

export function flattenTechStack(stack: Partial<TechStack> | null | undefined): string[] {
  if (!stack) return [];
  return TECH_CATEGORIES.flatMap((c) => stack[c] ?? []);
}

export function mergeTechStacks(a: TechStack, b: TechStack): TechStack {
  return groupTech([...flattenTechStack(a), ...flattenTechStack(b)]);
}
