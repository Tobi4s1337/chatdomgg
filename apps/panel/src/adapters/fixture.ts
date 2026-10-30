// The SIMULATED Willowmere night. Selected only by an explicit `source=simulated`.
// It sends nothing anywhere: lighting a window here changes this fixture alone,
// and every snapshot it produces carries the SIMULATED mark.
import type { Light, LightChoice, PanelAdapter, PanelSnapshot, Picture, SourceMark } from '../model';
import { FIXTURE_PROVENANCE } from '../assets/fixture/provenance';
import kingdomStill from '../assets/fixture/willowmere-kingdom.webp';
import portraitStill from '../assets/fixture/willowmere-portrait.webp';
import windowStill from '../assets/fixture/willowmere-window.webp';

export const FIXTURE_STATES = ['unshared', 'logged-out', 'named', 'unnamed'] as const;
export type FixtureState = typeof FIXTURE_STATES[number];

const SIMULATED: SourceMark = { kind: 'simulated', label: 'SIMULATED', detail: 'A simulated night in Willowmere. Nothing here reaches a real kingdom.' };
/** How long the fixture takes to "confirm" a light, so the pending state is seen. */
export const FIXTURE_CONFIRM_MS = 1400;

function still(id: 'kingdom' | 'window', url: string, portrait: string | null = null): Picture {
  const record = FIXTURE_PROVENANCE.pictures[id], upright = FIXTURE_PROVENANCE.pictures.portrait;
  return {
    kind: 'still', url, alt: record.alt, width: record.width, height: record.height,
    portrait: portrait ? { url: portrait, width: upright.width, height: upright.height } : null,
    provenance: {
      origin: 'simulated', caption: 'Simulated still',
      render: { route: record.render.route, seed: record.render.seed, hour: record.render.hour, camera: record.render.camera },
      capturedOn: FIXTURE_PROVENANCE.capturedOn,
    },
  };
}

export function fixtureState(raw: string | null): FixtureState {
  return (FIXTURE_STATES as readonly string[]).includes(raw ?? '') ? raw as FixtureState : 'unshared';
}

function initialLight(state: FixtureState): Light {
  if (state === 'logged-out') return { kind: 'logged-out' };
  if (state === 'named' || state === 'unnamed') return { kind: 'lit', choice: state, by: 'simulation' };
  return { kind: 'unshared' };
}

function snapshotFor(light: Light): PanelSnapshot {
  const choice = light.kind === 'lit' || light.kind === 'pending' ? light.choice : null;
  return {
    source: SIMULATED,
    connection: { kind: 'fixture' },
    kingdom: { name: 'Willowmere', tier: 'town', motto: 'A town at dusk' },
    stream: 'live',
    picture: still('kingdom', kingdomStill, portraitStill),
    light,
    tonight: {
      kind: 'supplied',
      summary: 'The beacon is lit and windows are coming on along Lantern Row. The well-house stands two thirds raised.',
      moments: [
        { id: 'beacon', at: '8:02 pm', text: 'The stream began and the castle beacon was lit.' },
        { id: 'first', at: '8:03 pm', text: 'Juniper’s window was the first lit on Lantern Row.' },
        { id: 'mill', at: '8:15 pm', text: 'Moss and Sable came home to the mill streets.' },
        { id: 'well', at: '8:40 pm', text: 'Channel points raised the well-house scaffold a storey.' },
      ],
      raising: { building: 'The well-house', progress: 0.66, next: 'Then lanterns for the market square' },
    },
    home: {
      kind: 'supplied', street: 'Lantern Row', description: 'A cream-walled house with a flower box, two doors from the lane.',
      displayName: choice === 'unnamed' ? null : 'Juniper', picture: still('window', windowStill),
    },
    tavern: { kind: 'supplied', place: 'The Copper Kettle', table: 'The hearth table', watching: 'A riddle game is under way at the hearth table.' },
  };
}

export function createFixtureAdapter(state: FixtureState = 'unshared'): PanelAdapter {
  const listeners = new Set<(snapshot: PanelSnapshot) => void>();
  let snapshot = snapshotFor(initialLight(state));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const set = (light: Light) => { snapshot = snapshotFor(light); for (const listener of listeners) listener(snapshot); };
  return {
    get: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    requestLight(choice: LightChoice) {
      if (snapshot.light.kind !== 'unshared') return;
      set({ kind: 'pending', choice });
      timer = setTimeout(() => set({ kind: 'lit', choice, by: 'simulation' }), FIXTURE_CONFIRM_MS);
    },
    dispose() { clearTimeout(timer); listeners.clear(); },
  };
}
