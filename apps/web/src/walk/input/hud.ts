/**
 * The little the walker needs to see: whether mouse look is on (and how to get the cursor back), and on a phone
 * where the thumbs go. It is drawn over the world in the integrator's container, takes no pointer events except
 * the jump button, and is hidden whenever another owner has the camera.
 */
import type { LookMode } from './look';
import { TOUCH, type TouchStick } from './touch';
import './hud.css';

export interface WalkHudState {
  /** Hidden entirely while a menu, build, Forge or the director owns the camera. */
  readonly visible: boolean;
  readonly look: LookMode;
  /** Show the phone controls: the device's primary pointer is coarse, or the surface has been touched. */
  readonly touch: boolean;
  readonly stick: TouchStick | null;
  /** Surface size in CSS px, for the resting stick. */
  readonly width: number;
  readonly height: number;
}

export interface WalkHud {
  update(state: WalkHudState): void;
  dispose(): void;
}

const LOOK_TEXT: Record<LookMode, { key: string; title: string; note: string }> = {
  free: { key: 'V', title: 'Mouse look', note: '' },
  requesting: { key: 'V', title: 'Mouse look', note: 'Taking the cursor…' },
  locked: { key: 'Esc', title: 'Free the cursor', note: '' },
  fallback: { key: 'V', title: 'Mouse look is unavailable here', note: 'Drag to look · V tries again' },
};

/** Where the stick rests before a thumb lands: lower left, clear of the edges and of a short landscape screen. */
export function restingStick(width: number, height: number): { x: number; y: number } {
  const margin = TOUCH.radius + TOUCH.edge;
  return { x: Math.max(margin, Math.min(width * .2, width / 2)), y: height * thumbLine(height) };
}

/** Both thumbs rest on one line: two thirds down a phone, a little higher on a short landscape screen. */
const thumbLine = (height: number) => height < 500 ? .54 : .66;

export interface ThumbSlot { readonly x: number; readonly y: number; readonly radius: number }

/**
 * The phone's thumb map in surface CSS px, the one place the walking controls and the interaction owner's
 * touch action agree on. The left thumb owns the stick region; the right thumb has Jump on the thumb line and
 * the interaction's action (E on a keyboard) directly above it, a comfortable reach up rather than across.
 * Both buttons sit right of the stick region, so a thumb walking never lands on either.
 */
export const THUMB = {
  /** Jump's distance from the right edge to its centre, and its radius (64 px button). */
  jumpInset: 54,
  jumpRadius: 32,
  /** The action control's radius (at least the 44 px minimum touch target) and its gap above Jump. */
  actionRadius: 30,
  actionGap: 26,
} as const;

export function thumbSlots(width: number, height: number): { readonly stick: ThumbSlot; readonly jump: ThumbSlot; readonly action: ThumbSlot } {
  const rest = restingStick(width, height);
  const jump = { x: width - THUMB.jumpInset, y: height * thumbLine(height), radius: THUMB.jumpRadius };
  const action = { x: jump.x, y: jump.y - THUMB.jumpRadius - THUMB.actionGap - THUMB.actionRadius, radius: THUMB.actionRadius };
  return { stick: { ...rest, radius: TOUCH.radius }, jump, action };
}

export function createWalkHud(container: HTMLElement, onJump: () => void): WalkHud {
  const doc = container.ownerDocument;
  const root = doc.createElement('div');
  root.className = 'walk-hud';
  root.hidden = true;
  root.innerHTML = `
    <div class="walk-look" role="status" aria-live="polite">
      <span class="walk-look-pip" aria-hidden="true"></span>
      <kbd class="walk-look-key"></kbd>
      <span class="walk-look-text"><b></b><small></small></span>
    </div>
    <div class="walk-stick is-idle" aria-hidden="true">
      <div class="walk-stick-ring"></div>
      <svg class="walk-stick-glyph" viewBox="-52 -52 104 104"><path d="M-6 -33l6-6 6 6M-6 33l6 6 6-6M-33 -6l-6 6 6 6M33 -6l6 6-6 6"/></svg>
      <div class="walk-stick-knob"></div>
      <div class="walk-stick-label">Move</div>
    </div>
    <button class="walk-jump" type="button" aria-label="Jump">
      <svg viewBox="0 0 28 28" aria-hidden="true"><path d="M7 16l7-7 7 7M9 22h10"/></svg>
      <span aria-hidden="true">Jump</span>
    </button>`;
  container.append(root);
  const look = root.querySelector<HTMLElement>('.walk-look')!;
  const key = root.querySelector<HTMLElement>('.walk-look-key')!;
  const title = root.querySelector<HTMLElement>('.walk-look-text b')!;
  const note = root.querySelector<HTMLElement>('.walk-look-text small')!;
  const stick = root.querySelector<HTMLElement>('.walk-stick')!;
  const knob = root.querySelector<HTMLElement>('.walk-stick-knob')!;
  const jump = root.querySelector<HTMLButtonElement>('.walk-jump')!;
  let shownLook: LookMode | null = null, fresh: ReturnType<typeof setTimeout> | undefined, pressed: ReturnType<typeof setTimeout> | undefined;
  let taught = false;

  const learn = () => { if (!taught) { taught = true; root.classList.add('is-taught'); } };
  const press = () => {
    learn();
    onJump();
    jump.classList.add('is-pressed');
    clearTimeout(pressed);
    pressed = setTimeout(() => jump.classList.remove('is-pressed'), 140);
  };
  // A thumb jumps on touch-down, not on lift; the button never takes focus from the world.
  const pointerdown = (event: PointerEvent) => { event.preventDefault(); event.stopPropagation(); press(); };
  // Keyboard activation (Enter/Space on a focused button) reports detail 0; a tap's own click is ignored.
  const click = (event: MouseEvent) => { event.stopPropagation(); if (event.detail === 0) press(); };
  jump.addEventListener('pointerdown', pointerdown);
  jump.addEventListener('click', click);
  jump.addEventListener('contextmenu', event => event.preventDefault());

  return {
    update(state) {
      root.hidden = !state.visible;
      root.classList.toggle('is-touch', state.touch);
      if (state.look !== shownLook) {
        const text = LOOK_TEXT[state.look];
        key.textContent = text.key; title.textContent = text.title; note.textContent = text.note;
        look.classList.toggle('is-locked', state.look === 'locked');
        look.classList.toggle('is-fallback', state.look === 'fallback');
        if (shownLook !== null) {
          look.classList.add('is-fresh');
          clearTimeout(fresh);
          fresh = setTimeout(() => look.classList.remove('is-fresh'), 2400);
        }
        shownLook = state.look;
      }
      jump.style.top = `${thumbSlots(state.width, state.height).jump.y.toFixed(1)}px`;
      const active = state.stick;
      if (active) learn();
      const at = active ?? restingStick(state.width, state.height);
      stick.style.transform = `translate(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px)`;
      knob.style.transform = active ? `translate(${active.knobX.toFixed(1)}px, ${active.knobY.toFixed(1)}px)` : '';
      stick.classList.toggle('is-active', !!active);
      stick.classList.toggle('is-idle', !active);
      stick.classList.toggle('is-sprint', !!active?.sprint);
    },
    dispose() {
      clearTimeout(fresh); clearTimeout(pressed);
      jump.removeEventListener('pointerdown', pointerdown);
      jump.removeEventListener('click', click);
      root.remove();
    },
  };
}
