import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { CollisionWorld, SolidBox } from '@chatdom/shared/realm';
import { createTavernKit, TAVERN_FLOOR, TAVERN_ROOM_BOUNDS } from '../../../../packages/content/src/tavern';
import { clearShot } from '../interactions/places/framing';
import { tableGame } from '../games/boards';
import { tavernTableFraming } from './framing';

function interior(style: 'hearth' | 'tide') {
  const kit = createTavernKit(style), [w, d] = TAVERN_ROOM_BOUNDS;
  const boxes: SolidBox[] = [
    { min: [0, -2, 0], max: [w, TAVERN_FLOOR, d] }, ...kit.solids,
    { min: [-1000, -1000, -1000], max: [0, 1000, 1000] },
    { min: [w, -1000, -1000], max: [1000, 1000, 1000] },
    { min: [0, -1000, -1000], max: [w, 1000, 0] },
    { min: [0, -1000, d], max: [w, 1000, 1000] },
  ];
  const world: CollisionWorld = { revision: 1, query: bounds => boxes.filter(box =>
    box.min.every((v, a) => v <= bounds.max[a]!) && box.max.every((v, a) => v >= bounds.min[a]!)) };
  return { kit, world };
}

describe('seated table framing', () => {
  it('keeps authored boards visible and clear for every chair, room style and viewport', () => {
    for (const style of ['hearth', 'tide'] as const) {
      const { kit, world } = interior(style);
      expect(kit.tables.flatMap(t => t.seats)).toHaveLength(12);
      for (const table of kit.tables) for (const seat of table.seats) for (const aspect of [1440 / 900, 390 / 844]) {
        const game = tableGame(table.id), label = `${style} ${seat.key} ${game} ${aspect}`;
        const shot = tavernTableFraming(table.centre, seat.facing, game, aspect, world);
        expect(shot, label).not.toBeNull();
        if (!shot) continue;
        expect(clearShot(world, shot), label).toEqual(shot);
        const eye = shot.eye;
        if (game === 'stones') expect(eye[1], `${label} below the authored rafters`).toBeLessThan(4.125);
        expect(world.query({ min: eye, max: eye }), label).toHaveLength(0);
        const camera = new THREE.PerspectiveCamera(shot.fov, aspect, .01, 100);
        camera.position.set(...shot.eye); camera.lookAt(...shot.at); camera.updateMatrixWorld();
        const [x, y, z] = table.centre;
        if (game !== 'stones') {
          const rx = -Math.cos(seat.facing), rz = Math.sin(seat.facing);
          const left = new THREE.Vector3(x - rx * .2, y + .1, z - rz * .2).project(camera);
          const right = new THREE.Vector3(x + rx * .2, y + .1, z + rz * .2).project(camera);
          expect(Math.abs(left.y - right.y), `${label} flat board roll`).toBeLessThan(.0001);
          expect(Math.abs(left.x - right.x), `${label} flat board width`).toBeGreaterThan(.1);
        }
        // Bounds follow the actual game-board meshes in boards.ts and mount.ts.
        const points = game === 'stones'
          ? [-.64, .64].flatMap(dx => [.095, .9].map(dy => new THREE.Vector3(x + dx, y + dy, z)))
          : (game === 'pong' ? [-.625, .625] : [-.515, .515]).flatMap(dx =>
            (game === 'pong' ? [-.45, .45] : [-.35, .35]).map(dz => new THREE.Vector3(x + dx, y + (game === 'pong' ? .016 : .1), z + dz)));
        for (const p of points) {
          p.project(camera);
          expect.soft(Math.abs(p.x), `${label} x=${p.x}`).toBeLessThan(.98);
          expect.soft(p.y, `${label} y=${p.y}`).toBeLessThan(.98);
          expect.soft(p.y, `${label} y=${p.y}`).toBeGreaterThan(aspect < 1 ? -.5 : -.98);
          expect.soft(p.z, label).toBeLessThan(1);
        }
        if (aspect >= 1) {
          // Reserve the largest carved game card at the top right, including its action and stand controls.
          expect(Math.max(...points.map(p => p.x)) < .4 || Math.max(...points.map(p => p.y)) < .24,
            `${label} board clears the desktop HUD`).toBe(true);
        }
      }
    }
  });
});
