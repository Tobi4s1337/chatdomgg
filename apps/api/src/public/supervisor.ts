import { spawn, type ChildProcess } from 'node:child_process';
import type { Server } from 'node:http';

/**
 * Keeps one child service running (the realm) and restarts it when it exits on its own. Restarts back off from
 * one second to thirty, and the backoff resets after a minute of healthy running, so a crash loop never spins
 * while a single crash costs a visitor only a reconnect. Lines the child prints are passed through with its name.
 */
export interface Supervised {
  readonly name: string;
  /** Resolves once the child has exited after SIGTERM (or was killed after the grace). */
  stop(graceMs?: number): Promise<void>;
  running(): boolean;
}

/** Claim the public listener before creating a writer. Proxy mode must never start a second realm. */
export async function bindPublicGateway(options: {
  readonly server: Server;
  readonly port: number;
  readonly host: string;
  readonly realmMode: 'spawn' | 'proxy';
  readonly startRealm: () => Supervised;
}): Promise<Supervised | null> {
  await new Promise<void>((resolve, reject) => {
    const fail = (error: Error) => { options.server.off('listening', ready); reject(error); };
    const ready = () => { options.server.off('error', fail); resolve(); };
    options.server.once('error', fail);
    options.server.once('listening', ready);
    options.server.listen(options.port, options.host);
  });
  try {
    return options.realmMode === 'spawn' ? options.startRealm() : null;
  } catch (error) {
    options.server.closeAllConnections();
    await new Promise<void>(resolve => options.server.close(() => resolve()));
    throw error;
  }
}

export function supervise(options: {
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly log?: (line: string) => void;
}): Supervised {
  const log = options.log ?? (line => console.info(line));
  let child: ChildProcess | undefined;
  let stopping = false, backoffMs = 1_000, startedAt = 0;
  let timer: NodeJS.Timeout | undefined;
  let stopped: Promise<void> | undefined;

  const relay = (stream: NodeJS.ReadableStream | null, write: (line: string) => void) => {
    if (!stream) return;
    let rest = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk: string) => {
      const lines = (rest + chunk).split('\n');
      rest = lines.pop() ?? '';
      for (const line of lines) if (line.trim()) write(`${options.name}: ${line}`);
    });
  };

  const start = () => {
    timer = undefined;
    if (stopping) return;
    startedAt = Date.now();
    const next = spawn(options.command, [...options.args], { cwd: options.cwd, env: options.env, stdio: ['ignore', 'pipe', 'pipe'] });
    child = next;
    relay(next.stdout, line => console.info(line));
    relay(next.stderr, line => console.error(line));
    next.once('error', error => log(`${options.name}: could not start (${error.message})`));
    // close also fires when spawn fails before a process exists; exit does not.
    next.once('close', (code, signal) => {
      if (child === next) child = undefined;
      if (stopping) return;
      if (Date.now() - startedAt > 60_000) backoffMs = 1_000;
      log(`${options.name}: exited (${signal ?? `code ${code}`}); restarting in ${Math.round(backoffMs / 1000)} s`);
      timer = setTimeout(start, backoffMs);
      timer.unref();
      backoffMs = Math.min(backoffMs * 2, 30_000);
    });
  };
  start();

  return {
    name: options.name,
    running: () => !stopping && child?.pid !== undefined && child.exitCode === null && child.signalCode === null,
    stop(graceMs = 10_000) {
      if (stopped) return stopped;
      stopping = true;
      if (timer) clearTimeout(timer);
      const current = child;
      if (!current) return stopped = Promise.resolve();
      return stopped = new Promise(resolve => {
        const kill = setTimeout(() => current.kill('SIGKILL'), graceMs);
        current.once('close', () => { clearTimeout(kill); resolve(); });
        current.kill('SIGTERM');
      });
    },
  };
}
