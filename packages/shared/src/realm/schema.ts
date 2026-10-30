import { schema, t, type SchemaType } from '@colyseus/schema';

/** Flat primitives only. Colyseus owns sequence/ack/time; do not add a parallel input sequence. */
export const WalkInputSchema = schema({
  moveX: t.int8(), moveZ: t.int8(), buttons: t.uint8(), yaw: t.uint8(), collisionRevision: t.uint32(), placement: t.uint32().default(0),
}, 'ChatdomWalkInputV1');

export const WalkerSchema = schema({
  // Public opaque render key is the map key. No Twitch ID, coals, home rights or token in this schema.
  name: t.string(), look: t.string(), district: t.string(),
  x: t.float64(), y: t.float64(), z: t.float64(),
  vx: t.float64(), vy: t.float64(), vz: t.float64(),
  grounded: t.boolean(), yaw: t.uint8(), distance: t.float64(), collisionRevision: t.uint32(),
  // Server relocation context, never a physics/prediction field or a parallel input sequence. Starts at zero.
  placement: t.uint32().default(0),
}, 'ChatdomWalkerV1');
export type WalkerSchema = SchemaType<typeof WalkerSchema>;

export const KingdomRoomState = schema({
  protocol: t.uint8().default(1), kingdomId: t.string(), writerEpoch: t.string(),
  origin: t.string(), layoutRevision: t.string(), collisionRevision: t.uint32(),
  factSequence: t.float64(),
  walkers: t.map(WalkerSchema).view(),
}, 'ChatdomKingdomV1');
export type KingdomRoomState = SchemaType<typeof KingdomRoomState>;
