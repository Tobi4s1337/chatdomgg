/**
 * A dev-only bench for the painted map: the minimap over a dusk street still, and the ledger's Map page on a leaf,
 * both drawn from the real old town plan. Served by the web dev server at /src/play/map/bench.html; never linked
 * from a route and never in the build.
 *
 * Query: view=mini|page (both when absent) · home=none · inside=1 · friends=<n> (SIMULATED pins) · reduced=1 ·
 * land=grand (the grand land's founding) · home=<index> · w=<px>&h=<px> (the bench in a frame of that size).
 */
import '@chatdom/ui/kit.css';
import { render } from 'solid-js/web';
import { generateSettlementPlan, type SettlementPlan } from '@chatdom/world';
import oldTown from '../../../../realm/src/founded/artifacts/simulated-town.scene.json';
import backdrop from '../../../../../work/evidence/PL03/street-final@1920x1080.png?url';
import type { PlayCue, PlayMapView, PlayWayHomeLights } from '../host';
import { MapPage } from './MapPage';
import { Minimap } from './Minimap';
import { routeHome, streetGraph } from './route';
import { homeDoor, townMapFrom } from './town';
import type { MapFriend } from './people';
import './map.css';

declare global { interface Window { __chatdomReady?: boolean; __mapBench?: { cues: PlayCue[] } } }

const query = new URLSearchParams(location.search);
const stage = document.querySelector<HTMLDivElement>('#stage')!;

// A frame of a given size (a phone on a desktop screen): the bench again inside it, so media queries are true.
const framed = Number(query.get('w'));
if (framed > 0 && Math.abs(innerWidth - framed) > 2) {
  const inner = new URLSearchParams(query); inner.delete('w'); inner.delete('h');
  const frame = document.createElement('iframe');
  frame.className = 'bench-frame'; frame.width = String(framed); frame.height = String(Number(query.get('h')) || 844);
  frame.src = `${location.pathname}?${inner}`;
  stage.dataset.view = 'framed';
  stage.append(frame);
  frame.addEventListener('load', () => {
    const poll = () => { if (frame.contentWindow?.__chatdomReady) window.__chatdomReady = true; else setTimeout(poll, 50); };
    poll();
  });
} else {
  mount();
}

function plan(): SettlementPlan {
  if (query.get('land') === 'grand') {
    const config = { seed: 'tobi4s_', tier: 'town', firstYear: 2019, year: 2026 } as const;
    try { return generateSettlementPlan(config); } catch { return generateSettlementPlan({ ...config, firstYear: 2022 }); }
  }
  return (oldTown as unknown as { plan: SettlementPlan }).plan;
}

function mount() {
  const settlement = plan();
  const town = townMapFrom(settlement);
  const graph = streetGraph(settlement);
  const homeParam = query.get('home');
  const homeIndex = homeParam && homeParam !== 'none' ? Number(homeParam) : 37;
  const home = homeParam === 'none' ? null : settlement.homes[Math.min(settlement.homes.length - 1, Math.max(0, homeIndex))] ?? null;
  const inside = query.get('inside') === '1' && !!home;

  // You stand on a street about 150 m from the home's door (or from the market when there is none).
  const target = home ? homeDoor(settlement, home) : [0, 0, 10] as const;
  const active = new Set(settlement.activeStreetIds);
  let feet: [number, number, number] = [0, 9, 10], best = Infinity;
  for (const street of settlement.streets) {
    if (!active.has(street.id) || street.kind === 'approach') continue;
    for (const p of street.points) {
      const d = Math.abs(Math.hypot(p[0] - target[0], p[2] - target[2]) - 150) + (p[0] < target[0] ? 40 : 0);
      if (d < best) { best = d; feet = [p[0], p[1], p[2]]; }
    }
  }
  if (inside && home) feet = [home.position[0], home.position[1], home.position[2]];
  const route = home && !inside ? routeHome(settlement, graph, feet, home.id) : null;
  const first = route?.points[1] ?? null;
  const heading = first ? Math.atan2(first[0] - feet[0], first[2] - feet[2]) : 0.6;

  // SIMULATED friends, only when asked for: a few names standing near you.
  const names = ['Wren', 'Tamsin', 'Oren', 'Ilse'];
  const friends: MapFriend[] = Array.from({ length: Math.min(4, Math.max(0, Number(query.get('friends')) || 0)) }, (_, i) => {
    const a = i * 2.1 + .7, r = 18 + i * 9;
    return { id: `bench-friend-${i}`, name: names[i]!, x: feet[0] + Math.cos(a) * r, z: feet[2] + Math.sin(a) * r };
  });
  if (friends.length) {
    const stamp = document.createElement('p'); stamp.className = 'bench-simulated'; stamp.textContent = 'Simulated friends';
    stage.append(stamp);
  }

  const view: PlayMapView = {
    town, home: home?.id ?? null, inside, route,
    people: { you: { x: feet[0], z: feet[2], heading }, friends },
    view: heading + .3,
  };

  let lit = false;
  const listeners = new Set<(lit: boolean) => void>();
  const lights: PlayWayHomeLights = {
    light() { if (!route) return false; lit = true; for (const listener of listeners) listener(true); return true; },
    get lit() { return lit; },
    onChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
  const cues: PlayCue[] = [];
  window.__mapBench = { cues };
  const cue = (surface: PlayCue) => { cues.push(surface); };
  const reduced = () => query.get('reduced') === '1';
  const shown = query.get('view');
  stage.dataset.view = shown ?? 'both';
  if (shown !== 'page') stage.style.setProperty('--bench-backdrop', `url("${backdrop}")`);

  render(() => <>
    {shown !== 'page' && <div class="bench-hud"><Minimap map={() => view} reducedMotion={reduced} cue={cue} onOpen={() => { cues.push('wood'); }} /></div>}
    {shown !== 'mini' && <article class="bench-leaf">
      <header class="bench-head"><p class="bench-eyebrow">Folio iii</p><h2 class="bench-title">Map</h2></header>
      <div class="bench-body"><MapPage map={() => view} lights={lights} cue={cue} reducedMotion={reduced} /></div>
    </article>}
  </>, stage);

  // Ready once the faces have arrived and a few frames have painted the town with them.
  const faces = ['16px "IM Fell English"', 'italic 13px "IM Fell English"', '13px "IM Fell English SC"', 'italic 13px Alegreya', '16px Alegreya'];
  void Promise.all(faces.map(face => document.fonts.load(face))).then(() => {
    let frames = 0;
    const wait = () => { if (++frames < 8) requestAnimationFrame(wait); else setTimeout(() => { window.__chatdomReady = true; }, 250); };
    requestAnimationFrame(wait);
  });
}
