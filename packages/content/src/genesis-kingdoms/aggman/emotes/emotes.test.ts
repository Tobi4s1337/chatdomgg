import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
// The frozen recipe compiler and the observed channel facts, as the emote art adapter's own tests import them.
import { compileChannelGenesis } from '../../../../../world/src/genesis/index';
import { OBSERVED_GENESIS_FIXTURES } from '../../../../../world/src/genesis/observed-fixtures';
import { decodeEmoteBytes } from '../../../genesis-emotes/deps';
import { derivativeRasterHash } from '../../../genesis-emotes/derivatives';
import { composeGenesisEmoteArt, type EmoteArtRecipe } from '../../../genesis-emotes/index';
import { AGGMAN_BROADCASTER, AGGMAN_EMOTE_CHECKS, AGGMAN_EMOTE_SOURCES, aggmanApprovedEmotes, loadAggmanEmoteDerivatives } from './index';

/** The channel's profile colours as captured for Genesis (apps/web `GENESIS_CHANNELS`, 2026-10-31T13:07:42.905Z). */
const PROFILE_COLOURS = ['#C91709', '#F8AE04', '#FE9E79', '#075E86'];
const bytes = (text: string) => Uint8Array.from(atob(text), c => c.charCodeAt(0));

const facts = {
  ...OBSERVED_GENESIS_FIXTURES.find(item => item.broadcasterId === AGGMAN_BROADCASTER)!,
  profileColours: PROFILE_COLOURS, approvedEmotes: aggmanApprovedEmotes(),
  evidence: { kind: 'observed' as const, sourceId: 'atlas-20261030-helix-20261031', asOf: Date.parse('2026-10-31T13:07:42.905Z') },
};
const compiled = compileChannelGenesis(facts);
/** `DeepReadonly` maps the branded kingdom ID to an object type; it is the plain string at runtime. */
const recipe: EmoteArtRecipe = { ...compiled, kingdomId: String(compiled.kingdomId) };
const harbour = recipe.landscapes.find(item => item.character === 'coastal-harbour')!;

describe("The_AGGman's checked emotes", () => {
  it('embeds each source exactly as read, and one source per use', () => {
    expect(new Set(AGGMAN_EMOTE_SOURCES.map(source => source.use)).size).toBe(AGGMAN_EMOTE_SOURCES.length);
    expect(new Set(AGGMAN_EMOTE_SOURCES.map(source => source.emoteId)).size).toBe(AGGMAN_EMOTE_SOURCES.length);
    for (const source of AGGMAN_EMOTE_SOURCES) {
      expect(createHash('sha256').update(bytes(source.png)).digest('hex'), source.name).toBe(source.sourceSha256);
    }
  });

  it('re-proves every pinned derivative hash through the production decoder', async () => {
    for (const source of AGGMAN_EMOTE_SOURCES) {
      const raster = await decodeEmoteBytes(bytes(source.png), 'png');
      expect([raster.width, raster.height, raster.frames.length]).toEqual([112, 112, 1]);
      const check = AGGMAN_EMOTE_CHECKS.find(item => item.emoteId === source.emoteId)!;
      expect(check.use).toBe(source.use);
      expect(derivativeRasterHash(raster), source.name).toBe(check.assetHash);
    }
    const derivatives = await loadAggmanEmoteDerivatives();
    expect(derivatives.map(d => [d.emoteId, d.use, d.asset.assetHash, d.broadcasterId, d.origin]))
      .toEqual(AGGMAN_EMOTE_CHECKS.map(c => [c.emoteId, c.use, c.assetHash, AGGMAN_BROADCASTER, 'live']));
    for (const derivative of derivatives) expect(derivativeRasterHash(derivative.raster)).toBe(derivative.asset.assetHash);
  });

  it('allows each emote its one checked use, and nothing more', () => {
    for (const entry of aggmanApprovedEmotes()) expect(entry.allowedUses).toHaveLength(1);
    expect(recipe.identity.emoteWorks.map(work => [work.use, work.emoteId]).sort())
      .toEqual(AGGMAN_EMOTE_CHECKS.map(check => [check.use, check.emoteId]).sort());
  });

  it('carves the statue, the window and the vane on the harbour land, with no absence', async () => {
    expect(harbour).toBeDefined();
    const art = composeGenesisEmoteArt(recipe, harbour, await loadAggmanEmoteDerivatives());
    expect(art.absences).toEqual([]);
    expect(art.label).toBeNull();
    expect(art.character).toBe('coastal-harbour');
    expect(art.monument).not.toBeNull();
    expect(art.monument!.frames).toHaveLength(1);
    // The carving stands the full 5 m (40 cells) on its pedestal.
    expect(art.monument!.statueSize[1]).toBe(40);
    expect(art.glass.kind).toBe('emote');
    expect(art.glass.emote).not.toBeNull();
    expect(art.vane).not.toBeNull();
    expect(art.vane!.rotor.boxes.length).toBeGreaterThan(0);
  });

  it('refuses a derivative offered for a use it was not checked for', async () => {
    const derivatives = await loadAggmanEmoteDerivatives();
    const swapped = derivatives.map(d => (d.use === 'statue' ? { ...d, use: 'stained-glass' as const } : d.use === 'stained-glass' ? { ...d, use: 'statue' as const } : d));
    const art = composeGenesisEmoteArt(recipe, harbour, swapped);
    expect(art.monument).toBeNull();
    expect(art.glass.kind).toBe('plain');
    expect(art.absences.map(absence => absence.use).sort()).toEqual(['stained-glass', 'statue']);
  });
});
