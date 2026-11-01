import type { Component } from 'solid-js';
import { KingdomIdSchema } from '@chatdom/shared';
import { REALM_ENTRY_ROUTE, RealmEntryInfoSchema, RealmApiErrorSchema } from '@chatdom/shared/realm';
import type { KingdomEntrySource } from './kingdom-entry/types';
import { render } from 'solid-js/web';
import './style.css';

const surface = window.location.pathname === '/stream' ? 'Stream bench' : window.location.pathname === '/panel' ? 'Panel bench' : 'Build bench';
function App() {
  return <main><div class="rule" /><p class="eyebrow">CHATDOM · {surface}</p><div class="seal" aria-hidden="true">C</div><h1>Your chat<br/>has a home.</h1><p class="lede">A kingdom lit by its people.</p><div class="note"><span class="dot" /> Development workspace</div><p class="foot">The foundation is ready.<br/>The kingdom comes next.</p><div class="rule bottom" /></main>;
}
const root = document.getElementById('root');
if (!root) throw new Error('Missing application root');
const atlas = import.meta.glob<{ default: Component }>('./atlas/index.tsx');
const loadAtlas = atlas['./atlas/index.tsx'];
const laneViews = import.meta.glob<{ default: Component }>(['../../panel/src/Panel.tsx', './stream/index.tsx', './avatar-bench/index.tsx', './forge-bench/index.tsx', './audio-bench/index.tsx', './template-bench/index.tsx', './citizen-behaviour-bench/index.tsx', './forge-ritual-bench/index.tsx', './forge-refusal-bench/index.tsx', './citizen-card/index.tsx', './twitch-moments-bench/index.tsx', './campfire/index.tsx', './tavern/index.tsx', './raid-gate/index.tsx', './emotes/index.tsx', './passport/index.tsx', './grand/index.tsx']);
const lanePaths: Record<string, string> = {
  '/-/passport':'./passport/index.tsx', '/-/grand':'./grand/index.tsx',
  '/-/citizen-card':'./citizen-card/index.tsx', '/-/twitch-moments':'./twitch-moments-bench/index.tsx', '/-/campfire':'./campfire/index.tsx',
  '/-/tavern':'./tavern/index.tsx', '/-/raid-gate':'./raid-gate/index.tsx', '/-/emotes':'./emotes/index.tsx',
  '/panel': '../../panel/src/Panel.tsx', '/stream': './stream/index.tsx',
  '/-/forge-ritual':'./forge-ritual-bench/index.tsx','/-/forge-refusal':'./forge-refusal-bench/index.tsx',
  '/-/templates': './template-bench/index.tsx', '/-/citizen-behaviour': './citizen-behaviour-bench/index.tsx',
  '/-/avatars': './avatar-bench/index.tsx', '/-/forge': './forge-bench/index.tsx', '/-/audio': './audio-bench/index.tsx',
};
const loadLane = laneViews[lanePaths[window.location.pathname] ?? ''];
if (/^\/kingdom\/[1-9][0-9]*$/.test(window.location.pathname)) {
  const { default: GenesisPreview } = await import('./genesis');
  render(() => <GenesisPreview />, root);
} else if (window.location.pathname === '/-/avatar-builder') {
  await import('./avatar-builder/builder-bench');
} else if (window.location.pathname === '/showcase') {
  const { default: Showcase } = await import('./showcase');
  render(() => <Showcase />, root);
} else if (window.location.pathname === '/-/realm') {
  const { default: RealmReference } = await import('./realm-reference');
  render(() => <RealmReference />, root);
} else if (loadLane) {
  const module = await loadLane();
  render(() => <module.default />, root);
} else if (window.location.pathname==='/-/content') {
  const {ContentBench}=await import('./content-bench');
  render(() => <ContentBench />,root);
} else if (/^\/map(?:\/|$)/.test(window.location.pathname) && loadAtlas) {
  const module = await loadAtlas();
  render(() => <module.default />, root);
} else if (new URLSearchParams(location.search).get('walk') === '1') {
  const [{ default: KingdomEntry }, { openSimulatedKingdomEntry }, { createLiveKingdomEntrySource }, { RealmEntryError, readRealmJson }] = await Promise.all([
    import('./kingdom-entry'), import('./kingdom-entry/simulated'), import('./kingdom-entry/live'), import('./realm/adapters/entry'),
  ]);
  const query = new URLSearchParams(location.search);
  let checkedLiveSource: KingdomEntrySource | undefined;
  const live: KingdomEntrySource = async signal => {
    if (checkedLiveSource) return checkedLiveSource(signal);
    const kingdom = KingdomIdSchema.safeParse(query.get('kingdom'));
    if (!kingdom.success) throw new RealmEntryError('refused', 'Choose a kingdom to visit from the Atlas.');
    const response = await fetch(REALM_ENTRY_ROUTE.replace(':kingdomId', encodeURIComponent(kingdom.data)), {
      signal, credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' },
    });
    const body = await readRealmJson(response, `Finding the kingdom (/api/realm/entry/${kingdom.data})`);
    if (!response.ok) {
      const error = RealmApiErrorSchema.safeParse(body);
      throw new RealmEntryError(error.success ? error.data.status : response.status === 401 ? 'unauthenticated' : 'unavailable',
        error.success ? error.data.message : response.status === 401 ? 'Sign in with Twitch to walk into this kingdom.' : 'The kingdom’s gate cannot be reached right now.');
    }
    const info = RealmEntryInfoSchema.safeParse(body);
    if (!info.success || info.data.kingdomId !== kingdom.data || info.data.origin !== 'live') {
      throw new RealmEntryError('unavailable', 'The kingdom’s approved name is not available yet.');
    }
    checkedLiveSource = createLiveKingdomEntrySource({ kingdomId: kingdom.data, kingdomName: info.data.name,
      endpoint: `${location.origin}/live-realm-data` });
    return checkedLiveSource(signal);
  };
  render(() => <KingdomEntry open={query.get('source') === 'simulated' ? openSimulatedKingdomEntry : live} />, root);
} else {
  if(window.location.pathname==='/panel') {
    render(() => <App />, root);
    requestAnimationFrame(() => { (window as Window & { __chatdomReady?: boolean }).__chatdomReady = true; });
  } else {
    const {default:Kingdom}=await import('./kingdom');
    render(() => <Kingdom />, root);
  }
}
