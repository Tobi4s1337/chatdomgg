import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { serverRequestDenial, type RequestId, type RpcMessage } from './protocol';

/** One message may echo a full prompt back (the user-message item); anything larger is a broken stream. */
const MAX_LINE_CHARS = 8 * 1024 * 1024;

/** The server answered a request with a JSON-RPC error; the connection itself is still healthy. */
export class RpcRejected extends Error {
  constructor(readonly method: string) {
    super('The Forge drafting server declined a request.');
    this.name = 'RpcRejected';
  }
}

export class RpcTimeout extends Error {
  constructor(readonly method: string) {
    super('The Forge drafting server did not answer in time.');
    this.name = 'RpcTimeout';
  }
}

export class ConnectionLost extends Error {
  constructor() {
    super('The Forge drafting connection was lost.');
    this.name = 'ConnectionLost';
  }
}

interface Pending {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
}

type Refable = { ref?: () => void; unref?: () => void };

const live = new Set<ChildProcessWithoutNullStreams>();
let exitHookInstalled = false;

function killGroup(child: ChildProcessWithoutNullStreams) {
  try {
    if (child.pid) process.kill(-child.pid, 'SIGKILL');
    else child.kill('SIGKILL');
  } catch {
    try { child.kill('SIGKILL'); } catch { /* The child has already exited. */ }
  }
}

/** A Forge server must never outlive the process that owns it. */
function track(child: ChildProcessWithoutNullStreams) {
  live.add(child);
  if (!exitHookInstalled) {
    exitHookInstalled = true;
    process.on('exit', () => { for (const owned of live) killGroup(owned); });
  }
}

/**
 * Newline-delimited JSON-RPC over the stdio of one owned child process. Diagnostics on stderr are drained
 * and discarded: they may contain prompts or account details and are never kept or returned.
 */
export class AppServerConnection {
  readonly exited: Promise<void>;
  onNotification: (method: string, params: unknown) => void = () => undefined;
  private readonly pending = new Map<RequestId, Pending>();
  private readonly lostListeners = new Set<() => void>();
  private readonly decoder = new StringDecoder('utf8');
  private buffer = '';
  private nextId = 1;
  private holds = 0;
  private isLost = false;

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    track(child);
    let markExited: () => void = () => undefined;
    this.exited = new Promise(resolve => { markExited = resolve; });
    child.stdout.on('data', (chunk: Buffer) => this.receive(chunk));
    child.stdout.on('end', () => this.lose());
    child.stderr.on('data', () => undefined);
    child.stdin.on('error', () => this.lose());
    child.stdout.on('error', () => this.lose());
    child.stderr.on('error', () => undefined);
    child.on('error', () => this.lose());
    child.on('exit', () => this.lose());
    child.on('close', () => { live.delete(child); this.lose(); markExited(); });
    this.setRef(false);
  }

  get lost(): boolean {
    return this.isLost;
  }

  get pid(): number | undefined {
    return this.child.pid;
  }

  onLost(listener: () => void): () => void {
    if (this.isLost) { queueMicrotask(listener); return () => undefined; }
    this.lostListeners.add(listener);
    return () => this.lostListeners.delete(listener);
  }

  /**
   * Keep the owning process alive only while work is in flight; an idle warm server never holds the
   * event loop open on its own.
   */
  hold(): () => void {
    if (++this.holds === 1) this.setRef(true);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (--this.holds === 0) this.setRef(false);
    };
  }

  request(method: string, params: unknown, timeoutMs?: number): Promise<unknown> {
    if (this.isLost) return Promise.reject(new ConnectionLost());
    const id = this.nextId++;
    const release = this.hold();
    return new Promise<unknown>((resolve, reject) => {
      const entry: Pending = {
        method,
        resolve: value => { release(); resolve(value); },
        reject: error => { release(); reject(error); },
      };
      if (timeoutMs !== undefined) {
        entry.timer = setTimeout(() => {
          this.pending.delete(id);
          entry.reject(new RpcTimeout(method));
        }, timeoutMs);
      }
      this.pending.set(id, entry);
      this.send({ id, method, params });
    });
  }

  notify(method: string, params?: unknown) {
    this.send(params === undefined ? { method } : { method, params });
  }

  /** Kill the whole process group. Pending work observes the loss through its own listeners. */
  kill() {
    killGroup(this.child);
    this.lose();
  }

  private send(message: RpcMessage) {
    if (this.isLost) return;
    try {
      this.child.stdin.write(`${JSON.stringify(message)}\n`);
    } catch {
      this.kill();
    }
  }

  private setRef(on: boolean) {
    const handles: Refable[] = [this.child as unknown as Refable, this.child.stdin as unknown as Refable,
      this.child.stdout as unknown as Refable, this.child.stderr as unknown as Refable];
    for (const handle of handles) {
      try { if (on) handle.ref?.(); else handle.unref?.(); } catch { /* Not every stream exposes a handle. */ }
    }
  }

  private receive(chunk: Buffer) {
    if (this.isLost) return;
    this.buffer += this.decoder.write(chunk);
    let newline: number;
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (line.trim()) this.dispatch(line);
      if (this.isLost) return;
    }
    if (this.buffer.length > MAX_LINE_CHARS) this.kill();
  }

  private dispatch(line: string) {
    let message: RpcMessage;
    try {
      const parsed: unknown = JSON.parse(line);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Not an object.');
      message = parsed as RpcMessage;
    } catch {
      this.kill();
      return;
    }
    const { id, method } = message;
    const hasId = typeof id === 'string' || typeof id === 'number';
    if (typeof method === 'string' && hasId) {
      // The server is asking the client for something: always refuse.
      this.send({ id, ...serverRequestDenial(method) });
      return;
    }
    if (typeof method === 'string') {
      try { this.onNotification(method, message.params); } catch { /* A listener fault must not break the stream. */ }
      return;
    }
    if (!hasId) return;
    const entry = this.pending.get(id);
    if (!entry) return;
    this.pending.delete(id);
    if (entry.timer) clearTimeout(entry.timer);
    if (message.error !== undefined) entry.reject(new RpcRejected(entry.method));
    else entry.resolve(message.result);
  }

  private lose() {
    if (this.isLost) return;
    this.isLost = true;
    for (const [id, entry] of this.pending) {
      this.pending.delete(id);
      if (entry.timer) clearTimeout(entry.timer);
      entry.reject(new ConnectionLost());
    }
    for (const listener of [...this.lostListeners]) {
      try { listener(); } catch { /* Each listener settles its own call. */ }
    }
    this.lostListeners.clear();
    // Whatever caused the loss, make sure the process group is gone.
    killGroup(this.child);
  }
}
