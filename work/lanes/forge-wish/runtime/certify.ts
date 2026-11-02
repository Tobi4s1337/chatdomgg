import { randomUUID } from 'node:crypto';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { assembleForge, createNativeForgeHost, findForgeSockets, forgeStyleKit } from '../../../../packages/forge/src';
import { renderForgeCertificationSheet } from '../../../../apps/codex/src/contact-sheet';
import { runCodexDraft, type CodexDraftCompletion } from '../../../../apps/codex/src/providers/codex-cli';
import { FORGE_CERTIFICATE_ANSWERS, FORGE_CERTIFICATE_FAMILIES, FORGE_CERTIFICATE_POLICY, FORGE_CERTIFICATE_PROMPT,
  FORGE_CERTIFICATE_ROUNDS, forgeCertificateDraft, forgeCertificateOrder, forgeCertificateSchema, forgeCertificateTiles,
  gradeForgeCertificate, readForgeCertificateAnswers } from '../../../../apps/codex/src/certificates/protocol';
import { forgeCertificateGeometry } from '../../../../apps/codex/src/certificates/geometry';

const root = '/tmp/chatdom-forge-wish';
/** Blind certification of one kit revision: 3 families × 3 rounds, one sheet per read, no text but tile numbers. */
export async function certifyKit(revision: number, evidenceDirectory?: string): Promise<void> {
  if (revision !== 1 && revision !== 2) throw new Error('Certify kit revision 1 or 2.');
  const directory = join(root, `certify-${revision}-${randomUUID()}`);
  await mkdir(directory, { recursive: true, mode: 0o700 }); await chmod(directory, 0o700);
  const tiles = forgeCertificateTiles(), metrics: CodexDraftCompletion[] = [];
  const counts: Record<string, Record<string, { correct: number; rounds: number; geometry: string; answers: string[] }>> = {};
  const abort = new AbortController(); let usageLimit = false, failed = 0;
  const stop = () => abort.abort(); process.once('SIGTERM', stop); process.once('SIGINT', stop);
  const deadline = setTimeout(stop, 9 * 60_000);
  try {
    for (const family of FORGE_CERTIFICATE_FAMILIES) {
      const home = createNativeForgeHost({ slot: 0, position: [0, 0, 0], rotation: 0, tier: 'house', style: family, variant: 0 }).blueprint;
      const kit = forgeStyleKit(family, revision), sockets = findForgeSockets(home, 'street-home', revision);
      const pieces = tiles.map(tile => {
        const socket = sockets.find(socket => socket.kind === tile.kind);
        if (!socket) throw new Error(`The ${family} certification home lacks a ${tile.kind} socket.`);
        // Likeness only: fit on this particular home is checked per wish, not here.
        const made = assembleForge(forgeCertificateDraft(tile).plan, kit, socket);
        return made.blueprint;
      });
      const entry = counts[`${family}-native@${revision}`] = {} as (typeof counts)[string];
      // The digest binds each count to the exact geometry drawn on this run's sheets.
      const geometry = forgeCertificateGeometry(family, revision);
      for (const tile of tiles) entry[`${tile.motif}/${tile.finish}`] = { correct: 0, rounds: FORGE_CERTIFICATE_ROUNDS,
        geometry: geometry.get(`${tile.motif}/${tile.finish}`)!, answers: [] };
      for (let round = 1; round <= FORGE_CERTIFICATE_ROUNDS; round++) {
        abort.signal.throwIfAborted();
        if (usageLimit) throw new Error('blocked: codex limit');
        const order = forgeCertificateOrder(family, round, tiles.length);
        const sheet = renderForgeCertificationSheet(order.map(index => pieces[index]!));
        const bytes = Buffer.from(sheet.split(',')[1]!, 'base64');
        await writeFile(join(directory, `${family}-r${round}.png`), bytes, { mode: 0o600 });
        if (evidenceDirectory && round === 1) await writeFile(join(evidenceDirectory, `kit${revision}-${family}-blind-sheet.png`), bytes);
        let raw = '';
        try {
          raw = await runCodexDraft({ prompt: FORGE_CERTIFICATE_PROMPT, schema: forgeCertificateSchema(tiles.length), model: 'gpt-6.1-terra',
            effort: 'high', image: sheet, signal: AbortSignal.any([abort.signal, AbortSignal.timeout(150_000)]),
            onComplete: metric => { metrics.push(metric); if (metric.outcome === 'usage-limit') { usageLimit = true; abort.abort(); } } });
        } catch { if (usageLimit) throw new Error('blocked: codex limit'); }
        const answers = readForgeCertificateAnswers(raw, tiles.length);
        if (!answers) failed++;
        order.forEach((tileIndex, position) => {
          const tile = tiles[tileIndex]!, record = entry[`${tile.motif}/${tile.finish}`]!, answer = answers?.[position] ?? 'failed-read';
          record.answers.push(answer);
          if (answer === FORGE_CERTIFICATE_ANSWERS[tile.motif]) record.correct++;
        });
        await writeFile(join(directory, 'counts.json'), JSON.stringify(counts, null, 2), { mode: 0o600 });
      }
    }
  } finally {
    clearTimeout(deadline); process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop);
    await writeFile(join(directory, 'calls.jsonl'), metrics.map(metric => JSON.stringify(metric)).join('\n') + '\n', { mode: 0o600 });
    const grades = Object.fromEntries(Object.entries(counts).map(([kit, entries]) => [kit, Object.fromEntries(Object.entries(entries)
      .map(([key, value]) => [key, { correct: value.correct, rounds: value.rounds, geometry: value.geometry, grade: gradeForgeCertificate(value.correct), answers: value.answers }]))]));
    const summary = { policy: FORGE_CERTIFICATE_POLICY, revision, modelCalls: metrics.length, failedReads: failed,
      seconds: metrics.reduce((sum, metric) => sum + metric.elapsedMs, 0) / 1000,
      tokens: metrics.reduce((sum, metric) => sum + (metric.usage?.totalTokens ?? 0), 0), ...(usageLimit ? { blocked: 'codex limit', at: new Date().toISOString() } : {}), grades };
    await writeFile(join(directory, 'summary.json'), JSON.stringify(summary, null, 2), { mode: 0o600 });
    console.info(JSON.stringify({ directory, ...summary }));
  }
}
