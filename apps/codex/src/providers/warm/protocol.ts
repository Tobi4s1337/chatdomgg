import type { CodexDraftFailure } from '../codex-cli';

/**
 * The slice of the `codex app-server` protocol the warm runner speaks. Field names were checked against
 * `codex app-server generate-ts` for CLI 0.166.0 (v2 ThreadStartParams, TurnStartParams, UserInput,
 * SandboxPolicy, ItemCompletedNotification, ThreadTokenUsageUpdatedNotification, TurnCompletedNotification,
 * ErrorNotification, CodexErrorInfo and the ServerRequest union). Messages are newline-delimited JSON-RPC
 * objects without the `jsonrpc` header.
 */
export const WARM_CLI_VERSION = '0.166.0';

export type RequestId = string | number;

export interface RpcMessage {
  id?: RequestId;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: unknown; message?: unknown };
}

export type UserInput =
  | { type: 'text'; text: string; text_elements: [] }
  | { type: 'localImage'; path: string };

/** Disabled for the whole server process; mirrors the cold provider's `--disable` list. */
export const DISABLED_FEATURES = ['shell_tool', 'unified_exec', 'shell_snapshot', 'apps', 'plugins', 'remote_plugin',
  'multi_agent', 'browser_use', 'browser_use_external', 'computer_use', 'image_generation',
  'code_mode', 'code_mode_host', 'memories', 'hooks', 'skill_search'] as const;

/**
 * Notifications the runner never reads. Opting out keeps the shared stdout stream small; everything the
 * runner does read (turn and item completion, usage, errors) stays subscribed.
 */
export const QUIET_NOTIFICATIONS = ['thread/started', 'thread/status/changed', 'remoteControl/status/changed',
  'item/started', 'item/agentMessage/delta', 'item/plan/delta', 'item/reasoning/summaryTextDelta',
  'item/reasoning/summaryPartAdded', 'item/reasoning/textDelta', 'turn/diff/updated', 'turn/plan/updated',
  'account/rateLimits/updated', 'skills/changed', 'mcpServer/startupStatus/updated'];

const DENIED = 'Tools are not available in the Forge.';

/**
 * Every request the server can make of a client is a request for a tool, an approval, credentials or
 * user input. The Forge grants none of them: approvals are declined with the protocol's own denial
 * shape and everything else is answered with a JSON-RPC error.
 */
export function serverRequestDenial(method: string): { result: unknown } | { error: { code: number; message: string } } {
  switch (method) {
    case 'item/commandExecution/requestApproval':
    case 'item/fileChange/requestApproval':
      return { result: { decision: 'decline' } };
    case 'execCommandApproval':
    case 'applyPatchApproval':
      return { result: { decision: { denied: { rejection: DENIED } } } };
    case 'item/permissions/requestApproval':
      // An empty profile grants nothing beyond the turn's read-only, network-free sandbox.
      return { result: { permissions: {}, scope: 'turn' } };
    case 'mcpServer/elicitation/request':
      return { result: { action: 'decline', content: null, _meta: null } };
    case 'item/tool/call':
      return { result: { contentItems: [], success: false } };
    default:
      return { error: { code: -32601, message: DENIED } };
  }
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

export const readRecord = record;

export function readId(value: unknown, key: 'thread' | 'turn'): string | undefined {
  const id = record(record(value)?.[key])?.id;
  return typeof id === 'string' && id.length > 0 && id.length <= 256 ? id : undefined;
}

const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;

/** Reported counts only: a missing or malformed field stays absent rather than being inferred. */
export function readUsage(params: unknown): { totalTokens?: number; inputTokens?: number; outputTokens?: number } | undefined {
  const total = record(record(record(params)?.tokenUsage)?.total);
  if (!total) return undefined;
  const usage: { totalTokens?: number; inputTokens?: number; outputTokens?: number } = {};
  const totalTokens = count(total.totalTokens);
  const inputTokens = count(total.inputTokens);
  const outputTokens = count(total.outputTokens);
  if (totalTokens !== undefined) usage.totalTokens = totalTokens;
  if (inputTokens !== undefined) usage.inputTokens = inputTokens;
  if (outputTokens !== undefined) usage.outputTokens = outputTokens;
  return Object.keys(usage).length ? usage : undefined;
}

export interface TurnErrorClass {
  usageLimit: boolean;
  failure: CodexDraftFailure;
}

const USAGE_TEXT = /\b(?:you(?:'ve| have) (?:hit|reached) your usage limit|(?:usage|rate) limit (?:reached|exceeded)|too many requests|usage_limit_reached|rate_limit_exceeded|rate_limit_reached)\b/i;

/** Classify a `TurnError` by its structured `codexErrorInfo`, falling back to the message text. */
export function classifyTurnError(error: unknown): TurnErrorClass {
  const turnError = record(error);
  const info = turnError?.codexErrorInfo;
  const message = typeof turnError?.message === 'string' ? turnError.message : '';
  let variant: string | undefined;
  let status: number | undefined;
  if (typeof info === 'string') variant = info;
  else {
    const entry = record(info);
    const key = entry ? Object.keys(entry)[0] : undefined;
    if (entry && key) {
      variant = key;
      const code = record(entry[key])?.httpStatusCode;
      if (typeof code === 'number') status = code;
    }
  }
  if (variant === 'usageLimitExceeded' || variant === 'rateLimitExceeded' || status === 429 || USAGE_TEXT.test(message)) {
    return { usageLimit: true, failure: 'unknown' };
  }
  if (variant === 'unauthorized' || status === 401 || status === 403) return { usageLimit: false, failure: 'authentication' };
  if (variant === 'modelNotFound') return { usageLimit: false, failure: 'model-unavailable' };
  if (variant === 'badRequest') return { usageLimit: false, failure: 'configuration' };
  if (variant === 'serverOverloaded' || variant === 'internalServerError' || variant === 'httpConnectionFailed'
    || variant === 'responseStreamConnectionFailed' || variant === 'responseStreamDisconnected'
    || variant === 'responseTooManyFailedAttempts' || (status !== undefined && status >= 500)) {
    return { usageLimit: false, failure: 'transport' };
  }
  return { usageLimit: false, failure: 'unknown' };
}
