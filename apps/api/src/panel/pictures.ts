import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** One lit window in a painting: its public slot and where it sits, in ten-thousandths of the width and height. */
export type PaintedWindow = readonly [slot: number, x: number, y: number];
export interface Painting { capturedAt: number; revision: string; kind: 'realm' | 'sketch'; windows?: readonly PaintedWindow[] }
export const MAX_PAINTED_WINDOWS = 400;
const windowList = (value: unknown): value is readonly PaintedWindow[] => Array.isArray(value) && value.length <= MAX_PAINTED_WINDOWS
  && value.every(entry => Array.isArray(entry) && entry.length === 3 && entry.every(part => Number.isSafeInteger(part) && part >= 0)
    && entry[0] <= 65535 && entry[1] <= 10_000 && entry[2] <= 10_000);
/** Reads the painter's `slot:x:y,…` header. A malformed list refuses the upload rather than guessing. */
export function parsePaintedWindows(header: unknown): readonly PaintedWindow[] | null {
  if (header === undefined || header === '') return [];
  if (typeof header !== 'string' || header.length > 8 * 1024 || !/^\d{1,5}:\d{1,5}:\d{1,5}(,\d{1,5}:\d{1,5}:\d{1,5})*$/.test(header)) return null;
  const windows = header.split(',').map(entry => entry.split(':').map(Number) as unknown as PaintedWindow);
  return windowList(windows) && new Set(windows.map(([slot]) => slot)).size === windows.length ? windows : null;
}
export interface StoredPainting extends Painting { bytes: Buffer }
/** Small, atomic files survive gateway restarts; the extension can only read its token's own channel. */
export class PanelPictures {
  constructor(private readonly directory: string) {}
  private path(channel: string) { return join(this.directory, `${channel}.json`); }
  async read(channel: string): Promise<StoredPainting | null> {
    try {
      const value = JSON.parse(await readFile(this.path(channel), 'utf8')) as Painting & { data: string };
      if (!Number.isSafeInteger(value.capturedAt) || typeof value.revision !== 'string' || !['realm', 'sketch'].includes(value.kind)) return null;
      const bytes = Buffer.from(value.data, 'base64');
      return validWebp(bytes) ? { capturedAt: value.capturedAt, revision: value.revision, kind: value.kind, windows: windowList(value.windows) ? value.windows : [], bytes } : null;
    } catch { return null; }
  }
  private queue: Promise<unknown> = Promise.resolve();
  async put(channel: string, bytes: Buffer, metadata: Painting): Promise<boolean> {
    const task = this.queue.then(async () => {
      const old = await this.read(channel);
      if (old && old.capturedAt >= metadata.capturedAt) return false;
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const target = this.path(channel), temporary = `${target}.${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}.tmp`;
      await writeFile(temporary, JSON.stringify({ ...metadata, data: bytes.toString('base64') }), { mode: 0o600 });
      await rename(temporary, target);
      return true;
    });
    this.queue = task.catch(() => undefined);
    return task;
  }
}
export function validWebp(bytes: Buffer): boolean {
  return bytes.length >= 20 && bytes.length <= 60 * 1024 && bytes.toString('ascii', 0, 4) === 'RIFF'
    && bytes.toString('ascii', 8, 12) === 'WEBP' && bytes.readUInt32LE(4) + 8 === bytes.length;
}
