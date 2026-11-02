import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, relative, sep } from 'node:path';

/**
 * The built web app, served from memory-resident metadata. The file list is read once at start, so a request
 * can never name a path outside the build (no traversal, no symlink surprises), and every answer is decided
 * without touching the disk except to stream the bytes. Hashed assets are immutable for a year; pages are
 * revalidated on every visit so a new build reaches everyone at once.
 */
export interface StaticFile {
  readonly path: string;
  readonly size: number;
  readonly type: string;
  readonly etag: string;
  readonly immutable: boolean;
  /** Precompressed siblings written by the public build (`.br`, `.gz`), when smaller. */
  readonly encodings: ReadonlyMap<'br' | 'gzip', { readonly path: string; readonly size: number }>;
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif',
  '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
  '.wasm': 'application/wasm', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.wav': 'audio/wav',
  '.m4a': 'audio/mp4', '.mp4': 'video/mp4', '.webm': 'video/webm', '.txt': 'text/plain; charset=utf-8',
  '.vox': 'application/octet-stream', '.bin': 'application/octet-stream', '.glb': 'model/gltf-binary',
  '.webmanifest': 'application/manifest+json',
};
const COMPRESSED_SIBLING = /\.(?:br|gz)$/;

/** Walks the build once. Paths are URL paths (`/assets/x.js`), files are absolute. */
export async function indexBuild(root: string): Promise<Map<string, StaticFile>> {
  const files = new Map<string, StaticFile>();
  const all = new Map<string, { path: string; size: number; mtimeMs: number }>();
  const walk = async (dir: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) { const info = await stat(path); all.set(path, { path, size: info.size, mtimeMs: info.mtimeMs }); }
    }
  };
  await walk(root);
  for (const file of all.values()) {
    if (COMPRESSED_SIBLING.test(file.path) && all.has(file.path.replace(COMPRESSED_SIBLING, ''))) continue;
    const url = `/${relative(root, file.path).split(sep).join('/')}`;
    const encodings = new Map<'br' | 'gzip', { path: string; size: number }>();
    for (const [suffix, name] of [['.br', 'br'], ['.gz', 'gzip']] as const) {
      const sibling = all.get(`${file.path}${suffix}`);
      if (sibling && sibling.size < file.size) encodings.set(name, { path: sibling.path, size: sibling.size });
    }
    files.set(url, {
      path: file.path, size: file.size, type: TYPES[extname(file.path).toLowerCase()] ?? 'application/octet-stream',
      etag: `"${file.size.toString(36)}-${Math.floor(file.mtimeMs).toString(36)}"`,
      // Vite names every emitted asset with a content hash; only those may be cached forever.
      immutable: /^\/(?:assets|site\/assets)\//.test(url) && /[-.][A-Za-z0-9_-]{8,}\.[a-z0-9]+$/.test(url),
      encodings,
    });
  }
  return files;
}

function acceptsEncoding(request: IncomingMessage, name: 'br' | 'gzip'): boolean {
  const header = request.headers['accept-encoding'];
  if (typeof header !== 'string') return false;
  return header.split(',').some(part => {
    const [token, ...params] = part.trim().split(';');
    if (token?.trim().toLowerCase() !== name) return false;
    const q = params.map(p => p.trim()).find(p => p.startsWith('q='));
    return !q || Number(q.slice(2)) > 0;
  });
}

/** Streams one indexed file with caching, conditional requests and precompressed bodies. */
export function sendFile(request: IncomingMessage, response: ServerResponse, file: StaticFile, headers: Record<string, string> = {}, status = 200): void {
  const encoding = (['br', 'gzip'] as const).find(name => file.encodings.has(name) && acceptsEncoding(request, name));
  const body = encoding ? file.encodings.get(encoding)! : { path: file.path, size: file.size };
  const common: Record<string, string> = {
    'Content-Type': file.type,
    'Cache-Control': file.immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    ETag: file.etag, Vary: 'Accept-Encoding', ...headers,
  };
  if (status === 200 && request.headers['if-none-match'] === file.etag) {
    response.writeHead(304, common).end();
    return;
  }
  response.writeHead(status, { ...common, 'Content-Length': String(body.size), ...(encoding ? { 'Content-Encoding': encoding } : {}) });
  if (request.method === 'HEAD') { response.end(); return; }
  const stream = createReadStream(body.path);
  stream.on('error', () => response.destroy());
  stream.pipe(response);
}
