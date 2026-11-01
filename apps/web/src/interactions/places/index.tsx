import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import type { RealmForgeFeed } from '../../realm/adapters/forge-feed';
import { AnvilVisit } from './AnvilVisit';
import { watchAnvil, type AnvilHome } from './anvil-state';
import { anvilShot } from './framing';
import { framed, type PlaceOpener, type PlaceStage } from './openers';
import './places.css';

/*
 * The places an accepted interaction opens (spec 37 R9/R10): the seated framing at a log, a table's own view at a
 * chair (./openers.ts) and the hero anvil's visit here. Each runs only after the room said yes.
 */

export interface AnvilPlaceOptions {
  /** The kingdom root, above the canvas (the prompt's host). */
  readonly host: HTMLElement;
  /** The kingdom's actual Forge feed (`createRealmForgeFeed`, bound by entry). */
  readonly feed: Pick<RealmForgeFeed, 'subscribe'>;
  /** The room's private `home.owned` answer: owned, none, or not heard yet. */
  readonly home: () => AnvilHome;
  readonly coarse?: boolean;
  readonly clock?: () => number;
}

/**
 * The hero anvil: the camera settles three-quarters on the anvil and the visit card opens beside it with the Forge's
 * actual state. Closing it (Escape, gamepad East, the card's button, a first step) only closes the presentation:
 * a wish already in the fire carries on and lands without anyone watching here.
 */
export function createAnvilPlace(stage: PlaceStage, options: AnvilPlaceOptions): PlaceOpener {
  return (record, closed) => {
    const ease = framed(stage, anvilShot(record, stage.camera.aspect, stage.feet?.()));
    const watch = watchAnvil(options.feed, options.clock);
    const [state, setState] = createSignal(watch.state());
    const [home, setHome] = createSignal(options.home());
    const stop = watch.subscribe(setState);
    const layer = document.createElement('div');
    layer.className = 'ix-anvil-layer';
    options.host.append(layer);
    const coarse = options.coarse ?? matchMedia('(pointer: coarse)').matches;
    let open = true;
    const close = () => {
      if (!open) return;
      open = false;
      stop(); watch.dispose(); unmount(); layer.remove();
    };
    // The card's own way back closes the card first, then tells the controller, which hands the camera back.
    const unmount = render(() => <AnvilVisit state={state} home={home} coarse={coarse} onLeave={() => { close(); closed(); }} />, layer);
    return {
      frame(now) { ease?.frame(now); const next = options.home(); if (next !== home()) setHome(next); },
      close,
    };
  };
}

export { composeInteractionPlaces, createSeatPlace, createTablePlace, type HomeInteriorPort, type PlaceOpener, type PlaceStage, type TableViewPort } from './openers';
export { ANVIL_WAITING, LANDED_MS, anvilHomeLine, anvilLine, watchAnvil, type AnvilHome, type AnvilState, type AnvilWatch } from './anvil-state';
export { AnvilVisit, FORGE_EXAMPLE } from './AnvilVisit';
export { FRAMING_MS, anvilShot, clearShot, createShotEase, seatShot, type FramedCamera, type PlaceShot } from './framing';
