import { z } from 'zod';
import { ITEM_BRANCHES, ITEM_PLACES, ItemDefIdSchema, type ItemDefinition } from '@chatdom/shared';

const DefinitionSchema = z.strictObject({
  id: ItemDefIdSchema,
  branch: z.enum(ITEM_BRANCHES),
  title: z.string().trim().min(1).max(100),
  lore: z.string().trim().min(1).max(500),
  stack: z.number().int().min(2).max(999).nullable(),
  keepsake: z.boolean(),
  model: z.string().min(1).max(128),
  places: z.array(z.enum(ITEM_PLACES)).min(1).max(8),
}).superRefine((definition, ctx) => {
  if (definition.keepsake && (definition.stack !== null || definition.branch !== 'kept')) {
    ctx.addIssue({ code: 'custom', message: 'A keepsake is one storied kept thing.' });
  }
  if (!definition.places.includes('away') || new Set(definition.places).size !== definition.places.length) {
    ctx.addIssue({ code: 'custom', message: 'Every thing can be put away; places must be unique.' });
  }
  if (definition.places.includes('spent') && definition.stack === null) {
    ctx.addIssue({ code: 'custom', message: 'A storied thing cannot be spent.' });
  }
});

export interface ItemCatalogue { get(id: string): ItemDefinition | undefined }

export function createItemCatalogue(definitions: readonly ItemDefinition[] = []) {
  const entries = new Map<string, ItemDefinition>();
  const register = (definitions: readonly ItemDefinition[]): (() => void) => {
    const parsed = definitions.map(definition => DefinitionSchema.parse(definition));
    const ids = new Set<string>();
    for (const definition of parsed) {
      if (entries.has(definition.id) || ids.has(definition.id)) throw new Error('This item definition is already registered.');
      ids.add(definition.id);
    }
    for (const definition of parsed) {
      Object.freeze(definition.places); Object.freeze(definition);
      entries.set(definition.id, definition);
    }
    return () => { for (const definition of parsed) if (entries.get(definition.id) === definition) entries.delete(definition.id); };
  };
  register(definitions);
  return { get: (id: string) => entries.get(id), register };
}

export const itemCatalogue = createItemCatalogue();
export const registerItemDefinitions = itemCatalogue.register;
