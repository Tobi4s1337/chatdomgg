import { corrupt, EmoteDecodeError, throwIfAborted } from './errors';

/**
 * Inflates a zlib stream into exactly `expected` bytes, using the platform's DecompressionStream
 * (browsers, workers and Node all ship it). The output buffer is sized from the image header before
 * any data is read, so a decompression bomb can never grow it: inflation stops and the stream is
 * cancelled as soon as the declared size is reached. Fewer bytes than declared is a truncated image.
 */
export async function inflateExact(parts: readonly Uint8Array[], expected: number, signal?: AbortSignal): Promise<Uint8Array> {
  throwIfAborted(signal);
  const output = new Uint8Array(expected);
  const stream = new DecompressionStream('deflate');
  const writer = stream.writable.getWriter(), reader = stream.readable.getReader();
  // Write concurrently with reading so backpressure cannot deadlock; write errors surface via read.
  const writing = (async () => {
    for (const part of parts) await writer.write(part as Uint8Array<ArrayBuffer>);
    await writer.close();
  })().catch(() => undefined);
  let filled = 0;
  try {
    while (filled < expected) {
      throwIfAborted(signal);
      let next: ReadableStreamReadResult<Uint8Array>;
      try { next = await reader.read(); } catch { throw corrupt('The compressed image data is damaged.'); }
      if (next.done) break;
      const take = Math.min(next.value.length, expected - filled);
      output.set(next.value.subarray(0, take), filled);
      filled += take;
    }
  } catch (error) {
    if (error instanceof EmoteDecodeError) throw error;
    throw corrupt('The compressed image data is damaged.');
  } finally {
    await reader.cancel().catch(() => undefined);
    await writer.abort().catch(() => undefined);
    await writing;
  }
  if (filled < expected) throw corrupt('The compressed image data ends before the image does.');
  return output;
}
