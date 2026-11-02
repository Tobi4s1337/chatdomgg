import { z } from 'zod';
import type { ItemRecord, KingdomId } from '@chatdom/shared';
import type { RealmItems, ItemStore, ItemTransaction } from '../items';
import { ItemCommitUncertainError } from '../items/store';
import { postgresItemClient, postgresItemCommitGuard } from '../items/postgres';
import { RealmStorageUnavailableError } from '../persistence/database';
import type { RealmChannelSender } from '../room-channels';
import type { FishingCatchAuthority } from './catches';
import type { FishingRoomInstallation } from './installation';

export const WILLOW_ROD_ID = 'tool:rod.willow';
const GRANT_KEY = 'pier:willow-rod:1';
const NOW_MS = 'floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint';
export type RodTakeResult = { readonly status: 'taken'; readonly item: ItemRecord }
  | { readonly status: 'refused'; readonly message: string } | { readonly status: 'uncertain'; readonly message: string };

export function isEquippedWillowRod(item: ItemRecord | null, from: RealmChannelSender): item is ItemRecord {
  return !!item && item.ownerId === from.principal.personId && item.kingdomId === from.principal.kingdomId
    && item.origin === from.principal.origin && item.defId === WILLOW_ROD_ID && item.branch === 'held'
    && item.count === 1 && item.storied && (item.place === 'hand' || item.place === 'hotbar');
}

export function atRodRack(from: RealmChannelSender, installation: FishingRoomInstallation | null): boolean {
  const pose = from.pose();
  return !!installation && !!pose && pose.grounded && pose.collisionRevision === installation.revision
    && Math.abs(pose.position[1] - installation.rack[1]) <= .75
    && Math.hypot(pose.position[0] - installation.rack[0], pose.position[2] - installation.rack[2]) <= 2.25;
}

class RodRefused extends Error {}

/** A rack gives one enduring rod per person/kingdom/origin. Returning to it never clones a put-away tool. */
export function createPostgresRodRack(options: {
  readonly kingdomId: KingdomId; readonly origin: 'live' | 'simulated';
  readonly store: ItemStore; readonly items: RealmItems; readonly where: string;
  authority(): FishingCatchAuthority | null;
  installation(): FishingRoomInstallation | null;
  admit(from: RealmChannelSender, tx: ItemTransaction): Promise<{ readonly name: string } | null>;
  now(): number;
}) {
  const where = z.string().trim().min(1).max(200).parse(options.where);
  return async (from: RealmChannelSender): Promise<RodTakeResult> => {
    try {
      const retained = options.authority(), epoch = retained?.writerEpoch, principal = from.principal;
      let rack: FishingRoomInstallation | null = null, newGrant = false;
      const local = () => {
        if (!retained || !epoch || options.authority() !== retained || !retained.current || retained.writerEpoch !== epoch
          || retained.kingdomId !== options.kingdomId || retained.origin !== options.origin || from.principal !== principal
          || principal.kingdomId !== options.kingdomId || principal.origin !== options.origin || !from.present()
          || (newGrant && (options.installation() !== rack || !atRodRack(from, rack)))) throw new RodRefused();
      };
      local();
      const item = await options.store.transaction(options.kingdomId, async tx => {
        const sql = postgresItemClient(tx);
        local();
        const locked = await sql.query<{ mine: boolean }>(`SELECT (writer_epoch=$2 AND origin=$3 AND lease_expires_ms>${NOW_MS}) IS TRUE AS mine
          FROM realm_kingdoms WHERE kingdom_id=$1 FOR UPDATE`, [options.kingdomId, epoch, options.origin]);
        local(); if (locked.rows[0]?.mine !== true) throw new RodRefused();
        const admitted = await options.admit(from, tx);
        local(); if (!admitted) throw new RodRefused();
        postgresItemCommitGuard(tx, () => { local(); return true; });
        const receipt = await tx.receipt(principal.personId, options.origin, GRANT_KEY);
        local();
        let rod: ItemRecord;
        if (receipt) {
          const stored = await tx.get(receipt.itemId);
          local();
          if (!stored || stored.ownerId !== principal.personId || stored.kingdomId !== options.kingdomId
            || stored.origin !== options.origin || stored.defId !== WILLOW_ROD_ID || !stored.storied || stored.branch !== 'held') throw new RodRefused();
          rod = stored;
        } else {
          rack = options.installation(); newGrant = true; local();
          const at = options.now();
          if (!Number.isSafeInteger(at) || at < 0) throw new Error('Invalid rod time.');
          rod = await options.items.grant({ key: GRANT_KEY, ownerId: principal.personId, kingdomId: options.kingdomId,
            origin: options.origin, defId: WILLOW_ROD_ID, place: 'hotbar',
            source: { kind: 'pier', ref: 'pier:lake:willow-rod' },
            story: { by: { personId: principal.personId, name: admitted.name }, kingdomId: options.kingdomId,
              where, at, line: 'Taken from the rod rack.' } }, tx);
          local();
        }
        const visible = await tx.visible(rod);
        local();
        const finalAdmission = await options.admit(from, tx);
        local(); if (!finalAdmission) throw new RodRefused();
        const answer = structuredClone(visible);
        // Last SQL before the synchronous local guard and COMMIT, matching catch lock/fence order.
        const fenced = await sql.query(`SELECT 1 FROM realm_kingdoms
          WHERE kingdom_id=$1 AND writer_epoch=$2 AND origin=$3 AND lease_expires_ms>${NOW_MS}`, [options.kingdomId, epoch, options.origin]);
        local(); if (fenced.rowCount !== 1) throw new RodRefused();
        return answer;
      });
      return { status: 'taken', item };
    } catch (error) {
      if (error instanceof RodRefused) return { status: 'refused', message: 'Take a rod beside the rack at the pier. Your own rod stays yours if it is put away.' };
      if (error instanceof ItemCommitUncertainError) return { status: 'uncertain', message: 'The kingdom is checking your rod. Ask at the same rack again to find it.' };
      throw new RealmStorageUnavailableError('The rod could not be confirmed. Check your bag before asking again.');
    }
  };
}
