import { createForgeStage, type ForgePresentation, type ForgePresentationOptions, type StageEnvironment } from './stage';

export type { ForgePresentation, ForgePresentationOptions } from './stage';

function deviceEnvironment(): StageEnvironment {
  const media = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia.bind(window) : null;
  const motion = media?.('(prefers-reduced-motion: reduce)') ?? null;
  return {
    reducedMotion: () => motion?.matches ?? false,
    subscribe(listener) {
      motion?.addEventListener('change', listener);
      return () => motion?.removeEventListener('change', listener);
    },
    phone: media?.('(max-width: 640px), (pointer: coarse)').matches ?? false,
  };
}

/**
 * The Forge ritual's visual layer around a host-owned presentation clone. It renders exactly the supplied
 * frame; it never advances a phase, attaches the part or enables permanent emitters.
 */
export function createForgePresentation(options: ForgePresentationOptions): ForgePresentation {
  return createForgeStage(options, deviceEnvironment());
}
