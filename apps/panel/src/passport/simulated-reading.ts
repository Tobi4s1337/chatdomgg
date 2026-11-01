// The SIMULATED night's passport: the sitter's well-travelled book read the way a real one will be. SIMULATED
// authorities (card source with disclosure, the Gate's minimal stamps, a kingdom directory, witnessed roads, accepted
// gift receipts) feed the real passport reader, and every reply crosses a serialised wire and the boundary reader.
// Loaded on demand, the first time the viewer turns to their passport, so the panel's first load stays small.
import type { PassportDisclosureView, PassportTransport } from '@chatdom/ui/passport';
import { projectCard } from '../../../api/src/citizen-card/project';
import { disclosedPlaces, passportDisclosure } from '../../../api/src/passport/disclosure';
import { createPassportReader } from '../../../api/src/passport/read';
import { simulatedPassportAuthorities } from '../../../api/src/passport/simulated';
import { passportLocalTransport } from '../../../web/src/passport/transport';

export interface SimulatedPanelPassport {
  readonly transport: PassportTransport;
  readonly places: ReadonlyMap<string, string>;
  readonly disclosure: PassportDisclosureView;
}

/** One reading per call: a new subject, a new reader, nothing carried over. */
export function simulatedPanelPassport(): SimulatedPanelPassport {
  const authorities = simulatedPassportAuthorities('many', { signedIn: true, travelsHidden: false });
  const reader = createPassportReader(authorities.ports);
  const card = projectCard(authorities.card());
  return {
    transport: passportLocalTransport(reader, { key: authorities.key, now: authorities.now }),
    places: disclosedPlaces(card),
    disclosure: passportDisclosure(card),
  };
}
