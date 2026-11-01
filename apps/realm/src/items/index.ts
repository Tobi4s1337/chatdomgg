import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  EpochMsSchema, ITEM_PLACES, ITEM_SOURCE_KINDS, ItemDefIdSchema, KingdomIdSchema, PersonIdSchema,
  type ItemDefinition, type ItemId, type ItemPlace, type ItemRecord, type ItemSource, type ItemStory,
  type KingdomId, type PersonId,
} from '@chatdom/shared';
import { type ItemCatalogue } from './catalogue';
import type { ItemStore, ItemTransaction } from './store';
export { createItemCatalogue, itemCatalogue, registerItemDefinitions } from './catalogue';
export type { ItemCatalogue } from './catalogue';
export type { ItemStore, ItemTransaction } from './store';

export interface GrantInput {
  readonly key: string;
  readonly ownerId: PersonId;
  readonly kingdomId: KingdomId;
  readonly origin: 'live' | 'simulated';
  readonly defId: ItemDefinition['id'];
  readonly count?: number;
  readonly place?: ItemPlace;
  /** Firsts can be their own protected record even when the species normally stacks. */
  readonly storied?: true;
  readonly story: ItemStory;
  readonly source: ItemSource;
  readonly detail?: Readonly<Record<string, string | number>>;
}
export type SharedGrantInput = Omit<GrantInput, 'ownerId' | 'key' | 'story'> & {
  readonly key: string;
  readonly people: readonly { readonly personId: PersonId; readonly name: string }[];
  readonly story: Omit<ItemStory, 'by'>;
};
export type ItemResult = { readonly ok: true; readonly item: ItemRecord } | { readonly ok: false; readonly message: string };
export interface RealmItems {
  grant(input: GrantInput, tx?: ItemTransaction): Promise<ItemRecord>;
  grantShared(input: SharedGrantInput): Promise<readonly ItemRecord[]>;
  move(ownerId: PersonId, itemId: ItemId, to: { place: ItemPlace; slot: number | null }, revision: number): Promise<ItemResult>;
  release(ownerId: PersonId, itemId: ItemId, count: number, revision: number): Promise<ItemResult>;
  list(ownerId: PersonId, kingdomId: KingdomId, filter?: { readonly place?: ItemPlace }): Promise<readonly ItemRecord[]>;
  get(itemId: ItemId): Promise<ItemRecord | null>;
  history(itemId: ItemId): ReturnType<ItemStore['history']>;
  onChange(listener: (ownerId: PersonId, kingdomId: KingdomId, items: readonly ItemRecord[]) => void): () => void;
  forgetName(personId: PersonId): Promise<void>;
}

const StorySchema = z.strictObject({
  by: z.strictObject({ personId: PersonIdSchema, name: z.string().trim().min(1).max(128) }).nullable(),
  kingdomId: KingdomIdSchema, where: z.string().trim().min(1).max(200), at: EpochMsSchema,
  line: z.string().trim().min(1).max(500), forPersonId: PersonIdSchema.optional(),
});
const GrantSchema = z.strictObject({
  key: z.string().min(1).max(256), ownerId: PersonIdSchema, kingdomId: KingdomIdSchema,
  origin: z.enum(['live', 'simulated']), defId: ItemDefIdSchema,
  count: z.number().int().min(1).max(999).default(1), place: z.enum(ITEM_PLACES).optional(),
  storied: z.literal(true).optional(), story: StorySchema,
  source: z.strictObject({ kind: z.enum(ITEM_SOURCE_KINDS), ref: z.string().min(1).max(256) }),
  detail: z.record(z.string().min(1).max(64), z.union([z.string().max(500), z.number().finite()])).default({}),
});
class ItemRuleError extends Error {}
const refuse = (message: string): never => { throw new ItemRuleError(message); };
const fingerprint = (value: unknown): string => {
  const sorted = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sorted);
    if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, sorted(value)]));
    return value;
  };
  return createHash('sha256').update(JSON.stringify(sorted(value))).digest('hex');
};

/** All writes are kingdom-serialized and include their receipt and history in the same transaction. */
export function createRealmItems(options: { store: ItemStore; catalogue: ItemCatalogue; clock: () => number }): RealmItems {
  const { store, catalogue, clock } = options;
  const listeners = new Set<Parameters<RealmItems['onChange']>[0]>();
  const pending = new WeakMap<ItemTransaction, Map<PersonId, Set<ItemId>>>();
  const now = () => EpochMsSchema.parse(clock());
  const definition = (id: string) => catalogue.get(id) ?? refuse('This thing is not in the kingdom’s catalogue.');
  const notify = (tx: ItemTransaction, item: ItemRecord) => {
    let owners = pending.get(tx);
    if (!owners) {
      owners = new Map(); pending.set(tx, owners);
      const changed = owners;
      tx.afterCommit(() => {
        for (const [ownerId, ids] of changed) {
          void Promise.all([...ids].map(id => store.get(id))).then(records => {
            const items = records.filter((item): item is ItemRecord => item !== null);
            for (const listener of listeners) { try { listener(ownerId, tx.kingdomId, items); } catch { /* Committed changes remain valid if a seat disconnected. */ } }
          }).catch(() => { /* The next items.list recovers a missed notification. */ });
        }
      });
    }
    const ids = owners.get(item.ownerId) ?? new Set<ItemId>();
    ids.add(item.id); owners.set(item.ownerId, ids);
  };
  const slotFor = async (tx: ItemTransaction, ownerId: PersonId, origin: ItemRecord['origin'], place: ItemPlace) => {
    const items = await tx.list(ownerId);
    if (place === 'hand' && items.some(item => item.origin === origin && item.place === 'hand')) refuse('Your hands are full. Put your tool away first.');
    if (place !== 'shelf' && place !== 'hotbar') return null;
    const taken = new Set(items.filter(item => item.origin === origin && item.place === place).map(item => item.slot));
    for (let slot = 0; slot < 64; slot++) if (!taken.has(slot)) return slot;
    return refuse('There is no free place here.');
  };
  const grantIn = async (input: GrantInput, tx: ItemTransaction, sharedNumber?: number): Promise<ItemRecord> => {
    const value = GrantSchema.parse(input);
    if (tx.store !== store || tx.kingdomId !== value.kingdomId) refuse('This transaction belongs to a different kingdom or store.');
    if (value.story.kingdomId !== value.kingdomId) refuse('A story must name the kingdom this thing belongs to.');
    const def = definition(value.defId);
    const place = value.place ?? def.places[0]!;
    const storied = def.stack === null || def.keepsake || value.storied === true;
    if (place === 'spent' || !def.places.includes(place)) refuse('This thing cannot live there.');
    if ((storied && value.count !== 1) || (!storied && value.count > def.stack!)) refuse('This many cannot share one record.');
    // Approved display names may change or be withdrawn; identity and the witnessed fact decide a retry.
    const digest = fingerprint({ ...value, story: { ...value.story, by: value.story.by ? { personId: value.story.by.personId } : null }, place, storied, sharedNumber });
    const receipt = await tx.receipt(value.ownerId, value.origin, value.key);
    if (receipt) {
      if (receipt.fingerprint !== digest) refuse('This grant key has already been used for a different thing.');
      const item = await tx.get(receipt.itemId) ?? refuse('This grant’s item record is missing.');
      // Delivery is at least once. A retry repairs a lost COMMIT acknowledgement and missed push.
      notify(tx, item);
      return item;
    }
    const at = now();
    let item: ItemRecord;
    const stack = !storied && place === 'bag' ? (await tx.list(value.ownerId)).find(item =>
      item.defId === def.id && item.origin === value.origin && !item.storied && item.place === place && item.count + value.count <= def.stack!) : undefined;
    const detail = def.branch === 'gathered' ? {
      ...value.detail, firstCaughtAt: value.story.at, lastCaughtAt: value.story.at,
      firstCaughtWhere: value.story.where, lastCaughtWhere: value.story.where,
    } : value.detail;
    if (stack) {
      const weightG = Math.max(typeof stack.detail.weightG === 'number' ? stack.detail.weightG : 0, typeof value.detail.weightG === 'number' ? value.detail.weightG : 0);
      // The first story stays; aggregate details describe the first, latest and best catch in the stack.
      const incomingIsLatest = value.story.at >= Number(stack.detail.lastCaughtAt ?? stack.story.at);
      const incomingIsFirst = value.story.at < Number(stack.detail.firstCaughtAt ?? stack.story.at);
      item = { ...stack, count: stack.count + value.count, revision: stack.revision + 1, detail: {
        ...stack.detail,
        ...(weightG > 0 ? { weightG } : {}),
        ...(def.branch === 'gathered' && incomingIsLatest ? { lastCaughtAt: value.story.at, lastCaughtWhere: value.story.where } : {}),
        ...(def.branch === 'gathered' && incomingIsFirst ? { firstCaughtAt: value.story.at, firstCaughtWhere: value.story.where } : {}),
      } };
    } else {
      const { forPersonId, ...story } = value.story;
      item = {
        version: 1, id: randomUUID(), defId: def.id, branch: def.branch, ownerId: value.ownerId,
        kingdomId: value.kingdomId, origin: value.origin, place, slot: await slotFor(tx, value.ownerId, value.origin, place),
        count: value.count, storied, number: def.keepsake ? sharedNumber ?? await tx.nextNumber(def.id) : null,
        story: forPersonId === undefined ? story : { ...story, forPersonId }, source: value.source, detail, createdAt: at, revision: 0,
      };
    }
    await tx.save(item);
    await tx.append({ itemId: item.id, kind: stack ? 'stacked' : 'granted', at, to: item.place, count: value.count, actor: 'kingdom', source: value.source });
    await tx.saveReceipt({ key: value.key, ownerId: value.ownerId, origin: value.origin, fingerprint: digest, itemId: item.id });
    notify(tx, item);
    return item;
  };
  const mutate = async (ownerId: PersonId, id: ItemId, revision: number, write: (item: ItemRecord, tx: ItemTransaction) => Promise<ItemRecord>): Promise<ItemResult> => {
    // Do not expose either another person's record or its kingdom through refusal text.
    const current = await store.get(id);
    if (!current || current.ownerId !== ownerId) return { ok: false, message: 'This thing is not yours.' };
    try {
      const item = await store.transaction(current.kingdomId, async tx => {
        const item = await tx.get(id);
        if (!item || item.ownerId !== ownerId) return refuse('This thing is not yours.');
        if (item.revision !== revision) return refuse('This thing has changed. Open your bag again.');
        if (item.place === 'spent') return refuse('This thing has already been let go.');
        return write(item, tx);
      });
      return { ok: true, item: await store.get(item.id) ?? item };
    } catch (error) {
      if (error instanceof ItemRuleError) return { ok: false, message: error.message };
      throw error;
    }
  };
  return {
    async grant(input, tx) {
      const work = async (tx: ItemTransaction) => tx.visible(await grantIn(input, tx));
      return tx ? work(tx) : store.transaction(input.kingdomId, work);
    },
    async grantShared(input) {
      const def = definition(input.defId);
      if (!def.keepsake || input.people.length === 0 || input.people.length > 50_000) refuse('A shared keepsake needs its people and a keepsake definition.');
      const people = [...new Map(input.people.map(person => [person.personId, person])).values()];
      const { people: _people, ...base } = input;
      void _people;
      return store.transaction(input.kingdomId, async tx => {
        const sharedNumber = await tx.sharedNumber(input.key, input.defId, fingerprint({ ...base, people: people.map(person => person.personId).sort() }));
        const items = [];
        for (const person of people) items.push(await tx.visible(await grantIn({ ...base, key: `${input.key}:${person.personId}`, ownerId: person.personId, story: { ...input.story, by: person } }, tx, sharedNumber)));
        return items;
      });
    },
    async move(ownerId, id, to, revision) {
      return mutate(ownerId, id, revision, async (item, tx) => {
        const def = definition(item.defId);
        if (!def.places.includes(to.place) || to.place === 'spent') refuse('This thing cannot live there.');
        const slotted = to.place === 'shelf' || to.place === 'hotbar';
        if (slotted ? !Number.isInteger(to.slot) || to.slot! < 0 || to.slot! > 63 : to.slot !== null) refuse('Choose a valid place for this thing.');
        if (item.place === to.place && item.slot === to.slot) return item;
        if ((await tx.list(ownerId)).some(other => other.id !== id && other.origin === item.origin && other.place === to.place &&
          (slotted ? other.slot === to.slot : to.place === 'hand'))) refuse('Another thing is already there. Choose a free place.');
        const moved = { ...item, place: to.place, slot: to.slot, revision: item.revision + 1 };
        await tx.save(moved);
        await tx.append({ itemId: id, kind: to.place === 'away' ? 'put-away' : 'moved', from: item.place, to: to.place, at: now(), actor: 'owner' });
        notify(tx, moved); return moved;
      });
    },
    async release(ownerId, id, count, revision) {
      return mutate(ownerId, id, revision, async (item, tx) => {
        if (item.storied || item.branch !== 'gathered' || !['bag', 'away'].includes(item.place)) refuse('A thing with a story stays yours. You can put it away.');
        if (!Number.isInteger(count) || count < 1 || count > item.count) refuse('Choose how many to let go from this stack.');
        const remaining = item.count - count;
        const released = { ...item, count: remaining, place: remaining === 0 ? 'spent' as const : item.place, revision: item.revision + 1 };
        await tx.save(released);
        await tx.append({ itemId: id, kind: 'released', from: item.place, to: released.place, count, at: now(), actor: 'owner' });
        notify(tx, released); return released;
      });
    },
    async list(ownerId, kingdomId, filter) { return (await store.list(ownerId, kingdomId)).filter(item => filter?.place ? item.place === filter.place : item.place !== 'spent'); },
    get: id => store.get(id), history: id => store.history(id),
    onChange(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    forgetName: personId => store.forgetName(personId),
  };
}

let composed: RealmItems | undefined;
/** Composition installs one service; other server features receive this instance, never create a second store. */
export function provideRealmItems(items: RealmItems): () => void {
  if (composed) throw new Error('The realm item service is already installed.');
  composed = items; return () => { if (composed === items) composed = undefined; };
}
export function realmItems(): RealmItems {
  if (!composed) throw new Error('The realm item service has not been composed.');
  return composed;
}
