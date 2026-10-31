import type { PersonId } from '@chatdom/shared';
import type { Credit, MomentBodyOf } from '../../../web/src/twitch-moments/contracts';
import { MOMENT_DISPLAY_WINDOW_MS } from '../../../web/src/twitch-moments/contracts';
import { resolveCredit } from './credit';
import type { EntitlementContext } from './entitlement';
import type { NormalizedFact } from './normalizer';
import { GIFT_GROUP_LIMIT, GIFT_SHOWN_LIMIT, type GiftGroupRecord, type MomentRepository } from './records';

/** A gift group's cart and parcels may begin for two minutes after its first notice; later notices only update it. */
export const GIFT_BEAT_WINDOW_MS = 120_000;
/** How far apart a pay-it-forward notice and its gifter's own gift group may lie in provider time. */
export const FORWARD_WINDOW_MS = 30_000;

export type GiftTier = GiftGroupRecord['tier'];

/** The gifter as a notice states it. `personId` null is an anonymous gift: never resolved, never credited. */
export interface NoticeGifter { readonly personId: PersonId | null; readonly name: string | null }

export const giftsKey = (groupKey: string) => `gifts.${groupKey}`;

/** The one current public fact for a gift group; each real change republishes it under the same key. */
export function giftsFact(group: GiftGroupRecord, occurredAt: number): NormalizedFact {
  const opens = Math.max(occurredAt, group.firstAt + GIFT_BEAT_WINDOW_MS);
  const body: MomentBodyOf<'gifts'> = {
    kind: 'gifts', key: giftsKey(group.groupKey),
    // Late notices for an old group land as state: the window counts from the group's first provider time.
    displayUntil: Math.min(opens, occurredAt + MOMENT_DISPLAY_WINDOW_MS),
    groupKey: group.groupKey, giver: group.giver, tier: group.tier,
    // The aggregate's own count, never fewer than the parcels already disclosed.
    total: Math.min(GIFT_GROUP_LIMIT, Math.max(group.total ?? 0, group.recipients.length, 1)),
    recipients: [...group.shown], forwardedFrom: group.forwardedFrom,
  };
  return { current: true, body };
}

type Ledger = EntitlementContext;

/** The lasting seal at each recipient's home; rewritten in full when the group's attribution changes. */
async function putWrappings(repository: MomentRepository, group: GiftGroupRecord, recipients: GiftGroupRecord['recipients']): Promise<void> {
  for (const { personId, at } of recipients) {
    await repository.putWrapping({ version: 1, personId, groupKey: group.groupKey, giver: group.giver, forwardedFrom: group.forwardedFrom, tier: group.tier, at });
  }
}

/** Keep a gifter's own groups inside the pay-it-forward window only; this is a short binding aid, not a history. */
async function rememberForGifter(repository: MomentRepository, giverId: PersonId, groupKey: string, firstAt: number): Promise<void> {
  const window = await repository.gifterWindow(giverId);
  const groups = [...(window?.groups ?? []).filter(g => g.groupKey !== groupKey), { groupKey, firstAt }];
  const newest = Math.max(...groups.map(g => g.firstAt));
  const kept = groups.filter(g => g.firstAt >= newest - 2 * FORWARD_WINDOW_MS).slice(-16);
  await repository.putGifterWindow({ version: 1, giverId, groups: kept });
}

/**
 * Open a new notice gift group. A pending pay-it-forward from this exact gifter, within the window and not yet
 * consumed, is bound here and consumed once.
 */
async function openGroup({ kingdomId, repository, directory }: Ledger, groupKey: string, gifter: NoticeGifter, tier: GiftTier,
  total: number | null, at: number): Promise<GiftGroupRecord> {
  const giverId = gifter.personId;
  // Anonymous gifts stay anonymous even if another private record could identify the payer.
  const giver: Credit = giverId === null ? null : await resolveCredit(directory, kingdomId, giverId, gifter.name);
  let forwardedFrom: Credit = null;
  if (giverId !== null) {
    const pending = await repository.forward(giverId);
    if (pending && !pending.consumed && Math.abs(pending.at - at) <= FORWARD_WINDOW_MS) {
      forwardedFrom = pending.from;
      await repository.putForward({ ...pending, consumed: true });
    }
    await rememberForGifter(repository, giverId, groupKey, at);
  }
  return { version: 1, groupKey, giverId, anonymous: giverId === null, giver, tier, total, recipients: [], shown: [], forwardedFrom, firstAt: at };
}

/**
 * One recipient notice (`sub_gift`). A repeated recipient or notice changes nothing and publishes nothing, so a
 * parcel can never rain twice. The public entry names a recipient only as that public notice did: a named
 * citizen by their home (or the gate), a quiet citizen as anonymous, anyone else by the notice's own name.
 */
export async function receiveRecipient(ledger: Ledger, input: { groupKey: string; gifter: NoticeGifter; tier: GiftTier; single: boolean;
  noticeKey: string; recipientId: PersonId; recipientName: string; at: number }): Promise<NormalizedFact[]> {
  const { repository } = ledger;
  const group = await repository.giftGroup(input.groupKey)
    ?? await openGroup(ledger, input.groupKey, input.gifter, input.tier, input.single ? 1 : null, input.at);
  if (group.recipients.some(r => r.personId === input.recipientId || r.noticeKey === input.noticeKey)) return [];
  if (group.recipients.length >= GIFT_GROUP_LIMIT) return [];
  const credit = await resolveCredit(ledger.directory, ledger.kingdomId, input.recipientId, input.recipientName);
  const recipient = { personId: input.recipientId, noticeKey: input.noticeKey, at: input.at };
  const next: GiftGroupRecord = { ...group, firstAt: Math.min(group.firstAt, input.at), recipients: [...group.recipients, recipient],
    shown: group.shown.length < GIFT_SHOWN_LIMIT ? [...group.shown, { noticeKey: input.noticeKey, credit }] : group.shown };
  await repository.putGiftGroup(next);
  await putWrappings(repository, next, [recipient]);
  return [giftsFact(next, input.at)];
}

/** The aggregate notice (`community_sub_gift`): it may arrive before or after its recipients, and only once counts. */
export async function receiveAggregate(ledger: Ledger, input: { groupKey: string; gifter: NoticeGifter; tier: GiftTier; total: number; at: number }):
  Promise<NormalizedFact[]> {
  const { repository } = ledger;
  const existing = await repository.giftGroup(input.groupKey);
  if (existing && existing.total !== null) return [];
  const group = existing ?? await openGroup(ledger, input.groupKey, input.gifter, input.tier, null, input.at);
  const next: GiftGroupRecord = { ...group, total: input.total, firstAt: Math.min(group.firstAt, input.at) };
  await repository.putGiftGroup(next);
  return [giftsFact(next, input.at)];
}

/**
 * A pay-it-forward notice: `giverId` (the chatter) is paying forward a gift they once received from `from`.
 * This binds by exact identity, never by time or name guesses: only to a gift group whose own gifter is that same
 * person ID, opened within ±30 s of provider time. Exactly one unbound candidate binds now; none leaves a single
 * pending forward for that gifter, consumed once by their next group; several are ambiguous and bind nothing.
 * Attribution never decides recipients or counts.
 */
export async function receiveForward(ledger: Ledger, input: { giverId: PersonId; from: { personId: PersonId; name: string | null }; at: number }):
  Promise<NormalizedFact[]> {
  const { repository, directory, kingdomId } = ledger;
  const from = await resolveCredit(directory, kingdomId, input.from.personId, input.from.name);
  // An anonymous or quiet original gifter cannot be credited, so there is nothing public to attribute.
  if (from === null) return [];
  const window = await repository.gifterWindow(input.giverId);
  const candidates: GiftGroupRecord[] = [];
  for (const entry of window?.groups ?? []) {
    if (Math.abs(entry.firstAt - input.at) > FORWARD_WINDOW_MS) continue;
    const group = await repository.giftGroup(entry.groupKey);
    if (group && group.giverId === input.giverId && group.forwardedFrom === null) candidates.push(group);
  }
  if (candidates.length > 1) return [];
  const [group] = candidates;
  if (!group) {
    await repository.putForward({ version: 1, giverId: input.giverId, from, at: input.at, consumed: false });
    return [];
  }
  const next: GiftGroupRecord = { ...group, forwardedFrom: from };
  await repository.putGiftGroup(next);
  await putWrappings(repository, next, next.recipients);
  return [giftsFact(next, input.at)];
}
