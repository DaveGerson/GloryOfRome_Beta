/**
 * WCAG 2.x contrast floor for the design tokens (design/tokens/colors.css and
 * the Nox Romae re-cut in design/nocturne.css).
 *
 * The token files are parsed as text - no browser, no computed styles - and
 * `var(--x)` aliases are resolved against the same file set, so a later
 * retune of an alias or a raw scale value is caught here. Every TEXT token is
 * checked against every SURFACE token it is painted on; AA body text is 4.5:1.
 *
 * NOX is checked on its four grounds but not `--surface-hover`: hover is a
 * transient wash under a pointer, and several metals (laurel, bronze) sit a
 * hair under 4.5 there by design of the night palette.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DESIGN = resolve(__dirname, '../design');

function parseTokens(css: string): Record<string, string> {
  const tokens: Record<string, string> = {};
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  // Only the :root blocks carry tokens.
  for (const block of withoutComments.matchAll(/:root\s*\{([^}]*)\}/g)) {
    for (const decl of block[1].matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);?/gi)) {
      tokens[decl[1]] = decl[2].trim();
    }
  }
  return tokens;
}

function resolveToken(tokens: Record<string, string>, name: string, depth = 0): string {
  const raw = tokens[name];
  if (raw === undefined) throw new Error(`unknown token ${name}`);
  if (depth > 10) throw new Error(`alias cycle at ${name}`);
  const alias = /^var\((--[a-z0-9-]+)\)$/i.exec(raw);
  return alias ? resolveToken(tokens, alias[1], depth + 1) : raw;
}

function luminance(hex: string): number {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) throw new Error(`not a 6-digit hex colour: ${hex}`);
  const channel = (offset: number) => {
    const c = parseInt(match[1].slice(offset, offset + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const lvx = parseTokens(readFileSync(resolve(DESIGN, 'tokens/colors.css'), 'utf8'));
const nox = { ...lvx, ...parseTokens(readFileSync(resolve(DESIGN, 'nocturne.css'), 'utf8')) };

/** Tokens used as the colour of readable text somewhere in components/ or design/. */
const TEXT_TOKENS = [
  '--text-heading', '--text-body', '--text-muted', '--text-quiet',
  '--gold-700', '--crimson-500', '--tyrian-500', '--tyrian-600', '--laurel-500', '--bronze-500',
];
const LVX_SURFACES = ['--surface-page', '--surface-card', '--surface-raised', '--surface-inset', '--surface-hover'];
const NOX_SURFACES = ['--surface-page', '--surface-card', '--surface-raised', '--surface-inset'];
const AA = 4.5;

describe('design tokens meet WCAG AA text contrast', () => {
  it('computes the reference ratios correctly', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#FFFFFF')).toBeCloseTo(4.48, 2);
  });

  for (const [skin, tokens, surfaces] of [['LVX', lvx, LVX_SURFACES], ['NOX', nox, NOX_SURFACES]] as const) {
    for (const text of TEXT_TOKENS) {
      it(`${skin} ${text} reads at >= ${AA}:1 on every surface`, () => {
        const failures = surfaces
          .map(surface => ({ surface, ratio: contrastRatio(resolveToken(tokens, text), resolveToken(tokens, surface)) }))
          .filter(({ ratio }) => ratio < AA)
          .map(({ surface, ratio }) => `${surface} ${ratio.toFixed(2)}`);
        expect(failures).toEqual([]);
      });
    }
  }
});

/**
 * Pairs outside the token-by-surface grid above: a colour set on one
 * particular ground. The Dispatches tablet is dark by day and INVERTS to lit
 * vellum by night, so its quiet ink is read against both gradient stops -
 * the darker night stop is the worst case. Rules are read from the
 * stylesheets themselves, so a retune of either side is caught.
 */
describe('particular text pairs meet WCAG AA contrast', () => {
  const components = readFileSync(resolve(DESIGN, 'components.css'), 'utf8');
  const nocturneCss = readFileSync(resolve(DESIGN, 'nocturne.css'), 'utf8');
  const effects = parseTokens(readFileSync(resolve(DESIGN, 'tokens/effects.css'), 'utf8'));
  const lvxAll = { ...lvx, ...effects };
  const noxAll = { ...lvxAll, ...parseTokens(nocturneCss) };
  const declaration = (css: string, selector: string, property: string): string => {
    const start = css.indexOf(`${selector}{`);
    if (start < 0) throw new Error(`no rule ${selector}`);
    const body = css.slice(start + selector.length + 1, css.indexOf('}', start));
    const match = new RegExp(`(?:^|;)${property}:([^;]+)`).exec(body);
    if (!match) throw new Error(`no ${property} in ${selector}`);
    return match[1].trim();
  };
  const colourOf = (tokens: Record<string, string>, value: string): string => {
    const alias = /^var\((--[a-z0-9-]+)\)$/i.exec(value);
    return alias ? resolveToken(tokens, alias[1]) : value;
  };

  for (const [skin, tokens, surfaces] of [['LVX', lvxAll, LVX_SURFACES], ['NOX', noxAll, NOX_SURFACES]] as const) {
    it(`${skin} tablet quiet ink reads on both stops of the tablet`, () => {
      const stops = resolveToken(tokens, '--tablet-grad').match(/#[0-9a-f]{6}/gi)!;
      expect(stops).toHaveLength(2);
      for (const stop of stops) expect(contrastRatio(resolveToken(tokens, '--tablet-quiet'), stop), stop).toBeGreaterThanOrEqual(AA);
    });

    it(`${skin} the chosen segment's ink reads on its gold`, () => {
      const rule = '.gor-seg-btn[aria-pressed="true"],.gor-seg-btn[aria-checked="true"]';
      const ink = colourOf(tokens, declaration(components, rule, 'color'));
      const ground = colourOf(tokens, declaration(components, rule, 'background'));
      expect(contrastRatio(ink, ground)).toBeGreaterThanOrEqual(AA);
    });

    it(`${skin} the composer's error line reads on every surface`, () => {
      const ink = colourOf(tokens, declaration(components, '.gor-hint-error', 'color'));
      for (const surface of surfaces) {
        expect(contrastRatio(ink, resolveToken(tokens, surface)), surface).toBeGreaterThanOrEqual(AA);
      }
    });
  }

  it('NOX the conflict verdict reads on the night card', () => {
    const ink = declaration(nocturneCss, '.gor-verdict-conflict', 'color');
    expect(contrastRatio(ink, resolveToken(noxAll, '--surface-card'))).toBeGreaterThanOrEqual(AA);
  });
});
