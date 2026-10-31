import { describe, expect, it } from 'vitest';
import { MATERIALS, MAT } from '@chatdom/content';
import { compileEmote } from './compile';
import { decodeEmoteImage } from './decode/index';
import { toadWaveAnimatedFixture } from './fixtures/toad-wave-animated';
import { sampleEmoteFrame } from './render/sample';

const PALETTE = [MAT.stone, MAT.limestone, MAT.darkStone, MAT.cream, MAT.cloth, MAT.grass, MAT.leaf, MAT.fabricGreen, MAT.goldLeaf, MAT.fabricRed, MAT.petal, MAT.hairBlack];

const cache = new Map<string, ReturnType<typeof compile>>();
const compiled = (purpose: 'statue' | 'heraldry') => { if (!cache.has(purpose)) cache.set(purpose, compile(purpose)); return cache.get(purpose)!; };

async function compile(purpose: 'statue' | 'heraldry') {
  const { source, bytes } = toadWaveAnimatedFixture();
  const decoded = await decodeEmoteImage(bytes, source.rendition, new AbortController().signal);
  if (!decoded.ok) throw new Error(decoded.message);
  expect(decoded.sourceHash).toBe(source.sourceHash);
  const result = compileEmote({ source, decoded: decoded.decoded }, MATERIALS, PALETTE, { purpose, paletteRevision: 1 });
  if (!result.ok) throw new Error(result.message);
  return result.emote;
}

/** Front-face silhouette of one compiled frame, as rows of 0/1, x left to right and Y up. */
function front(frame: { blueprint: { size: readonly number[]; boxes: readonly { from: readonly number[]; to: readonly number[] }[] } }): Uint8Array {
  const [w, h] = frame.blueprint.size as [number, number, number], mask = new Uint8Array(w * h);
  for (const box of frame.blueprint.boxes) for (let y = box.from[1]!; y < box.to[1]!; y++) for (let x = box.from[0]!; x < box.to[0]!; x++) mask[x + y * w] = 1;
  return mask;
}

// Carving eight statue frames takes a few seconds on a shared host; each purpose is compiled once.
describe('An animated emote through the real decoder and compiler', { timeout: 60_000 }, () => {
  it('keeps one voxel frame per decoded frame, with authored timing', async () => {
    const statue = await compiled('statue');
    expect(statue.frames.length).toBe(8);
    expect(statue.frames.map(f => f.durationMs)).toEqual([480, 90, 90, 110, 120, 90, 90, 100]);
    expect(statue.periodMs).toBe(1170);
  });

  it('carves distinct frames on one shared grid, so the body never drifts while the arm waves', async () => {
    const statue = await compiled('statue');
    const sizes = new Set(statue.frames.map(f => f.blueprint.size.join('x')));
    expect(sizes.size).toBe(1);
    const masks = statue.frames.map(front), [w] = statue.frames[0]!.blueprint.size as [number, number, number];
    const signature = (mask: Uint8Array) => mask.join('');
    // Rest, up, mid and high are all different shapes.
    expect(new Set([0, 1, 2, 3].map(i => signature(masks[i]!))).size).toBe(4);
    // The left half (open eye, cheek, bumps) is never touched by the waving arm: identical in every frame.
    const left = (mask: Uint8Array) => [...mask].filter((_, i) => i % w < w * .45).join('');
    for (const mask of masks) expect(left(mask)).toBe(left(masks[0]!));
  });

  it('samples variable frame durations deterministically from caller time', async () => {
    const statue = await compiled('heraldry');
    expect([0, 479, 480, 569, 570, 1169, 1170, 1170 * 5 + 481].map(t => sampleEmoteFrame(statue, t).index)).toEqual([0, 0, 1, 1, 2, 7, 0, 1]);
    expect(sampleEmoteFrame({ frames: [{ durationMs: 0 }], periodMs: 0 }, 12345).index).toBe(0);
    expect(sampleEmoteFrame(statue, Number.NaN).index).toBe(0);
  });
});
