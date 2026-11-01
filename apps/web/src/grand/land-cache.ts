/// <reference lib="webworker" />
import type { GrandLand, GrandLandSeed } from '../../../../packages/world/src/grand/types';

/**
 * Raised lands kept between visits (spec 56: reuse content across visits). The key carries the worker
 * bundle's content-hashed URL, so a changed generator or kit is a new key, never a stale land. Development
 * builds have no such hash and skip the cache. Only the newest few lands are kept.
 */
const DB = 'chatdom-grand-lands', STORE = 'lands', KEEP = 6;

export function landCacheKey(seed: GrandLandSeed, bundle: string): string {
  return [bundle, seed.seedKey, seed.kingdomId, seed.tier, seed.biome, seed.character].join('|');
}

function open(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise(resolve => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => { request.result.createObjectStore(STORE); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

export async function readLand(key: string): Promise<GrandLand | null> {
  const db = await open();
  if (!db) return null;
  return new Promise(resolve => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
    request.onsuccess = () => { db.close(); resolve((request.result as { land?: GrandLand } | undefined)?.land ?? null); };
    request.onerror = () => { db.close(); resolve(null); };
  });
}

export async function writeLand(key: string, land: GrandLand, now: number): Promise<void> {
  const db = await open();
  if (!db) return;
  await new Promise<void>(resolve => {
    const tx = db.transaction(STORE, 'readwrite'), store = tx.objectStore(STORE);
    store.put({ land, at: now }, key);
    const all = store.getAll(), keys = store.getAllKeys();
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = tx.onabort = () => { db.close(); resolve(); };
    keys.onsuccess = () => {
      all.onsuccess = null;
      const entries = (keys.result as string[]).map((k, i) => ({ k, at: ((all.result[i] as { at?: number } | undefined)?.at) ?? 0 }));
      entries.sort((a, b) => b.at - a.at);
      for (const old of entries.slice(KEEP)) store.delete(old.k);
    };
  });
}
