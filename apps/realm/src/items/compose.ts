import './providers';
import { createRealmItems, itemCatalogue, provideRealmItems } from './index';
import { createPostgresItemStore } from './postgres';
import type { RealmDatabase } from '../persistence/database';

/** The process has one durable item authority. Memory is available only to explicit unit tests. */
export function composeRealmItems(pool: RealmDatabase) {
  const store = createPostgresItemStore({ pool });
  const items = createRealmItems({ store, catalogue: itemCatalogue, clock: Date.now });
  const dispose = provideRealmItems(items);
  return { items, store, dispose };
}
