import type { PanelSettings, PanelSettingsReading } from '../../../../packages/shared/src/panel';
import type { HelperBridge } from '../helper';
import { parsePanelSettings } from './schema';
import type { createConfigurationHelper } from './helper';

type ConfigHelper = ReturnType<typeof createConfigurationHelper>;
export type ConfigResult = { kind: 'saved'; reading: PanelSettingsReading } | { kind: 'conflict'; reading: PanelSettingsReading } | { kind: 'unavailable' | 'refused' | 'pending' | 'changed' };
function reading(value: unknown): PanelSettingsReading | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>, settings = parsePanelSettings(v.settings);
  return v.version === 1 && v.status === 'settings' && typeof v.revision === 'string' && typeof v.connected === 'boolean' && settings
    ? { version: 1, status: 'settings', revision: v.revision, connected: v.connected, settings } : null;
}
const same = (a: PanelSettings, b: PanelSettings) => JSON.stringify(parsePanelSettings(a)) === JSON.stringify(parsePanelSettings(b));
export function createConfigTransport(helper: HelperBridge, config: ConfigHelper, backend: string | null, fetcher: typeof fetch = fetch, timeout = 8000, requestTimeout = 5000) {
  let disposed = false;
  const controllers = new Set<AbortController>();
  const pendingEchoes = new Set<() => void>();
  const request = async (path: string, body: unknown): Promise<unknown> => {
    const token = helper.token(); if (!backend || !token || disposed) return null;
    const controller = new AbortController(); controllers.add(controller);
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
    finally { clearTimeout(timer!); controllers.delete(controller); }
  };
  const identity = () => ({ token: helper.token(), authorization: helper.authorization?.() });
  const changed = (before: ReturnType<typeof identity>) => disposed || helper.token() !== before.token || helper.authorization?.() !== before.authorization;
  return {
    async read() { const before = identity(); const result = await request('configuration', {}); return changed(before) ? null : reading(result); },
    async save(expectedRevision: string, settings: PanelSettings): Promise<ConfigResult> {
      const before = identity();
      const answer = await request('configure', { expectedRevision, settings });
      if (changed(before)) return { kind: 'changed' };
      const value = answer as Record<string, unknown> | null;
      if (value?.status === 'conflict') { const current = reading(value.current); return current ? { kind: 'conflict', reading: current } : { kind: 'unavailable' }; }
      if (value?.status === 'refused') return { kind: 'refused' };
      const saved = reading(answer);
      if (!saved || !same(saved.settings, settings)) return { kind: 'unavailable' };
      // A delayed write response must not replace a newer realm setting in Twitch.
      const latest = reading(await request('configuration', {}));
      if (changed(before)) return { kind: 'changed' };
      if (!latest) return { kind: 'pending' };
      if (latest.revision !== saved.revision || !same(latest.settings, saved.settings)) return { kind: 'conflict', reading: latest };
      if (!config.available) return { kind: 'pending' };
      return await new Promise<ConfigResult>(resolve => {
        let done = false, validating = false;
        const cancel = () => finish({ kind: 'changed' });
        const finish = (result: ConfigResult) => { if (done) return; done = true; pendingEchoes.delete(cancel); clearTimeout(timer); unsubscribe(); unwatch(); resolve(result); };
        const unsubscribe = config.subscribe(segment => {
          if (changed(before)) return finish({ kind: 'changed' });
          if (segment?.version !== '1') return;
          try {
            const parsed = parsePanelSettings(JSON.parse(segment.content));
            if (!parsed || !same(parsed, saved.settings) || validating) return;
            validating = true;
            void (async () => {
              const current = reading(await request('configuration', {}));
              if (changed(before)) return finish({ kind: 'changed' });
              if (!current) return finish({ kind: 'pending' });
              if (current.revision !== saved.revision || !same(current.settings, saved.settings)) return finish({ kind: 'conflict', reading: current });
              finish({ kind: 'saved', reading: current });
            })();
          } catch { /* wait for matching echo */ }
        });
        const unwatch = helper.subscribe(() => { if (changed(before)) finish({ kind: 'changed' }); });
        const timer = setTimeout(() => finish({ kind: 'pending' }), timeout);
        pendingEchoes.add(cancel);
        if (!config.set(JSON.stringify(saved.settings))) finish({ kind: 'pending' });
      });
    },
    dispose() { disposed = true; for (const controller of controllers) controller.abort(); for (const cancel of pendingEchoes) cancel(); },
  };
}
