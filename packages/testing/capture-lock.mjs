import { spawn } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Every checkout on this Linux host uses the same inode. Never remove this file:
// unlinking an advisory lock would let another process lock a different inode.
export const CAPTURE_LOCK_PATH = '/tmp/chatdom-capture.lock';

// A pipe-bound guard owns the locks, including while queued. Shared locks on the
// original files exclude old exclusive guards during migration. A separate short
// mutex protects the FIFO registry; it is never held for the capture itself.
const supervisorSource = `
  import { spawn } from 'node:child_process';
  import { openSync, closeSync, mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
  const path = process.argv[1], priority = process.argv[2];
  const directory = path + '.queue';
  let child, descriptors = new Set(), retry, ticket;
  let stopping = false;
  const open = name => { const fd = openSync(name, 'a'); descriptors.add(fd); return fd; };
  const close = fd => { if (descriptors.delete(fd)) closeSync(fd); };
  const stop = () => {
    if (stopping) return;
    stopping = true;
    clearTimeout(retry);
    child?.kill('SIGTERM');
    for (const fd of descriptors) closeSync(fd);
    descriptors.clear();
    process.stdin.destroy();
  };
  process.stdin.resume();
  process.stdin.once('end', stop);
  process.stdin.once('error', stop);
  process.stdout.on('error', stop);
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  const lock = (mode, descriptor) => new Promise((resolve, reject) => {
    child = spawn('flock', [mode, '--nonblock', '3'], { stdio: ['ignore', 'ignore', 'inherit', descriptor] });
    child.once('error', reject);
    child.once('close', code => {
      child = undefined;
      if (stopping) resolve(false);
      else if (code === 0) resolve(true);
      else if (code === 1) resolve(false);
      else reject(new Error('flock exited with code ' + code));
    });
  });
  // Linux starttime protects stale cleanup against PID reuse. Never signal a PID.
  const identity = pid => {
    try {
      const raw = readFileSync('/proc/' + pid + '/stat', 'utf8');
      const fields = raw.slice(raw.lastIndexOf(')') + 2).split(' ');
      return fields[0] === 'Z' ? undefined : fields[19];
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ESRCH') return undefined;
      throw error;
    }
  };
  const self = identity(process.pid);
  const write = entry => {
    const temporary = directory + '/' + ticket + '.tmp';
    writeFileSync(temporary, JSON.stringify(entry));
    renameSync(temporary, directory + '/' + ticket);
  };
  try {
    mkdirSync(directory, { recursive: true });
    while (!stopping) {
      const mutex = open(path + '.queue-mutex');
      if (await lock('--exclusive', mutex)) {
        try {
          const entries = [];
          const names = readdirSync(directory);
          for (const name of names.filter(name => name.endsWith('.tmp'))) {
            const match = /^(\\d+)-(\\d+)\\.json\\.tmp$/.exec(name);
            if (match && identity(match[1]) !== match[2]) unlinkSync(directory + '/' + name);
          }
          for (const name of names.filter(name => name.endsWith('.json'))) {
            const entry = JSON.parse(readFileSync(directory + '/' + name, 'utf8'));
            if (identity(entry.pid) !== entry.start) unlinkSync(directory + '/' + name);
            else entries.push({ ...entry, name });
          }
          if (!ticket) {
            const sequence = Math.max(0, ...entries.map(entry => entry.sequence)) + 1;
            ticket = process.pid + '-' + self + '.json';
            const entry = { sequence, pid: process.pid, start: self, priority, active: false };
            write(entry);
            entries.push({ ...entry, name: ticket });
            process.stdout.write('queued\\n');
            if (priority === 'main') process.stdout.write('priority\\n');
          }
          const same = entries.filter(entry => entry.priority === priority);
          const active = same.filter(entry => entry.active).length;
          const head = same.filter(entry => !entry.active).sort((a, b) => a.sequence - b.sequence)[0];
          if (head?.name === ticket && active < (priority === 'main' ? 1 : 2)) {
            const legacyPriority = open(path + '.priority');
            const legacyPrimary = open(path);
            const admitted = await lock('--shared', legacyPriority);
            const acquired = admitted && !stopping && await lock('--shared', legacyPrimary);
            if (acquired && !stopping) {
              write({ ...head, active: true });
              process.stdout.write('acquired\\n');
              break;
            }
            close(legacyPrimary);
            close(legacyPriority);
          }
        } finally { close(mutex); }
      } else close(mutex);
      if (!stopping) await new Promise(resolve => { retry = setTimeout(resolve, 50); });
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
 * One slot is reserved for main and two for lanes, FIFO within each class.
 * Main never waits for a lane; lanes never wait for main. Older exclusive guards
 * remain safe: shared compatibility locks prevent any overlap with them.
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
      let registered = false;
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', data => {
        output += data;
        if (!prioritized && output.includes('priority\n')) {
          prioritized = true;
          console.log('[capture] main priority registered');
        }
        if (output.includes('queued\n') && !registered) {
          registered = true;
          console.log(`[capture] queued for a ${priority} slot`);
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
