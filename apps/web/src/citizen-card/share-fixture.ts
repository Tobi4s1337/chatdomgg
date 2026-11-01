// The SIMULATED share picture's input, built exactly the way a host builds a real one: the card bench's document,
// the worn pieces the look authority names, the kingdom's arms, and the passport as the real passport reader answers
// it through the card's disclosure (SIMULATED authorities). Loaded by the card capture's share route, never by the
// product bundle.
import type { CitizenShareCard, CitizenSharePassport, CitizenSharePortrait, CrestView } from '@chatdom/ui/passport';
import { createPassportReader } from '../../../api/src/passport/read';
import { simulatedPassportAuthorities } from '../../../api/src/passport/simulated';
import { findFixture } from './fixtures';
import { citizenShareCard } from './share';
import { SITTER } from './sitter';

export type ShareTravels = 'shown' | 'hidden';

/** The SIMULATED kingdoms' arms as their directory would supply them, in the passport's crest grammar. */
const CRESTS: Readonly<Record<string, CrestView>> = {
  // Willowmere: a willow (the oak charge) in the town's green and gold, the colours of its tenure hood.
  '41000001': { key: 'crest:41000001:1', shape: 'heater', charge: 'oak', colours: [...SITTER.kingdom.colours], assetHash: null },
  '491305829': { key: 'crest:491305829:1', shape: 'heater', charge: 'star', colours: ['#2d3f66', '#e9c46a', '#8c2f24'], assetHash: null },
};

export interface SimulatedShareOptions {
  readonly travels: ShareTravels;
  /** The approved portrait bytes for the fixture's portrait, as the asset port would give them; null for none. */
  readonly portrait: CitizenSharePortrait | null;
  readonly signal?: AbortSignal;
}

/** The share picture's input for one SIMULATED card, or null for a fixture that does not exist. */
export async function simulatedCardShare(fixtureId: string, options: SimulatedShareOptions): Promise<CitizenShareCard | null> {
  const fixture = findFixture(fixtureId);
  if (!fixture) return null;
  const hidden = options.travels === 'hidden';
  const document = hidden ? { ...fixture.document, passport: { hidden: true } as const } : fixture.document;
  const crest = CRESTS[document.key.kingdomId];
  if (!crest) throw new Error(`No SIMULATED arms for kingdom ${document.key.kingdomId}`);

  let passport: CitizenSharePassport = { hidden: true };
  if (fixture.passport) {
    const authorities = simulatedPassportAuthorities(fixture.passport, { signedIn: true, travelsHidden: hidden });
    const snapshot = await createPassportReader(authorities.ports).snapshot({
      key: authorities.key, now: authorities.now, signal: options.signal ?? new AbortController().signal,
    });
    if (snapshot.kind === 'unavailable') throw new Error('The SIMULATED passport could not be read');
    if (snapshot.kind === 'visible') passport = { hidden: false, book: snapshot.book };
  }
  return citizenShareCard({
    document, worn: fixture.worn ?? [], portrait: options.portrait, crest, homeTier: fixture.homeTier ?? null, passport,
  });
}
