import * as THREE from 'three';
import { createNativeForgeHost } from '@chatdom/forge';
import type { HomeTier } from '@chatdom/shared';
import { homeFrame, terrainHeight, type SettlementHome } from '@chatdom/world';
import { createMomentStage, type MomentStage } from '../twitch-moments-bench/stage';
import { placeMarketContent, type Dressing } from '../kingdom/settlement-content';
import type { HistoricalSnapshot, ReplayBinding } from './replay';
import { simulatedHistory, simulatedWorldRevision } from './simulated';

const TIERS: readonly HomeTier[] = ['hut', 'cottage', 'house', 'manor', 'hall'];
const SEED = 'chronicle-lantern';
type Pose = { eye: [number, number, number]; target: [number, number, number]; fov: number };

/** Pick a real settlement plot and a clear view of its front, using the same collision test as the engine bench. */
function selectPlot(stage: MomentStage): { plot: SettlementHome; pose: Pose } {
  const homes = stage.layout.homes.filter(home => home.style === 'hearth');
  for (const plot of homes) {
    const { front, outward, right } = homeFrame(plot);
    for (const side of [10, -10, 3, -3]) {
      const x = front[0] + outward[0] * 26 + right[0] * side, z = front[2] + outward[2] * 26 + right[2] * side;
      const pose: Pose = { eye: [x, Math.max(front[1], terrainHeight(stage.layout, x, z)) + 12, z],
        target: [front[0] - outward[0] * 2, front[1] + 4, front[2] - outward[2] * 2], fov: 42 };
      if (stage.validatePose(pose)) return { plot, pose };
    }
  }
  throw new Error('This simulated town has no clear view of a Hearth plot.');
}

/** Compare the production packed voxel geometry as well as the placement, so an overlapping prop cannot be hidden. */
function sameGeometry(left: THREE.BufferGeometry, right: THREE.BufferGeometry): boolean {
  for (const name of ['aPacked', 'aMaterial']) {
    const a = left.getAttribute(name), b = right.getAttribute(name);
    if (!a || !b || a.count !== b.count || a.itemSize !== b.itemSize) return false;
    for (let i = 0; i < a.count; i++) if (a.getX(i) !== b.getX(i)) return false;
  }
  const a = left.getIndex(), b = right.getIndex();
  if (!a || !b || a.count !== b.count) return false;
  for (let i = 0; i < a.count; i++) if (a.getX(i) !== b.getX(i)) return false;
  return true;
}

/** Find exactly the installed instance for an authored placement, even where other props share a mesh. */
function originalInstance(stage: MomentStage, placement: Pick<Dressing, 'position' | 'yaw'>, originalGeometry: THREE.BufferGeometry): { mesh: THREE.InstancedMesh; index: number; matrix: THREE.Matrix4 } {
  const desired = new THREE.Matrix4().compose(new THREE.Vector3(...placement.position),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), placement.yaw), new THREE.Vector3(1, 1, 1));
  const matrix = new THREE.Matrix4();
  let result: { mesh: THREE.InstancedMesh; index: number; matrix: THREE.Matrix4 } | undefined;
  stage.parent.parent?.traverse(object => {
    if (result || !(object instanceof THREE.InstancedMesh)) return;
    for (let i = 0; i < object.count; i++) {
      object.getMatrixAt(i, matrix);
      if (matrix.elements.every((v, n) => Math.abs(v - desired.elements[n]!) < 1e-5) && sameGeometry(object.geometry, originalGeometry)) {
        result = { mesh: object, index: i, matrix: matrix.clone() }; break;
      }
    }
  });
  if (!result) throw new Error('An installed simulated asset could not be isolated.');
  return result;
}

/** Sightline to the open middle of the actual generated market, with the stall fronts in frame. */
function marketPose(stage: MomentStage): Pose {
  const square = stage.layout.market, centre = square.boundary.reduce((sum, p) => [sum[0]! + p[0], sum[1]! + p[1]], [0, 0]);
  const x = centre[0]! / square.boundary.length, z = centre[1]! / square.boundary.length, y = square.elevation;
  for (const [dx, dz] of [[32, 42], [40, -32], [-36, 40], [-40, -32]] as const) {
    const ex = x + dx, ez = z + dz;
    const pose: Pose = { eye: [ex, Math.max(y, terrainHeight(stage.layout, ex, ez)) + 24, ez], target: [x, y + 2, z], fov: 42 };
    if (stage.validatePose(pose)) return pose;
  }
  throw new Error('The simulated market has no clear view.');
}

/**
 * A separate, read-only simulated scene. It uses the existing kingdom stage, authored houses, voxel worker,
 * terrain, lights and renderer. The selected home and market use explicit construction revisions; the generated castle,
 * streets, other civic places and other homes are fixed scenery, not claimed historical reconstructions.
 */
export async function createSimulatedScene(canvas: HTMLCanvasElement, options: { signal: AbortSignal; onProgress(fraction: number): void }) {
  const stage = await createMomentStage(canvas, { seed: SEED, hour: 19.6, signal: options.signal, onProgress: fraction => options.onProgress(fraction * .8) });
  const geometry: THREE.BufferGeometry[] = [];
  try {
    const { plot, pose } = selectPlot(stage), marketView = marketPose(stage), history = simulatedHistory(stage.layout, plot);
    const variants = new Map<string, THREE.Mesh>();
    const revisions = new Map(stage.layout.homes.filter(home => home.id !== plot.id).map(home => [home.id, createNativeForgeHost(home).blueprint.id]));
    for (const [index, tier] of TIERS.entries()) {
      if (options.signal.aborted) throw new DOMException('Chronicle closed while loading.', 'AbortError');
      const native = createNativeForgeHost({ ...plot, tier });
      const meshGeometry = await stage.mesh(native.blueprint); geometry.push(meshGeometry);
      const mesh = new THREE.Mesh(meshGeometry, stage.material);
      mesh.position.set(...native.position); mesh.rotation.y = native.yaw; mesh.visible = false;
      stage.parent.add(mesh); variants.set(native.blueprint.id, mesh); options.onProgress(.8 + (index + 1) * .025);
    }
    if (options.signal.aborted) throw new DOMException('Chronicle closed while loading.', 'AbortError');
    const installed = createNativeForgeHost(plot).blueprint.id;
    const originalGeometry = variants.get(installed)?.geometry;
    if (!originalGeometry) throw new Error('The installed home asset is unavailable.');
    const house = stage.houses.find(item => item.slot === plot.slot);
    if (!house) throw new Error('The simulated plot has no installed geometry.');
    const original = originalInstance(stage, house, originalGeometry);
    // The original stage contains the entire authored market. Level one retains its well and first stall;
    // the recorded level-two construction installs the second stall, cart and stores at their real anchors.
    const marketAssets = placeMarketContent(stage.layout.market).filter((_, index) => index === 2 || index === 3 || index === 4);
    const marketInstances: ReturnType<typeof originalInstance>[] = [];
    for (const [index, asset] of marketAssets.entries()) {
      if (options.signal.aborted) throw new DOMException('Chronicle closed while loading.', 'AbortError');
      const reference = await stage.mesh(asset.blueprint); geometry.push(reference);
      marketInstances.push(originalInstance(stage, asset, reference));
      options.onProgress(.925 + (index + 1) * .025);
    }
    stage.setPose(pose);
    let disposed = false;
    const restore = () => {
      for (const mesh of variants.values()) mesh.visible = false;
      original.mesh.setMatrixAt(original.index, original.matrix); original.mesh.instanceMatrix.needsUpdate = true;
      for (const item of marketInstances) { item.mesh.setMatrixAt(item.index, item.matrix); item.mesh.instanceMatrix.needsUpdate = true; }
    };
    const binding: ReplayBinding = {
      replace(snapshot: HistoricalSnapshot) {
        if (disposed) throw new Error('Chronicle scene is closed.');
        const market = snapshot.frame.civic.market;
        if ((market !== 1 && market !== 2) || snapshot.worldRevision !== simulatedWorldRevision(stage.layout, market) || snapshot.frame.origin !== 'simulated'
          || snapshot.frame.civic.tavern !== 1 || snapshot.frame.civic.forge !== 1 || snapshot.frame.civic.bridge !== 1 || snapshot.frame.civic['castle-court'] !== 1
          || snapshot.homes.length !== stage.layout.homes.length
          || snapshot.homes.some(home => home.plotId !== plot.id && revisions.get(home.plotId) !== home.assetRevision)) throw new Error('The simulated scene revision is unavailable.');
        const revision = snapshot.homes.find(home => home.plotId === plot.id)?.assetRevision;
        const chosen = revision && variants.get(revision);
        if (!chosen) throw new Error('The recorded home asset is unavailable.');
        for (const mesh of variants.values()) mesh.visible = mesh === chosen;
        original.mesh.setMatrixAt(original.index, new THREE.Matrix4().makeScale(0, 0, 0));
        original.mesh.instanceMatrix.needsUpdate = true;
        for (const item of marketInstances) {
          item.mesh.setMatrixAt(item.index, market === 2 ? item.matrix : new THREE.Matrix4().makeScale(0, 0, 0));
          item.mesh.instanceMatrix.needsUpdate = true;
        }
        stage.setPose(snapshot.focus === 'market' ? marketView : pose);
      },
      clear() { if (!disposed) restore(); },
      dispose() { if (disposed) return; restore(); disposed = true; for (const mesh of variants.values()) stage.parent.remove(mesh); geometry.forEach(item => item.dispose()); stage.dispose(); },
    };
    return { history, binding, render: (atMs: number) => { if (!disposed) stage.render(atMs); }, lightingReady: () => !disposed && stage.stats().lightingReady, plotId: plot.id };
  } catch (error) { geometry.forEach(item => item.dispose()); stage.dispose(); throw error; }
}
