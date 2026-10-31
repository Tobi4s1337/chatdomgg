import { createCivicProp, createDoorLantern, createGateBrazier, DOOR_LANTERN_MOUNT, GATE_BRAZIER_MOUNT } from '@chatdom/content';
import { VOXEL_METRES, type Vec3, type VoxelBlueprint } from '@chatdom/shared';
import { homeLifeAnchors, transformCardinalPoint, type CardinalTurn, type SettlementPlan } from '@chatdom/world';

export interface ArrivalPiece {
  id: string; blueprint: VoxelBlueprint; position: Vec3; rotation: CardinalTurn; plotId?: string;
}

/** Frontmost occupied surface at the actual bracket column, respecting later door/window carves. */
function wallFront(blueprint: VoxelBlueprint, x: number, y: number): number | undefined {
  let solid: [number, number][] = [];
  for (const box of blueprint.boxes) {
    if (x < box.from[0] || x >= box.to[0] || y < box.from[1] || y >= box.to[1]) continue;
    const next: [number, number][] = [];
    for (const [lo, hi] of solid) {
      if (hi <= box.from[2] || lo >= box.to[2]) next.push([lo, hi]);
      else { if (lo < box.from[2]) next.push([lo, box.from[2]]); if (hi > box.to[2]) next.push([box.to[2], hi]); }
    }
    if (box.material) next.push([box.from[2], box.to[2]]);
    solid = next;
  }
  return solid.length ? Math.max(...solid.map(interval => interval[1])) : undefined;
}

/** Add actual unlit fixtures to the selected public shells, including a citizen's published replacement home.
 * Geometry identity/collision includes them; presence only supplies their later warmth. No host bytes are edited. */
export function arrivalFurnishings(plan: SettlementPlan, pieces: readonly ArrivalPiece[]): ArrivalPiece[] {
  const additions: ArrivalPiece[] = [], ids = new Set(pieces.map(piece => piece.id));
  const lamps = new Map<string, VoxelBlueprint>();
  const anchors = new Map<VoxelBlueprint, ReturnType<typeof homeLifeAnchors>>();
  const scale = (p: Vec3): Vec3 => [p[0] * VOXEL_METRES.build, p[1] * VOXEL_METRES.build, p[2] * VOXEL_METRES.build];
  for (const home of pieces) {
    if (!home.plotId || home.blueprint.kind !== 'home') continue;
    const id = `arrival:door:${home.plotId}`;
    if (ids.has(id)) continue;
    let authored = anchors.get(home.blueprint);
    if (!authored) { authored = homeLifeAnchors(home.blueprint); anchors.set(home.blueprint, authored); }
    const door = authored.door, style = home.blueprint.styleId;
    if (!door || (style !== 'hearth' && style !== 'tide' && style !== 'grove')) continue;
    let lamp = lamps.get(style);
    if (!lamp) { lamp = createDoorLantern(style as 'hearth' | 'tide' | 'grove'); lamps.set(style, lamp); }
    let x = door.to[0] + 3;
    if (x + lamp.size[0] - DOOR_LANTERN_MOUNT[0] > home.blueprint.size[0]) x = door.from[0] - 3;
    if (x - DOOR_LANTERN_MOUNT[0] < 0) continue;
    const y = door.to[1] - 1, z = wallFront(home.blueprint, x, y);
    if (z === undefined || z < home.blueprint.size[2] / 2) continue;
    const local: Vec3 = [x - DOOR_LANTERN_MOUNT[0], y - DOOR_LANTERN_MOUNT[1], z];
    additions.push({ id, blueprint: lamp, position: transformCardinalPoint(home.position, home.rotation, scale(local)), rotation: home.rotation, plotId: home.plotId });
  }
  // Welcome fires and the reviewed standard stand before the actual compound gate.
  const gate = plan.castle.modules.find(module => module.kind === 'gatehouse');
  const installedGate = gate && pieces.find(piece => piece.id === `castle:${gate.id}`);
  const keep = pieces.find(piece => piece.id === `castle:${plan.castle.beaconModuleId}`);
  if (gate && installedGate && keep) {
    const style = keep.blueprint.styleId === 'hearth' ? 'hearth' : keep.blueprint.styleId === 'grove' ? 'grove' : 'tide';
    const brazier = createGateBrazier(style);
    for (const [name, x] of [['west', -2], ['east', gate.size[0] + 2]] as const) {
      const id = `arrival:gate:${name}`;
      if (ids.has(id)) continue;
      const local: Vec3 = [x - GATE_BRAZIER_MOUNT[0] * VOXEL_METRES.build, 0,
        gate.size[2] + 1.5 - GATE_BRAZIER_MOUNT[2] * VOXEL_METRES.build];
      additions.push({ id, blueprint: brazier, position: transformCardinalPoint(installedGate.position, installedGate.rotation, local), rotation: installedGate.rotation });
    }
    const id = 'arrival:standard:royal';
    if (!ids.has(id)) additions.push({ id, blueprint: createCivicProp('banner-standard', style === 'tide' ? 'tide' : 'hearth'),
      position: transformCardinalPoint(installedGate.position, installedGate.rotation, [gate.size[0] + 4, 0, gate.size[2] + 1]), rotation: installedGate.rotation });
  }
  return additions;
}
