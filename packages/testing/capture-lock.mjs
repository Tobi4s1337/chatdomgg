import { spawn } from 'node:child_process';

// Every checkout on this Linux host uses the same inode. Never remove this file:
// unlinking an advisory lock would let another process lock a different inode.
export const CAPTURE_LOCK_PATH = '/tmp/chatdom-capture.lock';

const holderSource = 'process.stdout.write("acquired\\n"); process.stdin.resume();';
// The supervisor watches the caller's pipe even while flock is queued. --no-fork
// keeps one PID for the waiting flock and its eventual holder, so cancellation
// terminates exactly our process in either state, including after caller SIGKILL.
const supervisorSource = `
  import { spawn } from 'node:child_process';
  const child = spawn('flock', ['--exclusive', '--no-fork', process.argv[1], process.execPath, '-e', ${JSON.stringify(holderSource)}], { stdio: ['pipe', 'pipe', 'inherit'] });
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    child.stdin.end();
    child.kill('SIGTERM');
  };
  process.stdin.resume();
  process.stdin.once('end', stop);
  process.stdin.once('error', stop);
  process.stdout.on('error', stop);
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  child.stdin.on('error', () => {});
  child.stdout.pipe(process.stdout);
  child.once('error', error => { console.error('Capture lock failed:', error.message); });
  child.once('close', code => {
    process.exitCode = stopping ? 0 : (code ?? 1);
    process.stdin.destroy();
  });
`;

/**
 * Acquire before starting a preview or browser; release after both have closed.
 * `path` exists for isolated subprocess tests; runners always use the host path.
 * `signal` cancels the queue wait. An acquired lock stays held until release so
 * cancellation cannot admit another browser before the caller closes its own.
 * @param {{ path?: string, signal?: AbortSignal }} [options]
 * @returns {Promise<(() => Promise<void>)>}
 */
export async function acquireCaptureLock({ path = CAPTURE_LOCK_PATH, signal } = {}) {
  if (signal?.aborted) throw signal.reason ?? new Error('Capture lock cancelled');
  console.log('[capture] waiting for the shared host lock');
  const child = spawn(process.execPath, ['--input-type=module', '-e', supervisorSource, path], { stdio: ['pipe', 'pipe', 'inherit'] });
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
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', data => {
        output += data;
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
