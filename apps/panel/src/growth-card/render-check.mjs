import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import solid from 'vite-plugin-solid';

const root = fileURLToPath(new URL('../../../..', import.meta.url));
const server = await createServer({ root: `${root}apps/panel`, configFile: false, plugins: [solid({ ssr: true })], logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true } });
try {
  const { renderShelf, renderMore, renderUntrustedName } = await server.ssrLoadModule('/src/growth-card/render-check.tsx');
  for (const [kind, text] of [['loading', 'Gathering keepsakes'], ['hidden', 'Travels kept private'], ['empty', 'No keepsakes recorded yet'], ['invalid', 'could not be verified'], ['unavailable', 'Keepsakes are unavailable']]) {
    const rendered = renderShelf({ kind, origin: 'simulated' });
    assert.ok(rendered.includes(text), `Missing ${kind} state`);
    assert.ok(rendered.includes('SIMULATED'), `Missing ${kind} provenance`);
    assert.ok(!rendered.includes('A copper acorn'), `${kind} retained a prior keepsake`);
  }
  const more = { kind: 'ready', origin: 'simulated', items: [], hasMore: true };
  assert.ok(renderShelf(more).includes('More keepsakes in the passport.'));
  assert.ok(!renderShelf(more).includes('<button'));
  assert.ok(renderMore(more).includes('See more in the passport'));
  const untrusted = renderUntrustedName();
  assert.ok(untrusted.includes('&lt;img src=x onerror=alert(1)'), untrusted);
  assert.ok(!untrusted.includes('<img'));
  assert.ok(untrusted.includes('&lt;script>kingdom&lt;/script>'));
  assert.ok(!untrusted.includes('<script>'));
  console.log('Earned shelf render checks passed');
} finally { await server.close(); }
