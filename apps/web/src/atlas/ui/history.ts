import type { CameraState } from '../map/motion';

/** The slice of `window.history` the card history needs (and tests can stand in for). */
export interface HistoryLike {
  readonly state: unknown;
  pushState(data: unknown, unused: string, url?: string): void;
  replaceState(data: unknown, unused: string, url?: string): void;
  back(): void;
}

export interface CardEntry { chatdomAtlas: 'card'; id: string; view: CameraState }

const isCardEntry = (state: unknown): state is CardEntry =>
  typeof state === 'object' && state !== null && (state as { chatdomAtlas?: unknown }).chatdomAtlas === 'card';

/**
 * Back means "the view before this card" (Spec 01 R9). Opening a card pushes one history entry that remembers the
 * camera from before the map moved to show it; choosing another holding replaces that entry and keeps the original
 * view. Back closes the card and returns the camera there. Closing the card any other way (its button, Escape, a tap
 * on bare paper) steps back over its entry quietly, so the next Back leaves the map as the reader expects.
 *
 * The entry carries the card's route (`/map/<login>`, `/map/road/<a>/<b>`) when it has one, so the address bar names
 * what is open, a reload reopens it, and Forward after Back brings it back. A card without a route (a holding whose
 * name has lapsed, an unnamed pencil flag) keeps the map's own address.
 */
export class CardHistory {
  private open: CardEntry | null = null;
  private quiet = 0;

  constructor(private readonly history: HistoryLike, private readonly onBack: (view: CameraState) => void) {}

  get isOpen(): boolean {
    return this.open !== null;
  }

  /** A card opened, with the route it should show (default: the map's own `/map`). */
  opened(id: string, view: CameraState, url = '/map'): void {
    if (this.open && isCardEntry(this.history.state)) {
      this.open = { ...this.open, id };
      this.history.replaceState(this.open, '', url);
      return;
    }
    this.open = { chatdomAtlas: 'card', id, view };
    this.history.pushState(this.open, '', url);
  }

  /**
   * The page was opened on a card's route without a card entry (a shared link, a typed address): the map itself
   * becomes the entry below it, so closing the card or Back lands on `/map` rather than leaving the Atlas.
   */
  arrived(): void {
    if (!isCardEntry(this.history.state)) this.history.replaceState(null, '', '/map');
  }

  /**
   * Call once the page listens for `popstate`. A reload on a card's entry finds no card open (its selection went with
   * the page): adopt the entry and return it, so the page reopens that card from its route. If the page cannot reopen
   * it, `closed()` steps back over the entry quietly, so the reader's first Back is never a dead press.
   */
  resume(): CardEntry | null {
    return this.adopt();
  }

  /** After a `popstate` that was not the card's: Forward onto a card's entry adopts it for the page to reopen. */
  adopt(): CardEntry | null {
    if (this.open || !isCardEntry(this.history.state)) return null;
    this.open = this.history.state;
    return this.open;
  }

  /** The card was closed on the page (not by Back). */
  closed(): void {
    if (!this.open) return;
    this.open = null;
    if (isCardEntry(this.history.state)) {
      this.quiet++;
      this.history.back();
    }
  }

  /** Call from `popstate`. Returns true when the event was the card's own and has been handled. */
  popped(): boolean {
    if (this.quiet > 0) {
      this.quiet--;
      return true;
    }
    if (!this.open) return false;
    const view = this.open.view;
    this.open = null;
    this.onBack(view);
    return true;
  }
}
