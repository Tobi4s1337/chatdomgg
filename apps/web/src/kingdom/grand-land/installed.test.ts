import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { decodeFoundedScene } from '../../../../../packages/world/src/founded-world/validate';
import { compileFoundedScene, foundedGroundAt, sampleFoundedTerrain } from '../../../../../packages/world/src/founded-world/collision';
import { prepareInstalledLand, installedVisualHeight, regionTouchesPhysical } from './prepare';
import { grandRecipeFor } from './recipes';

// Public GETs are acquired once by the reviewer, outside tests. Keep the scene (which can contain names)
// outside the repository. This acceptance check never connects to a live room or writes to its services.
const scenePath = process.env.GRAND_FOUNDED_SCENE, receiptPath = process.env.GRAND_FOUNDED_RECEIPT;
it.skipIf(!scenePath || !receiptPath)('preserves every physical column and installed placement in the receipt-matched kingdom', async () => {
  const scene = await decodeFoundedScene(new Uint8Array(readFileSync(scenePath!)), JSON.parse(readFileSync(receiptPath!, 'utf8')));
  const unchanged = JSON.stringify(scene);
  const recipe = grandRecipeFor(String(scene.kingdomId));
  expect(recipe).toBeDefined();
  const collision = compileFoundedScene(scene), grid = sampleFoundedTerrain(scene.plan);
  const { land, seated } = prepareInstalledLand(scene.plan, recipe!);
  let checked = 0;
  for (let row = 0; row < grid.rows; row++) for (let col = 0; col < grid.columns; col++) {
    const x = grid.origin[0] + (col + .5) * .5, z = grid.origin[2] + (row + .5) * .5;
    const height = foundedGroundAt(scene.plan, x, z)[1];
    const drawn = installedVisualHeight(land, seated, x, z);
    if (drawn !== height || grid.heights[col + row * grid.columns] !== height)
      throw new Error(`Ground mismatch at ${x},${z}: drawn ${drawn}, physical ${height}`);
    const solids = collision.query({ min: [x - .01, height - .01, z - .01], max: [x + .01, height + .01, z + .01] });
    if (!solids.some(box => box.min[1] === grid.origin[1] && box.max[1] === height))
      throw new Error(`Compiled terrain mismatch at ${x},${z}`);
    const rx = Math.floor((x + seated.seat.offset[0]) / 128), rz = Math.floor((z + seated.seat.offset[2]) / 128);
    if (!regionTouchesPhysical(rx, rz, seated)) throw new Error(`Physical region was not pinned at ${rx},${rz}`);
    checked++;
  }
  expect(checked).toBe(grid.columns * grid.rows);
  expect(JSON.stringify(scene)).toBe(unchanged);
  console.info(JSON.stringify({ checkedColumns: checked, seat: seated.seat.offset, landColumns: land.size, collisionRevision: collision.revision }));
}, 180_000);
