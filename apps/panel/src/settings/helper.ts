import { connectHelper } from '../helper';

interface Configuration {
  broadcaster?: { version: string; content: string } | undefined;
  onChanged(callback: () => void): void;
  set(segment: 'broadcaster', version: string, content: string): void;
}

/** One callback per page; Twitch does not expose an unsubscribe for this callback. */
let singleton: ReturnType<typeof createConfigurationHelper> | undefined;
export function createConfigurationHelper(configuration: Configuration | undefined) {
  const listeners = new Set<(segment: { version: string; content: string } | undefined) => void>();
  configuration?.onChanged(() => { for (const listener of listeners) listener(configuration.broadcaster); });
  return {
    available: !!configuration,
    subscribe(listener: (segment: { version: string; content: string } | undefined) => void) { listeners.add(listener); return () => listeners.delete(listener); },
    set(content: string) { if (!configuration) return false; try { configuration.set('broadcaster', '1', content); return true; } catch { return false; } },
  };
}
export function connectConfiguration() {
  connectHelper();
  singleton ??= createConfigurationHelper((globalThis as { Twitch?: { ext?: { configuration?: Configuration } } }).Twitch?.ext?.configuration);
  return singleton;
}
