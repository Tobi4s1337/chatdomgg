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
}
export interface GatherFrame { readonly at: number; readonly tables: readonly GatherTableView[] }
export interface GatherSelf { readonly table: string | null; readonly seat: 0 | 1 | null }

const pair = <T extends z.ZodType>(item: T) => z.tuple([item, item]);
const coordinate = z.number().finite().min(-1000).max(1000);
const point = z.tuple([coordinate, coordinate, coordinate]);
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
    seats: pair(DisplayNameSchema.nullable()), pong: PongViewSchema.nullable() })).max(8),
});
export const GatherSelfSchema: z.ZodType<GatherSelf> = z.strictObject({ table: TokenSchema.nullable(), seat: z.union([z.literal(0), z.literal(1)]).nullable() });
export const GatherInteriorSchema = z.strictObject({
  revision: z.number().int().min(1).max(0xffff_ffff), layoutRevision: TokenSchema,
  boxes: z.array(z.strictObject({ min: point, max: point })).max(128),
  targets: z.array(z.strictObject({ id: TokenSchema, kind: z.literal('tavern-seat'), position: point, approach: point, reach: z.number().finite().positive().max(3) })).max(32),
  entry: z.strictObject({ feet: point, yaw: z.number().int().min(0).max(255) }),
});
export type GatherInterior = z.infer<typeof GatherInteriorSchema>;
