import { KingdomIdSchema } from '@chatdom/shared';
import { AppTokenSession, EventSubAdmin, type FetchLike, HelixReader, type SocketFactory } from '@chatdom/twitch';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { type AuthReport, HeraldAuthority } from '../auth/authority';
import type { Capability } from '../auth/grants';
import type { HeraldConfig } from '../config';
import { DeliveryRuntime } from '../ingest/runtime';
import { Reconciler } from '../observe/reconcile';
import { FileBindingStore } from './bindings';
import { presentKingdom } from './kingdom';
import type { ForgeCommandSink } from '../forge/commands';
import { startPresenceServer, type PresenceServer, type SourceHost, type UnstartedHealth } from './server';
import { PresenceSource } from './source';
import type { RealmDelivery } from '../realm-delivery/delivery';
import { RealmMomentObservationSchema } from '@chatdom/shared/realm';
import { streamNotice } from '../ingest/spectacles';
import { providerToken } from '../twitch-moments/credit';

export interface LiveSourceHandle {
  readonly server: PresenceServer;
  readonly source: PresenceSource | null;
  stop(): Promise<void>;
}

/** The capabilities a live source cannot publish without: chat and its cleanup are one delivery family. */
const REQUIRED: readonly Capability[] = ['chat'];
/** Grants a running source waits for. While one is missing it is reread each minute, not only hourly. */
const AWAITED: readonly Capability[] = ['chat', 'chatters', 'bits', 'hype', 'follows', 'rewards', 'polls'];
const GRANT_READY: Partial<Record<Capability, string>> = { chat: 'attaching chat delivery', chatters: 'sweeping Chatters', bits: 'enabling cheers and Power-ups', hype: 'enabling hype trains',
  follows: 'enabling follows', rewards: 'enabling kingdom rewards', polls: 'enabling polls and decrees' };
const GRANT_MISSING: Partial<Record<Capability, string>> = { chat: 'not publishing', chatters: 'not sweeping Chatters', bits: 'cheers and Power-ups unavailable', hype: 'hype trains unavailable',
  follows: 'follows unavailable', rewards: 'kingdom rewards unavailable', polls: 'polls and decrees unavailable' };
const GRANT_RECHECK_MS = 60_000;

/**
 * `dev`: the real source for the configured channel. It resolves the broadcaster's numeric ID (the
 * kingdom), opens the durable binding table, attaches the configured conduit's shard and reconciles its
 * subscriptions. The source publishes only while chat delivery and its cleanup coverage are complete; until
 * then subscribers are refused and health says exactly why.
 */
export async function startLiveSource(options: {
  readonly config: HeraldConfig;
  readonly print: (line: string) => void;
  readonly port?: number;
  /** Main's trusted Forge application. Omitted until its own authority and judging path is connected. */
  readonly forge?: ForgeCommandSink;
  readonly realm?: RealmDelivery;
  /**
   * Where Twitch is. Production uses the real endpoints; the acceptance suite runs this same composition
   * against SIMULATED local fakes, so nothing in between is a test-only path.
   */
  readonly twitch?: {
    readonly fetch?: FetchLike;
    readonly socketFactory?: SocketFactory;
    readonly eventsubUrl?: string;
    readonly random?: () => number;
  };
  /** Workspace root the binding table must stay out of; found from the working directory by default. */
  readonly repositoryRoot?: string | null;
}): Promise<LiveSourceHandle> {
  const { config, print } = options;
  let host: SourceHost = unstarted('configured', 'starting', []);
  const server = await startPresenceServer({ host: () => host, port: options.port ?? options.config.port });
  print(`Herald source · LIVE · ${config.channelLogin} · http://127.0.0.1:${server.port}/presence-data/stream`);

  let tokens: AppTokenSession | null = null;
  let authority: HeraldAuthority | null = null;
  let source: PresenceSource | null = null;
  let runtime: DeliveryRuntime | null = null;
  let reconciler: Reconciler | null = null;
  let grantWatch: ReturnType<typeof setInterval> | null = null;
  const stop = async () => {
    if (grantWatch) clearInterval(grantWatch);
    runtime?.stop();
    reconciler?.stop();
    authority?.stop();
    tokens?.close();
    await source?.close();
    await server.close();
  };

  if (!config.credentials) {
    host = unstarted('unauthorized', 'app_credentials_missing', ['app credentials']);
    print('  not publishing: the app credentials are not configured (run check:auth)');
    return { server, source, stop };
  }
  const twitchFetch = options.twitch?.fetch ?? fetch;
  tokens = new AppTokenSession({ clientId: config.credentials.clientId, clientSecret: config.credentials.clientSecret, fetch: twitchFetch });
  const helix = new HelixReader({ tokens, fetch: twitchFetch });
  authority = new HeraldAuthority({ config, tokens, helix });
  let report: AuthReport;
  try {
    report = await authority.start();
  } catch {
    host = unstarted('unauthorized', 'authorization_unreadable', []);
    print('  not publishing: authorization could not be read (run check:auth)');
    return { server, source, stop };
  }
  const broadcaster = report.accounts.broadcaster;
  const kingdomId = broadcaster.id === null ? null : KingdomIdSchema.safeParse(broadcaster.id);
  if (!kingdomId?.success) {
    host = unstarted('unauthorized', 'channel_unresolved', []);
    print(`  not publishing: ${config.channelLogin} could not be resolved to a broadcaster ID (run check:auth)`);
    return { server, source, stop };
  }

  const kingdom = presentKingdom(config.kingdom);
  source = new PresenceSource({
    kingdomId: kingdomId.data, origin: 'live', slots: kingdom.slots,
    store: new FileBindingStore({
      dataDir: config.dataDir, kingdomId: kingdomId.data,
      repositoryRoot: options.repositoryRoot === undefined ? repositoryRoot() : options.repositoryRoot,
    }),
    ...(options.realm ? { realm: options.realm } : {}),
  });
  const live = source;
  const health = () => ({ ...live.health(), ...(options.realm ? { realm: options.realm.health() } : {}) });
  host = { get current() { return live.current; }, subscribe: listener => live.subscribe(listener), health };
  try {
    await live.open();
  } catch {
    print(`  not publishing: the presence binding table is ${live.health().storage.fault ?? 'unusable'}; no slot was changed`);
    return { server, source, stop };
  }
  print(`  kingdom ${kingdomId.data} · ${kingdom.config.tier} ${kingdom.config.firstYear}–${kingdom.config.year} · ${kingdom.slots.length} home slots · bindings kept in ${config.dataDir}`);

  // Stream state needs only the app token, so it is observed even while chat delivery is not authorized.
  const observed = new Reconciler({ kingdomId: kingdomId.data, helix, authority, source: live, log: line => print(`  ${line}`),
    reconciled: (change, startedAt) => {
      if (!options.realm) return;
      const evidence = RealmMomentObservationSchema.safeParse({ version: 1, kingdomId: kingdomId.data, origin: 'live',
        id: providerToken('reconcile', `${change.live ? change.streamId : 'offline'}.${change.at}`),
        occurredAt: change.at, receivedAt: Math.floor(Date.now()), notice: streamNotice(change.live, change.live ? change.streamId : null, startedAt) });
      if (evidence.success) void options.realm.moment(evidence.data).catch(() => undefined);
    } });
  reconciler = observed;
  host = { get current() { return live.current; }, subscribe: listener => live.subscribe(listener), health: () => ({ ...health(), observed: observed.health() }) };
  const startup = observed.start();

  const readerId = report.accounts.reader.id;
  if (!config.conduitId) {
    live.setAvailable(false, 'conduit_unconfigured');
    print('  not publishing: no conduit is configured (run provision:source -- --create-development-conduit)');
  } else if (readerId === null) {
    live.setAvailable(false, 'unauthorized');
    print('  not publishing: the reader account is not designated or not found (run check:auth)');
  } else {
    runtime = new DeliveryRuntime({
      conduitId: config.conduitId, clientId: config.credentials.clientId, broadcasterId: kingdomId.data, readerId,
      admin: new EventSubAdmin(helix.session), authority, source: live, log: line => print(`  ${line}`),
      ...(options.forge ? { forge: {run:options.forge, broadcast:observed.tracker} } : {}),
      ...(options.realm ? { realm: options.realm } : {}),
      ...(options.twitch?.socketFactory ? { socketFactory: options.twitch.socketFactory } : {}),
      ...(options.twitch?.eventsubUrl ? { url: options.twitch.eventsubUrl } : {}),
      ...(options.twitch?.random ? { random: options.twitch.random } : {}),
      stream: observation => observed.tracker.push(observation),
      reconcile: after => after === 'start' ? startup : observed.afterGap(),
    });
    const delivery = runtime;
    host = {
      get current() { return live.current; }, subscribe: listener => live.subscribe(listener),
      health: () => ({ ...health(), observed: observed.health(), delivery: delivery.health() }),
    };
    const conduit = await delivery.start();
    if (conduit !== 'ready') print(`  not publishing: the configured conduit is ${conduit.replace('_', ' ')} (run provision:source)`);
    const missing = REQUIRED.filter(capability => !authority?.available(capability));
    if (missing.length > 0) print(`  not publishing: ${missing.join(', ')} delivery is not authorized (run check:auth for the setup path)`);
  }
  const watched = authority;
  let missing = new Set(AWAITED.filter(capability => !watched.available(capability)));
  watched.on(event => {
    if (event.type === 'revoked' && event.role === 'broadcaster') void live.erase().catch(() => undefined);
    if (event.type !== 'report') return;
    const now = new Set(AWAITED.filter(capability => !watched.available(capability)));
    for (const capability of missing) if (!now.has(capability)) print(`  ${capability} grant recorded; ${GRANT_READY[capability]}`);
    for (const capability of now) if (!missing.has(capability)) print(`  ${capability} grant no longer recorded; ${GRANT_MISSING[capability]}`);
    missing = now;
  });
  // Someone running authorize (or re-consenting after a withdrawal) while Herald runs is noticed within a
  // minute rather than at the hourly validation. Only while a grant is missing: one shared grant reading.
  grantWatch = setInterval(() => {
    if (AWAITED.every(capability => watched.available(capability))) return;
    void watched.refresh().catch(() => undefined);
  }, GRANT_RECHECK_MS);
  grantWatch.unref?.();
  return { server, source, stop };
}

function unstarted(condition: UnstartedHealth['condition'], reason: string, missing: readonly string[]): SourceHost {
  const health: UnstartedHealth = { origin: 'live', condition, available: false, reason, missing };
  return { current: null, subscribe: () => () => undefined, health: () => health };
}

/** The workspace root, so the binding table can refuse to live inside the repository. */
export function repositoryRoot(from = process.cwd()): string | null {
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
