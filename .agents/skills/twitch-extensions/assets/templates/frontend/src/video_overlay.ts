/**
 * Video overlay view: transparent iframe over the whole player. Keep it small, show it with the player
 * controls, hide when the extension is hidden (ads, pause) and let viewers minimize it.
 */
import './style.css';
import { $, ext, listenJson, onContextChange, onPollConfig, setText, syncTheme, type PollConfig, type PollState } from './lib/ext.ts';

syncTheme();
let config: PollConfig | null = null;
let tallies: number[] = [];
let controlsVisible = false;
let highlighted = false;

function render(): void {
  const card = $('overlay');
  card.hidden = !config || !(controlsVisible || highlighted);
  if (!config) return;
  setText('question', config.question);
  $('options').replaceChildren(
    ...config.options.map((label, i) => {
      const li = document.createElement('li');
      li.textContent = `${label}: ${tallies[i] ?? 0}`;
      return li;
    }),
  );
}

onPollConfig((cfg) => {
  config = cfg;
  render();
});
listenJson<PollState>('broadcast', (msg) => {
  if (msg.type === 'poll_state') {
    tallies = msg.tallies;
    render();
  }
});

// Show the card while the viewer is interacting with the player (not sent on mobile).
onContextChange((ctx) => {
  controlsVisible = ctx.arePlayerControlsVisible ?? controlsVisible;
  render();
});
// Hovering the extension's menu icon highlights it.
ext.onHighlightChanged((isHighlighted) => {
  highlighted = isHighlighted;
  render();
});
// Hidden (ad break, paused, viewer toggled): stop work; you get no onContext while hidden.
ext.onVisibilityChanged((isVisible) => {
  document.body.classList.toggle('is-hidden', !isVisible);
});
$('minimize').addEventListener('click', () => ext.actions.minimize());
