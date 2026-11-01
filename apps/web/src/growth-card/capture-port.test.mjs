import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CAPTURE_PORTS } from '../../../../packages/testing/capture-ports.mjs';
import { findCapturePort } from './capture-port.mjs';

test('selects only a permitted unoccupied port and stops probing once found', async () => {
  const seen = [];
  const selected = await findCapturePort(async port => { seen.push(port); return port === CAPTURE_PORTS[2]; });
  assert.equal(selected, CAPTURE_PORTS[2]);
  assert.deepEqual(seen, CAPTURE_PORTS.slice(0, 3));
});

test('reports exhaustion instead of selecting a service port', async () => {
  const seen = [];
  await assert.rejects(findCapturePort(async port => { seen.push(port); return false; }), /All permitted capture ports are occupied/);
  assert.deepEqual(seen, CAPTURE_PORTS);
  assert.ok(seen.every(port => port !== 5187 && (port < 5190 || port > 5197)));
});

test('propagates unexpected probe errors instead of treating them as a free port', async () => {
  const failure = Object.assign(new Error('permission denied'), { code: 'EACCES' });
  await assert.rejects(findCapturePort(async () => { throw failure; }), error => error === failure);
});
