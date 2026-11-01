// SIMULATED bench ground for PinkKittyRose's landing: the river hall standing on its bank, the landing and grand stair
// climbing to its town door from a paved market square, and the glass screen out in the square holding a plain
// lancet. The square, the bank and their heights are bench fixtures, never a land decision; the real site, turn and
// ground belong to main. Production code never imports this module.
import type { Vec3, VoxelBlueprint } from '@chatdom/shared';
import { MAT } from '../../../../materials';
import { composePlainGlass } from '../../../../genesis-emotes/glass';
import { EMOTE_ART_KITS } from '../../../../genesis-emotes/kit';
import { Boxes } from '../../../../genesis-landmarks/kit';
import { RIVER_HALL, createRiverHall } from '../../../../genesis-landmarks/river-hall/hall';
import { HALL_LANDING, createGlassScreen, createHallLanding } from '../index';

export const CELL = 0.125;
export interface BenchPlacement { readonly id: string; readonly blueprint: VoxelBlueprint; readonly origin: Vec3; readonly yaw: number }
export interface BenchView { readonly eye: Vec3; readonly target: Vec3; readonly fov: number }

const RISE = 40;

/**
 * World frame: metres, the market floor at y = 0, the landing's hall face at x = 0 with the stair running down +X.
 * The landing's own cells sit a metre lower (its y = 8 is the market floor).
 */
export function pinkkittyBench() {
  const landing = createHallLanding({ riseCells: RISE });
  const T = HALL_LANDING.market + RISE;
  const hall = createRiverHall({ style: 'hearth', wheel: false, crest: { shape: 'round', charge: 'star' }, bannerCut: 'forked', colours: { field: MAT.fabricViolet, band: MAT.cream } });
  // The hall turns a quarter so its town door faces down the stair: hall +Z → world +X, hall +X → world −Z. Its
  // bank (y 32) meets the platform's top; its door face (z 228) meets the landing's x = 0; its door's middle
  // (x 56) lies on the landing's centre line.
  const lift = T - RIVER_HALL.bank;
  const cells = (x: number, y: number, z: number): Vec3 => [x * CELL, (y - HALL_LANDING.market) * CELL, z * CELL];
  const hallAt = cells(-228, lift, 104);

  // The bank and the square: a 256-cell field of paving and grass, the bank standing at the hall's level behind
  // the landing with a grey retaining face to the square. The landing's footprint is left out of the paving.
  const g = new Boxes(), gx = -64, gz = -80, [lx, , lz] = landing.size;
  const GW = 256, GD = 256;
  g.add(0, 0, 0, GW, HALL_LANDING.market - 2, GD, MAT.earth);
  g.add(0, HALL_LANDING.market - 2, 0, GW, HALL_LANDING.market, GD, MAT.grass);
  // A paved square in big grey-and-buff squares out to x = 192, z ∈ [−40, 160).
  g.add(-gx, HALL_LANDING.market - 1, -40 - gz, GW, HALL_LANDING.market, 160 - gz, MAT.paving);
  for (let x = 0; x < GW + gx; x += 12) for (let z = -40; z < 160; z += 12) if (((x + z + 48) / 12) % 2 === 0) g.add(x - gx, HALL_LANDING.market - 1, z - gz, Math.min(GW, x - gx + 12), HALL_LANDING.market, Math.min(160 - gz, z - gz + 12), MAT.stone);
  g.add(-gx, 0, -gz, lx - gx, HALL_LANDING.market, lz - gz, MAT.air);
  // The bank beside and behind the hall's near abutment, at the platform's height.
  for (const [z0, z1] of [[gz, -8], [104, gz + GD]] as const) {
    g.add(0, 0, z0 - gz, -gx, T, z1 - gz, MAT.earth);
    g.add(0, T - 2, z0 - gz, -gx, T, z1 - gz, MAT.grass);
    g.add(-gx - 2, HALL_LANDING.market - 1, z0 - gz, -gx, T - 1, z1 - gz, MAT.stone);
    g.add(-gx - 2, T - 1, z0 - gz, -gx, T, z1 - gz, MAT.darkStone);
  }
  g.add(0, 0, -8 - gz, -gx, lift, 104 - gz, MAT.earth);
  const ground: VoxelBlueprint = { version: 1, id: 'pinkkitty-landing-bench-ground', styleId: 'hearth' as VoxelBlueprint['styleId'], kind: 'prop', lattice: 'build', size: [GW, T, GD], boxes: g.list, windows: [] };

  // The glass screen out in the square beyond the stair's left shoulder, its window turned to the stair's axis.
  const glass = composePlainGlass(EMOTE_ART_KITS.hearth), screen = createGlassScreen(glass);
  const screenAt = cells(112, HALL_LANDING.market, -76);
  const yaw = 0;
  const turn = (p: Vec3): Vec3 => [screenAt[0] + p[0] * CELL, screenAt[1] + p[1] * CELL, screenAt[2] + p[2] * CELL];
  const glassAt = turn([screen.glassOffset[0], screen.glassOffset[1], screen.glassOffset[2]]);

  const landingAt = cells(0, 0, 0);
  const fires: Vec3[] = [
    ...landing.fires.map(f => [landingAt[0] + f[0] * CELL, landingAt[1] + f[1] * CELL, landingAt[2] + f[2] * CELL] as Vec3),
    ...screen.fires.map(turn),
  ];
  return {
    landing, screen, glass, fires,
    placements: [
      { id: 'ground', blueprint: ground, origin: cells(gx, 0, gz), yaw: 0 },
      { id: 'hall', blueprint: hall.blueprint, origin: hallAt, yaw: Math.PI / 2 },
      { id: 'landing', blueprint: landing.blueprint, origin: landingAt, yaw: 0 },
      { id: 'screen', blueprint: screen.blueprint, origin: screenAt, yaw },
      { id: 'glass', blueprint: glass.blueprint, origin: glassAt, yaw },
    ] satisfies BenchPlacement[],
    views: {
      // From the square, off the stair's right shoulder: the flight, its terraces and fires, the hall's door above.
      landing: { eye: [27, 5.2, 24], target: [5.5, 3.2, 6], fov: 48 },
      // The screen from in front and a little to one side, the stair beyond.
      screen: { eye: [12.2, 2.0, 7.4], target: [17.75, 5.6, -8.2], fov: 56 },
      // From behind the screen: the lamp basket that lights the glass from the back.
      back: { eye: [22.5, 2.4, -17.5], target: [17.6, 4.2, -8.6], fov: 54 },
    } satisfies Record<string, BenchView>,
    shadowBounds: { min: [-30, -2, -14] as Vec3, max: [32, 26, 26] as Vec3 },
  };
}
