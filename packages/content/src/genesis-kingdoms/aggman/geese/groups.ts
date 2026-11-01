import { MAT } from '../../../materials';
import type { AggmanPiece } from '../piece';
import { Cells, hashSeed, stream } from './cells';
import { gooseCells, pieceFromCells, type GoosePose, type GooseVariant } from './goose';

/** Gosling down: yellow body and head, a paler buff saddle, a dark brown bill, dusky orange feet. */
const GOSLING = { Y: MAT.fabricGold, y: MAT.hairGold, B: MAT.hairBrown, F: MAT.forgeCopper } as const;
const goslingKey = (mark: string): number => {
  const material = (GOSLING as Record<string, number>)[mark];
  if (material === undefined) throw new Error(`Unknown gosling mark "${mark}".`);
  return material;
};

export type GoslingLook = 'ahead' | 'pecking';

/**
 * A downy gosling, two cells wide and four long: a round body on two small feet, the saddle darker, and a
 * one-cell head carried to one side (`head` 0 or 1) so a line of them reads as a line of busy little heads.
 * Ahead: the head up with the bill level. Pecking: the head down at the front with the bill on the grass.
 */
export function goslingCells(head: 0 | 1, look: GoslingLook = 'ahead'): Cells {
  const cells = new Cells();
  for (const x of [0, 1]) cells.draw(x, ['.y..', 'YYY.', '.F..'], goslingKey);
  if (look === 'ahead') cells.draw(head, ['..Y.', '..YB'], goslingKey, 0, 2);
  else cells.draw(head, ['..Y.', '...Y', '...B'], goslingKey);
  return cells;
}

interface Member { readonly cells: Cells; readonly at: readonly [x: number, z: number] }

function compose(members: readonly Member[]): Cells {
  const out = new Cells();
  for (const { cells, at } of members) out.stamp(cells, at[0], 0, at[1]);
  return out;
}

/**
 * A goose family out for a walk along +Z in one blueprint, about three metres long: one parent bringing up the
 * rear, three goslings weaving between, the other leading. Variant 0 is a calm walk, the gander leading on his
 * longer neck and the goose glancing aside; variant 1 has the gander honking a warning at the head of the line
 * while the goslings peck along behind him; variant 2 puts the goose in front and the gander behind, turned to
 * watch the goslings. Members never touch, so each bird stays its own grounded piece of the blueprint.
 */
export function createGooseFamily(variant: GooseVariant = 0): AggmanPiece {
  const id = `genesis-aggman-goose-family-${variant}`;
  const gander = variant === 1
    ? gooseCells('honking', 0)
    : gooseCells('standing', variant === 2 ? 1 : 0, { neck: 1, stride: true });
  const goose = gooseCells('standing', variant === 0 ? 1 : 0, { stride: true });
  const [rear, front] = variant === 2 ? [gander, goose] : [goose, gander];
  // The goslings weave either side of the line, clear of both parents' feet and of each other.
  const first = rear.bounds().max[2];
  const chicks: Member[] = [
    { cells: goslingCells(1, variant === 1 ? 'pecking' : 'ahead'), at: [-2, first] },
    { cells: goslingCells(0, variant === 0 ? 'pecking' : 'ahead'), at: [1, first + 2] },
    { cells: goslingCells(1, variant === 2 ? 'pecking' : 'ahead'), at: [-2, first + 5] },
  ];
  return pieceFromCells(id, compose([{ cells: rear, at: [0, 0] }, ...chicks, { cells: front, at: [1, first + 9] }]));
}

/** Land poses a gaggle draws from, weighted towards grazing. */
const GAGGLE_POSES: readonly GoosePose[] = ['grazing', 'grazing', 'grazing', 'standing', 'standing', 'preening', 'sitting', 'sitting', 'honking'];
const GAGGLE_AREA = [32, 24] as const;

/** A token for the blueprint id: the seed itself when it is already one, otherwise its hash. */
function seedToken(seed: string | number): string {
  const text = String(seed);
  return /^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/.test(text) ? text : hashSeed(text).toString(36);
}

export interface GaggleMember {
  readonly pose: GoosePose;
  readonly variant: GooseVariant;
  readonly turn: 0 | 1 | 2 | 3;
  /** The member's cropped corner in the gaggle's frame, build cells. */
  readonly at: readonly [x: number, z: number];
}

/**
 * The gaggle's plan for a seed: five to seven adults within about 4 × 3 m, a lookout standing or honking first,
 * then a seeded mix of grazers, preeners and sitters at quarter-turn headings, a share of them grey-washed
 * juveniles. Members keep at least a cell of grass between their footprints. Deterministic per seed.
 */
export function planGaggle(seed: string | number): readonly GaggleMember[] {
  const random = stream(hashSeed(`gaggle:${seed}`));
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)]!;
  const count = 5 + Math.floor(random() * 3);
  const placed: { member: GaggleMember; rect: readonly [number, number, number, number] }[] = [];
  for (let attempt = 0; placed.length < count && attempt < 400; attempt++) {
    const pose = placed.length === 0 ? pick<GoosePose>(['standing', 'honking']) : pick(GAGGLE_POSES);
    const variant: GooseVariant = random() < 0.25 ? 2 : random() < 0.5 ? 1 : 0;
    // Mostly drifting the same way across the green, a few turned aside.
    const r = random();
    const turn: 0 | 1 | 2 | 3 = r < 0.45 ? 0 : r < 0.65 ? 1 : r < 0.85 ? 3 : 2;
    const { max, min } = gooseCells(pose, variant).turned(turn).bounds();
    const w = max[0] - min[0], d = max[2] - min[2];
    if (w > GAGGLE_AREA[0] || d > GAGGLE_AREA[1]) continue;
    const x = Math.floor(random() * (GAGGLE_AREA[0] - w + 1)), z = Math.floor(random() * (GAGGLE_AREA[1] - d + 1));
    const clear = placed.every(({ rect: [x0, z0, x1, z1] }) => x + w + 1 <= x0 || x1 + 1 <= x || z + d + 1 <= z0 || z1 + 1 <= z);
    if (!clear) continue;
    placed.push({ member: { pose, variant, turn, at: [x, z] }, rect: [x, z, x + w, z + d] });
  }
  return placed.map(p => p.member);
}

/** A grounded gaggle of five to seven adults in one blueprint: `genesis-aggman-goose-gaggle-<seed>`. */
export function createGaggle(seed: string | number): AggmanPiece {
  const out = new Cells();
  for (const { pose, variant, turn, at } of planGaggle(seed)) {
    const cells = gooseCells(pose, variant).turned(turn);
    const { min } = cells.bounds();
    out.stamp(cells, at[0] - min[0], 0, at[1] - min[2]);
  }
  return pieceFromCells(`genesis-aggman-goose-gaggle-${seedToken(seed)}`, out);
}
