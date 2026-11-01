import type { ItemDefinition, ItemEvent, ItemId, ItemRecord, KingdomId, PersonId } from '@chatdom/shared';

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
}

export interface ItemStore {
  /** Serializes writes to this kingdom; callbacks and number allocation roll back together. */
  transaction<T>(kingdomId: KingdomId, work: (tx: ItemTransaction) => Promise<T>): Promise<T>;
  get(id: ItemId): Promise<ItemRecord | null>;
  list(ownerId: PersonId, kingdomId: KingdomId): Promise<readonly ItemRecord[]>;
  history(id: ItemId): Promise<readonly ItemEvent[]>;
  /** Redaction is applied at read time, including to future grants; provenance stays intact. */
  forgetName(personId: PersonId): Promise<void>;
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
