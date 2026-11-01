import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const moduleUrl = new URL('./capture-lock.mjs', import.meta.url).href;
let directory: string, path: string;
const clients: { child: ChildProcessWithoutNullStreams; closed: Promise<void> }[] = [];

beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'chatdom-capture-lock-test-')); path = join(directory, 'capture.lock'); });
afterEach(async () => {
  for (const { child } of clients) child.stdin.end();
  await Promise.all(clients.map(({ closed }) => closed));
  clients.length = 0;
  await rm(directory, { recursive: true, force: true });
});

function start(extra = '', acquireOptions = ', priority: "main"') {
  const source = `
    import { acquireCaptureLock } from ${JSON.stringify(moduleUrl)};
    const safety = setTimeout(() => process.exit(99), 15000); safety.unref();
    ${extra}
    const release = await acquireCaptureLock({ path: ${JSON.stringify(path)} ${acquireOptions} });
    process.stdout.write('CLIENT_READY\\n');
    await new Promise(resolve => { process.stdin.resume(); process.stdin.once('end', resolve); });
    await Promise.all([release(), release()]);
    process.stdout.write('CLIENT_RELEASED\\n');
  `;
  return runClient(source);
}

function runClient(source: string) {
  const child = spawn(process.execPath, ['--input-type=module', '-e', source], { stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '', errors = '';
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { errors += data; });
  const closed = new Promise<void>(resolve => child.once('close', () => resolve()));
  clients.push({ child, closed });
  const waitFor = async (text: string) => {
    const deadline = Date.now() + 10000;
    while (!output.includes(text)) {
      if (child.exitCode !== null || child.signalCode) throw new Error(`Client closed before ${text}: ${output}\n${errors}`);
      if (Date.now() >= deadline) throw new Error(`Waiting for ${text}: ${output}\n${errors}`);
      await delay(10);
    }
  };
  return { child, closed, waitFor, output: () => output, errors: () => errors };
}

describe('capture queue', { timeout: 15_000 }, () => {

it('queues separate processes until release and makes release idempotent', async () => {
  const first = start(); await first.waitFor('CLIENT_READY');
  const second = start(); await second.waitFor('[capture] waiting');
  await delay(100);
  expect(second.output()).not.toContain('CLIENT_READY');
  first.child.stdin.end(); await first.waitFor('CLIENT_RELEASED');
  await second.waitFor('CLIENT_READY');
  second.child.stdin.end(); await second.waitFor('CLIENT_RELEASED');
  await Promise.all([first.closed, second.closed]);
  expect(first.child.exitCode).toBe(0); expect(second.child.exitCode).toBe(0);
});

it('runs two lane captures beside a reserved main capture, with FIFO queues in both classes', async () => {
  const first = start('', ', priority: "lane"'); await first.waitFor('CLIENT_READY');
  const second = start('', ', priority: "lane"'); await second.waitFor('CLIENT_READY');
  const lane3 = start('', ', priority: "lane"'); await lane3.waitFor('queued for a lane slot');
  const lane4 = start('', ', priority: "lane"'); await lane4.waitFor('queued for a lane slot');
  const main = start(); await main.waitFor('CLIENT_READY');
  const main2 = start(); await main2.waitFor('queued for a main slot');
  await delay(120);
  for (const queued of [lane3, lane4, main2]) expect(queued.output()).not.toContain('CLIENT_READY');
  first.child.stdin.end(); await first.waitFor('CLIENT_RELEASED');
  await lane3.waitFor('CLIENT_READY');
  expect(lane4.output()).not.toContain('CLIENT_READY');
  expect(main2.output()).not.toContain('CLIENT_READY');
  // Continuing main work cannot starve lanes, nor can two active lanes delay main.
  main.child.stdin.end(); await main.waitFor('CLIENT_RELEASED');
  await main2.waitFor('CLIENT_READY');
  second.child.stdin.end(); await second.waitFor('CLIENT_RELEASED');
  await lane4.waitFor('CLIENT_READY');
});

it('preserves FIFO for repeated main captures', async () => {
  const holder = start(); await holder.waitFor('CLIENT_READY');
  const first = start(); await first.waitFor('queued for a main slot');
  const second = start(); await second.waitFor('queued for a main slot');
  holder.child.stdin.end(); await holder.waitFor('CLIENT_RELEASED');
  await first.waitFor('CLIENT_READY');
  expect(second.output()).not.toContain('CLIENT_READY');
  first.child.stdin.end(); await first.waitFor('CLIENT_RELEASED');
  await second.waitFor('CLIENT_READY');
});

it.each(['main', 'lane'])('releases when an acquired %s caller is killed', async priority => {
  const first = start('', `, priority: "${priority}"`); await first.waitFor('CLIENT_READY');
  if (priority === 'lane') { const extra = start('', ', priority: "lane"'); await extra.waitFor('CLIENT_READY'); }
  const second = start('', `, priority: "${priority}"`); await second.waitFor('[capture] waiting');
  first.child.kill('SIGKILL'); await first.closed;
  await second.waitFor('CLIENT_READY');
  second.child.stdin.end(); await second.waitFor('CLIENT_RELEASED'); await second.closed;
  expect(second.child.exitCode).toBe(0);
});

it.each(['main', 'lane'])('cancels a killed queued %s caller without holding the next acquisition', async priority => {
  const first = start('', `, priority: "${priority}"`); await first.waitFor('CLIENT_READY');
  if (priority === 'lane') { const extra = start('', ', priority: "lane"'); await extra.waitFor('CLIENT_READY'); }
  const abandoned = start('', `, priority: "${priority}"`); await abandoned.waitFor('queued for a ' + priority + ' slot');
  abandoned.child.kill('SIGKILL'); await abandoned.closed;
  const next = start('', `, priority: "${priority}"`); await next.waitFor('queued for a ' + priority + ' slot');
  first.child.stdin.end(); await first.waitFor('CLIENT_RELEASED');
  await next.waitFor('CLIENT_READY');
  expect(abandoned.output()).not.toContain('CLIENT_READY');
  next.child.stdin.end(); await next.waitFor('CLIENT_RELEASED'); await next.closed;
  expect(next.child.exitCode).toBe(0);
});

it.each(['main', 'lane'])('cancels a queued %s acquisition through its abort signal', async priority => {
  const first = start('', `, priority: "${priority}"`); await first.waitFor('CLIENT_READY');
  if (priority === 'lane') { const extra = start('', ', priority: "lane"'); await extra.waitFor('CLIENT_READY'); }
  const cancelled = start('const controller = new AbortController(); process.stdin.on("data", () => controller.abort(new Error("TEST_CANCELLED")));', `, signal: controller.signal, priority: "${priority}"`);
  await cancelled.waitFor('queued for a ' + priority + ' slot');
  cancelled.child.stdin.write('abort\n');
  await cancelled.closed;
  expect(cancelled.child.exitCode).not.toBe(0);
  expect(cancelled.output()).not.toContain('CLIENT_READY');
  expect(cancelled.errors()).toContain('TEST_CANCELLED');
  const next = start('', `, priority: "${priority}"`); await next.waitFor('queued for a ' + priority + ' slot');
  first.child.stdin.end(); await first.waitFor('CLIENT_RELEASED');
  await next.waitFor('CLIENT_READY');
  next.child.stdin.end(); await next.waitFor('CLIENT_RELEASED'); await next.closed;
  expect(next.child.exitCode).toBe(0);
});

it('uses the environment priority and lets an explicit option override it', async () => {
  const lane = start('process.env.CHATDOM_CAPTURE_PRIORITY = "lane";', '');
  await lane.waitFor('CLIENT_READY');
  expect(lane.output()).toContain('shared host lock (lane)');
  lane.child.stdin.end(); await lane.waitFor('CLIENT_RELEASED'); await lane.closed;
  const main = start('process.env.CHATDOM_CAPTURE_PRIORITY = "lane";', ', priority: "main"');
  await main.waitFor('CLIENT_READY');
  expect(main.output()).toContain('shared host lock (main)');
  main.child.stdin.end(); await main.waitFor('CLIENT_RELEASED'); await main.closed;
  expect(lane.child.exitCode).toBe(0); expect(main.child.exitCode).toBe(0);
});

it('keeps an acquired lock until cleanup even if its queue signal is later aborted', async () => {
  const first = start('const controller = new AbortController(); process.stdin.on("data", () => controller.abort());', ', signal: controller.signal, priority: "main"');
  await first.waitFor('CLIENT_READY');
  const second = start(); await second.waitFor('[capture] waiting');
  first.child.stdin.write('abort\n');
  await delay(100);
  expect(second.output()).not.toContain('CLIENT_READY');
  first.child.stdin.end(); await first.waitFor('CLIENT_RELEASED');
  await second.waitFor('CLIENT_READY');
  second.child.stdin.end(); await second.waitFor('CLIENT_RELEASED'); await second.closed;
  expect(second.child.exitCode).toBe(0);
});

it('rejects a failed lock subprocess instead of granting capture access', async () => {
  const failed = start('process.env.PATH = "";');
  await failed.closed;
  expect(failed.child.exitCode).not.toBe(0);
  expect(failed.output()).not.toContain('CLIENT_READY');
  expect(failed.errors()).toContain('ENOENT');
  const next = start(); await next.waitFor('CLIENT_READY');
  next.child.stdin.end(); await next.waitFor('CLIENT_RELEASED'); await next.closed;
  expect(next.child.exitCode).toBe(0);
});


it.each(['', '.priority'])('excludes legacy exclusive holders of %s while permitting all three new slots after release', async suffix => {
  const legacy = runClient(`
    import { openSync, closeSync } from 'node:fs';
    import { spawnSync } from 'node:child_process';
    const fd = openSync(${JSON.stringify(path + suffix)}, 'a');
    const result = spawnSync('flock', ['--exclusive', '--nonblock', '3'], { stdio: ['ignore', 'ignore', 'inherit', fd] });
    if (result.status !== 0) process.exit(2);
    process.stdout.write('LEGACY_READY\\n');
    process.stdin.resume(); process.stdin.once('end', () => { closeSync(fd); });
  `);
  await legacy.waitFor('LEGACY_READY');
  const first = start('', ', priority: "lane"'); await first.waitFor('queued for a lane slot');
  const second = start('', ', priority: "lane"'); await second.waitFor('queued for a lane slot');
  const main = start(); await main.waitFor('queued for a main slot');
  await delay(100);
  for (const client of [first, second, main]) expect(client.output()).not.toContain('CLIENT_READY');
  legacy.child.stdin.end(); await legacy.closed;
  await Promise.all([first, second, main].map(client => client.waitFor('CLIENT_READY')));
});

it('holds compatibility locks for the full lifetime of every new capture', async () => {
  const first = start('', ', priority: "lane"'); await first.waitFor('CLIENT_READY');
  const main = start(); await main.waitFor('CLIENT_READY');
  const probe = async () => {
    const client = runClient(`
      import { spawnSync } from 'node:child_process';
      for (const path of ${JSON.stringify([path, path + '.priority'])}) {
        const result = spawnSync('flock', ['--exclusive', '--nonblock', path, 'true']);
        if (result.status !== 1) process.exit(2);
      }
    `);
    await client.closed;
    expect(client.child.exitCode).toBe(0);
  };
  await probe();
  first.child.stdin.end(); await first.waitFor('CLIENT_RELEASED');
  await probe();
});

it('cleans abandoned ticket records, partial writes and leases without process IDs', async () => {
  const queue = path + '.queue-v2';
  await mkdir(queue);
  const stale = { sequence: 1, priority: 'main', active: true };
  await writeFile(join(queue, 'dead.json'), JSON.stringify(stale));
  await writeFile(join(queue, 'partial.json.tmp'), '{');
  await writeFile(join(queue, 'partial.json.live'), '');
  await writeFile(join(queue, 'lease-only.json.live'), '');
  const client = start(); await client.waitFor('CLIENT_READY');
  const names = await readdir(queue);
  expect(names).not.toContain('dead.json');
  expect(names).not.toContain('dead.json.live');
  expect(names).not.toContain('partial.json.tmp');
  expect(names).not.toContain('partial.json.live');
  expect(names).not.toContain('lease-only.json.live');
  const records = names.filter(name => name.endsWith('.json'));
  expect(records).toHaveLength(1);
  const entry = JSON.parse(await readFile(join(queue, records[0]!), 'utf8')) as { active: boolean; pid?: number };
  expect(entry.active).toBe(true);
  expect(entry.pid).toBeUndefined();
});

it('honours a live ticket lease without PID metadata until its owner closes the lease', async () => {
  const queue = path + '.queue-v2';
  await mkdir(queue);
  const owner = runClient(`
    import { openSync, closeSync, writeFileSync } from 'node:fs';
    import { spawnSync } from 'node:child_process';
    const fd = openSync(${JSON.stringify(queue + '/opaque.json.live')}, 'a');
    const result = spawnSync('flock', ['--exclusive', '--nonblock', '3'], { stdio: ['ignore', 'ignore', 'inherit', fd] });
    if (result.status !== 0) process.exit(2);
    writeFileSync(${JSON.stringify(queue + '/opaque.json')}, JSON.stringify({ sequence: 1, priority: 'main', active: true }));
    process.stdout.write('LEASE_READY\\n');
    process.stdin.resume(); process.stdin.once('end', () => closeSync(fd));
  `);
  await owner.waitFor('LEASE_READY');
  const queued = start(); await queued.waitFor('queued for a main slot');
  await delay(150);
  expect(queued.output()).not.toContain('CLIENT_READY');
  expect(await readdir(queue)).toContain('opaque.json');
  owner.child.stdin.end(); await owner.closed;
  await queued.waitFor('CLIENT_READY');
  expect(await readdir(queue)).not.toContain('opaque.json');
});

it('uses a separate registry namespace without touching prior PID-registry tickets', async () => {
  const oldQueue = path + '.queue';
  await mkdir(oldQueue);
  await writeFile(join(oldQueue, 'prior.json'), 'unreadable prior-version record');
  const client = start(); await client.waitFor('CLIENT_READY');
  expect(await readFile(join(oldQueue, 'prior.json'), 'utf8')).toBe('unreadable prior-version record');
  expect((await readdir(path + '.queue-v2')).filter(name => name.endsWith('.json'))).toHaveLength(1);
});

});
