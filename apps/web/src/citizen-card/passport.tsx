import type { JSX } from 'solid-js';
import type { PassportReadState } from '@chatdom/ui/passport';
import type { CitizenCardDocument } from '../../../api/src/citizen-card/contracts';
import { projectCard } from '../../../api/src/citizen-card/project';
import { disclosedPlaces, passportDisclosure } from '../../../api/src/passport/disclosure';
import { createPassportReader } from '../../../api/src/passport/read';
import { simulatedPassportAuthorities } from '../../../api/src/passport/simulated';
import { CardPassport } from '../passport/CardPassport';
import { passportLocalTransport } from '../passport/transport';

/**
 * The bench's SIMULATED passport beneath a card, read the way the card page reads a real one: the SIMULATED
 * authorities feed the real passport reader, the reply crosses a serialised wire and the boundary reader checks it.
 * The disclosure is the authority's projected card (the person revision the reading follows); the places are the
 * card on the page's own disclosed homes, so a road can say it began in Tarnhollow. Loaded only by the bench.
 */
export function simulatedCardPassport(card: CitizenCardDocument, book: 'many' | 'none', onState: (state: PassportReadState) => void, travelsHidden = false): JSX.Element {
  const authorities = simulatedPassportAuthorities(book, { signedIn: true, travelsHidden });
  // The book belongs to the card's own person; a card for anyone else never carries this one.
  if (authorities.key.personId !== card.key.personId) throw new Error(`The SIMULATED ${book} passport is not ${card.identity.name}’s.`);
  const reader = createPassportReader(authorities.ports);
  const transport = passportLocalTransport(reader, { key: authorities.key, now: authorities.now });
  const disclosure = passportDisclosure(projectCard(authorities.card()));
  return <CardPassport transport={transport} places={disclosedPlaces(card)} disclosure={disclosure} simulated onState={onState} />;
}
