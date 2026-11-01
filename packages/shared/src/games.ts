import { z } from 'zod';
import { TokenSchema } from './identity';
import { schema, t } from '@colyseus/schema';
import { WalkerSchema } from './realm/schema';

/** The match channel is separate from the kingdom's 5 Hz walking patches. */
export const GATHER_HZ = 30;
export const GATHER_RECONNECT_MS = 30_000;
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
