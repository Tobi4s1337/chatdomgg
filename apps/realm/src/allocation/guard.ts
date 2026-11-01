import { canonicalJson } from '../persistence/codec';
import { HomeTierSchema } from '@chatdom/shared';
import type { RealmCommitGuard } from '../persistence/postgres-repository';

const RECEIPT = /^deed:[a-f0-9]{64}$/;

/**
 * `home.installAllocated` is valid only for a pending deed whose receipt, kingdom, origin, owner, plot, slot and
 * layout revision match, and only with the exact install command fixed on that deed. Runs inside the kingdom
 * writer's transaction: the deed becomes `installed` in the same COMMIT as the fact, or not at all.
 * Lock order: the writer already holds its kingdom row; this takes the one deed row.
 */
export const verifyAllocation: RealmCommitGuard = async (tx, fact, prior) => {
  if (fact.body.type === 'growth.bindHome') {
    const command = fact.body, home = prior.homes[command.homeId];
    if (!home || command.evidenceReceipt !== home.allocationReceipt || !RECEIPT.test(command.evidenceReceipt)) return 'conflict';
    const deed = (await tx.query<{ person_id: string; kingdom_id: string; origin: string; layout_revision: string;
      plot_id: string; slot: number; status: string; placement: string }>(
      `SELECT person_id, kingdom_id, origin, layout_revision, plot_id, slot, status, placement FROM realm_deeds WHERE receipt = $1 FOR UPDATE`,
      [command.evidenceReceipt])).rows[0];
    if (!deed || deed.status !== 'installed' || deed.kingdom_id !== fact.kingdomId || deed.origin !== fact.origin
      || deed.person_id !== home.ownerId || deed.plot_id !== home.id || deed.slot !== home.slot || deed.layout_revision !== home.layoutRevision) return 'conflict';
    const placement = JSON.parse(deed.placement) as { tier?: unknown };
    const tier = HomeTierSchema.safeParse(placement.tier);
    return tier.success && tier.data === command.installedTier ? 'ok' : 'conflict';
  }
  if (fact.body.type !== 'home.installAllocated') return 'ok';
  const home = fact.body.home;
  if (!RECEIPT.test(home.allocationReceipt)) return 'conflict';
  const deed = (await tx.query<{ person_id: string; kingdom_id: string; origin: string; layout_revision: string; plot_id: string; slot: number; status: string; install_command: string | null }>(
    `SELECT person_id, kingdom_id, origin, layout_revision, plot_id, slot, status, install_command FROM realm_deeds WHERE receipt = $1 FOR UPDATE`,
    [home.allocationReceipt])).rows[0];
  if (!deed || deed.status !== 'pending' || deed.kingdom_id !== fact.kingdomId || deed.origin !== fact.origin
    || deed.person_id !== home.ownerId || deed.plot_id !== home.id || deed.slot !== home.slot || deed.layout_revision !== home.layoutRevision
    || deed.install_command === null || deed.install_command !== canonicalJson(fact.body)) return 'conflict';
  await tx.query(`UPDATE realm_deeds SET status = 'installed', installed_seq = $2, settled_ms = $3 WHERE receipt = $1`,
    [home.allocationReceipt, fact.seq, fact.committedAt]);
  return 'ok';
};
