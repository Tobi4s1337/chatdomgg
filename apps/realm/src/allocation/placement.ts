import type { VerifiedTenure } from './evidence';

/** One settleable plot of an adopted layout revision. */
export interface PlotChoice {
  readonly plotId: string; readonly slot: number; readonly quarterYear: number;
  /** The frontage row (street segment) the plot faces; rows are ordered by their first ordinal, oldest first. */
  readonly rowId: string; readonly ordinal: number;
}

/** Why a plot was chosen, persisted on the deed beside the evidence that chose it. */
export interface TenurePlacement {
  readonly version: 1;
  /** UTC year of the verified follow date, or null when nobody observed one. */
  readonly followYear: number | null;
  readonly subscribedMonths: number | null;
  readonly quarterYear: number;
  readonly rowId: string;
  /** How the quarter was picked: the follow year, clamped into the founded years, or the newest edge for unknown. */
  readonly quarter: 'follow-year' | 'before-founding' | 'after-newest' | 'unknown-newest';
  /** The row the evidence pointed to, and whether verified sub months moved it one street toward the castle. */
  readonly targetRow: number;
  readonly subscriptionStep: boolean;
  /** Set when the target row or quarter was full and the nearest free plot was taken instead. */
  readonly spill: 'row' | 'quarter' | null;
}

const YEAR = (year: number) => Date.UTC(year, 0, 1);

/**
 * The address rule (ChatDom.md principle 3, World-Tree.md rules for places):
 * - the verified follow year picks the tenure quarter; a follow before the founded years lands in the oldest quarter,
 *   a follow newer than the newest quarter at its edge, and unknown history at the edge of the newest quarter;
 * - within the quarter, the follow date's place in its year picks the row, so early-year followers live nearer the
 *   quarter's root and late-year followers at its growing edge;
 * - verified subscription months move that choice one street toward the castle, once, never into another quarter;
 * - the lowest free ordinal on the chosen row is taken; a full row spills to the nearest row (outward first), a full
 *   quarter to the nearest quarter (newer first). Returns null only when every plot is taken.
 * Pure and deterministic: the same plots, occupancy and evidence always give the same address.
 */
export function choosePlot(plots: readonly PlotChoice[], occupied: ReadonlySet<string>, tenure: Pick<VerifiedTenure, 'followedAt' | 'subscribedMonths'>):
  { readonly plot: PlotChoice; readonly placement: TenurePlacement } | null {
  const quarters = [...new Set(plots.map(p => p.quarterYear))].sort((a, b) => a - b);
  if (quarters.length === 0) return null;
  const oldest = quarters[0]!, newest = quarters.at(-1)!;
  const followYear = tenure.followedAt === null ? null : new Date(tenure.followedAt).getUTCFullYear();

  let quarterYear: number, quarter: TenurePlacement['quarter'], fraction: number;
  if (followYear === null) { quarterYear = newest; quarter = 'unknown-newest'; fraction = 1; }
  else if (followYear < oldest) { quarterYear = oldest; quarter = 'before-founding'; fraction = 0; }
  else if (followYear > newest) { quarterYear = newest; quarter = 'after-newest'; fraction = 1; }
  else {
    // A quarter for every founded year exists; a gap year (no plots) settles in the nearest older quarter.
    quarterYear = [...quarters].reverse().find(year => year <= followYear)!;
    quarter = 'follow-year';
    fraction = quarterYear === followYear ? (tenure.followedAt! - YEAR(followYear)) / (YEAR(followYear + 1) - YEAR(followYear)) : 1;
  }

  const rowsOf = (year: number) => {
    const rows = new Map<string, PlotChoice[]>();
    for (const plot of plots) if (plot.quarterYear === year) { const row = rows.get(plot.rowId); if (row) row.push(plot); else rows.set(plot.rowId, [plot]); }
    return [...rows.values()].map(row => row.sort((a, b) => a.ordinal - b.ordinal)).sort((a, b) => a[0]!.ordinal - b[0]!.ordinal || cmp(a[0]!.rowId, b[0]!.rowId));
  };
  const free = (row: readonly PlotChoice[]) => row.find(plot => !occupied.has(plot.plotId)) ?? null;

  const rows = rowsOf(quarterYear);
  const evidenced = Math.min(rows.length - 1, Math.floor(Math.min(Math.max(fraction, 0), 0.999_999) * rows.length));
  const subscriptionStep = (tenure.subscribedMonths ?? 0) >= 1 && evidenced > 0;
  const targetRow = subscriptionStep ? evidenced - 1 : evidenced;
  const base = { version: 1 as const, followYear, subscribedMonths: tenure.subscribedMonths, quarterYear, quarter, targetRow, subscriptionStep };

  for (const index of nearest(targetRow, rows.length)) {
    const plot = free(rows[index]!);
    if (plot) return { plot, placement: { ...base, rowId: plot.rowId, spill: index === targetRow ? null : 'row' } };
  }
  const at = quarters.indexOf(quarterYear);
  for (const index of nearest(at, quarters.length)) {
    if (index === at) continue;
    for (const row of rowsOf(quarters[index]!)) {
      const plot = free(row);
      if (plot) return { plot, placement: { ...base, quarterYear: plot.quarterYear, rowId: plot.rowId, spill: 'quarter' } };
    }
  }
  return null;
}

/** Indices by distance from `start`, the outward (higher) neighbour before the inward one at each distance. */
function* nearest(start: number, length: number): Generator<number> {
  yield start;
  for (let d = 1; d < length; d++) {
    if (start + d < length) yield start + d;
    if (start - d >= 0) yield start - d;
  }
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
