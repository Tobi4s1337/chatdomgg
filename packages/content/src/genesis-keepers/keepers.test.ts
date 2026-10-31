import { describe, expect, it } from 'vitest';
import { compileChannelGenesis } from '../../../world/src/genesis/index';
import { OBSERVED_GENESIS_FIXTURES } from '../../../world/src/genesis/observed-fixtures';
import { AVATAR_MATERIALS } from '../avatars/index';
import { MAT } from '../materials';
import { HARBOUR_TARGET, RIVER_TARGET, showcaseFixture } from '../genesis-landmarks/showcase-fixtures';
import { proposeGenesisKeepers } from './adapter';
import { keeperRole } from './roles/index';

const TARGETS = [HARBOUR_TARGET, RIVER_TARGET, '154972160'] as const;

describe('keepers chosen by the recipe', () => {
  for (const id of TARGETS) {
    const { recipe, landscape } = showcaseFixture(id);
    const proposals = proposeGenesisKeepers(recipe, landscape);

    it(`${id}: carries every keeper exactly as the recipe gave it`, () => {
      expect(proposals).toHaveLength(recipe.soul.keepers.length);
      for (const [i, proposal] of proposals.entries()) {
        const given = recipe.soul.keepers[i]!;
        expect(proposal.keeper).toBe(given);
        expect(proposal.keeper).toEqual({ role: given.role, name: given.name, placeId: given.placeId, carriesPresenceLight: false });
        expect(proposal.place.id).toBe(given.placeId);
        expect(proposal.place.name).toBe(landscape.places.find(p => p.id === given.placeId)!.name);
        expect(proposal.look.spec.role).toBe(given.role);
        expect(proposal.speaker).toMatchObject({ role: given.role, name: given.name, placeName: proposal.place.name });
        expect(proposal.landscapeId).toBe(landscape.id);
        expect(proposal.id).toBe(`${landscape.id}/keeper/${i}-${given.role}`);
      }
    });

    it(`${id}: is deterministic and dresses keepers in the recipe's kit`, () => {
      expect(JSON.stringify(proposeGenesisKeepers(recipe, landscape))).toBe(JSON.stringify(proposals));
      for (const proposal of proposals) {
        expect(proposal.look.spec.kit).toBe(recipe.identity.styleFamily);
        expect(proposal.look.spec.body).toBe(keeperRole(proposal.keeper.role).bodies[proposal.temperament]);
      }
    });

    it(`${id}: is never a person — no light, count, chat identity or citizen`, () => {
      for (const proposal of proposals) {
        expect(proposal.presence).toEqual({ carriesPresenceLight: false, counted: false, twitchChat: 'never', citizen: false });
        const json = JSON.stringify(proposal);
        for (const word of ['averageViewers', 'followers', 'viewers', 'population', 'oldestFollowYear', 'broadcasterId', 'emote', 'publicName']) expect(json).not.toContain(word);
        // Nothing a keeper wears or carries glows: avatar keys only, no glass, no fire.
        for (const part of [...proposal.look.parts, ...proposal.look.tools.flatMap(t => t.parts)]) {
          for (const box of part.boxes) {
            if (box.material === 0) continue;
            expect(AVATAR_MATERIALS.has(box.material)).toBe(true);
            expect(box.material).not.toBe(MAT.glass);
          }
        }
        expect(proposal.checks.some(check => check.includes('excluded from every count'))).toBe(true);
      }
    });

    it(`${id}: works from the landscape the ceremony selected, not the recommendation`, () => {
      for (const other of recipe.landscapes) {
        const made = proposeGenesisKeepers(recipe, other);
        expect(made.every(p => p.landscapeId === other.id)).toBe(true);
      }
    });
  }

  it('refuses another recipe\'s landscape or an altered one', () => {
    const a = showcaseFixture(HARBOUR_TARGET), b = showcaseFixture(RIVER_TARGET);
    expect(() => proposeGenesisKeepers(a.recipe, b.landscape)).toThrow(/not one of this recipe/);
    const altered = { ...a.landscape, places: a.landscape.places.map(p => ({ ...p, name: 'Elsewhere' })) };
    expect(() => proposeGenesisKeepers(a.recipe, altered)).toThrow(/differs/);
  });

  it('refuses a keeper whose place the landscape lacks, or one that would carry a light', () => {
    const { recipe, landscape } = showcaseFixture(HARBOUR_TARGET);
    const lost = { ...recipe, soul: { ...recipe.soul, keepers: [{ ...recipe.soul.keepers[0]!, placeId: 'nowhere' }] } };
    expect(() => proposeGenesisKeepers(lost, landscape)).toThrow(/does not have/);
    const lit = { ...recipe, soul: { ...recipe.soul, keepers: [{ ...recipe.soul.keepers[0]!, carriesPresenceLight: true as unknown as false }] } };
    expect(() => proposeGenesisKeepers(lit, landscape)).toThrow(/presence light/);
  });

  it('flags two keepers sharing a name, without renaming either', () => {
    const { recipe, landscape } = showcaseFixture(RIVER_TARGET);
    const names = recipe.soul.keepers.map(k => k.name);
    const proposals = proposeGenesisKeepers(recipe, landscape);
    expect(proposals.map(p => p.keeper.name)).toEqual(names);
    const shared = names.length !== new Set(names).size;
    expect(proposals.every(p => p.checks.some(c => c.includes('share the name')))).toBe(shared);
  });

  it('labels a keeper from a simulated recipe SIMULATED', () => {
    const facts = { ...OBSERVED_GENESIS_FIXTURES[0]!, evidence: { kind: 'simulated' as const, sourceId: 'bench', asOf: OBSERVED_GENESIS_FIXTURES[0]!.evidence.asOf, label: 'SIMULATED' as const } };
    const recipe = compileChannelGenesis(facts);
    const proposals = proposeGenesisKeepers(recipe, recipe.landscapes[1]);
    expect(proposals.every(p => p.provenance.label === 'SIMULATED' && p.provenance.evidence === 'simulated')).toBe(true);
    const observed = showcaseFixture(HARBOUR_TARGET);
    expect(proposeGenesisKeepers(observed.recipe, observed.landscape).every(p => p.provenance.label === null)).toBe(true);
  });

  it('supports a ferryman the recipe may choose, at any place it names', () => {
    const { recipe, landscape } = showcaseFixture(RIVER_TARGET);
    const ferried = { ...recipe, soul: { ...recipe.soul, keepers: [{ role: 'ferryman' as const, name: 'Hazel', placeId: 'plaza', carriesPresenceLight: false as const }] } };
    const [ferryman] = proposeGenesisKeepers(ferried, landscape);
    expect(ferryman!.keeper.role).toBe('ferryman');
    expect(ferryman!.look.tools.length).toBeGreaterThan(0);
    expect(ferryman!.routine.needs.length).toBeGreaterThan(0);
  });
});
