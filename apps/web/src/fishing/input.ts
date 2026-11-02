import type { FishingController } from './controller';

export interface FishingInputOptions {
  /** True while this person's rod is out and the walk view owns the input (cursor locked, no menu open). */
  armed(): boolean;
  /** True while the walker stands by the rack without a rod. */
  nearRack(): boolean;
  /** Where the touch cast button goes; null on a desktop without touch. */
  readonly hud: HTMLElement | null;
  readonly signal: AbortSignal;
}

const editable = (target: EventTarget | null) => target instanceof HTMLElement
  && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

/**
 * The primary button (and a touch button) while the rod is out. It takes the button only then, never takes pointer
 * lock or moves the camera, and lets go of every press it began.
 */
export function bindFishingInput(target: HTMLElement, controller: FishingController, options: FishingInputOptions) {
  let held: number | null = null;
  const signal = options.signal;
  const down = (event: PointerEvent) => {
    if (!event.isPrimary || event.button !== 0 || event.pointerType === 'touch' || !options.armed()) return;
    held = event.pointerId; controller.press();
  };
  const up = (event: PointerEvent) => {
    if (held === null || event.pointerId !== held) return;
    held = null; controller.release();
  };
  const cancel = () => { if (held !== null) { held = null; controller.release(); } };
  const menu = (event: MouseEvent) => { if (options.armed() && controller.state().cast) { event.preventDefault(); controller.cancel(); } };
  const key = (event: KeyboardEvent) => {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || editable(event.target)) return;
    if (event.code === 'KeyE' && !controller.state().rod && options.nearRack()) { controller.take(); return; }
    if (event.code === 'KeyQ' && controller.state().cast) controller.cancel();
  };
  target.addEventListener('pointerdown', down, { signal });
  window.addEventListener('pointerup', up, { signal });
  window.addEventListener('pointercancel', up, { signal });
  window.addEventListener('blur', cancel, { signal });
  target.addEventListener('contextmenu', menu, { signal });
  window.addEventListener('keydown', key, { signal });

  // Touch: one round brass button above the right thumb, shown only while it has something to do.
  let button: HTMLButtonElement | null = null;
  if (options.hud && matchMedia('(pointer: coarse)').matches) {
    button = document.createElement('button');
    button.type = 'button'; button.className = 'pier-cast-button'; button.hidden = true;
    Object.assign(button.style, {
      position: 'absolute', right: 'calc(18px + env(safe-area-inset-right))', bottom: 'calc(168px + env(safe-area-inset-bottom))',
      width: '68px', height: '68px', borderRadius: '50%', border: '2px solid #7c5a2a', touchAction: 'none',
      background: 'radial-gradient(circle at 35% 30%, #f4dc9d, #c99f5b 45%, #7c5a2a 100%)',
      boxShadow: '0 3px 0 #3d2718, 0 6px 14px rgba(0,0,0,.35)', color: '#38261a',
      font: "13px/1.1 'IM Fell English SC', Georgia, serif", letterSpacing: '.06em', pointerEvents: 'auto',
    } satisfies Partial<CSSStyleDeclaration>);
    let touch: number | null = null;
    button.addEventListener('pointerdown', event => {
      event.preventDefault(); button!.setPointerCapture(event.pointerId); touch = event.pointerId;
      if (!controller.state().rod && options.nearRack()) { controller.take(); touch = null; return; }
      controller.press();
    }, { signal });
    const lift = (event: PointerEvent) => { if (touch === event.pointerId) { touch = null; controller.release(); } };
    button.addEventListener('pointerup', lift, { signal }); button.addEventListener('pointercancel', lift, { signal });
    options.hud.append(button);
  }
  return {
    /** Keep the touch button's word in step with the moment; called a few times a second. */
    refresh() {
      if (!button) return;
      const state = controller.state(), cast = state.cast;
      const word = !state.rod ? (options.nearRack() ? 'Take' : '') : !cast ? (options.armed() ? 'Cast' : '')
        : cast.phase === 'bite' ? 'Strike' : cast.phase === 'fighting' ? 'Reel' : cast.phase === 'drawing' ? 'Cast' : '';
      button.hidden = !word;
      if (button.textContent !== word) button.textContent = word;
    },
    dispose() { cancel(); button?.remove(); },
  };
}
