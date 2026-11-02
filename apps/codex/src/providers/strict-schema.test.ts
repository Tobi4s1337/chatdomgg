import { describe, expect, it, vi } from 'vitest';
import { createForgeProviders } from './index';
import { forgeJudgeQuestions } from './policy';
import type { CodexDraftRunner } from './codex-cli';
import type { ForgeDraft, ForgeHouseSocket } from '../../../../packages/shared/src/index';

/**
 * The warm worker sends every schema as strict structured output, which refuses unsupported keywords with a 400
 * before the model runs. One such keyword (`uniqueItems` on the independent read's concerns) turned every escalated
 * safety read into a failed call and the wish cold. Every schema the Forge sends must stay inside the strict subset.
 */
const STRICT_KEYWORDS = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const', 'anyOf',
  'description', 'title', '$defs', 'definitions', '$ref', '$schema', 'minItems', 'maxItems', 'minimum', 'maximum',
  'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'pattern', 'format', 'default',
  // Accepted in practice: every warm draft call sends them and completes.
  'minLength', 'maxLength']);
// Keyword names whose values are maps of user-named entries, not schema keywords.
const NAMED = new Set(['properties', '$defs', 'definitions']);

function strictProblems(schema: unknown, path = '$'): string[] {
  if (Array.isArray(schema)) return schema.flatMap((item, index) => strictProblems(item, `${path}[${index}]`));
  if (!schema || typeof schema !== 'object') return [];
  const node = schema as Record<string, unknown>, problems: string[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (!STRICT_KEYWORDS.has(key)) problems.push(`${path}.${key} is not a strict keyword`);
    if (NAMED.has(key) && value && typeof value === 'object') {
      for (const [name, child] of Object.entries(value)) problems.push(...strictProblems(child, `${path}.${key}.${name}`));
    } else if (key === 'items' || key === 'anyOf' || key === 'additionalProperties') problems.push(...strictProblems(value, `${path}.${key}`));
  }
  if (node.type === 'object' || node.properties) {
    if (node.additionalProperties !== false) problems.push(`${path} must set additionalProperties: false`);
    const keys = Object.keys((node.properties as Record<string, unknown> | undefined) ?? {}).sort();
    const required = [...((node.required as string[] | undefined) ?? [])].sort();
    if (JSON.stringify(keys) !== JSON.stringify(required)) problems.push(`${path} must require every property`);
  }
  return problems;
}

const draft: ForgeDraft = { plan: { version: 2, kind: 'chimney', motif: 'sleeping-dragon', finish: 'copper', accent: 'scales' }, title: 'The Dozing Ember', plaque: 'A little dragon keeps the hearth warm.' };
const socket: ForgeHouseSocket = { id: 'stack', kind: 'chimney', profile: 'stack', origin: [0, 0, 0], supports: [[0, 0, 0]], hostId: 'home', hostFingerprint: 'hash', clearanceHeight: 8 };
const sheet = 'data:image/png;base64,iVBORw0KGgo=';
const subject = { motif: 'sleeping-dragon', slot: 'chimney' };

describe('strict structured-output schemas', () => {
  it('flags the keyword that broke the escalated read', () => {
    expect(strictProblems({ type: 'object', additionalProperties: false, required: ['a'], properties: { a: { type: 'array', uniqueItems: true, items: { type: 'string' } } } }))
      .toEqual(['$.properties.a.uniqueItems is not a strict keyword']);
  });

  it('keeps every schema the Forge sends, including both escalated reads, inside the strict subset', async () => {
    const schemas = new Map<string, unknown>();
    const runCodex = vi.fn<CodexDraftRunner>(async ({ model, schema, image }) => {
      const role = !model ? 'draft' : `${model}${image ? ':result' : ':words'}`;
      schemas.set(`${role}:${schemas.size}`, schema);
      // An unsure first read, so the independent second read is always asked for.
      if (model === 'gpt-6-luna') return JSON.stringify({ answers: forgeJudgeQuestions(Boolean(image)).map(({ name }) => ({ type: 'predicate', name, probability: 0.4 })), subject });
      if (model) return JSON.stringify({ outcome: 'pass', concerns: [], subject });
      return JSON.stringify(schemas.size % 2 ? draft : { draft, interpretation: 'as-wished', shared: 'subject' });
    });
    const providers = createForgeProviders({ runCodex });
    await providers.judgeWords({ words: 'A sleeping dragon chimney.', safetyIdentifier: 'sha256_citizen_1234567890' });
    await providers.judgeResult({ wish: 'A sleeping dragon chimney.', draft, contactSheet: sheet, safetyIdentifier: 'sha256_citizen_1234567890' });
    await providers.draft({ words: 'A sleeping dragon chimney.', family: 'hearth', availableSockets: [socket] }).catch(() => undefined);
    await providers.draftCandidate!({ words: 'A sleeping dragon chimney.', family: 'hearth', availableSockets: [socket] }).catch(() => undefined);
    const roles = [...schemas.keys()].map(key => key.split(':').slice(0, -1).join(':'));
    expect(roles).toEqual(expect.arrayContaining(['gpt-6-luna:words', 'gpt-6.1-terra:words', 'gpt-6-luna:result', 'gpt-6.1-terra:result', 'draft']));
    expect(roles.filter(role => role === 'draft')).toHaveLength(2);
    for (const [role, schema] of schemas) expect({ role, problems: strictProblems(schema) }).toEqual({ role, problems: [] });
  });
});
