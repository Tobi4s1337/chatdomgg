import { createServer, request as httpRequest, type IncomingHttpHeaders, type IncomingMessage, type OutgoingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { parseTarget, proxyHttp, proxyUpgrade, type ProxyTarget } from './proxy';

describe('parseTarget', () => {
  it('accepts a plain http://host:port address', () => {
    expect(parseTarget('PUBLIC_REALM_TARGET', 'http://127.0.0.1:5173')).toEqual({ name: 'PUBLIC_REALM_TARGET', host: '127.0.0.1', port: 5173 });
    expect(parseTarget('PUBLIC_REALM_TARGET', 'http://127.0.0.1:5173/')).toEqual({ name: 'PUBLIC_REALM_TARGET', host: '127.0.0.1', port: 5173 });
    expect(parseTarget('PUBLIC_MAP_TARGET', 'http://localhost:5178', '/map-data')).toEqual({ name: 'PUBLIC_MAP_TARGET', host: 'localhost', port: 5178, strip: '/map-data' });
    // IPv6 loopback loses its brackets, as `net.connect` wants it.
    expect(parseTarget('PUBLIC_REALM_TARGET', 'http://[::1]:5173').host).toBe('::1');
  });

  it('refuses anything else, without repeating the value it was given', () => {
    for (const value of [
      'https://127.0.0.1:5173', 'ws://127.0.0.1:5173', 'http://127.0.0.1', 'http://127.0.0.1:5173/realm', 'http://127.0.0.1:5173/?token=hunter2',
      '127.0.0.1:5173', 'not a url at all', '',
    ]) {
      let message = '';
      try { parseTarget('PUBLIC_REALM_TARGET', value); } catch (error) { message = (error as Error).message; }
      expect(message, value).toBe('PUBLIC_REALM_TARGET must be an http://host:port address');
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// A loopback upstream and a gateway in front of it, both on ephemeral ports.

const servers: Server[] = [];
const sockets = new Set<Socket>();

async function listen(server: Server): Promise<number> {
  servers.push(server);
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  return (server.address() as AddressInfo).port;
}

afterEach(async () => {
  for (const socket of sockets) socket.destroy();
  sockets.clear();
  await Promise.all(servers.splice(0).map(server => new Promise<void>(done => { server.closeAllConnections(); server.close(() => done()); })));
});

/** An upstream that answers every request with what it received. */
async function echoUpstream(extra: OutgoingHttpHeaders = {}) {
  const seen: { url: string; method: string; headers: IncomingHttpHeaders; body: string }[] = [];
  const port = await listen(createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += String(chunk);
    seen.push({ url: request.url ?? '', method: request.method ?? '', headers: request.headers, body });
    response.writeHead(200, { 'Content-Type': 'application/json', ...extra }).end(JSON.stringify({ ok: true }));
  }));
  return { port, seen };
}

/** A gateway that sends everything to `target` the way the public server does. */
async function gateway(target: ProxyTarget, proto = 'https') {
  const server = createServer((request, response) => proxyHttp(target, request, response, proto));
  server.on('upgrade', (request, socket, head) => proxyUpgrade(target, request, socket, head, proto));
  return listen(server);
}

/** A free port with nothing behind it. */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>(done => server.close(() => done()));
  return port;
}

function call(port: number, path: string, options: { method?: string; headers?: OutgoingHttpHeaders; body?: string } = {}) {
  return new Promise<{ status: number; headers: IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const outgoing = httpRequest({ host: '127.0.0.1', port, path, method: options.method ?? 'GET', headers: options.headers ?? {}, agent: false }, reply => {
      let body = '';
      reply.on('data', chunk => { body += String(chunk); });
      reply.on('end', () => resolve({ status: reply.statusCode ?? 0, headers: reply.headers, body }));
    });
    outgoing.on('error', reject);
    outgoing.end(options.body);
  });
}

const target = (port: number, strip?: string): ProxyTarget => ({ name: 'test', host: '127.0.0.1', port, ...(strip ? { strip } : {}) });

describe('proxyHttp', () => {
  it('drops hop-by-hop headers and the browser\'s own forwarding claims, and says what it saw instead', async () => {
    const upstream = await echoUpstream();
    const port = await gateway(target(upstream.port));
    const answer = await call(port, '/api/realm/watch/1001?since=4', {
      headers: {
        Connection: 'keep-alive, X-Private-Hop', 'X-Private-Hop': 'secret', 'Keep-Alive': 'timeout=5', TE: 'trailers',
        'Proxy-Authorization': 'Basic c2VjcmV0', 'Proxy-Connection': 'keep-alive',
        'X-Forwarded-For': '6.6.6.6', 'X-Forwarded-Proto': 'http', 'X-Forwarded-Host': 'evil.example', Forwarded: 'for=6.6.6.6',
        Cookie: 'chatdom_session=abc', 'X-Kept': 'yes',
      },
    });
    expect(answer.status).toBe(200);
    expect(JSON.parse(answer.body)).toEqual({ ok: true });
    const [seen] = upstream.seen;
    expect(seen?.url).toBe('/api/realm/watch/1001?since=4');
    const headers = seen!.headers;
    for (const name of ['x-private-hop', 'keep-alive', 'te', 'proxy-authorization', 'proxy-connection', 'x-forwarded-host', 'forwarded']) {
      expect(headers[name], name).toBeUndefined();
    }
    expect(headers['x-forwarded-for']).toBe('127.0.0.1');
    expect(headers['x-forwarded-proto']).toBe('https');
    expect(headers.cookie).toBe('chatdom_session=abc');
    expect(headers['x-kept']).toBe('yes');
  });

  it('forwards the method and body, and drops hop-by-hop headers from the answer', async () => {
    const upstream = await echoUpstream({ 'Proxy-Authenticate': 'Basic realm="upstream"', 'X-Upstream': 'kept' });
    const port = await gateway(target(upstream.port), 'http');
    const answer = await call(port, '/api/realm/entry/1001', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"hello":"realm"}' });
    expect(upstream.seen[0]).toMatchObject({ method: 'POST', body: '{"hello":"realm"}' });
    expect(upstream.seen[0]?.headers['x-forwarded-proto']).toBe('http');
    expect(answer.headers['proxy-authenticate']).toBeUndefined();
    expect(answer.headers['x-upstream']).toBe('kept');
  });

  it('removes the public prefix before forwarding', async () => {
    const upstream = await echoUpstream();
    const port = await gateway(target(upstream.port, '/presence-data'));
    await call(port, '/presence-data/kingdom/1001?live=1');
    await call(port, '/presence-data');
    await call(port, '/presence-data?live=1');
    await call(port, '/elsewhere/presence-data/x');
    expect(upstream.seen.map(item => item.url)).toEqual(['/kingdom/1001?live=1', '/', '/?live=1', '/elsewhere/presence-data/x']);
  });

  it('passes server-sent events through as they are written, without waiting for the stream to end', async () => {
    let closed = false;
    const upstreamPort = await listen(createServer((request, response) => {
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
      response.write('event: hello\ndata: first\n\n');
      // The stream stays open; only the client hanging up ends it.
      request.socket.on('close', () => { closed = true; });
    }));
    const port = await gateway(target(upstreamPort));
    const { headers, first, reply } = await new Promise<{ headers: IncomingHttpHeaders; first: string; reply: IncomingMessage }>((resolve, reject) => {
      const outgoing = httpRequest({ host: '127.0.0.1', port, path: '/api/realm/watch/1001', agent: false }, reply => {
        reply.once('data', chunk => resolve({ headers: reply.headers, first: String(chunk), reply }));
      });
      outgoing.on('error', reject);
      outgoing.end();
    });
    expect(headers['content-type']).toBe('text/event-stream');
    expect(headers['x-accel-buffering']).toBe('no');
    expect(first).toBe('event: hello\ndata: first\n\n');
    reply.destroy();
    await expect.poll(() => closed, { timeout: 2_000 }).toBe(true);
  });

  it('answers 503 in JSON when the service behind it is down', async () => {
    const port = await gateway(target(await closedPort()));
    const answer = await call(port, '/api/realm/entry/1001');
    expect(answer.status).toBe(503);
    expect(answer.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(answer.headers['cache-control']).toBe('no-store');
    expect(answer.headers['retry-after']).toBe('5');
    expect(JSON.parse(answer.body)).toMatchObject({ version: 1, status: 'unavailable' });
  });
});

describe('proxyUpgrade', () => {
  /** An upstream that accepts any upgrade, reports the request head it saw, then echoes bytes back. */
  async function socketUpstream() {
    const seen: { url: string; headers: IncomingHttpHeaders }[] = [];
    const server = createServer((_request, response) => response.writeHead(426).end());
    server.on('upgrade', (request: IncomingMessage, socket: Socket) => {
      sockets.add(socket);
      seen.push({ url: request.url ?? '', headers: request.headers });
      socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');
      socket.on('data', chunk => socket.write(`echo:${String(chunk)}`));
    });
    return { port: await listen(server), seen };
  }

  function upgrade(port: number, path: string, headers: OutgoingHttpHeaders) {
    return new Promise<{ kind: 'upgraded'; socket: Socket } | { kind: 'refused'; status: number }>((resolve, reject) => {
      const outgoing = httpRequest({ host: '127.0.0.1', port, path, agent: false, headers: { Connection: 'Upgrade', Upgrade: 'websocket', ...headers } });
      outgoing.on('upgrade', (_reply, socket: Socket) => { sockets.add(socket); resolve({ kind: 'upgraded', socket }); });
      outgoing.on('response', reply => { reply.resume(); resolve({ kind: 'refused', status: reply.statusCode ?? 0 }); });
      outgoing.on('error', reject);
      outgoing.end();
    });
  }

  it('rewrites the request head (prefix and forwarding headers) and then relays bytes both ways', async () => {
    const upstream = await socketUpstream();
    const port = await gateway(target(upstream.port, '/live-realm-data'));
    const result = await upgrade(port, '/live-realm-data/kingdom/abc?sessionId=1', {
      'X-Forwarded-For': '6.6.6.6', Forwarded: 'for=6.6.6.6', 'Sec-WebSocket-Protocol': 'colyseus', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
    });
    if (result.kind !== 'upgraded') throw new Error(`expected an upgrade, got ${result.status}`);
    const [seen] = upstream.seen;
    expect(seen?.url).toBe('/kingdom/abc?sessionId=1');
    expect(seen?.headers['x-forwarded-for']).toBe('127.0.0.1');
    expect(seen?.headers['x-forwarded-proto']).toBe('https');
    expect(seen?.headers.forwarded).toBeUndefined();
    expect(seen?.headers.upgrade).toBe('websocket');
    expect(seen?.headers.connection).toBe('Upgrade');
    expect(seen?.headers['sec-websocket-protocol']).toBe('colyseus');
    expect(seen?.headers['sec-websocket-key']).toBe('dGhlIHNhbXBsZSBub25jZQ==');

    const echoed = new Promise<string>(resolve => result.socket.once('data', chunk => resolve(String(chunk))));
    result.socket.write('ping');
    expect(await echoed).toBe('echo:ping');
  });

  it('answers 503 on the raw socket when the service behind it is down', async () => {
    const port = await gateway(target(await closedPort()));
    expect(await upgrade(port, '/live-realm-data/kingdom/abc', {})).toEqual({ kind: 'refused', status: 503 });
  });
});
