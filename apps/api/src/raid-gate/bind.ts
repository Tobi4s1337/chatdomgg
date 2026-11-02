/**
 * The Raid Gate bound for real in the API process (RS11): realm-auth's session principal, the gate's Postgres
 * repository on the realm pool, Herald's raid authority for the Twitch side and the realm's own witnessed raid
 * ledger as the Atlas road ingress. `apps/api/src/main.ts` mounts it with one line.
 *
 * Environment (all optional; whatever is missing is told honestly, never stood in for):
 * - `HERALD_RAID_GATE_URL` + `HERALD_RAID_GATE_SECRET`: Herald's private raid authority. Without them the gate still
 *   opens, previews nothing it cannot check, and tells the monarch the Twitch connection is unknown.
 * - `RAID_GATE_RECOVER_MS`: recovery cadence (default 15 s; 0 off).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Pool } from 'pg';
import { RaidObservationLedger } from '../../../realm/src/raid-gate/observations';
import type { RealmAuthConfig } from '../realm-auth/config';
import { createHeraldRaidAuthority } from './herald-authority';
import { RaidGatePortError, type LiveChannels, type RaidGrants, type TargetDirectory, type WriteConsent } from './policy';
import { createRaidGateService, type RaidGateService } from './service';

export type RaidGateBinding = Readonly<{
  service: RaidGateService;
  /** What is bound, for the startup line and health. Names only, never a secret. */
  bound: Readonly<{ herald: boolean; roads: true; rooms: boolean }>;
}>;

/**
 * Twitch keeps no public classification the API could trust, and the Atlas's classification lives in its published
 * map (atlas-map owns it). Until the Atlas exposes a server read, every channel is `unknown` and permitted: the Atlas
 * finder already hides excluded channels, the gate refuses only `excluded`, and Twitch refuses a raid it would not
 * allow (Start a Raid answers 400/403, told plainly as refused).
 */
export function createUnclassifiedTargetDirectory(): TargetDirectory {
  return { read: async (from, target) => (from === target ? null : { classification: 'unknown', permitted: true }) };
}

/** No Herald: the grant is unknown, nothing is consented, and live state cannot be read (`unavailable`). */
function unboundTwitch(): Readonly<{ grants: RaidGrants; consent: WriteConsent; live: LiveChannels }> {
  return {
    grants: { read: async () => 'unknown' },
    consent: { read: async () => 'disabled' },
    live: { read: async () => { throw new RaidGatePortError('Herald\'s raid authority is not connected.'); } },
  };
}

export function bindRaidGate(input: Readonly<{
  pool: Pool; config: RealmAuthConfig; issuer: string; env?: NodeJS.ProcessEnv; clock?: () => number;
}>): RaidGateBinding {
  const env = input.env ?? process.env;
  const origin = input.config.mode;
  const clock = input.clock ?? Date.now;
  const heraldUrl = env.HERALD_RAID_GATE_URL?.trim();
  const heraldSecret = env.HERALD_RAID_GATE_SECRET ?? '';
  const herald = heraldUrl && heraldSecret ? createHeraldRaidAuthority({ url: heraldUrl, secret: heraldSecret, origin }) : null;
  const twitch = herald ?? unboundTwitch();
  const ledger = new RaidObservationLedger({
    pool: input.pool, origin, clock,
    // The API never records a raid: only verified ingress in the realm does. The ledger is used here for its road read.
    moment: async () => { throw new Error('The API does not record raid moments.'); },
  });
  const recover = Number(env.RAID_GATE_RECOVER_MS ?? '');
  const service = createRaidGateService({
    pool: input.pool, origin, issuer: input.issuer,
    sessionCookie: input.config.secureCookies ? '__Host-chatdom_session' : 'chatdom_session',
    publicOrigin: input.config.publicOrigin, origins: [new URL(input.config.publicOrigin).origin], clock,
    policyPorts: { live: twitch.live, grants: twitch.grants, consent: twitch.consent, directory: createUnclassifiedTargetDirectory() },
    raids: herald?.raids ?? null,
    roads: ledger.roads,
    rooms: null,
    ...(Number.isInteger(recover) && recover >= 0 && env.RAID_GATE_RECOVER_MS !== undefined ? { recoverEveryMs: recover } : {}),
    onRecovery: outcome => {
      if (outcome.kind === 'error') console.error('api: a Raid Gate recovery pass failed; it will retry');
      else console.info(`api: Raid Gate recovery ${Object.entries(outcome.report).filter(([, count]) => count > 0).map(([name, count]) => `${name} ${count}`).join(', ')}`);
    },
  });
  return { service, bound: { herald: herald !== null, roads: true, rooms: false } };
}

/** The one dispatch line for main: true when the request was the gate's. */
export async function serveRaidGate(binding: RaidGateBinding | null, request: IncomingMessage, response: ServerResponse): Promise<boolean> {
  if (!binding || !binding.service.matches(request.url)) return false;
  await binding.service.serve(request, response);
  return true;
}

const publicBindings = new WeakMap<Pool, RaidGateBinding>();

/**
 * For the public gateway (`apps/api/src/public/main.ts`, case `auth`), which runs its own dispatch: one binding per
 * pool, made on the first gate request. Answers false for any other route.
 */
export async function servePublicRaidGate(request: IncomingMessage, response: ServerResponse, options: Readonly<{ pool: Pool; config: RealmAuthConfig; issuer: string }>): Promise<boolean> {
  let binding = publicBindings.get(options.pool);
  if (!binding) {
    const path = (request.url ?? '').split(/[?#]/u)[0] ?? '';
    if (!/^\/api\/raid-gate\/[1-9][0-9]{0,31}$/u.test(path)) return false;
    binding = bindRaidGate(options);
    publicBindings.set(options.pool, binding);
  }
  return serveRaidGate(binding, request, response);
}
