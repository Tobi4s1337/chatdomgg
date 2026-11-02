import { z } from 'zod';
import { EpochMsSchema, KingdomIdSchema, TokenSchema } from './identity';
import { ComposedHousePartPlanSchema } from './forge';

/**
 * "The forge remembers": every piece a kingdom's forge has made, newest first, with who wished for it and when.
 * Built only from the realm's committed Forge facts, so a refused, held or cold wish never appears. It carries the
 * piece (its plan, style and kit, enough to draw it), its title and plaque, and the maker's name as the citizen
 * card shows it. It never carries a wish's words, a verdict, a reason, a person ID or a home.
 * Public: the wall at the forge, the Esc ledger page and the Twitch panel all read the same route.
 */
export const FORGE_LEDGER_ROUTE = '/api/realm/forge/ledger' as const;
export const FORGE_LEDGER_LIMITS = {
  /** At most this many entries per read; `total` still counts every piece. */
  entries: 120,
  /** The realm answers repeated reads of one kingdom from memory for this long. */
  cacheMs: 10_000,
  /** Readers that stay open (the wall, an open page) read again this often. */
  pollMs: 30_000,
} as const;

export const ForgeLedgerEntrySchema = z.strictObject({
  /** The committed attachment's ID: stable, opaque and already public in the kingdom's room. */
  id: TokenSchema,
  title: z.string().min(1).max(64),
  plaque: z.string().min(1).max(120),
  /** The piece itself: the registered construction, its family and the kit revision that made it. */
  plan: ComposedHousePartPlanSchema,
  family: z.enum(['hearth', 'tide', 'grove']),
  kitRevision: z.number().int().positive(),
  /** As the citizen card shows the maker now; the name the piece was forged under when they have no card here. */
  maker: z.strictObject({ name: z.string().min(1).max(64) }),
  /** When the realm committed it (the piece's first forging). */
  forgedAt: EpochMsSchema,
  /**
   * How many homes carry a copy. Absent until copies exist: until then the ledger says nothing about copies.
   * When present it counts the original's home too.
   */
  copies: z.number().int().min(2).max(65_536).optional(),
});
export type ForgeLedgerEntry = z.infer<typeof ForgeLedgerEntrySchema>;

export const ForgeLedgerViewSchema = z.strictObject({
  version: z.literal(1),
  kingdomId: KingdomIdSchema,
  /** Every piece this kingdom's forge has made, including those beyond `entries`. */
  total: z.number().int().min(0).max(1_000_000),
  /** Newest first; ties broken by ID so every reader sees the same order. */
  entries: z.array(ForgeLedgerEntrySchema).max(FORGE_LEDGER_LIMITS.entries),
  at: EpochMsSchema,
}).superRefine((view, ctx) => {
  if (view.entries.length > view.total) ctx.addIssue({ code: 'custom', message: 'More entries than pieces.', path: ['entries'] });
  for (let i = 1; i < view.entries.length; i++) {
    const a = view.entries[i - 1]!, b = view.entries[i]!;
    if (a.forgedAt < b.forgedAt || (a.forgedAt === b.forgedAt && a.id >= b.id))
      ctx.addIssue({ code: 'custom', message: 'Entries must be newest first.', path: ['entries', i] });
  }
});
export type ForgeLedgerView = z.infer<typeof ForgeLedgerViewSchema>;

/** The one order every surface uses: newest first, then by ID. */
export function compareForgeLedgerEntries(a: Pick<ForgeLedgerEntry, 'forgedAt' | 'id'>, b: Pick<ForgeLedgerEntry, 'forgedAt' | 'id'>): number {
  return b.forgedAt - a.forgedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
