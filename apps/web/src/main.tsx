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
if (/^\/map(?:\/|$)/.test(window.location.pathname) && loadAtlas) {
  const module = await loadAtlas();
  render(() => <module.default />, root);
} else {
  render(() => <App />, root);
  requestAnimationFrame(() => { (window as Window & { __chatdomReady?: boolean }).__chatdomReady = true; });
}
