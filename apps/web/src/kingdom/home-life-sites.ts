import { DOOR_LANTERN_GLASS, GATE_BRAZIER_FLAME } from '@chatdom/content';
import { VOXEL_METRES, type Vec3, type VoxelBlueprint } from '@chatdom/shared';
import { homeLifeAnchors, transformCardinalPoint, type RealmFoundedScene } from '@chatdom/world';
import type { HomeLifeSite } from './home-life';
import type { RoyalBrazier, RoyalStandard } from './royal-life';

/** Only installed fixtures can glow. Public geometry supplies both their physical mesh and the light anchors. */
export function foundedLifeSites(scene: RealmFoundedScene): { homes: HomeLifeSite[]; braziers: RoyalBrazier[]; standard: RoyalStandard | undefined } {
  const assets = new Map(scene.assets.map(asset => [asset.assetHash, asset.blueprint]));
  const plots = new Map(scene.plan.homes.map(plot => [plot.id, plot]));
  const homes: HomeLifeSite[] = [], braziers: RoyalBrazier[] = [];
  let standard: RoyalStandard | undefined;
  const anchors = new Map<VoxelBlueprint, ReturnType<typeof homeLifeAnchors>>();
  const at = (placement: RealmFoundedScene['placements'][number], local: readonly number[]): Vec3 =>
    transformCardinalPoint(placement.position, placement.rotation, [local[0]! * VOXEL_METRES.build, local[1]! * VOXEL_METRES.build, local[2]! * VOXEL_METRES.build]);
  for (const lamp of scene.placements) {
    const blueprint = assets.get(lamp.assetHash);
    if (lamp.id === 'arrival:standard:royal' && blueprint) { standard = { blueprint, position: lamp.position, rotation: lamp.rotation }; continue; }
    if (lamp.id.startsWith('arrival:gate:') && blueprint && /^arrival-gate-brazier-(hearth|tide|grove)$/.test(blueprint.id)) {
      braziers.push({ position: at(lamp, GATE_BRAZIER_FLAME), normal: [0, 1, 0] }); continue;
    }
    if (!lamp.plotId || !lamp.id.startsWith('arrival:door:') || !blueprint?.id.startsWith('arrival-door-lantern-')) continue;
    const plot = plots.get(lamp.plotId), home = scene.placements.find(piece => piece.plotId === lamp.plotId && assets.get(piece.assetHash)?.kind === 'home');
    const shell = home && assets.get(home.assetHash);
    if (!plot || !home || !shell) continue;
    let authored = anchors.get(shell);
    if (!authored) { authored = homeLifeAnchors(shell); anchors.set(shell, authored); }
    const angle = lamp.rotation * Math.PI / 2;
    homes.push({ slot: plot.slot, mouths: authored.chimneys.map(mouth => at(home, mouth)),
      // Just in front of the actual glass surface, so the glow is not depth-hidden inside its voxel cage.
      lantern: at(lamp, [DOOR_LANTERN_GLASS[0], DOOR_LANTERN_GLASS[1], blueprint.size[2] + .04]), normal: [Math.sin(angle), 0, Math.cos(angle)] });
  }
  return { homes, braziers, standard };
}
