import { VoxelBlueprintSchema, type VoxelBlueprint } from '@chatdom/shared';
import { MAT, STYLES } from '../materials';
import type { CompiledEmote, EmoteMask } from './deps';
import { lantern, Sculpt, type EmoteArtKit, type EmoteArtLantern, type LandscapeCharacter } from './kit';

/** The pedestal is 15 cells (1.9 m): three steps, a moulded base, the die with its sunk panel, cornice and cap. */
export const PEDESTAL_HEIGHT = 15;
/** One metre all round stays free for walking, as for every plaza statue. */
export const MONUMENT_CLEARANCE_CELLS = 8;

/** A carved, painted plaza statue of one approved emote, standing on a pedestal in the land's stone. */
export interface EmoteMonument {
  readonly kind: 'statue';
  /** The pedestal alone: what a host keeps (draped) if the carving is ever withdrawn. */
  readonly pedestal: VoxelBlueprint;
  /** The statue on its pedestal, one blueprint per source frame, each with its own delay. A still emote has one. */
  readonly frames: readonly { readonly blueprint: VoxelBlueprint; readonly durationMs: number }[];
  /** Sum of the delays; zero for a still emote. */
  readonly periodMs: number;
  /** Where the carving's origin sits on the cap, in pedestal-local build cells. */
  readonly statueOffset: readonly [number, number, number];
  /** The carving's own grid: width, height, depth in build cells. */
  readonly statueSize: readonly [number, number, number];
  readonly footprint: readonly [number, number];
  readonly heightCells: number;
  readonly clearanceCells: number;
  /** Two street lanterns at the front corners of the lowest step and two lamps on the cap's front corners. */
  readonly lanterns: readonly EmoteArtLantern[];
  /** The first frame's front face as carved: the silhouette the plaza recognises. */
  readonly silhouette: EmoteMask;
}

/**
 * Lays a pedestal for a carving of the given size: wide steps citizens can sit on, a moulded base, a die with a
 * sunk panel and a brass rosette, then a cornice and a cap that oversail it. The land dresses the footing: a dark
 * wet course with weed by a harbour, moss and flowers in a river valley, two bedded boulders on a mountain pass.
 */
export function pedestal(kit: EmoteArtKit, character: LandscapeCharacter, size: readonly [number, number, number]): { boxes: Sculpt; footprint: [number, number]; offset: [number, number, number]; lanterns: EmoteArtLantern[] } {
  const [w, , d] = size;
  const dieW = Math.max(24, w + 8), dieD = Math.max(18, d + 12);
  const FW = dieW + 16, FD = dieD + 16;
  const b = new Sculpt();
  const ring = (inset: number, y0: number, y1: number, material: number) => b.add(inset, y0, inset, FW - inset, y1, FD - inset, material);
  // Three steps, the lowest wide enough to hold a lantern at each front corner.
  ring(0, 0, 2, kit.footing);
  ring(0, 1, 2, kit.moulding);
  ring(5, 2, 3, kit.stone);
  ring(5, 3, 4, kit.moulding);
  ring(7, 4, 5, kit.moulding);
  // The die, with quoins in the moulding stone at every other course.
  ring(8, 5, 13, kit.stone);
  for (let y = 5; y < 13; y += 2) for (const [x, z] of [[8, 8], [FW - 9, 8], [8, FD - 9], [FW - 9, FD - 9]] as const) b.cell(x, y, z, kit.moulding);
  // Cornice, then the oversailing cap the statue stands on.
  ring(7, 13, 14, kit.moulding);
  ring(6, 14, 15, kit.stone);
  // Sunk panels front and back, each with a brass rosette.
  for (const face of [FD - 9, 8]) {
    const x0 = 11, x1 = FW - 11;
    b.add(x0, 6, face, x1, 12, face + 1, 0);
    b.add(x0 + 1, 7, face, x1 - 1, 11, face + 1, 0);
    const back = face === 8 ? face + 1 : face - 1;
    b.add(x0, 6, back, x1, 12, back + 1, kit.footing);
    const cx = Math.floor(FW / 2);
    b.add(cx - 1, 8, face, cx + 1, 10, face + 1, MAT.brass);
    b.add(cx - 2, 8, face, cx - 1, 10, face + 1, MAT.goldLeaf);
    b.add(cx + 1, 8, face, cx + 2, 10, face + 1, MAT.goldLeaf);
    b.add(cx - 1, 7, face, cx + 1, 8, face + 1, MAT.goldLeaf);
    b.add(cx - 1, 10, face, cx + 1, 11, face + 1, MAT.goldLeaf);
  }
  dress(b, character, FW, FD);
  // Street lanterns at the foot of the steps, and two small lamps on the cap that light the carving from below.
  const lanterns = [
    lantern(b, kit, 'monument-lantern-west', 1, 2, FD - 3, 12),
    lantern(b, kit, 'monument-lantern-east', FW - 3, 2, FD - 3, 12),
    lantern(b, kit, 'monument-lamp-west', 8, PEDESTAL_HEIGHT, FD - 9, 2),
    lantern(b, kit, 'monument-lamp-east', FW - 10, PEDESTAL_HEIGHT, FD - 9, 2),
  ];
  const offset: [number, number, number] = [Math.floor((FW - w) / 2), PEDESTAL_HEIGHT, Math.floor((FD - d) / 2)];
  return { boxes: b, footprint: [FW, FD], offset, lanterns };
}

function dress(b: Sculpt, character: LandscapeCharacter, FW: number, FD: number): void {
  if (character === 'coastal-harbour') {
    // The bottom course stays dark where spray reaches it; weed gathers in the corners of the joints.
    b.add(0, 0, 0, FW, 1, FD, MAT.darkStone);
    for (let x = 3; x < FW - 3; x += 7) { b.cell(x, 0, FD - 1, MAT.moss); b.cell(x + 1, 0, 0, MAT.moss); }
    for (let z = 4; z < FD - 4; z += 6) { b.cell(0, 0, z, MAT.moss); b.cell(FW - 1, 0, z + 2, MAT.moss); }
  } else if (character === 'river-valley') {
    // Moss in the step corners, and two clumps of forget-me-nots and rose at the foot of the lanterns.
    for (const [x, z] of [[5, 5], [FW - 6, 5], [5, FD - 6], [FW - 6, FD - 6]] as const) b.cell(x, 4, z, MAT.moss);
    for (const [x, z] of [[0, 0], [FW - 1, 0], [0, FD - 1], [FW - 1, FD - 1]] as const) b.cell(x, 2, z, MAT.moss);
    for (const side of [0, 1]) {
      const x = side ? FW - 9 : 5;
      b.add(x, 2, FD - 4, x + 4, 3, FD - 2, MAT.leaf);
      b.cell(x, 3, FD - 3, MAT.blueFlower); b.cell(x + 2, 3, FD - 4, MAT.petal); b.cell(x + 3, 3, FD - 3, MAT.blueFlower); b.cell(x + 1, 3, FD - 2 - 1, MAT.leaf);
    }
  } else {
    // Two boulders bedded at the back corners, the pedestal built against the hillside's stone.
    const boulder = (flip: boolean) => {
      const at = (dx: number, w: number) => (flip ? FW - dx - w : dx);
      b.add(at(0, 7), 0, 0, at(0, 7) + 7, 3, 6, MAT.stone);
      b.add(at(1, 5), 3, 1, at(1, 5) + 5, 5, 5, MAT.stone);
      b.add(at(2, 3), 5, 2, at(2, 3) + 3, 6, 4, MAT.darkStone);
      b.add(at(0, 2), 0, 5, at(0, 2) + 2, 2, 7, MAT.darkStone);
      b.cell(at(5, 1), 3, 1, MAT.moss);
    };
    boulder(false);
    boulder(true);
  }
}

/** The approved carving on its pedestal, one blueprint per frame. */
export function composeMonument(kit: EmoteArtKit, character: LandscapeCharacter, emote: CompiledEmote, size: readonly [number, number, number]): EmoteMonument {
  const base = pedestal(kit, character, size);
  const [FW, FD] = base.footprint;
  const [ox, oy, oz] = base.offset;
  const key = `${kit.style}-${character}-${emote.geometryHash.slice(0, 16)}`;
  const styleId = STYLES[kit.style].id;
  const height = Math.max(...base.boxes.list.map(box => box.to[1]));
  const pedestalBlueprint = VoxelBlueprintSchema.parse({
    version: 1, id: `genesis-emote-pedestal-${kit.style}-${character}-${size.join('x')}`, styleId, kind: 'civic', lattice: 'build',
    size: [FW, height, FD], boxes: base.boxes.list, windows: [],
  });
  const frames = emote.frames.map((frame, index) => {
    const b = new Sculpt();
    b.place(base.boxes.list, 0, 0, 0);
    b.place(frame.blueprint.boxes, ox, oy, oz);
    const blueprint = VoxelBlueprintSchema.parse({
      version: 1, id: `genesis-emote-statue-${key}-f${index}`, styleId, kind: 'civic', lattice: 'build',
      size: [FW, Math.max(height, oy + size[1]), FD], boxes: b.list, windows: [],
    });
    return { blueprint, durationMs: frame.durationMs };
  });
  return {
    kind: 'statue', pedestal: pedestalBlueprint, frames, periodMs: emote.periodMs,
    statueOffset: base.offset, statueSize: [...size], footprint: base.footprint, heightCells: oy + size[1],
    clearanceCells: MONUMENT_CLEARANCE_CELLS, lanterns: base.lanterns,
    silhouette: { width: emote.mask.width, height: emote.mask.height, materialIds: emote.mask.materialIds.slice() },
  };
}
