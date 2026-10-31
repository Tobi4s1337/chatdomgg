// The SIMULATED Willowmere night. Selected only by an explicit `source=simulated`.
// It sends nothing anywhere: lighting a window, voting, hauling or striking here
// changes this fixture alone, the shelf never uses Bits, and every snapshot it
// produces carries the SIMULATED mark. Its words are authored fixture copy standing
// in for what a kingdom service would one day supply.
import { ALL_SECTIONS, type ActStatus, type Ballad, type Coals, type CrowdAct, type Earned, type Forge, type Home, type Light, type LightChoice, type PanelAdapter, type PanelSnapshot, type Picture, type Raising, type Sections, type Shelf, type ShelfRequest, type SourceMark, type Tavern, type Tonight } from '../model';
import { DEFAULT_SHELF, SHELF_MENU, shelfProducts } from '../shelf-menu';
import { openSimulationWire } from './simulation';
import { FIXTURE_PROVENANCE } from '../assets/fixture/provenance';
import kingdomStill from '../assets/fixture/willowmere-kingdom.webp';
import portraitStill from '../assets/fixture/willowmere-portrait.webp';
import restingStill from '../assets/fixture/willowmere-resting.webp';
import windowStill from '../assets/fixture/willowmere-window.webp';

/** The deterministic cases a review can ask for with `state=`. */
export const FIXTURE_STATES = [
  'unshared', 'logged-out', 'refused', 'named', 'unnamed', 'guest', 'resting', 'disconnected', 'missing',
  // Tonight's shared moments: a world vote, the King's Errand, the earned dragon, a vote that has closed,
  // and a vote seen by someone who has not shared who they are.
  'vote', 'errand', 'dragon', 'act-ended', 'act-unshared',
  // A kingdom and a viewer with the longest names the panel must still set well.
  'long-names',
] as const;
export type FixtureState = typeof FIXTURE_STATES[number];

const SIMULATED: SourceMark = { kind: 'simulated', label: 'SIMULATED', detail: 'A simulated night in Willowmere. Nothing here reaches a real kingdom.' };
/** How long the fixture plays Twitch's identity prompt, then the kingdom's answer, so each step is seen. */
export const FIXTURE_SHARE_MS = 900;
export const FIXTURE_CONFIRM_MS = 1400;
/** How long the kingdom takes to count a tap, and how long Twitch's Bits window stays open before it is closed. */
export const FIXTURE_ACT_MS = 700;
export const FIXTURE_BITS_MS = 1600;
/** The simulated viewer. A Twitch display name, as the kingdom would supply it once identity is shared. */
const VIEWER = 'Wrenfeather';
/** The long-names case: a kingdom name near its 64-character limit and a full 25-character Twitch name. */
const LONG = { kingdom: 'Saint Wilhelmina’s Rest under the Thornwood Hills', viewer: 'Bartholomew_Featherstone7', street: 'The Lamplighters’ Long Walk' } as const;
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
    case 'long-names': return { kind: 'lit', choice: 'named', as: 'citizen', by: 'simulation' };
    case 'vote': case 'errand': case 'dragon': case 'act-ended': return { kind: 'lit', choice: 'named', as: 'citizen', by: 'simulation' };
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

const WELL_HOUSE: Raising = { building: 'The well-house', progress: 0.58, steps: 3, next: 'Clean water on the square, and the market can open' };

function tonightFor(state: FixtureState): Tonight {
  if (state === 'missing') return { kind: 'unavailable', reason: 'Tonight’s moments have not reached the panel.' };
  if (state === 'resting') {
    return {
      kind: 'supplied', night: 'last-night', chapter: 'The Well-house Night',
      summary: 'The kingdom is resting after the Well-house Night. The scaffold stands at its second storey.',
      moments: [...MOMENTS, { id: 'rest', at: '11:02 pm', text: 'The stream ended and the lamps began to dim.' }],
      raising: WELL_HOUSE,
      ballad: BALLAD,
    };
  }
  return {
    kind: 'supplied', night: 'tonight', chapter: null,
    summary: 'The beacon is lit and windows are coming on along Lantern Row. The well-house scaffold is at its second storey.',
    moments: MOMENTS,
    raising: WELL_HOUSE,
    ballad: null,
  };
}

const CITIZEN_HISTORY: readonly Earned[] = [
  { id: 'moved', text: 'Moved in on Lantern Row', at: '3 October' },
  { id: 'riddle', text: 'Sat at the hearth table for a riddle game', at: '21 October' },
  { id: 'well', text: 'Helped raise the well-house scaffold', at: 'Tonight' },
];

function homeFor(state: FixtureState, light: Light): Home {
  const long = state === 'long-names';
  const citizen = (named: boolean): Home => ({
    kind: 'citizen', street: long ? LONG.street : 'Lantern Row', place: 'Fourth house on the left, two doors from the lane',
    description: 'A cream-walled house with a flower box under the front window.',
    displayName: named ? (long ? LONG.viewer : VIEWER) : null, picture: still('window', windowStill),
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
  if (state === 'disconnected') return { kind: 'unavailable', reason: `The tavern is out of reach since ${LOST_AT}.` };
  const place = 'The Copper Kettle', where = 'On the market square';
  if (state === 'resting') {
    return {
      kind: 'supplied', place, where, watching: 'The tavern stays lit while the kingdom rests. Walkers can still sit down inside.',
      tables: [
        { id: 'hearth', name: 'The hearth table', game: null, now: 'Quiet. Last night’s riddle game ended at 10:58 pm.', seats: 6, seated: [] },
        { id: 'window', name: 'The window table', game: null, now: 'Free. Anyone inside can ask it for a game.', seats: 4, seated: [] },
      ],
    };
  }
  return {
    kind: 'supplied', place, where, watching: 'You can follow every table from here. Seats are taken inside the kingdom.',
    tables: [
      { id: 'hearth', name: 'The hearth table', game: 'Herald’s Quiz', now: 'Round three of five. Juniper leads by one riddle.', seats: 6, seated: ['Juniper', 'Moss', 'Sable', 'Thistledown'] },
      { id: 'window', name: 'The window table', game: 'Liar’s Dice', now: 'Between hands. The cup is with Ottoline.', seats: 4, seated: ['Ottoline', 'Brannoc'] },
      { id: 'corner', name: 'The corner table', game: null, now: 'Free. Anyone inside can ask it for a game.', seats: 4, seated: [] },
    ],
  };
}

function coalsFor(home: Home): Coals {
  if (home.kind === 'citizen') return { kind: 'known', held: 2, cap: 3, damp: false };
  if (home.kind === 'guest') return { kind: 'unknown', reason: 'Coals come from a home. As a guest here, you forge where you live.' };
  return { kind: 'unknown', reason: 'Your coals show here once the kingdom knows who you are.' };
}

function forgeFor(state: FixtureState, home: Home): Forge {
  if (state === 'missing') return { kind: 'unavailable', reason: 'The forge has not reached the panel.' };
  if (state === 'disconnected') return { kind: 'unavailable', reason: `The forge is out of reach since ${LOST_AT}.` };
  const made = [
    { id: 'heron', text: 'A heron weathervane, by Juniper' },
    { id: 'sign', text: 'A painted sign for the bakery, by Moss' },
  ];
  return state === 'resting'
    ? { kind: 'supplied', fire: 'banked', anvils: { total: 3, working: 0 }, coals: coalsFor(home), made }
    : { kind: 'supplied', fire: 'burning', anvils: { total: 3, working: 2 }, coals: coalsFor(home), made };
}

/** What an act needs before one tap can count: a person the kingdom knows, as in chat. */
function gateFor(light: Light, status: ActStatus): ActStatus {
  if (status.kind === 'ended') return status;
  switch (light.kind) {
    case 'lit': return status.kind === 'unavailable' ? { kind: 'open' } : status;
    case 'pending': return { kind: 'unavailable', reason: 'Waiting for the kingdom to find you.', way: null };
    case 'logged-out': return { kind: 'unavailable', reason: 'Log in to Twitch to join in. Chat still counts.', way: null };
    default: return { kind: 'unavailable', reason: 'One person, one vote: the kingdom needs to know who you are.', way: 'light' };
  }
}

const VOTE: Omit<CrowdAct, 'status'> = {
  id: 'square', kind: 'vote', title: 'A world vote', prompt: 'The crown asks: what should the market square get first?',
  command: '!vote', options: [{ id: '1', label: 'Lanterns' }, { id: '2', label: 'A fountain' }],
  limit: 'One vote each, the same as in chat.', closes: '8:52 pm', raising: null,
};
const ERRAND: Omit<CrowdAct, 'status'> = {
  id: 'errand', kind: 'errand', title: 'The King’s Errand', prompt: 'Haul stone to the well-house scaffold.',
  command: '!haul', options: [{ id: 'haul', label: 'Haul a stone' }],
  limit: 'One haul every 20 seconds, as in chat.', closes: null, raising: WELL_HOUSE,
};
const DRAGON: Omit<CrowdAct, 'status'> = {
  id: 'dragon', kind: 'dragon', title: 'The dragon is awake', prompt: 'The Errand rang the Wyrm Bell. It circles the mill: strike together.',
  command: '!strike', options: [{ id: 'strike', label: 'Strike' }],
  limit: 'One strike every 5 seconds, as in chat.', closes: null, raising: null,
};
const REST_MS: Record<CrowdAct['kind'], number | null> = { vote: null, errand: 20_000, dragon: 5_000 };

function actFor(state: FixtureState, light: Light): CrowdAct | null {
  switch (state) {
    case 'vote': case 'act-unshared': return { ...VOTE, status: gateFor(light, { kind: 'open' }) };
    case 'errand': return { ...ERRAND, status: gateFor(light, { kind: 'open' }) };
    case 'dragon': return { ...DRAGON, status: gateFor(light, { kind: 'open' }) };
    case 'act-ended': return { ...VOTE, status: { kind: 'ended', outcome: 'The vote closed at 8:52 pm. Willowmere chose lanterns.' } };
    default: return null;
  }
}

/** The shelf shows only while the stream is live, to someone Twitch lets use Bits. */
function shelfFor(state: FixtureState, light: Light, request: ShelfRequest, settings: FixtureSettings): Shelf {
  if (state === 'resting' || state === 'disconnected' || state === 'missing' || light.kind === 'logged-out') return { kind: 'hidden' };
  if (settings.hidden || !settings.sections.shelf) return { kind: 'hidden' };
  const products = shelfProducts(settings.products, '8:40 pm tomorrow');
  return products.length ? { kind: 'offered', products, request, by: 'simulation' } : { kind: 'hidden' };
}

/**
 * The streamer's side of the simulated night: which sections show, which shelf items are
 * offered, and whether Hide has paused the panel's moments. Hide clears the crowd act and
 * the shelf from the panel at once; what was under way resumes as it was when shown again.
 */
export interface FixtureSettings {
  readonly sections: Sections;
  readonly products: readonly string[];
  readonly hidden: boolean;
}
export const DEFAULT_SETTINGS: FixtureSettings = { sections: ALL_SECTIONS, products: DEFAULT_SHELF, hidden: false };

/** The fixture also takes the streamer's settings; nothing else ever can. */
export interface FixtureAdapter extends PanelAdapter {
  configure(next: Partial<FixtureSettings>): void;
}

interface Night { readonly light: Light; readonly act: CrowdAct | null; readonly request: ShelfRequest; readonly raised: number }

function snapshotFor(state: FixtureState, night: Night, settings: FixtureSettings): PanelSnapshot {
  const resting = state === 'resting', light = night.light;
  const home = homeFor(state, light);
  const tonight = tonightFor(state);
  const raise = (raising: Raising | null): Raising | null => raising && { ...raising, progress: Math.min(1, raising.progress + night.raised) };
  const act = night.act && !settings.hidden && settings.sections.acts ? { ...night.act, raising: raise(night.act.raising) } : null;
  return {
    source: SIMULATED,
    connection: state === 'disconnected' ? { kind: 'lost', asOf: LOST_AT } : { kind: 'fixture' },
    kingdom: { name: state === 'long-names' ? LONG.kingdom : 'Willowmere', tier: 'town', motto: resting ? 'Resting between streams' : 'A town at dusk' },
    stream: resting ? 'resting' : 'live',
    picture: resting ? still('resting', restingStill, null, 'Simulated still · between streams') : still('kingdom', kingdomStill, portraitStill),
    light,
    tonight: tonight.kind === 'supplied' ? { ...tonight, raising: raise(tonight.raising) } : tonight,
    home,
    tavern: tavernFor(state),
    forge: forgeFor(state, home),
    act,
    shelf: shelfFor(state, light, night.request, settings),
    entry: { kind: 'gate', path: '/?source=simulated&seed=willowmere&tier=town' },
    sections: settings.sections,
  };
}

export function createFixtureAdapter(state: FixtureState = 'unshared', initial: Partial<FixtureSettings> = {}): FixtureAdapter {
  const listeners = new Set<(snapshot: PanelSnapshot) => void>();
  const light = initialLight(state);
  let night: Night = { light, act: actFor(state, light), request: { kind: 'idle' }, raised: 0 };
  let settings: FixtureSettings = { ...DEFAULT_SETTINGS, ...initial };
  let snapshot = snapshotFor(state, night, settings);
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (ms: number, run: () => void) => { const timer = setTimeout(() => { timers.delete(timer); run(); }, ms); timers.add(timer); };
  // The simulated viewer struck from chat a moment before opening the panel, so the dragon's first tap meets chat's own pause.
  let struckFromChat = state === 'dragon';
  const publish = () => {
    snapshot = snapshotFor(state, night, settings);
    for (const listener of listeners) listener(snapshot);
  };
  const set = (next: Partial<Night>) => { night = { ...night, ...next }; publish(); };
  const configure = (next: Partial<FixtureSettings>) => {
    settings = { ...settings, ...next, products: (next.products ?? settings.products).filter(sku => SHELF_MENU.some(item => item.sku === sku)) };
    publish();
  };
  // The streamer's simulated Hide, from the live dashboard in any view beside this one.
  const wire = openSimulationWire(message => { if (message.kind === 'hide' && message.hidden !== settings.hidden) configure({ hidden: message.hidden }); });
  wire?.post({ kind: 'ask' });
  const setLight = (next: Light) => set({ light: next, act: night.act && { ...night.act, status: gateFor(next, night.act.status) } });
  const setAct = (status: ActStatus) => { if (night.act) set({ act: { ...night.act, status } }); };
  return {
    get: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    configure,
    // The simulated journey: Twitch shares who you are, then the kingdom answers. Nothing leaves the page.
    requestLight(choice: LightChoice) {
      if (snapshot.light.kind !== 'unshared' && snapshot.light.kind !== 'refused') return;
      setLight({ kind: 'pending', choice, step: 'sharing' });
      later(FIXTURE_SHARE_MS, () => {
        setLight({ kind: 'pending', choice, step: 'confirming' });
        later(FIXTURE_CONFIRM_MS, () => setLight({ kind: 'lit', choice, as: 'citizen', by: 'simulation' }));
      });
    },
    // One tap, one command, counted by the simulated kingdom under chat's limits. It changes only this fixture.
    requestAct(option: string) {
      // A hidden act is not there to tap: the panel shows none, and a stray call counts nothing.
      const act = night.act;
      if (!act || !snapshot.act || act.status.kind !== 'open' || !act.options.some(o => o.id === option)) return;
      setAct({ kind: 'pending', option });
      later(FIXTURE_ACT_MS, () => {
        const rest = REST_MS[act.kind];
        if (struckFromChat) {
          struckFromChat = false;
          setAct({ kind: 'limited', words: 'You struck from chat a moment ago. The same pause counts here.', restMs: rest ?? 0 });
        } else {
          setAct({ kind: 'accepted', option, restMs: rest });
          // One stone among the whole town's: the scaffold rises a hair, never a storey at a tap.
          if (act.kind === 'errand') set({ raised: night.raised + 0.004 });
        }
        if (rest !== null) later(rest, () => { if (night.act?.status.kind === 'accepted' || night.act?.status.kind === 'limited') setAct({ kind: 'open' }); });
      });
    },
    // Twitch's own window would ask to confirm. In the simulation it never opens and is always closed: no Bits are used.
    requestProduct(sku: string) {
      if (snapshot.shelf.kind !== 'offered' || night.request.kind === 'confirming' || !snapshot.shelf.products.some(p => p.sku === sku)) return;
      set({ request: { kind: 'confirming', sku } });
      later(FIXTURE_BITS_MS, () => set({ request: { kind: 'cancelled', sku } }));
    },
    dispose() { for (const timer of timers) clearTimeout(timer); timers.clear(); listeners.clear(); wire?.close(); },
  };
}
