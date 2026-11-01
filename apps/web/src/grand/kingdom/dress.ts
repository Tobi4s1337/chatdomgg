import { MAT, STYLES } from '@chatdom/content';
import type { VoxelBlueprint } from '@chatdom/shared';
import { terrainHeight } from '@chatdom/world';
import { clothArms, composeGenesisHeraldry, NEUTRAL_COLOURS, type ClothCut, type CrestCharge, type HeraldicColours } from '../../../../../packages/content/src/genesis-heraldry';
import { frameSettlement, settlementWater } from '../../../../../packages/world/src/grand/kingdom';
import { planTownWalls, type TownBannerAnchor, type TownWalls } from '../../../../../packages/world/src/grand/kingdom/walls';
import type { KingdomPlacement } from './mount';
import type { GrandKingdomContent } from './pieces';

/** Build cell, metres. */
const CELL = 0.125;

/**
 * How a kingdom's banners are dressed. `snapped`: the Genesis recipe's own cut, charge and profile colours snapped to
 * tinctures (a proposal, as the Genesis view shows it). `neutral`: no colours were observed, so the cloth wears the
 * land's own colours and carries no charge; it claims nothing about the channel.
 */
export interface KingdomLivery {
  readonly treatment: 'snapped' | 'neutral';
  readonly colours: HeraldicColours;
  readonly cut: ClothCut;
  readonly charge: CrestCharge | null;
}

export function kingdomLivery(kingdom: Pick<GrandKingdomContent, 'recipe' | 'landscape' | 'style'>): KingdomLivery {
  if (kingdom.recipe && kingdom.landscape) {
    const heraldry = composeGenesisHeraldry(kingdom.recipe, kingdom.landscape);
    if (heraldry.treatment.kind === 'snapped') return { treatment: 'snapped', colours: heraldry.colours, cut: heraldry.device.cut, charge: heraldry.device.charge };
    return { treatment: 'neutral', colours: heraldry.colours, cut: heraldry.device.cut, charge: null };
  }
  return { treatment: 'neutral', colours: NEUTRAL_COLOURS[kingdom.style], cut: 'square', charge: null };
}

/**
 * The hanging banner a wall tower's pole or a gatehouse carries: the standard's cloth at half its resolution
 * (12 × 28 cells, 1.5 × 3.5 m), two cells thick, on a timber bar with brass finials, hung in front of its anchor by
 * field-cloth loops. Origin at the bar's back left; the cloth faces local +Z.
 */
export function bannerBlueprint(livery: KingdomLivery, style: GrandKingdomContent['style']): VoxelBlueprint {
  const arms = clothArms(livery.cut, livery.charge ?? 'oak');
  const width = 12, rows = 28, bar = 16, top = rows + 3;
  const boxes: VoxelBlueprint['boxes'][number][] = [];
  const add = (x: number, y: number, z: number, X: number, Y: number, Z: number, material: number) => boxes.push({ from: [x, y, z], to: [X, Y, Z], material });
  // The bar, its finials and the loops.
  add(1, top - 2, 0, bar - 1, top - 1, 2, MAT.timber);
  add(0, top - 3, 0, 1, top, 2, MAT.brass);
  add(bar - 1, top - 3, 0, bar, top, 2, MAT.brass);
  for (const x of [3, 7, 11]) add(x, rows, 1, x + 2, top - 2, 3, livery.colours.field);
  // The cloth, sampled from the full-size arms: a cell takes the border if any of its four source cells does, so the
  // edge stays one unbroken line at half resolution.
  const tincture = (code: string) => code === 'B' ? livery.colours.border : code === 'C' && livery.charge ? livery.colours.charge : livery.colours.field;
  for (let row = 0; row < rows; row++) {
    let runStart = -1, runMaterial = -1;
    const flush = (end: number) => { if (runStart >= 0) add(2 + runStart, rows - 1 - row, 1, 2 + end, rows - row, 3, runMaterial); runStart = -1; };
    for (let col = 0; col < width; col++) {
      const source = [arms[row * 2]![col * 2]!, arms[row * 2]![col * 2 + 1]!, arms[row * 2 + 1]![col * 2]!, arms[row * 2 + 1]![col * 2 + 1]!];
      const solid = source.filter(code => code !== '.');
      const code = solid.length < 2 ? '.' : solid.includes('B') ? 'B' : solid.filter(code => code === 'C').length >= 2 ? 'C' : 'F';
      const material = code === '.' ? -1 : tincture(code);
      if (material !== runMaterial) { flush(col); if (material >= 0) { runStart = col; runMaterial = material; } else runMaterial = -1; }
    }
    flush(width);
  }
  const variant = `${livery.cut}-${livery.charge ?? 'plain'}-${livery.colours.field}.${livery.colours.charge}.${livery.colours.border}`;
  return { version: 1, id: `grand-banner-${variant}`, styleId: STYLES[style].id, kind: 'civic', lattice: 'build', size: [bar, top, 3], boxes, windows: [] };
}

/** Where a banner's origin goes so its bar's middle hangs at the anchor, in front of it, facing outward. */
export function hangBanner(blueprint: VoxelBlueprint, anchor: TownBannerAnchor): Pick<KingdomPlacement, 'position' | 'yaw'> {
  const yaw = anchor.facing, half = blueprint.size[0] * CELL / 2, drop = (blueprint.size[1] - 1.5) * CELL;
  // Local (x, z) → world: x' = x cos + z sin, z' = −x sin + z cos (three.js about +Y). The bar sits a cell proud.
  const lx = -half, lz = CELL;
  return {
    position: [anchor.position[0] + lx * Math.cos(yaw) + lz * Math.sin(yaw), anchor.position[1] - drop, anchor.position[2] - lx * Math.sin(yaw) + lz * Math.cos(yaw)],
    yaw,
  };
}

export interface KingdomDressing {
  readonly walls: TownWalls;
  readonly livery: KingdomLivery;
  /** Unhashed: the content worker gives each its asset identity. */
  readonly placements: Omit<KingdomPlacement, 'assetHash'>[];
}

/**
 * The kingdom's town walls and its banners: the circuit around every lot and square, gated where streets leave,
 * with the kingdom's cloth on every tower pole and over every gate. Plain data; composed with the content.
 */
export function dressKingdom(kingdom: GrandKingdomContent): KingdomDressing {
  const plan = kingdom.plan, frame = frameSettlement(plan);
  const walls = planTownWalls(plan, {
    seedKey: `${kingdom.kingdomId}:walls`, style: kingdom.style, region: frame.region,
    ground: (x, z) => terrainHeight(plan, x, z), water: settlementWater(plan),
  });
  const livery = kingdomLivery(kingdom), banner = bannerBlueprint(livery, kingdom.style);
  const placements: Omit<KingdomPlacement, 'assetHash'>[] = walls.pieces.map(piece => ({ id: `wall:${piece.id}`, blueprint: piece.blueprint, position: piece.position, yaw: piece.rotation * Math.PI / 2 }));
  for (const anchor of walls.bannerAnchors) placements.push({ id: `banner:${anchor.id}`, blueprint: banner, ...hangBanner(banner, anchor) });
  return { walls, livery, placements };
}
