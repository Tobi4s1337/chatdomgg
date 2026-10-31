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
      const found = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`].find(p => existsSync(p) && !p.endsWith('/'));
      if (found && /\.(t|j)sx?$/.test(found)) visit(found);
    }
  };
  visit(entry);
  return seen;
}

describe('public stream entry', () => {
  const reached = [...graph(resolve(here, 'public.tsx'))].map(p => p.slice(here.length + 1));
  it('never reaches the private hand, its decoder or the development cast', () => {
    expect(reached).toContain('ports.ts');
    for (const file of reached) expect(file).not.toMatch(/^(self|private|hand|fixture)/);
  });
  it('accepts only public views', () => {
    const source = readFileSync(resolve(here, 'public.tsx'), 'utf8');
    expect(source).not.toMatch(/CampfireSelf|hideSecrets|subscribeSelf/);
  });
});
