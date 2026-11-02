import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { MATERIALS } from '@chatdom/content';
import { createVoxelMaterial } from '@chatdom/render';
import type { RealmWalkerFeed, RealmWalkerFrame } from '@chatdom/shared/realm';
import { createMonarchView } from './index';
import { CROWN_HEIGHT_M, CROWN_SEAT_M, CROWN_TAG_LIFT_M } from './crown';

/** The stream's walker feed, as far as the monarch view reads it: ids and the room's crown marks. */
const feedOf = (walkers: readonly { id: string; crown?: string }[]): RealmWalkerFeed =>
  ({ subscribe(receive: (frame: RealmWalkerFrame) => void) { receive({ walkers } as unknown as RealmWalkerFrame); return () => {}; } }) as RealmWalkerFeed;

function setup(walkers: readonly { id: string; crown?: string }[]) {
  const scene = new THREE.Scene(), lighting = createVoxelMaterial(MATERIALS, 'avatar');
  const view = createMonarchView({ scene, lighting, kingdomId: '129634568', plan: null, bell: () => {}, storage: null });
  view.observe(feedOf(walkers)).subscribe(() => {}, () => {});
  const camera = new THREE.PerspectiveCamera(42, 1440 / 900, .1, 200);
  camera.position.set(0, 1.7, 4); camera.lookAt(0, 1.5, 0); camera.updateMatrixWorld();
  const heads = new Map([['king', new THREE.Vector3(0, 1.92, 0)], ['citizen', new THREE.Vector3(1.4, 1.9, -.8)]]);
  const poses = [{ id: 'king', x: 0, y: 0, z: 0, yaw: 0 }, { id: 'citizen', x: 1.4, y: 0, z: -.8, yaw: 0 }];
  view.frame(1000, { people: { poses, heads }, camera, night: 0, time: 1 });
  const project = (point: THREE.Vector3) => (1 - point.clone().project(camera).y) * 900 / 2;
  const labels = poses.map(pose => ({ id: pose.id, name: pose.id === 'king' ? 'tobi4s_' : 'mossbright', self: false, x: 0, y: project(heads.get(pose.id)!), distance: 4 }));
  return { view, labels, heads, project, scene };
}

describe('the monarch’s name tag', () => {
  it('reads the title and stands above the crown’s tips, by the crown’s own projected height', () => {
    expect(CROWN_TAG_LIFT_M).toBeCloseTo(CROWN_HEIGHT_M - CROWN_SEAT_M + .08, 6);
    const { view, labels, heads, project, scene } = setup([{ id: 'king', crown: 'Monarch' }, { id: 'citizen' }]);
    expect(scene.getObjectByName('monarch-crown')).toBeTruthy();
    const [king, citizen] = view.labels(labels, 900);
    expect(king!.name).toBe('Monarch tobi4s_');
    const head = heads.get('king')!;
    expect(king!.y).toBeCloseTo(project(new THREE.Vector3(head.x, head.y + CROWN_TAG_LIFT_M, head.z)), 3);
    expect(king!.y).toBeLessThan(labels[0]!.y - 20);
    expect(citizen).toEqual(labels[1]);
  });

  it('leaves every tag where it was without a viewport, and names nobody without the room’s mark', () => {
    const crowned = setup([{ id: 'king', crown: 'Monarch' }]);
    expect(crowned.view.labels(crowned.labels)[0]).toEqual({ ...crowned.labels[0], name: 'Monarch tobi4s_' });
    const plain = setup([{ id: 'king' }]);
    expect(plain.view.labels(plain.labels, 900)).toEqual(plain.labels);
  });
});
