import type { PanelSettings, PanelSettingsReading } from '../../../../packages/shared/src/panel';
import type { HelperBridge } from '../helper';
import { parsePanelSettings } from './schema';
export type ConfigResult = { kind: 'saved'; reading: PanelSettingsReading } | { kind: 'conflict'; reading: PanelSettingsReading } | { kind: 'pending'; reading: PanelSettingsReading } | { kind: 'unavailable' | 'refused' | 'changed' };
function reading(value: unknown): PanelSettingsReading | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>, settings = parsePanelSettings(v.settings);
  return v.version === 1 && v.status === 'settings' && typeof v.revision === 'string' && /^(0|[1-9][0-9]{0,18})$/.test(v.revision) && BigInt(v.revision) <= 9_223_372_036_854_775_807n && typeof v.connected === 'boolean' && settings
    ? { version: 1, status: 'settings', revision: v.revision, connected: v.connected, settings } : null;
}
const same = (a: PanelSettings, b: PanelSettings) => JSON.stringify(parsePanelSettings(a)) === JSON.stringify(parsePanelSettings(b));
export function createConfigTransport(helper: HelperBridge, backend: string | null, fetcher: typeof fetch = fetch, timeout = 8000, requestTimeout = 5000) {
  let disposed = false;
  const controllers = new Set<AbortController>();
  const cancellations = new Set<() => void>();
  const request = async (path: string, body: unknown): Promise<unknown> => {
    const token = helper.token(); if (!backend || !token || disposed) return null;
    const controller = new AbortController(); controllers.add(controller);
    const before = identity();
    const unsubscribe = helper.subscribe(() => { if (changed(before)) controller.abort(); });
    let timer: ReturnType<typeof setTimeout>;
    const abort = new Promise<null>(resolve => {
      controller.signal.addEventListener('abort', () => resolve(null), { once: true });
      timer = setTimeout(() => controller.abort(), requestTimeout);
    });
    const work = async (): Promise<unknown> => {
      try {
        const response = await fetcher(`${backend}/api/panel/v1/${path}`, { method: 'POST', signal: controller.signal, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
        if (!response.ok) return { status: response.status === 403 || response.status === 401 ? 'refused' : 'unavailable' };
        const declared = response.headers.get('content-length');
        if (declared && Number(declared) > 16384) return null;
        if (!response.body) return null;
        const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
        for (;;) {
          const part = await reader.read(); if (part.done) break;
          size += part.value.byteLength; if (size > 16384) { void reader.cancel(); return null; }
          chunks.push(part.value);
        }
        const bytes = new Uint8Array(size); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        return JSON.parse(new TextDecoder().decode(bytes));
      } catch { return null; }
    };
    try { return await Promise.race([work(), abort]); }
    finally { clearTimeout(timer!); controllers.delete(controller); unsubscribe(); }
  };
  const identity = () => ({ token: helper.token(), authorization: helper.authorization?.() });
  const changed = (before: ReturnType<typeof identity>) => disposed || helper.token() !== before.token || helper.authorization?.() !== before.authorization;
  const sync = async () => {
    const value = await request('configuration-sync', {});
    if (!value || typeof value !== 'object') return null;
    const v = value as Record<string, unknown>, current = reading(v.reading);
    if (v.version !== 1 || v.status !== 'sync' || !current || (v.publication !== 'pending' && v.publication !== 'verified') || !(v.verifiedAt === null || (typeof v.verifiedAt === 'number' && Number.isSafeInteger(v.verifiedAt) && v.verifiedAt >= 0 && v.verifiedAt <= Date.now() + 300_000))) return null;
    if (v.publication === 'verified' && v.verifiedAt === null) return null;
    return { reading: current, publication: v.publication, verifiedAt: v.verifiedAt } as const;
  };
  const matches = (a: PanelSettingsReading, b: PanelSettingsReading) => a.revision === b.revision && a.connected === b.connected && same(a.settings, b.settings);
  const retrySync = async (wanted: PanelSettingsReading): Promise<ConfigResult> => {
    const before = identity(), deadline = Date.now() + timeout;
    for (;;) {
      const result = await sync();
      if (changed(before)) return { kind: 'changed' };
      if (result && !matches(result.reading, wanted)) return { kind: 'conflict', reading: result.reading };
      if (result?.publication === 'verified') return { kind: 'saved', reading: result.reading };
      const remaining = deadline - Date.now();
      if (remaining <= 0 || !result) return { kind: 'pending', reading: wanted };
      await new Promise<void>(resolve => {
        const finish = () => { clearTimeout(timer); unsubscribe(); cancellations.delete(finish); resolve(); };
        const timer = setTimeout(finish, Math.min(500, remaining));
        const unsubscribe = helper.subscribe(() => { if (changed(before)) finish(); });
        cancellations.add(finish);
      });
      if (changed(before)) return { kind: 'changed' };
    }
  };
  return {
    async read() { const before = identity(); const result = await request('configuration', {}); return changed(before) ? null : reading(result); },
    async readSync() { const before = identity(); const result = await sync(); return changed(before) ? null : result; },
    retrySync,
    async save(expectedRevision: string, settings: PanelSettings): Promise<ConfigResult> {
      const before = identity();
      const answer = await request('configure', { expectedRevision, settings });
      if (changed(before)) return { kind: 'changed' };
      const value = answer as Record<string, unknown> | null;
      if (value?.status === 'conflict') { const current = reading(value.current); return current ? { kind: 'conflict', reading: current } : { kind: 'unavailable' }; }
      if (value?.status === 'refused') return { kind: 'refused' };
      const saved = reading(answer);
      if (!saved || !same(saved.settings, settings)) return { kind: 'unavailable' };
      return retrySync(saved);
    },
    dispose() { disposed = true; for (const controller of controllers) controller.abort(); for (const cancel of cancellations) cancel(); },
  };
}
