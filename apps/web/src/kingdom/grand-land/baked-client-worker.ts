import { verifyAndDecode, type BakedDecodeRequest, type BakedDecodeReply } from './baked-client-decode';

const owner = globalThis as unknown as { onmessage: ((event: MessageEvent<BakedDecodeRequest>) => void) | null;
  postMessage(message: BakedDecodeReply, transfer: Transferable[]): void };
owner.onmessage = (event: MessageEvent<BakedDecodeRequest>) => {
  const { id, bytes, ref, context } = event.data;
  void verifyAndDecode(bytes, ref, context, new AbortController().signal).then(result => {
    const transfer = [result.compressed.buffer as ArrayBuffer];
    if ('ground' in result.value) transfer.push(result.value.ground.buffer as ArrayBuffer, result.value.water.buffer as ArrayBuffer);
    else if ('quads' in result.value) transfer.push(result.value.quads.buffer as ArrayBuffer, result.value.offsets.buffer as ArrayBuffer);
    owner.postMessage({ id, result }, transfer);
  }, error => owner.postMessage({ id, error: error instanceof Error ? error.message : 'Baked land decoding failed' }, []));
};
