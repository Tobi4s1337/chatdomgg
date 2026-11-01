import { createGrowthHome } from '@chatdom/content/growth-homes';
import { assembleForge, checkForge, createNativeForgeHost, findForgeSockets, forgeStyleKit } from '@chatdom/forge';
import { HomeTierSchema, type HomeTier } from '@chatdom/shared';
import type { RealmDomainCommand, RealmOwnedHome, RealmPrivateState } from '@chatdom/shared/realm';
import type { SettlementHome } from '@chatdom/world';
import type { DurableKingdom, RealmDatabase } from '../persistence';
import { describeStorageFailure } from '../persistence/database';
import { canonicalJson, digestOf } from '../persistence/codec';
import type { RealmCommitGuard } from '../persistence/postgres-repository';
import { forgeHomeDigest } from '../wiring/forge';

type NativeGrowth = Extract<RealmDomainCommand, { type: 'home.growNative' }>;
type Plan = { readonly kind: 'ready'; readonly command: NativeGrowth }
  | { readonly kind: 'held'; readonly reason: 'no-home' | 'unearned' | 'custom-home' | 'unsafe-part' | 'invalid-deed' | 'active-forge' };
interface InstalledDeed {
  readonly receipt: string; readonly person_id: string; readonly kingdom_id: string; readonly origin: string;
  readonly layout_revision: string; readonly plot_id: string; readonly slot: number; readonly status: string; readonly placement: string;
}
const deedColumns = 'receipt, person_id, kingdom_id, origin, layout_revision, plot_id, slot, status, placement';
type NativeRevision = 'original' | 'emberfold-v2';
const generated = new Map<string, { readonly blueprint: RealmOwnedHome['blueprint']; readonly digest: string; readonly bytes: string }>();

function native(placement: SettlementHome, tier: HomeTier, revision: NativeRevision) {
  const key = canonicalJson({ style: placement.style, variant: placement.variant, tier, revision });
  const cached = generated.get(key);
  if (cached) return cached;
  const blueprint = revision === 'emberfold-v2' ? createGrowthHome('emberfold', tier)
    : createNativeForgeHost({ ...placement, tier }).blueprint;
  const value = { blueprint, digest: forgeHomeDigest(blueprint), bytes: canonicalJson(blueprint) };
  generated.set(key, value);
  if (generated.size > 64) generated.delete(generated.keys().next().value!);
  return value;
}

function targetRevision(placement: SettlementHome): NativeRevision {
  return placement.style === 'hearth' && placement.variant === 0 ? 'emberfold-v2' : 'original';
}

/** Both authored catalogues remain recognizable; an id or native-looking revision alone grants no replacement. */
function acceptedSources(placement: SettlementHome, tier: HomeTier) {
  const original = native(placement, tier, 'original');
  return targetRevision(placement) === 'original' ? [original] : [original, native(placement, tier, 'emberfold-v2')];
}

/** Pure candidate from current earned state and immutable deed geometry. Custom bytes never get replaced. */
export function planNativeHomeGrowth(state: RealmPrivateState, homeId: string, placement: SettlementHome, now = state.growth?.asOf ?? 0): Plan {
  const home = Object.hasOwn(state.homes, homeId) ? state.homes[homeId] : undefined;
  if (!home) return { kind: 'held', reason: 'no-home' };
  const earned = state.growth?.citizens[home.ownerId]?.home;
  if (!earned || earned.plotId !== homeId || earned.stage === 'tent') return { kind: 'held', reason: 'unearned' };
  const tier = HomeTierSchema.safeParse(earned.stage);
  if (!tier.success) return { kind: 'held', reason: 'unearned' };
  try {
    if (placement.slot !== home.slot || placement.style !== home.family || !HomeTierSchema.safeParse(placement.tier).success) {
      return { kind: 'held', reason: 'invalid-deed' };
    }
    const bytes = canonicalJson(home.blueprint);
    const fromTier = HomeTierSchema.options.find(candidate => acceptedSources(placement, candidate)
      .some(expected => expected.digest === home.digest && expected.bytes === bytes));
    if (!fromTier) return { kind: 'held', reason: 'custom-home' };
    if (HomeTierSchema.options.indexOf(fromTier) < HomeTierSchema.options.indexOf(placement.tier)) return { kind: 'held', reason: 'invalid-deed' };
    if (HomeTierSchema.options.indexOf(tier.data) <= HomeTierSchema.options.indexOf(fromTier)) return { kind: 'held', reason: 'unearned' };
    if (Object.values(state.reservations).some(record => record.homeId === homeId && record.reservation.expiresAt > now)) {
      return { kind: 'held', reason: 'active-forge' };
    }
    // Existing homes keep their canonical bytes until another tier is earned; there is no same-tier refit.
    const target = native(placement, tier.data, targetRevision(placement)), attachments: NativeGrowth['attachments'][number][] = [];
    const fitted: Record<string, string> = {}, existing = Object.values(home.attachments);
    if (new Set(existing).size !== existing.length) return { kind: 'held', reason: 'unsafe-part' };
    const sockets = existing.length ? findForgeSockets(target.blueprint) : [], kit = forgeStyleKit(home.family);
    for (const id of existing) {
      const part = Object.hasOwn(state.attachments, id) ? state.attachments[id] : undefined;
      if (!part?.attached || part.homeId !== home.id || part.ownerId !== home.ownerId
        || part.attachment.id !== id || part.attachment.family !== home.family
        || part.attachment.slot !== home.slot || part.attachment.kingdomId !== state.kingdomId
        || part.attachment.kitId !== kit.id || part.attachment.kitRevision !== kit.revision
        || (part.attachment.hostProfile ?? 'street-home') !== 'street-home') {
        return { kind: 'held', reason: 'unsafe-part' };
      }
      const socket = sockets.find(candidate => candidate.kind === part.attachment.draft.plan.kind && !Object.hasOwn(fitted, candidate.id));
      if (!socket) return { kind: 'held', reason: 'unsafe-part' };
      checkForge(assembleForge(part.attachment.draft.plan, kit, socket), target.blueprint);
      fitted[socket.id] = id;
      attachments.push({ id, placement: { hostId: socket.hostId, hostFingerprint: socket.hostFingerprint, socketId: socket.id, origin: socket.origin } });
    }
    return { kind: 'ready', command: { type: 'home.growNative', homeId, expectedRevision: home.revision, fromTier, tier: tier.data,
      home: { ...home, blueprint: target.blueprint, digest: target.digest,
        revision: `native-growth:${digestOf({ previous: home.revision, digest: target.digest, attachments })}`, attachments: fitted },
      approvalReceipt: `native-growth:${target.digest}`, attachments } };
  } catch {
    return { kind: 'held', reason: 'unsafe-part' };
  }
}

function deedPlacement(deed: InstalledDeed, state: RealmPrivateState, home: RealmOwnedHome): SettlementHome | null {
  if (deed.status !== 'installed' || deed.receipt !== home.allocationReceipt || deed.kingdom_id !== state.kingdomId
    || deed.origin !== state.origin || deed.person_id !== home.ownerId || deed.plot_id !== home.id
    || deed.slot !== home.slot || deed.layout_revision !== home.layoutRevision) return null;
  try { return JSON.parse(deed.placement) as SettlementHome; } catch { return null; }
}

/** Re-plan under the same writer/deed transaction so intervening custom builds or Forge commits fence stale candidates. */
export const verifyNativeGrowth: RealmCommitGuard = async (tx, fact, prior) => {
  if (fact.body.type !== 'home.growNative') return 'ok';
  const home = Object.hasOwn(prior.homes, fact.body.homeId) ? prior.homes[fact.body.homeId] : undefined;
  if (!home) return 'conflict';
  const deed = (await tx.query<InstalledDeed>(`SELECT ${deedColumns} FROM realm_deeds WHERE receipt = $1 FOR UPDATE`, [home.allocationReceipt])).rows[0];
  const placement = deed && deedPlacement(deed, prior, home);
  if (!placement) return 'conflict';
  const expected = planNativeHomeGrowth(prior, home.id, placement, fact.committedAt);
  return expected.kind === 'ready' && canonicalJson(expected.command) === canonicalJson(fact.body) ? 'ok' : 'conflict';
};

/** Reconcile earned tiers on the already retained writer, even with no browser or fresh milestone delivery. */
export function createNativeHomeGrowth(options: { readonly db: Pick<RealmDatabase, 'query'>; readonly log?: (line: string) => void }) {
  return {
    attach(kingdom: DurableKingdom): () => void {
      let stopped = false, running = false;
      let examined: Pick<RealmPrivateState, 'growth' | 'homes' | 'attachments' | 'reservations'> | null = null, retry = false;
      let retryAt: number | null = null;
      const reconcile = async () => {
        if (stopped || running || !kingdom.current) return;
        const snapshot = kingdom.privateState;
        if (!retry && examined && examined.growth === snapshot.growth && examined.homes === snapshot.homes
          && examined.attachments === snapshot.attachments && examined.reservations === snapshot.reservations
          && (retryAt === null || kingdom.databaseNow() < retryAt)) return;
        running = true;
        retry = false;
        retryAt = null;
        try {
          const deeds = (await options.db.query<InstalledDeed>(
            `SELECT ${deedColumns} FROM realm_deeds WHERE kingdom_id = $1 AND origin = $2 AND status = 'installed'`,
            [kingdom.kingdomId, kingdom.origin])).rows;
          for (const deed of deeds) {
            if (stopped || !kingdom.current) break;
            const state = kingdom.privateState, home = Object.hasOwn(state.homes, deed.plot_id) ? state.homes[deed.plot_id] : undefined;
            const placement = home && deedPlacement(deed, state, home);
            if (!home || !placement) continue;
            const now = kingdom.databaseNow(), plan = planNativeHomeGrowth(state, home.id, placement, now);
            if (plan.kind !== 'ready') {
              if (plan.reason === 'active-forge') for (const record of Object.values(state.reservations)) {
                if (record.homeId === home.id && record.reservation.expiresAt > now) {
                  retryAt = Math.min(retryAt ?? Infinity, record.reservation.expiresAt);
                }
              }
              continue;
            }
            const outcome = await kingdom.execute(`growth:native:${digestOf(plan.command)}`, plan.command, 'allocation', { current: () => !stopped && kingdom.current });
            if (outcome.status !== 'committed') {
              retry = true;
              options.log?.(`[growth] Native home growth remains ${outcome.status}.`);
            }
          }
          // Retain the starting references: commits during the scan may expose another home that was
          // absent from the deed query. One follow-up scan settles those changes, then idle ticks do no SQL.
          examined = snapshot;
        } catch (error) {
          retry = true;
          options.log?.(`[growth] Native home reconciliation held: ${describeStorageFailure(error)}`);
        } finally { running = false; }
      };
      const timer = setInterval(() => void reconcile(), 1_000);
      timer.unref?.();
      const stop = () => { stopped = true; clearInterval(timer); off(); };
      const off = kingdom.onClosed(stop);
      queueMicrotask(() => void reconcile());
      return stop;
    },
  };
}
