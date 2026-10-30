import { MAT, STYLES, createMarketStall, createMarketWell, createStreetProp, createTree } from '@chatdom/content';
import type { VoxelBlueprint } from '@chatdom/shared';

/** A placed review blueprint: its minimum corner in world metres and a yaw in radians. */
export interface Dressing { blueprint: VoxelBlueprint; position: readonly [number, number, number]; yaw: number }

const fract = (n: number) => n - Math.floor(n);
const tileHash = (x: number, z: number) => fract(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453);

/**
 * The empty market square the forge stands in: laid stones with sunken joints, grass beyond.
 * 256 build cells (32 m) square; its walking surface is two cells up.
 */
export function createForgeSquare(): VoxelBlueprint {
  const size = 256, half = size / 2, radius = 84, tile = 8;
  const boxes: VoxelBlueprint['boxes'] = [{ from: [0, 0, 0], to: [size, 1, size], material: MAT.earth }];
  for (let z = 0; z < size; z += tile) {
    // Grass outside the square, row by row, meeting the outermost laid stone.
    const dz = Math.abs(z + tile / 2 - half), span = dz < radius ? Math.floor(Math.sqrt(radius * radius - dz * dz) / tile) * tile : 0;
    if (span === 0) { boxes.push({ from: [0, 1, z], to: [size, 2, z + tile], material: MAT.grass }); continue; }
    boxes.push({ from: [0, 1, z], to: [half - span, 2, z + tile], material: MAT.grass });
    boxes.push({ from: [half + span, 1, z], to: [size, 2, z + tile], material: MAT.grass });
    for (let x = half - span; x < half + span; x += tile) {
      const h = tileHash(x, z), material = h < 0.55 ? MAT.paving : h < 0.82 ? MAT.stone : h < 0.94 ? MAT.limestone : MAT.moss;
      boxes.push({ from: [x, 1, z], to: [x + tile - 1, 2, z + tile - 1], material });
    }
  }
  return { version: 1, id: 'forge-mood-square', styleId: STYLES.tide.id, kind: 'prop', lattice: 'build', size: [size, 2, size], boxes, windows: [] };
}

/** The forge's neighbours, laid out as the kingdom's market lays them out around its anvil. Nobody is here. */
export function forgeDiorama(): Dressing[] {
  return [
    { blueprint: createForgeSquare(), position: [-16, -0.25, -16], yaw: 0 },
    { blueprint: createMarketStall(0), position: [-17, 0, -13], yaw: 0 },
    { blueprint: createMarketStall(1), position: [-21, 0, 1], yaw: 0 },
    { blueprint: createMarketWell(), position: [8, 0, 8], yaw: 0 },
    // Trees along the far edge of the square soften the horizon behind the forge.
    { blueprint: createTree(1), position: [1, 0, -20], yaw: 0.4 },
    { blueprint: createTree(0), position: [-9, 0, -23], yaw: 1.1 },
    { blueprint: createTree(2), position: [12, 0, -23], yaw: -0.6 },
    { blueprint: createStreetProp('flower-trough', 'tide'), position: [-5.4, 0, 0.8], yaw: 1.2 },
    { blueprint: createStreetProp('rock-cluster', 'tide'), position: [3, 0, -2.6], yaw: -0.3 },
    { blueprint: createStreetProp('leafy-shrub', 'tide'), position: [-7.4, 0, -5.4], yaw: 0 },
  ];
}
