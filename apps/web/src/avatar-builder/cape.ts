import * as THREE from 'three';
import { AVATAR_CAPE_LIMITS } from '@chatdom/shared';
import { capeCut, mix, rgb, type CapeCut, type CitizenLook, type Rgb } from '../../../../packages/content/src/avatar-style';

/*
 * Capes are thin cloth, never voxels (the founder's cape decision): a smooth double-sided sheet from the back
 * socket, cloth outside and lining inside, a trim band at the hem. This is the sheet at rest for the builder's
 * turntable and the portraits; in the kingdom the citizen runtime owns cloth motion from the same `capeCut`.
 * The grid stays within the frozen cloth budget (6 × 10 quads, 77 vertices).
 */

const CELL = 16;
const { columns: COLS, rows: ROWS } = AVATAR_CAPE_LIMITS;
/** The frozen back socket, in avatar cells: the chest's back plane, two cells above the chest. */
const BACK_SOCKET: readonly [number, number, number] = [0, 14, -2];
const GREY: Rgb = [.46, .45, .47];

const linear = (c: number) => (c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);

/** Position of the sheet's (u, v) point at rest: u across 0..1, v down 0..1. */
function restPoint(cut: CapeCut, u: number, v: number): THREE.Vector3 {
  const width = cut.width * CELL, length = cut.length * CELL;
  const taper = cut.shape === 'flared' ? .72 + .28 * v : cut.shape === 'tapered' ? 1 - .28 * v : 1;
  const across = (u - .5) * width * taper;
  const half = width / 2;
  // It drapes over the shoulders: the top edge wraps forward round the back, easing out lower down.
  const wrap = (across / half) ** 2 * (1.6 - 1.2 * v);
  // Soft folds that deepen toward the hem, and the hem standing a little off the legs.
  const folds = Math.sin(u * Math.PI * 3) * .32 * v ** 1.2;
  let y = BACK_SOCKET[1] + cut.mount.height * CELL + 1 - v * length;
  if (cut.hem === 'rounded') y += (1 - (2 * u - 1) ** 2) * -.9 * v ** 4;
  const z = BACK_SOCKET[2] - cut.mount.back * CELL + wrap - .9 * v - folds;
  return new THREE.Vector3(across, y, z);
}

function sheetGeometry(cut: CapeCut): THREE.BufferGeometry {
  const positions: number[] = [], index: number[] = [], uv: number[] = [];
  for (let r = 0; r <= ROWS; r++) for (let c = 0; c <= COLS; c++) {
    const u = c / COLS, v = r / ROWS;
    const p = restPoint(cut, u, v);
    // A notched hem: the middle of the last row is lifted into a swallowtail.
    if (cut.hem === 'notched' && r === ROWS) p.y += (1 - Math.abs(2 * u - 1)) * 1.6;
    positions.push(p.x, p.y, p.z);
    uv.push(u, v);
  }
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const a = r * (COLS + 1) + c, b = a + 1, d = a + COLS + 1, e = d + 1;
    index.push(a, d, b, b, d, e);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** Vertex colours for one side: the trim band at the hem, the rest cloth (or lining), dimmed after a lapse. */
function paint(g: THREE.BufferGeometry, cut: CapeCut, side: 'outer' | 'inner', time = 0): void {
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const out = (g.getAttribute('color') as THREE.BufferAttribute | undefined) ?? new THREE.BufferAttribute(new Float32Array(uv.count * 3), 3);
  const base = rgb(side === 'outer' ? cut.colours.cloth : cut.colours.lining), trim = rgb(cut.colours.trim);
  const trimFrom = 1 - cut.trimWidth * 16 / (cut.length * CELL) * 2.2;
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i), v = uv.getY(i);
    let c: Rgb = v >= trimFrom ? trim : base;
    if (cut.shimmer && side === 'outer' && v < trimFrom) {
      // The tier 3 shimmer: the palette's hues roll down the cloth like light along silk.
      const hues = cut.shimmer.hues.map(h => rgb(h));
      const t = (v * 1.4 + u * .35 - time * .22) * hues.length;
      const k = ((Math.floor(t) % hues.length) + hues.length) % hues.length;
      const rainbow = mix(hues[k]!, hues[(k + 1) % hues.length]!, t - Math.floor(t));
      c = mix(base, rainbow, cut.shimmer.strength);
    }
    if (cut.dim) c = mix(c, GREY, .45);
    out.setXYZ(i, linear(c[0]), linear(c[1]), linear(c[2]));
  }
  out.needsUpdate = true;
  if (!g.getAttribute('color')) g.setAttribute('color', out);
}

/**
 * The cape on a look, or null when it wears none: a group of two meshes (`cape-outer` in cloth, `cape-inner`
 * in lining) in avatar cells, root at the citizen's origin like `citizenObject`.
 */
export function capeObject(look: CitizenLook, dim = false): THREE.Group | null {
  if (!look.earned.cape) return null;
  // A lapsed subscription dims sub pieces, not a cape earned in a shared moment.
  const cut = capeCut(look.earned.cape, dim && look.earned.cape.kind !== 'cheer');
  const group = new THREE.Group();
  group.name = 'citizen-cape';
  group.userData.cut = cut;
  for (const side of ['outer', 'inner'] as const) {
    const g = sheetGeometry(cut);
    paint(g, cut, side);
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .74, metalness: 0, side: side === 'outer' ? THREE.BackSide : THREE.FrontSide });
    const mesh = new THREE.Mesh(g, material);
    mesh.name = `cape-${side}`;
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

/** Advances a shimmering cape's colours (the rainbow cape); a no-op for any other cape. */
export function animateCape(cape: THREE.Object3D, seconds: number): void {
  const cut = cape.userData.cut as CapeCut | undefined;
  if (!cut?.shimmer) return;
  const outer = cape.getObjectByName('cape-outer') as THREE.Mesh | undefined;
  if (outer) paint(outer.geometry as THREE.BufferGeometry, cut, 'outer', seconds);
}

export function disposeCape(cape: THREE.Object3D): void {
  cape.traverse(o => {
    if (!(o instanceof THREE.Mesh)) return;
    o.geometry.dispose();
    (o.material as THREE.Material).dispose();
  });
}
