/// <reference lib="webworker" />
import { prepareInstalledLand } from './prepare';
import { createInstalledRegionMesher } from '../../../../../packages/world/src/grand/baked/mesher';
import type { HostedRequest, HostedReply } from './protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;
let mesher: ReturnType<typeof createInstalledRegionMesher> | undefined;
scope.onmessage = (event: MessageEvent<HostedRequest>) => {
  try {
    const message = event.data;
    if (message.type === 'generate') {
      const prepared = prepareInstalledLand(message.plan, message.recipe);
      mesher = createInstalledRegionMesher(prepared);
      scope.postMessage({ type: 'land', ...prepared } satisfies HostedReply);
    } else if (message.type === 'adopt') {
      mesher = createInstalledRegionMesher(message);
      scope.postMessage({ type: 'ready' } satisfies HostedReply);
    } else {
      if (!mesher) throw new Error('The installed land has not been prepared');
      const result = { type: 'mesh' as const, id: message.id, ...mesher.mesh(message) };
      scope.postMessage(result satisfies HostedReply, [result.quads.buffer, result.offsets.buffer]);
    }
  } catch (error) {
    scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) } satisfies HostedReply);
  }
};
