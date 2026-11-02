import '@chatdom/ui/kit.css';
import './ui.css';
import {
  GAUGE, arcPath, containFit, polar, firstInLine, quantize, snapHalf, strained, tagSummary, tagTimeline, tensionColour, tensionWord, tickPath,
  noteDuration, WORLD_TAG_FADE_MS, worldTagLeaving, type TensionWord, type TagPoolEntry,
} from './logic';
import type { CatchTag, FishingBeat, FishingFight, FishingPrompt, FishingUi, FishingUiOptions, WorldTag } from './types';

/** Review-only staging: the bench holds the tag on screen and can skip every animation. */
export interface FishingUiStaging { readonly hold?: boolean; readonly still?: boolean }

const SVG = 'http://www.w3.org/2000/svg';
let mounts = 0;

/* Every string a per-frame call writes is made once, here, so a fight never formats a number. */
const TENSION_VALUES: readonly string[] = Array.from({ length: GAUGE.tensionSteps + 1 }, (_, i) => (i / GAUGE.tensionSteps).toFixed(4));
const TENSION_COLOURS: readonly string[] = Array.from({ length: GAUGE.colourSteps + 1 }, (_, i) => tensionColour(i / GAUGE.colourSteps));
const METER_NOW: readonly string[] = Array.from({ length: 11 }, (_, i) => String(i * 10));

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent?: Element): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (parent) parent.appendChild(node);
  return node;
}

let motionQuery: MediaQueryList | null | undefined;
function reducedMotion(): boolean {
  if (motionQuery === undefined) motionQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  return motionQuery?.matches === true;
}

/* The gauge, drawn once: a brass bezel, a dark inlaid groove with its red limit, the line's colour, engraved ticks and a needle. */
function gaugeMarkup(id: string): string {
  const { cx, cy, radius: r } = GAUGE;
  const left = polar(cx, cy, r, -GAUGE.spanDeg), right = polar(cx, cy, r, GAUGE.spanDeg);
  return `<svg class="pier-gauge-svg" viewBox="0 0 ${GAUGE.width} ${GAUGE.height}" aria-hidden="true" focusable="false">
  <defs><linearGradient id="${id}-needle" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#7c5a2a"/><stop offset=".45" stop-color="#f4dc9d"/><stop offset=".55" stop-color="#c99f5b"/><stop offset="1" stop-color="#5c3f19"/></linearGradient></defs>
  <path class="pier-gauge-bezel" d="${arcPath(r)}"/>
  <path class="pier-gauge-bezel-hi" d="${arcPath(r + 4.7)}"/>
  <path class="pier-gauge-bezel-lo" d="${arcPath(r - 4.6)}"/>
  <path class="pier-gauge-groove" d="${arcPath(r)}"/>
  <path class="pier-gauge-limit" d="${arcPath(r, GAUGE.strainOn, 1)}"/>
  <path class="pier-gauge-line" d="${arcPath(r)}" pathLength="1"/>
  <path class="pier-gauge-ticks" d="${tickPath(16, r + 2.6, r + 5.2)}"/>
  <circle class="pier-gauge-cap" cx="${left.x.toFixed(2)}" cy="${left.y.toFixed(2)}" r="4.2"/><circle class="pier-gauge-pin" cx="${left.x.toFixed(2)}" cy="${left.y.toFixed(2)}" r="1.2"/>
  <circle class="pier-gauge-cap" cx="${right.x.toFixed(2)}" cy="${right.y.toFixed(2)}" r="4.2"/><circle class="pier-gauge-pin" cx="${right.x.toFixed(2)}" cy="${right.y.toFixed(2)}" r="1.2"/>
  <g class="pier-needle"><g class="pier-needle-tug">
    <path class="pier-needle-body" fill="url(#${id}-needle)" d="M${cx} 3.6 L${cx + 2.5} 27.5 L${cx} ${cy - 132} L${cx - 2.5} 27.5 Z"/>
    <circle class="pier-needle-tip" cx="${cx}" cy="8" r="1.25"/>
  </g></g>
</svg>`;
}

/* The Almanac's ink stamp: two rings, a little open book, and its words, pressed with a rough, speckled ink. */
function almanacStamp(id: string): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'pier-stamp');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  let dots = '';
  for (let i = 0; i < 24; i += 1) {
    const a = (i / 24) * Math.PI * 2, x = 50 + Math.sin(a) * 44.4, y = 50 - Math.cos(a) * 44.4;
    dots += `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${i % 2 ? 0.8 : 1.25}"/>`;
  }
  svg.innerHTML = `<defs><filter id="${id}-ink" x="-8%" y="-8%" width="116%" height="116%" color-interpolation-filters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency="1.15" numOctaves="2" seed="11" result="grain"/>
    <feDisplacementMap in="SourceGraphic" in2="grain" scale="1.7" xChannelSelector="R" yChannelSelector="G" result="rough"/>
    <feTurbulence type="fractalNoise" baseFrequency=".09" numOctaves="3" seed="4" result="patch"/>
    <feColorMatrix in="patch" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -3.1 2.35" result="lift"/>
    <feComposite in="rough" in2="lift" operator="in" result="inked"/>
    <feFlood flood-color="#fff4d8" flood-opacity=".55"/><feComposite in2="inked" operator="in"/><feOffset dx=".55" dy=".8" result="emboss"/>
    <feMerge><feMergeNode in="emboss"/><feMergeNode in="inked"/></feMerge>
  </filter></defs>
  <g filter="url(#${id}-ink)" class="pier-stamp-ink">
    <circle cx="50" cy="50" r="47.2" fill="none" stroke-width="2.6"/>
    <circle cx="50" cy="50" r="41.4" fill="none" stroke-width=".9"/>
    <g class="pier-stamp-dots">${dots}</g>
    <path class="pier-stamp-book" fill="none" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" d="M50 34.5c-4-2.6-9.2-3.3-13.6-2.2v-10.4c4.4-1.1 9.6-.4 13.6 2.2 4-2.6 9.2-3.3 13.6-2.2v10.4c-4.4-1.1-9.6-.4-13.6 2.2Zm0-10.4v10.4"/>
    <text class="pier-stamp-small" x="50" y="53.5" text-anchor="middle">New in your</text>
    <text class="pier-stamp-word" x="50" y="69.5" text-anchor="middle">ALMANAC</text>
    <path fill="none" stroke-width="1" stroke-linecap="round" d="M33 76.5h13.5M53.5 76.5H67"/><circle cx="50" cy="76.5" r="1.3"/>
  </g>`;
  return svg;
}

/* A pressed disc of red wax with its rim and a little fish in relief. */
function waxSeal(className: string): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('viewBox', '0 0 40 40');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.innerHTML = `<path class="pier-wax-drip" d="M20 1.9c2.7 0 3.9 1.9 6.3 2.5 2.6.6 4.9-.6 6.8 1.2s.9 4 1.7 6.4c.8 2.4 2.9 3.6 2.9 6.6s-2 4-2.6 6.4c-.6 2.6.6 4.8-1.2 6.6s-4.2 1-6.6 1.8c-2.4.8-3.6 2.8-6.6 2.8s-4.2-2-6.6-2.8c-2.4-.8-4.8 0-6.6-1.8s-.8-4-1.6-6.6C5.2 24.2 2 22.8 2 20s2.4-4.2 3-6.6c.6-2.4-.6-4.8 1.2-6.6 1.8-1.8 4-.8 6.4-1.6C15.2 4.4 17 1.9 20 1.9Z"/>
  <circle class="pier-wax-face" cx="20" cy="20" r="12.6"/>
  <circle class="pier-wax-rim" cx="20" cy="20" r="12.6"/>
  <path class="pier-wax-fish" d="M11.6 20c2.6-3.4 6.1-4.8 9.7-4.1 1.9.4 3.5 1.4 4.8 2.7l2.8-2.4-.5 3.8.5 3.8-2.8-2.4c-1.3 1.3-2.9 2.3-4.8 2.7-3.6.7-7.1-.7-9.7-4.1Z"/>
  <circle class="pier-wax-eye" cx="15.6" cy="19.2" r=".95"/>
  <path class="pier-wax-shine" d="M12.4 9.6c2.4-1.7 5.6-2.4 8.6-1.9"/>`;
  return svg;
}

function sourceSize(source: CanvasImageSource): readonly [number, number] {
  if (typeof HTMLImageElement !== 'undefined' && source instanceof HTMLImageElement) return [source.naturalWidth, source.naturalHeight];
  if (typeof HTMLVideoElement !== 'undefined' && source instanceof HTMLVideoElement) return [source.videoWidth, source.videoHeight];
  if (typeof VideoFrame !== 'undefined' && source instanceof VideoFrame) return [source.displayWidth, source.displayHeight];
  if (typeof SVGImageElement !== 'undefined' && source instanceof SVGImageElement) return [source.width.baseVal.value, source.height.baseVal.value];
  const sized = source as { width?: unknown; height?: unknown };
  return [Number(sized.width) || 0, Number(sized.height) || 0];
}

/** The rectangle of a picture that is not clear, with a hair of margin; null when it cannot be read or is empty. */
function opaqueBounds(source: CanvasImageSource, width: number, height: number): { x: number; y: number; width: number; height: number } | null {
  if (!(width > 0) || !(height > 0) || typeof document === 'undefined') return null;
  const probe = document.createElement('canvas');
  probe.width = width; probe.height = height;
  const ctx = probe.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  let data: Uint8ClampedArray;
  try { ctx.drawImage(source, 0, 0); data = ctx.getImageData(0, 0, width, height).data; } catch { return null; }
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      if (data[row + x * 4 + 3]! < 8) continue;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX || maxY < minY) return null;
  const pad = Math.round(Math.max(maxX - minX, maxY - minY) * .04);
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad); maxX = Math.min(width - 1, maxX + pad); maxY = Math.min(height - 1, maxY + pad);
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** Draws the fish's own render into the tag's print window. Returns false when there is nothing to draw. */
function drawPortrait(canvas: HTMLCanvasElement, source: CanvasImageSource): boolean {
  const [sw, sh] = sourceSize(source);
  // A long fish seen from three-quarters fills a square render only across; the print shows the fish, not the margin.
  const crop = opaqueBounds(source, sw, sh) ?? { x: 0, y: 0, width: sw, height: sh };
  const cssW = canvas.clientWidth, cssH = canvas.clientHeight;
  const dpr = Math.min(2.5, Math.max(1, globalThis.devicePixelRatio || 1));
  const fit = containFit(crop.width, crop.height, cssW, cssH, 10);
  const ctx = fit ? canvas.getContext('2d') : null;
  if (!fit || !ctx) return false;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.shadowColor = 'rgba(28, 22, 44, 0.32)';
  ctx.shadowBlur = 5 * dpr;
  ctx.shadowOffsetY = 2.5 * dpr;
  try { ctx.drawImage(source, crop.x, crop.y, crop.width, crop.height, fit.x, fit.y, fit.width, fit.height); } catch { return false; }
  return true;
}

interface LiveTag {
  readonly root: HTMLElement;
  readonly body: HTMLElement;
  readonly timers: number[];
  state: 'in' | 'out';
}

interface Placed extends TagPoolEntry {
  readonly el: HTMLElement;
  readonly text: HTMLElement;
  textValue: string;
  first: boolean;
  off: boolean;
  x: number;
  y: number;
  readonly tx: CSSUnitValue | null;
  readonly ty: CSSUnitValue | null;
  readonly transform: CSSTransformValue | null;
}

const typedOm = (): boolean => typeof CSSTranslate === 'function' && typeof CSSTransformValue === 'function' && typeof CSS !== 'undefined'
  && typeof CSS.px === 'function' && typeof HTMLElement !== 'undefined' && 'attributeStyleMap' in HTMLElement.prototype;

export function mountFishingUiStaged(host: HTMLElement, options: FishingUiOptions, staging: FishingUiStaging = {}): FishingUi {
  const id = `pier-ui-${(mounts += 1)}`;
  const beat = (value: FishingBeat): void => { try { options.onBeat?.(value); } catch (error) { console.error('A pier sound cue failed.', error); } };
  const restorePosition = getComputedStyle(host).position === 'static';
  if (restorePosition) host.style.position = 'relative';

  const root = el('div', 'pier-ui', host);
  root.dataset.compact = options.compact ? 'true' : 'false';
  if (staging.still) root.dataset.still = 'true';

  const worldLayer = el('div', 'pier-wtags', root);
  worldLayer.setAttribute('aria-hidden', 'true');
  const tagLayer = el('div', 'pier-tags', root);

  const noteNode = el('div', 'pier-note', root);
  noteNode.setAttribute('role', 'status');
  noteNode.setAttribute('aria-live', 'polite');
  noteNode.dataset.shown = 'false';
  const noteMark = el('span', 'pier-note-mark', noteNode);
  noteMark.setAttribute('aria-hidden', 'true');
  const noteText = el('span', 'pier-note-text', noteNode);

  const gauge = el('div', 'pier-gauge', root);
  gauge.dataset.shown = 'false';
  gauge.dataset.phase = 'rest';
  gauge.dataset.tired = 'false';
  gauge.dataset.strain = 'false';
  gauge.setAttribute('role', 'meter');
  gauge.setAttribute('aria-label', 'Line tension');
  gauge.setAttribute('aria-valuemin', '0');
  gauge.setAttribute('aria-valuemax', '100');
  gauge.setAttribute('aria-valuenow', '0');
  gauge.setAttribute('aria-valuetext', 'slack');
  const gaugeBody = el('div', 'pier-gauge-body', gauge);
  gaugeBody.innerHTML = gaugeMarkup(id);
  const progress = el('div', 'pier-progress', gauge);
  progress.setAttribute('aria-hidden', 'true');
  el('i', 'pier-progress-track', progress);
  el('i', 'pier-progress-fill', progress);
  el('i', 'pier-progress-bead', progress);

  const promptNode = el('div', 'pier-prompt', root);
  promptNode.dataset.shown = 'false';
  const promptSlip = el('div', 'pier-prompt-slip cd-slip', promptNode);
  const promptKey = el('span', 'pier-key', promptSlip);
  promptKey.setAttribute('aria-hidden', 'true');
  promptKey.hidden = true;
  const promptLabel = el('span', 'pier-prompt-label', promptSlip);
  promptLabel.setAttribute('aria-live', 'polite');

  const announcer = el('div', 'pier-sr', root);
  announcer.setAttribute('aria-live', 'polite');
  announcer.setAttribute('aria-atomic', 'true');

  let disposed = false;

  /* ---- prompt ---- */
  let promptShown = false, promptText = '', promptKeyText = '', promptUrgent = false, pulsedFor = '';
  function prompt(value: FishingPrompt | null): void {
    if (disposed) return;
    if (!value || !value.label) {
      if (promptShown) { promptShown = false; promptNode.dataset.shown = 'false'; }
      return;
    }
    const key = value.key ?? '', urgent = value.urgent === true;
    const wasShown = promptShown, labelChanged = value.label !== promptText;
    if (wasShown && !labelChanged && key === promptKeyText && urgent === promptUrgent) return;
    if (labelChanged) { promptText = value.label; promptLabel.textContent = value.label; }
    if (key !== promptKeyText) { promptKeyText = key; promptKey.textContent = key; promptKey.hidden = !key.trim(); }
    if (urgent !== promptUrgent) { promptUrgent = urgent; promptNode.dataset.urgent = urgent ? 'true' : 'false'; }
    if (!wasShown) { promptShown = true; promptNode.dataset.shown = 'true'; }
    if (!urgent) pulsedFor = '';
    if (staging.still || reducedMotion() || typeof promptSlip.animate !== 'function') return;
    if (urgent && pulsedFor !== promptText) {
      pulsedFor = promptText;
      promptSlip.animate([
        { transform: 'scale(1)', filter: 'brightness(1)' },
        { transform: 'scale(1.11)', filter: 'brightness(1.12)', offset: 0.28 },
        { transform: 'scale(1)', filter: 'brightness(1)' },
      ], { duration: 260, easing: 'cubic-bezier(.2,.9,.3,1)' });
    } else if (labelChanged && wasShown) {
      promptLabel.animate([{ opacity: 0.2 }, { opacity: 1 }], { duration: 160, easing: 'ease-out' });
    }
  }

  /* ---- fight gauge (per frame: compares integers, writes precomputed strings) ---- */
  let fightShown = false, lastTension = -1, lastColour = -1, lastProgress = -1, lastMeter = -1, strain = false;
  let lastPhase: FishingFight['phase'] = 'rest', lastTired = false, lastWord: TensionWord = 'slack';
  function fight(value: FishingFight | null): void {
    if (disposed) return;
    if (!value) {
      if (fightShown) { fightShown = false; gauge.dataset.shown = 'false'; }
      return;
    }
    if (!fightShown) { fightShown = true; gauge.dataset.shown = 'true'; }
    const t = quantize(value.tension, GAUGE.tensionSteps);
    if (t !== lastTension) {
      lastTension = t;
      gauge.style.setProperty('--pier-tension', TENSION_VALUES[t]!);
      const tension = t / GAUGE.tensionSteps;
      const c = quantize(tension, GAUGE.colourSteps);
      if (c !== lastColour) { lastColour = c; gauge.style.setProperty('--pier-tension-colour', TENSION_COLOURS[c]!); }
      const s = strained(strain, tension);
      if (s !== strain) { strain = s; gauge.dataset.strain = s ? 'true' : 'false'; }
      const m = quantize(tension, 10);
      if (m !== lastMeter) { lastMeter = m; gauge.setAttribute('aria-valuenow', METER_NOW[m]!); }
      const word = tensionWord(tension);
      if (word !== lastWord) { lastWord = word; gauge.setAttribute('aria-valuetext', word); }
    }
    const p = quantize(value.progress, GAUGE.tensionSteps);
    if (p !== lastProgress) { lastProgress = p; gauge.style.setProperty('--pier-progress', TENSION_VALUES[p]!); }
    if (value.phase !== lastPhase) { lastPhase = value.phase; gauge.dataset.phase = value.phase; }
    if (value.tired !== lastTired) { lastTired = value.tired; gauge.dataset.tired = value.tired ? 'true' : 'false'; }
  }

  /* ---- notes ---- */
  let noteTimer = 0;
  function note(message: string, tone: 'plain' | 'warn' = 'plain'): void {
    if (disposed) return;
    const text = message.trim();
    if (!text) return;
    window.clearTimeout(noteTimer);
    noteNode.dataset.tone = tone;
    noteText.textContent = text;
    noteNode.dataset.shown = 'true';
    if (!staging.hold) noteTimer = window.setTimeout(() => { noteNode.dataset.shown = 'false'; }, noteDuration(text));
  }

  /* ---- the catch tag ---- */
  let current: LiveTag | null = null, tagCount = 0;
  const leaving = new Set<LiveTag>();

  function clearTimers(live: LiveTag): void { for (const timer of live.timers) window.clearTimeout(timer); live.timers.length = 0; }
  function later(live: LiveTag, ms: number, run: () => void): void { live.timers.push(window.setTimeout(run, ms)); }

  function slideOut(live: LiveTag, fast: boolean): void {
    if (live.state === 'out') return;
    clearTimers(live);
    live.state = 'out';
    live.root.dataset.state = 'out';
    if (fast) live.root.dataset.fast = 'true';
    if (current === live) { current = null; root.dataset.tagOpen = 'false'; }
    leaving.add(live);
    if (!fast) beat('dismiss');
    const ms = staging.still ? 0 : fast ? 200 : tagTimeline(false, false, reducedMotion()).slideOut;
    later(live, ms + 60, () => { leaving.delete(live); live.root.remove(); });
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape' && current) slideOut(current, false);
  }
  window.addEventListener('keydown', onKey);

  function caught(tag: CatchTag): void {
    if (disposed) return;
    if (current) slideOut(current, true);
    const reduced = reducedMotion(), timeline = tagTimeline(tag.personalFirst, tag.kingdomFirst, reduced);
    const shape = options.compact ? 'lay' : 'hang';

    const wrap = el('div', 'pier-tag');
    wrap.dataset.shape = shape;
    wrap.dataset.rarity = tag.rarity;
    wrap.dataset.state = 'in';
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', `Catch tag: ${tag.name}`);
    const body = el('div', 'pier-tag-body', wrap);
    if (shape === 'hang') el('span', 'pier-tag-string', body).setAttribute('aria-hidden', 'true');
    const card = el('div', 'pier-tag-card', body);

    let portraitSlot: HTMLElement | null = null, canvas: HTMLCanvasElement | null = null;
    if (tag.portrait) {
      portraitSlot = el('div', 'pier-tag-portrait', card);
      portraitSlot.dataset.portrait = 'pending';
      portraitSlot.setAttribute('aria-hidden', 'true');
      canvas = el('canvas', 'pier-tag-canvas', el('div', 'pier-tag-print', portraitSlot));
    }
    const words = el('div', 'pier-tag-words', card);
    if (tag.personalFirst) words.dataset.stamp = 'true';
    if (tag.rarity !== 'common') el('p', 'pier-tag-grade', words).textContent = tag.rarity === 'rare' ? 'Rare' : 'Uncommon';
    el('p', 'pier-tag-name', words).textContent = tag.name;
    const weight = tag.weight.trim(), length = tag.length.trim();
    if (weight || length) {
      const measure = el('p', 'pier-tag-measure', words);
      if (weight) el('span', 'pier-tag-weight', measure).textContent = weight;
      if (weight && length) el('span', 'pier-tag-dot', measure).textContent = ' · ';
      if (length) el('span', 'pier-tag-length', measure).textContent = length;
    }
    el('i', 'pier-tag-rule', words).setAttribute('aria-hidden', 'true');
    if (tag.lore.trim()) el('p', 'pier-tag-lore', words).textContent = tag.lore.trim();

    let first: HTMLElement | null = null;
    if (tag.kingdomFirst) {
      first = el('p', 'pier-tag-first', words);
      first.appendChild(waxSeal('pier-wax'));
      el('span', 'pier-tag-first-words', first).textContent = firstInLine(options.kingdomName);
    }
    let stamp: SVGSVGElement | null = null;
    if (tag.personalFirst) { stamp = almanacStamp(`${id}-${(tagCount += 1)}`); words.appendChild(stamp); }

    el('span', 'pier-tag-eyelet', body).setAttribute('aria-hidden', 'true');
    const knot = document.createElementNS(SVG, 'svg');
    knot.setAttribute('class', 'pier-tag-knot');
    knot.setAttribute('aria-hidden', 'true');
    knot.setAttribute('focusable', 'false');
    if (shape === 'hang') {
      knot.setAttribute('viewBox', '0 0 30 46');
      knot.innerHTML = '<path class="pier-twine-back" d="M17.6 25c.3-4 .1-7.8-2.4-10.6"/><path class="pier-twine" d="M15 44c-1.6-6-2.6-12.4-2-18.4.3-4 1-7.6 2-11.2"/><path class="pier-twine pier-twine-twist" d="M15 44c-1.6-6-2.6-12.4-2-18.4.3-4 1-7.6 2-11.2"/><ellipse class="pier-twine-knot" cx="15" cy="13.6" rx="2.6" ry="2.1"/>';
    } else {
      knot.setAttribute('viewBox', '0 0 36 60');
      knot.innerHTML = '<path class="pier-twine-back" d="M12 25c-3 .3-5.4 0-7.2-1.4"/><path class="pier-twine" d="M29 20c-6-1.2-12.4-1.6-18.4-.6-2.4.4-4.2 1.6-5.8 3.4"/><path class="pier-twine pier-twine-twist" d="M29 20c-6-1.2-12.4-1.6-18.4-.6-2.4.4-4.2 1.6-5.8 3.4"/><path class="pier-twine" d="M4.4 23.6c-2 5.4-3 12-2.2 18.6.4 3.4 1.4 6.4 2.6 9"/><path class="pier-twine" d="M5.2 24.2c1 6 2.8 12.4 3.6 19 .3 2.4.2 4.8-.2 7.2"/><ellipse class="pier-twine-knot" cx="4.8" cy="23.2" rx="2.4" ry="2.6"/>';
    }
    body.appendChild(knot);

    const live: LiveTag = { root: wrap, body, timers: [], state: 'in' };
    wrap.addEventListener('click', () => slideOut(live, false));
    // A press on the tag puts it away; it must never also start a cast underneath.
    wrap.addEventListener('pointerdown', event => event.stopPropagation());
    tagLayer.appendChild(wrap);
    current = live;
    root.dataset.tagOpen = 'true';
    announcer.textContent = tagSummary(tag, options.kingdomName);

    if (tag.portrait && portraitSlot && canvas) {
      const slot = portraitSlot, target = canvas;
      tag.portrait.then(source => {
        if (disposed || !slot.isConnected) return;
        slot.dataset.portrait = source && drawPortrait(target, source) ? 'drawn' : 'none';
      }, () => { if (!disposed && slot.isConnected) slot.dataset.portrait = 'none'; });
    }

    const press = (seal: 'almanac' | 'kingdom'): void => {
      const node = seal === 'almanac' ? stamp : first;
      if (node) node.setAttribute('data-stamped', 'true');
    };
    if (staging.still) {
      for (const s of timeline.stamps) press(s.seal);
      return;
    }
    beat('tag');
    for (const s of timeline.stamps) {
      later(live, s.at, () => press(s.seal));
      later(live, s.impact, () => {
        beat('seal');
        if (!reduced && typeof body.animate === 'function') body.animate([
          { transform: 'translateY(0) scale(1)' }, { transform: 'translateY(2.5px) scale(.992)', offset: 0.3 }, { transform: 'translateY(0) scale(1)' },
        ], { duration: 220, easing: 'cubic-bezier(.3,.7,.3,1)' });
      });
    }
    if (!staging.hold) later(live, timeline.out, () => slideOut(live, false));
  }

  /* ---- world tags (per frame: reuses elements by id, writes only what moved or changed) ---- */
  const placed = new Map<string, Placed>();
  const useTypedOm = typedOm();
  let frame = 0, now = 0;

  function place(entry: Placed, x: number, y: number): void {
    const sx = snapHalf(x), sy = snapHalf(y);
    if (sx === entry.x && sy === entry.y) return;
    entry.x = sx; entry.y = sy;
    if (entry.tx && entry.ty && entry.transform) {
      entry.tx.value = sx; entry.ty.value = sy;
      entry.el.attributeStyleMap.set('transform', entry.transform);
    } else {
      entry.el.style.transform = `translate(${sx}px, ${sy}px)`;
    }
  }

  function create(): Placed {
    const node = el('div', 'pier-wtag', worldLayer);
    const plate = el('div', 'pier-wtag-plate', node);
    el('i', 'pier-wtag-wax', plate);
    const text = el('span', 'pier-wtag-text', plate);
    const tx = useTypedOm ? CSS.px(0) : null, ty = useTypedOm ? CSS.px(0) : null;
    const transform = tx && ty ? new CSSTransformValue([new CSSTranslate(tx, ty)]) : null;
    return { el: node, text, textValue: '', first: false, off: false, x: Number.NaN, y: Number.NaN, tx, ty, transform, seen: frame, visible: true, leavingSince: -1 };
  }

  function sweep(entry: Placed, key: string): void {
    if (worldTagLeaving(entry, frame)) {
      if (entry.leavingSince < 0) { entry.leavingSince = now; entry.el.dataset.leaving = 'true'; }
      else if (now - entry.leavingSince > WORLD_TAG_FADE_MS + 80 || staging.still) { entry.el.remove(); placed.delete(key); }
    } else if (entry.leavingSince >= 0) {
      entry.leavingSince = -1;
      entry.el.dataset.leaving = 'false';
    }
  }

  function worldTags(tags: readonly WorldTag[]): void {
    if (disposed) return;
    frame += 1;
    now = performance.now();
    for (let i = 0; i < tags.length; i += 1) {
      const tag = tags[i]!;
      let entry = placed.get(tag.id);
      if (!entry) {
        if (!tag.visible) continue;
        entry = create();
        placed.set(tag.id, entry);
      }
      entry.seen = frame;
      entry.visible = tag.visible;
      if (tag.text !== entry.textValue) { entry.textValue = tag.text; entry.text.textContent = tag.text; }
      if (tag.first !== entry.first) { entry.first = tag.first; entry.el.dataset.first = tag.first ? 'true' : 'false'; }
      const off = !Number.isFinite(tag.x) || !Number.isFinite(tag.y);
      if (off !== entry.off) { entry.off = off; entry.el.dataset.off = off ? 'true' : 'false'; }
      if (!off) place(entry, tag.x, tag.y);
    }
    placed.forEach(sweep);
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    window.removeEventListener('keydown', onKey);
    window.clearTimeout(noteTimer);
    if (current) clearTimers(current);
    for (const live of leaving) clearTimers(live);
    leaving.clear();
    current = null;
    placed.clear();
    root.remove();
    if (restorePosition) host.style.position = '';
  }

  return { prompt, fight, note, caught, worldTags, dispose };
}
