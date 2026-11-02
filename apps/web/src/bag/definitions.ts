import { ITEM_BRANCHES, ITEM_PLACES, ItemDefIdSchema, type ItemDefinition } from '@chatdom/shared';

interface Entry { readonly definition: ItemDefinition; refs: number }

const entries = new Map<string, Entry>();

const same = (a: ItemDefinition, b: ItemDefinition) => a.id === b.id && a.branch === b.branch && a.title === b.title
  && a.lore === b.lore && a.stack === b.stack && a.keepsake === b.keepsake && a.model === b.model
  && a.places.length === b.places.length && a.places.every((place, index) => b.places[index] === place);

function checked(definition: ItemDefinition): ItemDefinition {
  const valid = !!definition && ItemDefIdSchema.safeParse(definition.id).success
    && (ITEM_BRANCHES as readonly string[]).includes(definition.branch)
    && typeof definition.title === 'string' && definition.title.trim().length > 0
    && typeof definition.lore === 'string' && definition.lore.trim().length > 0
    && (definition.stack === null || Number.isInteger(definition.stack) && definition.stack > 0)
    && typeof definition.keepsake === 'boolean' && typeof definition.model === 'string' && definition.model.length > 0
    && Array.isArray(definition.places) && definition.places.length > 0
    && definition.places.every(place => (ITEM_PLACES as readonly string[]).includes(place));
  if (!valid) throw new Error('An item definition needs an id, a title, a line of lore, a model and its places.');
  return Object.freeze({ ...definition, places: Object.freeze([...definition.places]) });
}

/**
 * Teaches the client what each kind of thing is called and how it is drawn. A batch that conflicts with itself or with
 * an already registered definition registers nothing and throws. Registering an identical definition twice is shared:
 * it stays until both registrations are released.
 */
export function registerItemDefinitions(definitions: readonly ItemDefinition[]): () => void {
  const batch = new Map<string, ItemDefinition>();
  for (const raw of definitions) {
    const definition = checked(raw);
    const twin = batch.get(definition.id);
    if (twin && !same(twin, definition)) throw new Error('This batch describes one thing in two different ways.');
    const existing = entries.get(definition.id);
    if (existing && !same(existing.definition, definition)) throw new Error('Another definition already uses this item id.');
    batch.set(definition.id, definition);
  }
  const held: Entry[] = [];
  for (const definition of batch.values()) {
    const existing = entries.get(definition.id);
    if (existing) { existing.refs++; held.push(existing); continue; }
    const entry = { definition, refs: 1 };
    entries.set(definition.id, entry); held.push(entry);
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const entry of held) {
      entry.refs--;
      if (entry.refs <= 0 && entries.get(entry.definition.id) === entry) entries.delete(entry.definition.id);
    }
  };
}

export function itemDefinition(id: string): ItemDefinition | undefined {
  return entries.get(id)?.definition;
}

/** Every registered definition, in registration order. */
export function itemDefinitions(): readonly ItemDefinition[] {
  return [...entries.values()].map(entry => entry.definition);
}
