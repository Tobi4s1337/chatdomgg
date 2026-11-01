import { KingdomIdSchema } from '@chatdom/shared';
import { resolve, sep } from 'node:path';
import { AppTokenSession, HelixReader } from '@chatdom/twitch';
import { inspectAuthorization } from './auth/authority';
import { runAuthorize } from './auth/authorize';
import type { Role } from './auth/grants';
import { formatAuthorizeOutcome, formatAuthReport, formatObserveProbe } from './cli/report';
import { type HeraldConfig, loadConfig } from './config';
import { provisionSource } from './ingest/provision';
import { probeObservedState, type ObserveProbe } from './observe/probe';
import { type BindingStore, BindingStoreError, FileBindingStore, MemoryBindingStore } from './source/bindings';
import { checkSource } from './source/check';
import { presentKingdom } from './source/kingdom';
import { repositoryRoot, startLiveSource } from './source/live';
import { startPresenceServer } from './source/server';
import { playScenario, SCENARIO_NOTES, SCENARIOS, SIMULATED_KINGDOM, type ScenarioName } from './source/simulation';
import { PresenceSource } from './source/source';
import { configuredRealmDelivery } from './realm-delivery/config';
import { RealmDelivery } from './realm-delivery/delivery';
import { startMockDoor } from './mock/door';

const USAGE = [
  'Usage: herald <command>',
  '  check-auth [--observe] [--json]         which real reads are authorized, and how to fix what is not;',
  '                                          --observe also reads stream state and one Chatters sweep (counts only)',
  '  authorize --role reader|broadcaster     ask one account for its Herald grant (interactive)',
  '  provision-source [--create-development-conduit]',
  '                                          reuse (or explicitly create) the conduit, attach its shard, reconcile subscriptions',
  '  dev                                     the real source for the configured channel on 127.0.0.1:$HERALD_PORT (5194)',
  `  replay [--scenario ${SCENARIOS.join('|')}] [--kingdom <id>]`,
  '         [--bindings <dir>] [--arrival forward|reverse]',
  '                                          SIMULATED presence through the same path on 127.0.0.1:$HERALD_PORT (5194);',
  '                                          --bindings keeps its slots in a scratch table to show a restart',
  '  check-source                            verify the source path end to end on a private port (SIMULATED)',
  '  mock --kingdom <id> --port <port>       SIMULATED EventSub webhook door for Twitch CLI: verified deliveries go',
  '                                          through ingest to $HERALD_REALM_URL, signed with $HERALD_MOCK_SECRET;',
  '                                          the outbox lives in $HERALD_REALM_OUTBOX_DIR (never the repository)',
];

/** Runs until SIGINT/SIGTERM, then stops everything it started. */
function untilSignal(stop: () => Promise<void>): Promise<number> {
  return new Promise(resolve => {
    const onSignal = () => {
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
      void stop().finally(() => resolve(0));
    };
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
  });
}

/** A port setting that does not parse never falls back to 5194, where another checkout's Herald may serve. */
function portRefused(config: HeraldConfig): boolean {
  if (!config.problems.some(problem => problem.key === 'HERALD_PORT')) return false;
  process.stderr.write('herald: HERALD_PORT must be a free unprivileged port other than 5195\n');
  return true;
}

function option(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

export async function main(argv: readonly string[]): Promise<number> {
  const args = argv.filter(arg => arg !== '--');
  const [command, ...rest] = args;
  const print = (line: string) => process.stdout.write(`${line}\n`);

  if (command === 'check-auth') {
    const config = await loadConfig();
    const tokens = config.credentials ? new AppTokenSession({ clientId: config.credentials.clientId, clientSecret: config.credentials.clientSecret, fetch }) : null;
    const helix = tokens ? new HelixReader({ tokens, fetch }) : null;
    const observe = rest.includes('--observe');
    let report;
    let probe: ObserveProbe | null = null;
    try {
      report = await inspectAuthorization({ config, tokens, helix });
      if (observe && helix) probe = await probeObservedState({ report, helix });
    } finally {
      tokens?.close();
    }
    if (rest.includes('--json')) print(JSON.stringify(observe ? { ...report, observed: probe } : report, null, 2));
    else {
      formatAuthReport(report).forEach(print);
      if (observe) formatObserveProbe(probe).forEach(print);
    }
    return report.ok ? 0 : 1;
  }

  if (command === 'authorize') {
    const roleIndex = rest.indexOf('--role');
    const role = roleIndex >= 0 ? rest[roleIndex + 1] : undefined;
    if (role !== 'reader' && role !== 'broadcaster') {
      USAGE.forEach(line => process.stderr.write(`${line}\n`));
      return 2;
    }
    const controller = new AbortController();
    const onSignal = () => controller.abort();
    process.once('SIGINT', onSignal);
    try {
      const outcome = await runAuthorize({ config: await loadConfig(), role: role satisfies Role, fetch, print, signal: controller.signal });
      print('');
      formatAuthorizeOutcome(outcome).forEach(print);
      return outcome.status === 'recorded' ? 0 : 1;
    } finally {
      process.off('SIGINT', onSignal);
    }
  }

  if (command === 'provision-source') {
    const outcome = await provisionSource({
      config: await loadConfig(), print, createDevelopmentConduit: rest.includes('--create-development-conduit'),
      conduitFromEnvironment: Boolean(process.env.HERALD_CONDUIT_ID?.trim()),
    });
    return outcome.status === 'complete' ? 0 : 1;
  }

  if (command === 'dev') {
    const config = await loadConfig();
    if (portRefused(config)) return 2;
    const realm = await configuredRealmDelivery(config, repositoryRoot());
    try {
      const handle = await startLiveSource({ config, print, ...(realm ? { realm } : {}) });
      if (realm) print('  signed Realm delivery configured; normalized evidence durable, speech and wishes transient');
      return await untilSignal(async () => { await handle.stop(); await realm?.close(); });
    } catch (error) { await realm?.close(); throw error; }
  }

  if (command === 'mock') {
    const kingdom = KingdomIdSchema.safeParse(option(rest, '--kingdom')), port = Number(option(rest, '--port'));
    const url = process.env.HERALD_REALM_URL?.trim(), secret = process.env.HERALD_MOCK_SECRET ?? '', directory = process.env.HERALD_REALM_OUTBOX_DIR?.trim();
    if (!kingdom.success || !Number.isInteger(port) || port < 1024 || port > 65_535 || !url || !directory) {
      process.stderr.write('herald mock: needs --kingdom <id>, --port <port>, HERALD_REALM_URL, HERALD_REALM_OUTBOX_DIR and HERALD_MOCK_SECRET\n');
      return 2;
    }
    const realm = await RealmDelivery.open({ url, secret: process.env.REALM_INGRESS_HERALD_SECRET ?? '', directory, repositoryRoot: repositoryRoot(), origin: 'simulated' });
    try {
      const door = await startMockDoor({ kingdomId: kingdom.data, secret, realm, port, print });
      return await untilSignal(async () => { await door.stop(); await realm.close(); });
    } catch (error) { await realm.close(); throw error; }
  }

  if (command === 'replay') {
    const scenario = option(rest, '--scenario') ?? 'evening';
    const kingdom = KingdomIdSchema.safeParse(option(rest, '--kingdom') ?? SIMULATED_KINGDOM);
    const arrival = option(rest, '--arrival') ?? 'forward';
    const bindings = option(rest, '--bindings');
    if (!SCENARIOS.includes(scenario as ScenarioName) || !kingdom.success || (arrival !== 'forward' && arrival !== 'reverse') || (rest.includes('--bindings') && !bindings)) {
      USAGE.forEach(line => process.stderr.write(`${line}\n`));
      return 2;
    }
    const config = await loadConfig();
    if (portRefused(config)) return 2;
    const layout = presentKingdom(config.kingdom);
    let store: BindingStore = new MemoryBindingStore();
    if (bindings) {
      // Synthetic people never reach the real binding table: a scratch directory only, outside the repo.
      const dir = resolve(bindings);
      const real = resolve(config.dataDir);
      if (dir === real || dir.startsWith(`${real}${sep}`) || real.startsWith(`${dir}${sep}`)) {
        process.stderr.write('herald: --bindings must not be (or contain) the real Herald data directory\n');
        return 2;
      }
      store = new FileBindingStore({ dataDir: dir, kingdomId: kingdom.data, repositoryRoot: repositoryRoot() });
    }
    const source = new PresenceSource({ kingdomId: kingdom.data, origin: 'simulated', slots: layout.slots, store });
    try {
      await source.open();
    } catch (error) {
      if (!(error instanceof BindingStoreError)) throw error;
      process.stderr.write(`herald: the scratch binding table cannot be used (${error.fault})\n`);
      return 1;
    }
    const server = await startPresenceServer({ host: () => source, port: config.port });
    print(`Herald source · SIMULATED · scenario ${scenario} · http://127.0.0.1:${server.port}/presence-data/stream`);
    print(`  ${SCENARIO_NOTES[scenario as ScenarioName]}`);
    print(`  kingdom ${kingdom.data} · ${layout.config.tier} ${layout.config.firstYear}–${layout.config.year} · ${layout.slots.length} home slots · synthetic people only`);
    if (bindings) print(`  slots kept in a scratch table · ${source.health().capacity.bound} already bound · arrival ${arrival}`);
    const replay = playScenario(source, scenario as ScenarioName, { arrival });
    return untilSignal(async () => {
      replay.stop();
      await source.close();
      await server.close();
    });
  }

  if (command === 'check-source') {
    const result = await checkSource();
    result.lines.forEach(print);
    return result.ok ? 0 : 1;
  }

  USAGE.forEach(line => process.stderr.write(`${line}\n`));
  return 2;
}

main(process.argv.slice(2)).then(code => {
  process.exitCode = code;
}, (error: unknown) => {
  if ((error as NodeJS.ErrnoException | null)?.code === 'EADDRINUSE') {
    // Started before any Twitch call, so a second Herald never takes the conduit shard from the one serving.
    process.stderr.write('herald: the port is in use (is the kingdom\'s Herald already serving?); set HERALD_PORT for this run\n');
  } else process.stderr.write(`herald: ${error instanceof Error ? error.name : 'Error'} (details withheld)\n`);
  process.exitCode = 1;
});
