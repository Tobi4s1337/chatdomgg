/**
 * Private bench for the march call: `/-/raid-gate?march=<phase>` stands the piece over a plain dusk sky at one phase,
 * from a fixture snapshot. The fixtures keep `origin: 'simulated'` in their data and show no label (decision 25).
 * Nothing here talks to an authority; the buttons press a controller that only holds the fixture.
 */
import { For, onMount } from 'solid-js';
import type { AtlasChannel } from '@chatdom/shared';
import type { AtlasRaid, KingdomId } from '../../../api/src/raid-gate/contracts';
import type { GateDestination, GateSnapshot, JourneySnapshot, RaidGateController } from './controller';
import { MarchCall } from './MarchCall';
import type { GateKingdom } from './ports';

const T0 = 1_800_000_000_000;
const SOURCE: GateKingdom = { kingdomId: '129634568' as KingdomId, name: 'Willowmere', login: 'tobi4s_' };
const FERN = '41000002' as KingdomId, MASHA = '12826' as KingdomId;

const FERNHOLLOW: AtlasChannel = {
  kingdomId: FERN, login: 'fernhollow', displayName: 'Fernhollow', language: 'en', founded: true, kingdomName: 'Fernhollow', contentClassification: 'general',
};
const MASHAD4: AtlasChannel = {
  kingdomId: MASHA, login: 'mashad4', displayName: 'MashaD4', language: 'en', founded: false, kingdomName: null, contentClassification: 'general',
};
const TO_FERN: GateDestination = { target: { kingdomId: FERN, founded: true, live: true, classification: 'general' }, channel: FERNHOLLOW, land: 'founded' };
const TO_MASHA: GateDestination = { target: { kingdomId: MASHA, founded: false, live: true, classification: 'general' }, channel: MASHAD4, land: 'waiting' };

function raidTo(to: KingdomId): AtlasRaid {
  return {
    version: 1, id: `raid.${'c'.repeat(64)}`, fromKingdomId: SOURCE.kingdomId, toKingdomId: to, viewers: 214, observedAt: T0 - 4_000, occurredAt: T0 - 5_000,
    evidence: { kind: 'simulated', asOf: T0 - 4_000, label: 'SIMULATED' }, delivery: 'resumable', source: 'simulation',
  };
}

const BASE: GateSnapshot = {
  phase: 'gathering', origin: 'simulated', mapOrigin: null, viewer: 'walker', authority: null, source: SOURCE, destination: TO_FERN,
  requestId: 'bench-request', optedIn: 5, joined: false, expiresAt: T0 + 84_000, state: 'prepared', countdownEndsAt: null, raid: null,
  checking: null, canStart: false, busy: null, farewell: null, asking: null, notice: null, canReconnect: false, journey: null, canTravel: false, welcome: null,
};

function journey(state: JourneySnapshot['state'], extra: Partial<JourneySnapshot> = {}): JourneySnapshot {
  return {
    kind: 'raid', ticket: 'bench-ticket', state, from: SOURCE.kingdomId, to: FERN, destination: TO_FERN, role: state === 'committed' ? 'visitor' : null,
    arrivalId: state === 'committed' ? 'bench-arrival' : null, overrun: false, refusal: null, busy: null, ...extra,
  };
}

const departed: Partial<GateSnapshot> = { phase: 'departed', state: 'landed', joined: true, optedIn: 5, raid: raidTo(FERN), expiresAt: T0 + 290_000 };

/** One fixture per phase the piece can be in. */
export const MARCH_BENCH: Readonly<Record<string, GateSnapshot>> = {
  gathering: { ...BASE },
  joined: { ...BASE, joined: true, optedIn: 6 },
  countdown: { ...BASE, phase: 'countdown', state: 'pending', joined: true, optedIn: 7, countdownEndsAt: T0 + 38_000, expiresAt: T0 + 900_000 },
  checking: { ...BASE, phase: 'checking', state: 'unknown', joined: true, optedIn: 7, checking: 'countdown', expiresAt: T0 + 900_000 },
  departed: { ...BASE, ...departed, canTravel: true },
  stayed: { ...BASE, ...departed, joined: false },
  journey: { ...BASE, ...departed, journey: journey('preparing') },
  overrun: { ...BASE, ...departed, journey: journey('preparing', { overrun: true }) },
  arrived: { ...BASE, ...departed, journey: journey('committed') },
  home: { ...BASE, ...departed, journey: journey('committed', { kind: 'return', from: FERN, to: SOURCE.kingdomId, role: 'citizen' }) },
  full: { ...BASE, ...departed, journey: journey('asking', { ticket: null, refusal: 'full' }) },
  waiting: { ...BASE, ...departed, destination: TO_MASHA, raid: raidTo(MASHA) },
  'called-off': { ...BASE, phase: 'called-off', state: 'cancelled', joined: false, optedIn: 0 },
  refused: { ...BASE, phase: 'refused', state: 'rejected', joined: false, optedIn: 0 },
  closed: { ...BASE, phase: 'quiet', destination: null, requestId: null, state: null, optedIn: 0, expiresAt: null, farewell: { reason: 'closed', destination: TO_FERN, joined: true } },
};

function fixtureController(snapshot: GateSnapshot): RaidGateController {
  const nothing = async () => undefined;
  return {
    snapshot: () => snapshot, subscribe: () => () => undefined, open() {}, close() {}, preview: nothing, cancel: nothing, start: nothing, reconcile: nothing,
    join: nothing, leave: nothing, travel: nothing, returnHome: nothing, cancelTravel: nothing, reconcileTravel: nothing, dismissJourney() {},
    acceptGift: nothing, refuseGift: nothing, leaveGift: nothing, refreshWelcome: nothing, reconnect() {}, refresh: nothing, dispose() {},
  };
}

export default function MarchBench() {
  const phase = new URLSearchParams(location.search).get('march') ?? 'gathering';
  const snapshot = MARCH_BENCH[phase] ?? MARCH_BENCH.gathering!;
  onMount(() => { (window as Window & { __chatdomReady?: boolean }).__chatdomReady = true; });
  return <main class="mc-bench" data-phase={phase}>
    <nav class="mc-bench-nav" aria-label="March call phases">
      <For each={Object.keys(MARCH_BENCH)}>{name => <a href={`?march=${name}`} aria-current={name === phase ? 'page' : undefined}>{name}</a>}</For>
    </nav>
    <MarchCall controller={fixtureController(snapshot)} clock={() => T0} pathname={() => location.pathname} storage={null} />
  </main>;
}
