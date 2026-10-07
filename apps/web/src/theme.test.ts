// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Verifica automatica del contrasto WCAG AA del tema (chiaro e scuro), a partire dalle
 * variabili OKLCH di index.css: testo normale ≥ 4.5:1, componenti interattivi e focus ≥ 3:1.
 */
const css = readFileSync(fileURLToPath(new URL('./index.css', import.meta.url)), 'utf8');

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  const body = css.slice(start, css.indexOf('\n}', start));
  const vars: Record<string, string> = {};
  for (const m of body.matchAll(/--([\w-]+):\s*oklch\(([^)]+)\)/g)) vars[m[1]!] = m[2]!;
  for (const m of body.matchAll(/--([\w-]+):\s*([\d.]+);/g)) vars[m[1]!] = m[2]!;
  return vars;
}

/** OKLCH → luminanza relativa sRGB (formule di Björn Ottosson). */
function luminance(oklch: string): number {
  const [l, c, h] = oklch.trim().split(/\s+/).map(Number) as [number, number, number];
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const r = clamp(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_);
  const g = clamp(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_);
  const bl = clamp(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_);
  // i valori sono già lineari: la luminanza relativa è la loro combinazione pesata
  return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT_PAIRS: Array<[string, string]> = [
  ['foreground', 'background'],
  ['card-foreground', 'card'],
  ['popover-foreground', 'popover'],
  ['primary-foreground', 'primary'],
  ['secondary-foreground', 'secondary'],
  ['muted-foreground', 'background'],
  ['muted-foreground', 'muted'],
  ['muted-foreground', 'card'],
  ['accent-foreground', 'accent'],
  ['destructive-foreground', 'destructive'],
  ['destructive', 'background'],
  ['destructive', 'card'],
  ['success-foreground', 'success'],
  ['primary-text', 'background'],
  ['primary-text', 'card'],
  ['primary-text', 'accent'],
  ['score-low-foreground', 'score-low'],
  ['score-mid-foreground', 'score-mid'],
  ['score-high-foreground', 'score-high'],
  ['warning-foreground', 'warning'],
  ['highlight-foreground', 'highlight'],
  ['tint-salary-foreground', 'tint-salary'],
  ['tint-geo-foreground', 'tint-geo'],
  ['tint-date-foreground', 'tint-date'],
  ['foreground', 'diff-added'],
  ['foreground', 'diff-removed'],
];

const UI_PAIRS: Array<[string, string]> = [
  ['input', 'background'],
  ['input', 'card'],
  ['primary', 'background'],
  ['primary', 'card'],
  ['focus-outline', 'background'],
  ['focus-outline', 'card'],
  ['success', 'background'],
];

describe.each([
  ['chiaro', block(':root')],
  ['scuro', { ...block(':root'), ...block('.dark') }],
])('tema %s', (_name, vars) => {
  it('il primario è un blu business tendente all’azzurro', () => {
    const [, c, h] = vars.primary!.split(/\s+/).map(Number) as [number, number, number];
    // né grigio né elettrico: saturazione moderata, tinta tra azzurro e blu
    expect(c).toBeGreaterThanOrEqual(0.1);
    expect(c).toBeLessThanOrEqual(0.16);
    expect(h).toBeGreaterThanOrEqual(230);
    expect(h).toBeLessThanOrEqual(250);
    expect(vars.ring).toBe(vars.primary);
  });

  it('i neutri sono freddi e poco saturi (tinta 240-260)', () => {
    for (const name of ['background', 'foreground', 'card', 'muted', 'muted-foreground', 'border', 'secondary']) {
      const [, chroma, hue] = vars[name]!.split(/\s+/).map(Number) as [number, number, number];
      expect(hue, name).toBeGreaterThanOrEqual(240);
      expect(hue, name).toBeLessThanOrEqual(260);
      expect(chroma, name).toBeLessThanOrEqual(0.03);
    }
  });

  it('gli avatar delle aziende sono leggibili per qualunque tinta', () => {
    for (let hue = 0; hue < 360; hue += 30) {
      const bg = `${vars['avatar-bg-l']} 0.07 ${hue}`;
      const fg = `${vars['avatar-fg-l']} 0.09 ${hue}`;
      expect(contrast(fg, bg), `tinta ${hue}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(TEXT_PAIRS)('testo %s su %s: contrasto AA ≥ 4.5', (fg, bg) => {
    expect(contrast(vars[fg]!, vars[bg]!)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(UI_PAIRS)('componente %s su %s: contrasto ≥ 3', (fg, bg) => {
    expect(contrast(vars[fg]!, vars[bg]!)).toBeGreaterThanOrEqual(3);
  });
});
