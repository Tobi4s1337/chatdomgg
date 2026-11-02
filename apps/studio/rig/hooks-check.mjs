// Checks that every product hook, route and param the shot scripts depend on still exists in this worktree's
// build. Run it first after main is merged in (SEAMS.md), then fix the shot scripts to match what changed.
//
//   node apps/studio/rig/hooks-check.mjs            source checks (fast, no browser)
//   node apps/studio/rig/hooks-check.mjs --runtime  also opens the light routes headless and reads their hooks
//
// Exit code 1 when anything is missing.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const read = path => existsSync(join(REPO, path)) ? readFileSync(join(REPO, path), 'utf8') : null;

/** [what, file, pattern, used by] */
const SOURCE = [
  ['GrandEngine export', 'apps/web/src/grand/engine.ts', /export class GrandEngine\b/, 'S04, S19 set pieces'],
  ['GRAND_TIERS export', 'apps/web/src/grand/engine.ts', /export const GRAND_TIERS\b/, 'set pieces (film settings)'],
  ['GrandEngine.land / camera / controls fields', 'apps/web/src/grand/engine.ts', /\bland: GrandLand \| null\b[\s\S]*\bcontrols\b/, 'set pieces (camera paths)'],
  ['GrandEngine frame loop (wrapped by the set)', 'apps/web/src/grand/engine.ts', /private readonly frame = \(now: number\)/, 'set pieces (pose before draw)'],
  ['GrandEngine.onReady', 'apps/web/src/grand/engine.ts', /onReady: \(\(\) => void\) \| null/, 'set pieces (readiness)'],
  ['GrandStats idle fields', 'apps/web/src/grand/engine.ts', /queued: number;[\s\S]*installsPending: number;/, 'set pieces (idle wait)'],
  ['grandChannel()', 'apps/web/src/grand/channels.ts', /export function grandChannel\b/, 'set pieces (channel seeds)'],
  ['/stream route', 'apps/web/src/main.tsx', /'\/stream': '\.\/stream\/index\.tsx'/, 'S01–S03, S08, S09, S22'],
  ['/panel route', 'apps/web/src/main.tsx', /'\/panel':/, 'S01, S09 (panel iframe)'],
  ['stream source=simulated', 'apps/web/src/stream/params.ts', /'simulated', 'herald', 'realm'/, 'stream plates'],
  ['stream seam=starting', 'apps/web/src/stream/params.ts', /'starting', 'break', 'ending'/, 'stream-dusk take'],
  ['stream mood=show', 'apps/web/src/stream/params.ts', /'calm', 'show'/, 'stream-show take'],
  ['__chatdomKingdom.stats (ready, fieldSettled)', 'apps/web/src/kingdom/scene.ts', /fieldSettled:/, 'stream settle'],
  ['__chatdomKingdom.pose', 'apps/web/src/stream/index.tsx', /pose: scene\.pose/, 'TS11 street flights'],
  ['__chatdomKingdom.forge (forgeFixture=1)', 'apps/web/src/stream/index.tsx', /forgeFixture'\) === '1' \? \{ forge: scene\.forge \}/, 'S11, S12'],
  ['__chatdomStream.hold / director', 'apps/web/src/stream/index.tsx', /hold: \(on: boolean\) => director\.hold\(on\)/, 'stream plates'],
  ['stream SIMULATED chip class (hidden by the studio)', 'apps/web/src/stream/stream.css', /\.stream-mark/, 'clean plates'],
  ['stream seam card class (hidden by the studio)', 'apps/web/src/stream/index.tsx', /stream-seam/, 'clean plates'],
  ['panel fixture states (unshared, named)', 'apps/panel/src/adapters/fixture.ts', /'unshared',[\s\S]*'named'/, 'S01, S09, S10, S14'],
  ['panel source=simulated selection', 'apps/panel/src/adapters/select.ts', /query\.get\('source'\) === 'simulated'/, 'panel iframe'],
  ['ui fonts (IM Fell English, Alegreya)', 'packages/ui/src/kit.css', /IM Fell English[\s\S]*Alegreya/, 'cards and captions'],
];

const RUNTIME = [
  { path: '/panel?source=simulated&state=unshared', ready: 'window.__chatdomReady === true', wait: 30 },
];

/**
 * Every product module a set piece imports (src/set/**), and every name it takes from it: the set pieces reach into
 * other lanes' code by read-only import, so a renamed export or a moved file must show up here, not mid-shoot.
 */
function setPieceImports() {
  const out = [];
  const root = join(REPO, 'apps/studio/src/set');
  const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []);
  for (const file of existsSync(root) ? walk(root) : []) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/import\s+(?:type\s+)?(?:\{([^}]*)\}|\*\s+as\s+\w+|\w+)?\s*(?:,\s*\{([^}]*)\})?\s*from\s+'(\.[^']+)'/g)) {
      const spec = m[3];
      const target = resolve(dirname(file), spec.replace(/\?.*$/, ''));
      if (!target.includes('/apps/web/') && !target.includes('/packages/')) continue;
      const candidates = [target, `${target}.ts`, `${target}.tsx`, `${target}.js`, `${target}.mjs`, join(target, 'index.ts'), join(target, 'index.tsx')];
      const found = candidates.find(c => existsSync(c) && statSync(c).isFile());
      const names = `${m[1] ?? ''},${m[2] ?? ''}`.split(',').map(n => n.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]).filter(Boolean);
      out.push({ from: file.slice(REPO.length + 1), spec, found, names });
    }
  }
  return out;
}

/** Whether `file` exports `name`, directly or through `export * from` re-exports. */
function exports(file, name, seen = new Set()) {
  if (seen.has(file) || !/\.[cm]?[jt]sx?$/.test(file)) return seen.size > 0 ? false : true;
  seen.add(file);
  const text = readFileSync(file, 'utf8');
  if (new RegExp(`export\\s+(?:declare\\s+)?(?:abstract\\s+)?(?:async\\s+)?(?:function\\*?|const|let|class|interface|type|enum)\\s+${name}\\b|export\\s*(?:type\\s*)?\\{[^}]*\\b${name}\\b[^}]*\\}`).test(text)) return true;
  for (const m of text.matchAll(/export\s*\*\s*from\s*'([^']+)'/g)) {
    const base = resolve(dirname(file), m[1]);
    const next = [base, `${base}.ts`, `${base}.tsx`, base.replace(/\.js$/, '.ts'), join(base, 'index.ts')].find(c => existsSync(c) && statSync(c).isFile());
    if (next && exports(next, name, seen)) return true;
  }
  return false;
}

let missing = 0;
const rows = [];
for (const use of setPieceImports()) {
  if (!use.found) { missing++; rows.push(`MISSING  module ${use.spec}  (imported by ${use.from})`); continue; }
  for (const name of use.names) {
    const exported = exports(use.found, name);
    if (!exported) missing++;
    rows.push(`${exported ? 'present' : 'MISSING'}  ${name} from ${use.found.slice(REPO.length + 1)}  (set piece ${use.from.replace('apps/studio/src/set/', '')})`);
  }
}
for (const [what, file, pattern, used] of SOURCE) {
  const text = read(file);
  const ok = !!text && pattern.test(text);
  if (!ok) missing++;
  rows.push(`${ok ? 'present' : 'MISSING'}  ${what}  (${file}; ${used})`);
}

if (process.argv.includes('--runtime')) {
  const { chromium } = await import('@playwright/test');
  const { startStudio } = await import('../server/serve.mjs');
  const { LOCAL_ARGS } = await import('./record.mjs');
  const studio = await startStudio({ port: 0, quiet: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: LOCAL_ARGS });
  try {
    for (const route of RUNTIME) {
      const page = await browser.newPage();
      await page.goto(studio.base + route.path);
      const ok = await page.waitForFunction(route.ready, null, { timeout: route.wait * 1000 }).then(() => true, () => false);
      if (!ok) missing++;
      rows.push(`${ok ? 'present' : 'MISSING'}  runtime ${route.path}`);
      await page.close();
    }
  } finally { await browser.close(); await studio.close(); }
}

process.stdout.write(rows.join('\n') + `\n${missing ? `${missing} missing` : 'all present'}\n`);
process.exit(missing ? 1 : 0);
