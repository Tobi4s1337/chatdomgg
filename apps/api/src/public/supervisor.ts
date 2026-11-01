import { spawn, type ChildProcess } from 'node:child_process';

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
    next.once('exit', (code, signal) => {
      if (child === next) child = undefined;
      if (stopping) return;
      if (Date.now() - startedAt > 60_000) backoffMs = 1_000;
      log(`${options.name}: exited (${signal ?? `code ${code}`}); restarting in ${Math.round(backoffMs / 1000)} s`);
      timer = setTimeout(start, backoffMs);
      backoffMs = Math.min(backoffMs * 2, 30_000);
    });
  };
  start();

  return {
    name: options.name,
    running: () => child !== undefined && child.exitCode === null,
    stop(graceMs = 10_000) {
      stopping = true;
      if (timer) clearTimeout(timer);
      const current = child;
      if (!current || current.exitCode !== null) return Promise.resolve();
      return new Promise(resolve => {
        const kill = setTimeout(() => current.kill('SIGKILL'), graceMs);
        current.once('exit', () => { clearTimeout(kill); resolve(); });
        current.kill('SIGTERM');
      });
    },
  };
}
