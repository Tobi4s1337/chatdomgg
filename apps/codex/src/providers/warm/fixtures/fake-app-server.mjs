// SIMULATED app-server for tests: speaks the newline-delimited JSON-RPC subset the warm runner uses.
// No model, network or credentials are involved. argv[2] selects a start-up mode; each turn's prompt
// selects its behaviour (ANSWER:<text>, SLOW:<ms>, WAIT, TOOL, CRASH, LIMIT, BIG, IMAGE, STATS).
import { existsSync, statSync } from 'node:fs';

const mode = process.argv[2] ?? 'normal';
if (mode === 'exit-at-start') process.exit(3);

const stats = { initialized: false, threads: 0, unsubscribes: 0, interrupts: 0, active: 0, maxActive: 0, threadParams: [], turnParams: [] };
const turns = new Map();
const serverRequests = new Map();
let nextServerRequest = 1;
let buffer = '';

const send = message => process.stdout.write(`${JSON.stringify(message)}\n`);
const notify = (method, params) => send({ method, params });

function complete(threadId, turnId, status, extra = {}) {
  const turn = turns.get(turnId);
  if (!turn || turn.done) return;
  turn.done = true;
  stats.active--;
  notify('turn/completed', { threadId, turn: { id: turnId, rootTurnId: turnId, items: [], itemsView: 'notLoaded', status, error: null, startedAt: 1, completedAt: 2, durationMs: 1, ...extra } });
}

function answer(threadId, turnId, text, usage = { totalTokens: 120, inputTokens: 100, cachedInputTokens: 40, cacheWriteInputTokens: 0, outputTokens: 20, reasoningOutputTokens: 5 }) {
  notify('item/completed', { threadId, turnId, completedAtMs: 1, item: { type: 'agentMessage', id: 'msg', text, phase: 'final_answer', memoryCitation: null, delivery: null, questions: null } });
  notify('thread/tokenUsage/updated', { threadId, turnId, tokenUsage: { total: usage, last: usage, modelContextWindow: null } });
  complete(threadId, turnId, 'completed');
}

function ask(method, params) {
  const id = `srv-${nextServerRequest++}`;
  send({ id, method, params });
  return new Promise(resolve => serverRequests.set(id, resolve));
}

async function runTurn(threadId, turnId, params) {
  const text = params.input.find(item => item.type === 'text')?.text ?? '';
  if (text.startsWith('ANSWER:')) return answer(threadId, turnId, JSON.stringify({ answer: text.slice(7) }));
  if (text.startsWith('SLOW:')) {
    setTimeout(() => answer(threadId, turnId, JSON.stringify({ answer: 'slow', maxActive: stats.maxActive })), Number(text.slice(5)));
    return;
  }
  if (text === 'WAIT') return; // completes only when interrupted
  if (text === 'CRASH') { setTimeout(() => process.exit(9), 20); return; }
  if (text === 'LIMIT') {
    notify('error', { threadId, turnId, willRetry: false, error: { message: 'SIMULATED limit', codexErrorInfo: 'usageLimitExceeded', additionalDetails: null, misalignment: null } });
    return; // the runner must interrupt
  }
  if (text === 'FAIL401') {
    return complete(threadId, turnId, 'failed', { error: { message: 'SIMULATED unauthorized', codexErrorInfo: { httpConnectionFailed: { httpStatusCode: 401 } }, additionalDetails: null, misalignment: null } });
  }
  if (text === 'BIG') return answer(threadId, turnId, 'x'.repeat(300 * 1024));
  if (text === 'IMAGE') {
    const image = params.input.find(item => item.type === 'localImage');
    const info = image && existsSync(image.path) ? statSync(image.path) : undefined;
    return answer(threadId, turnId, JSON.stringify({ path: image?.path ?? null, mode: info ? (info.mode & 0o777).toString(8) : null }));
  }
  if (text === 'TOOL') {
    const replies = {};
    for (const method of ['item/commandExecution/requestApproval', 'item/fileChange/requestApproval', 'execCommandApproval',
      'applyPatchApproval', 'item/permissions/requestApproval', 'mcpServer/elicitation/request', 'item/tool/call',
      'item/tool/requestUserInput', 'account/chatgptAuthTokens/refresh']) {
      replies[method] = await ask(method, { threadId, turnId });
    }
    return answer(threadId, turnId, JSON.stringify(replies));
  }
  if (text === 'STATS') return answer(threadId, turnId, JSON.stringify(stats));
  answer(threadId, turnId, JSON.stringify({ answer: 'ok' }));
}

function handle(message) {
  const { id, method, params } = message;
  if (method === undefined) {
    const resolve = serverRequests.get(id);
    serverRequests.delete(id);
    resolve?.(message.error ? { error: true } : message.result);
    return;
  }
  switch (method) {
    case 'initialize':
      if (mode === 'garbage') { process.stdout.write('this is not json\n'); return; }
      send({ id, result: { userAgent: 'SIMULATED/0.166.0', codexHome: process.env.CODEX_HOME ?? '', platformFamily: 'unix', platformOs: 'linux' } });
      return;
    case 'initialized':
      stats.initialized = true;
      return;
    case 'thread/start': {
      if (mode === 'exit-at-thread') process.exit(4);
      if (mode === 'reject-thread') { send({ id, error: { code: -32600, message: 'SIMULATED rejection' } }); return; }
      stats.threads++;
      stats.threadParams.push(params);
      send({ id, result: { thread: { id: `thread-${stats.threads}`, ephemeral: true } } });
      return;
    }
    case 'turn/start': {
      const turnId = `turn-${params.threadId}`;
      stats.turnParams.push({ ...params, input: params.input.map(item => item.type) });
      stats.active++;
      stats.maxActive = Math.max(stats.maxActive, stats.active);
      turns.set(turnId, { done: false });
      send({ id, result: { turn: { id: turnId, status: 'inProgress', items: [], error: null } } });
      notify('turn/started', { threadId: params.threadId, turn: { id: turnId, status: 'inProgress', items: [], error: null } });
      void runTurn(params.threadId, turnId, params);
      return;
    }
    case 'turn/interrupt':
      stats.interrupts++;
      send({ id, result: {} });
      complete(params.threadId, params.turnId, 'interrupted');
      return;
    case 'thread/unsubscribe':
      stats.unsubscribes++;
      send({ id, result: { status: 'unsubscribed' } });
      return;
    default:
      send({ id, error: { code: -32601, message: 'SIMULATED unknown method' } });
  }
}

process.stdin.on('data', chunk => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (line.trim()) handle(JSON.parse(line));
  }
});
process.stdin.on('end', () => process.exit(0));
