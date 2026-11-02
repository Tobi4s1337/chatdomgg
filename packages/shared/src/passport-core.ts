import { z } from 'zod';
import { DisplayNameSchema, EpochMsSchema, KingdomIdSchema, PersonIdSchema, Sha256Schema, TokenSchema } from './identity';

/** Public read projection of witnessed travel; never a travel command or a second ledger. */
const Ink = z.string().regex(/^#[a-fA-F0-9]{6}$/);
export const PassportCrestSchema = z.strictObject({
  key: TokenSchema,
  shape: z.enum(['heater', 'round', 'swallowtail']),
  charge: z.enum(['oak', 'star', 'wave', 'mountain']),
  colours: z.array(Ink).min(2).max(4),
  /** Approved public artwork, resolved by the host. Null uses the actual supplied heraldic grammar. */
  assetHash: Sha256Schema.nullable(),
});
export const PassportKingdomSchema = z.strictObject({ kingdomId: KingdomIdSchema, name: DisplayNameSchema, crest: PassportCrestSchema });
const Person = z.strictObject({ personId: PersonIdSchema, name: DisplayNameSchema });
export const PassportRoadSchema = z.strictObject({ id: TokenSchema, from: KingdomIdSchema, to: KingdomIdSchema })
  .refine(road => road.from !== road.to, 'A road connects two kingdoms');
export const PassportGiftSchema = z.strictObject({
  id: TokenSchema, name: DisplayNameSchema, direction: z.enum(['left', 'brought-back']),
  /** An actual accepted gift/keepsake record, not an offer, promise or paid reward. */
  keepsakeId: TokenSchema.nullable(),
});
const StampFields = { id: TokenSchema, at: EpochMsSchema, kingdom: PassportKingdomSchema, gifts: z.array(PassportGiftSchema).max(8) };
export const PassportStampSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...StampFields, kind: z.literal('visit') }),
  z.strictObject({ ...StampFields, kind: z.literal('raid'), raidId: TokenSchema, road: PassportRoadSchema, leader: Person.nullable() }),
]).superRefine((stamp, context) => {
  if (stamp.kind === 'raid' && stamp.road.to !== stamp.kingdom.kingdomId) context.addIssue({ code: 'custom', path: ['road'], message: 'The stamp must name the road’s destination' });
  if (new Set(stamp.gifts.map(gift => gift.id)).size !== stamp.gifts.length) context.addIssue({ code: 'custom', path: ['gifts'], message: 'Duplicate gift' });
});
export const PassportVisitSchema = z.strictObject({ kingdom: PassportKingdomSchema, firstAt: EpochMsSchema, lastAt: EpochMsSchema })
  .refine(visit => visit.firstAt <= visit.lastAt, 'Visit dates are ordered');
export const PassportBondSchema = z.strictObject({
  id: TokenSchema, since: EpochMsSchema,
  with: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('kingdom'), kingdom: PassportKingdomSchema }),
    z.strictObject({ kind: z.literal('citizen'), person: Person }),
  ]),
  /** Authored display label for an actual relationship record; never a computed affinity score. */
  name: DisplayNameSchema,
});
export const PassportKeepsakeSchema = z.strictObject({
  id: TokenSchema, name: DisplayNameSchema, earnedAt: EpochMsSchema, kingdom: PassportKingdomSchema,
  artHash: Sha256Schema.nullable(),
});
const Cursor = z.string().min(1).max(256).nullable();
const page = <S extends z.ZodType>(schema: S) => z.strictObject({ items: z.array(schema).max(50), nextCursor: Cursor });
const unique = <T>(items: readonly T[], key: (item: T) => string) => new Set(items.map(key)).size === items.length;
/** Hidden is deliberately a different payload: no history, holder, counts, cursors or revision side-channel. */
export const makePassportBookSchema = <S extends z.ZodType<string>>(origin: S) => z.discriminatedUnion('visibility', [
  z.strictObject({ version: z.literal(1), origin: origin, visibility: z.literal('hidden') }),
  z.strictObject({
    version: z.literal(1), origin: origin, visibility: z.literal('visible'),
    holder: Person, revision: TokenSchema, asOf: EpochMsSchema,
    stamps: page(PassportStampSchema), kingdoms: page(PassportVisitSchema),
    bonds: page(PassportBondSchema), keepsakes: page(PassportKeepsakeSchema),
  }).superRefine((book, context) => {
    for (const [collection, valid] of [
      ['stamps', unique(book.stamps.items, stamp => stamp.id)],
      ['kingdoms', unique(book.kingdoms.items, visit => visit.kingdom.kingdomId)],
      ['bonds', unique(book.bonds.items, bond => bond.id)],
      ['keepsakes', unique(book.keepsakes.items, keepsake => keepsake.id)],
    ] as const) if (!valid) context.addIssue({ code: 'custom', path: [collection], message: 'Duplicate passport record' });
    if (book.stamps.items.some(stamp => stamp.at > book.asOf)
      || book.kingdoms.items.some(visit => visit.lastAt > book.asOf)
      || book.bonds.items.some(bond => bond.since > book.asOf)
      || book.keepsakes.items.some(keepsake => keepsake.earnedAt > book.asOf)) {
      context.addIssue({ code: 'custom', message: 'Passport contains a future record' });
    }
  }),
]);

export type PassportStamp = z.infer<typeof PassportStampSchema>;
export type PassportKingdom = z.infer<typeof PassportKingdomSchema>;
export type PassportCrest = z.infer<typeof PassportCrestSchema>;
