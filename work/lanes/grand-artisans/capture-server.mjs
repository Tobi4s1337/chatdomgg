import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { CAPTURE_PORTS } from '../../../packages/testing/capture-ports.mjs';

async function available(port) {
  return await new Promise(resolve => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
  });
}

/** Own only the process group we start; strictPort closes the bind-after-probe race. */
export async function startCaptureServer(cwd = process.cwd()) {
  const failures = [];
  for (const port of CAPTURE_PORTS) {
    if (!await available(port)) continue;
    const child = spawn('pnpm', ['--filter', '@chatdom/web', 'exec', 'vite', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let log = '', exited = false;
    const closed = new Promise(resolve => child.once('close', () => { exited = true; resolve(); }));
    child.stdout.on('data', chunk => { log += chunk; });
    child.stderr.on('data', chunk => { log += chunk; });
    const stop = async () => {
      if (!exited && child.pid) {
        try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      }
      await closed;
    };
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Vite startup timeout on ${port}`)), 20000);
        const data = () => { if (log.includes('Local:')) { clearTimeout(timer); resolve(); } };
        child.stdout.on('data', data); child.stderr.on('data', data);
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('exit', code => { clearTimeout(timer); reject(new Error(`Vite exited ${code}`)); });
        data();
      });
      return { port, stop };
    } catch (error) {
      await stop(); failures.push(`${port}: ${error.message}\n${log}`);
      // A strict-port collision can be retried. Configuration failures will repeat on every port.
      if (!/port.*(already in use|in use)|EADDRINUSE/i.test(log)) break;
    }
  }
  throw new Error(`Unable to start capture Vite.\n${failures.join('\n') || 'No capture ports available.'}`);
}
