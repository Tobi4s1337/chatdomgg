import { createServer } from 'vite';
import solid from 'vite-plugin-solid';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../../../..', import.meta.url));
const server = await createServer({ root: `${root}apps/web`, configFile: false, plugins: [solid({ ssr: true })], logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true } });
try {
  const { renderProgress } = await server.ssrLoadModule('/src/growth-card/render-check.tsx');
  const home = { plotId: 'one', stage: 'cottage', qualifiedDays: 18, qualifiedMinutes: 180, currentStreak: 4, bestStreak: 9, nextGoal: { stage: 'house', requiredDays: 30, remainingDays: 12 } };
  const current = renderProgress({ kind: 'ready', home, label: 'SIMULATED' });
  for (const word of ['SIMULATED', 'Cottage', '12 days', '4 days', '9 days', '18 of 30 qualified days']) assert.ok(current.includes(word), `Missing ${word}`);
  const complete = renderProgress({ kind: 'ready', home: { ...home, stage: 'hall', nextGoal: null }, label: 'LIVE' });
  assert.ok(complete.includes('highest stage'));
  assert.ok(!complete.includes('progressbar'));
  const beyond = renderProgress({ kind: 'ready', home: { ...home, qualifiedDays: 35, qualifiedMinutes: 350, nextGoal: { ...home.nextGoal, remainingDays: 0 } }, label: 'LIVE' });
  assert.match(beyond, /35 days(?:<!--.*?-->)* of showing up/);
  assert.ok(beyond.includes('30 of 30 qualified days'));
  assert.ok(!beyond.includes('one'));
  const missingGoal = renderProgress({ kind: 'ready', home: { ...home, nextGoal: null }, label: 'LIVE' });
  assert.ok(missingGoal.includes('No next goal is available.'));
  assert.ok(!missingGoal.includes('highest stage'));
  for (const [stage, name] of [['tent', 'Tent'], ['hut', 'Hut'], ['manor', 'Manor']]) {
    const rendered = renderProgress({ kind: 'ready', home: { ...home, stage, nextGoal: null }, label: 'LIVE' });
    assert.ok(rendered.includes(name), `Missing stage ${stage}`);
  }
  const firstDay = renderProgress({ kind: 'ready', home: { ...home, qualifiedDays: 1, qualifiedMinutes: 10, currentStreak: 1, bestStreak: 1, nextGoal: { stage: 'house', requiredDays: 2, remainingDays: 1 } }, label: 'LIVE' });
  assert.ok(firstDay.includes('1 day'));
  assert.ok(!firstDay.includes('1 days'));
  const unavailable = renderProgress({ kind: 'unavailable' });
  assert.ok(unavailable.includes('unavailable'));
  assert.ok(!unavailable.includes('No home progress in this snapshot'));
  for (const [kind, text] of [['loading', 'Gathering home progress'], ['invalid', 'could not be verified'], ['empty', 'No home progress in this snapshot']]) {
    const rendered = renderProgress({ kind, label: 'SIMULATED' });
    assert.ok(rendered.includes(text), `Missing ${kind} state`);
    assert.ok(rendered.includes('SIMULATED'), `Missing ${kind} provenance`);
    assert.ok(!rendered.includes('Cottage'), `${kind} retained the old home`);
  }
  console.log('Home progress render checks passed');
} finally { await server.close(); }
