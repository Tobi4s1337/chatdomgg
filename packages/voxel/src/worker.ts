import { executeVoxelJob, resultTransferables, type VoxelJob, type VoxelWorkerResponse } from './protocol';

// Structural worker interface avoids mixing the DOM and WebWorker ambient declarations.
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<VoxelJob>) => void) | null;
  postMessage: (response: VoxelWorkerResponse, transfer: ArrayBuffer[]) => void;
};
scope.onmessage = (event) => {
  try {
    const result = executeVoxelJob(event.data);
    scope.postMessage(result, resultTransferables(result));
  } catch (error) {
    scope.postMessage({ id: event.data.id, kind: 'error', message: error instanceof Error ? error.message : 'Voxel worker failed.' }, []);
  }
};
