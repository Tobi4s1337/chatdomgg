import { createGestureState, mountGestureSelector } from './index';

const surface = document.querySelector<HTMLElement>('#surface')!;
const result = document.querySelector<HTMLElement>('#result')!;
const state = createGestureState(gesture => { result.textContent = gesture === 'none' ? 'Choose a gesture' : `Local gesture: ${gesture}`; });
mountGestureSelector(surface, { state, available: true });
surface.querySelector<HTMLButtonElement>('.walk-gestures-trigger')!.click();
function frame(now: number) { state.sample(now, false); requestAnimationFrame(frame); }
requestAnimationFrame(frame);
(window as Window & { __chatdomReady?: boolean }).__chatdomReady = true;
