// Exercise the real packaging guard against isolated build outputs; no Twitch access or workspace build.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { execFile } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';

const run = promisify(execFile);
const checker = new URL('../../../scripts/public/extension.mjs', import.meta.url);
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'panel-extension-assets-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dist = join(root, 'apps/panel/dist');
  async function asset(name, body) {
    const path = join(dist, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }
  await mkdir(join(root, 'scripts/public'), { recursive: true });
  await copyFile(checker, join(root, 'scripts/public/extension.mjs'));
  await mkdir(join(root, 'bin'));
  // Build is deliberately a no-op: only this test's finished asset graph is inspected.
  await writeFile(join(root, 'bin/pnpm'), '#!/bin/sh\nexit 0\n');
  await chmod(join(root, 'bin/pnpm'), 0o700);
  const html = '<!doctype html><script src="https://extension-files.twitch.tv/helper/v1/twitch-ext.min.js"></script><script type="module" src="./entry.js"></script><link rel="stylesheet" href="./styles/main.css">';
  for (const name of ['panel', 'mobile', 'config', 'live_config']) await asset(`${name}.html`, html);
  await asset('entry.js', 'import "./nested/module.js";');
  await asset('nested/module.js', 'import "../entry.js";');
  await asset('styles/main.css', '@import "./type.css"; .wood {background:url("../wood.svg");filter:url(#grain)} .ink {background:url("data:image/svg+xml,%3Csvg%3E%3Cpath fill=%22url(%23g)%22/%3E%3C/svg%3E")}');
  await asset('styles/type.css', '@font-face {font-family:Review;src:url("../fonts/body.woff2?v=1#face")}');
  await asset('fonts/body.woff2', Buffer.alloc(100));
  await asset('wood.svg', '<svg xmlns="http://www.w3.org/2000/svg"><filter id="grain"/></svg>');
  return {
    asset,
    inspect: () => run(process.execPath, [join(root, 'scripts/public/extension.mjs')], {
      cwd: root, env: { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}` }, timeout: 10000,
    }),
    report: () => readFile(join(root, 'deploy/public/dist/chatdom-panel-0.0.1.txt'), 'utf8'),
  };
}

test('counts nested CSS/fonts, module cycles and fragment URLs once', async t => {
  const f = await fixture(t);
  await f.inspect();
  // HTML, two modules, two stylesheets, one font and one SVG; the fragment is not an eighth file.
  assert.match(await f.report(), /mobile\.html\s+first load\s+\d+ KB \(7 files\)/);
});

test('rejects a mobile graph over budget even when its HTML direct links are small', async t => {
  const f = await fixture(t);
  await f.asset('fonts/body.woff2', Buffer.alloc(1024 * 1024));
  await assert.rejects(f.inspect, error => /mobile\.html: first load \d+ KB is over 1 MB/.test(error.stderr));
});

test('rejects missing nested fonts and JavaScript imports', async t => {
  for (const [name, source, missing] of [
    ['styles/type.css', '@font-face {src:url("../fonts/absent.woff2")}', 'fonts/absent.woff2'],
    ['nested/module.js', 'export { book } from "./absent.js";', 'nested/absent.js'],
  ]) {
    const f = await fixture(t);
    await f.asset(name, source);
    await assert.rejects(f.inspect, error => error.stderr.includes(`mobile.html: refers to missing or invalid ${missing}`));
  }
});
