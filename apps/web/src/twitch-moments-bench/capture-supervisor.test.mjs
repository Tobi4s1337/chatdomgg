import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clearTimeout, setTimeout } from 'node:timers';
import { superviseCapture } from './capture-supervisor.mjs';
import { acquireCaptureLock } from '../../../../packages/testing/capture-lock.mjs';

/* global AbortController:readonly */

const lockModule = new URL('../../../../packages/testing/capture-lock.mjs', import.meta.url).href;

test('worker exit and spawn errors are observed immediately', async () => {
  await assert.rejects(superviseCapture(process.execPath, ['-e', 'process.exit(7)'], { deadlineMs: 2000, stdio: 'ignore' }), /exited \(7\)/);
  await assert.rejects(superviseCapture('/nonexistent/chatdom-capture-worker', [], { deadlineMs: 2000, stdio: 'ignore' }), /ENOENT/);
});

test('deadline kills the owned process group and releases its capture lock', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'chatdom-moments-supervisor-'));
  const path = join(directory, 'capture.lock');
  try {
    const marker = join(directory, 'acquired');
    const source = `import { writeFile } from 'node:fs/promises'; import { acquireCaptureLock } from ${JSON.stringify(lockModule)}; await acquireCaptureLock({path: ${JSON.stringify(path)}, priority: 'main'}); await writeFile(${JSON.stringify(marker)}, 'yes'); setInterval(() => {}, 1000);`;
    await assert.rejects(superviseCapture(process.execPath, ['--input-type=module', '-e', source], { deadlineMs: 500, graceMs: 100, stdio: 'ignore' }), /deadline/);
    assert.equal(await readFile(marker, 'utf8'), 'yes');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('lock remained held')), 2000);
    try { const release = await acquireCaptureLock({ path, priority: 'main', signal: controller.signal }); await release(); }
    finally { clearTimeout(timer); }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
