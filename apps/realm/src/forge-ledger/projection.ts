import { FORGE_LEDGER_LIMITS, ForgeDraftSchema, compareForgeLedgerEntries, type ForgeLedgerEntry, type ForgeLedgerView, type KingdomId, type PersonId } from '@chatdom/shared';
import { forgeHostForPerson, type RealmPrivateState } from '@chatdom/shared/realm';

/**
 * "The forge remembers", projected from the realm's committed Forge facts only. `state.attachments` holds exactly
 * the pieces whose `forge.commitApproved` fact committed: a refused, held, cold or released wish never reaches it, and
 * a reservation in flight lives elsewhere. Superseded pieces (another piece took their socket) stay remembered.
 *
 * Every field is copied by name from the public attachment. The private record's words, approval receipt, owner ID
 * and home never leave this function.
 */
export function forgeLedgerView(state: RealmPrivateState, at: number, limit: number = FORGE_LEDGER_LIMITS.entries): ForgeLedgerView {
  const entries: ForgeLedgerEntry[] = [];
  for (const owned of Object.values(state.attachments)) {
    const attachment = owned.attachment;
    // A piece whose public draft no longer reads under today's contract is left off rather than half drawn.
    const draft = ForgeDraftSchema.safeParse(attachment.draft);
    if (!draft.success || attachment.kingdomId !== state.kingdomId) continue;
    entries.push({
      id: attachment.id,
      title: draft.data.title,
      plaque: draft.data.plaque,
      plan: { version: 2, kind: draft.data.plan.kind, motif: draft.data.plan.motif, finish: draft.data.plan.finish, accent: draft.data.plan.accent },
      family: attachment.family,
      kitRevision: attachment.kitRevision,
      maker: { name: makerName(state, owned.ownerId, attachment.provenance.makerName) },
      forgedAt: attachment.provenance.firstForgedAt,
    });
  }
  entries.sort(compareForgeLedgerEntries);
  return { version: 1, kingdomId: state.kingdomId as KingdomId, total: entries.length, entries: entries.slice(0, Math.max(0, Math.min(limit, FORGE_LEDGER_LIMITS.entries))), at };
}

/** The approved name the citizen card shows today; the name the piece was forged under when they hold no home here. */
function makerName(state: RealmPrivateState, ownerId: PersonId, forgedUnder: string): string {
  const current = forgeHostForPerson(state, ownerId)?.attribution.makerName;
  return current && current.length <= 64 ? current : forgedUnder;
}
