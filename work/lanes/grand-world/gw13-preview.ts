// Top-down previews of generated worlds (hillshade, cover and water), for judging large forms quickly.
// Not a renderer and not evidence of the look; the real stills come from the kingdom renderer.
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { generateGrandLand } from '../../../packages/world/src/grand/generate';
import { grandWorldTraits, GRAND_LANDFORMS, type GrandLandform } from '../../../packages/world/src/grand/world';
import { Cover, type GrandLand, type GrandLandSeed } from '../../../packages/world/src/grand/types';
import { compileChannelGenesis } from '../../../packages/world/src/genesis';
import { OBSERVED_GENESIS_FIXTURES, OBSERVED_GENESIS_SHOWCASE_CHOICES } from '../../../packages/world/src/genesis/observed-fixtures';
import { grandSeedFromGenesis } from '../../../packages/world/src/grand/world';
import { grandRevealField, grandRevealMask, grandRevealOpening, GRAND_REVEAL_STAGES } from '../../../packages/world/src/grand/reveal';

function png(width: number, height: number, rgb: Uint8Array): Buffer {
  const crcTable = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (buf: Buffer) => { let c = -1; for (const b of buf) c = crcTable[(c ^ b) & 255]! ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (width * 3 + 1)] = 0; Buffer.from(rgb.buffer, rgb.byteOffset + y * width * 3, width * 3).copy(raw, y * (width * 3 + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const COVER: Record<number, [number, number, number]> = {
  [Cover.sand]: [222, 204, 160], [Cover.shingle]: [170, 160, 150], [Cover.grass]: [110, 150, 80], [Cover.meadow]: [140, 170, 90],
  [Cover.forest]: [55, 95, 55], [Cover.field]: [196, 176, 96], [Cover.rock]: [140, 128, 118], [Cover.scree]: [160, 150, 140],
  [Cover.snow]: [240, 242, 248], [Cover.cliff]: [120, 108, 100], [Cover.reserved]: [180, 160, 130], [Cover.hedge]: [70, 110, 60],
};

export function preview(land: GrandLand, scale = 2): { width: number; data: Uint8Array } {
  const size = land.size, w = Math.floor(size / scale), out = new Uint8Array(w * w * 3);
  for (let z = 0; z < w; z++) for (let x = 0; x < w; x++) {
    const sx = x * scale, sz = z * scale, i = sx + sz * size;
    const h = land.ground[i]!, hw = land.ground[Math.max(0, sx - scale) + sz * size]!, hn = land.ground[sx + Math.max(0, sz - scale) * size]!;
    const shade = Math.max(0.35, Math.min(1.35, 1 + ((h - hw) + (h - hn)) * 0.06));
    let c: [number, number, number];
    if (land.water[i]! > land.ground[i]!) {
      const depth = land.water[i]! - land.ground[i]!;
      c = land.water[i]! > land.seaLevel ? [96, 178, 186] : depth > 8 ? [26, 58, 96] : [52, 100, 140];
    } else c = COVER[land.cover[i]!] ?? [120, 140, 90];
    const o = (x + z * w) * 3;
    for (let k = 0; k < 3; k++) out[o + k] = Math.max(0, Math.min(255, c[k]! * (land.water[i]! > land.ground[i]! ? 1 : shade)));
  }
  // Trees as dots.
  for (let t = 0; t < land.treeCount; t++) {
    const x = Math.floor(land.trees[t * 6]! / scale), z = Math.floor(land.trees[t * 6 + 1]! / scale);
    if (x >= 0 && z >= 0 && x < w && z < w) { const o = (x + z * w) * 3; out[o] = 30; out[o + 1] = 70; out[o + 2] = 40; }
  }
  // Sites.
  const mark = (sx: number, sz: number, c: [number, number, number]) => {
    for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) { const x = Math.floor(sx / scale) + dx, z = Math.floor(sz / scale) + dz; if (x >= 0 && z >= 0 && x < w && z < w) out.set(c, (x + z * w) * 3); }
  };
  mark(land.sites.castle.x, land.sites.castle.z, [200, 40, 40]);
  mark(land.sites.town.x, land.sites.town.z, [250, 200, 60]);
  mark(land.sites.harbour.x, land.sites.harbour.z, [40, 40, 200]);
  return { width: w, data: out };
}

const args = process.argv.slice(2);
const outDir = args[0] ?? 'shots/grand-world/gw13';
const only = args[1] as GrandLandform | undefined;
mkdirSync(outDir, { recursive: true });
const biomes = ['woodland', 'highland', 'meadow', 'coastal'] as const;
let n = 0;
// OBSERVED=1: the bench's observed Genesis channels as their own worlds (the seeds `/-/grand-bench?world=1` raises).
if (process.env.OBSERVED) for (const facts of OBSERVED_GENESIS_FIXTURES) {
  const recipe = compileChannelGenesis(facts);
  const choice = OBSERVED_GENESIS_SHOWCASE_CHOICES.find(c => c.broadcasterId === facts.broadcasterId);
  const seed = grandSeedFromGenesis(recipe, facts.broadcasterId, choice ? { character: choice.character } : {});
  const land = generateGrandLand(only && (GRAND_LANDFORMS as readonly string[]).includes(only) ? { ...seed, world: { ...seed.world!, landform: only } } : seed);
  const { width, data } = preview(land);
  writeFileSync(`${outDir}/observed-${facts.broadcasterId}.png`, png(width, width, data));
  const names = Object.fromEntries(Object.entries(Cover).map(([k, v]) => [v, k]));
  const counts: Record<string, number> = {};
  let dry = 0, high = 0;
  for (let k = 0; k < land.cover.length; k++) {
    if (land.water[k]! > land.ground[k]!) continue;
    dry++; const name = names[land.cover[k]!]!; counts[name] = (counts[name] ?? 0) + 1;
    if (land.ground[k]! > land.seaLevel + 60) high++;
  }
  const share = Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, +(v / dry).toFixed(3)]));
  console.log(facts.broadcasterId, seed.world!.landform, seed.biome, seed.character, 'trees', land.treeCount, 'dry', dry, 'high(>30m)', (high / dry).toFixed(2), JSON.stringify(share));
}
if (!process.env.OBSERVED) for (const landform of GRAND_LANDFORMS) {
  if (only && only !== landform && only !== 'all' as string) continue;
  for (const id of ['1001', '2002']) {
    const seedKey = `["channel","${id}${landform.length}"]`;
    const biome = biomes[n++ % 4]!;
    const traits = { ...grandWorldTraits({ seedKey, identity: { biome, landmark: 'lighthouse', profileColourTargets: [] }, character: 'river-valley' }), landform };
    const seed: GrandLandSeed = { seedKey, kingdomId: `${id}${landform.length}`, name: landform, biome, tier: 'hamlet', character: 'river-valley', world: traits };
    const started = performance.now();

    const land = generateGrandLand(seed);
    const { width, data } = preview(land);
    writeFileSync(`${outDir}/${landform}-${id}.png`, png(width, width, data));
    if (process.env.REVEAL) {
      const t = land.sites.town, home = { x0: Math.round(t.x - t.rx), z0: Math.round(t.z - t.rz), x1: Math.round(t.x + t.rx), z1: Math.round(t.z + t.rz) };
      const field = grandRevealField(land, home);
      for (let stage = 0; stage < GRAND_REVEAL_STAGES; stage++) {
        const mask = grandRevealMask(field, stage), misted = Uint8Array.from(data);
        for (let z = 0; z < width; z++) for (let x = 0; x < width; x++) {
          const cx = Math.floor(x * 2 / field.cell), cz = Math.floor(z * 2 / field.cell), clear = mask[cx + cz * field.cells]! / 255;
          const o = (x + z * width) * 3;
          for (let k = 0; k < 3; k++) misted[o + k] = Math.round(misted[o + k]! * clear + 228 * (1 - clear));
        }
        const opening = grandRevealOpening(field, stage);
        console.log('stage', stage, opening.citizens, opening.kind, opening.opened.toFixed(3));
        writeFileSync(`${outDir}/${landform}-${id}-reveal${stage}.png`, png(width, width, misted));
      }
    }
    const ti = Math.round(land.sites.town.x) + Math.round(land.sites.town.z) * land.size;
    const counts: Record<string, number> = {};
    for (const [name, id] of Object.entries(Cover)) counts[name] = 0;
    const names = Object.fromEntries(Object.entries(Cover).map(([k, v]) => [v, k]));
    for (let k = 0; k < land.cover.length; k++) counts[names[land.cover[k]!]!]!++;
    let shore = 0, shoreHigh = 0;
    for (let k = 0; k < land.coast.length; k++) if (land.coast[k] === 3) { shore++; if (land.ground[k]! > land.seaLevel + 8) shoreHigh++; }
    console.log('cover', JSON.stringify({ cliff: counts.cliff, rock: counts.rock, snow: counts.snow, sand: counts.sand, sea: counts.sea }), 'high shore', (shoreHigh / shore).toFixed(2));
    console.log('town ground', land.ground[ti], 'water', land.water[ti], 'sea', land.seaLevel);
    console.log(landform, id, biome, traits.forest.join('+'), `${((performance.now() - started) / 1000).toFixed(1)} s`, JSON.stringify(land.stats.treesBySpecies));
  }
}
