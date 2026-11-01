// Typecheck the main-owned consumers, with any unlanded patch hunks overlaid in memory.
// Already-landed hunks must match exactly too. No source outside lane scope is written.
import ts from 'typescript';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const patch = await readFile('work/lanes/walking-together/integration.patch', 'utf8');
const hunks = [];
let path;
for (const line of patch.split(/(?<=\n)/)) {
  if (line.startsWith('--- a/')) path = line.slice(6).trim();
  else if (line.startsWith('@@ ')) hunks.push({ path, old: '', next: '' });
  else if (line.startsWith('+++ ')) continue;
  else if (hunks.length) {
    const hunk = hunks.at(-1);
    if (line.startsWith(' ')) { hunk.old += line.slice(1); hunk.next += line.slice(1); }
    else if (line.startsWith('-')) hunk.old += line.slice(1);
    else if (line.startsWith('+')) hunk.next += line.slice(1);
    else if (line === '\n') { hunk.old += line; hunk.next += line; }
  }
}
assert.ok(hunks.length, 'No integration hunks');
const overlay = new Map();
let installed = 0;
for (const hunk of hunks) {
  const filename = resolve(hunk.path);
  const source = overlay.get(filename) ?? await readFile(filename, 'utf8');
  const pending = source.split(hunk.old).length - 1, landed = source.split(hunk.next).length - 1;
  assert.ok((pending === 1 && landed === 0) || (pending === 0 && landed === 1), `Patch context changed or ambiguous: ${hunk.path}`);
  if (landed) { installed++; continue; }
  overlay.set(filename, source.replace(hunk.old, hunk.next));
}
const config = ts.readConfigFile('tsconfig.json', ts.sys.readFile);
if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd());
const options = { ...parsed.options, noEmit: true };
const host = ts.createCompilerHost(options), originalSource = host.getSourceFile.bind(host);
host.getSourceFile = (filename, language, onError, fresh) => {
  const source = overlay.get(resolve(filename));
  return source === undefined ? originalSource(filename, language, onError, fresh) : ts.createSourceFile(filename, source, language, true);
};
const program = ts.createProgram(parsed.fileNames, options, host);
const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
if (diagnostics.length) {
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: file => file, getCurrentDirectory: () => process.cwd(), getNewLine: () => '\n',
  }));
  process.exitCode = 1;
} else console.log(`Integration typecheck passed: ${installed}/${hunks.length} hunks already landed, ${overlay.size} source files overlaid in memory. No main-owned file was modified.`);
