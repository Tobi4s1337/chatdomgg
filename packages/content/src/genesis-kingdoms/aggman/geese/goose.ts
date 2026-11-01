import { MAT, STYLES } from '../../../materials';
import type { AggmanPiece } from '../piece';
import { Cells } from './cells';

/**
 * The_AGGman's harbour geese: domestic white geese that live on the hamlet's green and shingle. Authored fauna,
 * static props on the build lattice (0.125 m), so a goose is eight to ten cells nose to tail and every cell is a
 * decision. Local frame: x right, y up, +Z the way the goose faces, origin at the cropped corner, y = 0 the ground
 * under the feet (for a swimmer, the underside one cell below the waterline).
 *
 * Every goose is drawn as side-profile slices about its own centre line (x = 0): a three-cell body, a one-cell
 * neck and head so the long neck reads, an orange bill on the head's lower front with the black eye just behind
 * it (under a white crown, so the head never reads as capped from above), folded wings in cool white with grey primaries over the tail, and two orange legs set apart so the front
 * view shows daylight between them.
 */
export type GoosePose = 'standing' | 'grazing' | 'honking' | 'preening' | 'sitting' | 'swimming';
export type GooseVariant = 0 | 1 | 2;
export const GOOSE_POSES: readonly GoosePose[] = ['standing', 'grazing', 'honking', 'preening', 'sitting', 'swimming'];
export const GOOSE_VARIANTS: readonly GooseVariant[] = [0, 1, 2];

/** Swimmers ride one cell deep: the host sinks y = 0 that far under the water surface. */
export const SWIM_DRAFT = 1;

/**
 * Marks used by the slices. W plumage, w the cooler folded wing, L the shaded belly, G grey primaries, O bill,
 * F legs and feet, E eye. Goslings use Y down, y the darker crown and back, B the dark gosling bill.
 */
export interface Plumage {
  readonly W: number; readonly w: number; readonly L: number; readonly G: number;
  readonly O: number; readonly F: number; readonly E: number;
}

/** A white domestic goose: warm cream body, cooler silver wings, stone primaries, orange bill and feet. */
export const ADULT: Plumage = {
  W: MAT.cream, w: MAT.hairSilver, L: MAT.limestone, G: MAT.stone, O: MAT.fabricOrange, F: MAT.fabricOrange, E: MAT.hairBlack,
};
/** A first-year bird still in grey-washed feathers, with a duller bill and legs. */
export const JUVENILE: Plumage = {
  W: MAT.hairSilver, w: MAT.stone, L: MAT.limestone, G: MAT.darkStone, O: MAT.forgeCopper, F: MAT.forgeCopper, E: MAT.hairBlack,
};

const keyOf = (plumage: Plumage) => (mark: string): number => {
  const material = (plumage as unknown as Record<string, number>)[mark];
  if (material === undefined) throw new Error(`Unknown goose mark "${mark}".`);
  return material;
};

/**
 * One slice per column x: rows top to bottom with the last row on height `y0` (default 0), characters along +Z
 * from the tail.
 */
type Sheet = readonly (readonly [x: number, rows: readonly string[], y0?: number])[];

/** The left and right slices are the same; `wing` slices sit one further out, their last row on `wingY`. */
function sym(center: readonly string[], side: readonly string[], wing?: readonly string[], wingY = 0): Sheet {
  const sheet: [number, readonly string[], number?][] = [[0, center], [-1, side], [1, side]];
  if (wing) sheet.push([-2, wing, wingY], [2, wing, wingY]);
  return sheet;
}

/** The standing body under a neck of `neck` cells and a forward head. Neck column z = 5. */
function standingCenter(neck: number): string[] {
  return [
    '.....WW.',
    '.....WEO',
    ...Array.from({ length: neck }, () => '.....W..'),
    'WWWWWW..',
    '.WWWWWW.',
    '..LLLL..',
    '........',
    '........',
  ];
}
const STANDING_SIDE = [
  '.GwwW...',
  '..wwWW..',
  '...LL...',
  '...F....',
  '...FF...',
];
/** Mid-stride: one leg reaching forward, the other pushing off behind. */
const STRIDE_FORWARD = ['.GwwW...', '..wwWW..', '...LL...', '....F...', '....FF..'];
const STRIDE_BEHIND = ['.GwwW...', '..wwWW..', '..LLL...', '..F.....', '.FF.....'];

/** Neck stretched down and forward, head at the grass, the rump lifted. Neck column z = 7. */
const GRAZING_CENTER = [
  'W.........',
  'WWWWW.....',
  '.WWWWWWW..',
  '..LLLL.W..',
  '.......WW.',
  '.......WEO',
];
const GRAZING_SIDE = [
  '.GwwW....',
  '..wwWW...',
  '...LL....',
  '...F.....',
  '...FF....',
];

/**
 * Neck thrust up and forward in steps, head tipped back and the bill wide: the upper mandible over the dark gape,
 * the lower one under it. Tail cocked, wing elbows lifted clear of the back.
 */
const HONKING_CENTER = [
  '.......WWO',
  '......WWE.',
  '.....WW.WO',
  'W....W....',
  'WWWWWW....',
  '.WWWWWW...',
  '..LLLL....',
  '..........',
  '..........',
];
const HONKING_SIDE = [
  '..ww.....',
  '.GwwW....',
  '..wwWW...',
  '...LL....',
  '...F.....',
  '...FF....',
];
const HONKING_WING = ['.Gww', '..Gw'];
const HONKING_WING_HIGH = ['.G..', '.Gww', '..Gw'];

/** Neck up and curled back so the head lies on the right shoulder, bill buried in the wing. */
const PREENING_CENTER = [
  '.....W..',
  '.....W..',
  'WWWWWW..',
  '.WWWWWW.',
  '..LLLL..',
  '........',
  '........',
];
const PREENING_HEAD_SIDE = [
  '....WW..',
  '...OEW..',
  ...STANDING_SIDE,
];

/** Settled on the ground, legs folded under, breast down, neck short. */
const SITTING_CENTER = [
  '.....WW.',
  '.....WEO',
  'W....W..',
  'WWWWWW..',
  '.WWWWWW.',
  '.LLLLLL.',
];
const SITTING_SIDE = [
  '.GwwW...',
  '..wwWW..',
  '..LLLL..',
];
/** Dozing: the head laid back along the right shoulder, eye shut, the bill tucked into the wing. */
const DOZING_CENTER = [
  'W....W..',
  'WWWWWW..',
  '.WWWWWW.',
  '.LLLLLL.',
];
const DOZING_HEAD_SIDE = [
  '...OWW..',
  ...SITTING_SIDE,
];

/** Riding high on the water: y = 0 is the keel row under the surface. */
const SWIMMING_CENTER = [
  '.....WW.',
  '.....WEO',
  '.....W..',
  'W....W..',
  'WWWWWW..',
  '.WWWWWW.',
  '..LLLL..',
];
const SWIMMING_SIDE = [
  '.GwwW...',
  '..wwWW..',
  '...LL...',
];

/** Draws a sheet into a fresh grid. */
function drawSheet(sheet: Sheet, plumage: Plumage): Cells {
  const cells = new Cells(), key = keyOf(plumage);
  for (const [x, rows, y0] of sheet) cells.draw(x, rows, key, 0, y0 ?? 0);
  return cells;
}

/**
 * Turns the head a quarter towards +X about the neck column z = `pivot`: every centre-line cell at or above
 * `fromY` that lies ahead of the pivot swings round it, so the bill points sideways and the eye looks along +Z.
 */
function swing(cells: Cells, pivot: number, fromY: number): Cells {
  const head = cells.list().filter(([x, y, z]) => x === 0 && y >= fromY && z > pivot);
  for (const [x, y, z] of head) cells.set(x, y, z, 0);
  for (const [, y, z, m] of head) cells.set(z - pivot, y, pivot, m);
  return cells;
}

/**
 * Light mottling for the grey-washed juvenile: a deterministic few of the uppermost body cells (the mantle, not the
 * neck or head) darken a step, so the first-year bird reads as dusky rather than painted flat.
 */
function duskyBack(cells: Cells, seed: number): Cells {
  const top = new Map<string, number>();
  for (const [x, y, z] of cells.list()) top.set(`${x},${z}`, Math.max(top.get(`${x},${z}`) ?? 0, y));
  return cells.paint((x, y, z, m) => {
    const h = Math.imul((x + 7) * 73856093 ^ (y + 3) * 19349663 ^ (z + 5) * 83492791, seed | 1) >>> 0;
    const mantle = y === top.get(`${x},${z}`) && x !== 0;
    return m === JUVENILE.W && mantle && h % 3 === 0 ? JUVENILE.w : m;
  });
}

export interface GooseOptions {
  /** Extra neck cells for a gander (standing only). */
  readonly neck?: number;
  /** Mid-stride legs (standing only). */
  readonly stride?: boolean;
}

/**
 * The cells of one goose about its centre line, before cropping. Variant 0 is the classic white bird; variant 1
 * turns or rests the head (and in the honk, lifts the wings higher); variant 2 is the grey-washed juvenile with a
 * different wing or head carriage.
 */
export function gooseCells(pose: GoosePose, variant: GooseVariant, options: GooseOptions = {}): Cells {
  const plumage = variant === 2 ? JUVENILE : ADULT;
  const neck = 2 + (options.neck ?? 0);
  let cells: Cells;
  switch (pose) {
    case 'standing': {
      const center = standingCenter(neck);
      const sheet: Sheet = options.stride
        ? [[0, center], [1, STRIDE_FORWARD], [-1, STRIDE_BEHIND]]
        : sym(center, STANDING_SIDE);
      cells = drawSheet(sheet, plumage);
      const headY = 5 + neck;
      if (variant === 1) swing(cells, 5, headY);
      if (variant === 2) {
        // Wing tips crossed long over a cocked tail.
        cells.set(-1, 4, 0, plumage.G).set(1, 4, 0, plumage.G).set(0, 5, 0, plumage.W);
      }
      break;
    }
    case 'grazing': {
      cells = drawSheet(sym(GRAZING_CENTER, GRAZING_SIDE), plumage);
      if (variant === 1) swing(cells, 7, 0);
      if (variant === 2) {
        // Wings let down a little at the tips, the rump less lifted.
        cells.set(-1, 3, 1, plumage.G).set(1, 3, 1, plumage.G).set(0, 5, 0, 0);
      }
      break;
    }
    case 'honking': {
      cells = drawSheet(sym(HONKING_CENTER, HONKING_SIDE, variant === 1 ? HONKING_WING_HIGH : HONKING_WING, 4), plumage);
      if (variant === 2) swing(cells, 7, 6);
      break;
    }
    case 'preening': {
      const base = drawSheet([[0, PREENING_CENTER], [-1, STANDING_SIDE], [1, PREENING_HEAD_SIDE]], plumage);
      if (variant === 2) {
        // The preened wing eased out from the body.
        base.set(2, 4, 1, plumage.G).set(2, 4, 2, plumage.w).set(2, 4, 3, plumage.w);
      }
      cells = variant === 1 ? base.mirrored().set(0, 5, 0, plumage.W) : base;
      break;
    }
    case 'sitting': {
      cells = variant === 1
        ? drawSheet([[0, DOZING_CENTER], [-1, SITTING_SIDE], [1, DOZING_HEAD_SIDE]], plumage)
        : drawSheet(sym(SITTING_CENTER, SITTING_SIDE), plumage);
      if (variant === 2) swing(cells, 5, 4);
      break;
    }
    case 'swimming': {
      cells = drawSheet(sym(SWIMMING_CENTER, SWIMMING_SIDE), plumage);
      if (variant === 1) {
        // Cruising: the head carried forward and low on a curved neck.
        cells.move((x, y) => x === 0 && y >= 5, 0, -1, 1);
      }
      if (variant === 2) swing(cells, 5, 5);
      break;
    }
  }
  return variant === 2 ? duskyBack(cells, pose.length * 977) : cells;
}

/** Wraps a grid as a grounded Tide prop, cropped to its occupied bounds. */
export function pieceFromCells(id: string, cells: Cells, draft?: number): AggmanPiece {
  const { boxes, size } = cells.boxes();
  return {
    blueprint: { version: 1, id, styleId: STYLES.tide.id, kind: 'prop', lattice: 'build', size, boxes, windows: [] },
    lanterns: [],
    footprint: { from: [0, 0], to: [size[0], size[2]] },
    ...(draft === undefined ? {} : { draft }),
  };
}

/** One goose as a placed prop: `genesis-aggman-goose-<pose>-<variant>`. Swimmers carry `draft`. */
export function createGoose(pose: GoosePose, variant: GooseVariant = 0): AggmanPiece {
  return pieceFromCells(`genesis-aggman-goose-${pose}-${variant}`, gooseCells(pose, variant), pose === 'swimming' ? SWIM_DRAFT : undefined);
}
