import type { ItemDefinition, ItemEvent, ItemId, ItemRecord, KingdomId, PersonId } from '@chatdom/shared';

/** One person's shelf in one kingdom and origin (PI12). `name` is the approved name given when it was shown. */
export interface ShelfRow {
  readonly ownerId: PersonId;
  readonly origin: ItemRecord['origin'];
  readonly shown: boolean;
  readonly name: string | null;
  readonly revision: number;
  readonly updatedAt: number;
}

export interface GrantReceipt {
  readonly key: string;
  readonly ownerId: PersonId;
  readonly origin: ItemRecord['origin'];
  readonly fingerprint: string;
  readonly itemId: ItemId;
}

/** One kingdom's atomic unit of work. Never send this capability to a browser. */
export interface ItemTransaction {
  readonly store: ItemStore;
  readonly kingdomId: KingdomId;
  get(id: ItemId): Promise<ItemRecord | null>;
  list(ownerId: PersonId): Promise<readonly ItemRecord[]>;
  /** Raw placement records, bounded to one hand or 64 slots; corrupt overflow is refused. */
  atPlace(ownerId: PersonId, origin: ItemRecord['origin'], place: 'hand' | 'hotbar' | 'shelf'): Promise<readonly ItemRecord[]>;
  /** Redacted reply only. Saves and replay always use raw provenance from get/list. */
  visible(item: ItemRecord): Promise<ItemRecord>;
  save(item: ItemRecord): Promise<void>;
  append(event: ItemEvent): Promise<void>;
  receipt(ownerId: PersonId, origin: ItemRecord['origin'], key: string): Promise<GrantReceipt | null>;
  saveReceipt(receipt: GrantReceipt): Promise<void>;
  nextNumber(defId: ItemDefinition['id']): Promise<number>;
  /** One dated moment has one number, shared by every recipient even on later retries. */
  sharedNumber(key: string, defId: ItemDefinition['id'], fingerprint: string): Promise<number>;
  /** Called only after a confirmed commit. Rollback and uncertain commits never notify. */
  afterCommit(callback: () => void): void;
  /** A swap of two slotted things checks slot uniqueness at commit, not between the two saves. */
  deferSlots(): Promise<void>;
  shelf(ownerId: PersonId, origin: ItemRecord['origin']): Promise<ShelfRow | null>;
  /** Revision-checked: a new row starts at revision 1, every change adds one. */
  saveShelf(row: ShelfRow): Promise<void>;
}

export interface ItemStore {
  /** Serializes writes to this kingdom; callbacks and number allocation roll back together. */
  transaction<T>(kingdomId: KingdomId, work: (tx: ItemTransaction) => Promise<T>): Promise<T>;
  get(id: ItemId): Promise<ItemRecord | null>;
  list(ownerId: PersonId, kingdomId: KingdomId): Promise<readonly ItemRecord[]>;
  /** Redacted placement records, bounded to one hand or 64 slots; corrupt overflow is refused. */
  atPlace(ownerId: PersonId, kingdomId: KingdomId, origin: ItemRecord['origin'], place: 'hand' | 'hotbar' | 'shelf'): Promise<readonly ItemRecord[]>;
  history(id: ItemId): Promise<readonly ItemEvent[]>;
  /** Keyset reads, at most 33 rows including one lookahead. Private browser reads never load whole collections. */
  listPage(ownerId: PersonId, kingdomId: KingdomId, origin: ItemRecord['origin'], after?: string): Promise<readonly ItemRecord[]>;
  historyPage(id: ItemId, after?: string): Promise<readonly { readonly cursor: string; readonly value: ItemEvent }[]>;
  /** Redaction is applied at read time, including to future grants; provenance stays intact. */
  forgetName(personId: PersonId): Promise<void>;
  shelf(ownerId: PersonId, kingdomId: KingdomId, origin: ItemRecord['origin']): Promise<ShelfRow | null>;
  /** Shelves their owners show, at most 512, with the shown name withheld for a forgotten name. */
  shownShelves(kingdomId: KingdomId, origin: ItemRecord['origin']): Promise<readonly ShelfRow[]>;
}

/** A commit may have reached Postgres. Resolve by repeating the same grant key, never by minting another. */
export class ItemCommitUncertainError extends Error {
  constructor() { super('The item commit could not be confirmed. Retry with the same key.'); this.name = 'ItemCommitUncertainError'; }
}

/** Name withdrawal hides attribution, without transferring ownership or rewriting history. */
export function redactItem(item: ItemRecord, hidden: ReadonlySet<string>): ItemRecord {
  return item.story.by && hidden.has(item.story.by.personId)
    ? { ...item, story: { ...item.story, by: { ...item.story.by, name: 'a citizen' } } }
    : item;
}
