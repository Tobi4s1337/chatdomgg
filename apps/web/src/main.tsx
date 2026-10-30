import type { Component } from 'solid-js';
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
const laneViews = import.meta.glob<{ default: Component }>(['../../panel/src/Panel.tsx', './stream/index.tsx', './avatar-bench/index.tsx', './forge-bench/index.tsx', './audio-bench/index.tsx', './template-bench/index.tsx', './citizen-behaviour-bench/index.tsx', './forge-ritual-bench/index.tsx', './forge-refusal-bench/index.tsx']);
const lanePaths: Record<string, string> = {
  '/panel': '../../panel/src/Panel.tsx', '/stream': './stream/index.tsx',
  '/-/forge-ritual':'./forge-ritual-bench/index.tsx','/-/forge-refusal':'./forge-refusal-bench/index.tsx',
  '/-/templates': './template-bench/index.tsx', '/-/citizen-behaviour': './citizen-behaviour-bench/index.tsx',
  '/-/avatars': './avatar-bench/index.tsx', '/-/forge': './forge-bench/index.tsx', '/-/audio': './audio-bench/index.tsx',
};
const loadLane = laneViews[lanePaths[window.location.pathname] ?? ''];
if (loadLane) {
  const module = await loadLane();
  render(() => <module.default />, root);
} else if (window.location.pathname==='/-/content') {
  const {ContentBench}=await import('./content-bench');
  render(() => <ContentBench />,root);
} else if (/^\/map(?:\/|$)/.test(window.location.pathname) && loadAtlas) {
  const module = await loadAtlas();
  render(() => <module.default />, root);
} else {
  if(window.location.pathname==='/panel') {
    render(() => <App />, root);
    requestAnimationFrame(() => { (window as Window & { __chatdomReady?: boolean }).__chatdomReady = true; });
  } else {
    const {default:Kingdom}=await import('./kingdom');
    render(() => <Kingdom />, root);
  }
}
