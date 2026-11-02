import * as THREE from 'three';
import { MAT } from '@chatdom/content';
import type { RaidPennant, RaidPennantFrame, Vec3, VoxelBlueprint } from '@chatdom/shared';
import { blueprint, box, CELL, type BannerKit } from './banner';
import type { GiftRoute, PlaceAnchor } from './gift-view';
import { bannerRuns, dyeBlueprint, raiderArms, TINCTURE_LIST, type Run } from './raid-art';
import type { Tincture } from '../atlas/heraldry/design';
import type { RaidChatGround } from './raid-view';
import { Pool } from './train-view';

export const RAID_PENNANT_WALL_RADIUS = 1.5;
export const RAID_PENNANT_WALL_HEIGHT = 4.5;
export const RAID_PENNANT_WALL_LIMIT = 12;
/**
 * Where the wall may stand, in the gate's frame: rows along the road (`row` 0 at the gate, then alternately inward
 * and outward every `spacing`), each side, `aside` from the road plus each `outward` step. The realm keeps arriving
 * guests clear of every candidate (apps/realm/src/raid-gate/guest-spawn.ts, RAID_GATE_FURNITURE.pennants).
 */
export const RAID_PENNANT_WALL_LAYOUT = { rows: 12, spacing: 3.5, aside: 6, outward: [0, 3.5, 7] } as const;

/** A freestanding, grounded bay. All measurements are build cells, 0.125 m each. */
export function raidPennantBayBlueprint(kit: BannerKit): VoxelBlueprint {
  return blueprint(`moment-raid-pennant-bay-${kit}`, kit, [20, 34, 8], [
    // Two broad, stepped stone shoes and timber uprights.
    ...[0, 16].flatMap(x => [
      box(x, 0, 1, x + 4, 2, 7, MAT.darkStone),
      box(x + 1, 2, 2, x + 3, 30, 6, MAT.timber),
      box(x, 29, 1, x + 4, 31, 7, MAT.bark),
      box(x + 1, 31, 2, x + 3, 34, 6, MAT.brass),
    ]),
    // Rod, ties and plaque back are physically attached to the posts.
    box(2, 28, 3, 18, 30, 5, MAT.bark),
    box(3, 7, 3, 17, 9, 5, MAT.timber),
    box(4, 8, 2, 16, 12, 5, MAT.bark),
    box(4, 27, 2, 6, 29, 5, MAT.brass),
    box(14, 27, 2, 16, 29, 5, MAT.brass),
  ]);
}

/** Original provider date, independent of the viewer's locale or timezone. */
export function formatRaidPennantPlaque(item: RaidPennant): { name: string; date: string } {
  const date = new Date(item.occurredAt);
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][date.getUTCMonth()];
  return { name: item.from.name, date: `${date.getUTCDate()} ${month} ${date.getUTCFullYear()}` };
}

/** Browser-only; a missing 2D canvas leaves the crafted wooden plaque in place. */
function safeCanvasTexture(item: RaidPennant): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  try {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 160;
    const ctx = canvas.getContext('2d'); if (!ctx) return null;
    const { name, date } = formatRaidPennantPlaque(item);
    ctx.fillStyle = '#493024'; ctx.fillRect(0, 0, 512, 160);
    ctx.strokeStyle = '#caa76a'; ctx.lineWidth = 5; ctx.strokeRect(5, 5, 502, 150);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#f2dfb7';
    let fontSize = 49;
    ctx.font = `bold ${fontSize}px "Alegreya", serif`;
    while (fontSize > 24 && ctx.measureText(name).width > 470) {
      ctx.font = `bold ${--fontSize}px "Alegreya", serif`;
    }
    let painted = name;
    if (ctx.measureText(painted).width > 470) {
      const segments = typeof Intl.Segmenter === 'function'
        ? Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(name), part => part.segment)
        : Array.from(name);
      while (segments.length && ctx.measureText(`${segments.join('')}…`).width > 470) segments.pop();
      painted = `${segments.join('')}…`;
    }
    ctx.fillText(painted, 256, 56);
    ctx.fillStyle = '#d9bd83'; ctx.font = '32px "IM Fell English", "Alegreya", serif';
    ctx.fillText(date, 256, 112, 470);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  } catch { return null; }
}

interface Host {
  readonly kit: BannerKit;
  readonly material: THREE.Material;
  mesh(blueprint: VoxelBlueprint, offset: THREE.Vector3): THREE.Mesh;
  place(place: 'market' | 'gate'): PlaceAnchor | null;
  route(): GiftRoute | null;
}
export interface RaidPennantSite { readonly raidId: string; readonly foot: Vec3; readonly yaw: number; readonly radius: number; readonly height: number }
interface Plaque { texture: THREE.CanvasTexture; material: THREE.MeshBasicMaterial; mesh: THREE.Mesh }

export function createRaidPennantWall(root: THREE.Group, host: Host) {
  const layer = new THREE.Group(); layer.name = 'raid-pennant-wall'; root.add(layer);
  const bay = raidPennantBayBlueprint(host.kit);
  const pools = new Map<Tincture, Pool>();
  let bays: Pool | undefined;
  const plaqueGeometry = new THREE.PlaneGeometry(1.45, 0.43);
  const plaques = new Map<string, Plaque>();
  let frame: RaidPennantFrame | null = null, ground: RaidChatGround | undefined;
  let signature = '', disposed = false, count = 0, revision = 0;
  let lastVisible: boolean | undefined;
  const bounds = new THREE.Box3();
  const first = new THREE.Vector3(), firstFace = new THREE.Vector3();
  const designs = new Map<string, Run[][] | null>();
  type Candidate = { pos: THREE.Vector3; side: number };
  let layoutKey = '', layout: { right: THREE.Vector3; candidates: Candidate[] } | null = null;
  const slots = new Map<string, number>();
  let scope = '';
  let drawnSites: RaidPennantSite[] = [];
  const up = new THREE.Vector3(0, 1, 0), unit = new THREE.Vector3(1, 1, 1);
  const matrix = new THREE.Matrix4(), translate = new THREE.Matrix4(), scale = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  function clearPlaques() {
    for (const p of plaques.values()) { p.mesh.removeFromParent(); p.material.dispose(); p.texture.dispose(); }
    plaques.clear();
  }
  // A feed may arrive before web fonts finish loading. Repaint once when they settle.
  if (typeof document !== 'undefined' && document.fonts?.load) {
    void Promise.all([document.fonts.load('bold 49px "Alegreya"'), document.fonts.load('32px "IM Fell English"')])
      .then(() => { if (!disposed) { clearPlaques(); revision++; } }).catch(() => {});
  }
  function clearGeometry() {
    if (bays) { bays.count = 0; bays.flush(); }
    for (const p of pools.values()) { p.count = 0; p.flush(); }
    for (const p of plaques.values()) p.mesh.visible = false;
    drawnSites = []; count = 0; bounds.makeEmpty(); first.set(0, 0, 0); firstFace.set(0, 0, 0);
  }
  function dye(t: Tincture): Pool {
    let p = pools.get(t);
    if (!p) { const b = dyeBlueprint(host.kit, t); p = new Pool(host.mesh(b, new THREE.Vector3()).geometry, host.material, RAID_PENNANT_WALL_LIMIT * 12 * 15, layer, b.id); pools.set(t, p); }
    return p;
  }
  function makePlaque(item: RaidPennant): Plaque | undefined {
    const texture = safeCanvasTexture(item); if (!texture) return undefined;
    const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide, toneMapped: false });
    const mesh = new THREE.Mesh(plaqueGeometry, material); mesh.name = 'raid-pennant-plaque'; layer.add(mesh);
    return { texture, material, mesh };
  }
  return {
    blueprints: () => [bay, ...TINCTURE_LIST.map(t => dyeBlueprint(host.kit, t))],
    receive(next: RaidPennantFrame | null): void {
      if (disposed) return;
      const items = next?.items.slice(0, RAID_PENNANT_WALL_LIMIT) ?? [];
      const key = JSON.stringify([next?.origin, next?.kingdomId, items]);
      const nextScope = JSON.stringify([next?.origin, next?.kingdomId]);
      if (nextScope !== scope) { scope = nextScope; slots.clear(); }
      const ids = new Set(items.map(item => item.raidId));
      for (const id of slots.keys()) if (!ids.has(id)) slots.delete(id);
      frame = next;
      if (key !== signature) {
        signature = key; clearPlaques(); revision++;
        const sources = new Set<string>(items.map(item => item.from.kingdomId));
        for (const source of designs.keys()) if (!sources.has(source)) designs.delete(source);
      }
    },
    ground(sample: RaidChatGround | undefined): void { if (!disposed && ground !== sample) { ground = sample; slots.clear(); revision++; } },
    apply(_atMs: number, visible: boolean): void {
      if (disposed) return;
      if (visible !== lastVisible) { lastVisible = visible; revision++; }
      clearGeometry(); layer.visible = visible;
      if (!visible || !frame || !ground) return;
      const gate = host.place('gate');
      const road = host.route()?.inbound;
      if (!gate || !road || road.length < 2) {
        if (layoutKey || slots.size) revision++;
        slots.clear(); layout = null; layoutKey = ''; return;
      }
      const key = JSON.stringify([gate.position, road]);
      if (key !== layoutKey) {
        layoutKey = key; layout = null; slots.clear(); revision++;
        const origin = new THREE.Vector3(...gate.position);
        const forward = new THREE.Vector3();
        let best = Infinity;
        for (let i = 1; i < road.length; i++) {
          const a = new THREE.Vector3(...road[i - 1]!), b = new THREE.Vector3(...road[i]!);
          const d = b.clone().sub(a); d.y = 0; const length = d.lengthSq();
          if (!Number.isFinite(length) || length < 1e-8) continue;
          const t = THREE.MathUtils.clamp(origin.clone().sub(a).dot(d) / length, 0, 1);
          const near = a.clone().addScaledVector(d, t);
          const distance = (near.x - origin.x) ** 2 + (near.z - origin.z) ** 2;
          if (distance < best) { best = distance; forward.copy(d).normalize(); }
        }
        if (best < Infinity) {
          const right = new THREE.Vector3(forward.z, 0, -forward.x);
          const candidates: Candidate[] = [];
          const L = RAID_PENNANT_WALL_LAYOUT;
          for (let row = 0; row < L.rows; row++) for (const side of [-1, 1]) for (const outward of L.outward) {
            const along = row === 0 ? 0 : Math.ceil(row / 2) * L.spacing * (row % 2 ? 1 : -1);
            candidates.push({ pos: origin.clone().addScaledVector(right, side * (L.aside + outward)).addScaledVector(forward, along), side });
          }
          candidates.sort((a, b) => a.pos.distanceToSquared(origin) - b.pos.distanceToSquared(origin));
          layout = { right, candidates };
        }
      }
      if (!layout) return;
      const { right, candidates } = layout;
      const used: THREE.Vector3[] = [];
      const items = frame.items.slice(0, RAID_PENNANT_WALL_LIMIT);
      const previousSlots = JSON.stringify([...slots]);
      const samples = new Map<number, number | null>();
      const sample = (index: number): number | null => {
        if (!samples.has(index)) {
          const candidate = candidates[index]!;
          const y = ground!(candidate.pos.x, candidate.pos.z);
          samples.set(index, y !== null && Number.isFinite(y) ? y : null);
        }
        return samples.get(index)!;
      };
      const free = (candidate: Candidate) => !used.some(p => (p.x - candidate.pos.x) ** 2 + (p.z - candidate.pos.z) ** 2 < 3.1 ** 2);
      const sites = new Map<string, Candidate>();
      // Reserve every still-supported old site before a newly arrived raid can claim one.
      for (const item of items) {
        const index = slots.get(item.raidId);
        if (index === undefined) continue;
        const candidate = candidates[index];
        if (!candidate || !free(candidate)) { slots.delete(item.raidId); continue; }
        const y = sample(index);
        if (y === null) { slots.delete(item.raidId); continue; }
        const site = { pos: candidate.pos.clone().setY(y), side: candidate.side };
        sites.set(item.raidId, site); used.push(site.pos);
      }
      for (const item of items) {
        if (sites.has(item.raidId)) continue;
        for (let index = 0; index < candidates.length; index++) {
          const candidate = candidates[index]!;
          if (!free(candidate)) continue;
          const y = sample(index); if (y === null) continue;
          const site = { pos: candidate.pos.clone().setY(y), side: candidate.side };
          slots.set(item.raidId, index); sites.set(item.raidId, site); used.push(site.pos); break;
        }
      }
      if (JSON.stringify([...slots]) !== previousSlots) revision++;
      for (const item of items) {
        const source = item.from.kingdomId;
        if (!designs.has(source)) {
          const arms = raiderArms(source);
          designs.set(source, arms ? bannerRuns(arms.design, { width: 12, rows: 15, tail: 2, charges: true }) : null);
        }
        const runs = designs.get(source); if (!runs) continue;
        const site = sites.get(item.raidId); if (!site) continue;
        // Local +Z faces the road. Local X therefore runs along it.
        const face = right.clone().multiplyScalar(-site.side);
        if (count === 0) { first.copy(site.pos); firstFace.copy(face); }
        const yaw = Math.atan2(face.x, face.z); q.setFromAxisAngle(up, yaw);
        drawnSites.push({ raidId: item.raidId, foot: site.pos.toArray(), yaw, radius: RAID_PENNANT_WALL_RADIUS, height: RAID_PENNANT_WALL_HEIGHT });
        matrix.compose(site.pos, q, unit);
        if (!bays) bays = new Pool(host.mesh(bay, new THREE.Vector3()).geometry, host.material, RAID_PENNANT_WALL_LIMIT, layer, bay.id);
        bays.push(matrix.clone().multiply(translate.makeTranslation(-10 * CELL, 0, -4 * CELL)), 1);
        for (let row = 0; row < runs.length; row++) for (const run of runs[row]!) {
          const x = (run.x0 - 6) * CELL, y = (27 - row) * CELL;
          dye(run.tincture).push(matrix.clone().multiply(translate.makeTranslation(x, y, 0.02)).multiply(scale.makeScale(run.x1 - run.x0, 1, 1)), 1);
        }
        let plaque = plaques.get(item.raidId);
        if (!plaque) { plaque = makePlaque(item); if (plaque) plaques.set(item.raidId, plaque); }
        if (plaque) {
          plaque.mesh.position.copy(new THREE.Vector3(0, 1.23, 0.14).applyQuaternion(q).add(site.pos));
          plaque.mesh.quaternion.copy(q); plaque.mesh.visible = true;
        }
        bounds.expandByPoint(site.pos.clone().add(new THREE.Vector3(-RAID_PENNANT_WALL_RADIUS, 0, -RAID_PENNANT_WALL_RADIUS)));
        bounds.expandByPoint(site.pos.clone().add(new THREE.Vector3(RAID_PENNANT_WALL_RADIUS, RAID_PENNANT_WALL_HEIGHT, RAID_PENNANT_WALL_RADIUS)));
        count++;
      }
      bays?.flush(); for (const p of pools.values()) p.flush();
    },
    sites(): readonly RaidPennantSite[] { return drawnSites; },
    stats(): Record<string, number> {
      const size = bounds.isEmpty() ? new THREE.Vector3() : bounds.getSize(new THREE.Vector3());
      const centre = bounds.isEmpty() ? new THREE.Vector3() : bounds.getCenter(new THREE.Vector3());
      return { revision, firstX: first.x, firstY: first.y, firstZ: first.z, firstFaceX: firstFace.x, firstFaceZ: firstFace.z, centreX: centre.x, centreY: centre.y, centreZ: centre.z, pennants: count, posts: count * 2, plaques: [...plaques.values()].filter(p => p.mesh.visible).length,
        boundsX: size.x, boundsY: size.y, boundsZ: size.z, span: Math.max(size.x, size.z), anchors: count };
    },
    dispose(): void {
      if (disposed) return; disposed = true; clearGeometry(); clearPlaques(); revision++;
      bays?.dispose(); for (const p of pools.values()) p.dispose(); pools.clear(); designs.clear();
      drawnSites = []; frame = null; ground = undefined; layout = null; slots.clear(); plaqueGeometry.dispose(); layer.removeFromParent();
    },
  };
}
