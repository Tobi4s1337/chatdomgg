import { VoxelBlueprintSchema, type VoxelBlueprint } from '@chatdom/shared';
import { MAT, STYLES } from '../materials';
import type { CompiledEmote } from './deps';
import { CAME, gridBoxes, Sculpt, type EmoteArtKit } from './kit';

/** Stone surround around the light, in cells, and the unit's depth: frame 0–6, glass at 3, hood and sill at 6. */
const SURROUND = 4;
const DEPTH = 7;
const GLASS_Z = 3;
/** Where the emote stands in the light: on the meadow strip, above the bottom border. */
const EMOTE_FOOT = 7;
const MEADOW = [4, 9] as const;

/**
 * The light of a window as a host lights it from within: one texel per glass cell, the registered material of the
 * pane (0 where came, stone or air stops the light). It lies on the outward face of the glass sheet. A host draws
 * it as an emissive layer that wakes with the hour, the way presence panes light house windows.
 */
export interface EmoteGlassLight {
  /** Lower-left corner of the texel grid on the outward glass face, in unit-local build cells. */
  readonly origin: readonly [number, number, number];
  readonly width: number;
  readonly height: number;
  /** The outward normal: the unit's +Z, the facade's south face before the host turns it. */
  readonly facing: 'south';
  /** Row-major, y up: `texels[x + width * y]`. */
  readonly texels: readonly number[];
}

/** A leaded lancet window in a stone surround, ready to set into a wall up to six cells thick. */
export interface EmoteGlass {
  /** `emote`: an approved emote's window. `plain`: clear upright leaded lights, the honest window while none is approved. */
  readonly kind: 'emote' | 'plain';
  readonly blueprint: VoxelBlueprint;
  readonly light: EmoteGlassLight;
  /** The wall opening the unit fills, in build cells (x, y); the frame face is flush at z = 6, hood and sill project one. */
  readonly opening: readonly [number, number];
  /** Where the emote sits in the light (x, y, width, height), or null for plain glazing. */
  readonly emote: readonly [number, number, number, number] | null;
}

/** Inside a two-centred pointed lancet of width `w`, springing at `spring`. The arcs have radius 0.6 w. */
function lancet(w: number, spring: number): { inside: (x: number, y: number) => boolean; height: number } {
  const r = 0.6 * w;
  const apex = Math.sqrt(r * r - (w / 2 - (w - r)) ** 2);
  const height = Math.ceil(spring + apex);
  const inside = (x: number, y: number): boolean => {
    if (x < 0 || x >= w || y < 0 || y >= height) return false;
    const px = x + 0.5, py = y + 0.5;
    if (py <= spring) return true;
    const dy = py - spring;
    return (px - r) ** 2 + dy * dy <= r * r && (px - (w - r)) ** 2 + dy * dy <= r * r;
  };
  return { inside, height };
}

/** Steps from outside through a shape (4-neighbour), so a ring at distance n follows straight jambs and arcs alike. */
function depthField(w: number, h: number, inside: (x: number, y: number) => boolean): Int16Array {
  const depth = new Int16Array(w * h).fill(-1);
  let frontier: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!inside(x, y)) continue;
    if (!inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) { depth[x + w * y] = 1; frontier.push(x + w * y); }
  }
  for (let level = 2; frontier.length; level++) {
    const next: number[] = [];
    for (const i of frontier) {
      const x = i % w, y = (i - x) / w;
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as const) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h || !inside(nx, ny) || depth[nx + w * ny] !== -1) continue;
        depth[nx + w * ny] = level; next.push(nx + w * ny);
      }
    }
    frontier = next;
  }
  return depth;
}

/**
 * Leads the light. Rings from the edge: came, a jewelled border of ruby and gold cut every six cells, came. Inside,
 * a field of diamond quarries in two blues, a meadow strip of greens at the foot, a rosette of gold in the arch head.
 * The emote stands on the meadow; a came line follows its silhouette so it reads against the field from far away.
 */
function leadEmote(w: number, h: number, spring: number, inside: (x: number, y: number) => boolean, emote: { mask: Uint16Array; width: number; height: number; x: number } | null): Uint16Array {
  const grid = new Uint16Array(w * h);
  const depth = depthField(w, h, inside);
  const cx = w / 2, rose = { x: cx, y: spring + 0.45 * (h - spring), r: Math.max(4, Math.min(6, (h - spring) * 0.3)) };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const d = depth[x + w * y]!;
    if (d < 1) continue;
    let m: number;
    if (d === 1 || d === 4) m = CAME;
    else if (d <= 3) {
      const u = x < cx ? x + y : y + (w - 1 - x);
      m = u % 6 === 0 ? CAME : Math.floor(u / 6) % 2 ? MAT.fabricGold : MAT.fabricRed;
    } else if (y >= MEADOW[0] && y < MEADOW[1]) m = (Math.floor(x / 3) + y) % 2 ? MAT.fabricGreen : MAT.fabricMutedGreen;
    else if (y === MEADOW[1]) m = CAME;
    else {
      const a = x + y, b = x - y + 600;
      m = a % 6 === 0 || b % 6 === 0 ? CAME : (Math.floor(a / 6) + Math.floor(b / 6)) % 2 ? MAT.fabricBlue : MAT.fabricMutedBlue;
      const dr = Math.sqrt((x + 0.5 - rose.x) ** 2 + (y + 0.5 - rose.y) ** 2);
      if (dr <= rose.r + 0.5) {
        if (dr > rose.r - 0.5) m = CAME;
        else if (dr < 1.6) m = MAT.fabricRed;
        else if (Math.abs(x + 0.5 - rose.x) < 0.6 || Math.abs(y + 0.5 - rose.y) < 0.6) m = CAME;
        else m = MAT.fabricGold;
      }
    }
    grid[x + w * y] = m;
  }
  if (!emote) return grid;
  const at = (x: number, y: number) => {
    const ex = x - emote.x, ey = y - EMOTE_FOOT;
    return ex >= 0 && ey >= 0 && ex < emote.width && ey < emote.height ? emote.mask[ex + emote.width * ey]! : 0;
  };
  // The silhouette's leading: every glass cell touching the emote (8-neighbour) becomes came.
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if ((depth[x + w * y] ?? 0) < 5 || at(x, y)) continue;
    let touches = false;
    for (let dy = -1; dy <= 1 && !touches; dy++) for (let dx = -1; dx <= 1; dx++) if (at(x + dx, y + dy)) { touches = true; break; }
    if (touches) grid[x + w * y] = CAME;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const m = at(x, y);
    if (m && (depth[x + w * y] ?? 0) >= 5) grid[x + w * y] = m;
  }
  return grid;
}

/**
 * Clear glass in upright leaded lights: came at the edge, a clear margin, a second came, then panes five cells wide
 * and seven tall, centred on the lancet and following its arch. Plain glazing that claims nothing. Upright leading
 * stays a crisp lattice on the build grid; one-cell diagonal leading over one clear glass breaks into a checkerboard at plaza distance.
 */
function leadPlain(w: number, h: number, inside: (x: number, y: number) => boolean): Uint16Array {
  const grid = new Uint16Array(w * h);
  const depth = depthField(w, h, inside);
  const PANE_W = 6, PANE_H = 8;
  const x0 = Math.floor(w / 2) % PANE_W;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const d = depth[x + w * y]!;
    if (d < 1) continue;
    const lead = d === 1 || d === 3 || (d > 3 && ((x - x0 + PANE_W) % PANE_W === 0 || (y - 3) % PANE_H === 0));
    grid[x + w * y] = lead ? CAME : MAT.glass;
  }
  return grid;
}

/**
 * Builds the window unit around a led light: a stone surround with long-and-short quoins on the jambs and
 * alternating voussoirs round the arch, a splayed reveal front and back, a projecting sill and a hood mould that
 * follows the arch down to two label stops at the springing. The glass is one cell thick at z = 3.
 */
function windowUnit(kit: EmoteArtKit, id: string, w: number, h: number, spring: number, inside: (x: number, y: number) => boolean, grid: Uint16Array): { blueprint: VoxelBlueprint; opening: [number, number] } {
  const UW = w + 2 * SURROUND, UH = h + 2 * SURROUND;
  const ox = SURROUND, oy = SURROUND;
  // Distance out from the light (8-neighbour rings), up to the surround's width.
  const ring = new Int16Array(UW * UH);
  const lit = (x: number, y: number) => inside(x - ox, y - oy);
  for (let y = 0; y < UH; y++) for (let x = 0; x < UW; x++) {
    if (lit(x, y)) continue;
    let best = 0;
    for (let r = 1; r <= SURROUND && !best; r++) {
      for (let dy = -r; dy <= r && !best; dy++) for (let dx = -r; dx <= r; dx++) {
        if ((Math.abs(dx) === r || Math.abs(dy) === r) && lit(x + dx, y + dy)) { best = r; break; }
      }
    }
    ring[x + UW * y] = best;
  }
  const springY = oy + spring;
  const cx = UW / 2;
  const stone = new Uint16Array(UW * UH), front = new Uint16Array(UW * UH), rear = new Uint16Array(UW * UH), hood = new Uint16Array(UW * UH);
  for (let y = 0; y < UH; y++) for (let x = 0; x < UW; x++) {
    const r = ring[x + UW * y]!;
    if (!r) continue;
    let m = kit.stone;
    if (y >= springY) {
      // Voussoirs: alternate stones along the arch, each about four cells along the curve.
      const u = x < cx ? x + y : y + (UW - 1 - x);
      if (r >= 2 && Math.floor(u / 4) % 2) m = kit.moulding;
    } else if (r >= 3 && Math.floor((y - oy) / 4) % 2 === 0) m = kit.moulding;
    stone[x + UW * y] = m;
    front[x + UW * y] = r === 1 ? 0 : m;
    rear[x + UW * y] = r === 1 ? 0 : m;
    if (r === SURROUND && y >= springY - 1) hood[x + UW * y] = kit.moulding;
  }
  const b = new Sculpt();
  for (const box of gridBoxes(rear, UW, UH, 0, 1)) b.list.push(box);
  for (const box of gridBoxes(stone, UW, UH, 1, 5)) b.list.push(box);
  for (const box of gridBoxes(front, UW, UH, 5, 6)) b.list.push(box);
  for (const box of gridBoxes(hood, UW, UH, 6, 7)) b.list.push(box);
  // Label stops where the hood ends, at the springing on both sides.
  b.add(0, springY - 3, 5, 2, springY - 1, 7, kit.moulding);
  b.add(UW - 2, springY - 3, 5, UW, springY - 1, 7, kit.moulding);
  // The sill: a projecting course under the light, weathered back at the top.
  b.add(1, oy - 2, 0, UW - 1, oy - 1, DEPTH, kit.moulding);
  b.add(2, oy - 1, 4, UW - 2, oy, 6, kit.moulding);
  b.add(2, 0, 0, UW - 2, 1, 6, kit.stone);
  for (const box of gridBoxes(grid, w, h, GLASS_Z, GLASS_Z + 1, ox, oy)) b.list.push(box);
  const blueprint = VoxelBlueprintSchema.parse({ version: 1, id, styleId: STYLES[kit.style].id, kind: 'civic', lattice: 'build', size: [UW, UH, DEPTH], boxes: b.list, windows: [] });
  return { blueprint, opening: [UW, UH] };
}

function lightOf(grid: Uint16Array, w: number, h: number): EmoteGlassLight {
  return { origin: [SURROUND, SURROUND, GLASS_Z + 1], width: w, height: h, facing: 'south', texels: Array.from(grid, m => (m === CAME ? 0 : m)) };
}

/** An approved emote, carved flat and snapped to glass dyes, led into a lancet that fits it. */
export function composeEmoteGlass(kit: EmoteArtKit, emote: CompiledEmote): EmoteGlass {
  const { width: mw, height: mh, materialIds } = emote.mask;
  const w = Math.max(28, mw + 12 + ((mw + 12) % 2));
  const spring = EMOTE_FOOT + mh + 3;
  const { inside, height } = lancet(w, spring);
  const x = Math.floor((w - mw) / 2);
  const grid = leadEmote(w, height, spring, inside, { mask: materialIds, width: mw, height: mh, x });
  const { blueprint, opening } = windowUnit(kit, `genesis-emote-glass-${kit.style}-${emote.geometryHash.slice(0, 16)}`, w, height, spring, inside, grid);
  return { kind: 'emote', blueprint, light: lightOf(grid, w, height), opening, emote: [x, EMOTE_FOOT, mw, mh] };
}

/** The same lancet glazed plain, for a window whose emote is not (or not yet) approved for glass. */
export function composePlainGlass(kit: EmoteArtKit): EmoteGlass {
  const w = 28, spring = 34;
  const { inside, height } = lancet(w, spring);
  const grid = leadPlain(w, height, inside);
  const { blueprint, opening } = windowUnit(kit, `genesis-emote-glass-${kit.style}-plain`, w, height, spring, inside, grid);
  return { kind: 'plain', blueprint, light: lightOf(grid, w, height), opening, emote: null };
}

