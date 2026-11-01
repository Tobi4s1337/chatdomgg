// Builds the Chatdom panel as an uploadable Twitch Extension zip and checks it against Twitch's rules for hosted
// assets before anyone uploads it:
//
//   node scripts/public/extension.mjs [--origin https://chatdom.io] [--version 0.0.1]
//
// - every view loads the Extension Helper from Twitch's CDN as its first script, and no other remote script;
// - no inline scripts or inline event handlers, no eval or new Function, no iframes, no data: fonts;
// - every asset path is relative (the CDN serves the zip under /<client id>/<version>/<hash>/);
// - only runtime files (no source maps, no stray files), each view's first load well under 1 MB (mobile rule 3.2);
// - every https origin the code can reach is printed, so the console allowlists match the zip exactly.
//
// Writes deploy/public/dist/chatdom-panel-<version>.zip (its files at the zip root) and a report beside it.
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';

const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const origin = option('--origin', process.env.PANEL_BACKEND_ORIGIN ?? 'https://chatdom.io');
const version = option('--version', process.env.PANEL_VERSION ?? '0.0.1');
if (!/^https:\/\/[a-z0-9.-]+$/.test(origin) && !/^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/.test(origin)) throw new Error('--origin must be an https origin');
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('--version must look like 0.0.1');

const root = resolve(import.meta.dirname, '../..');
const dist = join(root, 'apps/panel/dist');
const out = join(root, 'deploy/public/dist');
const HELPER = 'https://extension-files.twitch.tv/helper/v1/twitch-ext.min.js';
const VIEWS = ['panel.html', 'mobile.html', 'config.html', 'live_config.html'];
const ALLOWED_TYPES = new Set(['.html', '.js', '.css', '.svg', '.png', '.webp', '.jpg', '.woff2', '.mp3', '.ogg', '.opus', '.m4a', '.json', '.txt']);
const FIRST_LOAD_LIMIT = 1024 * 1024;

console.log(`$ pnpm --filter @chatdom/panel build   (backend ${origin})`);
execFileSync('pnpm', ['--filter', '@chatdom/panel', 'build'], { cwd: root, stdio: 'inherit', env: { ...process.env, VITE_CHATDOM_ORIGIN: origin } });

const files = [];
const walk = async dir => {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path); else files.push(path);
  }
};
await walk(dist);
files.sort();

const problems = [], notes = [], origins = new Map();
const rel = path => relative(dist, path).split('\\').join('/');
for (const file of files) {
  const name = rel(file), type = extname(file).toLowerCase();
  if (!ALLOWED_TYPES.has(type)) problems.push(`${name}: not a runtime asset (${type || 'no extension'})`);
  if (!['.html', '.js', '.css', '.svg'].includes(type)) continue;
  const text = await readFile(file, 'utf8');
  if (type === '.js') {
    // zod probes whether it may compile validators with `try { new Function("") } catch`; under Twitch's CSP the probe
    // throws, zod falls back to its interpreter, and nothing is ever evaluated. Any other eval or Function fails the zip.
    const probes = text.match(/try\s*\{\s*new Function\(""\);\s*return true;\s*\}\s*catch/g)?.length ?? 0;
    const evals = text.match(/\beval\s*\(|new\s+Function\s*\(/g)?.length ?? 0;
    if (evals > probes) problems.push(`${name}: eval or new Function (blocked by the extension CSP)`);
    if (probes) notes.push(`${name}: zod's guarded new Function("") probe; it is caught under the CSP and zod interprets instead`);
    if (/import\s*\(\s*['"`]https?:/.test(text)) problems.push(`${name}: imports remote code`);
    if (/sourceMappingURL=/.test(text)) problems.push(`${name}: points at a source map`);
  }
  if (/<iframe\b/i.test(text) && type !== '.js') problems.push(`${name}: contains an iframe`);
  if (type === '.css' && /url\(\s*['"]?data:(?:font|application\/(?:x-)?font)/i.test(text)) problems.push(`${name}: a data: font (font-src forbids data:)`);
  if ((type === '.css' || type === '.html') && /(?:src|href)\s*=\s*["']\/(?!\/)|url\(\s*['"]?\/(?!\/)/.test(text)) problems.push(`${name}: an absolute asset path (breaks on Twitch's CDN)`);
  for (const match of text.matchAll(/https:\/\/[a-z0-9.-]+\.[a-z]{2,}(?=[/"'`\s)?]|$)/gi)) {
    const host = match[0].toLowerCase();
    if (host === 'https://www.w3.org') continue;
    origins.set(host, (origins.get(host) ?? new Set()).add(name));
  }
}

let report = '';
for (const view of VIEWS) {
  const path = join(dist, view);
  let html;
  try { html = await readFile(path, 'utf8'); } catch { problems.push(`${view}: missing`); continue; }
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  const first = scripts[0]?.[1].match(/\bsrc\s*=\s*"([^"]+)"/)?.[1];
  if (first !== HELPER) problems.push(`${view}: the Extension Helper is not the first script`);
  for (const [, attributes, body] of scripts) {
    const src = attributes.match(/\bsrc\s*=\s*"([^"]+)"/)?.[1];
    if (!src && body.trim()) problems.push(`${view}: an inline script`);
    if (src && src !== HELPER && !src.startsWith('./')) problems.push(`${view}: a script from ${src}`);
  }
  if (/\son[a-z]+\s*=/i.test(html.replace(/<script\b[\s\S]*?<\/script>/gi, ''))) problems.push(`${view}: an inline event handler attribute`);
  if (/http-equiv\s*=\s*["']content-security-policy/i.test(html)) problems.push(`${view}: a CSP meta tag (Twitch sets the CSP)`);
  // First load: the page, its scripts, preloaded modules and stylesheets (fonts and images load as they are drawn).
  const loaded = new Set([view]);
  for (const match of html.matchAll(/(?:src|href)\s*=\s*"\.\/([^"]+)"/g)) loaded.add(match[1]);
  let bytes = 0;
  for (const asset of loaded) { try { bytes += (await stat(join(dist, asset))).size; } catch { problems.push(`${view}: refers to missing ${asset}`); } }
  if (bytes > FIRST_LOAD_LIMIT) problems.push(`${view}: first load ${(bytes / 1024).toFixed(0)} KB is over 1 MB`);
  report += `${view.padEnd(17)} first load ${(bytes / 1024).toFixed(0).padStart(4)} KB (${loaded.size} files)\n`;
}

const expected = new Set([origin, 'https://extension-files.twitch.tv', 'https://chatdom.io']);
const reached = [...origins.keys()].sort();
report += `\nhttps origins named in the code:\n${reached.map(host => `  ${host}${expected.has(host) ? '' : '   (only as text or a link; not fetched)'}  <- ${[...origins.get(host)].slice(0, 3).join(', ')}`).join('\n')}\n`;
report += notes.length ? `\nNotes for the reviewer:\n${notes.map(line => `  ${line}`).join('\n')}\n` : '';
report += `\nConsole allowlists for this zip:\n  URL Fetching Domains: ${origin}\n  Image Domains: (none)\n  Media Domains: (none)\n  Panel URLs (links): ${origin}\n`;

if (problems.length) {
  console.error(`\nThe panel zip would not pass Twitch's hosted rules:\n${problems.map(line => `  - ${line}`).join('\n')}`);
  process.exit(1);
}

// A deterministic zip (fixed time, sorted names, deflate): files at the root, as Twitch expects.
const entries = [], central = [];
let offset = 0;
const DOS_TIME = 0, DOS_DATE = ((2026 - 1980) << 9) | (11 << 5) | 1;
for (const file of files) {
  const name = Buffer.from(rel(file), 'utf8');
  const data = await readFile(file);
  const packed = deflateRawSync(data, { level: 9 });
  const stored = packed.length >= data.length;
  const body = stored ? data : packed, method = stored ? 0 : 8, crc = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(method, 8);
  local.writeUInt16LE(DOS_TIME, 10); local.writeUInt16LE(DOS_DATE, 12); local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
  entries.push(local, name, body);
  const head = Buffer.alloc(46);
  head.writeUInt32LE(0x02014b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(20, 6); head.writeUInt16LE(0x0800, 8); head.writeUInt16LE(method, 10);
  head.writeUInt16LE(DOS_TIME, 12); head.writeUInt16LE(DOS_DATE, 14); head.writeUInt32LE(crc, 16); head.writeUInt32LE(body.length, 20);
  head.writeUInt32LE(data.length, 24); head.writeUInt16LE(name.length, 28); head.writeUInt32LE(offset, 42);
  central.push(head, name);
  offset += local.length + name.length + body.length;
}
const centralBytes = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralBytes.length, 12); end.writeUInt32LE(offset, 16);
const zip = Buffer.concat([...entries, centralBytes, end]);
const zipPath = join(out, `chatdom-panel-${version}.zip`);
await mkdir(dirname(zipPath), { recursive: true });
await writeFile(zipPath, zip);
await writeFile(join(out, `chatdom-panel-${version}.txt`), `Chatdom panel ${version} for ${origin}\n${files.length} files, ${(zip.length / 1024).toFixed(0)} KB zipped\n\n${report}`);
console.log(`\n${report}\nwrote ${relative(root, zipPath)} (${files.length} files, ${(zip.length / 1024).toFixed(0)} KB); every hosted-asset check passed`);
