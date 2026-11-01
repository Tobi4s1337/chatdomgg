import type { Vec3 } from '@chatdom/shared';
import { MAT, STYLES } from '../../../materials';
import type { HeraldicColours } from '../../../genesis-heraldry/kit';
import type { AggmanPiece, Livery } from '../piece';
import { Cells, pieceId, smallLantern, toPiece } from './cells';
import { chargeBand, liveryColours, markMaterial } from './cloth';

/**
 * The harbour pennant, in build cells (variant 0; variant 1 is the mirror image across x). A stone footing with a
 * damp course and a mooring ring carries a faceted timber mast, lashed with rope and wedged with stones,
 * rising to a timber truck and a brass lozenge at 8.4 m. From its hoist (y 51 ± 8) a swallowtail pennant six
 * metres long streams along +x in the sea wind: the red field inside a brass edge, carrying the arms' three cream
 * wavy bars by the hoist, then a gold fly split into two tails. A halyard runs down the lee side of the mast to a cleat, and a
 * keeper's lantern hangs from an iron arm on the front of the mast.
 */
export const HARBOUR_PENNANT = {
  size: [58, 67, 14],
  pole: { from: [5, 7, 6], to: [7, 63, 8] },
  cloth: { x: 7, length: 48, hoistCentre: 51, hoistHalf: 8, z: 6 },
  footprint: { from: [0, 1], to: [12, 13] },
} as const;

/** Where the red of the field gives way to the gold fly, as a share of the pennant's length. */
const FIELD_SHARE = 0.62;
/**
 * The device at the hoist: the arms' charge band, 14 columns by 12 rows, laid square inside a row of plain field
 * under each brass edge, so the three wavy bars read as a badge by the mast and the red runs clear beyond it.
 */
const DEVICE = { cols: 14, rows: 12 } as const;
/** The fork is cut this many cells up into the fly. */
const FORK = 12;
/** Ripple wavelength along the pennant, in cells. With the amplitude below, neighbours never step more than one cell. */
const WAVELENGTH = 13.5;
const AMPLITUDE = 1.85;

/** The two flying variants differ in which way they stream and in where their ripples and flutter fall. */
const PHASES = [{ ripple: 0.9, flutter: 0.4 }, { ripple: 3.3, flutter: 2.5 }] as const;

export function createHarbourPennant(livery: Livery, arms: readonly string[], variant: 0 | 1, colours: HeraldicColours = liveryColours(livery)): AggmanPiece {
  const { size, cloth, footprint } = HARBOUR_PENNANT;
  const c = new Cells(size[0], size[1], size[2]);
  const timber = STYLES.tide.trim, stone = STYLES.tide.stone;

  // The footing: a dark damp course, a stepped stone block and a cap, with a mooring ring on the harbour face.
  c.chamfer(0, 0, 1, 12, 2, 13, 2, MAT.darkStone);
  c.chamfer(1, 2, 2, 11, 4, 12, 2, stone);
  c.chamfer(2, 4, 3, 10, 5, 11, 1, stone);
  c.fill(5, 2, 12, 6, 4, 13, MAT.darkStone);
  c.fill(7, 2, 12, 8, 4, 13, MAT.darkStone);
  c.fill(5, 4, 12, 8, 5, 13, MAT.darkStone);
  // The mast: wedged with stones, faceted and stout to head height, then a slimmer spar to the truck.
  c.chamfer(3, 5, 4, 9, 7, 10, 1, stone);
  c.fill(3, 6, 6, 9, 7, 8, MAT.darkStone);
  c.fill(5, 6, 4, 7, 7, 10, MAT.darkStone);
  c.chamfer(4, 7, 5, 8, 22, 9, 1, timber);
  for (const y of [11, 13, 20]) c.chamfer(3, y, 4, 9, y + 1, 10, 1, MAT.thatch);
  const { pole } = HARBOUR_PENNANT;
  c.fill(pole.from[0], pole.from[1], pole.from[2], pole.to[0], pole.to[1], pole.to[2], timber);
  c.chamfer(4, 62, 5, 8, 63, 9, 1, timber);
  // The brass lozenge finial.
  c.fill(5, 63, 6, 7, 64, 8, livery.brass);
  c.chamfer(4, 64, 5, 8, 66, 9, 1, livery.brass);
  c.fill(5, 66, 6, 7, 67, 8, livery.brass);
  // A cleat on the lee side, and the halyard from it up the mast to the truck.
  c.fill(3, 15, 6, 4, 16, 8, timber);
  c.fill(2, 14, 7, 3, 17, 8, timber);
  for (let y = 16; y <= 22; y++) c.set(3, y, 7, MAT.thatch);
  for (let y = 22; y < 62; y++) c.set(4, y, 7, MAT.thatch);
  // A timber arm on the harbour face of the mast, brass-tipped, holds a keeper's lantern over the quay.
  c.fill(5, 30, 8, 7, 31, 12, timber);
  c.fill(5, 30, 12, 7, 31, 13, livery.brass);
  const lantern = smallLantern(c, 5, 24, 10, livery.brass, MAT.glass);

  // The pennant: a forked cloth two cells thick that tapers, droops a little under its own weight, flutters and
  // ripples harder towards the fly. Each column rises and falls on a diagonal wave, so the light catches the
  // crests in bands and the troughs fall into shadow.
  const phase = PHASES[variant];
  const fieldCols = Math.round(FIELD_SHARE * cloth.length);
  const band = chargeBand(arms, DEVICE.cols, DEVICE.rows);
  const rings: number[] = [];
  for (let i = 0; i < cloth.length; i++) {
    const t = (i + 0.5) / cloth.length;
    const half = t < FIELD_SHARE ? cloth.hoistHalf - 1.5 * (t / FIELD_SHARE) : cloth.hoistHalf - 1.5 - 2 * ((t - FIELD_SHARE) / (1 - FIELD_SHARE));
    const centre = cloth.hoistCentre - 2.5 * t * t + 0.55 * t * Math.sin(2 * Math.PI * 1.7 * t + phase.flutter);
    const lo = Math.round(centre - half), hi = Math.round(centre + half);
    const forkFrom = 1 - FORK / cloth.length, notch = t > forkFrom ? ((t - forkFrom) / (1 - forkFrom)) * (half - 2) : 0;
    const amplitude = AMPLITUDE * t ** 0.8;
    if (i === 0) rings.push(lo, Math.round(centre), hi - 1);
    for (let y = lo; y < hi; y++) {
      if (Math.abs(y + 0.5 - centre) < notch) continue;
      const off = Math.round(amplitude * Math.sin((2 * Math.PI * (i - 0.35 * (y - centre))) / WAVELENGTH + phase.ripple));
      let material: number;
      if (i === 0) material = colours.border;
      else if (i < fieldCols) {
        if (y === lo || y === hi - 1) material = colours.border;
        else if (y === lo + 1 || y === hi - 2 || i > DEVICE.cols) material = colours.field;
        else {
          const row = Math.min(DEVICE.rows - 1, Math.max(0, Math.floor(((hi - 3 - y) / Math.max(1, hi - lo - 4)) * DEVICE.rows)));
          material = markMaterial(colours, band[row]![i - 1]!);
        }
      } else material = livery.gold;
      const z = cloth.z + off;
      c.set(cloth.x + i, y, z, material);
      c.set(cloth.x + i, y, z + 1, material);
    }
  }
  // Brass toggles bind the hoist to the mast at its head, middle and foot.
  for (const y of rings) c.fill(4, y, 5, 8, y + 1, 9, livery.brass);

  const lanterns: Vec3[] = [lantern];
  const built = variant === 0 ? c : c.mirrorX();
  const mirror = (x: number) => (variant === 0 ? x : size[0] - 1 - x);
  return toPiece(pieceId(`harbour-pennant-${variant}`, livery, arms, colours), 'civic', built,
    lanterns.map(([x, y, z]) => [mirror(x), y, z] as Vec3),
    variant === 0 ? footprint : { from: [size[0] - footprint.to[0], footprint.from[1]], to: [size[0] - footprint.from[0], footprint.to[1]] });
}
