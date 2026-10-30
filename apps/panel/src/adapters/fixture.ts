// The SIMULATED Willowmere night. Selected only by an explicit `source=simulated`.
// It sends nothing anywhere: lighting a window here changes this fixture alone,
// and every snapshot it produces carries the SIMULATED mark. Its words are authored
// fixture copy standing in for what a kingdom service would one day supply.
import type { Ballad, Earned, Home, Light, LightChoice, PanelAdapter, PanelSnapshot, Picture, SourceMark, Tavern, Tonight } from '../model';
import { FIXTURE_PROVENANCE } from '../assets/fixture/provenance';
import kingdomStill from '../assets/fixture/willowmere-kingdom.webp';
import portraitStill from '../assets/fixture/willowmere-portrait.webp';
import restingStill from '../assets/fixture/willowmere-resting.webp';
import windowStill from '../assets/fixture/willowmere-window.webp';

/** The deterministic cases a review can ask for with `state=`. */
export const FIXTURE_STATES = ['unshared', 'logged-out', 'refused', 'named', 'unnamed', 'guest', 'resting', 'disconnected', 'missing'] as const;
export type FixtureState = typeof FIXTURE_STATES[number];

const SIMULATED: SourceMark = { kind: 'simulated', label: 'SIMULATED', detail: 'A simulated night in Willowmere. Nothing here reaches a real kingdom.' };
/** How long the fixture plays Twitch's identity prompt, then the kingdom's answer, so each step is seen. */
export const FIXTURE_SHARE_MS = 900;
export const FIXTURE_CONFIRM_MS = 1400;
/** The simulated viewer. A Twitch display name, as the kingdom would supply it once identity is shared. */
const VIEWER = 'Wrenfeather';
const LOST_AT = '9:12 pm';

function still(id: 'kingdom' | 'window' | 'resting', url: string, portrait: string | null = null, caption = 'Simulated still'): Picture {
  const record = FIXTURE_PROVENANCE.pictures[id], upright = FIXTURE_PROVENANCE.pictures.portrait;
  return {
    kind: 'still', url, alt: record.alt, width: record.width, height: record.height,
    portrait: portrait ? { url: portrait, width: upright.width, height: upright.height } : null,
    provenance: {
      origin: 'simulated', caption,
      render: { route: record.render.route, seed: record.render.seed, hour: record.render.hour, camera: record.render.camera },
      capturedOn: record.capturedOn,
    },
  };
}

export function fixtureState(raw: string | null): FixtureState {
  return (FIXTURE_STATES as readonly string[]).includes(raw ?? '') ? raw as FixtureState : 'unshared';
}

function initialLight(state: FixtureState): Light {
  switch (state) {
    case 'logged-out': return { kind: 'logged-out' };
    case 'refused': return { kind: 'refused' };
    case 'named': case 'unnamed': return { kind: 'lit', choice: state, as: 'citizen', by: 'simulation' };
    case 'guest': return { kind: 'lit', choice: 'named', as: 'guest', by: 'simulation' };
    case 'resting': return { kind: 'resting', choice: 'named' };
    case 'disconnected': return { kind: 'out-of-reach', asOf: LOST_AT };
    default: return { kind: 'unshared' };
  }
}

const MOMENTS = [
  { id: 'beacon', at: '8:02 pm', text: 'The stream began and the castle beacon was lit.' },
  { id: 'first', at: '8:03 pm', text: 'Juniper’s window was the first lit on Lantern Row.' },
  { id: 'mill', at: '8:15 pm', text: 'Moss and Sable came home to the mill streets.' },
  { id: 'well', at: '8:40 pm', text: 'Channel points raised the well-house scaffold a storey.' },
] as const;

const BALLAD: Ballad = {
  title: 'The Ballad of the Well-house Night',
  sung: 'Sung at 11:04 pm, as the kingdom rested',
  lines: [
    'The beacon caught at eight o’clock above the castle stair,',
    'And Lantern Row woke, pane by pane, into the evening air.',
    'Juniper’s was first alight, then Moss and Sable came',
    'Home along the mill streets, each window with a name.',
    'The hearth table traded riddles till the Copper Kettle’s close,',
    'And by the points of everyone, the well-house scaffold rose.',
    'Now Willowmere is resting, and the lamps are burning low;',
    'The scaffold waits for one more night, and the town will watch it grow.',
  ],
};

function tonightFor(state: FixtureState): Tonight {
  if (state === 'missing') return { kind: 'unavailable', reason: 'Tonight’s moments have not reached the panel.' };
  if (state === 'resting') {
    return {
      kind: 'supplied', night: 'last-night', chapter: 'The Well-house Night',
      summary: 'The kingdom is resting after the Well-house Night. The scaffold stands two thirds raised.',
      moments: [...MOMENTS, { id: 'rest', at: '11:02 pm', text: 'The stream ended and the lamps began to dim.' }],
      raising: { building: 'The well-house', progress: 0.66, next: 'Then lanterns for the market square' },
      ballad: BALLAD,
    };
  }
  return {
    kind: 'supplied', night: 'tonight', chapter: null,
    summary: 'The beacon is lit and windows are coming on along Lantern Row. The well-house stands two thirds raised.',
    moments: MOMENTS,
    raising: { building: 'The well-house', progress: 0.66, next: 'Then lanterns for the market square' },
    ballad: null,
  };
}

const CITIZEN_HISTORY: readonly Earned[] = [
  { id: 'moved', text: 'Moved in on Lantern Row', at: '3 October' },
  { id: 'riddle', text: 'Sat at the hearth table for a riddle game', at: '21 October' },
  { id: 'well', text: 'Helped raise the well-house scaffold', at: 'Tonight' },
];

function homeFor(state: FixtureState, light: Light): Home {
  const citizen = (named: boolean): Home => ({
    kind: 'citizen', street: 'Lantern Row', place: 'Fourth house on the left, two doors from the lane',
    description: 'A cream-walled house with a flower box under the front window.',
    displayName: named ? VIEWER : null, picture: still('window', windowStill),
    tenure: { kind: 'known', since: '3 October' }, history: CITIZEN_HISTORY,
  });
  switch (light.kind) {
    case 'logged-out': return { kind: 'unknown', reason: 'Log in to Twitch to find your home.' };
    case 'unshared': case 'refused':
      return { kind: 'unknown', reason: state === 'missing' ? 'Your home card has not reached the panel.' : 'Your home appears here once you light your window and Twitch shares who you are.' };
    case 'pending': return { kind: 'unknown', reason: light.step === 'sharing' ? 'Waiting for Twitch to share who you are.' : 'The kingdom is finding your home.' };
    case 'lit':
      return light.as === 'guest'
        ? { kind: 'guest', displayName: light.choice === 'named' ? VIEWER : null, history: [
          { id: 'first', text: 'First lit a window in Willowmere', at: '24 October' },
          { id: 'riddle', text: 'Watched a riddle game at the hearth table', at: 'Tonight' },
        ] }
        : citizen(light.choice === 'named');
    case 'resting': return citizen(light.choice !== 'unnamed');
    // Out of reach: the card is the one the kingdom last sent, from before it stopped answering.
    case 'out-of-reach': return citizen(true);
    default: return { kind: 'unknown', reason: 'Your home card has not reached the panel.' };
  }
}

function tavernFor(state: FixtureState): Tavern {
  if (state === 'missing') return { kind: 'unavailable', reason: 'The tavern has not reached the panel.' };
  if (state === 'resting') return { kind: 'supplied', place: 'The Copper Kettle', table: 'The hearth table', watching: 'The tavern stays lit while the kingdom rests. No game is under way.' };
  return { kind: 'supplied', place: 'The Copper Kettle', table: 'The hearth table', watching: 'A riddle game is under way at the hearth table.' };
}

function snapshotFor(state: FixtureState, light: Light): PanelSnapshot {
  const resting = state === 'resting';
  return {
    source: SIMULATED,
    connection: state === 'disconnected' ? { kind: 'lost', asOf: LOST_AT } : { kind: 'fixture' },
    kingdom: { name: 'Willowmere', tier: 'town', motto: resting ? 'Resting between streams' : 'A town at dusk' },
    stream: resting ? 'resting' : 'live',
    picture: resting ? still('resting', restingStill, null, 'Simulated still · between streams') : still('kingdom', kingdomStill, portraitStill),
    light,
    tonight: tonightFor(state),
    home: homeFor(state, light),
    tavern: tavernFor(state),
  };
}

export function createFixtureAdapter(state: FixtureState = 'unshared'): PanelAdapter {
  const listeners = new Set<(snapshot: PanelSnapshot) => void>();
  let snapshot = snapshotFor(state, initialLight(state));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const set = (light: Light) => { snapshot = snapshotFor(state, light); for (const listener of listeners) listener(snapshot); };
  return {
    get: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    // The simulated journey: Twitch shares who you are, then the kingdom answers. Nothing leaves the page.
    requestLight(choice: LightChoice) {
      if (snapshot.light.kind !== 'unshared' && snapshot.light.kind !== 'refused') return;
      set({ kind: 'pending', choice, step: 'sharing' });
      timer = setTimeout(() => {
        set({ kind: 'pending', choice, step: 'confirming' });
        timer = setTimeout(() => set({ kind: 'lit', choice, as: 'citizen', by: 'simulation' }), FIXTURE_CONFIRM_MS);
      }, FIXTURE_SHARE_MS);
    },
    dispose() { clearTimeout(timer); listeners.clear(); },
  };
}
