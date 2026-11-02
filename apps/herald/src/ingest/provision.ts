import {
  AppTokenSession, ConduitShardConnection, EventSubAdmin, type FetchLike, HelixReader, isTwitchFailure, type SocketFactory,
} from '@chatdom/twitch';
import { randomBytes } from 'node:crypto';
import { open, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { describe, HeraldAuthority } from '../auth/authority';
import type { HeraldConfig } from '../config';
import { planSubscriptions, reconcileSubscriptions, type SubscriptionCoverage } from './subscriptions';

export interface ProvisionOptions {
  readonly config: HeraldConfig;
  readonly createDevelopmentConduit: boolean;
  readonly print: (line: string) => void;
  readonly fetch?: FetchLike;
  readonly socketFactory?: SocketFactory;
  readonly eventSubUrl?: string;
  /** Records the new conduit ID in the nonsecret settings file. Replaced in tests. */
  readonly recordConduit?: (settingsFile: string, conduitId: string) => Promise<void>;
  readonly attachTimeoutMs?: number;
  /** Set when `HERALD_CONDUIT_ID` comes from the process environment rather than the settings file. */
  readonly conduitFromEnvironment?: boolean;
}

export type ProvisionStatus = 'complete' | 'incomplete' | 'no_conduit' | 'conduit_missing' | 'conduit_limit' | 'unauthorized' | 'unreachable';

export interface ProvisionOutcome {
  readonly status: ProvisionStatus;
  readonly conduitId: string | null;
  readonly created: boolean;
  readonly coverage: readonly SubscriptionCoverage[];
}

const COVERAGE_LINE: Readonly<Record<SubscriptionCoverage['state'], string>> = {
  enabled: 'enabled',
  unauthorized: 'not created: its grant is not verified (run check:auth)',
  missing_grant: 'refused by Twitch: a required grant is missing (run check:auth)',
  conflict: 'an identical subscription exists outside this conduit; left untouched',
  version_removed: 'Twitch has removed this version',
  limit_reached: 'refused: this client reached a subscription limit',
  disabled: 'disabled by Twitch',
  failed: 'not confirmed; run provision:source again',
  unknown: 'not checked',
};

/**
 * `provision:source`: reuse the configured conduit, or create exactly one development conduit when asked
 * explicitly and none is configured; make it a single-shard conduit; attach one outgoing WebSocket shard to
 * prove the transport; reconcile the seven subscriptions whose grants are verified. It never lists, selects,
 * changes or deletes any other conduit, and it never creates a subscription whose grant is not on record.
 */
export async function provisionSource(options: ProvisionOptions): Promise<ProvisionOutcome> {
  const { config, print } = options;
  const fetchImpl = options.fetch ?? fetch;
  const outcome = (status: ProvisionStatus, conduitId: string | null, created = false, coverage: readonly SubscriptionCoverage[] = []): ProvisionOutcome => ({ status, conduitId, created, coverage });
  print(`Herald source provisioning · ${config.channelLogin} · ${new Date().toISOString()}`);
  if (!config.credentials) {
    print('  the app credentials are not configured (run check:auth)');
    return outcome('unauthorized', null);
  }

  const tokens = new AppTokenSession({ clientId: config.credentials.clientId, clientSecret: config.credentials.clientSecret, fetch: fetchImpl });
  const helix = new HelixReader({ tokens, fetch: fetchImpl });
  const authority = new HeraldAuthority({ config, tokens, helix });
  const admin = new EventSubAdmin(helix.session);
  try {
    const report = await authority.start();
    const broadcasterId = report.accounts.broadcaster.id;
    const readerId = report.accounts.reader.id;
    if (report.appToken.state !== 'valid' || broadcasterId === null || readerId === null) {
      print('  the app token, the channel or the reader could not be resolved (run check:auth)');
      return outcome('unauthorized', config.conduitId);
    }

    let conduitId = config.conduitId;
    let created = false;
    if (conduitId) {
      try {
        await admin.getShards(conduitId);
        print('  conduit       configured and owned by this client');
        if (options.createDevelopmentConduit) print('                --create-development-conduit ignored: the configured conduit exists and is reused');
      } catch (error) {
        if (!isTwitchFailure(error, 'not_found')) {
          print(`  conduit       could not be checked: ${describe(error)}`);
          return outcome('unreachable', conduitId);
        }
        print('  conduit       the configured conduit does not exist or belongs to another client');
        print('                (Twitch deletes a conduit 72 hours after its last shard went down)');
        if (!options.createDevelopmentConduit) {
          print('  run provision:source -- --create-development-conduit to create a new development conduit');
          return outcome('conduit_missing', conduitId);
        }
        conduitId = null;
      }
    } else if (!options.createDevelopmentConduit) {
      print('  conduit       none configured');
      print('  run provision:source -- --create-development-conduit to create the development conduit');
      return outcome('no_conduit', null);
    }

    if (!conduitId) {
      if (options.conduitFromEnvironment) {
        print('  HERALD_CONDUIT_ID is set in the environment; unset it so the new conduit can be recorded');
        return outcome('conduit_missing', config.conduitId);
      }
      try {
        conduitId = (await admin.createConduit(1)).id;
      } catch (error) {
        if (isTwitchFailure(error, 'limit_reached')) {
          print('  conduit       this client already has its maximum number of conduits; nothing was created or changed');
          return outcome('conduit_limit', null);
        }
        print(`  conduit       could not be created: ${describe(error)}`);
        return outcome('unreachable', null);
      }
      created = true;
      await (options.recordConduit ?? recordConduitId)(config.settingsFile, conduitId);
      print(`  conduit       created ${conduitId} · recorded as HERALD_CONDUIT_ID in ${config.settingsFile}`);
    }

    // Get Conduit Shards lists only shards that have had a transport, so its length is not the shard count.
    // Setting the count is authoritative and idempotent: one shard, so nothing is routed to a shard nobody holds.
    await admin.setShardCount(conduitId, 1);
    print('  conduit       one shard (shard 0)');

    const attached = await attachOnce({ admin, conduitId, timeoutMs: options.attachTimeoutMs ?? 30_000, ...pick(options) });
    print(`  shard 0       ${attached === 'attached' ? 'attached to a fresh WebSocket session and enabled' : `not attached (${attached})`}`);
    if (attached === 'conduit_missing') return outcome('conduit_missing', conduitId, created);

    const plans = planSubscriptions({ broadcasterId, readerId, clientId: config.credentials.clientId });
    const result = await reconcileSubscriptions({ admin, conduitId, plans, authorized: capability => authority.available(capability) });
    print('');
    print('Subscriptions');
    for (const entry of result.coverage) {
      const mark = entry.state === 'enabled' ? '✓' : '✗';
      print(`  ${mark} ${entry.key.padEnd(34)} ${COVERAGE_LINE[entry.state]}${entry.reason ? ` (${entry.reason})` : ''}`);
    }
    if (result.created + result.deleted > 0) print(`  ${result.created} created, ${result.deleted} stale removed on this conduit`);
    if (result.unexpected > 0) print(`  ${result.unexpected} other subscription(s) on this conduit match nothing Herald reads; left untouched`);
    const complete = attached === 'attached' && result.coverage.every(entry => entry.state === 'enabled');
    print('');
    print(complete
      ? 'The source is provisioned. pnpm --filter @chatdom/herald dev attaches the shard and publishes.'
      : 'The source is not fully provisioned. Missing grants: run check:auth for the setup path, then provision:source again.');
    return outcome(complete ? 'complete' : 'incomplete', conduitId, created, result.coverage);
  } finally {
    authority.stop();
    tokens.close();
  }
}

function pick(options: ProvisionOptions): { socketFactory?: SocketFactory; url?: string } {
  return { ...(options.socketFactory ? { socketFactory: options.socketFactory } : {}), ...(options.eventSubUrl ? { url: options.eventSubUrl } : {}) };
}

/** Opens one session, assigns it to shard 0 and closes it again. Twitch keeps the subscriptions. */
function attachOnce(options: { admin: EventSubAdmin; conduitId: string; timeoutMs: number; socketFactory?: SocketFactory; url?: string }): Promise<'attached' | 'conduit_missing' | string> {
  return new Promise(resolve => {
    let last = 'timeout';
    const finish = (result: string) => {
      clearTimeout(timer);
      shard.stop();
      resolve(result);
    };
    const shard = new ConduitShardConnection({
      admin: options.admin, conduitId: options.conduitId,
      listener: {
        attached: () => finish('attached'),
        detached: reason => {
          last = reason;
        },
        // Provisioning reads nothing: deliveries that arrive meanwhile are dropped unread.
        frame: () => undefined,
        fatal: () => finish('conduit_missing'),
      },
      ...(options.socketFactory ? { socketFactory: options.socketFactory } : {}),
      ...(options.url ? { url: options.url } : {}),
    });
    const timer = setTimeout(() => finish(last), options.timeoutMs);
    shard.start();
  });
}

/**
 * Writes `HERALD_CONDUIT_ID=<id>` into the nonsecret settings file, replacing an earlier value. The file is
 * rewritten atomically and stays owner-only.
 */
export async function recordConduitId(settingsFile: string, conduitId: string): Promise<void> {
  let text = '';
  try {
    text = await readFile(settingsFile, 'utf8');
  } catch (error) {
    if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  const lines = text.split('\n').filter((line, index, all) => !(index === all.length - 1 && line === ''));
  const kept = lines.filter(line => !/^\s*HERALD_CONDUIT_ID\s*=/.test(line));
  kept.push(`HERALD_CONDUIT_ID=${conduitId}`);
  const temp = join(dirname(settingsFile), `.herald-settings-${randomBytes(6).toString('hex')}.tmp`);
  const handle = await open(temp, 'wx', 0o600);
  try {
    await handle.writeFile(`${kept.join('\n')}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temp, settingsFile);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}
