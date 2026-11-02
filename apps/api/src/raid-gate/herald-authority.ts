/**
 * The Raid Gate's Twitch side, over Herald's private raid authority (`raid-authority-contracts.ts`). Herald alone holds
 * the source broadcaster's `channel:manage:raids` grant; this client carries an outbox key, never a token.
 *
 * One client implements four ports: `AuthorizedRaidTransport` (start, cancel, reconcile), `RaidGrants`, `WriteConsent`
 * and `LiveChannels`. Every write answer Herald cannot vouch for, and every transport failure after a write may have
 * left, is `unknown`: the gate then reconciles and never sends that key again.
 */
import type { KingdomId } from '../../../../packages/shared/src/identity';
import type { LiveChannels, RaidGrants, WriteConsent } from './policy';
import { RaidGatePortError } from './policy';
import type { AuthorizedRaidTransport, RaidWrite, RaidWriteOutcome } from './ports';
import {
  RAID_AUTHORITY_LIVE_BATCH, RAID_AUTHORITY_ROUTE, RaidAuthorityLiveReplySchema, RaidAuthorityStandingReplySchema,
  RaidAuthorityWriteReplySchema, type RaidAuthorityRequest, type RaidAuthorityStandingReply,
} from './raid-authority-contracts';
import type { RecordOrigin } from './repository';

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type HeraldRaidAuthorityOptions = Readonly<{
  /** Herald's private base URL, for example `http://127.0.0.1:5194`. */
  url: string;
  /** `HERALD_RAID_GATE_SECRET`, shared with Herald. Never logged. */
  secret: string;
  origin: RecordOrigin;
  fetch?: FetchLike;
  /** A read (standing, live) gets this long. */
  readTimeoutMs?: number;
  /** A write gets this long; Herald's own Twitch call is shorter, so a slow answer still arrives. */
  writeTimeoutMs?: number;
  /** Standing is asked on every gate view; it is held this long. */
  standingCacheMs?: number;
}>;

export interface HeraldRaidAuthority {
  readonly raids: AuthorizedRaidTransport;
  readonly grants: RaidGrants;
  readonly consent: WriteConsent;
  readonly live: LiveChannels;
}

const REPLY_LIMIT = 64 * 1024;

async function readJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new RaidGatePortError('Herald answered without a body.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > REPLY_LIMIT) { await reader.cancel(); throw new RaidGatePortError('Herald answered with too much.'); }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

export function createHeraldRaidAuthority(options: HeraldRaidAuthorityOptions): HeraldRaidAuthority {
  const base = new URL(options.url);
  if (base.protocol !== 'http:' && base.protocol !== 'https:') throw new Error('Herald\'s raid authority needs an http(s) URL.');
  if (!options.secret || options.secret.length < 16) throw new Error('Herald\'s raid authority needs HERALD_RAID_GATE_SECRET.');
  const target = new URL(RAID_AUTHORITY_ROUTE, base).toString();
  const call = options.fetch ?? ((input, init) => fetch(input, init));
  const { origin } = options;
  const readTimeoutMs = options.readTimeoutMs ?? 5_000;
  const writeTimeoutMs = options.writeTimeoutMs ?? 12_000;
  const standingCacheMs = options.standingCacheMs ?? 5_000;

  async function post(body: RaidAuthorityRequest, timeoutMs: number, signal: AbortSignal | null): Promise<Response> {
    const deadline = AbortSignal.timeout(timeoutMs);
    return call(target, {
      method: 'POST', redirect: 'error', cache: 'no-store',
      signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
      headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${options.secret}` },
      body: JSON.stringify(body),
    });
  }

  async function read<T>(body: RaidAuthorityRequest, parse: (raw: unknown) => T, signal: AbortSignal): Promise<T> {
    const response = await post(body, readTimeoutMs, signal);
    if (!response.ok) { await response.body?.cancel(); throw new RaidGatePortError(`Herald's raid authority answered ${response.status}.`); }
    return parse(await readJson(response));
  }

  /**
   * One write. The caller's signal is deliberately not passed on: once the request may have reached Herald, only its
   * answer (or its absence, as `unknown`) settles the key, and reconcile asks Herald's record afterwards.
   */
  async function write(op: 'start' | 'cancel' | 'reconcile', raid: RaidWrite, signal: AbortSignal): Promise<RaidWriteOutcome> {
    signal.throwIfAborted();
    try {
      const response = await post({ version: 1, origin, op, write: { key: raid.key, requestId: raid.requestId, from: raid.from, to: raid.to } }, writeTimeoutMs, null);
      if (!response.ok) {
        await response.body?.cancel();
        // A refusal before Herald read the command sent nothing to Twitch, but the gate cannot tell which refusal it
        // was from here without trusting a status code; a reconcile asks Herald's ledger, which is the truth.
        return { kind: 'unknown' };
      }
      const reply = RaidAuthorityWriteReplySchema.parse(await readJson(response));
      if (reply.origin !== origin || reply.key !== raid.key) return { kind: 'unknown' };
      return reply.outcome;
    } catch {
      return { kind: 'unknown' };
    }
  }

  let standing: { kingdomId: KingdomId; at: number; value: Promise<RaidAuthorityStandingReply> } | null = null;
  function readStanding(kingdomId: KingdomId, signal: AbortSignal): Promise<RaidAuthorityStandingReply> {
    const now = Date.now();
    if (standing && standing.kingdomId === kingdomId && now - standing.at < standingCacheMs) return standing.value;
    const value = read({ version: 1, origin, op: 'standing', kingdomId }, raw => {
      const reply = RaidAuthorityStandingReplySchema.parse(raw);
      if (reply.origin !== origin || reply.kingdomId !== kingdomId) throw new RaidGatePortError('Herald answered for another kingdom.');
      return reply;
    }, signal);
    const entry = { kingdomId, at: now, value };
    standing = entry;
    value.catch(() => { if (standing === entry) standing = null; });
    return value;
  }

  return {
    raids: {
      origin,
      start: (raid, signal) => write('start', raid, signal),
      cancel: (raid, signal) => write('cancel', raid, signal),
      reconcile: (raid, signal) => write('reconcile', raid, signal),
    },
    grants: { read: async (kingdomId, signal) => (await readStanding(kingdomId, signal)).grant },
    consent: { read: async (kingdomId, signal) => (await readStanding(kingdomId, signal)).consent },
    live: {
      async read(kingdomIds, signal) {
        const ids = [...new Set(kingdomIds)];
        const answers = new Map<KingdomId, boolean>();
        for (let at = 0; at < ids.length; at += RAID_AUTHORITY_LIVE_BATCH) {
          const batch = ids.slice(at, at + RAID_AUTHORITY_LIVE_BATCH);
          const reply = await read({ version: 1, origin, op: 'live', kingdomIds: batch }, raw => RaidAuthorityLiveReplySchema.parse(raw), signal);
          if (reply.origin !== origin) throw new RaidGatePortError('Herald answered for another origin.');
          for (const id of batch) {
            const live = reply.live[id];
            if (typeof live !== 'boolean') throw new RaidGatePortError('Herald did not answer for a requested channel.');
            answers.set(id, live);
          }
        }
        return answers;
      },
    },
  };
}
