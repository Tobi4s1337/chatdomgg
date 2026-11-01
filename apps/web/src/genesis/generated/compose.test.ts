import { describe, expect, it } from 'vitest';
import { terrainHeight } from '@chatdom/world';
import { compileChannelGenesis, GENESIS_ATLAS_REALMS, type GenesisAtlasRealm } from '@chatdom/world/genesis';
import type { DoorHolding } from '../../atlas/data/holding';
import { chooseLandscape, holdingFacts } from '../holding-facts';
import { atlasArmsTargets, composeGeneratedKingdom } from './compose';

const holding = (id: string, average: number, realm: GenesisAtlasRealm, game: string | null = null): DoorHolding => ({
  version: 1, id, login: `c${id}`, name: `Channel ${id}`, freshUntil: 1793540000000, tier: 'town', average, game: game ? { id: null, name: game } : null,
  realm: { kind: realm === 'crossroads' || realm === 'wilds' || realm === 'isle' || realm === 'outer' ? realm : 'family', family: realm, name: realm },
  region: { language: 'en', name: 'English' }, x: 0, y: 0,
  survey: { preview: 'pv-test', revision: 'obs-test', asOf: 1793453897230, windowHours: 45.89 },
});

describe('a generated kingdom', () => {
  it('composes for every kind of land and realm, with its landmarks on proved ground', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 18; i++) {
      const realm = GENESIS_ATLAS_REALMS[i % GENESIS_ATLAS_REALMS.length]!;
      const average = [12, 31, 140, 900][i % 4]!;
      const recipe = compileChannelGenesis(holdingFacts(holding(String(40_000_017 + i * 104_729), average, realm)));
      for (const landscape of recipe.landscapes) {
        const kingdom = composeGeneratedKingdom(recipe, landscape);
        const { sites, seat, camera, plan } = kingdom;
        seen.add(`${landscape.character}/${recipe.identity.landmark}`);
        expect(seat!.props.length).toBeGreaterThan(8);
        expect(seat!.braziers.length).toBeGreaterThanOrEqual(4);
        for (const item of [...seat!.props, ...seat!.buildings]) expect(item.position.every(Number.isFinite)).toBe(true);
        if (landscape.character === 'mountain-pass') expect(sites.landmark?.kind).toBe('crown-tower');
        if (['open-air-stage', 'stone-circle', 'bell-garden'].includes(recipe.identity.landmark)) expect(sites.family?.kind).toBe(recipe.identity.landmark);
        expect(sites.inn).not.toBeNull();
        if (recipe.size.cathedralSite) expect(sites.cathedral).not.toBeNull();
        // The eye stands clear above the ground it looks from.
        expect(camera.eye[1]).toBeGreaterThan(terrainHeight(plan, camera.eye[0], camera.eye[2]) + 10);
        expect(camera.target.every(Number.isFinite)).toBe(true);
        expect(kingdom.lore!.length).toBeGreaterThan(30);
        expect(kingdom.hour).toBeGreaterThanOrEqual(18.9);
        expect(kingdom.hour).toBeLessThanOrEqual(19.8);
      }
    }
    expect(seen.size).toBeGreaterThan(8);
  }, 300_000);

  it('is the same kingdom every time for a channel', () => {
    const recipe = compileChannelGenesis(holdingFacts(holding('91233457', 260, 'just-chatting', 'Just Chatting')));
    const landscape = chooseLandscape(recipe);
    const a = composeGeneratedKingdom(recipe, landscape), b = composeGeneratedKingdom(recipe, landscape);
    expect(JSON.stringify({ seat: a.seat, camera: a.camera, hour: a.hour, lore: a.lore })).toBe(JSON.stringify({ seat: b.seat, camera: b.camera, hour: b.hour, lore: b.lore }));
  }, 120_000);

  it('flies the holding’s Atlas arms', () => {
    const targets = atlasArmsTargets('91233457');
    expect(targets.length).toBeGreaterThanOrEqual(2);
    const recipe = compileChannelGenesis(holdingFacts(holding('91233457', 260, 'just-chatting', 'Just Chatting')));
    const kingdom = composeGeneratedKingdom(recipe, chooseLandscape(recipe));
    expect(kingdom.heraldry.treatment.kind).toBe('snapped');
    // Two channels of one realm and size do not wear the same colours.
    const other = compileChannelGenesis(holdingFacts(holding('55501231', 260, 'just-chatting', 'Just Chatting')));
    const colours = new Set([kingdom, ...Array.from({ length: 6 }, (_, i) => {
      const r = compileChannelGenesis(holdingFacts(holding(String(55_501_231 + i * 7_717), 260, 'just-chatting', 'Just Chatting')));
      return composeGeneratedKingdom(r, chooseLandscape(r));
    })].map(item => `${item.heraldry.colours.field}/${item.heraldry.colours.charge}`));
    expect(other.kingdomId).not.toBe(recipe.kingdomId);
    expect(colours.size).toBeGreaterThan(2);
  }, 120_000);
});
