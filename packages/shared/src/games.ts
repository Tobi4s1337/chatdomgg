import { z } from 'zod';
import { DisplayNameSchema, EpochMsSchema, TokenSchema, UIntSchema } from './identity';
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
});
export const GatherFrameSchema: z.ZodType<GatherFrame> = z.strictObject({ at: EpochMsSchema,
  tables: z.array(z.strictObject({ table: TokenSchema, revision: UIntSchema,
    seats: pair(DisplayNameSchema.nullable()), pong: PongViewSchema.nullable(), game: z.enum(GATHER_GAMES).optional(),
    extraSeats: pair(DisplayNameSchema.nullable()).optional(), stones: StonesViewSchema.nullable().optional(), dice: DiceViewSchema.nullable().optional(),
    players: z.array(DisplayNameSchema).max(4).optional(), status: z.enum(['ready', 'saving', 'unavailable']).optional() })).max(8),
});
export const GatherSelfSchema: z.ZodType<GatherSelf> = z.strictObject({ table: TokenSchema.nullable(), seat: twoSeats.nullable(), seatIndex: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).nullable().optional(), playerIndex: z.number().int().min(0).max(3).nullable().optional() });
export const GatherInteriorSchema = z.strictObject({
  revision: z.number().int().min(1).max(0xffff_ffff), layoutRevision: TokenSchema,
  boxes: z.array(z.strictObject({ min: point, max: point })).max(128),
  targets: z.array(z.strictObject({ id: TokenSchema, kind: z.literal('tavern-seat'), position: point, approach: point, reach: z.number().finite().positive().max(3) })).max(32),
  entry: z.strictObject({ feet: point, yaw: z.number().int().min(0).max(255) }),
});
export type GatherInterior = z.infer<typeof GatherInteriorSchema>;
