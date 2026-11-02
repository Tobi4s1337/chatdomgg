/**
 * The private wire between the API's travel coordinator and the realm's actual rooms (RS11). The API never decides
 * where a person stands: it asks the realm, which answers from its rooms, writers and seats. Bearer
 * `REALM_INTERNAL_SECRET`, the same service credential the dock bridge uses; never browser-facing.
 */
import { z } from 'zod';

export const REALM_ROOM_DOOR_ROUTE = '/internal/realm/raid-travel';
export const REALM_ROOM_DOOR_BODY_LIMIT = 4 * 1024;

const Id = z.string().regex(/^[1-9][0-9]{0,31}$/u);
const Origin = z.enum(['live', 'simulated']);
const Ticket = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/u);
export const RoomDoorTicketRefSchema = z.strictObject({
  ticket: Ticket, personId: Id, sessionId: z.string().min(1).max(128), from: Id, to: Id,
  generation: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), kind: z.enum(['visit', 'raid', 'return']),
});
const head = { version: z.literal(1), origin: Origin };
export const RoomDoorRequestSchema = z.discriminatedUnion('op', [
  z.strictObject({ ...head, op: z.literal('admission'), personId: Id, kingdomId: Id }),
  z.strictObject({ ...head, op: z.literal('reserve'), ref: RoomDoorTicketRefSchema }),
  z.strictObject({ ...head, op: z.literal('prepare'), ref: RoomDoorTicketRefSchema }),
  z.strictObject({ ...head, op: z.literal('commit'), ref: RoomDoorTicketRefSchema }),
  z.strictObject({ ...head, op: z.literal('reconcile'), ref: RoomDoorTicketRefSchema }),
  z.strictObject({ ...head, op: z.literal('release'), ref: RoomDoorTicketRefSchema, side: z.enum(['destination', 'source']) }),
]);
export type RoomDoorRequest = z.infer<typeof RoomDoorRequestSchema>;

/**
 * The realm echoes the operation, its origin and the ticket (or the person and kingdom for admission) so a reply can
 * never be mistaken for another call's. `outcome` is read again by the coordinator's own strict readers.
 */
export const RoomDoorReplySchema = z.strictObject({
  version: z.literal(1), origin: Origin, op: z.enum(['admission', 'reserve', 'prepare', 'commit', 'reconcile', 'release']),
  subject: z.string().min(1).max(160), outcome: z.strictObject({ kind: z.string().min(1).max(32) }).catchall(z.unknown()),
});
export type RoomDoorReply = z.infer<typeof RoomDoorReplySchema>;

export const roomDoorSubject = (request: RoomDoorRequest): string =>
  request.op === 'admission' ? `${request.personId}@${request.kingdomId}` : request.ref.ticket;
