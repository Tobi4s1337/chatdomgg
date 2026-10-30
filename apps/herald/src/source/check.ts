import { KingdomPresenceFrameSchema, type KingdomPresenceFrame } from '@chatdom/shared';
import { request } from 'node:http';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileBindingStore } from './bindings';
import { presentKingdom } from './kingdom';
import { toPresenceInput, type Observation } from './observations';
import { HEALTH_PATH, startPresenceServer, STREAM_PATH } from './server';
import { SIMULATED_KINGDOM } from './simulation';
import { PresenceSource } from './source';

/** A minimal SSE reader for the check: it records exactly what a browser would receive. */
export interface StreamReader {
  readonly status: number;
  readonly frames: KingdomPresenceFrame[];
  /** Every byte of every event body received, for privacy scans. */
  raw: string;
  readonly closed: Promise<void>;
  /** Resolves with the newest frame once it satisfies the predicate. */
  waitFor(predicate: (frame: KingdomPresenceFrame) => boolean, timeoutMs?: number): Promise<KingdomPresenceFrame>;
  close(): void;
}

export function openStream(port: number, options: { readonly paused?: boolean } = {}): Promise<StreamReader> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: STREAM_PATH, headers: { accept: 'text/event-stream' } }, response => {
      const frames: KingdomPresenceFrame[] = [];
      const waiters: Array<{ predicate: (frame: KingdomPresenceFrame) => boolean; resolve: (frame: KingdomPresenceFrame) => void }> = [];
      let buffer = '';
      let closedResolve: () => void = () => undefined;
      const closed = new Promise<void>(done => {
        closedResolve = done;
      });
      const reader: StreamReader = {
        status: response.statusCode ?? 0,
        frames,
        raw: '',
        closed,
        waitFor(predicate, timeoutMs = 3_000) {
          // Only the newest frame counts as current; earlier frames are history a browser has replaced.
          const latest = frames.at(-1);
          if (latest && predicate(latest)) return Promise.resolve(latest);
          return new Promise((done, fail) => {
            const timer = setTimeout(() => fail(new Error('no matching frame arrived')), timeoutMs);
            waiters.push({ predicate, resolve: frame => {
              clearTimeout(timer);
              done(frame);
            } });
          });
        },
        close() {
          req.destroy();
        },
      };
      response.setEncoding('utf8');
      if (options.paused) response.pause();
      response.on('data', (chunk: string) => {
        reader.raw += chunk;
        buffer += chunk;
        let end: number;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const event = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const data = event.split('\n').filter(line => line.startsWith('data: ')).map(line => line.slice(6)).join('\n');
          if (!data) continue;
          const frame = KingdomPresenceFrameSchema.parse(JSON.parse(data));
          frames.push(frame);
          for (const waiter of [...waiters]) {
            if (waiter.predicate(frame)) {
              waiters.splice(waiters.indexOf(waiter), 1);
              waiter.resolve(frame);
            }
          }
        }
      });
      response.on('close', () => closedResolve());
      response.on('error', () => closedResolve());
      resolve(reader);
    });
    req.on('error', reject);
    req.end();
  });
}

async function getJson(port: number, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => {
        body += chunk;
      });
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

export interface SourceCheckResult {
  readonly ok: boolean;
  readonly lines: readonly string[];
}

const TALKER = { id: '9000000000000101', displayName: 'Juniper' };
const HOSTILE = { id: '9000000000000102', displayName: '\u202e<img src=x onerror=alert(1)>' };
const LURKERS = ['9000000000000201', '9000000000000202', '9000000000000203'];
const NEWCOMER = '9000000000000204';
const SYNTHETIC_IDS = [TALKER.id, HOSTILE.id, ...LURKERS, NEWCOMER];

/**
 * `check:source`: SIMULATED inputs through the real mapping, reducer, durable binding table, projection
 * and the loopback SSE endpoint, read back like a browser would. It proves the path, not Twitch: nothing
 * here touches the network beyond 127.0.0.1.
 */
export async function checkSource(options: { readonly port?: number } = {}): Promise<SourceCheckResult> {
  const lines: string[] = [];
  const failures: string[] = [];
  const expect = (condition: boolean, label: string) => {
    lines.push(`  ${condition ? '✓' : '✗'} ${label}`);
    if (!condition) failures.push(label);
  };
  const dataDir = await mkdtemp(join(tmpdir(), 'herald-check-'));
  const kingdom = presentKingdom({ seed: 'herald-check', tier: 'hamlet', firstYear: 2026, year: 2026 });
  let clock = Date.UTC(2026, 9, 30, 20, 0, 0);
  const at = (seconds: number) => {
    clock += seconds * 1_000;
    return clock;
  };
  const open = (store: FileBindingStore) => new PresenceSource({
    kingdomId: SIMULATED_KINGDOM, origin: 'simulated', slots: kingdom.slots, store, now: () => clock, tickMs: 0,
  });
  const observe = (source: PresenceSource, observation: Observation) => source.submit(toPresenceInput(observation, SIMULATED_KINGDOM, 'simulated')!);

  let source = open(new FileBindingStore({ dataDir, kingdomId: SIMULATED_KINGDOM }));
  let current = source;
  const server = await startPresenceServer({ host: () => current, port: options.port ?? 0, stallMs: 500 });
  const readers: StreamReader[] = [];
  try {
    lines.push(`Herald source check · SIMULATED · ${new Date(clock).toISOString()} · 127.0.0.1:${server.port}`);
    await source.open();
    const refused = await getJson(server.port, STREAM_PATH);
    expect(refused.status === 503, 'an unavailable source refuses subscribers (503) instead of serving frames');

    source.setAvailable(true);
    const first = await openStream(server.port);
    readers.push(first);
    const initial = await first.waitFor(() => true);
    expect(first.status === 200 && initial.origin === 'simulated', 'a subscriber receives the current SIMULATED snapshot at once');
    expect(initial.connection === 'stale' && initial.windows.every(window => !window.present), 'before any stream evidence the kingdom claims nobody');

    await observe(source, { kind: 'stream', at: at(1), live: true, streamId: 'check-night' });
    await observe(source, { kind: 'chatters', sweepId: 'check-1', at: at(1), complete: true, ids: [...LURKERS, TALKER.id] });
    await observe(source, { kind: 'chat', messageId: 'check-msg-1', at: at(1), author: TALKER });
    await observe(source, { kind: 'chat', messageId: 'check-msg-2', at: at(0), author: HOSTILE });
    const lit = await first.waitFor(frame => frame.windows.filter(window => window.publicName !== null).length === 2);
    const named = lit.windows.filter(window => window.publicName !== null);
    const unnamed = lit.windows.filter(window => window.present && window.publicName === null);
    expect(lit.connection === 'fresh' && lit.streamLive, 'a live stream observation wakes the kingdom');
    expect(named.length === 2 && named.some(window => window.publicName === 'Juniper'), 'a chat act lights its author\'s window by name');
    expect(named.some(window => window.publicName === '<img src=x onerror=alert(1)>'), 'a hostile name arrives as plain data with its bidi override stripped');
    expect(unnamed.length === 3, 'connected quiet people light three unnamed windows');
    const talkerSlot = lit.windows.find(window => window.publicName === 'Juniper')!.slot;
    expect(lit.windows.every(window => kingdom.slots.includes(window.slot)), 'every window is a home slot of the presentation layout');
    const mapping = lit.windows.map(window => window.slot);

    await observe(source, { kind: 'user_clear', eventId: 'check-clear-1', at: at(1), userId: HOSTILE.id });
    const cleared = await first.waitFor(frame => frame.windows.filter(window => window.publicName !== null).length === 1);
    expect(cleared.windows.some(window => window.publicName === 'Juniper'), 'a user clear puts out only that author\'s window');
    await observe(source, { kind: 'chat', messageId: 'check-msg-3', at: at(1), author: HOSTILE });
    source.tick();
    expect(!(first.frames.at(-1)!.windows.some(window => window.publicName?.includes('img'))), 'the protective hold keeps the cleared author dark when they speak again');

    at(91);
    source.tick();
    const expired = await first.waitFor(frame => frame.windows.every(window => !window.present));
    expect(expired.connection === 'fresh', 'leases expire through the reducer: windows go dark while the stream is still live');

    await observe(source, { kind: 'stream', at: at(1), live: false });
    const offline = await first.waitFor(frame => frame.connection === 'offline');
    expect(!offline.streamLive && offline.windows.every(window => !window.present && window.publicName === null), 'an observed offline broadcast rests the beacon and claims nobody');

    const joiner = await openStream(server.port);
    readers.push(joiner);
    const joined = await joiner.waitFor(() => true);
    expect(joined.sequence === first.frames.at(-1)!.sequence && joiner.frames.length === 1, 'a new joiner gets only the latest snapshot, never history');

    const sequences = first.frames.map(frame => frame.sequence);
    expect(sequences.every((sequence, index) => index === 0 || sequence > sequences[index - 1]!), 'sequence rises with every published change within one epoch');

    const raw = readers.map(reader => reader.raw).join('');
    expect(SYNTHETIC_IDS.every(id => !raw.includes(id)), 'no person ID crosses the endpoint');
    expect(!/chat:|sweep:|session:|check-msg|check-night/.test(raw), 'no input, message or session key crosses the endpoint');
    const health = await getJson(server.port, HEALTH_PATH);
    expect(health.status === 200 && SYNTHETIC_IDS.every(id => !health.body.includes(id)) && !health.body.includes('Juniper'), 'local health reports counts and conditions, never people');

    const table = join(dataDir, 'presence', `${SIMULATED_KINGDOM}.json`);
    const tableText = await readFile(table, 'utf8');
    const tableMode = (await stat(table)).mode & 0o777;
    expect(tableMode === 0o600 && ((await stat(join(dataDir, 'presence'))).mode & 0o777) === 0o700, 'the binding table is owner-only (0600 in 0700)');
    expect(!tableText.includes('Juniper') && !tableText.includes('img') && Object.keys(JSON.parse(tableText)).join() === 'version,kingdomId,bindings', 'the table stores only kingdom, person and slot');

    const firstEpoch = source.epoch;
    const closing = first.closed;
    await source.close();
    await closing;
    expect(true, 'closing the source closes every open stream');
    source = open(new FileBindingStore({ dataDir, kingdomId: SIMULATED_KINGDOM }));
    current = source;
    await source.open();
    source.setAvailable(true);
    await observe(source, { kind: 'stream', at: at(1), live: true, streamId: 'check-night-2' });
    await observe(source, { kind: 'chat', messageId: 'check-msg-4', at: at(1), author: TALKER });
    await observe(source, { kind: 'chatters', sweepId: 'check-2', at: at(0), complete: true, ids: [...LURKERS, NEWCOMER] });
    const second = await openStream(server.port);
    readers.push(second);
    const restarted = await second.waitFor(frame => frame.windows.some(window => window.publicName === 'Juniper'));
    expect(restarted.epoch !== firstEpoch, 'a restarted producer announces a fresh epoch');
    expect(restarted.windows.find(window => window.publicName === 'Juniper')?.slot === talkerSlot, 'after restart the same person lights the same window');
    const restartedSlots = restarted.windows.map(window => window.slot);
    expect(mapping.every(slot => restartedSlots.includes(slot)) && restartedSlots.length === mapping.length + 1, 'every earlier binding kept its slot; the newcomer took a free one');

    const dropped = second.closed;
    source.setAvailable(false, 'simulated_outage');
    await dropped;
    const after = await getJson(server.port, STREAM_PATH);
    expect(after.status === 503, 'losing delivery closes the stream and refuses new subscribers');
  } catch (error) {
    failures.push('check aborted');
    lines.push(`  ✗ check aborted: ${error instanceof Error ? error.message : 'unknown failure'}`);
  } finally {
    for (const reader of readers) reader.close();
    await current.close();
    await server.close();
    await rm(dataDir, { recursive: true, force: true });
  }
  lines.push('');
  lines.push(failures.length === 0 ? `Source path verified (${lines.length - 2} checks).` : `${failures.length} check(s) failed.`);
  return { ok: failures.length === 0, lines };
}
