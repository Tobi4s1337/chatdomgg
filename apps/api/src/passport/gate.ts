/**
 * From the Raid Gate's minimal witnessed stamp to the book's stamp (spec 45 R1, spec 23 R8).
 *
 * The Gate authority has already verified each stamp it returns; its record keeps only `id`, `kingdomId`,
 * `occurredAt`, `kind` and `raidId`. The book needs the stamped kingdom's name and arms, a raid's actual road and
 * leader, and the gifts actually accepted on that journey. Those come only from trusted records that correspond to
 * the stamp: the kingdom directory for that kingdom ID, the witnessed road for that raid ID, accepted gift receipts
 * linked to that stamp ID. The stamp keeps its own IDs. Nothing is guessed: a stamp whose kingdom or road the
 * authorities cannot supply makes the page unavailable, named by the gap, rather than drawn with invented parts.
 */
import { PassportKingdomSchema, PassportStampSchema, type PassportKingdom, type PassportStamp } from '@chatdom/shared/passport';
import type { KingdomId, PassportStamp as GateStamp, PersonId, VisitorGiftView } from '../raid-gate/contracts';

export type { GateStamp };

/** A raid's road as the Gate authority witnessed it: the observed raid, its road and the walker who led it, if known. */
export interface WitnessedRoad {
  readonly raidId: string;
  readonly road: Readonly<{ id: string; from: KingdomId; to: KingdomId }>;
  /** Null is unknown. It is never filled from the broadcaster, a chatter or the first rider. */
  readonly leader: Readonly<{ personId: PersonId; name: string }> | null;
}

/** An accepted gift receipt linked to the stamped arrival. Offers, refusals and expiries never become gifts. */
export interface AcceptedGiftRecord {
  /** The stamp (arrival) this gift was given on. */
  readonly stampId: string;
  readonly gift: VisitorGiftView;
  /** The item's display name from its receipt. */
  readonly name: string;
  /** The actual keepsake record this gift became, if it became one. */
  readonly keepsakeId: string | null;
}

/** The facts the trusted ports returned for one page of Gate stamps. */
export interface StampFacts {
  readonly kingdoms: ReadonlyMap<string, PassportKingdom>;
  readonly roads: ReadonlyMap<string, WitnessedRoad>;
  readonly gifts: readonly AcceptedGiftRecord[];
}

/** Why a page of stamps cannot be drawn. The record ID names which stamp, never a guess about what it was. */
export type EnrichmentGap = Readonly<{
  gap: 'kingdom' | 'road' | 'gift' | 'record';
  stampId: string;
}>;

export type EnrichedStamps = Readonly<{ ok: true; stamps: readonly PassportStamp[] }> | Readonly<{ ok: false; missing: EnrichmentGap }>;

/** The most gifts one stamp carries in the frozen book. */
const GIFTS_PER_STAMP = 8;

export function enrichGateStamps(holder: PersonId, stamps: readonly GateStamp[], facts: StampFacts): EnrichedStamps {
  const out: PassportStamp[] = [];
  for (const stamp of stamps) {
    const missing = (gap: EnrichmentGap['gap']): EnrichedStamps => ({ ok: false, missing: { gap, stampId: stamp.id } });
    const kingdom = PassportKingdomSchema.safeParse(facts.kingdoms.get(stamp.kingdomId));
    if (!kingdom.success || kingdom.data.kingdomId !== stamp.kingdomId) return missing('kingdom');

    const gifts = [];
    for (const record of facts.gifts) {
      if (record.stampId !== stamp.id || record.gift.state !== 'accepted') continue;
      // The holder gave it (left behind) or received it (brought back). A receipt between two other people is not theirs.
      const direction = record.gift.from === holder ? 'left' : record.gift.to === holder ? 'brought-back' : null;
      if (!direction) return missing('gift');
      gifts.push({ id: record.gift.offerId, name: record.name, direction, keepsakeId: record.keepsakeId } as const);
    }
    if (gifts.length > GIFTS_PER_STAMP) return missing('gift');

    const base = { id: stamp.id, at: stamp.occurredAt, kingdom: kingdom.data, gifts };
    let candidate: unknown;
    if (stamp.kind === 'visit') {
      if (stamp.raidId !== null) return missing('record');
      candidate = { ...base, kind: 'visit' };
    } else {
      const witnessed = stamp.raidId === null ? undefined : facts.roads.get(stamp.raidId);
      if (!witnessed || witnessed.raidId !== stamp.raidId || witnessed.road.to !== stamp.kingdomId) return missing('road');
      candidate = {
        ...base, kind: 'raid', raidId: stamp.raidId,
        road: { id: witnessed.road.id, from: witnessed.road.from, to: witnessed.road.to },
        leader: witnessed.leader && { personId: witnessed.leader.personId, name: witnessed.leader.name },
      };
    }
    const parsed = PassportStampSchema.safeParse(candidate);
    if (!parsed.success) return missing(parsed.error.issues.some(issue => issue.path[0] === 'gifts') ? 'gift' : 'record');
    out.push(parsed.data);
  }
  return { ok: true, stamps: out };
}
