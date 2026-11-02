import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

/** Every module a file reaches through relative imports, resolved like the bundler would. */
function graph(entry: string): Set<string> {
  const seen = new Set<string>();
  const visit = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/(?:import|export)\s[^'"]*?from\s+['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
      const specifier = match[1] ?? match[2];
      if (!specifier || specifier.endsWith('.css')) continue;
      const base = resolve(dirname(file), specifier);
      const found = [`${base}.ts`, `${base}.tsx`, base, `${base}/index.ts`, `${base}/index.tsx`].find(p => existsSync(p) && /\.(t|j)sx?$/.test(p));
      if (found) visit(found);
    }
  };
  visit(entry);
  return seen;
}

describe('the stream overlay', () => {
  const reached = [...graph(resolve(here, 'StreamOverlay.tsx'))].map(p => p.slice(here.length + 1));
  it('never reaches the seated HUD, the hand or a card', () => {
    for (const file of reached) expect(file).not.toMatch(/^(Hud|input|keys|walk)\.tsx?$/);
  });
  it('reads only the public frame', () => {
    for (const file of ['StreamOverlay.tsx', 'plate.tsx']) {
      const source = readFileSync(resolve(here, file), 'utf8');
      expect(source).not.toMatch(/\.self\b|CampfireSelf|cardWords|choice/);
    }
  });
});

describe('the walk', () => {
  it('opens a private session only for a walker with an identity', () => {
    const source = readFileSync(resolve(here, 'walk.ts'), 'utf8');
    expect(source).toMatch(/private: walk\.mode === 'walking' && !!walk\.self/);
  });
});
