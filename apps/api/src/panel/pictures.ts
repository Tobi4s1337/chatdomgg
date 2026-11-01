import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface Painting { capturedAt: number; revision: string; kind: 'realm' | 'sketch' }
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
      return validWebp(bytes) ? { ...value, bytes } : null;
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
