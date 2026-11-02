import { VOXEL_METRES, type FishingPierSite, type Vec3, type VoxelBlueprint } from '@chatdom/shared';
import { transformCardinalPoint, type RealmFoundedScene } from '@chatdom/world';

const CELL = VOXEL_METRES.build;
/** Material id of lantern glass in the content kit (`MAT.glass`). */
const GLASS = 14;
/** The realm's deck datum above the water (apps/realm/src/fishing/site.ts). A watcher has no lip to check, so the
 * deck height only frames the mist and rain; it never decides anything. */
const FREEBOARD = .75;
/** The head's middle, in build cells past the start of the head (32 cells, four metres, deep). */
const HEAD_MIDDLE = 16;

/** What a watcher's view needs to draw the pier's lanterns and its water mood. */
export interface FoundedPier {
  /** The pier's frame without its water height: the drawn water answers that (`withWater`). */
  readonly turn: FishingPierSite['turn'];
  readonly root: Vec3;
  readonly walk: number;
  /** The middle of the head, at the deck's placement height; ask the drawn water here. */
  readonly head: Vec3;
  /** Every lantern pane's centre, in world metres, read from the glass in the installed placements. */
  readonly lights: readonly Vec3[];
  withWater(waterY: number): FishingPierSite;
}

type Scene = Pick<RealmFoundedScene, 'assets' | 'placements'>;

/**
 * The pier exactly as it was installed in this founded scene, read back from its placements (ids `pier:lake:*`, the
 * modules `apps/realm/src/fishing/site.ts` assembles). Nothing is planned or searched for here: a scene without the
 * installed root and head, or with modules that disagree on their turn, has no pier for a watcher.
 */
export function foundedPier(scene: Scene): FoundedPier | null {
  const assets = new Map<string, VoxelBlueprint>(scene.assets.map(asset => [asset.assetHash, asset.blueprint]));
  const modules = scene.placements.filter(placement => placement.id.startsWith('pier:lake:'));
  const root = modules.find(placement => placement.id === 'pier:lake:root');
  const head = modules.find(placement => placement.id === 'pier:lake:head');
  if (!root || !head || modules.some(placement => placement.rotation !== root.rotation || !assets.has(placement.assetHash))) return null;
  const turn = root.rotation;
  // The root module sits ten cells left of the walk's centreline at the dry end; the head starts `walk` along it.
  const left = transformCardinalPoint([0, 0, 0], turn, [-10 * CELL, 0, 0]), out = transformCardinalPoint([0, 0, 0], turn, [0, 0, 1]);
  const origin: Vec3 = [root.position[0] - left[0], root.position[1], root.position[2] - left[2]];
  const walk = Math.round(((head.position[0] - root.position[0]) * out[0] + (head.position[2] - root.position[2]) * out[2]) / CELL) * CELL;
  if (!(walk > 0) || walk > 64) return null;
  const middle: Vec3 = [origin[0] + out[0] * (walk + HEAD_MIDDLE * CELL), head.position[1], origin[2] + out[2] * (walk + HEAD_MIDDLE * CELL)];
  const lights: Vec3[] = [];
  for (const placement of modules) {
    for (const box of assets.get(placement.assetHash)!.boxes) {
      if (box.material !== GLASS) continue;
      // A lantern's flame sits two cells into its glass from the bottom; the panes are drawn around it.
      const local: Vec3 = [(box.from[0] + box.to[0]) / 2 * CELL, (box.from[1] + Math.floor((box.to[1] - box.from[1]) / 2)) * CELL, (box.from[2] + box.to[2]) / 2 * CELL];
      lights.push(transformCardinalPoint(placement.position as Vec3, placement.rotation, local));
    }
  }
  return {
    turn, root: origin, walk, head: middle, lights,
    withWater: waterY => Object.freeze({ version: 1, id: 'pier:lake', root: origin, turn, deckY: waterY + FREEBOARD, waterY, walk,
      water: 'lake', biome: 'unknown', depth: [] }),
  };
}
