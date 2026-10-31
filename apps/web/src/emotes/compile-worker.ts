// Paints the SIMULATED fixture and compiles it off the render thread, as production compiles run
// on a worker: the page only receives finished, schema-checked geometry.
import { MATERIALS } from '@chatdom/content';
import { compileEmote, toadWaveFixture, type CompiledEmote, type EmoteCompileStats, type EmoteSource } from '../../../../packages/emotes/src/index';

export interface BenchCompileRequest { readonly palette: readonly number[]; readonly paletteRevision: number }
export type BenchCompileReply =
  | { ok: true; source: EmoteSource; flat: { width: number; height: number; rgba: Uint8Array };
    statue: CompiledEmote; statueStats: EmoteCompileStats; heraldry: CompiledEmote; elapsedMs: number }
  | { ok: false; message: string };

interface CompileScope {
  onmessage: ((event: MessageEvent<BenchCompileRequest>) => void) | null;
  postMessage(reply: BenchCompileReply, transfer?: ArrayBuffer[]): void;
}
const scope = self as unknown as CompileScope;
scope.onmessage = event => {
  const started = performance.now();
  try {
    const fixture = toadWaveFixture();
    const statue = compileEmote(fixture, MATERIALS, event.data.palette, { purpose: 'statue', paletteRevision: event.data.paletteRevision });
    if (!statue.ok) { scope.postMessage({ ok: false, message: statue.message } satisfies BenchCompileReply); return; }
    const heraldry = compileEmote(fixture, MATERIALS, event.data.palette, { purpose: 'heraldry', paletteRevision: event.data.paletteRevision });
    if (!heraldry.ok) { scope.postMessage({ ok: false, message: heraldry.message } satisfies BenchCompileReply); return; }
    const frame = fixture.decoded.frames[0]!;
    const reply: BenchCompileReply = {
      ok: true, source: fixture.source, flat: { width: fixture.decoded.width, height: fixture.decoded.height, rgba: frame.rgba },
      statue: statue.emote, statueStats: statue.stats, heraldry: heraldry.emote, elapsedMs: performance.now() - started,
    };
    scope.postMessage(reply, [frame.rgba.buffer as ArrayBuffer]);
  } catch (error) {
    scope.postMessage({ ok: false, message: error instanceof Error ? error.message : String(error) } satisfies BenchCompileReply);
  }
};
