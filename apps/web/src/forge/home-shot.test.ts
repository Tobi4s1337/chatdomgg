import { expect, it } from 'vitest';
import * as THREE from 'three';
import { forgeFlightShot } from './home-shot';

it('keeps the launch camera above the smithy before looking up at the airborne gift', () => {
  const home = new THREE.Box3(new THREE.Vector3(-3, 0, -3), new THREE.Vector3(3, 8, 3));
  const gift = new THREE.Box3(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 2, 1));
  const position = new THREE.Vector3(0, 0, -40);
  const launch = forgeFlightShot(home, gift, new THREE.Matrix4().makeTranslation(0, 1.6, 0), position, 0, 1920, 1080, 0);
  expect(launch.target.clone().add(launch.offset).y).toBeGreaterThan(1.6);
  const cruise = forgeFlightShot(home, gift, new THREE.Matrix4().makeTranslation(0, 20, -20), position, 0, 1920, 1080, .5);
  expect(cruise.target.clone().add(cruise.offset).y).toBeLessThan(gift.getCenter(new THREE.Vector3()).y + 20);
});
