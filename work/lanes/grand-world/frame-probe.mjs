// An in-page frame probe for the kingdom renderer: draw calls and triangles per render pass and per shader
// program, and GPU time per pass from timer queries where the browser offers them. It is injected before any page
// script (Playwright addInitScript or CDP Page.addScriptToEvaluateOnNewDocument) and touches only WebGL2 contexts.
// It is off until `window.__frameProbe.start(frames)` is called, so a frame-time record taken without it carries
// no instrumentation cost beyond one boolean check per wrapped call.
//
// A pass is one framebuffer binding with its viewport: the water reflection target, the sun shadow map, the post
// stack's scene target, its effect targets and the canvas. Counts are exact on any renderer (software included);
// GPU times come only from EXT_disjoint_timer_query_webgl2 and are dropped for any frame the GPU reports disjoint.

export const FRAME_PROBE_SOURCE = `(() => {
  if (window.__frameProbe) return;
  const probe = { recording: 0, frames: [], programs: new Map(), timer: false, disjoint: 0, contexts: [], callbacks: new Map() };
  let nextProgram = 1, nextFramebuffer = 1, current = null;
  const programIds = new WeakMap(), framebufferIds = new WeakMap(), sources = new WeakMap(), attached = new WeakMap();
  const MODE_TRIANGLES = 4, MODE_STRIP = 5, MODE_FAN = 6;
  function label(program) {
    const shaders = attached.get(program) || [];
    const vertex = shaders.map(s => sources.get(s) || '').find(s => /gl_Position/.test(s)) || '';
    const fragment = shaders.map(s => sources.get(s) || '').find(s => !/gl_Position/.test(s)) || '';
    const name = (vertex.match(/#define SHADER_NAME (.+)/) || [])[1] || '';
    const ins = [...vertex.matchAll(/^\\s*(?:layout\\([^)]*\\)\\s*)?in\\s+\\w+\\s+(\\w+)\\s*;/gm)].map(m => m[1]).filter(n => n !== 'position').sort();
    const uniforms = [...fragment.matchAll(/uniform\\s+\\w+\\s+(u\\w+)/g)].map(m => m[1]).slice(0, 4);
    return (name.trim() ? name.trim() + ' ' : '') + '[' + ins.join(',') + '] ' + uniforms.join(',');
  }
  function triangles(mode, count, instances) {
    const per = mode === MODE_TRIANGLES ? Math.floor(count / 3) : mode === MODE_STRIP || mode === MODE_FAN ? Math.max(0, count - 2) : 0;
    return per * instances;
  }
  function endQuery(state) {
    if (!state.active) return;
    state.endQuery(state.timer.TIME_ELAPSED_EXT);
    state.queries.push(state.active); state.active = null;
  }
  function pass(state) {
    const gl = state.gl, fb = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    let id = 0;
    if (fb) { id = framebufferIds.get(fb); if (!id) { id = nextFramebuffer++; framebufferIds.set(fb, id); } }
    const vp = gl.getParameter(gl.VIEWPORT);
    const key = state.id + '/' + id + ':' + vp[2] + 'x' + vp[3];
    let entry = current.passes.find(p => p.key === key && p.open);
    if (!entry) {
      for (const p of current.passes) p.open = false;
      entry = { key, context: state.id, framebuffer: id, size: [vp[2], vp[3]], draws: 0, triangles: 0, programs: {}, gpuNs: null, queries: 0, open: true };
      current.passes.push(entry);
    }
    return entry;
  }
  function draw(state, mode, count, instances) {
    if (!probe.recording || !current) return;
    const gl = state.gl, entry = pass(state);
    if (state.timer && (!state.active || state.active.pass !== entry)) {
      endQuery(state);
      const query = gl.createQuery();
      state.beginQuery(state.timer.TIME_ELAPSED_EXT, query);
      state.active = { query, pass: entry, frame: current }; entry.queries++; current.pending++;
    }
    const program = gl.getParameter(gl.CURRENT_PROGRAM);
    const pid = program ? programIds.get(program) : 0;
    const tris = triangles(mode, count, instances);
    entry.draws++; entry.triangles += tris;
    const slot = entry.programs[pid] || (entry.programs[pid] = { draws: 0, triangles: 0 });
    slot.draws++; slot.triangles += tris;
  }
  function instrument(gl) {
    const state = { gl, id: probe.contexts.length, timer: gl.getExtension('EXT_disjoint_timer_query_webgl2'), active: null, queries: [] };
    probe.contexts.push(state); probe.timer = probe.timer || !!state.timer;
    // Only one TIME_ELAPSED query may be open. While recording, the page's own frame timer (the quality governor's)
    // is set aside so the probe can time each pass; the page sees no result for those frames and simply skips them.
    state.beginQuery = gl.beginQuery.bind(gl); state.endQuery = gl.endQuery.bind(gl); state.setAside = false;
    gl.beginQuery = (target, query) => {
      if (state.timer && target === state.timer.TIME_ELAPSED_EXT && probe.recording) { state.setAside = true; return; }
      return state.beginQuery(target, query);
    };
    gl.endQuery = target => {
      if (state.timer && target === state.timer.TIME_ELAPSED_EXT && state.setAside) { state.setAside = false; return; }
      return state.endQuery(target);
    };
    const after = (name, hook) => { const original = gl[name].bind(gl); gl[name] = (...args) => { const r = original(...args); hook(args, r); return r; }; };
    after('shaderSource', ([shader, source]) => sources.set(shader, source));
    after('attachShader', ([program, shader]) => { const list = attached.get(program) || []; list.push(shader); attached.set(program, list); });
    after('linkProgram', ([program]) => { const id = nextProgram++; programIds.set(program, id); probe.programs.set(id, label(program)); });
    const before = (name, hook) => { const original = gl[name].bind(gl); gl[name] = (...args) => { hook(args); return original(...args); }; };
    before('drawArrays', ([mode, , count]) => draw(state, mode, count, 1));
    before('drawElements', ([mode, count]) => draw(state, mode, count, 1));
    before('drawArraysInstanced', ([mode, , count, n]) => draw(state, mode, count, n));
    before('drawElementsInstanced', ([mode, count, , , n]) => draw(state, mode, count, n));
    before('drawRangeElements', ([mode, , , count]) => draw(state, mode, count, 1));
    before('bindFramebuffer', () => { if (state.active) endQuery(state); });
  }
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (kind, ...rest) {
    const gl = getContext.call(this, kind, ...rest);
    if (gl && kind === 'webgl2' && !gl.__frameProbe) { gl.__frameProbe = true; instrument(gl); }
    return gl;
  };
  function collect() {
    for (const state of probe.contexts) {
      if (!state.timer || !state.queries.length) continue;
      const gl = state.gl, disjoint = gl.getParameter(state.timer.GPU_DISJOINT_EXT);
      state.queries = state.queries.filter(item => {
        if (!gl.getQueryParameter(item.query, gl.QUERY_RESULT_AVAILABLE)) return true;
        const ns = gl.getQueryParameter(item.query, gl.QUERY_RESULT);
        gl.deleteQuery(item.query);
        item.frame.pending--;
        if (disjoint) { item.frame.disjoint = true; probe.disjoint++; return false; }
        item.pass.gpuNs = (item.pass.gpuNs || 0) + ns;
        return false;
      });
    }
  }
  const raf = window.requestAnimationFrame.bind(window);
  let frameTime = -1;
  window.requestAnimationFrame = callback => raf(time => {
    if (time !== frameTime) {
      frameTime = time;
      collect();
      if (probe.recording && current && current.passes.length) { probe.frames.push(current); probe.recording--; }
      current = probe.recording ? { time, passes: [], pending: 0, disjoint: false, cpuMs: 0, callbacks: [] } : null;
    }
    const started = current ? performance.now() : 0;
    try { callback(time); }
    finally {
      for (const state of probe.contexts) if (state.active) endQuery(state);
      if (current) {
        const ms = performance.now() - started;
        current.cpuMs += ms;
        const key = String(callback).replace(/\\s+/g, ' ').slice(0, 90);
        const item = probe.callbacks.get(key) || { ms: 0, calls: 0 };
        item.ms += ms; item.calls++; probe.callbacks.set(key, item);
      }
    }
  });
  probe.start = frames => { probe.frames = []; probe.callbacks.clear(); probe.recording = frames; current = null; };
  probe.done = () => probe.recording === 0 && probe.contexts.every(s => !s.queries.length);
  probe.flush = () => { collect(); return probe.contexts.reduce((n, s) => n + s.queries.length, 0); };
  probe.report = () => ({
    timer: probe.timer, contexts: probe.contexts.length, disjoint: probe.disjoint,
    programs: Object.fromEntries(probe.programs),
    callbacks: [...probe.callbacks].map(([source, v]) => ({ source, ms: +v.ms.toFixed(2), calls: v.calls })).sort((a, b) => b.ms - a.ms).slice(0, 12),
    frames: probe.frames.map(f => ({ time: Math.round(f.time), disjoint: f.disjoint, cpuMs: +f.cpuMs.toFixed(3), passes: f.passes.map(p => ({
      context: p.context, framebuffer: p.framebuffer, size: p.size, draws: p.draws, triangles: p.triangles,
      gpuMs: p.gpuNs === null || f.disjoint ? null : +(p.gpuNs / 1e6).toFixed(3), programs: p.programs })) })),
  });
  window.__frameProbe = probe;
})();`;

/** Sum a probe report's frames into per-frame totals and per-pass medians (passes keyed by framebuffer and size). */
export function summariseProbe(report) {
  const frames = report.frames.filter(frame => frame.passes.length);
  const totals = frames.map(frame => ({
    draws: frame.passes.reduce((n, p) => n + p.draws, 0),
    triangles: frame.passes.reduce((n, p) => n + p.triangles, 0),
    gpuMs: frame.disjoint || frame.passes.some(p => p.gpuMs === null) ? null : +frame.passes.reduce((n, p) => n + p.gpuMs, 0).toFixed(3),
    cpuMs: frame.cpuMs ?? null,
  }));
  const median = values => { const s = values.filter(v => v !== null).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
  const max = values => values.length ? Math.max(...values) : null;
  const passes = new Map();
  for (const frame of frames) for (const p of frame.passes) {
    const key = `${p.context}/${p.framebuffer}:${p.size.join('x')}`;
    const item = passes.get(key) ?? { key, size: p.size, frames: 0, draws: [], triangles: [], gpuMs: [], programs: new Map() };
    item.frames++; item.draws.push(p.draws); item.triangles.push(p.triangles); item.gpuMs.push(frame.disjoint ? null : p.gpuMs);
    for (const [id, slot] of Object.entries(p.programs)) {
      const prior = item.programs.get(id) ?? { draws: 0, triangles: 0, frames: 0 };
      prior.draws += slot.draws; prior.triangles += slot.triangles; prior.frames++;
      item.programs.set(id, prior);
    }
    passes.set(key, item);
  }
  return {
    frames: frames.length,
    draws: { median: median(totals.map(t => t.draws)), max: max(totals.map(t => t.draws)) },
    triangles: { median: median(totals.map(t => t.triangles)), max: max(totals.map(t => t.triangles)) },
    gpuMs: { median: median(totals.map(t => t.gpuMs)), max: max(totals.map(t => t.gpuMs).filter(v => v !== null)) },
    cpuMs: { median: median(totals.map(t => t.cpuMs)), max: max(totals.map(t => t.cpuMs).filter(v => v !== null)) },
    callbacks: report.callbacks ?? [],
    passes: [...passes.values()].map(item => ({ key: item.key, size: item.size, frames: item.frames,
      draws: { median: median(item.draws), max: max(item.draws) }, triangles: { median: median(item.triangles), max: max(item.triangles) },
      gpuMs: median(item.gpuMs),
      programs: [...item.programs].map(([id, slot]) => ({ program: report.programs[id] ?? `#${id}`,
        draws: Math.round(slot.draws / item.frames), triangles: Math.round(slot.triangles / item.frames) }))
        .sort((a, b) => b.draws - a.draws) })),
  };
}
