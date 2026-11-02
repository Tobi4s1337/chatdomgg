import '@chatdom/ui/kit.css';
import { createKingdomAudio, kingdomAudioHost } from '@chatdom/audio';
import { createPierSound, inspectPierSound, type PierCue, type PierMood } from './index';

/**
 * A listening bench for every pier sound (`/-/pier?view=sound`): each beat on its own carved key, the continuous
 * beds on sliders, and a whole catch played through in time. It owns a fresh kingdom audio instance, woken by the
 * first touch, exactly as the kingdom wakes its own.
 */

const GROUPS: readonly (readonly [title: string, cues: readonly (readonly [PierCue, string, string])[]])[] = [
  ['The rack', [['take', 'Take the rod', 'wood knock, a little cloth'], ['stow', 'Stow it', 'set into the rack']]],
  ['The cast', [
    ['draw', 'Draw back', 'willow creak, line through the rings'], ['cast', 'Cast', 'swish, the line singing out'],
    ['plop', 'Float lands', 'a round plop, the ring spreading'],
  ]],
  ['The bite', [
    ['nibble', 'Nibble', 'the float ticks'], ['bite', 'Bite', 'the float snatched under'], ['strike', 'Strike', 'rod whip, line twang'],
    ['run', 'Run', 'line peeling off the drag'],
  ]],
  ['The end of it', [
    ['leap', 'Leap', 'breaking the surface'], ['flop', 'On the planks', 'a wet slap, two flaps'], ['tag', 'Tag', 'the paper slides in'],
    ['seal', 'Seal', 'the ink stamp'], ['snap', 'Line snaps', 'a crack, a loose whip'], ['escape', 'Thrown hook', 'a slack slap'],
  ]],
];

const MOODS: readonly (readonly [PierMood, string])[] = [['clear', 'Clear'], ['breeze', 'Breeze'], ['mist', 'Mist'], ['rain', 'Rain']];

/** One catch, in seconds from the press: the cues on time, and the reel and the line's load between them. */
const CATCH: readonly (readonly [number, PierCue, number?])[] = [
  [0, 'take'], [0.7, 'draw'], [1.25, 'cast'], [1.95, 'plop'], [3.1, 'nibble'], [3.75, 'nibble'], [4.5, 'bite'], [4.72, 'strike'],
  [5.4, 'run', 0.6], [7.2, 'run', 0.8], [9.1, 'leap', 0.75], [9.85, 'flop', 0.75], [10.6, 'tag'], [11.3, 'seal'], [12.6, 'stow'],
];
const CATCH_SECONDS = 13.4;

function catchLoad(time: number): { reel: number; tension: number } {
  if (time < 4.75 || time > 9.1) return { reel: 0, tension: 0 };
  const fight = time - 4.75;
  // Runs slacken the reel and load the line; between them the reel winds and the load eases a little.
  const running = (time > 5.4 && time < 6.2) || (time > 7.2 && time < 8.1);
  const tension = Math.min(1, 0.35 + 0.1 * fight + (running ? 0.35 : 0) + 0.06 * Math.sin(fight * 7));
  return { reel: running ? 0 : 0.55 + 0.25 * Math.sin(fight * 2.3), tension };
}

const STYLE = `
.pier-sound { position: fixed; inset: 0; overflow: auto; padding: 20px 16px 32px; box-sizing: border-box;
  background: radial-gradient(ellipse at 50% -10%, #3a3f52, #1f222c 70%); color: var(--cd-cream); font: var(--cd-type-body)/1.35 var(--cd-face-body); }
.pier-sound * { box-sizing: border-box; }
.pier-sound-board { max-width: 1180px; margin: 0 auto; display: grid; gap: 16px; }
.pier-sound-head { padding: 18px 22px; display: flex; flex-wrap: wrap; gap: 10px 18px; align-items: baseline; justify-content: space-between; }
.pier-sound-head h1 { margin: 0; font: var(--cd-type-title)/1.1 var(--cd-face-story); color: var(--cd-parch-hi); }
.pier-sound-status { margin: 0; font: italic var(--cd-type-small)/1.2 var(--cd-face-body); color: var(--cd-cream-soft); }
.pier-sound-status[data-awake='true'] { color: var(--cd-brass-hi); font-style: normal; }
.pier-sound-section { padding: 14px 16px 16px; }
.pier-sound-section h2 { margin: 0 0 10px; font: var(--cd-type-small)/1.1 var(--cd-face-label); letter-spacing: var(--cd-label-tracking); color: var(--cd-cream-soft); font-weight: 400; }
.pier-sound-keys { display: grid; grid-template-columns: repeat(auto-fill, minmax(132px, 1fr)); gap: 8px; }
.pier-sound-key { appearance: none; display: grid; gap: 2px; min-height: 58px; padding: 9px 12px 10px; text-align: left; cursor: pointer;
  color: var(--cd-cream); font: var(--cd-type-body)/1.15 var(--cd-face-body); border: 1px solid var(--cd-wood-edge); border-radius: 7px;
  background: repeating-linear-gradient(92deg, #ffdcae07 0 2px, transparent 2px 8px, #1a0c0412 8px 9px, transparent 9px 15px),
    linear-gradient(176deg, var(--cd-wood-hi), var(--cd-wood) 45%, var(--cd-wood-lo));
  box-shadow: inset 0 1px 0 #ffe1b440, inset 0 -2px 0 #00000040, 0 2px 0 #00000066; transition: transform .08s ease, box-shadow .08s ease; }
.pier-sound-key:hover { transform: translateY(-1px); box-shadow: inset 0 1px 0 #ffe1b44d, inset 0 -2px 0 #00000040, 0 3px 0 #0000006b; }
.pier-sound-key:active, .pier-sound-key[data-struck='true'] { transform: translateY(1px); box-shadow: inset 0 2px 3px #00000066, 0 1px 0 #00000055; }
.pier-sound-key b { font: var(--cd-type-lead)/1.1 var(--cd-face-story); font-weight: 400; color: var(--cd-parch-hi); }
.pier-sound-key span { font-size: var(--cd-type-min); color: var(--cd-cream-soft); }
.pier-sound-key:focus-visible, .pier-sound-mood:focus-visible, .pier-sound input:focus-visible { outline: var(--cd-focus-width) solid var(--cd-focus); outline-offset: var(--cd-focus-offset); }
.pier-sound-catch { width: 100%; min-height: 52px; text-align: center; display: block; }
.pier-sound-catch b { font-size: var(--cd-type-title); }
.pier-sound-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; align-items: start; }
.pier-sound-pairs { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 440px), 1fr)); gap: 16px; align-items: stretch; }
.pier-sound-head > div { display: grid; gap: 4px; justify-items: end; }
@media (max-width: 640px) { .pier-sound-head > div { justify-items: start; } .pier-sound-field { grid-template-columns: 92px 1fr 46px; } }
.pier-sound-field { display: grid; grid-template-columns: 110px 1fr 46px; align-items: center; gap: 10px; margin: 6px 0; }
.pier-sound-field label { font: var(--cd-type-small)/1.1 var(--cd-face-label); letter-spacing: var(--cd-label-tracking); color: var(--cd-cream-soft); }
.pier-sound-field output { font: var(--cd-type-small)/1 var(--cd-face-body); color: var(--cd-parch); text-align: right; font-variant-numeric: tabular-nums; }
.pier-sound input[type='range'] { width: 100%; accent-color: var(--cd-brass); }
.pier-sound-moods { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 4px; }
.pier-sound-mood { appearance: none; min-width: 72px; min-height: 36px; padding: 6px 12px; cursor: pointer; color: var(--cd-cream);
  font: var(--cd-type-small)/1 var(--cd-face-label); letter-spacing: var(--cd-label-tracking); border: 1px solid var(--cd-wood-edge); border-radius: 6px;
  background: linear-gradient(176deg, var(--cd-wood-hi), var(--cd-wood) 45%, var(--cd-wood-lo)); box-shadow: inset 0 1px 0 #ffe1b433, 0 2px 0 #00000055; }
.pier-sound-mood[aria-pressed='true'] { color: var(--cd-ink); background: linear-gradient(176deg, var(--cd-brass-hi), var(--cd-brass) 60%, var(--cd-brass-lo));
  box-shadow: inset 0 1px 2px #00000040; }
.pier-sound-report { margin: 0; font: var(--cd-type-min)/1.3 var(--cd-face-body); color: var(--cd-cream-soft); }
`;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, attributes: Record<string, string> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const made = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) made.setAttribute(name, value);
  made.append(...children);
  return made;
}

interface Slider { input: HTMLInputElement; value(): number; set(value: number): void }

function slider(parent: HTMLElement, id: string, label: string, min: number, max: number, step: number, value: number,
  show: (value: number) => string): Slider {
  const input = element('input', { id, type: 'range', min: String(min), max: String(max), step: String(step), value: String(value) });
  const output = element('output', { for: id }, show(value));
  input.addEventListener('input', () => { output.textContent = show(Number(input.value)); });
  parent.append(element('div', { class: 'pier-sound-field' }, element('label', { for: id }, label), input, output));
  return {
    input,
    value: () => Number(input.value),
    set(next) { input.value = String(next); output.textContent = show(next); },
  };
}

export function mountPierSoundBench(host: HTMLElement): () => void {
  const audio = createKingdomAudio();
  const sound = createPierSound(() => kingdomAudioHost(audio));
  const style = element('style', {}, STYLE);
  const status = element('p', { class: 'pier-sound-status', role: 'status' }, 'Sound is asleep. Press any key to wake it.');
  const report = element('p', { class: 'pier-sound-report', 'aria-live': 'off' }, '');
  const board = element('div', { class: 'pier-sound-board' });
  const root = element('section', { class: 'pier-sound cd-kit', 'aria-label': "The pier's sounds" }, board);
  host.replaceChildren(style, root);

  board.append(element('header', { class: 'pier-sound-head cd-plate' }, element('h1', {}, "The pier's sounds"), element('div', {}, status, report)));

  // Where the sound is: these shape every key below.
  const place = element('div', { class: 'pier-sound-section cd-plate' }, element('h2', {}, 'Where and how big'));
  const intensity = slider(place, 'pier-sound-intensity', 'Size', 0, 1, 0.05, 0.5, value => value < 0.3 ? 'small' : value > 0.7 ? 'big' : 'fair');
  const distance = slider(place, 'pier-sound-distance', 'Distance', 0, 40, 1, 0, value => `${value} m`);
  const pan = slider(place, 'pier-sound-pan', 'Side', -1, 1, 0.1, 0, value => Math.abs(value) < 0.05 ? 'centre' : value < 0 ? 'left' : 'right');

  const keys = new Map<PierCue, HTMLButtonElement>();
  const strike = (cue: PierCue, size?: number) => {
    void wake();
    sound.cue(cue, { intensity: size ?? intensity.value(), distance: distance.value(), pan: pan.value() });
    const key = keys.get(cue);
    if (key) { key.dataset.struck = 'true'; globalThis.setTimeout(() => { delete key.dataset.struck; }, 140); }
  };
  const catchKey = element('button', { type: 'button', class: 'pier-sound-key pier-sound-catch' }, element('b', {}, 'Play a whole catch'));
  board.append(element('div', { class: 'pier-sound-section cd-plate' }, catchKey));
  const pairs = element('div', { class: 'pier-sound-pairs' });
  board.append(pairs);
  for (const [title, cues] of GROUPS) {
    const row = element('div', { class: 'pier-sound-keys' });
    for (const [cue, name, note] of cues) {
      const key = element('button', { type: 'button', class: 'pier-sound-key', 'data-cue': cue }, element('b', {}, name), element('span', {}, note));
      key.addEventListener('click', () => strike(cue));
      keys.set(cue, key);
      row.append(key);
    }
    pairs.append(element('div', { class: 'pier-sound-section cd-plate' }, element('h2', {}, title), row));
  }

  const beds = element('div', { class: 'pier-sound-grid' });
  const hands = element('div', { class: 'pier-sound-section cd-plate' }, element('h2', {}, 'In the hands'));
  const reel = slider(hands, 'pier-sound-reel', 'Reeling', 0, 1, 0.01, 0, value => value === 0 ? 'still' : `${Math.round(value * 100)}%`);
  const tension = slider(hands, 'pier-sound-tension', 'Line load', 0, 1, 0.01, 0, value => value === 0 ? 'slack' : `${Math.round(value * 100)}%`);
  const water = element('div', { class: 'pier-sound-section cd-plate' }, element('h2', {}, 'The pier'));
  const near = slider(water, 'pier-sound-near', 'Nearness', 0, 1, 0.01, 1, value => value === 0 ? 'away' : `${Math.round(value * 100)}%`);
  const hour = slider(water, 'pier-sound-hour', 'Hour', 0, 24, 0.25, 21, value => `${String(Math.floor(value) % 24).padStart(2, '0')}:${String(Math.round((value % 1) * 60)).padStart(2, '0')}`);
  let mood: PierMood = 'clear';
  const moods = element('div', { class: 'pier-sound-moods', role: 'group', 'aria-label': 'Weather' });
  for (const [value, label] of MOODS) {
    const button = element('button', { type: 'button', class: 'pier-sound-mood', 'aria-pressed': String(value === mood) }, label);
    button.addEventListener('click', () => {
      mood = value;
      for (const other of moods.children) other.setAttribute('aria-pressed', String(other === button));
      void wake();
    });
    moods.append(button);
  }
  water.append(moods);
  beds.append(place, hands, water);
  board.append(beds);
  for (const input of [reel.input, tension.input, near.input, hour.input]) input.addEventListener('input', () => void wake());

  let awake = false;
  async function wake(): Promise<void> {
    if (awake) return;
    const ready = await audio.unlock();
    awake = ready;
    status.dataset.awake = String(ready);
    status.textContent = ready ? 'Sound on, at the world volume.' : 'This browser would not start sound. Press a key to try again.';
  }
  const onFirst = () => void wake();
  root.addEventListener('pointerdown', onFirst);
  root.addEventListener('keydown', onFirst);

  let playing: { start: number; next: number } | null = null;
  catchKey.addEventListener('click', () => { void wake(); playing = { start: performance.now(), next: 0 }; });

  let frame = 0, lastReport = 0;
  const tick = (now: number) => {
    frame = requestAnimationFrame(tick);
    if (playing) {
      const time = (now - playing.start) / 1000;
      while (playing.next < CATCH.length && CATCH[playing.next]![0] <= time) {
        const [, cue, size] = CATCH[playing.next++]!;
        strike(cue, size);
      }
      const load = catchLoad(time);
      reel.set(Number(load.reel.toFixed(2)));
      tension.set(Number(load.tension.toFixed(2)));
      if (time > CATCH_SECONDS) playing = null;
    }
    sound.reel(reel.value());
    sound.tension(tension.value());
    sound.ambience({ near: near.value(), mood, hour: hour.value() });
    if (now - lastReport > 250) {
      lastReport = now;
      const state = inspectPierSound(sound);
      report.textContent = state
        ? `${state.voices} ${state.voices === 1 ? 'sound' : 'sounds'} ringing · ${state.beds.length ? `beds: ${state.beds.join(', ')}` : 'no beds running'} · ${state.parked ? 'output resting' : 'output open'}`
        : 'Nothing has sounded yet.';
    }
  };
  frame = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(frame);
    root.removeEventListener('pointerdown', onFirst);
    root.removeEventListener('keydown', onFirst);
    sound.dispose();
    audio.dispose();
    host.replaceChildren();
  };
}
