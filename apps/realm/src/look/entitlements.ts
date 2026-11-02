import type { Pool } from 'pg';
import { NO_ENTITLEMENTS, isHex, type CitizenEntitlements, type EntitlementKingdom, type Hex } from '@chatdom/content/avatar-style';
import type { KingdomId, PersonId, VoxelBlueprint } from '@chatdom/shared';
import type { RealmFoundedScene } from '@chatdom/world';
import { BANNER_ARMS, BANNER_STANDARD } from '../../../../packages/content/src/civic';
import type { TenureEvidenceVerifier, VerifiedTenure } from '../allocation/evidence';
import type { LookOrigin, LookRecords, LookRecordsResult } from './ports';

/*
 * Earned pieces are checked against what the realm has verified, never against what a browser says. Today that is:
 * - tenure: the signed follow and subscription records on the person's deed in that kingdom (`realm_deeds.evidence`,
 *   checked again here by `TenureEvidenceVerifier`), counted as they were observed and never extrapolated;
 * - the kingdom: its approved name, and the two colours of the royal standard its founded scene flies at the gate.
 * Founder badges, keepsakes, forged pieces and moments have no realm record yet, so they stay empty (README).
 */

/** A sub observed within this long is shown as current; older evidence still counts its months, dimmed. */
export const SUB_CURRENT_MS = 31 * 24 * 60 * 60 * 1000;
/** Shown in place of a kingdom name the host has not approved. */
export const UNNAMED_KINGDOM = 'this kingdom';

/** Whole calendar months from `from` to `to` (UTC), never negative. */
export function wholeMonths(from: number, to: number): number {
  if (!(to > from)) return 0;
  const a = new Date(from), b = new Date(to);
  let months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth();
  const at = (n: number) => {
    const last = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + n + 1, 0)).getUTCDate();
    return Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + n, Math.min(a.getUTCDate(), last), a.getUTCHours(), a.getUTCMinutes(), a.getUTCSeconds(), a.getUTCMilliseconds());
  };
  while (months > 0 && at(months) > to) months--;
  return Math.max(0, months);
}

/**
 * The entitlements verified tenure supports. Following is counted up to the moment the follow was observed. A sub
 * record carries cumulative months but not its tier, so it counts as tier 1 (prime and tier 1 earn the same pieces);
 * a higher tier needs a record that says so.
 */
export function entitlementsFrom(tenure: VerifiedTenure, kingdom: EntitlementKingdom, origin: LookOrigin, now: number): CitizenEntitlements {
  const follow = tenure.records.find(record => record.kind === 'follow');
  const sub = tenure.records.find(record => record.kind === 'subscription');
  return {
    ...NO_ENTITLEMENTS(kingdom, origin),
    followedMonths: follow && follow.kind === 'follow' ? wholeMonths(follow.followedAt, follow.observedAt) : 0,
    sub: sub && sub.kind === 'subscription' ? { tier: '1', months: sub.months, active: now - sub.observedAt <= SUB_CURRENT_MS } : null,
  };
}

/** The placement `arrivalFurnishings` puts before the castle gate: the kingdom's own standard. */
export const ROYAL_STANDARD_PLACEMENT = 'arrival:standard:royal';

function materialAt(blueprint: VoxelBlueprint, x: number, y: number, z: number): number {
  let material = 0;
  for (const box of blueprint.boxes) {
    if (x >= box.from[0] && x < box.to[0] && y >= box.from[1] && y < box.to[1] && z >= box.from[2] && z < box.to[2]) material = box.material;
  }
  return material;
}

/**
 * The two colours (field, charge) of the royal standard as it actually stands in a founded scene, read from its
 * cloth cells and the scene's own material registry. Null when the scene has no standard or its cloth is unreadable.
 */
export function royalStandardColours(scene: Pick<RealmFoundedScene, 'assets' | 'placements' | 'materials'>): readonly [Hex, Hex] | null {
  const placement = scene.placements.find(piece => piece.id === ROYAL_STANDARD_PLACEMENT);
  const blueprint = placement && scene.assets.find(asset => asset.assetHash === placement.assetHash)?.blueprint;
  if (!blueprint) return null;
  const { x: [x0], top, z: [z0] } = BANNER_STANDARD.cloth;
  // The middle cloth layer: covered whether a column hangs flat or bellies forward in a fold.
  const z = z0 + 1, votes = { F: new Map<number, number>(), C: new Map<number, number>() };
  BANNER_ARMS.forEach((row, i) => [...row].forEach((mark, col) => {
    if (mark !== 'F' && mark !== 'C') return;
    const id = materialAt(blueprint, x0 + col, top - i, z), tally = votes[mark];
    if (id !== 0) tally.set(id, (tally.get(id) ?? 0) + 1);
  }));
  const winner = (tally: Map<number, number>) => [...tally].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
  const colour = (id: number | undefined) => {
    const value = id === undefined ? undefined : scene.materials.materials.find(material => material.id === id)?.colour.toLowerCase();
    return isHex(value) ? value : null;
  };
  const field = colour(winner(votes.F)), charge = colour(winner(votes.C));
  return field && charge && field !== charge ? [field, charge] : null;
}

export interface RealmLookRecordsOptions {
  readonly pool: Pool;
  readonly origin: LookOrigin;
  readonly verifier: Pick<TenureEvidenceVerifier, 'verify'>;
  /** The host-approved kingdom name, as the entry gate serves it. */
  readonly name: (kingdomId: KingdomId) => string | undefined;
  /** The kingdom's colours from its prepared founded scene; null while no scene is prepared on this realm. */
  readonly colours: (kingdomId: KingdomId) => readonly [Hex, Hex] | null;
  readonly now?: () => number;
}

/** Verified records from the realm schema: the founded kingdom and the person's deed evidence in it. */
export function createRealmLookRecords(options: RealmLookRecordsOptions): LookRecords {
  const { pool, origin, verifier } = options, now = options.now ?? Date.now;
  return {
    async entitlements(personId: PersonId, kingdomId: KingdomId): Promise<LookRecordsResult> {
      const result = await pool.query<{ origin: string; evidence: string | null }>(`
        SELECT h.origin, (SELECT d.evidence FROM realm_deeds d WHERE d.kingdom_id = h.kingdom_id AND d.person_id = $2
          AND d.origin = h.origin AND d.status <> 'void' ORDER BY d.allocated_ms DESC LIMIT 1) AS evidence
        FROM realm_layout_heads h WHERE h.kingdom_id = $1`, [kingdomId, personId]);
      const row = result.rows[0];
      if (!row || row.origin !== origin) return { kind: 'unknown' };
      const colours = options.colours(kingdomId);
      if (!colours) return { kind: 'closed' };
      const at = now();
      let tenure: VerifiedTenure = { followedAt: null, subscribedMonths: null, records: [] };
      if (row.evidence) {
        // Records that no longer verify (a rotated key, another person's record) count as no record, never as tenure.
        try { tenure = verifier.verify(JSON.parse(row.evidence) as unknown[], { kingdomId, personId, now: at }); } catch { /* unverified */ }
      }
      const kingdom: EntitlementKingdom = { id: kingdomId, name: options.name(kingdomId) ?? UNNAMED_KINGDOM, colours };
      return { kind: 'records', entitlements: entitlementsFrom(tenure, kingdom, origin, at) };
    },
  };
}
