import { describe, expect, it } from 'vitest';
import { createCastleModule, createHearthHome, createHome, createTideHome } from '@chatdom/content';
import { createLibraryMotif } from '@chatdom/content/forge-library';
import { FORGE_LIBRARY_MOTIFS, FORGE_PIECE_MOTIFS, FORGE_ROOF_SLOTS, ForgePiecePlanSchema, type ForgePiecePlan, type HomeTier, type VoxelBlueprint } from '@chatdom/shared';
import { assembleForgePiece, checkForgePiece, findForgePlaces, forgePieceKit, forgeStyleKit, frontRelief } from './index';

const FAMILIES = ['hearth', 'tide', 'grove'] as const;
const TIERS: HomeTier[] = ['hut', 'cottage', 'house', 'manor', 'hall'];
const homeOf = (family: (typeof FAMILIES)[number], tier: HomeTier, variant: 0 | 1 | 2): VoxelBlueprint =>
  family === 'hearth' ? createHearthHome(tier, variant) : family === 'tide' ? createTideHome(tier, variant) : createHome(tier, family, variant);
const plan = (slot: ForgePiecePlan['slot'], motif: ForgePiecePlan['motif'], finish: ForgePiecePlan['finish'] = 'native'): ForgePiecePlan => ({ version: 3, slot, motif, finish, accent: 'none' });

describe('Forge pieces on every street home', () => {
  it.each(FAMILIES)('every accepted slot fits every place of every %s home, for every kingdom kit', family => {
    const misfits: string[] = [];
    let built = 0, turn = 0;
    for (const tier of TIERS) for (const variant of [0, 1, 2] as const) {
      const home = homeOf(family, tier, variant), places = findForgePlaces(home);
      // Every home carries all six roof slots.
      for (const slot of FORGE_ROOF_SLOTS) expect(places.some(p => p.accepts.includes(slot)), `${home.id} ${slot}`).toBe(true);
      for (const kitFamily of FAMILIES) for (const place of places) for (const slot of place.accepts) {
        const motif = FORGE_PIECE_MOTIFS[(turn++ * 7) % FORGE_PIECE_MOTIFS.length]!;
        try { checkForgePiece(assembleForgePiece(plan(slot, motif, (['native', 'copper', 'ceramic'] as const)[turn % 3]), forgePieceKit(kitFamily), place, home), home); built++; }
        catch (error) { misfits.push(`${slot} ${motif} ${home.id}: ${(error as Error).message}`); }
      }
    }
    expect(misfits).toEqual([]);
    expect(built).toBeGreaterThan(300);
  }, 240_000);

  it('places never overlap, and a home always gives the same places', () => {
    const home = createHome('hall', 'grove', 2), places = findForgePlaces(home);
    const fronts = places.filter(p => p.group !== 'roof');
    for (const a of fronts) for (const b of fronts) if (a !== b) {
      const apart = [0, 1, 2].some(i => a.origin[i]! + a.size[i]! <= b.origin[i]! || b.origin[i]! + b.size[i]! <= a.origin[i]!);
      expect(apart, `${a.id} ${b.id}`).toBe(true);
    }
    expect(findForgePlaces(structuredClone(home))).toEqual(places);
    expect(new Set(places.map(p => p.id)).size).toBe(places.length);
  });

  it('roof places keep the revision-2 socket ids and origins, so a new piece replaces the old one on its spot', () => {
    const home = createHearthHome('cottage', 1);
    for (const place of findForgePlaces(home).filter(p => p.group === 'roof')) expect(place.origin).toEqual(place.socket!.origin);
  });

  it('is deterministic and rejects what does not belong', () => {
    const home = createTideHome('house', 0), places = findForgePlaces(home), kit = forgePieceKit('tide');
    const roof = places.find(p => p.accepts.includes('banner'))!;
    const a = assembleForgePiece(plan('banner', 'whale'), kit, roof, home), b = assembleForgePiece(plan('banner', 'whale'), kit, roof, structuredClone(home));
    expect(a.blueprint).toEqual(b.blueprint);
    expect(() => assembleForgePiece(plan('bench', 'whale'), kit, roof, home)).toThrow('does not fit this place');
    expect(() => assembleForgePiece(plan('banner', 'whale'), forgeStyleKit('tide', 2), roof, home)).toThrow('Unregistered');
    expect(() => assembleForgePiece(plan('hat', 'whale'), kit, roof, home)).toThrow('worn');
    const moved = structuredClone(home); moved.boxes.push({ from: [0, 0, 0], to: [1, 1, 1], material: 3 });
    expect(() => assembleForgePiece(plan('banner', 'whale'), kit, roof, moved)).toThrow('house changed');
    expect(() => checkForgePiece({ ...a, blueprint: { ...a.blueprint, boxes: a.blueprint.boxes.slice(1) } }, home)).toThrow('differs');
    expect(ForgePiecePlanSchema.safeParse({ ...plan('banner', 'whale'), motif: 'dragonfly-of-doom' }).success).toBe(false);
  });

  it.each(FAMILIES)('the roof slots fit the %s castle keep', family => {
    const keep = createCastleModule('keep', [32, 31, 32], family), places = findForgePlaces(keep, 'castle-keep');
    expect(places.length).toBeGreaterThan(0);
    expect(places.every(p => p.group === 'roof' && p.hostProfile === 'castle-keep')).toBe(true);
    let built = 0;
    for (const place of places) for (const slot of place.accepts) {
      checkForgePiece(assembleForgePiece(plan(slot, 'crown'), forgePieceKit(family), place, keep), keep, 'castle-keep');
      built++;
    }
    expect(built).toBeGreaterThanOrEqual(4);
  }, 120_000);
});

describe('the Forge library', () => {
  it.each(FAMILIES)('carves all forty motifs in the %s palette, each legible as a front relief', family => {
    for (const id of FORGE_LIBRARY_MOTIFS) {
      const motif = createLibraryMotif(id, family);
      expect(motif.size, id).toEqual([24, 16, 18]);
      const relief = frontRelief(motif);
      expect(relief.size, id).toEqual([12, 8, 2]);
      const cells = relief.boxes.reduce((n, b) => n + (b.to[0] - b.from[0]) * (b.to[1] - b.from[1]) * (b.to[2] - b.from[2]), 0);
      expect(cells, id).toBeGreaterThan(24);
    }
  });
});
