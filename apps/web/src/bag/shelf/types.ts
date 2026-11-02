import type { ItemEvent, ItemRecord, ShelfPiece, ShelfSettings } from '@chatdom/shared';
import type { BagSound } from '../dom';

/** A plain answer from the kingdom: done, or refused in words a person can read. */
export type ShelfResult = { readonly ok: true } | { readonly ok: false; readonly message: string };

/** Your own shelf: your records (from the bag store) and the shelf's realm requests. */
export interface OwnShelfSource {
  readonly mode: 'own';
  /** All your things in this kingdom, oldest first; the shelf shows `place === 'shelf'`, the drawer `kept` things in the bag. */
  items(): readonly ItemRecord[];
  /** Called after any change to items() or settings(). */
  subscribe(listener: () => void): () => void;
  /** null until the kingdom has answered. */
  settings(): ShelfSettings | null;
  /** Put one of your keepsakes into a shelf slot (0..63). A taken slot swaps the two; the realm decides. */
  arrange(itemId: string, slot: number): Promise<ShelfResult>;
  /** Back into the bag. */
  takeDown(itemId: string): Promise<ShelfResult>;
  /** Show the shelf to visitors at your door, or keep it to yourself. */
  show(shown: boolean): Promise<ShelfResult>;
  history(itemId: string): Promise<readonly ItemEvent[]>;
  readonly personId: string;
}

/** Someone else's shelf, as a visitor at their door sees it. Read-only. */
export interface VisitShelfSource {
  readonly mode: 'visit';
  /** The owner's approved public name; null reads as "a neighbour". */
  readonly name: string | null;
  readonly pieces: readonly ShelfPiece[];
}

export interface ShelfViewOptions {
  readonly compact: boolean;
  readonly sound?: BagSound;
  /** The scene hour the room is lit for (warm evening by default). */
  readonly hour?: number;
  readonly kingdomName?: string;
  /** Open this keepsake's card once the shelf is drawn (an item id on your shelf, or a piece id when visiting). */
  readonly openItemId?: string;
  onClose(): void;
  /** Called once, when the shelf and every keepsake on it have been drawn for the first time (or could not be). */
  onReady?(): void;
}

export type MountShelf = (host: HTMLElement, source: OwnShelfSource | VisitShelfSource, options: ShelfViewOptions) => () => void;
