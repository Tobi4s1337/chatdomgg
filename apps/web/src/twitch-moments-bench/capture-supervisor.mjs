import { spawn } from 'node:child_process';
import { clearTimeout, setTimeout } from 'node:timers';

// A separate process group owns the capture, its browser and the lock guard. If
// any step wedges, killing that group closes the guard's pipe and its lock.
export function superviseCapture(command, args, { deadlineMs = 20 * 60_000, graceMs = 2_000, stdio = 'inherit' } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio });
    let deadline, escalation, stopping = false, failure, settled = false;
    const killGroup = signal => {
      if (!child.pid) return;
      try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    };
    const stop = reason => {
      if (stopping) return;
      stopping = true;
      failure = reason;
      killGroup('SIGTERM');
      escalation = setTimeout(() => killGroup('SIGKILL'), graceMs);
    };
    const interrupt = () => stop(new Error('Capture interrupted (SIGINT)'));
    const terminate = () => stop(new Error('Capture interrupted (SIGTERM)'));
    process.on('SIGINT', interrupt);
    process.on('SIGTERM', terminate);
    deadline = setTimeout(() => stop(new Error(`Capture exceeded ${deadlineMs} ms deadline`)), deadlineMs);
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      clearTimeout(escalation);
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', terminate);
      // Reap any browser or guard left behind by an unexpectedly exited worker.
      killGroup('SIGKILL');
      if (failure || error) reject(failure || error);
      else resolve();
    };
    child.once('error', finish);
    child.once('exit', (code, signal) => finish(code === 0 ? undefined : new Error(`Capture worker exited (${signal ?? code})`)));
  });
}
