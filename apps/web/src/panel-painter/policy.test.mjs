import test from 'node:test';
import assert from 'node:assert/strict';
import { LIVE_INTERVAL_MS, RESTING_INTERVAL_MS, paintingDue, paintingRevision, readPainterConfig } from './policy.mjs';

const snapshot = () => ({ status: 'kingdom', kingdomId: '123', stream: 'live', manifest: { kingdomId: '123', origin: 'live', sceneHash: 'a'.repeat(64) },
  presence: { kingdomId: '123', origin: 'live', sequence: 1, asOf: 1, connection: 'fresh', windows: [{ slot: 0, present: true, publicName: 'A real public name', since: 1 }] } });

test('live paintings run at most once a minute, and keep the shared day cycle moving', () => {
  const state = snapshot(), first = paintingRevision(state, 60_000), next = paintingRevision(state, 120_000);
  assert.notEqual(first, next);
  assert.equal(paintingDue(null, first, true, 60_000), true);
  assert.equal(paintingDue({ revision: first, capturedAt: 60_000 }, next, true, 119_999), false);
  assert.equal(paintingDue({ revision: first, capturedAt: 60_000 }, next, true, 60_000 + LIVE_INTERVAL_MS), true);
});

test('resting heartbeat metadata does not repaint an unchanged kingdom', () => {
  const state = snapshot(); state.stream = 'resting'; state.presence.connection = 'offline';
  const first = paintingRevision(state, 60_000);
  state.presence.sequence++; state.presence.asOf += 60_000;
  assert.equal(paintingRevision(state, 3_600_000), first);
  assert.equal(paintingDue({ revision: first, capturedAt: 60_000 }, first, false, 9_000_000), false);
  state.presence.windows[0].present = false; state.presence.windows[0].publicName = null;
  const changed = paintingRevision(state, 3_600_000);
  assert.notEqual(changed, first);
  assert.equal(paintingDue({ revision: first, capturedAt: 60_000 }, changed, false, 60_000 + RESTING_INTERVAL_MS - 1), false);
  assert.equal(paintingDue({ revision: first, capturedAt: 60_000 }, changed, false, 60_000 + RESTING_INTERVAL_MS), true);
});

test('live repaint detects a new window and refuses substituted or nonlive realm data', () => {
  const state = snapshot(), first = paintingRevision(state, 60_000);
  state.presence.windows.push({ slot: 1, present: true, publicName: 'Another public name', since: 2 });
  assert.notEqual(paintingRevision(state, 60_000), first);
  state.presence.kingdomId = '456'; assert.throws(() => paintingRevision(state, 60_000));
  state.presence.kingdomId = '123'; state.presence.origin = 'simulated'; assert.throws(() => paintingRevision(state, 60_000));
});

test('configuration requires separate secrets, bounded channel IDs and credential-free origins', () => {
  const env = { PANEL_PAINTER_WEB_ORIGIN: 'http://localhost:5170', PANEL_PAINTER_API_ORIGIN: 'http://localhost:5171',
    PANEL_PAINTER_REALM_ORIGIN: 'http://localhost:5172', PANEL_PAINTER_KINGDOM_IDS: '123,456,123',
    REALM_INGRESS_PANEL_SECRET: 'r'.repeat(32), PANEL_PAINTER_SECRET: 'p'.repeat(32) };
  assert.deepEqual(readPainterConfig(env).kingdomIds, ['123', '456']);
  assert.throws(() => readPainterConfig({ ...env, PANEL_PAINTER_SECRET: env.REALM_INGRESS_PANEL_SECRET }));
  assert.throws(() => readPainterConfig({ ...env, PANEL_PAINTER_WEB_ORIGIN: 'http://secret@localhost:5170' }));
  assert.throws(() => readPainterConfig({ ...env, PANEL_PAINTER_KINGDOM_IDS: '123?secret=abc' }));
});
