// The tavern from the street at dusk, on the real kingdom page and the real GPU. Two phases:
//   prepare (no lock, no lease): assembles the founded hamlet from its seed with the tavern installed, derives the
//     door the way the realm does, frames the shots from that door and builds tavern/street/page.tsx in place of
//     main.tsx into /tmp/chatdom-gather/street:
//       nice -n 10 node apps/web/src/games/street-still.mjs prepare
//   shoot (inside the lease only; it serves the built page on 127.0.0.1:5192, the PC's tunnel):
//       chatdom-pc-lease --wait 30 -- nice -n 10 node apps/web/src/games/street-still.mjs shoot [street,street-wide]
// Nobody walks in these stills and no crowd is simulated; dev only, never a route or part of the product build.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer as createHttp } from 'node:http';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, createServer } from 'vite';

const repo = fileURLToPath(new URL('../../../..', import.meta.url));
const scratch = '/tmp/chatdom-gather/street';
const evidence = `${repo}work/evidence/gather`;
const seed = process.env.GATHER_PLAN_SEED ?? 'tobi4s_';
const [phase = 'prepare', onlyArg] = process.argv.slice(2);
assert.ok(phase === 'prepare' || phase === 'shoot', 'phase is prepare or shoot');

async function prepare() {
  const loader = await createServer({ root: repo, configFile: false, appType: 'custom', logLevel: 'error', cacheDir: '/tmp/chatdom-gather/vite-harness-loader',
    optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: false, ws: false } });
  try {
    const load = path => loader.ssrLoadModule(path);
    const [{ REFERENCE_KINGDOM }, { tavernPortalFor }, worldPkg, { createGrowthState }, { createRealmState }, { createNativeTown, assembleFoundedScene, compileFoundedScene }] = await Promise.all([
      load('/apps/realm/src/reference.ts'), load('/apps/realm/src/games/portal.ts'), load('/packages/world/src/index.ts'),
      load('/packages/world/src/growth/index.ts'), load('/packages/world/src/realm/reducer.ts'), load('/apps/realm/src/founded/index.ts'),
    ]);
    // The same founding the door-to-table run walks: a hamlet from the seed, the tavern at its first level.
    const plan = worldPkg.generateSettlementPlan({ seed, tier: 'hamlet', firstYear: 2025, year: 2026 });
    const growth = createGrowthState(REFERENCE_KINGDOM, 'simulated');
    const state = { ...createRealmState(REFERENCE_KINGDOM, 'simulated'),
      growth: { ...growth, civic: { ...growth.civic, levels: { tavern: 1, forge: 1, market: 1, bridge: 1, 'castle-court': 1 } } } };
    const { scene } = await assembleFoundedScene({ kingdomId: REFERENCE_KINGDOM, plan, native: createNativeTown(plan), state, collisionRevision: 7 });
    const portal = tavernPortalFor(REFERENCE_KINGDOM, scene, compileFoundedScene(scene));
    assert.ok(portal, 'the installed tavern offers a door');
    const tavern = scene.placements.find(piece => piece.id === 'civic:growth:v1:tavern');
    assert.ok(tavern, 'the tavern is installed');

    // Frames from the door: out of the doorway (against `through`), across the street, at a person's eye and above.
    const { door, returnAnchor } = portal, feet = returnAnchor.feet[1];
    const doorX = (door.min[0] + door.max[0]) / 2, doorZ = (door.min[2] + door.max[2]) / 2;
    const out = [-door.through[0], -door.through[1]], side = [-out[1], out[0]];
    const at = (forward, across, up) => [doorX + out[0] * forward + side[0] * across, feet + up, doorZ + out[1] * forward + side[1] * across];
    const shots = {
      // Standing in the street, a few steps off the door's axis: the door, its lamp and the warm windows.
      street: { eye: at(9, 2.6, 1.7), target: at(-1.5, -0.6, 2.2), fov: 50, hour: 19.5 },
      // Across the square and a little above: the whole tavern, its chimney smoke and the street it stands on.
      'street-wide': { eye: at(15, -4.5, 4.2), target: at(-2.5, 0.5, 2.6), fov: 46, hour: 19.5 },
    };
    await rm(scratch, { recursive: true, force: true });
    await mkdir(scratch, { recursive: true });
    await writeFile(`${scratch}/scene.json`, JSON.stringify(scene));
    await writeFile(`${scratch}/info.json`, JSON.stringify({ kingdomName: 'tobi4s_', shots, seed, door, returnAnchor,
      tavern: { position: tavern.position, rotation: tavern.rotation }, placements: scene.placements.length }, null, 2));
    console.log(`Street: door at ${doorX.toFixed(2)}, ${doorZ.toFixed(2)} facing out ${out.join(', ')}; tavern turn ${tavern.rotation}`);
  } finally { await loader.close(); }

  const swap = { name: 'street-still', enforce: 'pre',
    transform(_code, id) { if (id.split('?')[0] === `${repo}apps/web/src/main.tsx`) return { code: "import './tavern/street/page';", map: null }; } };
  console.log('Street: building the page');
  await build({ root: `${repo}apps/web`, configFile: `${repo}apps/web/vite.config.ts`, plugins: [swap], logLevel: 'warn',
    build: { outDir: `${scratch}/web`, emptyOutDir: true, sourcemap: false, reportCompressedSize: false, chunkSizeWarningLimit: 1e9 } });
  console.log(`Street: ready in ${scratch}`);
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.ttf': 'font/ttf', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.opus': 'audio/ogg' };

function pc(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('chatdom-pc', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', chunk => { out += chunk; }); child.stderr.on('data', chunk => { err += chunk; });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve(out.trim()) : reject(new Error(`chatdom-pc ${args[0]} exited ${code}: ${err.trim() || out.trim()}`)));
  });
}

async function shoot() {
  const info = JSON.parse(await readFile(`${scratch}/info.json`, 'utf8'));
  const scene = await readFile(`${scratch}/scene.json`);
  const root = `${scratch}/web`;
  const names = onlyArg ? onlyArg.split(',') : Object.keys(info.shots);
  for (const name of names) assert.ok(info.shots[name], `no shot named ${name}`);
  // Plain files plus the scene and the frames; no proxies, so a request for any other service fails at once.
  const server = createHttp(async (request, response) => {
    const path = decodeURIComponent(new URL(request.url ?? '/', 'http://street').pathname);
    response.setHeader('Cache-Control', 'no-store');
    if (path === '/__street/scene') { response.setHeader('Content-Type', 'application/json'); response.end(scene); return; }
    if (path === '/__street/info') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(info)); return; }
    const file = normalize(join(root, path === '/' ? 'index.html' : path));
    try {
      if (!file.startsWith(root + sep) && file !== root) throw new Error('outside');
      const body = await readFile(file);
      response.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
      response.end(body);
    } catch {
      if (extname(path)) { response.statusCode = 404; response.end(); return; }
      response.setHeader('Content-Type', TYPES['.html']);
      response.end(await readFile(join(root, 'index.html')));
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(5192, '127.0.0.1', resolve); });
  const report = { started: new Date().toISOString(), seed, door: info.door, returnAnchor: info.returnAnchor, tavern: info.tavern, shots: {} };
  try {
    for (const name of names) {
      const shot = info.shots[name], out = `${evidence}/ga10-street-${name}@1440x900.png`;
      const line = await pc(['shot', `http://localhost:5192/?shot=${name}&hour=${shot.hour}`, out, '--size', '1440x900', '--settle', '3', '--timeout', '150']);
      report.shots[name] = { ...shot, file: out.slice(repo.length), renderer: line };
      console.log(`Street: ${name} → ${out.slice(repo.length)}`);
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
    await writeFile(`${evidence}/ga10-street-report.json`, `${JSON.stringify(report, null, 2)}\n`);
  }
}

await (phase === 'prepare' ? prepare() : shoot());
process.exit(0);
