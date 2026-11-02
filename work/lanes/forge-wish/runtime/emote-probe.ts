/**
 * Private diagnostic: run only the word gate for chosen fixture wishes on the warm worker and keep the app-server's
 * turn errors (never the wish words) in a private file. node emote-probe.mjs <fixture id>...
 */
import { spawn as nodeSpawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { createForgeProviders } from '../../../../apps/codex/src/providers';
import { createWarmCodexRunner, type WarmSpawn } from '../../../../apps/codex/src/providers/warm';
import { FW11_WISHES } from '../../../../apps/codex/src/fixtures/fw11-wishes';

const out = process.argv[2]!, ids = process.argv.slice(3);
const note = (value: unknown) => appendFileSync(join(out, 'probe.jsonl'), JSON.stringify(value) + '\n', { mode: 0o600 });
const spawn: WarmSpawn = (command, args, options) => {
  const child = nodeSpawn(command, args, { ...options, stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = '';
  child.stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    for (let index = buffer.indexOf('\n'); index >= 0; index = buffer.indexOf('\n')) {
      const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
      try {
        const message = JSON.parse(line) as { method?: string; params?: Record<string, unknown>; error?: unknown };
        if (message.method === 'error' || message.error) note({ kind: 'error', method: message.method ?? null, params: message.params ?? null, error: message.error ?? null });
        if (message.method === 'turn/completed') {
          const turn = message.params?.turn as { status?: string; error?: unknown } | undefined;
          note({ kind: 'turn', status: turn?.status ?? null, error: turn?.error ?? null });
        }
      } catch { /* not a protocol line */ }
    }
  });
  return child;
};
const warm = createWarmCodexRunner({ stateDirectory: join(out, 'warm'), spawn, maxConcurrent: 2 });
const providers = createForgeProviders({ runCodex: input => warm({ ...input, onComplete: metric => note({ kind: 'metric', model: metric.model,
  outcome: metric.outcome, failure: metric.failure ?? null, ms: Math.round(metric.elapsedMs) }) }) });
for (const id of ids) {
  const wish = FW11_WISHES.find(item => item.id === id)!;
  note({ kind: 'wish', id });
  try {
    const verdict = await providers.judgeWords({ words: wish.words, safetyIdentifier: 'forge-wish-probe', signal: AbortSignal.timeout(120_000) });
    note({ kind: 'verdict', id, outcome: verdict.outcome, subject: verdict.subject ?? null });
  } catch (error) { note({ kind: 'thrown', id, name: error instanceof Error ? error.name : 'unknown' }); }
}
await warm.close();
