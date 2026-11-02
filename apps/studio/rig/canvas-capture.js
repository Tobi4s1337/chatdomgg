// Canvas capture with WebCodecs, injected before any page script in the top frame of a recording (the GPU
// recorder's first choice, PRD decision 7). The recorder steps the virtual clock, waits for the frame to settle,
// then calls `__studioCapture.capture(index)`: the plate canvas becomes a VideoFrame with an exact timestamp
// (index / fps) and goes to a VideoEncoder on the machine's own GPU. Encoded chunks are pulled back with
// `drain()` and written as an Annex B stream; the recorder muxes it. Only the canvas is captured, so the plate
// is clean by construction: no DOM overlay can reach it.
//
// Every WebGL context is created with preserveDrawingBuffer, so the canvas still holds the frame it drew when the
// recorder reads it after the settle wait (and a frame the page chose not to redraw keeps its last picture).
/* global window, document, HTMLCanvasElement, VideoEncoder, VideoFrame, btoa, crypto -- runs in the page */
(() => {
  if (globalThis.__studioCapture || window.top !== window) return;

  const original = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function getContext(type, attributes) {
    if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') attributes = { ...(attributes ?? {}), preserveDrawingBuffer: true };
    return original.call(this, type, attributes);
  };

  let encoder = null;
  let settings = null;
  let chunks = [];
  let errors = [];
  let captured = 0;
  let keyEvery = 60;

  function plate() {
    if (window.__set?.canvas) return window.__set.canvas;
    let best = null;
    for (const canvas of document.querySelectorAll('canvas')) if (!best || canvas.width * canvas.height > best.width * best.height) best = canvas;
    return best;
  }

  function toBase64(bytes) {
    let out = '';
    for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(out);
  }

  async function digest(bytes) {
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    return Array.from(hash, b => b.toString(16).padStart(2, '0')).join('');
  }

  const api = {
    /**
     * Picks the first supported configuration from `candidates` (each a VideoEncoderConfig without width/height)
     * at the given size and opens the encoder. Returns what was chosen, or every refusal.
     */
    async configure({ width, height, fps = 60, candidates, keyInterval = 60 }) {
      if (typeof VideoEncoder === 'undefined') return { ok: false, reason: 'no WebCodecs in this browser' };
      keyEvery = keyInterval;
      const refused = [];
      for (const candidate of candidates) {
        const config = { ...candidate, width, height, framerate: fps };
        try {
          const support = await VideoEncoder.isConfigSupported(config);
          if (!support.supported) { refused.push({ codec: config.codec, hardwareAcceleration: config.hardwareAcceleration, bitrateMode: config.bitrateMode }); continue; }
          encoder = new VideoEncoder({
            output: (chunk, meta) => {
              const bytes = new Uint8Array(chunk.byteLength);
              chunk.copyTo(bytes);
              chunks.push({ timestamp: chunk.timestamp, key: chunk.type === 'key', bytes, decoderConfig: meta?.decoderConfig ? { codec: meta.decoderConfig.codec, codedWidth: meta.decoderConfig.codedWidth, codedHeight: meta.decoderConfig.codedHeight } : null });
            },
            error: error => errors.push(String(error?.message ?? error)),
          });
          encoder.configure(support.config);
          settings = { ...support.config, fps };
          return { ok: true, config: settings, refused };
        } catch (error) {
          refused.push({ codec: config.codec, error: String(error?.message ?? error) });
        }
      }
      return { ok: false, reason: 'no candidate configuration is supported', refused };
    },

    /** Encodes the plate canvas as frame `index` (timestamp index / fps). `key` forces a keyframe. */
    capture(index, { key = false, quantizer } = {}) {
      if (!encoder) throw new Error('capture before configure');
      if (errors.length) throw new Error(`encoder failed: ${errors.join('; ')}`);
      const canvas = plate();
      if (!canvas) throw new Error('no canvas to capture');
      const fps = settings.fps;
      const frame = new VideoFrame(canvas, { timestamp: Math.round(index * 1e6 / fps), duration: Math.round(1e6 / fps) });
      const options = { keyFrame: key || captured === 0 || index % keyEvery === 0 };
      if (settings.bitrateMode === 'quantizer' && quantizer != null) {
        if (settings.codec.startsWith('avc')) options.avc = { quantizer };
        else if (settings.codec.startsWith('hev') || settings.codec.startsWith('hvc')) options.hevc = { quantizer };
        else if (settings.codec.startsWith('vp09')) options.vp9 = { quantizer };
        else if (settings.codec.startsWith('av01')) options.av1 = { quantizer };
      }
      encoder.encode(frame, options);
      frame.close();
      captured += 1;
      return { queue: encoder.encodeQueueSize, canvas: [canvas.width, canvas.height] };
    },

    /** Encoder backlog, so the recorder can wait instead of running ahead of the GPU. */
    queue: () => encoder?.encodeQueueSize ?? 0,

    /** Hands back up to `maxBytes` of encoded chunks, oldest first, as base64 with each chunk's SHA-256. */
    async drain(maxBytes = 48 << 20) {
      const out = [];
      let bytes = 0;
      while (chunks.length && (bytes === 0 || bytes + chunks[0].bytes.length <= maxBytes)) {
        const chunk = chunks.shift();
        bytes += chunk.bytes.length;
        out.push({ timestamp: chunk.timestamp, key: chunk.key, size: chunk.bytes.length, sha256: await digest(chunk.bytes), data: toBase64(chunk.bytes), decoderConfig: chunk.decoderConfig });
      }
      return { chunks: out, left: chunks.length, errors };
    },

    /** Waits until every submitted frame has come out of the encoder. */
    async flush() { if (encoder) await encoder.flush(); return { captured, left: chunks.length, errors }; },

    async close() { if (encoder && encoder.state !== 'closed') { await encoder.flush().catch(() => {}); encoder.close(); } encoder = null; },
    settings: () => settings,
  };
  Object.defineProperty(globalThis, '__studioCapture', { value: api, configurable: false, enumerable: false, writable: false });
})();
