import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, beforeEach, expect, it } from 'vitest';

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

function start(extra = '', acquireOptions = '') {
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
  const child = spawn(process.execPath, ['--input-type=module', '-e', source], { stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '', errors = '';
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { errors += data; });
  const closed = new Promise<void>(resolve => child.once('close', () => resolve()));
  clients.push({ child, closed });
  const waitFor = async (text: string) => {
    const deadline = Date.now() + 4000;
    while (!output.includes(text)) {
      if (child.exitCode !== null || child.signalCode) throw new Error(`Client closed before ${text}: ${output}\n${errors}`);
      if (Date.now() >= deadline) throw new Error(`Waiting for ${text}: ${output}\n${errors}`);
      await delay(10);
    }
  };
  return { child, closed, waitFor, output: () => output, errors: () => errors };
}

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

it('releases when an acquired caller is killed', async () => {
  const first = start(); await first.waitFor('CLIENT_READY');
  const second = start(); await second.waitFor('[capture] waiting');
  first.child.kill('SIGKILL'); await first.closed;
  await second.waitFor('CLIENT_READY');
  second.child.stdin.end(); await second.waitFor('CLIENT_RELEASED'); await second.closed;
  expect(second.child.exitCode).toBe(0);
});

it('cancels a killed queued caller without holding the next acquisition', async () => {
  const first = start(); await first.waitFor('CLIENT_READY');
  const abandoned = start(); await abandoned.waitFor('[capture] waiting');
  abandoned.child.kill('SIGKILL'); await abandoned.closed;
  const next = start(); await next.waitFor('[capture] waiting');
  first.child.stdin.end(); await first.waitFor('CLIENT_RELEASED');
  await next.waitFor('CLIENT_READY');
  expect(abandoned.output()).not.toContain('CLIENT_READY');
  next.child.stdin.end(); await next.waitFor('CLIENT_RELEASED'); await next.closed;
  expect(next.child.exitCode).toBe(0);
});

it('cancels a queued acquisition through its abort signal', async () => {
  const first = start(); await first.waitFor('CLIENT_READY');
  const cancelled = start('const controller = new AbortController(); setTimeout(() => controller.abort(new Error("TEST_CANCELLED")), 100);', ', signal: controller.signal');
  await cancelled.closed;
  expect(cancelled.child.exitCode).not.toBe(0);
  expect(cancelled.output()).not.toContain('CLIENT_READY');
  expect(cancelled.errors()).toContain('TEST_CANCELLED');
  const next = start(); await next.waitFor('[capture] waiting');
  first.child.stdin.end(); await first.waitFor('CLIENT_RELEASED');
  await next.waitFor('CLIENT_READY');
  next.child.stdin.end(); await next.waitFor('CLIENT_RELEASED'); await next.closed;
  expect(next.child.exitCode).toBe(0);
});

it('keeps an acquired lock until cleanup even if its queue signal is later aborted', async () => {
  const first = start('const controller = new AbortController(); process.stdin.on("data", () => controller.abort());', ', signal: controller.signal');
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
