import type { ItemRecord } from '@chatdom/shared';
import { createKingdomAudio, kingdomAudioHost } from '@chatdom/audio';
import { createBagStore, itemPortrait, mountBag, mountHotbar, type BagSound } from '../bag';
import { createStagedItemLink } from '../bag/staged';
import type { FishingController } from './controller';
import { createPierSound } from './sound';
import { mountFishingUiStaged } from './ui/mount';

/**
 * Everything around the staged pier on the review bench: the overlay, the pier's sound through the kingdom's own
 * audio, the belt and the bag over the same records the staged room grants. The kingdom view wires the same pieces
 * to the realm's item channel.
 */
export function mountPlayHud(hud: HTMLElement, options: { readonly personId: string; readonly kingdomName: string; /** Review stills: the tag and notes stay up. */ readonly hold?: boolean }) {
  const compact = hud.clientWidth < 640;
  const audio = createKingdomAudio();
  const sound = createPierSound(() => kingdomAudioHost(audio));
  const ui = mountFishingUiStaged(hud, { compact, kingdomName: options.kingdomName, onBeat: beat => sound.cue(beat === 'dismiss' ? 'tag' : beat, { intensity: beat === 'dismiss' ? .25 : .5 }) },
    { hold: !!options.hold });
  const items = createStagedItemLink();
  const store = createBagStore(items, { personId: options.personId });
  const surface: BagSound = kind => { audio.cue('wood', { ui: kind }); };
  const abort = new AbortController();
  // Sound starts with the first gesture, never before.
  const unlock = () => { void audio.unlock(); };
  window.addEventListener('pointerdown', unlock, { signal: abort.signal, once: true });
  window.addEventListener('keydown', unlock, { signal: abort.signal, once: true });
  let controller: FishingController | null = null, closeBag: (() => void) | null = null, stopController: (() => void) | null = null;
  const hotbar = mountHotbar(hud, store, { compact, sound: surface, selected: () => controller?.state().rod?.id ?? null,
    onSelect: itemId => controller?.equip(itemId) });
  const bagLayer = document.createElement('div');
  Object.assign(bagLayer.style, { position: 'absolute', inset: '0', pointerEvents: 'auto' });
  const toggleBag = (openItemId?: string) => {
    if (closeBag) { closeBag(); closeBag = null; bagLayer.remove(); return; }
    hud.append(bagLayer);
    closeBag = mountBag(bagLayer, store, { viewerPersonId: options.personId, compact, sound: surface, onClose: () => toggleBag(),
      ...(openItemId ? { openItemId } : {}) });
  };
  window.addEventListener('keydown', event => {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code === 'KeyB' || event.code === 'KeyI') toggleBag();
  }, { signal: abort.signal });
  return {
    ui, sound,
    portrait: (defId: string) => itemPortrait(defId, 192).catch(() => null),
    onGrant: (item: ItemRecord) => { items.grant(item); },
    /** Joins the belt to the person's controller: the rod in hand is the chosen tool. */
    attach(next: FishingController) {
      stopController?.(); controller = next;
      stopController = next.subscribe(event => { if (event.kind === 'state' || event.kind === 'rod' || event.kind === 'taken') hotbar.refresh(); });
      hotbar.refresh();
    },
    bag: toggleBag,
    dispose() {
      abort.abort(); stopController?.(); closeBag?.(); bagLayer.remove(); hotbar.dispose(); ui.dispose(); sound.dispose(); store.dispose(); items.dispose(); audio.dispose();
    },
  };
}
export type PlayHud = ReturnType<typeof mountPlayHud>;
