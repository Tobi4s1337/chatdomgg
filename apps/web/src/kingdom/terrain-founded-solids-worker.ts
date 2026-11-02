/// <reference lib="webworker" />
import type { PlacedSolidsInput } from '@chatdom/voxel/collision';
import { compileFoundedSolidsPacked, type FoundedSolidsReply } from './terrain-founded-solids';

const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = (event: MessageEvent<PlacedSolidsInput>) => {
  try {
    const boxes = compileFoundedSolidsPacked(event.data);
    scope.postMessage({ boxes } satisfies FoundedSolidsReply, [boxes.buffer as ArrayBuffer]);
  } catch (error) {
    scope.postMessage({ error: error instanceof Error ? error.message : String(error) } satisfies FoundedSolidsReply);
  }
};
