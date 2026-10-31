import { StyleIdSchema, VoxelBlueprintSchema, type VoxelBlueprint } from '../deps';
import type { EmoteVoxelFrame } from '../types';

/** Kingdom stone the plinth is carved from; IDs come from the caller's registry subset. */
export interface EmotePlinthMaterials {
  /** The wide bottom step that meets the paving. */
  readonly footing: number;
  /** The body under the cap. */
  readonly body: number;
  /** The overhanging cap the statue stands on. */
  readonly cap: number;
  /** The small inset plate on the front face. */
  readonly plate: number;
}

export interface EmoteStatueLayout {
  readonly plinth: VoxelBlueprint;
  /** Where every statue frame's origin sits, in plinth-local build cells; frames share one origin. */
  readonly statueOffset: readonly [number, number, number];
  /** Plinth footprint in build cells (x, z); the statue never overhangs it. */
  readonly footprintCells: readonly [number, number];
  /** Plinth plus statue, in build cells. */
  readonly heightCells: number;
  /** Ring around the footprint kept free for walking, in build cells. */
  readonly clearanceCells: number;
  /** Centre of the front plate, on the +Z face, for a host-placed name or credit. */
  readonly plateAnchor: readonly [number, number, number];
}

const PLINTH_STYLE = StyleIdSchema.parse('emote');
/** One metre all round: two citizens pass each other between the plinth and the next object. */
export const STATUE_CLEARANCE_CELLS = 8;

/**
 * A stepped plinth sized to the statue's common frame bounds, so a blink never needs a bigger base:
 * footing (2 cells), body (4 cells, with a recessed front plate), and an overhanging cap (1 cell).
 * The statue stands centred on the cap, front face toward +Z like the plinth's plate.
 */
export function layoutEmoteStatue(frames: readonly EmoteVoxelFrame[], materials: EmotePlinthMaterials, id: string): EmoteStatueLayout {
  const first = frames[0];
  if (!first) throw new Error('A statue needs at least one frame.');
  if (frames.some(frame => frame.blueprint.size.some((n, axis) => n !== first.blueprint.size[axis]))) throw new Error('Statue frames must share one size and origin.');
  return layoutEmotePlinth(first.blueprint.size, materials, id);
}

/**
 * The same plinth for a statue of a given frame size, without its geometry: a host keeps the
 * placement's size, so a withdrawn carving's plinth stays exactly where and how it stood.
 */
export function layoutEmotePlinth(size: readonly [number, number, number], materials: EmotePlinthMaterials, id: string): EmoteStatueLayout {
  const [width, height, depth] = size;
  if (![width, height, depth].every(n => Number.isInteger(n) && n > 0 && n <= 256)) throw new Error('The statue size is malformed.');
  const footW = width + 10, footD = depth + 12, bodyW = width + 4, bodyD = depth + 6, capW = width + 6, capD = depth + 8;
  const centreX = footW / 2, centreZ = footD / 2;
  const span = (size: number, centre: number): [number, number] => [Math.round(centre - size / 2), Math.round(centre - size / 2) + size];
  const [fx0, fx1] = span(footW, centreX), [fz0, fz1] = span(footD, centreZ);
  const [bx0, bx1] = span(bodyW, centreX), [bz0, bz1] = span(bodyD, centreZ);
  const [cx0, cx1] = span(capW, centreX), [cz0, cz1] = span(capD, centreZ);
  const plateW = Math.max(6, Math.min(bodyW - 6, Math.round(width * .45)));
  const [px0, px1] = span(plateW, centreX);
  const boxes: VoxelBlueprint['boxes'] = [
    // Footing with chamfered corners.
    { from: [fx0, 0, fz0], to: [fx1, 2, fz1], material: materials.footing },
    { from: [fx0, 1, fz0], to: [fx0 + 1, 2, fz0 + 1], material: 0 },
    { from: [fx1 - 1, 1, fz0], to: [fx1, 2, fz0 + 1], material: 0 },
    { from: [fx0, 1, fz1 - 1], to: [fx0 + 1, 2, fz1], material: 0 },
    { from: [fx1 - 1, 1, fz1 - 1], to: [fx1, 2, fz1], material: 0 },
    // A thin plinth course under the body, then the body itself.
    { from: [bx0 - 1, 2, bz0 - 1], to: [bx1 + 1, 3, bz1 + 1], material: materials.cap },
    { from: [bx0, 3, bz0], to: [bx1, 7, bz1], material: materials.body },
    // Recessed front plate.
    { from: [px0, 4, bz1 - 1], to: [px1, 6, bz1], material: materials.plate },
    // Overhanging cap.
    { from: [cx0, 7, cz0], to: [cx1, 8, cz1], material: materials.cap },
  ];
  const plinth = VoxelBlueprintSchema.parse({ version: 1, id, styleId: PLINTH_STYLE, kind: 'civic', lattice: 'build', size: [footW, 8, footD], boxes, windows: [] });
  const statueOffset: [number, number, number] = [Math.round(centreX - width / 2), 8, Math.round(centreZ - depth / 2)];
  return { plinth, statueOffset, footprintCells: [footW, footD], heightCells: 8 + height, clearanceCells: STATUE_CLEARANCE_CELLS, plateAnchor: [centreX, 5, bz1] };
}

/**
 * One frame of the statue standing on its plinth, as a single build blueprint. Meshing them
 * together lets the ordinary mesher's ambient occlusion darken the joint where the sculpture
 * meets the cap, so it reads as resting on stone instead of hovering over it. Hosts cache one
 * composite per approved revision and frame.
 */
export function composeStatueFrame(layout: EmoteStatueLayout, frame: EmoteVoxelFrame, id: string): VoxelBlueprint {
  const [ox, oy, oz] = layout.statueOffset, [w, h, d] = frame.blueprint.size, [footW, footD] = layout.footprintCells;
  if (ox < 0 || oz < 0 || ox + w > footW || oz + d > footD) throw new Error('The statue frame does not fit this plinth.');
  const boxes: VoxelBlueprint['boxes'] = [...layout.plinth.boxes];
  for (const box of frame.blueprint.boxes) boxes.push({ from: [box.from[0] + ox, box.from[1] + oy, box.from[2] + oz], to: [box.to[0] + ox, box.to[1] + oy, box.to[2] + oz], material: box.material });
  return VoxelBlueprintSchema.parse({ version: 1, id, styleId: PLINTH_STYLE, kind: 'civic', lattice: 'build', size: [footW, Math.max(layout.plinth.size[1], oy + h), footD], boxes, windows: [] });
}
