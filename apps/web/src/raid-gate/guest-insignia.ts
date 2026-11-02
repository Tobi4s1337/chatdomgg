import * as THREE from 'three';
import { MATERIALS } from '@chatdom/content';
import { geometryFromChunks } from '@chatdom/render';
import { parseRaidGuestVisualMark, type RaidGuestVisualMark } from '@chatdom/shared';
import type { VoxelWorkerPool } from '@chatdom/voxel';
import { TINCTURES, type Tincture } from '../atlas/heraldry';
import { bannerRuns, dyeBlueprint, raiderArms, TINCTURE_LIST } from '../twitch-moments/raid-art';
import { Pool } from '../twitch-moments/train-view';

const WIDTH = 9, ROWS = 12, MAX_PEOPLE = 300;
const MAX_RUNS = WIDTH * ROWS + 2, MAX_ARMS = 64;
const armsCache = new Map<string, { runs: ReturnType<typeof bannerRuns>; metal: Tincture }>();
export interface GuestInsigniaPose {
  readonly id: string;
  readonly position: readonly [number, number, number];
  readonly heading: number;
  readonly raidGuest?: unknown;
  readonly posture?: 'seated';
  readonly opacity?: number;
}

/** The exact Atlas arms, sampled once to the tabard's cloth cells. */
function guestInsigniaArms(mark: RaidGuestVisualMark) {
  const id = mark.fromKingdomId;
  const cached = armsCache.get(id);
  if (cached) { armsCache.delete(id); armsCache.set(id, cached); return cached; }
  const arms = raiderArms(id);
  if (!arms) return null;
  const result = { runs: bannerRuns(arms.design, { width: WIDTH, rows: ROWS, tail: 2, charges: true }), metal: arms.metal };
  if (armsCache.size >= MAX_ARMS) armsCache.delete(armsCache.keys().next().value!);
  armsCache.set(id, result);
  return result;
}

export function guestInsigniaRuns(mark: RaidGuestVisualMark) {
  return guestInsigniaArms(mark)?.runs ?? null;
}

/** A safe, accessible crest for the existing name label. Its caller owns the returned node. */
export function createGuestCrest(mark: RaidGuestVisualMark): SVGSVGElement | null {
  const runs = guestInsigniaRuns(mark);
  if (!runs) return null;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${WIDTH} ${ROWS}`);
  svg.setAttribute('width', '15'); svg.setAttribute('height', '20');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${mark.fromName} raid crest`);
  svg.classList.add('raid-guest-crest');
  for (let row = 0; row < runs.length; row++) for (const run of runs[row]!) {
    const rect = document.createElementNS(ns, 'rect');
    rect.setAttribute('x', String(run.x0)); rect.setAttribute('y', String(row));
    rect.setAttribute('width', String(run.x1 - run.x0)); rect.setAttribute('height', '1');
    rect.setAttribute('fill', TINCTURES[run.tincture].pigment); svg.append(rect);
  }
  return svg;
}

/**
 * One bounded batch per tincture. Host supplies the world's existing build-lattice material and worker.
 * Samples must be the same visible, admitted walkers sent to the citizen renderer; no identity is created here.
 */
export async function createGuestInsigniaLayer(scene: THREE.Scene, material: THREE.Material, worker: VoxelWorkerPool, clock: () => number) {
  const group = new THREE.Group(); group.name = 'raid guest insignia';
  const batches = new Map<Tincture, Pool>();
  try {
    for (const tincture of TINCTURE_LIST) {
      const result = await worker.submit({ kind: 'blueprint', blueprint: dyeBlueprint('hearth', tincture), revision: 1,
        materials: MATERIALS.materials, materialRevision: MATERIALS.revision });
      if (!result || result.kind !== 'asset') throw new Error('Could not mesh guest insignia dye');
      const geometry = geometryFromChunks(result.chunks, 'build');
      batches.set(tincture, new Pool(geometry, material, MAX_PEOPLE * MAX_RUNS, group, `guest insignia ${tincture}`));
      geometry.dispose();
    }
  } catch (error) { for (const batch of batches.values()) batch.dispose(); throw error; }
  scene.add(group);
  const local = new THREE.Matrix4(), root = new THREE.Matrix4(), combined = new THREE.Matrix4();
  const position = new THREE.Vector3(), scale = new THREE.Vector3(), rotation = new THREE.Quaternion();
  const axis = new THREE.Vector3(0, 1, 0), frustum = new THREE.Frustum(), projection = new THREE.Matrix4();
  const sphere = new THREE.Sphere(new THREE.Vector3(), 1.5);
  let count = 0;
  return {
    get count() { return count; },
    update(poses: readonly GuestInsigniaPose[], camera?: THREE.Camera) {
      for (const batch of batches.values()) batch.count = 0;
      count = 0;
      if (camera) { camera.updateMatrixWorld(); projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frustum.setFromProjectionMatrix(projection); }
      const now = clock(), seen = new Set<string>();
      for (const pose of poses) {
        if (count >= MAX_PEOPLE) break;
        if (seen.has(pose.id) || !Number.isFinite(pose.heading) || !pose.position.every(Number.isFinite)) continue;
        seen.add(pose.id);
        const mark = parseRaidGuestVisualMark(pose.raidGuest, now);
        if (!mark || (pose.opacity ?? 1) <= .01) continue;
        sphere.center.set(...pose.position).y += .8;
        if (camera && !frustum.intersectsSphere(sphere)) continue;
        const arms = guestInsigniaArms(mark); if (!arms) continue;
        const { runs, metal } = arms;
        rotation.setFromAxisAngle(axis, pose.heading);
        root.compose(position.set(...pose.position), rotation, scale.set(1, 1, 1));
        const seated = pose.posture === 'seated' ? -.25 : 0;
        // The apron sits just outside the torso, below the face and inside the arms.
        for (let row = 0; row < runs.length; row++) for (const run of runs[row]!) {
          const cell = .045;
          local.makeScale((run.x1 - run.x0) * cell / .125, cell / .125, .025 / .125);
          local.setPosition((run.x0 - WIDTH / 2) * cell, 1.13 + seated - row * cell, .31);
          combined.multiplyMatrices(root, local);
          batches.get(run.tincture)!.push(combined, pose.opacity ?? 1);
        }
        // Fine woven edging makes the cloth separate from the wearer's own garment;
        // it is the source arms' metal, never an invented third colour.
        for (const x of [-WIDTH * .045 / 2 - .012, WIDTH * .045 / 2]) {
          local.makeScale(.012 / .125, (.045 * ROWS) / .125, .03 / .125);
          local.setPosition(x, 1.13 + seated - (ROWS - 1) * .045, .308);
          combined.multiplyMatrices(root, local);
          batches.get(metal)!.push(combined, pose.opacity ?? 1);
        }
        count++;
      }
      for (const batch of batches.values()) batch.flush();
    },
    dispose() { for (const batch of batches.values()) batch.dispose(); group.removeFromParent(); count = 0; },
  };
}
