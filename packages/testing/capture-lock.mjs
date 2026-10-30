import { spawn } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Every checkout on this Linux host uses the same inode. Never remove this file:
// unlinking an advisory lock would let another process lock a different inode.
export const CAPTURE_LOCK_PATH = '/tmp/chatdom-capture.lock';

// The supervisor owns both descriptors and watches the caller's pipe while queued
// and acquired. Each short-lived flock helper inherits those same descriptions,
// so killing a caller releases its locks even while a helper is blocked.
const supervisorSource = `
  import { spawn } from 'node:child_process';
  import { openSync, closeSync } from 'node:fs';
  const path = process.argv[1], priority = process.argv[2];
  let child, descriptors = [], retry;
  let stopping = false;
  const closeLocks = () => {
    for (const descriptor of descriptors) closeSync(descriptor);
    descriptors = [];
  };
  const stop = () => {
    if (stopping) return;
    stopping = true;
    clearTimeout(retry);
    child?.kill('SIGTERM');
    closeLocks();
    process.stdin.destroy();
  };
  process.stdin.resume();
  process.stdin.once('end', stop);
  process.stdin.once('error', stop);
  process.stdout.on('error', stop);
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  const lock = (mode, descriptor, nonblocking = false) => new Promise((resolve, reject) => {
    child = spawn('flock', [mode, ...(nonblocking ? ['--nonblock'] : []), '3'], { stdio: ['ignore', 'ignore', 'inherit', descriptor] });
    child.once('error', reject);
    child.once('close', code => {
      child = undefined;
      if (stopping) resolve(false);
      else if (code === 0) resolve(true);
      else if (nonblocking && code === 1) resolve(false);
      else reject(new Error('flock exited with code ' + code));
    });
  });
  try {
    while (!stopping) {
      descriptors.push(openSync(path + '.priority', 'a'));
      descriptors.push(openSync(path, 'a'));
      const admitted = await lock(priority === 'main' ? '--shared' : '--exclusive', descriptors[0], priority === 'lane');
      if (admitted && !stopping && priority === 'main') process.stdout.write('priority\\n');
      const acquired = admitted && !stopping && await lock('--exclusive', descriptors[1], priority === 'lane');
      if (stopping) break;
      if (acquired) {
        process.stdout.write('acquired\\n');
        break;
      }
      closeLocks();
      await new Promise(resolve => { retry = setTimeout(resolve, 100); });
    }
  } catch (error) {
    if (!stopping) {
      console.error('Capture lock failed:', error.message);
      process.exitCode = 1;
    }
    stop();
  }
`;

async function checkoutPriority() {
  const gitPath = fileURLToPath(new URL('../../.git', import.meta.url));
  try {
    const gitDirectory = (await stat(gitPath)).isDirectory() ? gitPath
      : resolve(dirname(gitPath), (await readFile(gitPath, 'utf8')).trim().replace(/^gitdir:\s*/, ''));
    return (await readFile(resolve(gitDirectory, 'HEAD'), 'utf8')).trim() === 'ref: refs/heads/main' ? 'main' : 'lane';
  } catch {
    return 'lane';
  }
}

/**
 * Acquire before starting a preview or browser; release after both have closed.
 * `path` exists for isolated subprocess tests; runners always use the host path.
 * `signal` cancels the queue wait. An acquired lock stays held until release so
 * cancellation cannot admit another browser before the caller closes its own.
 * Main captures take priority over polling lanes, without interrupting a holder.
 * Older guards queued directly on the primary lock retain their existing order.
 * Priority defaults to this checkout's branch; CHATDOM_CAPTURE_PRIORITY overrides
 * that default and the explicit option overrides the environment (for tests).
 * @param {{ path?: string, signal?: AbortSignal, priority?: 'main' | 'lane' }} [options]
 * @returns {Promise<(() => Promise<void>)>}
 */
export async function acquireCaptureLock({ path = CAPTURE_LOCK_PATH, signal, priority = process.env.CHATDOM_CAPTURE_PRIORITY } = {}) {
  if (signal?.aborted) throw signal.reason ?? new Error('Capture lock cancelled');
  priority ??= await checkoutPriority();
  if (priority !== 'main' && priority !== 'lane') throw new Error('Capture priority must be main or lane');
  if (signal?.aborted) throw signal.reason ?? new Error('Capture lock cancelled');
  console.log(`[capture] waiting for the shared host lock (${priority})`);
  const child = spawn(process.execPath, ['--input-type=module', '-e', supervisorSource, path, priority], { stdio: ['pipe', 'pipe', 'inherit'] });
  // EPIPE is expected if the guard fails or is cancelled as we close its pipe.
  child.stdin.on('error', () => {});
  let releaseRequested = false;
  let lost;
  const closed = new Promise(resolve => child.once('close', (code, termSignal) => {
    if (!releaseRequested) lost = new Error(`Capture lock guard exited unexpectedly (${termSignal ?? code ?? 'unknown'})`);
    resolve();
  }));
  let releasePromise;
  const release = () => {
    if (!releasePromise) {
      releaseRequested = true;
      child.stdin.end();
      releasePromise = closed.then(() => { if (lost) throw lost; });
    }
    return releasePromise;
  };
  const abort = () => { releaseRequested = true; child.stdin.end(); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    await new Promise((resolve, reject) => {
      let output = '';
      let prioritized = false;
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', data => {
        output += data;
        if (!prioritized && output.includes('priority\n')) {
          prioritized = true;
          console.log('[capture] main priority registered');
        }
        if (output.includes('acquired\n')) resolve();
      });
      child.once('error', reject);
      child.once('close', () => reject(signal?.aborted ? signal.reason ?? new Error('Capture lock cancelled') : lost ?? new Error('Capture lock guard closed before acquisition')));
    });
    if (signal?.aborted) throw signal.reason ?? new Error('Capture lock cancelled');
    signal?.removeEventListener('abort', abort);
    console.log('[capture] acquired the shared host lock');
    return release;
  } catch (error) {
    signal?.removeEventListener('abort', abort);
    await release().catch(() => {});
    throw error;
  }
}
