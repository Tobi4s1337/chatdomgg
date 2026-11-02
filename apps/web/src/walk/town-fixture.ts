/** Test-only citizens in the actual founded town, using its complete production collision compiler. */
import { compileFoundedScene, foundedGroundAt } from '@chatdom/world/founded-collision';
import { embeddedSolids, supported } from '@chatdom/world/movement';
import { createSimulatedKingdomWalkFixture } from '../../../../packages/testing/fixtures/kingdom-walk';

export function createSimulatedTownWalkFixture() {
  const { scene, sceneBytes, manifest } = createSimulatedKingdomWalkFixture();
  const world = compileFoundedScene(scene);
  const spawns = [[-1, 10], [0, 14], [1, 18]].map(([x, z]) => {
    const position = foundedGroundAt(scene.plan, x!, z!);
    const feet = { x: position[0], y: position[1], z: position[2] };
    if (embeddedSolids(feet, world).length || !supported(feet, world)) throw new Error('Test town spawn is not supported and clear');
    return position;
  });
  return { scene, sceneBytes, manifest, world, spawns,
    limitation: 'Test identities and memory-only authority. Full production founded collision, not a limited market floor. Visible terrain triangles may still differ from the physical support surface.' };
}
