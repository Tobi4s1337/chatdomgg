/**
 * The passport bench's Raid Gate book (`/-/passport?surface=card&source=gate`): the holder's stamps read the way the
 * card reads them for real, through the gate's passport ports (`gatePassportPorts`) and the real passport reader,
 * over the in-memory gate store holding what the gate's authority would have recorded. Arms are the Atlas's,
 * seeded from each channel ID. The card source folds in the holder's "Hide my travels" choice exactly as a host does
 * (`cardTravels`). Fixture people and kingdoms only; this never leaves the private bench.
 */
import type { PassportDisclosureView } from '@chatdom/ui/passport';
import type { CardSource, CitizenKey } from '../../../api/src/citizen-card/contracts';
import { projectCard } from '../../../api/src/citizen-card/project';
import { createPassportReader } from '../../../api/src/passport/read';
import { simulatedPassportAuthorities } from '../../../api/src/passport/simulated';
import type { PersonId } from '../../../api/src/raid-gate/contracts';
import { cardTravels, createMemoryGatePassport, gatePassportPorts, type GateRaidRoad } from '../../../api/src/raid-gate/passport';
import type { RaidGuestStamp } from '../../../api/src/raid-gate/guest-contracts';
import { passportDisclosure } from '../../../api/src/passport/disclosure';

const HOUR = 3_600_000, DAY = 24 * HOUR;
const raidId = (seed: string) => `raid.${seed.repeat(64 / seed.length)}`;
const LOGIN = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/gu, '_');
const side = (kingdomId: string, name: string) => ({ kingdomId, login: LOGIN(name), name });

/** Witnessed raids on the bench: the holder's own Larkspur Hollow rides out twice, and a neighbour's raid they walked in with. */
function cast(home: { kingdomId: string; name: string }) {
  const thornwick = side('910000201', 'Thornwick'), brackenmoor = side('910000202', 'Brackenmoor');
  const saltreach = side('910000203', 'Saltreach'), kestrel = side('910000204', 'Kestrel Fen');
  const own = side(home.kingdomId, home.name);
  return [
    { raidId: raidId('a3'), from: own, to: kestrel, daysAgo: 1.2, kind: 'raid' as const },
    { raidId: raidId('5c'), from: brackenmoor, to: saltreach, daysAgo: 6.4, kind: 'visit' as const },
    { raidId: raidId('e7'), from: own, to: thornwick, daysAgo: 13.1, kind: 'raid' as const },
  ];
}

export function gateBenchSource() {
  const authorities = simulatedPassportAuthorities('none', { signedIn: true, travelsHidden: false });
  const seed = projectCard(authorities.card());
  const home = { kingdomId: seed.key.kingdomId, name: seed.kingdomName };
  const person = authorities.key.personId as unknown as PersonId;
  const gate = createMemoryGatePassport();
  for (const ride of cast(home)) {
    const occurredAt = authorities.now - ride.daysAgo * DAY;
    const raid: GateRaidRoad = { raidId: ride.raidId, from: ride.from, to: ride.to };
    gate.witness(raid);
    const stamp: RaidGuestStamp = {
      id: `raid-stamp.${ride.raidId.slice(5)}`, kind: ride.kind, kingdomId: ride.to.kingdomId as RaidGuestStamp['kingdomId'],
      occurredAt: occurredAt + 4 * 60_000, raidId: ride.kind === 'raid' ? ride.raidId : null,
      arrivedWith: ride.kind === 'visit' ? { raidId: ride.raidId, from: ride.from, to: ride.to, occurredAt } as RaidGuestStamp['arrivedWith'] : null,
      reward: { eligible: true, reason: 'eligible', day: Math.floor(occurredAt / DAY) },
    };
    gate.stamp(person, stamp);
  }

  // The card source as a host binds it: the person authority's card with the gate's choice folded in.
  const card = async (key: CitizenKey): Promise<CardSource> => {
    const source = authorities.card();
    if (key.personId !== source.document.key.personId) throw new Error('The bench card holds one citizen.');
    const travels = cardTravels(await gate.store.choice(person), source.document.revision.person);
    return { ...source, travelsHidden: travels.travelsHidden, document: { ...source.document, revision: { ...source.document.revision, person: travels.personRevision } } };
  };
  const empty = { revision: 0, items: [], nextCursor: null } as const;
  const reader = createPassportReader({
    ...gatePassportPorts(gate.store),
    origin: 'simulated', card: key => card(key),
    bonds: async () => empty, keepsakes: async () => empty,
  });
  let clock = authorities.now;
  const disclosure = async () => passportDisclosure(projectCard(await card(authorities.key)));
  const owner = {
    setTravels: (travels: 'shown' | 'hidden', signal: AbortSignal) => new Promise<PassportDisclosureView>((resolve, reject) => {
      const timer = setTimeout(() => {
        clock += 1_000;
        gate.store.choose(person, travels === 'hidden', clock).then(() => disclosure()).then(resolve, reject);
      }, 700);
      signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('aborted')); }, { once: true });
    }),
  };
  return { authorities, reader, owner, disclosure, home };
}
