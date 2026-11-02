import { mountFishingUiStaged } from './mount';
import type { FishingUi, FishingUiOptions } from './types';

export type { CatchTag, FishingBeat, FishingFight, FishingPrompt, FishingUi, FishingUiOptions, WorldTag } from './types';

/**
 * The pier's overlay inside `host` (positioned; the overlay fills it): the hint slip, the fight gauge, notes, your
 * catch tag and the tags over the pier. `onBeat` lets the caller play the paper and stamp sounds in step:
 * 'tag' as the tag starts to slide in, 'seal' at each stamp's impact (once per seal), 'dismiss' as it slides out.
 * Lift the bottom-centre pieces above other furniture with `--pier-ui-dock-bottom` on the host.
 */
export function mountFishingUi(host: HTMLElement, options: FishingUiOptions): FishingUi {
  return mountFishingUiStaged(host, options);
}
