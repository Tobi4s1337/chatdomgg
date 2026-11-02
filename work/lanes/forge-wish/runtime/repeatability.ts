import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { createNativeForgeHost, assembleForge, checkForge, findForgeSockets, forgeStyleKit } from '../../../../packages/forge/src';
import { renderForgeContactSheet } from '../../../../apps/codex/src/contact-sheet';
import { createForgeProviders } from '../../../../apps/codex/src/providers';
import { runCodexDraft, type CodexDraftCompletion } from '../../../../apps/codex/src/providers/codex-cli';
import { FORGE_JUDGE_POLICY_VERSION } from '../../../../apps/codex/src/providers/policy';
import { forgeResultMeasure, withForgeQuality } from '../../../../apps/codex/src/quality';
import { REPEATABILITY_FIXTURES, fixedWish } from './repeatability-fixtures';
import { repeatabilityPass, type RepeatabilityRead } from './repeatability-policy';

const root = '/tmp/chatdom-forge-wish';
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const check: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(`Repeatability: ${message}`);
};
interface StoredFixture { id: string; wishId: string; wishSha256: string; family: string; kitId: string; kitRevision: number; draft: unknown; sha256: string }
interface Manifest { version: number; policy: string; source: string; fixtures: StoredFixture[] }

/** A new immutable input set. No model, word gate, publication or approval is claimed. */
export async function prepareRepeatability(): Promise<string> {
  const directory = join(root, `repeatability-${randomUUID()}`);
  await mkdir(directory, { recursive: true, mode: 0o700 }); await chmod(directory, 0o700);
  const manifest: Manifest = { version: 1, policy: FORGE_JUDGE_POLICY_VERSION, source: 'authored-assembly-fixture', fixtures: [] };
  for (const fixture of REPEATABILITY_FIXTURES) {
    const home = createNativeForgeHost({ slot: 0, position: [0, 0, 0], rotation: 0, tier: 'house', style: fixture.family, variant: 0 }).blueprint;
    const kit = forgeStyleKit(fixture.family, fixture.kitRevision);
    const socket = findForgeSockets(home, 'street-home', kit.revision).find(socket => socket.kind === fixture.draft.plan.kind);
    check(socket, 'a native fixture home lacks its declared socket.');
    const made = assembleForge(fixture.draft.plan, kit, socket);
    checkForge(made, home);
    const bytes = Buffer.from(renderForgeContactSheet(made.blueprint, { home, origin: socket.origin }).split(',')[1]!, 'base64');
    await writeFile(join(directory, `${fixture.id}.png`), bytes, { mode: 0o600, flag: 'wx' });
    manifest.fixtures.push({ ...fixture, kitId: kit.id, wishSha256: hash(fixedWish(fixture.wishId)), sha256: hash(bytes) });
  }
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600, flag: 'wx' });
  console.info(JSON.stringify({ mode: 'prepare', directory, fixtures: manifest.fixtures.length, modelCalls: 0 }));
  return directory;
}

/** Read only the frozen PNGs. Never redraft, assemble or render in this path. */
export async function checkRepeatability(inputDirectory: string, mode: 'repeatability' = 'repeatability'): Promise<void> {
  const directory = await realpath(resolve(inputDirectory));
  check(directory.startsWith(root + sep) && /^repeatability-[a-f0-9-]+$/.test(directory.slice(root.length + 1)), 'use an owned private fixture directory.');
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')) as Manifest;
  // Stored sheets are policy-independent pixels; v7 reuses the frozen v6 set unchanged.
  check(manifest.version === 1 && ['house-part-safety-quality-2026-11-02-v6', FORGE_JUDGE_POLICY_VERSION].includes(manifest.policy)
    && manifest.source === 'authored-assembly-fixture' && Array.isArray(manifest.fixtures)
    && manifest.fixtures.length === REPEATABILITY_FIXTURES.length, 'fixture manifest/version changed.');
  const images: string[] = [];
  for (const [index, expected] of REPEATABILITY_FIXTURES.entries()) {
    const actual = manifest.fixtures[index];
    check(actual && actual.id === expected.id && actual.wishId === expected.wishId && actual.family === expected.family
      && actual.kitId === `${expected.family}-native` && actual.kitRevision === expected.kitRevision
      && actual.wishSha256 === hash(fixedWish(expected.wishId))
      && JSON.stringify(actual.draft) === JSON.stringify(expected.draft) && /^[a-f0-9]{64}$/.test(actual.sha256), 'fixed fixture metadata changed.');
    const bytes = await readFile(join(directory, `${expected.id}.png`));
    check(bytes.length < 3_000_000 && hash(bytes) === actual.sha256
      && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'stored sheet bytes changed.');
    images.push(`data:image/png;base64,${bytes.toString('base64')}`);
  }
  const resultDirectory = join(directory, `reads-v7-${randomUUID()}`);
  await mkdir(resultDirectory, { mode: 0o700 });
  const metrics: CodexDraftCompletion[] = [], reads: RepeatabilityRead[] = [];
  const activeCalls = new Set<Promise<string>>(), abort = new AbortController();
  let usageLimit = false, ok = false, error: string | undefined;
  const stop = () => abort.abort();
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  const deadline = setTimeout(stop, 8 * 60_000);
  const began = performance.now();
  const providers = createForgeProviders({ runCodex: async input => {
    check(!usageLimit && metrics.length < 40, 'usage limit or call ceiling stopped this run.');
    const promise = runCodexDraft({ ...input, onComplete: metric => {
      metrics.push(metric); if (metric.outcome === 'usage-limit') { usageLimit = true; abort.abort(); }
    } });
    activeCalls.add(promise); void promise.finally(() => activeCalls.delete(promise)).catch(() => {});
    return promise;
  } });
  try {
    // Round order prevents three adjacent reads of one sheet from hiding time-dependent drift.
    const jobs = [1, 2, 3].flatMap(repeat => REPEATABILITY_FIXTURES.map((fixture, index) => ({ id: fixture.id, repeat, index,
      wishId: fixture.wishId, draft: fixture.draft, family: fixture.family, kitRevision: fixture.kitRevision })));
    for (const job of jobs) {
      abort.signal.throwIfAborted();
      const before = metrics.length, safetyIdentifier = hash(`forge-wish-${mode}:${job.id}`);
      const words = await providers.judgeWords({ words: fixedWish(job.wishId), safetyIdentifier, signal: abort.signal });
      const raw = await providers.judgeResult({ wish: fixedWish(job.wishId), draft: job.draft,
        contactSheet: images[job.index]!, safetyIdentifier, signal: abort.signal });
      // Finding sockets reads the native home only; nothing is drafted, assembled or rendered here.
      const home = createNativeForgeHost({ slot: 0, position: [0, 0, 0], rotation: 0, tier: 'house', style: job.family, variant: 0 }).blueprint;
      const sockets = findForgeSockets(home, 'street-home', job.kitRevision);
      const verdict = withForgeQuality(raw, forgeResultMeasure({ words: words.subject, result: raw.subject, draft: job.draft,
        styleKit: { family: job.family, revision: job.kitRevision }, sockets }));
      reads.push({ fixture: job.id, repeat: job.repeat, words: { outcome: words.outcome, subject: words.subject, records: words.records },
        outcome: verdict.outcome, subject: verdict.subject, measure: verdict.measure, quality: verdict.quality,
        ...(verdict.detailMatch ? { detailMatch: verdict.detailMatch } : {}),
        records: verdict.records, calls: metrics.length - before });
      await writeFile(join(resultDirectory, 'reads.json'), JSON.stringify(reads, null, 2), { mode: 0o600 });
    }
    ok = repeatabilityPass(reads);
    if (!ok) error = 'The fixed safety/quality repeatability bar did not pass.';
  } catch {
    error = usageLimit ? 'blocked: codex limit' : abort.signal.aborted ? 'The result-only run was interrupted.' : 'A result-only gate could not complete.';
  } finally {
    abort.abort(); clearTimeout(deadline); process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop);
    await Promise.allSettled([...activeCalls]);
    await writeFile(join(resultDirectory, 'calls.jsonl'), metrics.map(metric => JSON.stringify(metric)).join('\n') + '\n', { mode: 0o600 });
    const ids = REPEATABILITY_FIXTURES.map(fixture => fixture.id);
    const fixtureResults = ids.map(id => {
      const actual = reads.filter(read => read.fixture === id), scores = actual.map(read => read.quality?.score ?? null);
      return { id, count: actual.length, wordSafety: actual.map(read => read.words.outcome), safety: actual.map(read => read.outcome), scores,
        readings: actual.map(read => ({ words: read.words.subject ?? null, result: read.subject ?? null })),
        calls: actual.map(read => read.calls),
        recognition: actual.map(read => read.quality?.recognisability ?? null), detailMatches: actual.map(read => read.detailMatch ?? null),
        spread: scores.length === 3 && scores.every(score => score !== null) ? Math.max(...scores as number[]) - Math.min(...scores as number[]) : null };
    });
    const summary = { version: 1, ok, ...(error ? { error } : {}), ...(usageLimit ? { blocked: 'codex limit', at: new Date().toISOString() } : {}),
      policy: FORGE_JUDGE_POLICY_VERSION, mode, resultOnly: true, redrafts: 0, modelCalls: metrics.length,
      seconds: (performance.now() - began) / 1000, fixtures: fixtureResults };
    await writeFile(join(resultDirectory, 'summary.json'), JSON.stringify(summary, null, 2), { mode: 0o600 });
    console.info(JSON.stringify({ ...summary, resultDirectory }));
    if (!ok) process.exitCode = usageLimit ? 3 : 1;
  }
}
