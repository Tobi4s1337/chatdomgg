/// <reference lib="webworker" />
import { sampleFoundedGroundBand, type FoundedGroundRequest } from './terrain-founded';

const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = (event: MessageEvent<FoundedGroundRequest>) => {
  try {
    const band = sampleFoundedGroundBand(event.data);
    const transfer: ArrayBuffer[] = [band.height.heights.buffer as ArrayBuffer];
    if (band.floor) transfer.push(band.floor.heights.buffer as ArrayBuffer);
    scope.postMessage(band, transfer);
  } catch (error) {
    scope.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
