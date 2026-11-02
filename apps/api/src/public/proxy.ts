import { Agent, request as httpRequest, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from 'node:http';
import { connect, isIP, type Socket } from 'node:net';
import type { Duplex } from 'node:stream';

/** A loopback service behind the public origin. `strip` removes the public prefix before forwarding. */
export interface ProxyTarget {
  readonly name: string;
  readonly host: string;
  readonly port: number;
  readonly strip?: string;
}

export function parseTarget(name: string, value: string, strip?: string): ProxyTarget {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(`${name} must be an http://host:port address`); }
  if (url.protocol !== 'http:' || !url.port || url.pathname !== '/' || url.search) throw new Error(`${name} must be an http://host:port address`);
  return { name, host: url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port), ...(strip ? { strip } : {}) };
}

// Hop-by-hop headers never cross a proxy (RFC 9110 §7.6.1).
const HOP = new Set(['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'te', 'trailer', 'upgrade', 'proxy-authorization', 'proxy-authenticate']);
const agent = new Agent({ keepAlive: true, maxSockets: 512, maxFreeSockets: 64, timeout: 60_000 });

function forwardedPath(target: ProxyTarget, url: string): string {
  if (!target.strip || !url.startsWith(target.strip)) return url;
  const rest = url.slice(target.strip.length);
  return rest.startsWith('/') ? rest : `/${rest}`;
}

/** Whether a peer is the host's own TLS proxy, whose `X-Forwarded-For` entry for the visitor is believed. */
export type TrustedProxies = (address: string) => boolean;

const plain = (address: string) => address.replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '');
function ipv4(address: string): number | null {
  if (isIP(address) !== 4) return null;
  return address.split('.').reduce((value, part) => value * 256 + Number(part), 0);
}

/**
 * Reads a comma-separated list of IPv4 ranges (`172.17.0.0/16`) and single addresses (IPv4 or IPv6). An empty value
 * trusts nobody. Errors name the setting, never its value.
 */
export function parseTrustedProxies(name: string, value: string | undefined): TrustedProxies | null {
  const items = (value ?? '').split(',').map(item => item.trim()).filter(Boolean);
  if (!items.length) return null;
  const ranges: { base: number; mask: number }[] = [];
  const exact = new Set<string>();
  for (const item of items) {
    const [address = '', bits, extra] = item.split('/');
    if (extra !== undefined) throw new Error(`${name} must list IPv4 ranges or single addresses, comma separated`);
    if (bits === undefined && isIP(address)) { exact.add(plain(address).toLowerCase()); continue; }
    const base = ipv4(address), prefix = Number(bits);
    if (base === null || !/^\d{1,2}$/.test(bits ?? '') || prefix > 32) throw new Error(`${name} must list IPv4 ranges or single addresses, comma separated`);
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    ranges.push({ base: (base & mask) >>> 0, mask });
  }
  return address => {
    const bare = plain(address).toLowerCase();
    if (exact.has(bare)) return true;
    const value = ipv4(bare);
    return value !== null && ranges.some(range => ((value & range.mask) >>> 0) === range.base);
  };
}

/**
 * The visitor's address. A peer that is not a trusted proxy is the visitor. Behind a trusted proxy, the visitor is
 * the right-most `X-Forwarded-For` entry that is not itself a trusted proxy: entries to its left were written by the
 * browser and are never believed. A malformed or missing entry falls back to the peer.
 */
export function clientAddress(source: IncomingHttpHeaders, peer: string | undefined, trusted?: TrustedProxies | null): string | undefined {
  if (!peer || !trusted || !trusted(peer)) return peer;
  const raw = source['x-forwarded-for'];
  const entries = (Array.isArray(raw) ? raw.join(',') : raw ?? '').split(',').map(entry => entry.trim()).filter(Boolean);
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = plain(entries[index]!);
    if (!isIP(entry)) return peer;
    if (!trusted(entry)) return entry;
  }
  return peer;
}

/**
 * Headers for the upstream request. The browser's own `X-Forwarded-*` claims are discarded and replaced with what
 * this process saw, so a visitor can never pose as another address or scheme.
 */
function upstreamHeaders(source: IncomingHttpHeaders, remote: string | undefined, publicProto: string): Record<string, string | string[]> {
  const headers: Record<string, string | string[]> = {};
  const listed = new Set(String(source.connection ?? '').toLowerCase().split(',').map(token => token.trim()).filter(Boolean));
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined || HOP.has(name) || listed.has(name) || name.startsWith('x-forwarded-') || name === 'forwarded') continue;
    headers[name] = value;
  }
  if (remote) headers['x-forwarded-for'] = remote;
  headers['x-forwarded-proto'] = publicProto;
  return headers;
}

const UNAVAILABLE = JSON.stringify({ version: 1, status: 'unavailable', message: 'This part of the kingdom is not answering right now. Nothing has changed; try again in a moment.' });
function unavailable(response: ServerResponse) {
  if (response.headersSent) { response.destroy(); return; }
  response.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': '5' }).end(UNAVAILABLE);
}

/** Forwards one HTTP request (including long-lived SSE) and streams the answer back unbuffered. */
export function proxyHttp(target: ProxyTarget, request: IncomingMessage, response: ServerResponse, publicProto: string, trusted?: TrustedProxies | null): void {
  const upstream = httpRequest({
    host: target.host, port: target.port, method: request.method, path: forwardedPath(target, request.url ?? '/'),
    headers: upstreamHeaders(request.headers, clientAddress(request.headers, request.socket.remoteAddress, trusted), publicProto), agent,
  }, reply => {
    const headers: Record<string, string | string[]> = {};
    for (const [name, value] of Object.entries(reply.headers)) if (value !== undefined && !HOP.has(name)) headers[name] = value;
    // Server-sent events must not wait in any buffer between the realm and the browser.
    if (String(reply.headers['content-type'] ?? '').startsWith('text/event-stream')) { headers['x-accel-buffering'] = 'no'; response.setTimeout(0); }
    response.writeHead(reply.statusCode ?? 502, headers);
    reply.pipe(response);
    reply.on('error', () => response.destroy());
  });
  upstream.on('error', () => unavailable(response));
  response.on('close', () => { if (!response.writableFinished) upstream.destroy(); });
  request.pipe(upstream);
}

/**
 * Hands a WebSocket upgrade to the target over a raw socket: the request head is rewritten (prefix, forwarded
 * headers), then bytes flow both ways untouched. Colyseus frames, compression and close codes pass as they are.
 */
export function proxyUpgrade(target: ProxyTarget, request: IncomingMessage, socket: Duplex, head: Buffer, publicProto: string, trusted?: TrustedProxies | null): void {
  const upstream: Socket = connect({ host: target.host, port: target.port });
  const fail = () => { if (!socket.destroyed) socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); upstream.destroy(); };
  upstream.setNoDelay(true);
  upstream.once('error', fail);
  upstream.once('connect', () => {
    upstream.removeListener('error', fail);
    const headers = upstreamHeaders(request.headers, clientAddress(request.headers, request.socket.remoteAddress, trusted), publicProto);
    const lines = [`${request.method ?? 'GET'} ${forwardedPath(target, request.url ?? '/')} HTTP/1.1`];
    for (const [name, value] of Object.entries(headers)) for (const item of Array.isArray(value) ? value : [value]) lines.push(`${name}: ${item}`);
    lines.push('Connection: Upgrade', `Upgrade: ${String(request.headers.upgrade ?? 'websocket')}`);
    upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
    if (head.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  // A refusal already ended the visitor's socket with a 503; let it flush instead of cutting it off.
  const release = () => { if (!socket.writableEnded) socket.destroy(); };
  socket.on('error', () => { upstream.destroy(); socket.destroy(); });
  upstream.on('error', () => { upstream.destroy(); release(); });
  socket.on('close', () => upstream.destroy());
  upstream.on('close', release);
}

/** Small JSON GET against a loopback service, for health and the door's kingdom names. */
export function fetchTargetJson(target: ProxyTarget, path: string, timeoutMs = 2_500): Promise<{ status: number; body: unknown }> {
  return new Promise(resolve => {
    const upstream = httpRequest({ host: target.host, port: target.port, path, method: 'GET', agent, headers: { Accept: 'application/json' }, timeout: timeoutMs }, reply => {
      const chunks: Buffer[] = [];
      let size = 0;
      reply.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 65_536) reply.destroy(); else chunks.push(chunk); });
      reply.on('end', () => {
        let body: unknown;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { body = null; }
        resolve({ status: reply.statusCode ?? 0, body });
      });
      reply.on('error', () => resolve({ status: 0, body: null }));
    });
    upstream.on('timeout', () => upstream.destroy());
    upstream.on('error', () => resolve({ status: 0, body: null }));
    upstream.end();
  });
}
