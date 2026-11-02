import type { RealmFoundedManifest } from '@chatdom/shared/realm';
import { BAKED_BINDING_BYTES } from './baked-client-binding';
import { readBounded } from './baked-client-transport';

/**
 * Whether the realm serves a published land for this exact founded receipt. A recipe alone does not put a
 * kingdom on the grand floor: its land must have been baked and bound to the current receipt. Until then
 * (a realm without land routes, a receipt not yet rebound after growth, or no network) the kingdom keeps
 * today's land, which every home, door and walk already stands on, instead of a gate that never opens.
 *
 * Only an answered binding counts as published. Its bytes are handed to the baked source, which verifies them
 * against the receipt and fails closed on anything malformed; this probe never decides that bytes are valid.
 */
export type PublishedLand =
  | { readonly kind: 'published'; readonly binding: Uint8Array }
  | { readonly kind: 'absent'; readonly reason: 'unpublished' | 'unanswered' | 'unreachable' };

/** A binding is one small JSON document; a realm that has not answered by now does not serve this land. */
export const LAND_PROBE_TIMEOUT_MS = 6000;

export async function probePublishedLand(options: {
  readonly kingdomId: string;
  readonly receipt: { readonly kingdomId: RealmFoundedManifest['kingdomId'] | string; readonly sceneHash: string };
  readonly signal?: AbortSignal;
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMs?: number;
}): Promise<PublishedLand> {
  if (options.receipt.kingdomId !== options.kingdomId) throw new Error('The founded receipt belongs to another kingdom');
  if (!/^[1-9][0-9]{0,31}$/.test(options.kingdomId) || !/^[a-f0-9]{64}$/.test(options.receipt.sceneHash))
    throw new Error('Invalid land identity');
  options.signal?.throwIfAborted();
  const fetcher = options.fetch ?? globalThis.fetch;
  const controller = new AbortController();
  const abort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', abort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, options.timeoutMs ?? LAND_PROBE_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetcher(`/api/realm/land/${options.kingdomId}/${options.receipt.sceneHash}`,
        { signal: controller.signal, credentials: 'same-origin', headers: { accept: 'application/json' } });
    } catch (error) {
      options.signal?.throwIfAborted();
      if (timedOut) return { kind: 'absent', reason: 'unanswered' };
      if (error instanceof TypeError) return { kind: 'absent', reason: 'unreachable' };
      throw error;
    }
    if (response.status === 404) { void response.body?.cancel().catch(() => undefined); return { kind: 'absent', reason: 'unpublished' }; }
    if (response.status !== 200) { void response.body?.cancel().catch(() => undefined); return { kind: 'absent', reason: 'unreachable' }; }
    try {
      return { kind: 'published', binding: await readBounded(response.body, BAKED_BINDING_BYTES, controller.signal) };
    } catch (error) {
      options.signal?.throwIfAborted();
      if (timedOut) return { kind: 'absent', reason: 'unanswered' };
      throw error;
    }
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}
