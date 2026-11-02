import { createHash } from 'node:crypto';
import { createNativeForgeHost, findForgeSockets } from '../../../../packages/forge/src';
import type { KingdomId, PersonId } from '../../../../packages/shared/src';
import { generateSettlementPlan } from '../../../../packages/world/src';
import type { createDurableRealmBoot } from '../../../../apps/realm/src/bootstrap/durable';
import type { createRealmCitizens } from '../../../../apps/realm/src/evening/citizens';
import { forgeHomeDigest } from '../../../../apps/realm/src/wiring/forge';

type ProofBoot = ReturnType<typeof createDurableRealmBoot>;
type ProofCitizens = ReturnType<typeof createRealmCitizens>;
type ProofHold = Awaited<ReturnType<ProofBoot['services']['retain']>>;
type ProofHome = ProofHold['kingdom']['privateState']['homes'][string];
type ProofPerson = Pick<ProofHome, 'slot' | 'family'> & { readonly personId: PersonId; readonly homeId: ProofHome['id'] };

const QUALIFY_MS = 600_000;
const proofHash = (...parts: readonly string[]) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');
const commandId = (kind: string, kingdomId: KingdomId, personId: PersonId, sessionId = '') =>
  `simulated:fw10:${kind}:${proofHash(kingdomId, personId, sessionId)}`;

function requireSimulated(boot: ProofBoot): void {
  if (boot.allocation.origin !== 'simulated') throw new Error('The proof seed requires simulated realm provenance.');
}

function requireWriter(hold: ProofHold): void {
  if (!hold.kingdom.current || hold.kingdom.origin !== 'simulated') {
    throw new Error('The proof seed requires the current simulated realm writer.');
  }
}

/** The caller guards its PostgreSQL schema; this helper never creates or clears a namespace. */
/** A hamlet seats about twelve homes a quarter; the fifty-wish run needs a town for one citizen per wish. */
export async function adoptProofLayout(boot: ProofBoot, kingdomId: KingdomId, tier: 'hamlet' | 'town' = 'hamlet') {
  requireSimulated(boot);
  const plan = generateSettlementPlan({ seed: 'forge-wish-fw10-proof', tier, firstYear: 2023, year: 2026 });
  const adopted = await boot.allocation.adoptLayout(kingdomId, plan);
  if (adopted.status !== 'founded' && adopted.status !== 'unchanged') {
    throw new Error('The proof layout requires an empty or identically founded simulated kingdom.');
  }
  if (adopted.revision !== plan.revision) throw new Error('The proof layout revision was not adopted.');
  return plan;
}

/** SIMULATED people settle through the actual signed-tenure allocator and native home furnisher. */
export async function settleProofPeople(boot: ProofBoot, citizens: ProofCitizens, kingdomId: KingdomId,
  personIds: readonly PersonId[], requireEverySocket = true): Promise<ProofPerson[]> {
  requireSimulated(boot);
  if (new Set(personIds).size !== personIds.length || personIds.some(personId => String(personId) === String(kingdomId))) {
    throw new Error('The proof seed requires distinct citizen identities separate from the monarch.');
  }
  const hold = await boot.services.retain(kingdomId);
  try {
    requireWriter(hold);
    const people: ProofPerson[] = [];
    for (const personId of personIds) {
      // Lane-authored names and tenure are private proof fixtures, never provider/live identity claims.
      const name = `ProofBirch${proofHash(kingdomId, personId).slice(0, 12)}`;
      const settled = await citizens.settle(hold.kingdom, { personId, name }, {
        followedAt: Date.UTC(2023, 0, 1), months: 36,
      });
      if (!settled) throw new Error('The proof citizen needs a signed tenure key, approved names and an available deed.');
      const deed = await boot.allocation.deedIn(kingdomId, personId);
      if (!deed || deed.origin !== 'simulated' || deed.status !== 'installed'
        || deed.tenure.followYear !== 2023 || deed.tenure.subscribedMonths !== 36) {
        throw new Error('The proof citizen requires an installed native deed with signed proof tenure.');
      }
      const home = hold.kingdom.privateState.homes[deed.plotId];
      if (!home || home.ownerId !== personId || home.slot !== deed.slot || home.allocationReceipt !== deed.receipt) {
        throw new Error('The proof home must be the citizen allocator’s actual installed deed.');
      }
      const native = createNativeForgeHost(deed.placement);
      if (home.family !== native.family || home.digest !== forgeHomeDigest(native.blueprint)
        || home.digest !== forgeHomeDigest(home.blueprint)) {
        throw new Error('The proof home must retain the exact native blueprint standing on its allocated plot.');
      }
      const sockets = findForgeSockets(home.blueprint);
      // The twenty-wish run keeps whatever slots each allocated native home really has.
      if (!sockets.length || requireEverySocket && !(['lantern', 'chimney', 'weathervane'] as const).every(kind => sockets.some(socket => socket.kind === kind))) {
        throw new Error('The allocated native home lacks the lantern, chimney or weathervane socket required for this proof.');
      }
      const rights = { revision: 1, forge: true, build: true, blocked: false,
        safetyIdentifier: proofHash('simulated-fw10-safety', kingdomId, personId) };
      const result = await hold.kingdom.execute(commandId('rights', kingdomId, personId), {
        type: 'citizen.rights', personId, rights,
      }, 'moderation');
      const actual = hold.kingdom.privateState.rights[personId];
      if ((result.status !== 'committed' && result.status !== 'unchanged') || !actual
        || actual.revision !== rights.revision || !actual.forge || !actual.build || actual.blocked
        || actual.safetyIdentifier !== rights.safetyIdentifier) {
        throw new Error('The proof citizen rights were not committed by the retained realm writer.');
      }
      people.push({ personId, slot: home.slot, homeId: home.id, family: home.family });
    }
    return people;
  } finally { await hold.release(); }
}

/** Authenticated HTTP ingress must have witnessed this simulated live session before qualification. */
export async function qualifyProofPeople(boot: ProofBoot, kingdomId: KingdomId,
  people: readonly ProofPerson[], sessionId: string) {
  requireSimulated(boot);
  if (!sessionId || people.length === 0 || new Set(people.map(person => person.personId)).size !== people.length) {
    throw new Error('The proof qualification requires a session and distinct settled citizens.');
  }
  const hold = await boot.services.retain(kingdomId);
  try {
    requireWriter(hold);
    const { stream } = hold.kingdom.privateState;
    const from = stream.startedAt, through = from + QUALIFY_MS, now = Math.floor(hold.kingdom.databaseNow());
    if (stream.sessionId !== sessionId || !Number.isSafeInteger(from) || from < 0
      || !Number.isSafeInteger(through) || through > now || stream.liveUntil <= now || through > stream.liveUntil) {
      throw new Error('Authenticated proof ingress must first witness a current stream with ten elapsed minutes.');
    }
    let minimumCoal = 3;
    for (const person of people) {
      const home = hold.kingdom.privateState.homes[person.homeId];
      if (!home || home.ownerId !== person.personId || home.slot !== person.slot || home.family !== person.family) {
        throw new Error('Only the actual settled proof citizen can qualify for this coal.');
      }
      const intervalId = commandId('interval', kingdomId, person.personId, sessionId);
      const interval = await hold.kingdom.execute(intervalId, { type: 'presence.confirmInterval',
        personId: person.personId, streamSessionId: sessionId, from, through,
        evidenceReceipt: intervalId,
      }, 'presence');
      const qualification = hold.kingdom.privateState.qualification[`${person.personId}:${sessionId}`];
      if ((interval.status !== 'committed' && interval.status !== 'unchanged') || !qualification
        || qualification.coveredMs < QUALIFY_MS) {
        throw new Error('The real realm writer did not confirm ten minutes of proof presence.');
      }
      const creditId = commandId('coal', kingdomId, person.personId, sessionId);
      const credited = await hold.kingdom.execute(creditId, { type: 'coal.creditQualifiedNight',
        personId: person.personId, streamSessionId: sessionId, qualificationReceipt: intervalId,
      }, 'presence');
      const state = hold.kingdom.privateState, coal = state.coals[person.personId] ?? 0;
      if ((credited.status !== 'committed' && credited.status !== 'unchanged')
        || !state.creditedNights[`${person.personId}:${sessionId}`] || !Number.isSafeInteger(coal) || coal < 1) {
        throw new Error('The qualified proof night did not earn a coal through the realm ledger.');
      }
      minimumCoal = Math.min(minimumCoal, coal);
    }
    return { people: people.length, intervalMs: through - from, minimumCoal };
  } finally { await hold.release(); }
}
