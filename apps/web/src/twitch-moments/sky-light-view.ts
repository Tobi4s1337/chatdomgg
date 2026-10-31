import * as THREE from 'three';
import { MAT, MATERIALS } from '@chatdom/content';
import type { Vec3, VoxelBlueprint } from '@chatdom/shared';
import { clothCell, type BannerKit } from './banner';
import { skyText, type SkyText } from './sky-font';
import {
  POWER_UP_BEAT, RUNG_RANK, SKY_BEAT, SKY_LIMITS, hash01, type ApprovedEffect, type SkyBeatFrame, type SkyOrigin, type SpectacleLayer,
  type SpectacleLayerHost, type SpectaclePlaces,
} from './spectacle';

/**
 * The light of "cheer… and the sky answers": sparks, shells, the aurora, the name in sparks, Power-up confetti and
 * the speech bubble's shimmer. Everything is a cube from one shared pool, coloured from the kingdom's palette:
 *
 * - Light: one additive InstancedMesh of unit boxes. A mote fades by its colour going to black, so there is no
 *   per-instance alpha and nothing sorts. No fog and no tone mapping, so a far burst stays a clean point of light.
 * - Paper: one normal-blended InstancedMesh for confetti, shaded by its own tumble (a flat cube glints as it turns).
 *
 * Every pose is a pure function of `frame.t`, `frame.seed` and the supplied places; nothing integrates between
 * frames. Both pools share SKY_LIMITS.motes: beats are drawn highest rung first, so a crowded sky thins the small
 * cheers before it ever cuts a name or an emote in half.
 *
 * Facing: images (emotes, the kingdom's star and crest, the name) are drawn on a vertical plane facing "the town's
 * front": the horizontal direction from the castle crown toward the sky's centre, which is where the castle is
 * seen from. Without both places it faces +z.
 */

type RGB = readonly [number, number, number];
type P3 = [number, number, number];

const LIGHT_CAP = SKY_LIMITS.motes;
/** Two overlapping celebrations of three bursts each, at most. */
const PAPER_CAP = 2 * 3 * 64;

// ---------------------------------------------------------------- palette

const colourOf = (id: number): THREE.Color => new THREE.Color(MATERIALS.materials.find(m => m.id === id)?.colour ?? '#ffffff');
const tuple = (c: THREE.Color): RGB => [c.r, c.g, c.b];
const hsl = { h: 0, s: 0, l: 0 };
const lights = new Map<number, RGB>(), papers = new Map<number, RGB>(), emoteLights = new Map<number, RGB>();
/** A palette colour as light: the same hue, pushed toward the saturated spectacle end of its ramp. */
function L(id: number): RGB {
  let c = lights.get(id);
  if (!c) {
    const colour = colourOf(id);
    colour.getHSL(hsl, THREE.SRGBColorSpace);
    colour.setHSL(hsl.h, Math.min(1, hsl.s * 1.3 + 0.14), Math.min(0.74, Math.max(0.5, hsl.l * 1.12 + 0.08)), THREE.SRGBColorSpace);
    c = tuple(colour);
    lights.set(id, c);
  }
  return c;
}
/** An emote's own colour as light: hue and value kept, dark outlines lifted just enough to stay visible as light. */
function E(id: number): RGB {
  let c = emoteLights.get(id);
  if (!c) {
    const colour = colourOf(id);
    colour.getHSL(hsl, THREE.SRGBColorSpace);
    colour.setHSL(hsl.h, Math.min(1, hsl.s * 1.12), Math.min(0.8, Math.max(0.26, hsl.l) * 1.12), THREE.SRGBColorSpace);
    c = tuple(colour);
    emoteLights.set(id, c);
  }
  return c;
}
/** A palette colour as paper, unlit. */
function P(id: number): RGB {
  let c = papers.get(id);
  if (!c) { c = tuple(colourOf(id)); papers.set(id, c); }
  return c;
}
const WARM: RGB = tuple(new THREE.Color('#fff1cf'));
/** Kingdom colours lead every shell: Hearth's red and gold, Tide's blue and cream. */
const KIT_HUES: Record<BannerKit, readonly number[]> = { hearth: [MAT.fabricRed, MAT.fabricGold], tide: [MAT.fabricBlue, MAT.cream] };
const SHELL_HUES = [MAT.fabricGold, MAT.fabricRed, MAT.fabricBlue, MAT.petal, MAT.cream, MAT.fabricGreen, MAT.fabricViolet, MAT.fabricOrange] as const;
const CONFETTI = [MAT.fabricRed, MAT.fabricGold, MAT.fabricBlue, MAT.fabricGreen, MAT.petal, MAT.cream, MAT.fabricViolet, MAT.fabricOrange] as const;
/** Aurora curtains, bottom edge to top: green and teal low, violet and rose where the light thins. */
const AURORA = [
  [MAT.skinFeyMoss, MAT.fabricGreen, MAT.fabricGreen, MAT.fabricViolet],
  [MAT.fabricGreen, MAT.fabricGreen, MAT.waterbed, MAT.petal],
  [MAT.waterbed, MAT.fabricGreen, MAT.fabricViolet, MAT.petal],
] as const;
const AURORA_ALPHA = [0.3, 0.22, 0.15, 0.09] as const;

// ---------------------------------------------------------------- small maths

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a: number, b: number, x: number) => { const k = clamp01((x - a) / (b - a)); return k * k * (3 - 2 * k); };
const easeOut = (k: number) => 1 - (1 - k) ** 3;
const easeBack = (k: number) => 1 + 2.4 * (k - 1) ** 3 + 1.4 * (k - 1) ** 2;
const rnd = (seed: number, salt: number) => hash01(seed, salt);
const mix = (a: RGB, b: RGB, k: number): P3 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
/** Cooling from white-gold through orange to a dull red ember, 0..1. */
const ember = (k: number): P3 => (k < 0.5 ? mix(mix(WARM, L(MAT.goldLeaf), 0.5), L(MAT.fabricOrange), k * 2) : mix(L(MAT.fabricOrange), L(MAT.fabricRed), (k - 0.5) * 2));

// ---------------------------------------------------------------- the pool

class Motes {
  readonly light: THREE.InstancedMesh;
  readonly paper: THREE.InstancedMesh;
  lit = 0;
  sheets = 0;
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly colour = new THREE.Color();
  constructor(geometry: THREE.BufferGeometry, lightMaterial: THREE.Material, paperMaterial: THREE.Material) {
    this.light = pooled(geometry, lightMaterial, LIGHT_CAP);
    this.paper = pooled(geometry, paperMaterial, PAPER_CAP);
  }
  room(): number { return Math.max(0, SKY_LIMITS.motes - this.lit - this.sheets); }
  begin(): void { this.lit = 0; this.sheets = 0; }
  /** One axis-aligned box of light; colours are premultiplied by brightness. Returns false when the sky is full. */
  box(x: number, y: number, z: number, sx: number, sy: number, sz: number, c: RGB, k: number): boolean {
    const r = c[0] * k, g = c[1] * k, b = c[2] * k;
    if (r + g + b < 0.008 || sx <= 0.005) return true;
    if (this.lit >= LIGHT_CAP || this.room() <= 0) return false;
    const i = this.lit++, m = this.light.instanceMatrix.array as Float32Array, o = i * 16, col = this.light.instanceColor!.array as Float32Array;
    m.fill(0, o, o + 16);
    m[o] = sx; m[o + 5] = sy; m[o + 10] = sz; m[o + 12] = x; m[o + 13] = y; m[o + 14] = z; m[o + 15] = 1;
    col[i * 3] = r; col[i * 3 + 1] = g; col[i * 3 + 2] = b;
    return true;
  }
  cube(p: Readonly<P3>, size: number, c: RGB, k: number): boolean { return this.box(p[0], p[1], p[2], size, size, size, c, k); }
  sheet(p: Readonly<P3>, q: THREE.Quaternion, sx: number, sy: number, sz: number, c: RGB, k: number): boolean {
    if (sx <= 0.005) return true;
    if (this.sheets >= PAPER_CAP || this.room() <= 0) return false;
    const i = this.sheets++;
    this.paper.setMatrixAt(i, this.matrix.compose(this.position.set(p[0], p[1], p[2]), q, this.scale.set(sx, sy, sz)));
    this.paper.setColorAt(i, this.colour.setRGB(c[0] * k, c[1] * k, c[2] * k));
    return true;
  }
  end(): void {
    for (const [mesh, count] of [[this.light, this.lit], [this.paper, this.sheets]] as const) {
      mesh.count = count;
      mesh.visible = count > 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
  dispose(): void { this.light.dispose(); this.paper.dispose(); }
}
function pooled(geometry: THREE.BufferGeometry, material: THREE.Material, capacity: number): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  mesh.visible = false;
  // The pool moves every frame across the whole sky; its bounds would always be stale.
  mesh.frustumCulled = false;
  return mesh;
}

// ---------------------------------------------------------------- pixel images (emotes, the star, the crest)

interface Pixel { readonly x: number; readonly y: number; readonly c: RGB }
/** A front-facing image in cells, centred on the origin; +x to the viewer's right, +y up. */
interface Pixels { readonly cells: readonly Pixel[]; readonly size: number }

/** Emotes are pictured at most 16 cells across, so seven bursts in the air at once stay inside the budget. */
const EMOTE_MAX_CELLS = 16;
/**
 * An approved emote's first frame, seen from the front (+z, the blueprint's outward face): each coarse cell takes
 * the material of the front-most box that covers it, and is lit when boxes cover at least 40% of its area.
 */
function rasterize(blueprint: VoxelBlueprint): Pixels | null {
  const [sx, sy] = blueprint.size, block = Math.max(1, Math.ceil(Math.max(sx, sy) / EMOTE_MAX_CELLS));
  const gw = Math.ceil(sx / block), gh = Math.ceil(sy / block), n = gw * gh;
  const depth = new Int32Array(n).fill(-1), material = new Uint16Array(n), cover = new Float32Array(n);
  for (const box of blueprint.boxes) {
    if (box.material === MAT.air) continue;
    const [x0, y0] = box.from, [x1, y1, front] = box.to;
    for (let gy = Math.floor(y0 / block); gy < Math.ceil(y1 / block); gy++) {
      const oy = Math.min(y1, (gy + 1) * block) - Math.max(y0, gy * block);
      for (let gx = Math.floor(x0 / block); gx < Math.ceil(x1 / block); gx++) {
        const i = gx + gy * gw, ox = Math.min(x1, (gx + 1) * block) - Math.max(x0, gx * block);
        cover[i] = cover[i]! + ox * oy;
        if (front > depth[i]!) { depth[i] = front; material[i] = box.material; }
      }
    }
  }
  const cells: Pixel[] = [];
  for (let i = 0; i < n; i++) {
    if (depth[i]! < 0 || cover[i]! < 0.4 * block * block) continue;
    cells.push({ x: (i % gw) - gw / 2 + 0.5, y: Math.floor(i / gw) - gh / 2 + 0.5, c: E(material[i]!) });
  }
  return cells.length ? { cells, size: Math.max(gw, gh) } : null;
}

/** The kingdom's star: eight points, cream heart, gold arms tipped in the kingdom's first colour. */
function kingdomStar(kit: BannerKit): Pixels {
  const cells: Pixel[] = [], tip = L(KIT_HUES[kit][0]!);
  for (let y = -6; y <= 6; y++) for (let x = -6; x <= 6; x++) {
    const ax = Math.abs(x), ay = Math.abs(y), r = Math.max(ax, ay);
    const arm = (ax === 0 || ay === 0) && r <= 6, diagonal = ax === ay && r <= 4, heart = ax + ay <= 2;
    if (!arm && !diagonal && !heart) continue;
    cells.push({ x, y, c: heart ? mix(WARM, L(MAT.cream), 0.4) : r >= (diagonal ? 4 : 5) ? tip : L(MAT.fabricGold) });
  }
  return { cells, size: 13 };
}
/** The kingdom's crest, the banner's chevron over its lozenge (banner.ts), at two motes per cloth cell. */
function kingdomCrest(kit: BannerKit): Pixels {
  const cells: Pixel[] = [];
  for (let row = 2; row <= 11; row++) for (let col = 1; col <= 7; col++) {
    if (clothCell('1', kit, col, row) !== MAT.cream) continue;
    const c = row <= 5 ? L(MAT.fabricGold) : mix(WARM, L(MAT.cream), 0.5);
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) cells.push({ x: (col - 4) * 2 + dx - 0.5, y: (6.5 - row) * 2 + dy - 0.5, c });
  }
  return { cells, size: 20 };
}

// ---------------------------------------------------------------- the stage

interface Stage {
  readonly places: SpectaclePlaces;
  readonly sky: ReturnType<SpectaclePlaces['sky']>;
  readonly castle: ReturnType<SpectaclePlaces['castle']>;
  /** The town's front (horizontal, unit) and the viewer's right across it. */
  readonly fx: number; readonly fz: number; readonly rx: number; readonly rz: number;
  /** Highest comfortable y for a burst; Infinity without a supplied sky. */
  readonly ceiling: number;
}
/**
 * A burst height at `k` (0..1) through the band from `low` up to `high`, the band lowered under the sky's ceiling
 * but never thinner than 6 m, so shells keep their own heights even when the crown sits close to the ceiling.
 */
const bandY = (stage: Stage, low: number, high: number, k: number) => low + (Math.max(low + 6, Math.min(high, stage.ceiling)) - low) * k;
function originPoint(origin: SkyOrigin, stage: Stage): Vec3 | null {
  if (origin.kind === 'home') return stage.places.roof(origin.slot);
  return origin.place === 'castle' ? stage.castle?.crown ?? null : stage.places.plaza();
}
/** Points sorted into a loop around their centroid, so a walk along them goes round the walls. */
function loopOf(points: readonly Vec3[]): { at(f: number): P3 } | null {
  if (points.length < 2) return null;
  const cx = points.reduce((s, p) => s + p[0], 0) / points.length, cz = points.reduce((s, p) => s + p[2], 0) / points.length;
  const ring = [...points].sort((a, b) => Math.atan2(a[2] - cz, a[0] - cx) - Math.atan2(b[2] - cz, b[0] - cx));
  const lengths = [0];
  for (let i = 1; i <= ring.length; i++) {
    const a = ring[i - 1]!, b = ring[i % ring.length]!;
    lengths.push(lengths[i - 1]! + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
  }
  const total = lengths.at(-1)!;
  return {
    at(f: number): P3 {
      const d = (((f % 1) + 1) % 1) * total;
      let i = 1;
      while (i < lengths.length - 1 && lengths[i]! < d) i++;
      const a = ring[i - 1]!, b = ring[i % ring.length]!, span = lengths[i]! - lengths[i - 1]!, k = span > 0 ? (d - lengths[i - 1]!) / span : 0;
      return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
    },
  };
}

// ---------------------------------------------------------------- shells

type Pattern = 'peony' | 'ring' | 'willow' | 'image';
interface Shell {
  /** Beat ms at launch; the shell rises for `fuse` ms and its burst lives `life` ms. */
  readonly launch: number; readonly fuse: number; readonly life: number;
  readonly from: P3; readonly to: P3;
  readonly pattern: Pattern;
  readonly hues: readonly RGB[];
  readonly seed: number;
  /** Burst radius in metres (peony, ring, willow) and planned star count. */
  readonly radius: number; readonly stars: number;
  readonly image: Pixels | null;
}
const RISE_TRAIL = 8;
const UP = new THREE.Vector3(0, 1, 0);

/**
 * The sky light layer. Handles cheers on the spark, street-fireworks, castle-volley and skyfire rungs, the
 * festival's closing volley, the celebration's confetti and the bubble's shimmer; every other kind is left to its
 * own layer.
 */
export function createSkyLightLayer(root: THREE.Group, host: SpectacleLayerHost): SpectacleLayer<readonly SkyBeatFrame[]> & { glow(): { colour: [number, number, number]; strength: number } } {
  const group = new THREE.Group();
  group.name = 'sky-light';
  root.add(group);
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const lightMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false, fog: false });
  const paperMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: false, depthWrite: true });
  const motes = new Motes(geometry, lightMaterial, paperMaterial);
  motes.light.renderOrder = 5;
  group.add(motes.paper, motes.light);

  const star = kingdomStar(host.kit), crest = kingdomCrest(host.kit);
  /** Rasterized emotes by exact id and revision; a handful at most are live at once. */
  const emotes = new Map<string, Pixels | null>();
  const texts = new Map<string, SkyText>();
  const q = new THREE.Quaternion(), euler = new THREE.Euler();
  const p: P3 = [0, 0, 0], p2: P3 = [0, 0, 0];
  let glowSum = [0, 0, 0], glowWeight = 0, live = 0, columns = 0;
  let lastGlow: { colour: [number, number, number]; strength: number } = { colour: [0, 0, 0], strength: 0 };

  const addGlow = (c: RGB, w: number) => { if (w <= 0) return; glowWeight += w; glowSum = [glowSum[0]! + c[0] * w, glowSum[1]! + c[1] * w, glowSum[2]! + c[2] * w]; };
  const hues = (seed: number, count: number): RGB[] => {
    const kit = KIT_HUES[host.kit], picked = [kit[Math.floor(rnd(seed, 1) * kit.length)]!];
    for (let salt = 2; picked.length < count && salt < 40; salt++) {
      const id = SHELL_HUES[Math.floor(rnd(seed, salt) * SHELL_HUES.length)]!;
      if (!picked.includes(id)) picked.push(id);
    }
    return picked.map(L);
  };
  function emoteImage(effect: ApprovedEffect): Pixels | null {
    const key = `${effect.id}@${effect.revision}`;
    if (!emotes.has(key)) {
      const frame = effect.frames[0];
      emotes.set(key, frame ? rasterize(frame.blueprint) : null);
      while (emotes.size > 8) emotes.delete(emotes.keys().next().value!);
    }
    return emotes.get(key) ?? null;
  }
  function layout(name: string): SkyText {
    let text = texts.get(name);
    if (!text) {
      text = skyText(name);
      texts.set(name, text);
      while (texts.size > 8) texts.delete(texts.keys().next().value!);
    }
    return text;
  }

  // ---------------------------------------------------------------- one shell, launch to quiet end

  function riseAt(s: Shell, tau: number, out: P3, st: Stage): P3 {
    const k = clamp01(tau / s.fuse), e = 1 - (1 - k) ** 2, wobble = Math.sin(tau * 0.016 + s.seed % 97) * 0.14 * k;
    out[0] = s.from[0] + (s.to[0] - s.from[0]) * k + wobble * st.rx;
    out[1] = s.from[1] + (s.to[1] - s.from[1]) * e;
    out[2] = s.from[2] + (s.to[2] - s.from[2]) * k + wobble * st.rz;
    return out;
  }

  function drawShell(s: Shell, t: number, st: Stage): boolean {
    const tau = t - s.launch;
    if (tau < 0 || tau > s.fuse + s.life) return false;
    if (tau < s.fuse) {
      // The launch: a small kick of embers at the mortar, then a climbing head with a cooling trail.
      if (tau < 380) {
        const k = tau / 380;
        for (let i = 0; i < 5; i++) {
          const a = i * 1.2566 + rnd(s.seed, 90) * 6.28;
          motes.box(s.from[0] + Math.cos(a) * 0.9 * easeOut(k), s.from[1] + 0.15 + k * 0.3, s.from[2] + Math.sin(a) * 0.9 * easeOut(k), 0.15, 0.15, 0.15, ember(0.6), 0.55 * (1 - k));
        }
      }
      const fizzle = 1 - 0.45 * smooth(0.82, 1, tau / s.fuse);
      for (let j = 0; j <= RISE_TRAIL; j++) {
        const tj = tau - j * 42;
        if (tj < 0) break;
        riseAt(s, tj, p, st);
        if (j === 0) motes.cube(p, 0.3, mix(WARM, L(MAT.goldLeaf), 0.3), 1.1 * fizzle);
        else motes.cube(p, 0.22 - j * 0.013, ember(j / RISE_TRAIL), 0.85 * (1 - j / (RISE_TRAIL + 1)) * fizzle);
      }
      return true;
    }
    const b = tau - s.fuse, life = s.life, [cx, cy, cz] = s.to;
    // The break: one bright cube at the heart for a quarter second, never a flash of the screen.
    if (b < 260) { const k = 1 - b / 260; motes.box(cx, cy, cz, 0.3 + 0.6 * k, 0.3 + 0.6 * k, 0.3 + 0.6 * k, WARM, 1.2 * k); }
    addGlow(s.hues[0]!, 0.34 * smooth(0, 90, b) * Math.exp(-b / 900) * (1 - smooth(life * 0.6, life, b)));
    if (s.pattern === 'image' && s.image) return drawImage(s, s.image, b, st);
    if (s.pattern === 'ring') return drawRing(s, b, st);
    if (s.pattern === 'willow') return drawWillow(s, b);
    return drawPeony(s, b);
  }

  /** A two-colour peony: an outer sphere in the lead colour (speckled with the third), an inner pistil in the second. */
  function drawPeony(s: Shell, b: number): boolean {
    const life = s.life, n = Math.min(s.stars, Math.floor(motes.room() / 2)), inner = Math.floor(n * 0.3), outer = n - inner;
    const heat = 1 - smooth(0, 380, b), fade = 1 - smooth(life * 0.42, life, b), size = 0.3 * (1 - 0.35 * smooth(life * 0.5, life, b)), spin = rnd(s.seed, 5) * 6.283;
    const at = (bb: number, dx: number, dy: number, dz: number, r: number, out: P3) => {
      const reach = r * (1 - Math.exp(-Math.max(0, bb) / 240)), droop = 0.8 * (Math.max(0, bb) / 1000) ** 2;
      out[0] = s.to[0] + dx * reach; out[1] = s.to[1] + dy * reach - droop; out[2] = s.to[2] + dz * reach;
      return out;
    };
    for (let i = 0; i < n; i++) {
      const isInner = i >= outer, m = isInner ? inner : outer, idx = isInner ? i - outer : i;
      const dy = 1 - (2 * (idx + 0.5)) / m, ring = Math.sqrt(Math.max(0, 1 - dy * dy)), phi = idx * 2.39996 + spin;
      const dx = Math.cos(phi) * ring, dz = Math.sin(phi) * ring, r = s.radius * (isInner ? 0.45 : 1) * (0.86 + 0.14 * rnd(s.seed, i * 3 + 1));
      const hue = isInner ? s.hues[1 % s.hues.length]! : s.hues[s.hues.length > 2 && rnd(s.seed, i * 3 + 2) < 0.3 ? 2 : 0]!;
      const flick = b > life * 0.45 ? (rnd(s.seed + i, Math.floor(b / 70)) > 0.42 ? 1 : 0.18) : 1;
      const colour = mix(hue, WARM, heat);
      motes.cube(at(b, dx, dy, dz, r, p), size, colour, fade * flick);
      if (b > 65) motes.cube(at(b - 65, dx, dy, dz, r, p2), size * 0.66, colour, 0.38 * fade);
    }
    return true;
  }

  /** A ring tilted toward the viewer, with a small core of the second colour. */
  function drawRing(s: Shell, b: number, st: Stage): boolean {
    const life = s.life, n = Math.min(s.stars, Math.floor(motes.room() / 2)), core = Math.floor(n * 0.25), ringN = n - core;
    const normal = new THREE.Vector3(st.fx, 0, st.fz).addScaledVector(UP, (rnd(s.seed, 6) - 0.5) * 1.4)
      .add(new THREE.Vector3(st.rx, 0, st.rz).multiplyScalar((rnd(s.seed, 7) - 0.5) * 0.9)).normalize();
    const u = new THREE.Vector3().crossVectors(normal, UP).normalize(), v = new THREE.Vector3().crossVectors(u, normal);
    const heat = 1 - smooth(0, 340, b), fade = 1 - smooth(life * 0.4, life, b), size = 0.3 * (1 - 0.3 * smooth(life * 0.5, life, b));
    const reach = (bb: number) => 1 - Math.exp(-Math.max(0, bb) / 220), droop = (bb: number) => 0.7 * (Math.max(0, bb) / 1000) ** 2;
    for (let i = 0; i < n; i++) {
      let dx: number, dy: number, dz: number, r: number, hue: RGB;
      if (i < ringN) {
        const a = (i / ringN) * Math.PI * 2;
        dx = Math.cos(a) * u.x + Math.sin(a) * v.x; dy = Math.cos(a) * u.y + Math.sin(a) * v.y; dz = Math.cos(a) * u.z + Math.sin(a) * v.z;
        r = s.radius; hue = s.hues[0]!;
      } else {
        const idx = i - ringN, yy = 1 - (2 * (idx + 0.5)) / core, rr = Math.sqrt(Math.max(0, 1 - yy * yy)), phi = idx * 2.39996;
        dx = Math.cos(phi) * rr; dy = yy; dz = Math.sin(phi) * rr; r = s.radius * 0.3; hue = s.hues[1 % s.hues.length]!;
      }
      const flick = b > life * 0.5 ? (rnd(s.seed + i, Math.floor(b / 75)) > 0.4 ? 1 : 0.2) : 1, colour = mix(hue, WARM, heat);
      motes.box(s.to[0] + dx * r * reach(b), s.to[1] + dy * r * reach(b) - droop(b), s.to[2] + dz * r * reach(b), size, size, size, colour, fade * flick);
      if (b > 60) motes.box(s.to[0] + dx * r * reach(b - 60), s.to[1] + dy * r * reach(b - 60) - droop(b - 60), s.to[2] + dz * r * reach(b - 60), size * 0.66, size * 0.66, size * 0.66, colour, 0.36 * fade);
    }
    return true;
  }

  /** A gold willow: slow, heavy stars that droop into long glittering strands. The quiet end of a volley. */
  function drawWillow(s: Shell, b: number): boolean {
    const life = s.life, n = Math.min(s.stars, Math.floor(motes.room() / 3)), spin = rnd(s.seed, 8) * 6.283;
    const fade = 1 - smooth(life * 0.35, life, b), gold = mix(L(MAT.goldLeaf), L(MAT.fabricGold), 0.5);
    const colour = mix(mix(WARM, gold, smooth(0, 420, b)), L(MAT.fabricOrange), smooth(life * 0.4, life, b) * 0.7);
    const at = (bb: number, dx: number, dy: number, dz: number, out: P3) => {
      const k = Math.max(0, bb), reach = s.radius * 0.8 * (1 - Math.exp(-k / 330)), droop = 2.1 * (k / 1000) ** 2;
      out[0] = s.to[0] + dx * reach; out[1] = s.to[1] + dy * reach - droop; out[2] = s.to[2] + dz * reach;
      return out;
    };
    for (let i = 0; i < n; i++) {
      const dy = 1 - (2 * (i + 0.5)) / n, ring = Math.sqrt(Math.max(0, 1 - dy * dy)), phi = i * 2.39996 + spin, dx = Math.cos(phi) * ring, dz = Math.sin(phi) * ring;
      const flick = b > life * 0.3 ? (rnd(s.seed + i, Math.floor(b / 90)) > 0.3 ? 1 : 0.25) : 1;
      motes.cube(at(b, dx, dy, dz, p), 0.26, colour, fade * flick);
      if (b > 80) motes.cube(at(b - 80, dx, dy, dz, p), 0.2, colour, 0.45 * fade);
      if (b > 160) motes.cube(at(b - 160, dx, dy, dz, p), 0.15, colour, 0.22 * fade);
    }
    return true;
  }

  /**
   * An image burst: the shell breaks and its stars fly out to their places in the picture (rings outward from the
   * heart, with a small overshoot), hold, then droop, twinkle and fade. A gold halo of sparks sells the break.
   * When the sky cannot fit the whole picture it bursts as a peony instead, never as half an emote.
   */
  function drawImage(s: Shell, image: Pixels, b: number, st: Stage): boolean {
    const halo = 20;
    if (motes.room() < image.cells.length + halo) return drawPeony(s, b);
    const life = s.life, pitch = Math.min(0.7, Math.max(0.36, 10 / image.size)), size = pitch * 0.84, hold = life * 0.58;
    const fall = Math.max(0, b - hold) / 1000, dy = -0.75 * fall * fall, spread = 1 + 0.06 * fall, end = 1 - smooth(life * 0.55, life, b);
    image.cells.forEach((cell, i) => {
      const delay = Math.hypot(cell.x, cell.y) * 28, k = clamp01((b - delay) / 520), e = easeBack(k);
      const along = cell.x * pitch * e * spread, upward = cell.y * pitch * e;
      const heat = 1 - smooth(delay, delay + 340, b), flick = b > hold ? (rnd(s.seed + i, Math.floor(b / 80)) > 0.3 ? 1 : 0.3) : 1;
      motes.box(s.to[0] + st.rx * along, s.to[1] + upward + dy, s.to[2] + st.rz * along, size, size, size, mix(cell.c, WARM, heat * 0.8), smooth(delay, delay + 120, b) * end * flick);
    });
    const reachR = image.size * pitch * 0.72, haloFade = 1 - smooth(life * 0.2, life * 0.55, b), gold = L(MAT.fabricGold);
    for (let i = 0; i < halo; i++) {
      const a = (i / halo) * Math.PI * 2 + rnd(s.seed, 9), reach = reachR * (1 - Math.exp(-b / 200)) * (0.9 + 0.2 * rnd(s.seed, 100 + i));
      const lift = Math.sin(a) * reach - 0.6 * (b / 1000) ** 2, side = Math.cos(a) * reach;
      motes.box(s.to[0] + st.rx * side, s.to[1] + lift, s.to[2] + st.rz * side, 0.22, 0.22, 0.22, mix(gold, WARM, 1 - smooth(0, 300, b)), haloFade);
    }
    return true;
  }

  // ---------------------------------------------------------------- the rungs

  /** A single warm mote climbs from the roof, slows, hangs, twinkles once into a small four-point star and fades. */
  function spark(f: SkyBeatFrame, st: Stage): boolean {
    const S = SKY_BEAT.spark, t = f.t, o = originPoint(f.origin, st);
    if (!o || t > S.end) return false;
    const peakH = 10 + rnd(f.seed, 1) * 4, phase = rnd(f.seed, 2) * 6.28, fade = 1 - smooth(S.fade[0], S.fade[1], t);
    const at = (tt: number, out: P3): P3 => {
      let y: number, sway = 0;
      if (tt <= S.launch) y = o[1] + 0.35;
      else if (tt <= S.peak) {
        const k = (tt - S.launch) / (S.peak - S.launch);
        y = o[1] + 0.35 + peakH * easeOut(k);
        sway = Math.sin(k * Math.PI * 2.2 + phase) * 0.35 * 4 * k * (1 - k);
      } else {
        const hang = (tt - S.peak) / 1000;
        y = o[1] + 0.35 + peakH + Math.sin(hang * 2.1) * 0.07 - hang * 0.05;
      }
      out[0] = o[0] + sway * st.rx; out[1] = y; out[2] = o[2] + sway * st.rz;
      return out;
    };
    const head = at(t, [0, 0, 0]), warm = mix(WARM, L(MAT.goldLeaf), 0.35);
    // Before it leaves, the roof's ember brightens: anticipation, then the climb.
    const ready = t < S.launch ? smooth(0, S.launch, t) * 0.7 : 1, tw = t - S.twinkle, twinkle = tw > 0 && tw < 700 ? Math.sin((Math.PI * tw) / 700) : 0;
    motes.cube(head, 0.24 + 0.14 * twinkle, warm, 1.15 * ready * fade);
    addGlow(warm, 0.06 * ready * fade);
    let prev = head;
    for (let j = 1; j <= 9; j++) {
      const pj = at(t - j * 55, [0, 0, 0]), speed = clamp01(Math.hypot(pj[0] - prev[0], pj[1] - prev[1], pj[2] - prev[2]) / 0.5);
      motes.cube(pj, 0.19 - j * 0.012, ember(j / 9), 0.7 * (1 - j / 10) * speed * fade);
      prev = pj;
    }
    if (twinkle > 0) for (let arm = 0; arm < 4; arm++) {
      const ax = arm === 0 ? 1 : arm === 1 ? -1 : 0, ay = arm === 2 ? 1 : arm === 3 ? -1 : 0;
      for (let c = 1; c <= 3; c++) {
        const d = c * 0.22 * (0.4 + 0.6 * twinkle);
        motes.box(head[0] + st.rx * ax * d, head[1] + ay * d, head[2] + st.rz * ax * d, 0.16 - c * 0.025, 0.16 - c * 0.025, 0.16 - c * 0.025, warm, twinkle * (1.1 - c * 0.25) * fade);
      }
    }
    // A few glints shaken loose by the twinkle drift down and go out.
    if (tw > 200 && tw < 1900) for (let i = 0; i < 6; i++) {
      const g = (tw - 200) / 1000, a = rnd(f.seed, 10 + i) * 6.28, side = Math.cos(a) * (0.2 + g * 0.35);
      const on = rnd(f.seed + i, Math.floor(tw / 90)) > 0.4 ? 1 : 0.2;
      motes.box(head[0] + st.rx * side, head[1] - 0.6 * g * g - g * 0.2, head[2] + st.rz * side, 0.09, 0.09, 0.09, warm, 0.8 * (1 - g / 1.7) * on * fade);
    }
    return true;
  }

  /** Three shells from the cheerer's street, in the kingdom's colours: peony, peony or ring, and a quiet willow. */
  function streetFireworks(f: SkyBeatFrame, st: Stage): boolean {
    const B = SKY_BEAT['street-fireworks'], o = originPoint(f.origin, st);
    if (!o || f.t > B.end) return false;
    const ground = st.sky ? st.sky.centre[1] : o[1] - 6;
    let drawn = false;
    B.launches.forEach((launch, i) => {
      const a = rnd(f.seed, 10 + i) * 6.283, d = 2 + rnd(f.seed, 20 + i) * 3.5, from: P3 = [o[0] + Math.cos(a) * d, o[1] - 0.4, o[2] + Math.sin(a) * d];
      const low = Math.max(from[1] + 12, ground + 25), y = bandY(st, low, Math.max(low, ground + 35), rnd(f.seed, 30 + i)), drift = (rnd(f.seed, 40 + i) - 0.5) * 5;
      const pattern: Pattern = i === 2 ? 'willow' : i === 1 && rnd(f.seed, 50) < 0.5 ? 'ring' : 'peony';
      drawn = drawShell({
        launch, fuse: B.fuse, life: B.burst, from, to: [from[0] + st.rx * drift, y, from[2] + st.rz * drift], pattern,
        hues: hues(f.seed + i * 101, 2 + Math.floor(rnd(f.seed, 60 + i) * 2)), seed: f.seed + i * 7, radius: 6 + rnd(f.seed, 70 + i) * 2, stars: 64, image: null,
      }, f.t, st) || drawn;
    });
    return drawn;
  }

  /**
   * Seven shells off the castle walls in a rising fan, each bursting into the approved emote, or, with none, the
   * kingdom's star and crest in turn. The fan opens from the centre outward, each break higher than the last.
   */
  function castleVolley(f: SkyBeatFrame, st: Stage): boolean {
    const B = SKY_BEAT['castle-volley'], castle = st.castle;
    if (!castle || f.t > B.end) return false;
    const emote = f.effect ? emoteImage(f.effect) : null, fan = [0, -1, 1, -2, 2, -3, 3] as const;
    let drawn = false;
    B.launches.forEach((launch, i) => {
      // Pictures are about 10 m across, so neighbours in the fan stand a picture apart.
      const lat = fan[i]! * 9.5, c = castle.crown, y = bandY(st, c[1] + 9, c[1] + 30, 0.3 + (0.7 * i) / 6);
      const aim: P3 = [c[0] + st.rx * lat + st.fx * 2, y, c[2] + st.rz * lat + st.fz * 2];
      // Each shell leaves from the wall point nearest its place in the fan; the crown when no walls are supplied.
      const from = castle.walls.reduce<Vec3>((best, w) => (Math.hypot(w[0] - aim[0], w[2] - aim[2]) < Math.hypot(best[0] - aim[0], best[2] - aim[2]) ? w : best), castle.walls[0] ?? c);
      const image = f.effect ? emote : i % 2 === 0 ? star : crest;
      drawn = drawShell({
        launch, fuse: B.fuse, life: B.burst, from: [from[0], from[1], from[2]], to: aim, pattern: image ? 'image' : 'peony',
        hues: hues(f.seed + i * 131, 3), seed: f.seed + i * 11, radius: 6.5, stars: 56, image,
      }, f.t, st) || drawn;
    });
    return drawn;
  }

  /** Skyfire: the cheer climbs from home, the aurora unrolls, the name is written in sparks, a procession walks the walls. */
  function skyfire(f: SkyBeatFrame, st: Stage): boolean {
    const B = SKY_BEAT.skyfire;
    if (f.t > B.end) return false;
    const sky = st.sky, o = originPoint(f.origin, st);
    let drawn = false;
    const centre: P3 | null = sky ? [sky.centre[0] - st.fx * sky.radius * 0.15, sky.centre[1] + sky.ceiling * 0.86, sky.centre[2] - st.fz * sky.radius * 0.15] : null;
    if (o && centre) drawn = comet(f, o, centre) || drawn;
    if (sky && centre) drawn = name(f, centre, sky.radius, st.castle ? st.castle.crown[1] + 6 : -Infinity, st) || drawn;
    if (sky) drawn = aurora(f, sky, st) || drawn;
    return procession(f, st) || drawn;
  }

  /** The cheer itself: a comet from the cheerer's roof to where the name will be written. */
  function comet(f: SkyBeatFrame, o: Vec3, to: P3): boolean {
    const start = 300, arrive = SKY_BEAT.skyfire.name[0], t = f.t;
    if (t < start || t > arrive + 400) return false;
    const lift: P3 = [o[0], o[1] + (to[1] - o[1]) * 0.9, o[2]];
    const at = (k: number): P3 => {
      const e = k * k * (3 - 2 * k), a = (1 - e) * (1 - e), b2 = 2 * (1 - e) * e, c = e * e;
      return [o[0] * a + lift[0] * b2 + to[0] * c, o[1] * a + lift[1] * b2 + to[1] * c, o[2] * a + lift[2] * b2 + to[2] * c];
    };
    const k = clamp01((t - start) / (arrive - start)), out = 1 - smooth(arrive, arrive + 400, t), warm = mix(WARM, L(MAT.goldLeaf), 0.3);
    motes.cube(at(k), 0.34 + 0.4 * smooth(0.9, 1, k) * out, warm, 1.2 * out);
    for (let j = 1; j <= 10; j++) if (k - j * 0.016 > 0) motes.cube(at(k - j * 0.016), 0.24 - j * 0.014, ember(j / 10), 0.8 * (1 - j / 11) * out);
    addGlow(warm, 0.08 * out);
    return true;
  }

  /** The name in sparks: scattered motes converge letter by letter, hold with a twinkle, then fall as glitter. */
  function name(f: SkyBeatFrame, at: P3, radius: number, above: number, st: Stage): boolean {
    const [n0, n1, n2, n3] = SKY_BEAT.skyfire.name, t = f.t;
    if (t < n0 || t > n3 || !f.name.trim()) return false;
    const text = layout(f.name);
    if (!text.cells.length) return false;
    const pitch = Math.min(0.95, Math.max(0.32, Math.min(radius * 1.6, 70) / Math.max(1, text.width))), size = pitch * 0.8;
    // The lowest line clears the keep by a few metres, whatever the sky's ceiling.
    const centre: P3 = [at[0], Math.max(at[1], above + (text.height * pitch) / 2), at[2]];
    const gold = mix(L(MAT.fabricGold), WARM, 0.15), cream = mix(L(MAT.cream), WARM, 0.5), last = Math.max(1, text.glyphs - 1);
    text.cells.forEach((cell, i) => {
      const delay = (cell.glyph / last) * 700, ta = n0 + delay * 0.5, tb = n1 + delay;
      if (t < ta) return;
      const sd = f.seed + i * 17, theta = rnd(sd, 1) * 6.283, cosPhi = rnd(sd, 2) * 2 - 1, sinPhi = Math.sqrt(1 - cosPhi * cosPhi), dist = 6 + rnd(sd, 3) * 10;
      const tx = centre[0] + st.rx * cell.x * pitch, ty = centre[1] + cell.y * pitch, tz = centre[2] + st.rz * cell.x * pitch;
      const sx = tx + Math.cos(theta) * sinPhi * dist, sy = ty + cosPhi * dist, sz = tz + Math.sin(theta) * sinPhi * dist, swirl = (rnd(sd, 4) - 0.5) * 3;
      const flight = (kk: number, out: P3): P3 => {
        const e = easeOut(kk), bow = Math.sin(Math.PI * e) * swirl;
        out[0] = sx + (tx - sx) * e + st.rx * bow; out[1] = sy + (ty - sy) * e; out[2] = sz + (tz - sz) * e + st.rz * bow;
        return out;
      };
      const k = clamp01((t - ta) / (tb - ta)), tf = n2 + delay * 0.7;
      if (t < tf) {
        const glint = rnd(sd, Math.floor(t / 110)) > 0.975, twinkle = k >= 1 ? 0.82 + 0.18 * Math.sin(t * 0.0042 + i * 1.3) : 1;
        motes.cube(flight(k, p), size, glint ? cream : mix(gold, WARM, (1 - k) * 0.6), smooth(0, 0.25, k) * twinkle * (glint ? 1.45 : 1.05));
        if (k < 1 && i % 2 === 0) motes.cube(flight(Math.max(0, k - 0.07), p2), size * 0.6, ember(0.25), 0.35 * smooth(0, 0.25, k));
      } else {
        // Glitter: each spark lets go, flickers and falls with a little flutter.
        const g = (t - tf) / 1000, side = Math.sin(g * 4 + i) * 0.22 * g, on = rnd(sd, Math.floor(t / 85)) > 0.35 ? 1 : 0.15;
        motes.box(tx + st.rx * side, ty - 1.5 * g * g, tz + st.rz * side, size * 0.65, size * 0.65, size * 0.65, on > 0.5 && rnd(sd, 5) > 0.6 ? cream : gold, (1 - smooth(tf, n3, t)) * on);
      }
    });
    addGlow(gold, 0.12 * smooth(n0, n1, t) * (1 - smooth(n2, n3, t)));
    return true;
  }

  /** Three curtains of thin columns over the walls, unrolling from one end, folding and rippling, rolling away. */
  function aurora(f: SkyBeatFrame, sky: NonNullable<Stage['sky']>, st: Stage): boolean {
    const [a0, a1, a2, a3] = SKY_BEAT.skyfire.aurora, t = f.t;
    if (t < a0 || t > a3) return false;
    const unroll = smooth(a0, a1, t), away = smooth(a2, a3, t), back = Math.atan2(-st.fz, -st.fx);
    let drawn = false;
    for (let c = 0; c < 3; c++) {
      // Wide, behind the castle: the curtains frame the town from the back and the name is written in front of them.
      const alpha = back + [-0.5, 0.05, 0.55][c]! + (rnd(f.seed, 40 + c) - 0.5) * 0.3, half = 0.95 + 0.12 * c;
      const rad = sky.radius * (0.8 + 0.14 * c), base = sky.centre[1] + sky.ceiling * (0.6 + 0.05 * c), tall = sky.ceiling * (0.48 + 0.12 * rnd(f.seed, 45 + c));
      const n = Math.min(64, Math.max(28, Math.round((rad * 2 * half) / 1.05))), width = ((rad * 2 * half) / n) * 0.55, forward = rnd(f.seed, 50 + c) < 0.5;
      const grad = AURORA[c]!.map(L);
      for (let j = 0; j < n; j++) {
        const s = j / (n - 1), along = forward ? s : 1 - s;
        // In: the curtain unrolls from one end. Out: it rolls away from the same end it started at.
        const show = clamp01((unroll * 1.25 - along) / 0.25) * (1 - clamp01((away * 1.25 - along) / 0.25));
        if (show <= 0.01) continue;
        const a = alpha + (s - 0.5) * 2 * half, fold = Math.sin(s * 7.1 + t * 0.00031 + c * 2.1) * 2.4 + Math.sin(s * 17.3 - t * 0.00067 + c) * 0.7;
        const x = sky.centre[0] + Math.cos(a) * (rad + fold), z = sky.centre[2] + Math.sin(a) * (rad + fold);
        const wave = 0.5 + 0.5 * Math.sin(s * 19 - t * 0.0019 + c * 1.9), edge = Math.sqrt(Math.sin(Math.PI * s));
        const height = tall * (0.72 + 0.28 * Math.sin(s * 8.3 + t * 0.0011 + c)), visible = height * (0.35 + 0.65 * show);
        const top = base + height + Math.sin(s * 5.2 + t * 0.0007) * 0.8, segment = visible / 4, bright = (0.45 + 0.55 * wave) * show * edge;
        for (let k = 0; k < 4; k++) drawn = motes.box(x, top - visible + segment * (k + 0.5), z, width, segment * 0.96, width, grad[k]!, AURORA_ALPHA[k]! * bright) || drawn;
        columns++;
      }
      addGlow(grad[1]!, 0.2 * unroll * (1 - away));
    }
    return drawn;
  }

  /** Twelve shells walking round the castle walls (or the town's ring), on the schedule the sound follows. */
  function procession(f: SkyBeatFrame, st: Stage): boolean {
    const B = SKY_BEAT.skyfire, [p0, p1] = B.procession, sky = st.sky, castle = st.castle;
    const ring = sky ? Array.from({ length: 24 }, (_, i): Vec3 => [sky.centre[0] + Math.cos((i / 24) * 6.283) * sky.radius * 0.85, sky.centre[1], sky.centre[2] + Math.sin((i / 24) * 6.283) * sky.radius * 0.85]) : null;
    const path = castle && castle.walls.length >= 3 ? loopOf(castle.walls) : ring ? loopOf(ring) : null;
    if (!path) return false;
    const hub = castle?.crown ?? sky?.centre, offset = rnd(f.seed, 60), patterns: readonly Pattern[] = ['peony', 'ring', 'willow'];
    let drawn = false;
    for (let i = 0; i < B.shells; i++) {
      const launch = Math.round(p0 + ((p1 - p0) * i) / (B.shells - 1)), from = path.at(i / B.shells + offset);
      const ox = hub ? from[0] - hub[0] : 0, oz = hub ? from[2] - hub[2] : 0, ol = Math.hypot(ox, oz) || 1;
      const to: P3 = [from[0] + (ox / ol) * 2, bandY(st, from[1] + 14, from[1] + 26, rnd(f.seed, 70 + i)), from[2] + (oz / ol) * 2];
      const last = i === B.shells - 1, pattern = last ? 'willow' : patterns[(i + Math.floor(rnd(f.seed, 61) * 3)) % 3]!;
      drawn = drawShell({
        launch, fuse: B.fuse, life: B.burst, from, to, pattern, hues: hues(f.seed + i * 151, 2 + (i % 2)), seed: f.seed + i * 13,
        radius: last ? 8 : 6.5, stars: last ? 64 : 56, image: null,
      }, f.t, st) || drawn;
    }
    return drawn;
  }

  /** A celebration: three bursts of flat paper cubes over the crown that tumble, flutter and fall, then shrink away. */
  function confetti(f: SkyBeatFrame, st: Stage): boolean {
    const B = POWER_UP_BEAT.confetti, castle = st.castle, t = f.t;
    if (!castle || t > B.end) return false;
    const c = castle.crown, floor = st.sky ? st.sky.centre[1] + 0.04 : -Infinity, wx = (rnd(f.seed, 1) - 0.5) * 0.8, wz = (rnd(f.seed, 2) - 0.5) * 0.8, drag = 1.8;
    const at = (s: number, v0x: number, v0y: number, v0z: number, vty: number, out: P3): P3 => {
      const decay = (1 - Math.exp(-drag * s)) / drag;
      out[0] = c[0] + wx * s + (v0x - wx) * decay; out[1] = c[1] + 2.5 + vty * s + (v0y - vty) * decay; out[2] = c[2] + wz * s + (v0z - wz) * decay;
      return out;
    };
    let drawn = false;
    B.burst.forEach((burstAt, b) => {
      const tb = t - burstAt;
      if (tb < 0) return;
      // The pop: a few warm sparks at the break.
      if (tb < 300) for (let i = 0; i < 6; i++) {
        const a = (i / 6) * 6.283 + b, r = easeOut(tb / 300) * 1.2;
        motes.box(c[0] + Math.cos(a) * r, c[1] + 2.5 + Math.sin(a * 2) * 0.3, c[2] + Math.sin(a) * r, 0.16, 0.16, 0.16, WARM, 0.9 * (1 - tb / 300));
      }
      addGlow(WARM, 0.08 * smooth(0, 60, tb) * Math.exp(-tb / 400));
      for (let i = 0; i < 64; i++) {
        const sd = f.seed + b * 997 + i * 31, theta = rnd(sd, 1) * 6.283, cosPhi = 1 - rnd(sd, 2) * 0.5, sinPhi = Math.sqrt(1 - cosPhi * cosPhi), speed = 7 + rnd(sd, 3) * 6;
        const v0x = Math.cos(theta) * sinPhi * speed, v0y = cosPhi * speed, v0z = Math.sin(theta) * sinPhi * speed, vty = -1.15 - rnd(sd, 4) * 0.4;
        let s = tb / 1000, landed = false;
        at(s, v0x, v0y, v0z, vty, p);
        if (p[1] < floor) {
          // Find the landing instant (deterministically) and rest there, lying flat.
          let lo = 0, hi = s;
          for (let k = 0; k < 14; k++) { const mid = (lo + hi) / 2; if (at(mid, v0x, v0y, v0z, vty, p2)[1] < floor) hi = mid; else lo = mid; }
          s = lo; landed = true;
          at(s, v0x, v0y, v0z, vty, p);
          p[1] = floor;
        }
        const flutter = 0.45 * smooth(0.6, 1.6, s), fw = 2.2 + rnd(sd, 5) * 1.6, ph = rnd(sd, 6) * 6.283;
        p[0] += (st.rx * Math.sin(s * fw + ph) + st.fx * Math.cos(s * fw * 0.7 + ph) * 0.5) * flutter;
        p[2] += (st.rz * Math.sin(s * fw + ph) + st.fz * Math.cos(s * fw * 0.7 + ph) * 0.5) * flutter;
        const spin = s * (3 + rnd(sd, 7) * 4) + ph;
        euler.set(landed ? 0 : spin, ph + s * (1 + rnd(sd, 8) * 2), landed ? 0 : s * (2 + rnd(sd, 9) * 3) + ph * 0.5);
        q.setFromEuler(euler);
        const shrink = 1 - smooth(B.fall - 400 + rnd(sd, 10) * 600, B.end - 200, t), shade = landed ? 0.55 : 0.5 + 0.4 * Math.abs(Math.cos(spin));
        drawn = motes.sheet(p, q, 0.3 * shrink, 0.045 * shrink, 0.2 * shrink, P(CONFETTI[Math.floor(rnd(sd, 11) * CONFETTI.length)]!), shade) || drawn;
      }
    });
    return drawn;
  }

  /** The speech bubble's dressing: a small ring of motes turning over the speaker's roof, a highlight travelling round. */
  function bubble(f: SkyBeatFrame, st: Stage): boolean {
    const end = POWER_UP_BEAT.bubble.end, t = f.t;
    if (f.bubbleSlot === null || t > end) return false;
    const roof = st.places.roof(f.bubbleSlot);
    if (!roof) return false;
    const envelope = smooth(0, 500, t) * (1 - smooth(end - 1000, end, t)), colours = [L(MAT.cream), L(MAT.blueFlower), L(MAT.petal)];
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * 6.283 + (t / 1000) * 0.6, shine = Math.max(0, Math.cos(a - t * 0.004)) ** 4;
      motes.box(roof[0] + Math.cos(a) * 1.4, roof[1] + 0.9 + Math.sin(a * 2 + t * 0.002) * 0.15, roof[2] + Math.sin(a) * 1.4, 0.16, 0.16, 0.16, colours[i % 3]!, (0.35 + 0.75 * shine) * envelope);
    }
    addGlow(colours[0]!, 0.03 * envelope);
    return true;
  }

  // ---------------------------------------------------------------- the frame

  const rank = (f: SkyBeatFrame) => (f.kind === 'festival' ? RUNG_RANK['castle-volley'] : f.kind === 'cheer' && f.rung ? RUNG_RANK[f.rung] : f.kind === 'confetti' ? 1.5 : -1);
  const handled = (f: SkyBeatFrame) => f.kind === 'confetti' || f.kind === 'bubble' || f.kind === 'festival'
    || (f.kind === 'cheer' && (f.rung === 'spark' || f.rung === 'street-fireworks' || f.rung === 'castle-volley' || f.rung === 'skyfire'));
  function draw(f: SkyBeatFrame, st: Stage): boolean {
    if (f.t < 0) return false;
    if (f.kind === 'confetti') return confetti(f, st);
    if (f.kind === 'bubble') return bubble(f, st);
    // The festival is the train's closing volley: the castle volley in the kingdom's own star, credited to nobody.
    if (f.kind === 'festival') return castleVolley({ ...f, effect: null }, st);
    if (f.rung === 'spark') return spark(f, st);
    if (f.rung === 'street-fireworks') return streetFireworks(f, st);
    if (f.rung === 'castle-volley') return castleVolley(f, st);
    return skyfire(f, st);
  }
  function stage(): Stage {
    const places = host.places, sky = places.sky(), castle = places.castle();
    let fx = 0, fz = 1;
    if (sky && castle) {
      const dx = sky.centre[0] - castle.crown[0], dz = sky.centre[2] - castle.crown[2], l = Math.hypot(dx, dz);
      if (l > 1) { fx = dx / l; fz = dz / l; }
    }
    return { places, sky, castle, fx, fz, rx: fz, rz: -fx, ceiling: sky ? sky.centre[1] + sky.ceiling : Infinity };
  }

  return {
    blueprints: () => [],
    apply(frames: readonly SkyBeatFrame[]): void {
      motes.begin();
      glowSum = [0, 0, 0]; glowWeight = 0; live = 0; columns = 0;
      const beats = frames.filter(handled).sort((a, b) => rank(b) - rank(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, SKY_LIMITS.beats);
      if (beats.length) {
        const st = stage();
        for (const f of beats) if (draw(f, st)) live++;
      }
      motes.end();
      const peak = Math.max(glowSum[0]!, glowSum[1]!, glowSum[2]!, 1e-6);
      lastGlow = { colour: glowWeight > 0 ? [glowSum[0]! / peak, glowSum[1]! / peak, glowSum[2]! / peak] : [0, 0, 0], strength: 0.6 * (1 - Math.exp(-glowWeight * 1.2)) };
    },
    /** The sky's light right now, for the host to tint the night: a colour (max channel 1) and a strength ≤ 0.6. */
    glow: () => lastGlow,
    stats: () => ({ motes: motes.lit + motes.sheets, beats: live, auroraColumns: columns }),
    dispose(): void {
      root.remove(group);
      group.clear();
      motes.dispose();
      geometry.dispose();
      lightMaterial.dispose();
      paperMaterial.dispose();
      emotes.clear();
      texts.clear();
    },
  };
}
export type SkyLightLayer = ReturnType<typeof createSkyLightLayer>;
