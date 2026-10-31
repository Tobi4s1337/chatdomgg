import * as THREE from 'three';
import { CHEEK_Z, H, MARK_WINDOW, PLATE, Y_OFFSET } from './sculpt';

/**
 * The Forge's rune alphabet as the ritual draws it (presentation/runes.ts), in glyph units (x ±0.75,
 * y ±1). A single point is a punched dot. The ritual module keeps its alphabet private, so this is a
 * copy of the same strokes; runes.test.ts proves it matches the ritual's set exactly.
 */
export const FORGE_ALPHABET: readonly (readonly (readonly [number, number])[])[][] = [
  [[[0, -1], [0, 1], [.5, .6]], [[-.42, -.25]]],
  [[[-.6, -.15], [0, .55], [.6, -.15]], [[0, .55], [0, -1]]],
  [[[-.3, -1], [-.3, .6]], [[.3, -.6], [.3, 1]], [[-.3, .12], [.3, -.12]]],
  [[[0, 1], [.48, .42], [0, -.16], [-.48, .42], [0, 1]], [[0, -.16], [0, -1]]],
  [[[0, -1], [0, 1]], [[0, .78], [-.5, .36]], [[0, .08], [-.5, -.34]], [[.42, .5]]],
  [[[-.45, -1], [-.45, .45], [.08, 1]], [[.42, .3], [.42, -.62]], [[.0, -.2]]],
  [[[0, -1], [0, .66], [.42, 1], [.7, .74]], [[-.42, -.52], [0, -.52]]],
  [[[-.6, -.92], [0, .92], [.6, -.92]], [[0, -.32]]],
  [[[0, -1], [0, 1]], [[0, .46], [.36, 0], [0, -.46], [-.36, 0], [0, .46]]],
  [[[-.62, .7], [-.12, .7], [-.26, 0], [.24, 0], [.1, -.7], [.6, -.7]]],
  [[[0, -1], [0, .4], [-.5, 1]], [[0, .4], [.5, 1]], [[-.45, -.35], [.45, -.35]]],
  [[[0, -1], [0, 1]], [[-.5, .16], [.5, .58]], [[0, -1], [.42, -.7]]],
  [[[-.4, 1], [-.4, -.6], [.42, -1]], [[.14, .66]], [[.42, .16]]],
  [[[0, 1], [0, -.08], [-.5, -1]], [[0, -.08], [.5, -1]], [[-.4, .64]]],
  [[[-.2, 1], [.26, .2], [-.2, -.4], [.1, -1]], [[.26, .2], [.62, .36]]],
  [[[-.5, .92], [0, .52], [.5, .92]], [[-.5, .12], [0, -.28], [.5, .12]], [[0, -.28], [0, -1]]],
];

/** One cut segment in glyph units; a dot is a segment of zero length. */
export type RuneStroke = readonly [number, number, number, number];
export function glyphStrokes(glyph: number): RuneStroke[] {
  const out: RuneStroke[] = [];
  for (const line of FORGE_ALPHABET[glyph]!) {
    if (line.length === 1) { const [x, y] = line[0]!; out.push([x, y, x, y]); continue; }
    for (let i = 1; i < line.length; i++) out.push([line[i - 1]![0], line[i - 1]![1], line[i]![0], line[i]![1]]);
  }
  return out;
}

/** A full-size rune is 1 × 1.25 build cells: 2 glyph units tall is 0.156 m. */
export const RUNE_UNIT = .15625 / 2;
/** Strokes 2 cm wide and cut 1.5 cm deep at full size; the smallest horn runes keep a cut a graver could make. */
export const RUNE_STROKE = .02;
export const RUNE_DEPTH = .015;

export interface RuneSite {
  face: '+z plate' | '-z plate' | '+z horn' | '-z horn' | 'heel';
  glyph: number;
  /** Root-local metres: the rune's centre on the face of the iron. */
  centre: THREE.Vector3;
  /** Outward face normal, and the glyph's right-hand axis as a viewer facing that face sees it. */
  normal: THREE.Vector3;
  right: THREE.Vector3;
  /** Glyph size relative to a full rune. */
  scale: number;
  /** Metres per glyph unit, stroke half-width and depth in metres. */
  unit: number;
  halfWidth: number;
  depth: number;
  /** Rank by distance from the mark: 0 is nearest, ignites first and cools last. */
  order: number;
}

/** Root-local centre of the mark's cut: the middle of the cheek window. */
export const MARK_CENTRE = new THREE.Vector3(
  (MARK_WINDOW.x[0] + MARK_WINDOW.x[1]) / 2 * H,
  (MARK_WINDOW.rows[0] + MARK_WINDOW.rows[1]) / 2 * H + Y_OFFSET,
  CHEEK_Z * H,
);

const row = (r: number) => r * H + Y_OFFSET;
/**
 * Where the runes are cut. Each sits wholly on one flat face of the sculpt, a centimetre clear of every
 * arris (runes.test.ts walks the occupancy to prove it):
 * - seven across the +Z face plate, centred over the mark, and five across the −Z face plate;
 * - three shrinking along each horn flank, from the throat (the +Z/−Z face at 3 h) to the taper (2 h);
 * - one on the heel's end, under the hardy hole.
 */
function layout(): Omit<RuneSite, 'order'>[] {
  const sites: Omit<RuneSite, 'order'>[] = [];
  const add = (face: RuneSite['face'], glyph: number, centre: [number, number, number], normal: [number, number, number], scale: number) => {
    const n = new THREE.Vector3(...normal);
    const right = new THREE.Vector3().crossVectors(n.clone().negate(), new THREE.Vector3(0, 1, 0)).normalize();
    const halfWidth = RUNE_STROKE / 2 * THREE.MathUtils.clamp(scale, .6, 1);
    sites.push({ face, glyph, centre: new THREE.Vector3(...centre), normal: n, right, scale, unit: RUNE_UNIT * scale, halfWidth, depth: RUNE_DEPTH * THREE.MathUtils.clamp(scale, .8, 1) });
  };
  const plateY = (row(PLATE.rows[0]) + row(PLATE.rows[1])) / 2, pitch = 2.55 * H, markX = MARK_CENTRE.x;
  [4, 9, 1, 15, 7, 12, 2].forEach((glyph, i) => add('+z plate', glyph, [markX + (i - 3) * pitch, plateY, PLATE.z[1] * H], [0, 0, 1], 1));
  [10, 3, 13, 6, 0].forEach((glyph, i) => add('-z plate', glyph, [markX - (i - 2) * pitch, plateY, PLATE.z[0] * H], [0, 0, -1], 1));
  for (const side of [1, -1] as const) {
    const glyphs = side > 0 ? [8, 14, 5] : [11, 2, 7];
    add(side > 0 ? '+z horn' : '-z horn', glyphs[0]!, [9.6 * H, row(18.8), side * 3 * H], [0, 0, side], .82);
    add(side > 0 ? '+z horn' : '-z horn', glyphs[1]!, [13 * H, row(19.15), side * 3 * H], [0, 0, side], .68);
    add(side > 0 ? '+z horn' : '-z horn', glyphs[2]!, [16.9 * H, row(20.25), side * 2 * H], [0, 0, side], .55);
  }
  add('heel', 9, [PLATE.x[0] * H, row(20.6), 0], [-1, 0, 0], .92);
  return sites;
}

export const RUNE_SITES: readonly RuneSite[] = (() => {
  const sites = layout();
  const ranked = sites.map((site, i) => ({ i, d: site.centre.distanceTo(MARK_CENTRE) })).sort((a, b) => a.d - b.d);
  const order = new Map(ranked.map((r, rank) => [r.i, rank]));
  return sites.map((site, i) => ({ ...site, order: order.get(i)! }));
})();

/**
 * The rune table as one row of float texels, read with texelFetch: four per rune (centre and metres per
 * glyph unit; outward normal and order 0..1; right axis and stroke half-width in glyph units; first stroke,
 * stroke count and cut depth), then one per stroke. A texture rather than GLSL constant arrays, which some
 * drivers copy into every fragment before indexing them.
 */
export function runeTable(): { data: Float32Array; width: number } {
  const strokes: RuneStroke[] = [], spans: [number, number][] = [];
  for (const site of RUNE_SITES) { const s = glyphStrokes(site.glyph); spans.push([strokes.length, s.length]); strokes.push(...s); }
  const n = RUNE_SITES.length, width = n * 4 + strokes.length, data = new Float32Array(width * 4);
  RUNE_SITES.forEach((s, r) => data.set([
    ...s.centre.toArray(), s.unit, ...s.normal.toArray(), s.order / (n - 1), ...s.right.toArray(), s.halfWidth / s.unit,
    n * 4 + spans[r]![0], spans[r]![1], s.depth, 0,
  ], r * 16));
  strokes.forEach((stroke, k) => data.set(stroke, (n * 4 + k) * 4));
  return { data, width };
}

/** Accessors for that table, and the groove field: signed distance in glyph units to the nearest stroke (negative inside). */
export const RUNE_GLSL = `
  const int ANVIL_RUNES=${RUNE_SITES.length};
  vec4 runeTexel(int r,int k){return texelFetch(uAnvilRunes,ivec2(r*4+k,0),0);}
  float runeField(int r,vec2 q){
    vec4 span=runeTexel(r,3);float d=1e3;int first=int(span.x+.5),count=int(span.y+.5);
    for(int k=0;k<6;k++){
      if(k>=count)break;
      vec4 e=texelFetch(uAnvilRunes,ivec2(first+k,0),0);vec2 a=e.xy,ab=e.zw-e.xy;
      float t=clamp(dot(q-a,ab)/max(dot(ab,ab),1e-6),0.,1.);
      d=min(d,length(q-a-ab*t));
    }
    return d-runeTexel(r,2).w;
  }`;
