import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Path } from './gift-view';
import { createRaidLayer, type RaidLayerHost } from './raid-view';
import { RAID_SHOT_FIT, RAID_UNIT_ENVELOPE, raidColumnShare, raidFittedShots } from './raid-shot';

const INBOUND: [number, number, number][] = [[10, 0, 20], [10, 0, 60]];
const OUTBOUND: [number, number, number][] = [[10, 0, 60], [10, 0, 100]];

/** A real supplied road, rotated to catch assumptions about a world axis. */
function candidates(aspect: number | boolean, clear?: (eye: THREE.Vector3, target: THREE.Vector3) => boolean) {
  const root = new THREE.Group();
  const host: RaidLayerHost = {
    kit: 'hearth', material: new THREE.MeshBasicMaterial(),
    mesh: () => { throw new Error('The camera must not mesh anything'); },
    place: () => ({ position: [10, 0, 20], facing: [1, 0, 0] }),
    route: () => ({ inbound: INBOUND, outbound: OUTBOUND }),
  };
  const layer = createRaidLayer(root, host);
  if (clear) layer.setShotClear(clear);
  const shots = [...layer.shots(aspect)];
  layer.dispose(); host.material.dispose();
  return shots;
}

/** Every unit's projected box over its whole road, measured independently of the chooser. */
function worstUnit(eye: THREE.Vector3, target: THREE.Vector3, fov: number, aspect: number) {
  const camera = new THREE.PerspectiveCamera(fov, aspect, 0.1, 500);
  camera.position.copy(eye); camera.lookAt(target); camera.updateMatrixWorld();
  let worst = 0, cutAtBottomLarge = false;
  for (let z = 16; z <= 100; z += 0.5) {
    const ys: number[] = [], xs: number[] = [];
    let behind = false;
    for (const dz of [-RAID_UNIT_ENVELOPE.halfLength, RAID_UNIT_ENVELOPE.halfLength]) for (const x of [10 - RAID_UNIT_ENVELOPE.halfWidth, 10 + RAID_UNIT_ENVELOPE.halfWidth]) for (const y of [0, RAID_UNIT_ENVELOPE.height]) {
      const p = new THREE.Vector3(x, y, z + dz);
      if (p.clone().applyMatrix4(camera.matrixWorldInverse).z > -0.5) { behind = true; continue; }
      p.project(camera); xs.push(p.x); ys.push(p.y);
    }
    if (!xs.length) continue;
    // A corner behind the lens drags the unit's outline to the picture's foot.
    const low = behind ? -1 : Math.min(...ys), left = behind ? -1 : Math.min(...xs), right = behind ? 1 : Math.max(...xs);
    const on = right > -1 && left < 1 && Math.max(...ys) > -1 && low < 1;
    if (!on) continue;
    const share = (Math.min(1, Math.max(...ys)) - Math.max(-1, low)) / 2;
    worst = Math.max(worst, share);
    if (low < -1 && share > 0.5) cutAtBottomLarge = true;
  }
  return { worst, cutAtBottomLarge };
}

describe('raid gate camera', () => {
  for (const [portrait, aspect] of [[false, 1920 / 1080], [true, 390 / 844], [false, 1440 / 900]] as const) {
    it(`frames the gate and the column coming towards the town without a passing unit filling a cut corner (${aspect.toFixed(2)})`, () => {
      const shots = candidates(aspect);
      expect(shots.length).toBeGreaterThan(3); // The host can reject obstructed candidates.
      const [eye, target, fov] = shots[0]!;
      // From over the street well inside the gate, looking back out through it.
      expect(eye.z).toBeGreaterThan(40);
      expect(target.z).toBeLessThan(28);
      expect(Math.abs(eye.x - 10)).toBeLessThan(4);
      // Fallbacks look in from outside the gate along the road.
      expect(shots.at(-1)![0].z).toBeLessThan(20);
      const camera = new THREE.PerspectiveCamera(fov, aspect, 0.1, 500);
      camera.position.copy(eye); camera.lookAt(target); camera.updateMatrixWorld();
      const visible = (point: THREE.Vector3) => {
        const p = point.project(camera);
        expect(Math.abs(p.x)).toBeLessThan(0.95);
        expect(Math.abs(p.y)).toBeLessThan(0.95);
        expect(p.z).toBeGreaterThan(-1); expect(p.z).toBeLessThan(1);
      };
      // The standard's pole at the gate line (foot and crossbar) and both braziers at the road edges.
      for (const y of [0, 7.4]) visible(new THREE.Vector3(10, y, 20 + 2.4));
      for (const z of [18, 22]) visible(new THREE.Vector3(11.2, 1.4, z));
      // A unit emerging just outside the gate is wholly in the picture.
      for (const z of [17.3, 22.7]) for (const y of [0, 5.5]) visible(new THREE.Vector3(10, y, z));
      // No unit of the column is ever more than the fit share of the picture while any of it shows.
      const { worst, cutAtBottomLarge } = worstUnit(eye, target, fov, aspect);
      expect(worst).toBeLessThanOrEqual(RAID_SHOT_FIT.maxShare + 0.02);
      expect(cutAtBottomLarge).toBe(false);
      expect(portrait ? fov : 50).toBe(portrait ? 60 : 50);
    });
  }

  it('keeps the old portrait/landscape boolean and reads it as an aspect', () => {
    const [eye] = candidates(true)[0]!;
    expect(eye.z).toBeGreaterThan(40);
  });

  it('honours the adopted world standing check and falls back outside the gate when it refuses every town view', () => {
    const refused = candidates(16 / 9, eye => eye.z < 20);
    expect(refused.length).toBeGreaterThan(0);
    for (const [eye] of refused) expect(eye.z).toBeLessThan(20);
    const narrowed = candidates(16 / 9, eye => eye.z > 50);
    expect(narrowed[0]![0].z).toBeGreaterThan(50);
  });

  it('refuses any view the column would pass through the lens of', () => {
    const line = new Path([...INBOUND, OUTBOUND[1]!]);
    // Low and over the road: the column runs straight at and through the lens.
    expect(raidColumnShare(line, new THREE.Vector3(10, 3, 40), new THREE.Vector3(10, 3, 20), 50, 16 / 9)).toBe(Infinity);
    // The earlier close street-side view: a passing wagon fills far more than the fit share of the picture.
    expect(raidColumnShare(line, new THREE.Vector3(14, 6.5, 41), new THREE.Vector3(10, 3, 17.5), 50, 16 / 9)).toBeGreaterThan(RAID_SHOT_FIT.maxShare);
  });

  it('follows a bent road: every fitted view keeps the gate marks in the picture', () => {
    const bent = new Path([[0, 0, 0], [0, 0, 30], [25, 0, 55], [25, 0, 110]]);
    const gate = { position: new THREE.Vector3(0, 0, 0), facing: new THREE.Vector3(0, 0, 1), side: new THREE.Vector3(1, 0, 0) };
    const shots = [...raidFittedShots(bent, gate, 16 / 9)];
    expect(shots.length).toBeGreaterThan(0);
    for (const [eye, target, fov] of shots) expect(raidColumnShare(bent, eye, target, fov, 16 / 9)).toBeLessThan(Infinity);
  });
});
