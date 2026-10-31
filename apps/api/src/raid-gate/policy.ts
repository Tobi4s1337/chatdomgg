/**
 * The realm-backed `GatePolicy`. What the realm schema knows is read here: whether the principal's Chatdom session is
 * still current, whether the person is this channel's broadcaster by verified Twitch identity, and whether a
 * destination is a founded kingdom. What only main can answer (live state, the raid grant, write consent, the
 * Atlas's view of a destination) comes through the narrow ports below, all required. There is no fallback: a port
 * that cannot answer throws, and the application turns that into `unavailable`.
 */
import { kingdomForBroadcaster, KingdomIdSchema, type KingdomId } from '../../../../packages/shared/src/identity';
import { TWITCH_OIDC_ISSUER } from '../realm-auth/oidc';
import { SIMULATED_OIDC_PATH } from '../realm-auth/simulated-provider';
import type { GateClassification, GatePrincipal } from './contracts';
import type { GatePolicy, SourceStanding, TargetVerdict } from './ports';
import type { RecordOrigin } from './repository';
import type { SqlQueryable } from './session';

/**
 * Whether channels are broadcasting right now. The map holds an entry for every requested ID; a missing entry is a
 * failure, never "offline". Main binds Helix Get Streams (`createHelixLiveChannels`) or its own fresher source.
 */
export interface LiveChannels {
  read(kingdomIds: readonly KingdomId[], signal: AbortSignal): Promise<ReadonlyMap<KingdomId, boolean>>;
}

/**
 * The source broadcaster's `channel:manage:raids` user grant, as main's authorized Twitch transport holds it:
 * `granted` usable now, `missing` never connected, `revoked` withdrawn or refused by Twitch, `unknown` the token
 * store could not tell. Never inferred from a client claim.
 */
export interface RaidGrants {
  read(kingdomId: KingdomId, signal: AbortSignal): Promise<'granted' | 'missing' | 'revoked' | 'unknown'>;
}

/** The monarch's own consent for Chatdom to act on Twitch for this channel at all. */
export interface WriteConsent {
  read(kingdomId: KingdomId, signal: AbortSignal): Promise<'enabled' | 'disabled'>;
}

/**
 * The destination as the Atlas sees it: its public classification, and whether this source may raid it (destination
 * moderation, bans, exclusions). Null when the directory does not know the channel; such a target is not offered.
 * Main binds the Atlas's channel directory.
 */
export interface TargetDirectory {
  read(from: KingdomId, target: KingdomId, signal: AbortSignal): Promise<Readonly<{ classification: GateClassification; permitted: boolean }> | null>;
}

export type RealmGatePolicyDeps = Readonly<{
  pool: SqlQueryable;
  origin: RecordOrigin;
  /**
   * The identity issuer realm-auth records for this deployment's sign-ins (`provider.issuer`): Twitch's for a live
   * gate, the SIMULATED provider's for a simulated one. Only a person recorded under it can be a broadcaster.
   */
  issuer: string;
  live: LiveChannels;
  grants: RaidGrants;
  consent: WriteConsent;
  directory: TargetDirectory;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const GRANTS = new Set(['granted', 'missing', 'revoked', 'unknown']);
const CONSENTS = new Set(['enabled', 'disabled']);
const CLASSIFICATIONS = new Set<GateClassification>(['unknown', 'general', 'mature', 'excluded']);

/**
 * Anyone who is not the verified broadcaster of a current session: the Twitch side of the source is not read for
 * them, and every field holds the value that grants nothing. The application uses those fields only for the monarch.
 */
const GRANTS_NOTHING = (session: SourceStanding['session']): SourceStanding =>
  ({ session, broadcaster: false, live: false, raids: 'unknown', actions: 'disabled' });

export class RaidGatePortError extends Error {
  constructor(message: string) { super(message); this.name = 'RaidGatePortError'; }
}

async function liveOf(live: LiveChannels, kingdomId: KingdomId, signal: AbortSignal): Promise<boolean> {
  const value = (await live.read([kingdomId], signal)).get(kingdomId);
  if (typeof value !== 'boolean') throw new RaidGatePortError('The live channel port did not answer for the requested channel.');
  return value;
}

function checkIssuer(origin: RecordOrigin, issuer: string): void {
  const twitch = issuer === TWITCH_OIDC_ISSUER;
  const simulated = !twitch && /^https?:\/\/[^/]+$/.test(issuer.slice(0, -SIMULATED_OIDC_PATH.length)) && issuer.endsWith(SIMULATED_OIDC_PATH);
  if (origin === 'live' ? !twitch : !simulated) {
    throw new Error(origin === 'live'
      ? 'A live Raid Gate recognises broadcasters signed in through Twitch only.'
      : 'A SIMULATED Raid Gate recognises broadcasters of the SIMULATED sign-in provider only.');
  }
}

export function createRealmGatePolicy(deps: RealmGatePolicyDeps): GatePolicy {
  const { pool, origin, issuer, live, grants, consent, directory } = deps;
  if (origin !== 'live' && origin !== 'simulated') throw new Error('The Raid Gate origin is live or simulated.');
  checkIssuer(origin, issuer);
  for (const [name, port] of Object.entries({ live, grants, consent, directory })) {
    if (typeof port?.read !== 'function') throw new Error(`The Raid Gate policy needs its ${name} port.`);
  }

  return {
    async readStanding(principal: GatePrincipal, _now: number, signal: AbortSignal): Promise<SourceStanding> {
      signal.throwIfAborted();
      if (!UUID.test(principal.sessionId)) return GRANTS_NOTHING('ended');
      const result = await pool.query(`
        select
          exists (select 1 from realm_sessions s where s.session_id = $1::uuid and s.person_id = $2 and s.origin = $3
            and s.revoked_at is null and s.expires_at > now()) as current,
          exists (select 1 from realm_persons p where p.person_id = $2 and p.origin = $3 and p.identity_issuer = $4) as verified`,
      [principal.sessionId, principal.personId, origin, issuer]);
      const row = result.rows[0] as { current?: unknown; verified?: unknown } | undefined;
      if (!row) throw new RaidGatePortError('The session check returned no row.');
      if (row.current !== true) return GRANTS_NOTHING('ended');
      const broadcaster = row.verified === true && kingdomForBroadcaster(principal.personId) === principal.sourceKingdomId;
      if (!broadcaster) return GRANTS_NOTHING('current');
      const kingdomId = principal.sourceKingdomId;
      const [isLive, raids, actions] = await Promise.all([liveOf(live, kingdomId, signal), grants.read(kingdomId, signal), consent.read(kingdomId, signal)]);
      if (!GRANTS.has(raids)) throw new RaidGatePortError('The raid grant port answered outside its contract.');
      if (!CONSENTS.has(actions)) throw new RaidGatePortError('The write consent port answered outside its contract.');
      return { session: 'current', broadcaster: true, live: isLive, raids, actions };
    },

    async readTarget(from: KingdomId, target: KingdomId, _now: number, signal: AbortSignal): Promise<TargetVerdict | null> {
      signal.throwIfAborted();
      if (!KingdomIdSchema.safeParse(target).success || from === target) return null;
      const known = await directory.read(from, target, signal);
      if (known === null) return null;
      if (typeof known !== 'object' || !CLASSIFICATIONS.has(known.classification) || typeof known.permitted !== 'boolean') {
        throw new RaidGatePortError('The target directory answered outside its contract.');
      }
      const [isLive, founded] = await Promise.all([
        liveOf(live, target, signal),
        // A kingdom is founded once Genesis adopted its layout. A realm row alone can come from ingest and is not land.
        pool.query(`select exists (select 1 from realm_layout_heads h join realm_kingdoms k on k.kingdom_id = h.kingdom_id
          where h.kingdom_id = $1 and h.origin = $2 and k.origin = $2) as founded`, [target, origin]),
      ]);
      const row = founded.rows[0] as { founded?: unknown } | undefined;
      if (typeof row?.founded !== 'boolean') throw new RaidGatePortError('The founded check returned no answer.');
      return { target: { kingdomId: target, founded: row.founded, live: isLive, classification: known.classification }, permitted: known.permitted };
    },
  };
}

/** The part of `packages/twitch`'s `HelixReader` (app-token Get Streams) that `createHelixLiveChannels` uses. */
export interface HelixStreamsReader {
  getStreams(userIds: readonly string[], options?: { readonly signal?: AbortSignal | undefined }): Promise<ReadonlyArray<{ readonly userId: string; readonly type: string }>>;
}

/** Get Streams takes at most 100 user IDs per request. */
export const HELIX_STREAMS_BATCH = 100;

/**
 * `LiveChannels` over Helix Get Streams with the app token. A channel is live only when Twitch lists a stream of type
 * `live` for it; absence from a successful answer is offline. Any failed batch fails the whole read.
 */
export function createHelixLiveChannels(reader: HelixStreamsReader): LiveChannels {
  return {
    async read(kingdomIds, signal) {
      const ids = [...new Set(kingdomIds)];
      const batches: KingdomId[][] = [];
      for (let at = 0; at < ids.length; at += HELIX_STREAMS_BATCH) batches.push(ids.slice(at, at + HELIX_STREAMS_BATCH));
      const answers = await Promise.all(batches.map(batch => reader.getStreams(batch, { signal })));
      const live = new Set(answers.flat().filter(stream => stream.type === 'live').map(stream => stream.userId));
      return new Map(ids.map(id => [id, live.has(id)]));
    },
  };
}
