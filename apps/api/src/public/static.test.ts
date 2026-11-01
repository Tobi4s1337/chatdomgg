import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer, request as httpRequest, type IncomingHttpHeaders, type OutgoingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { brotliCompressSync, brotliDecompressSync, gunzipSync, gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { indexBuild, sendFile, type StaticFile } from './static';

// A small build on disk: an app page, hashed assets with precompressed siblings, and a few odd cases.
const SCRIPT = `export const kingdom = ${JSON.stringify('lantern '.repeat(400))};\n`;
let outside: string, root: string, files: Map<string, StaticFile>, server: Server, port: number;

async function put(path: string, content: string | Buffer) {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), content);
}

beforeAll(async () => {
  outside = await mkdtemp(join(tmpdir(), 'chatdom-static-'));
  root = join(outside, 'dist');
  await mkdir(root);
  await writeFile(join(outside, 'secret.txt'), 'not part of the build');
  await put('index.html', '<!doctype html><title>Chatdom</title>');
  await put('assets/index-AbCdEf12.js', SCRIPT);
  await put('assets/index-AbCdEf12.js.br', brotliCompressSync(SCRIPT));
  await put('assets/index-AbCdEf12.js.gz', gzipSync(SCRIPT));
  await put('assets/logo.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');
  await put('site/assets/site-Qr5tUv78.css', 'body{margin:0}');
  await put('site/index.html', '<!doctype html><title>Door</title>');
  // A sibling that came out larger than its original is never offered.
  await put('tiny.txt', 'hi');
  await put('tiny.txt.gz', gzipSync('hi'));
  // A compressed file with no original beside it is a file in its own right.
  await put('archive.gz', gzipSync('archive'));
  await put('models/Tower.GLB', Buffer.from([1, 2, 3]));
  await put('data/blob.unknownext', 'x');
  await symlink(join(outside, 'secret.txt'), join(root, 'escape.txt'));
  files = await indexBuild(root);

  server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://static.invalid');
    const file = files.get(url.pathname);
    if (!file) { response.writeHead(404).end(); return; }
    if (url.searchParams.has('missing')) sendFile(request, response, files.get('/index.html')!, { 'X-Page': 'door' }, 404);
    else sendFile(request, response, file, url.searchParams.has('page') ? { 'X-Page': 'app' } : {});
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>(done => server.close(() => done()));
  await rm(outside, { recursive: true, force: true });
});

function get(path: string, headers: OutgoingHttpHeaders = {}, method = 'GET') {
  return new Promise<{ status: number; headers: IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
    const outgoing = httpRequest({ host: '127.0.0.1', port, path, method, headers, agent: false }, reply => {
      const chunks: Buffer[] = [];
      reply.on('data', (chunk: Buffer) => chunks.push(chunk));
      reply.on('end', () => resolve({ status: reply.statusCode ?? 0, headers: reply.headers, body: Buffer.concat(chunks) }));
    });
    outgoing.on('error', reject);
    outgoing.end();
  });
}

describe('indexBuild', () => {
  it('lists every built file by its URL path, and only files inside the build', () => {
    expect([...files.keys()].sort()).toEqual([
      '/archive.gz', '/assets/index-AbCdEf12.js', '/assets/logo.svg', '/data/blob.unknownext', '/index.html',
      '/models/Tower.GLB', '/site/assets/site-Qr5tUv78.css', '/site/index.html', '/tiny.txt',
    ]);
    // A symlink out of the build is not followed, and no lookup can climb out of it.
    expect(files.get('/escape.txt')).toBeUndefined();
    expect(files.get('/../secret.txt')).toBeUndefined();
    expect(files.get('/assets/../../secret.txt')).toBeUndefined();
    for (const file of files.values()) expect(file.path.startsWith(`${root}/`)).toBe(true);
  });

  it('marks only content-hashed assets as immutable', () => {
    expect(files.get('/assets/index-AbCdEf12.js')?.immutable).toBe(true);
    expect(files.get('/site/assets/site-Qr5tUv78.css')?.immutable).toBe(true);
    expect(files.get('/assets/logo.svg')?.immutable).toBe(false);
    expect(files.get('/index.html')?.immutable).toBe(false);
    expect(files.get('/tiny.txt')?.immutable).toBe(false);
  });

  it('offers a precompressed sibling only when it is smaller', () => {
    expect([...files.get('/assets/index-AbCdEf12.js')!.encodings.keys()].sort()).toEqual(['br', 'gzip']);
    expect(files.get('/tiny.txt')?.encodings.size).toBe(0);
  });

  it('knows the content type of each file by extension, whatever its case', () => {
    expect(files.get('/index.html')?.type).toBe('text/html; charset=utf-8');
    expect(files.get('/assets/index-AbCdEf12.js')?.type).toBe('text/javascript; charset=utf-8');
    expect(files.get('/site/assets/site-Qr5tUv78.css')?.type).toBe('text/css; charset=utf-8');
    expect(files.get('/assets/logo.svg')?.type).toBe('image/svg+xml');
    expect(files.get('/models/Tower.GLB')?.type).toBe('model/gltf-binary');
    expect(files.get('/data/blob.unknownext')?.type).toBe('application/octet-stream');
  });
});

describe('sendFile', () => {
  it('caches hashed assets for a year and revalidates everything else', async () => {
    const asset = await get('/assets/index-AbCdEf12.js');
    expect(asset.status).toBe(200);
    expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(asset.headers.vary).toBe('Accept-Encoding');
    const page = await get('/index.html?page');
    expect(page.headers['cache-control']).toBe('no-cache');
    expect(page.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(page.headers['x-page']).toBe('app');
    expect(page.body.toString()).toBe('<!doctype html><title>Chatdom</title>');
  });

  it('answers 304 to a matching ETag, and the whole file to a stale one', async () => {
    const first = await get('/assets/logo.svg');
    const etag = first.headers.etag;
    expect(etag).toMatch(/^"[0-9a-z]+-[0-9a-z]+"$/);
    const again = await get('/assets/logo.svg', { 'If-None-Match': etag });
    expect(again.status).toBe(304);
    expect(again.body.length).toBe(0);
    expect(again.headers.etag).toBe(etag);
    const stale = await get('/assets/logo.svg', { 'If-None-Match': '"0-0"' });
    expect(stale.status).toBe(200);
    expect(stale.body.toString()).toBe('<svg xmlns="http://www.w3.org/2000/svg"/>');
  });

  it('never answers 304 for a page sent under another status', async () => {
    const etag = files.get('/index.html')!.etag;
    const missing = await get('/index.html?missing', { 'If-None-Match': etag });
    expect(missing.status).toBe(404);
    expect(missing.headers['x-page']).toBe('door');
    expect(missing.body.toString()).toBe('<!doctype html><title>Chatdom</title>');
  });

  it('chooses brotli, then gzip, then the plain file by what the browser accepts', async () => {
    const original = Buffer.from(SCRIPT);
    const brotli = await get('/assets/index-AbCdEf12.js', { 'Accept-Encoding': 'gzip, deflate, br' });
    expect(brotli.headers['content-encoding']).toBe('br');
    expect(Number(brotli.headers['content-length'])).toBe(brotli.body.length);
    expect(brotliDecompressSync(brotli.body)).toEqual(original);

    const gzip = await get('/assets/index-AbCdEf12.js', { 'Accept-Encoding': 'br;q=0, gzip;q=0.8' });
    expect(gzip.headers['content-encoding']).toBe('gzip');
    expect(gunzipSync(gzip.body)).toEqual(original);

    for (const accept of [undefined, 'identity', 'deflate', 'br;q=0, gzip;q=0']) {
      const plain = await get('/assets/index-AbCdEf12.js', accept ? { 'Accept-Encoding': accept } : {});
      expect(plain.headers['content-encoding'], accept).toBeUndefined();
      expect(plain.headers['content-length']).toBe(String(original.length));
      expect(plain.body).toEqual(original);
    }
    // A larger sibling is never chosen, even when the browser would take it.
    const tiny = await get('/tiny.txt', { 'Accept-Encoding': 'gzip' });
    expect(tiny.headers['content-encoding']).toBeUndefined();
    expect(tiny.body.toString()).toBe('hi');
  });

  it('answers HEAD with the headers of the full answer and no body', async () => {
    const head = await get('/assets/index-AbCdEf12.js', { 'Accept-Encoding': 'br' }, 'HEAD');
    expect(head.status).toBe(200);
    expect(head.headers['content-encoding']).toBe('br');
    expect(head.headers['content-length']).toBe(String(files.get('/assets/index-AbCdEf12.js')!.encodings.get('br')!.size));
    expect(head.body.length).toBe(0);
  });
});
