const ESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f' };

/**
 * Valore (anche incompleto) di una proprietà stringa in un JSON che sta ancora arrivando: serve a far
 * pronunciare la battuta dell'intervistatore mentre il modello la sta scrivendo.
 */
export function partialJsonString(text: string, key: string): string {
  const start = new RegExp(`"${key}"\\s*:\\s*"`).exec(text);
  if (!start) return '';
  let out = '';
  let i = start.index + start[0].length;
  while (i < text.length) {
    const char = text[i]!;
    if (char === '"') break;
    if (char !== '\\') {
      out += char;
      i++;
      continue;
    }
    const next = text[i + 1];
    if (next === undefined) break;
    if (next === 'u') {
      const hex = text.slice(i + 2, i + 6);
      if (hex.length < 4) break;
      out += String.fromCharCode(parseInt(hex, 16));
      i += 6;
      continue;
    }
    out += ESCAPES[next] ?? next;
    i += 2;
  }
  return out;
}
