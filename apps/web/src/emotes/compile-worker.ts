// Decodes the SIMULATED animated fixture from its real GIF bytes and compiles every frame off the
// render thread, as production compiles run on a worker: the page only receives finished,
// schema-checked geometry. The owning page terminates this worker to cancel, which releases every
// buffer at once.
import { MATERIALS } from '@chatdom/content';
import { compileEmote, decodeEmoteImage, toadWaveAnimatedFixture, type CompiledEmote, type EmoteCompileStats, type EmoteSource } from '../../../../packages/emotes/src/index';

export interface BenchCompileRequest { readonly palette: readonly number[]; readonly paletteRevision: number }
export type BenchCompileReply =
  | { ok: true; source: EmoteSource; bytes: number;
    flat: { width: number; height: number; frames: { rgba: Uint8Array; durationMs: number }[] };
    statue: CompiledEmote; statueStats: EmoteCompileStats; heraldry: CompiledEmote; decodeMs: number; compileMs: number }
  | { ok: false; message: string };

interface CompileScope {
  onmessage: ((event: MessageEvent<BenchCompileRequest>) => void) | null;
  postMessage(reply: BenchCompileReply, transfer?: ArrayBuffer[]): void;
}
const scope = self as unknown as CompileScope;
scope.onmessage = event => {
  void (async () => {
    const started = performance.now();
    const { source, bytes } = toadWaveAnimatedFixture();
    const decoded = await decodeEmoteImage(bytes, source.rendition, new AbortController().signal);
    if (!decoded.ok) { scope.postMessage({ ok: false, message: `The GIF could not be decoded: ${decoded.message}` }); return; }
    if (decoded.sourceHash !== source.sourceHash) { scope.postMessage({ ok: false, message: 'The decoded bytes do not match the source hash.' }); return; }
    const decodedAt = performance.now();
    const input = { source, decoded: decoded.decoded };
    const statue = compileEmote(input, MATERIALS, event.data.palette, { purpose: 'statue', paletteRevision: event.data.paletteRevision });
    if (!statue.ok) { scope.postMessage({ ok: false, message: statue.message }); return; }
    const heraldry = compileEmote(input, MATERIALS, event.data.palette, { purpose: 'heraldry', paletteRevision: event.data.paletteRevision });
    if (!heraldry.ok) { scope.postMessage({ ok: false, message: heraldry.message }); return; }
    const frames = decoded.decoded.frames.map(frame => ({ rgba: frame.rgba, durationMs: frame.durationMs }));
    const reply: BenchCompileReply = {
      ok: true, source, bytes: bytes.length, flat: { width: decoded.decoded.width, height: decoded.decoded.height, frames },
      statue: statue.emote, statueStats: statue.stats, heraldry: heraldry.emote, decodeMs: decodedAt - started, compileMs: performance.now() - decodedAt,
    };
    scope.postMessage(reply, frames.map(frame => frame.rgba.buffer as ArrayBuffer));
  })().catch(error => scope.postMessage({ ok: false, message: error instanceof Error ? error.message : String(error) }));
};
