// Two recordings of the same frames must be byte-identical: every studio frame is a pure function of
// (shot, t), and the recorder's virtual clock leaves nothing to the host's speed. Runs headless Chrome here
// (DOM page plates only; the player is keyed) under the shared capture lock.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error: plain ESM modules without types
import { record } from './record.mjs';
// @ts-expect-error: plain ESM module without types
import { acquireCaptureLock } from '../../../packages/testing/capture-lock.mjs';

interface Sidecar { frames: { frame: number; sha256: string; clock: number }[] }

describe('frame-stepped recording', () => {
  it('records the same frames twice, byte for byte', async () => {
    const release = await acquireCaptureLock();
    const dirs = [mkdtempSync(join(tmpdir(), 'studio-a-')), mkdtempSync(join(tmpdir(), 'studio-b-'))];
    try {
      const takes: Sidecar[] = [];
      for (const out of dirs) {
        // S02 with the player keyed, during its camera push: chat, header and the panel iframe, frames 60–65 (1.0–1.1 s).
        takes.push(await record({ url: '/studio/?shot=S02&player=key', out, from: 1.0, to: 1.1, fps: 60, alpha: true }) as Sidecar);
      }
      const [a, b] = takes as [Sidecar, Sidecar];
      expect(a.frames.length).toBe(6);
      expect(a.frames.map(f => f.sha256)).toEqual(b.frames.map(f => f.sha256));
      expect(a.frames.map(f => f.clock)).toEqual(b.frames.map(f => f.clock));
      // The frames differ from each other (the cursor and chat move), so equality is not trivial.
      expect(new Set(a.frames.map(f => f.sha256)).size).toBeGreaterThan(1);
    } finally {
      for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
      await release();
    }
  // Most of this is the wait for the shared capture lock, which other lanes may hold for minutes.
  }, 1_800_000);
});
