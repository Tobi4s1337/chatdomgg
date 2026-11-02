/// <reference lib="webworker" />
import { growPictureMotions, type PictureMotionReply, type PictureTreeRef } from './picture-motion';

const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = (event: MessageEvent<readonly PictureTreeRef[]>) => {
  try { scope.postMessage({ motions: growPictureMotions(event.data) } satisfies PictureMotionReply); }
  catch (error) { scope.postMessage({ error: error instanceof Error ? error.message : String(error) } satisfies PictureMotionReply); }
};
