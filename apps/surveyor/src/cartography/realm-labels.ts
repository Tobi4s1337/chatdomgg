import NAMES from './realm-names-1.json';

/**
 * The words for realms, kept outside frozen geography like the language names. A drawn world (a survey preview or an
 * edition) records each family realm's name as it stood when the land was drawn; the map labels it from this table at
 * reading time, keyed by family id and land kind, so a reviewed rename never changes a world's bytes, its taxonomy hash
 * or anyone's place.
 */
export type LandKind = 'crossroads' | 'wilds' | 'isles' | 'outer';
export interface RealmName { readonly label: string; readonly realmName?: string }
export interface RealmNameTable {
  readonly version: number;
  readonly kind: string;
  readonly id: string;
  readonly review: { readonly status: string; readonly proposedAt: string; readonly reviewedBy: string | null; readonly reviewedAt: string | null };
  /** Family taxonomies whose ids this table names; a world drawn with any other keeps its own recorded words. */
  readonly taxonomies: readonly string[];
  readonly families: Readonly<Record<string, RealmName>>;
  readonly lands: Readonly<Record<LandKind, RealmName>>;
}
export const REALM_NAMES: RealmNameTable = NAMES as RealmNameTable;

/** A family realm's label, or `null` when this table does not name that family in that taxonomy. */
export function familyLabel(taxonomy: string, familyId: string, table: RealmNameTable = REALM_NAMES): string | null {
  if (!table.taxonomies.includes(taxonomy) || !Object.hasOwn(table.families, familyId)) return null;
  return table.families[familyId]!.label;
}

/** The label of a fixed land (the Crossroads, the Wilds, the Isles of Many Tongues, the Outer Isles). */
export function landLabel(kind: LandKind, table: RealmNameTable = REALM_NAMES): string {
  return table.lands[kind].label;
}

/** A drawn realm's label: the table's words where it names the realm, otherwise the words the world recorded. */
export function realmDisplayName(
  realm: { readonly kind: string; readonly family: number; readonly name: string },
  world: { readonly taxonomy?: { readonly id: string }; readonly families?: readonly { readonly id: string }[] },
  table: RealmNameTable = REALM_NAMES,
): string {
  switch (realm.kind) {
    case 'crossroads': case 'wilds': case 'outer': return landLabel(realm.kind, table);
    case 'family': {
      const family = world.families?.[realm.family];
      return (family && world.taxonomy && familyLabel(world.taxonomy.id, family.id, table)) ?? realm.name;
    }
    default: return realm.name;
  }
}
