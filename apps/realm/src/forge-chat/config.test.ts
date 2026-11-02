import { chmod, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { forgeChatConfig } from './config';

const publicOrigin = 'https://chatdom.test';
const fixtureKey = Buffer.alloc(32, 9);
const cleanup: string[] = [];
afterEach(async () => { for (const path of cleanup.splice(0)) await rm(path, { recursive: true, force: true }); });
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'SIMULATED-forge-chat-key-')); cleanup.push(dir);
  const path = join(dir, 'key');
  await writeFile(path, fixtureKey.toString('base64') + '\n', { mode: 0o600 });
  const env = { FORGE_CHAT_ENABLED: '1', FORGE_CHAT_TOKEN_KEY_FILE: path,
    FORGE_CHAT_REDIRECT_URI: publicOrigin + '/api/realm/forge/chat/callback',
    TWITCH_CLIENT_ID: 'SIMULATED-client', TWITCH_CLIENT_SECRET: 'SIMULATED-secret' };
  return { dir, path, env };
}
describe('explicit separate Forge chat configuration', () => {
  it('accepts an explicit callback and an existing external mode-0600 base64 key', async () => {
    const { env } = await fixture();
    const config = await forgeChatConfig(publicOrigin, env);
    expect(config).toEqual({ clientId: env.TWITCH_CLIENT_ID, clientSecret: env.TWITCH_CLIENT_SECRET,
      redirectUri: env.FORGE_CHAT_REDIRECT_URI, tokenKey: fixtureKey });
  });
  it('never enables chat implicitly and never fills in missing credentials or key configuration', async () => {
    const { env } = await fixture();
    for (const name of ['FORGE_CHAT_ENABLED', 'FORGE_CHAT_REDIRECT_URI', 'FORGE_CHAT_TOKEN_KEY_FILE', 'TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET'] as const) {
      const incomplete: Record<string, string | undefined> = { ...env, [name]: undefined };
      expect(await forgeChatConfig(publicOrigin, incomplete)).toBeNull();
    }
    expect(await forgeChatConfig(publicOrigin, { ...env, FORGE_CHAT_ENABLED: 'true' })).toBeNull();
  });
  it('requires the exact public-origin callback rather than a caller-selected navigation target', async () => {
    const { env } = await fixture();
    for (const uri of ['https://foreign.test/api/realm/forge/chat/callback', publicOrigin + '/other',
      env.FORGE_CHAT_REDIRECT_URI + '?return=https://foreign.test', env.FORGE_CHAT_REDIRECT_URI + '#code']) {
      expect(await forgeChatConfig(publicOrigin, { ...env, FORGE_CHAT_REDIRECT_URI: uri })).toBeNull();
    }
    expect(await forgeChatConfig('http://chatdom.test', { ...env, FORGE_CHAT_REDIRECT_URI: 'http://chatdom.test/api/realm/forge/chat/callback' })).toBeNull();
  });
  it('permits an explicit loopback callback for local development', async () => {
    const { env } = await fixture(), localOrigin = 'http://127.0.0.1:5170';
    expect(await forgeChatConfig(localOrigin, { ...env, FORGE_CHAT_REDIRECT_URI: localOrigin + '/api/realm/forge/chat/callback' })).not.toBeNull();
  });
  it('rejects an exposed or malformed key and an absent file without generating one', async () => {
    const { env, path, dir } = await fixture();
    await chmod(path, 0o644); expect(await forgeChatConfig(publicOrigin, env)).toBeNull();
    await chmod(path, 0o600); await writeFile(path, 'SIMULATED not base64 key material');
    expect(await forgeChatConfig(publicOrigin, env)).toBeNull();
    await writeFile(path, Buffer.alloc(31).toString('base64')); expect(await forgeChatConfig(publicOrigin, env)).toBeNull();
    expect(await forgeChatConfig(publicOrigin, { ...env, FORGE_CHAT_TOKEN_KEY_FILE: join(dir, 'absent') })).toBeNull();
    expect(await forgeChatConfig(publicOrigin, { ...env, FORGE_CHAT_TOKEN_KEY_FILE: 'relative-key' })).toBeNull();
  });
  it('rejects a repository key even when reached through an external symlink', async () => {
    const repositoryDir = await mkdtemp(join(import.meta.dirname, '.SIMULATED-key-')); cleanup.push(repositoryDir);
    const repositoryKey = join(repositoryDir, 'key');
    await writeFile(repositoryKey, fixtureKey.toString('base64'), { mode: 0o600 });
    const { env, dir } = await fixture();
    expect(await forgeChatConfig(publicOrigin, { ...env, FORGE_CHAT_TOKEN_KEY_FILE: repositoryKey })).toBeNull();
    const link = join(dir, 'repository-link'); await symlink(repositoryKey, link);
    expect(await forgeChatConfig(publicOrigin, { ...env, FORGE_CHAT_TOKEN_KEY_FILE: link })).toBeNull();
  });
  it('does not mistake a checkout child beginning with two dots for an external path', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'SIMULATED-forge-workspace-')); cleanup.push(workspace);
    await writeFile(join(workspace, 'pnpm-workspace.yaml'), 'packages: []\n');
    const dir = await mkdtemp(join(workspace, '..SIMULATED-forge-key-'));
    const path = join(dir, 'key'); await writeFile(path, fixtureKey.toString('base64'), { mode: 0o600 });
    const { env } = await fixture();
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(workspace);
    try { expect(await forgeChatConfig(publicOrigin, { ...env, FORGE_CHAT_TOKEN_KEY_FILE: path })).toBeNull(); }
    finally { cwd.mockRestore(); }
  });
});
