import type { InlineEmoteVisual } from '../../../../packages/emotes/src/index';

/**
 * Object URLs for verified inline emote bytes, shared by every bubble and pop that shows the same
 * revision and revoked when the last one lets go. No provider URL or credential ever reaches the page:
 * an image is drawn only from bytes the catalogue verified against their content hash.
 */
export interface InlineEmoteImages {
  acquire(visual: InlineEmoteVisual): string;
  release(visual: InlineEmoteVisual): void;
  /** Live URLs, for checks: each is revoked when its count returns to zero. */
  readonly size: number;
  dispose(): void;
}

export interface ObjectUrlApi {
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
}

const keyOf = (visual: InlineEmoteVisual) => `${visual.revision}|${visual.mediaType}`;

export function createInlineEmoteImages(api: ObjectUrlApi = URL): InlineEmoteImages {
  const live = new Map<string, { url: string; count: number }>();
  return {
    acquire(visual) {
      const key = keyOf(visual), entry = live.get(key);
      if (entry) { entry.count++; return entry.url; }
      const url = api.createObjectURL(new Blob([visual.bytes.slice().buffer as ArrayBuffer], { type: visual.mediaType }));
      live.set(key, { url, count: 1 });
      return url;
    },
    release(visual) {
      const key = keyOf(visual), entry = live.get(key);
      if (!entry) return;
      if (--entry.count <= 0) { api.revokeObjectURL(entry.url); live.delete(key); }
    },
    get size() { return live.size; },
    dispose() { for (const entry of live.values()) api.revokeObjectURL(entry.url); live.clear(); },
  };
}
