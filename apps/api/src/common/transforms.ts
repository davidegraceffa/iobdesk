import { Transform } from 'class-transformer';

/** Query string → boolean ("true", "1", "on" sono veri). */
export function ToBoolean(): PropertyDecorator {
  return Transform(({ value }) => {
    if (typeof value === 'boolean') return value;
    if (value === undefined || value === null || value === '') return undefined;
    return ['true', '1', 'on', 'yes'].includes(String(value).toLowerCase());
  });
}

/** Stringa vuota → undefined, così i filtri opzionali vuoti non falliscono la validazione. */
export function EmptyToUndefined(): PropertyDecorator {
  return Transform(({ value }) => (value === '' || value === null ? undefined : value));
}

export function csvEscape(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  // le celle che iniziano con = + - @ vengono neutralizzate per evitare formule nei fogli di calcolo
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n\r;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((row) => row.map(csvEscape).join(',')).join('\r\n') + '\r\n';
}
