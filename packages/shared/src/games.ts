import { z } from 'zod';
import { DisplayNameSchema, EpochMsSchema, KingdomIdSchema, TokenSchema, UIntSchema } from './identity';
import { schema, t } from '@colyseus/schema';
import { WalkerSchema } from './realm/schema';

/** The match channel is separate from the kingdom's 5 Hz walking patches. */
export const GATHER_HZ = 30;
export const GATHER_RECONNECT_MS = 30_000;
/** One set of dimensions and speed limits for authority, local paddle prediction and tabletop presentation. */
export const PONG_RULES = Object.freeze({ halfWidth: 1, paddleY: 1.35, paddleHalf: .21, radius: .045,
  paddleSpeed: 5, startSpeed: 1.8, maxSpeed: 4.8, step: 1 / GATHER_HZ, serveMs: 900, winningScore: 7 });
/** A small shared interior: all its actual walkers are relevant, without kingdom district filtering. */
export const TavernRoomState = schema({
  kingdomId: t.string(), writerEpoch: t.string(), origin: t.string(), collisionRevision: t.uint32(),
  walkers: t.map(WalkerSchema),
}, 'ChatdomTavernV1');
export const GatherPongInputSchema = z.strictObject({
  match: TokenSchema,
  sequence: z.number().int().min(0).max(0xffff_ffff),
  paddle: z.number().finite().min(-1).max(1),
});
export type GatherPongInput = z.infer<typeof GatherPongInputSchema>;
export const GatherStartSchema = z.strictObject({ table: TokenSchema, revision: z.number().int().nonnegative(), id: TokenSchema });
export type GatherStart = z.infer<typeof GatherStartSchema>;

export const GATHER_GAMES = ['pong', 'stones', 'hearth-dice'] as const;
export type GatherGame = typeof GATHER_GAMES[number];
export interface StonesView {
  readonly match: string; readonly phase: 'playing' | 'finished'; readonly revision: number;
  readonly board: readonly number[]; readonly turn: 0 | 1; readonly deadline: number;
  readonly winner: 0 | 1 | null; readonly reason: 'four' | 'draw' | 'conceded' | null;
  readonly last: { readonly column: number; readonly row: number; readonly seat: 0 | 1 } | null;
  readonly winning: readonly number[];
}
export interface DiceView {
  readonly match: string; readonly phase: 'playing' | 'finished'; readonly revision: number;
  readonly scores: readonly number[]; readonly active: readonly boolean[]; readonly turn: number;
  readonly pot: number; readonly die: 1 | 2 | 3 | 4 | 5 | 6 | null; readonly deadline: number;
  readonly winner: number | null; readonly reason: 'fifty' | 'conceded' | 'draw' | null;
  readonly last: 'roll' | 'bust' | 'hold' | 'timeout' | 'conceded' | null;
}
export const GatherMoveSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('drop'), id: TokenSchema, table: TokenSchema, match: TokenSchema, revision: UIntSchema, column: z.number().int().min(0).max(6) }),
  z.strictObject({ action: z.enum(['roll', 'hold']), id: TokenSchema, table: TokenSchema, match: TokenSchema, revision: UIntSchema }),
]);
export type GatherMove = z.infer<typeof GatherMoveSchema>;

/** Actual swept impacts, bounded and public so sound never guesses a bounce from two positions. */
export interface PongContact {
  readonly sequence: number; readonly tick: number; readonly at: number;
  readonly kind: 'paddle' | 'rail'; readonly x: number; readonly y: number;
}
export interface PongView {
  readonly match: string;
  readonly phase: 'serve' | 'rally' | 'finished' | 'interrupted';
  readonly tick: number;
  readonly at: number;
  readonly serveAt: number;
  readonly ball: { readonly x: number; readonly y: number; readonly vx: number; readonly vy: number };
  readonly paddles: readonly [number, number];
  readonly acknowledged: readonly [number, number];
  readonly score: readonly [number, number];
  readonly winner: 0 | 1 | null;
  readonly reason: 'points' | 'conceded' | 'restart' | null;
  readonly contacts?: readonly PongContact[] | undefined;
}
export interface GatherTableView {
  readonly table: string;
  readonly revision: number;
  /** Names come only from the authenticated kingdom entry. An absent seat stays null. */
  readonly seats: readonly [string | null, string | null];
  readonly pong: PongView | null;
  readonly game?: GatherGame | undefined;
  /** Extra physical chairs at the four-player dice table; the original pair remains stable. */
  readonly extraSeats?: readonly [string | null, string | null] | undefined;
  readonly stones?: StonesView | null | undefined;
  readonly dice?: DiceView | null | undefined;
  /** Immutable approved participant names for this match, even after a chair changes hands. */
  readonly players?: readonly string[] | undefined;
  readonly status?: 'ready' | 'saving' | 'unavailable' | undefined;
}
export interface GatherFrame { readonly at: number; readonly tables: readonly GatherTableView[] }
export interface GatherSelf { readonly table: string | null; readonly seat: 0 | 1 | null;
  readonly seatIndex?: 0 | 1 | 2 | 3 | null | undefined;
  /** Index in the match's immutable participants; null for a newly seated observer of an older match. */
  readonly playerIndex?: number | null | undefined;
}

const pair = <T extends z.ZodType>(item: T) => z.tuple([item, item]);
const coordinate = z.number().finite().min(-1000).max(1000);
const point = z.tuple([coordinate, coordinate, coordinate]);
const twoSeats = z.union([z.literal(0), z.literal(1)]);
export const StonesViewSchema: z.ZodType<StonesView> = z.strictObject({
  match: TokenSchema, phase: z.enum(['playing', 'finished']), revision: UIntSchema,
  board: z.array(z.number().int().min(0).max(2)).length(42), turn: twoSeats, deadline: EpochMsSchema,
  winner: twoSeats.nullable(), reason: z.enum(['four', 'draw', 'conceded']).nullable(),
  last: z.strictObject({ column: z.number().int().min(0).max(6), row: z.number().int().min(0).max(5), seat: twoSeats }).nullable(),
  winning: z.array(z.number().int().min(0).max(41)).max(42),
});
export const DiceViewSchema: z.ZodType<DiceView> = z.strictObject({
  match: TokenSchema, phase: z.enum(['playing', 'finished']), revision: UIntSchema,
  scores: z.array(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)).min(2).max(4),
  active: z.array(z.boolean()).min(2).max(4), turn: z.number().int().min(0).max(3), pot: UIntSchema,
  die: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6)]).nullable(),
  deadline: EpochMsSchema, winner: z.number().int().min(0).max(3).nullable(),
  reason: z.enum(['fifty', 'conceded', 'draw']).nullable(), last: z.enum(['roll', 'bust', 'hold', 'timeout', 'conceded']).nullable(),
});
export const PongViewSchema: z.ZodType<PongView> = z.strictObject({
  match: TokenSchema, phase: z.enum(['serve', 'rally', 'finished', 'interrupted']), tick: UIntSchema,
  at: EpochMsSchema, serveAt: EpochMsSchema,
  ball: z.strictObject({ x: z.number().finite().min(-4).max(4), y: z.number().finite().min(-4).max(4),
    vx: z.number().finite().min(-PONG_RULES.maxSpeed).max(PONG_RULES.maxSpeed), vy: z.number().finite().min(-PONG_RULES.maxSpeed).max(PONG_RULES.maxSpeed) }),
  paddles: pair(z.number().finite().min(-1).max(1)), acknowledged: pair(z.number().int().min(-1).max(0xffff_ffff)),
  score: pair(z.number().int().min(0).max(7)), winner: z.union([z.literal(0), z.literal(1)]).nullable(),
  reason: z.enum(['points', 'conceded', 'restart']).nullable(),
  contacts: z.array(z.strictObject({ sequence: UIntSchema, tick: UIntSchema, at: EpochMsSchema,
    kind: z.enum(['paddle', 'rail']), x: z.number().finite().min(-1).max(1),
    // A missed paddle can still be followed by a rail impact before the goal plane. Match the ball's domain.
    y: z.number().finite().min(-4).max(4) })).max(8).optional(),
});
export const GatherFrameSchema: z.ZodType<GatherFrame> = z.strictObject({ at: EpochMsSchema,
  tables: z.array(z.strictObject({ table: TokenSchema, revision: UIntSchema,
    seats: pair(DisplayNameSchema.nullable()), pong: PongViewSchema.nullable(), game: z.enum(GATHER_GAMES).optional(),
    extraSeats: pair(DisplayNameSchema.nullable()).optional(), stones: StonesViewSchema.nullable().optional(), dice: DiceViewSchema.nullable().optional(),
    players: z.array(DisplayNameSchema).max(4).optional(), status: z.enum(['ready', 'saving', 'unavailable']).optional() })).max(8),
});
export const GatherSelfSchema: z.ZodType<GatherSelf> = z.strictObject({ table: TokenSchema.nullable(), seat: twoSeats.nullable(), seatIndex: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).nullable().optional(), playerIndex: z.number().int().min(0).max(3).nullable().optional() });
/**
 * Portals are walk-through doorways, not interaction targets: the frozen target kinds stay unchanged. A threshold
 * is an axis-aligned volume of feet positions in its own room's frame, crossed in the unit horizontal `through`
 * direction. Kingdom coordinates are wider than the interior's.
 */
const worldCoordinate = z.number().finite().min(-100_000).max(100_000);
const worldPoint = z.tuple([worldCoordinate, worldCoordinate, worldCoordinate]);
export const TavernThresholdSchema = z.strictObject({
  min: worldPoint, max: worldPoint,
  through: z.tuple([z.number().finite().min(-1).max(1), z.number().finite().min(-1).max(1)]),
}).refine(t => t.min.every((v, i) => v < t.max[i]!) && Math.abs(Math.hypot(...t.through) - 1) < 1e-6, 'A threshold needs volume and a unit direction');
export type TavernThreshold = z.infer<typeof TavernThresholdSchema>;
export const GatherInteriorSchema = z.strictObject({
  revision: z.number().int().min(1).max(0xffff_ffff), layoutRevision: TokenSchema,
  boxes: z.array(z.strictObject({ min: point, max: point })).max(128),
  targets: z.array(z.strictObject({ id: TokenSchema, kind: z.literal('tavern-seat'), position: point, approach: point, reach: z.number().finite().positive().max(3) })).max(32),
  entry: z.strictObject({ feet: point, yaw: z.number().int().min(0).max(255) }),
  /** The interior exit doorway. The room says `exit` when an armed walker's feet cross it. */
  exit: TavernThresholdSchema.optional(),
});
export type GatherInterior = z.infer<typeof GatherInteriorSchema>;

/** Feet in metres; yaw is the walker's byte (zero faces +Z, 64 faces +X). */
export const TavernAnchorSchema = z.strictObject({ feet: worldPoint, yaw: z.number().int().min(0).max(255) });
export type TavernAnchor = z.infer<typeof TavernAnchorSchema>;
/**
 * The tavern door, for the generic portal transfer. `door` and `returnAnchor` are in the kingdom's frame, derived
 * from the installed exterior: the doorway itself, and supported clear feet just outside it facing out. `entry`
 * and `exit` are in the tavern's own frame: where you appear facing the room, and its interior doorway.
 */
export const TavernPortalSchema = z.strictObject({
  version: z.literal(1), id: TokenSchema, kingdomId: KingdomIdSchema,
  sourceRoom: z.literal('kingdom'), destinationRoom: z.literal('tavern'),
  /** The installed placement this was derived from; a changed collision revision means derive again. */
  source: z.strictObject({ placement: TokenSchema, collisionRevision: z.number().int().min(0).max(0xffff_ffff) }),
  door: TavernThresholdSchema, returnAnchor: TavernAnchorSchema,
  entry: TavernAnchorSchema, exit: TavernThresholdSchema,
});
export type TavernPortal = z.infer<typeof TavernPortalSchema>;
export function insideTavernThreshold(threshold: TavernThreshold, feet: readonly [number, number, number]): boolean {
  return feet.every((v, i) => Number.isFinite(v) && v >= threshold.min[i]! && v <= threshold.max[i]!);
}
/**
 * Where feet lie against a threshold, read in its own frame: `along` the `through` direction (before the near face,
 * within, or past the far face) and `across` it (within the doorway's span or beside it).
 */
function thresholdSide(threshold: TavernThreshold, feet: readonly [number, number, number]) {
  const [tx, tz] = threshold.through, xs = [threshold.min[0], threshold.max[0]], zs = [threshold.min[2], threshold.max[2]];
  const along = xs.flatMap(x => zs.map(z => x * tx + z * tz)), across = xs.flatMap(x => zs.map(z => z * tx - x * tz));
  const a = feet[0]! * tx + feet[2]! * tz, c = feet[2]! * tx - feet[0]! * tz;
  return { before: a < Math.min(...along), past: a > Math.max(...along), within: c >= Math.min(...across) && c <= Math.max(...across) };
}
/**
 * Edge-triggered crossing with hysteresis, in the `through` direction only. It arms when the walker is seen on the
 * approach side, before the near face, and fires once when they then step onto it (or clear past it, squarely
 * across the doorway's span, within a single step). Arriving on a threshold (a spawn, a reconnect), stepping on
 * from beside it or walking in backwards from the far side never fires; the walker comes round to the approach
 * side first.
 */
export function createThresholdWatch(threshold: TavernThreshold): (feet: readonly [number, number, number]) => boolean {
  let armed = false;
  return feet => {
    if (!feet.every(Number.isFinite)) return false;
    const now = insideTavernThreshold(threshold, feet), side = thresholdSide(threshold, feet);
    const crossed = armed && side.within && (now || side.past);
    // Only a sample off the doorway on its approach side arms the next crossing; any other sample disarms. A body
    // sliding round a jamb from slightly aside still counts: the collision only lets it in through the near face.
    armed = !now && side.before;
    return crossed;
  };
}
