// Which hero a visitor gets: the live land at dusk, or its real captures. The front page must paint at once on every
// device, so the live scene is offered only where it can run smoothly beside the page, and every other visitor keeps
// the captured frames (which are the same land, from the same camera).

/** The land's quality tiers the hero may ask for (`apps/web/src/grand/engine.ts`). The hero never asks for ultra: it is
 * a background under a plate, and 'high' already renders at the full pixel budget. */
export type HeroTier = 'high' | 'medium' | 'low';
/** A capture on a software renderer asks for the land's own software tier: it draws once the land has settled. */
export type LandTier = HeroTier | 'software';

export type HeroPlan =
  | { readonly kind: 'live'; readonly tier: LandTier; readonly reason: string }
  | { readonly kind: 'still'; readonly reason: string };

/** What the page can learn about the device before it spends anything on 3D. */
export interface HeroEnvironment {
  /** The WebGL2 renderer's name (unmasked when the browser allows it), or null without WebGL2. */
  readonly renderer: string | null;
  readonly reducedMotion: boolean;
  /** The visitor asked to save data, or the connection is slow (2G or 3G class). */
  readonly saveData: boolean;
  /** `navigator.deviceMemory` in GB (Chromium only), or null when the browser does not say. */
  readonly memory: number | null;
  readonly cores: number | null;
  /** The main pointer is a finger. */
  readonly coarse: boolean;
  /** The shorter side of the screen, in CSS pixels. */
  readonly shortSide: number;
  /** A capture or a visitor's own choice ('live' or 'still'), read from session storage. */
  readonly override: 'live' | 'still' | null;
}

const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/i;
const STRONG = /rtx|radeon rx ?[5-9]\d{3}|radeon pro|apple m\d|arc a[57]\d{2}|quadro|geforce gtx 1[06-9]\d{2}|geforce gtx 16/i;
const DISCRETE = /nvidia|geforce|radeon|apple|arc/i;
const INTEGRATED = /intel|iris|uhd|adreno|mali|powervr|immortalis|xclipse/i;

/** The tier a renderer name suggests, before the device's own limits are applied. */
export function rendererTier(name: string): HeroTier | 'software' {
  if (SOFTWARE.test(name)) return 'software';
  if (STRONG.test(name)) return 'high';
  if (DISCRETE.test(name)) return 'high';
  if (INTEGRATED.test(name)) return 'medium';
  return 'low';
}

const STEP: Record<HeroTier, HeroTier | null> = { high: 'medium', medium: 'low', low: null };

/**
 * The plan for this visit. The live land needs WebGL2 on a real GPU, motion allowed, a connection that is not asked
 * to save data, at least four cores (the land is raised in workers) and four gigabytes where the browser says. Phones
 * and small tablets keep their own composed capture: raising a whole island costs a phone seconds of its battery for
 * a picture it already has. Tablets with a large screen go live one tier lower.
 */
export function chooseHeroPlan(env: HeroEnvironment): HeroPlan {
  if (env.override === 'still') return { kind: 'still', reason: 'asked for the still' };
  if (!env.renderer) return { kind: 'still', reason: 'no WebGL2' };
  const named = rendererTier(env.renderer);
  if (env.override === 'live') return { kind: 'live', tier: named, reason: 'asked for the live land' };
  if (named === 'software') return { kind: 'still', reason: 'software renderer' };
  if (env.reducedMotion) return { kind: 'still', reason: 'reduced motion' };
  if (env.saveData) return { kind: 'still', reason: 'saving data' };
  if (env.cores !== null && env.cores < 4) return { kind: 'still', reason: 'fewer than four cores' };
  if (env.memory !== null && env.memory < 4) return { kind: 'still', reason: 'less than 4 GB of memory' };
  if (env.coarse && env.shortSide < 768) return { kind: 'still', reason: 'phone' };
  let tier: HeroTier = named;
  if (env.coarse) tier = STEP[tier] ?? tier;
  if (env.memory !== null && env.memory < 8 && tier === 'high') tier = 'medium';
  return { kind: 'live', tier, reason: env.coarse ? 'large touch screen' : 'desktop' };
}

/** The next tier down, or null when the next step is the still. */
export function stepDown(tier: HeroTier): HeroTier | null { return STEP[tier]; }

/** Session storage key a capture (or a curious visitor, from the console) uses to choose the hero. */
export const HERO_CHOICE_KEY = 'chatdom:hero';

/** Reads the environment from the browser. Creates one throwaway WebGL2 context to read the renderer's name. */
export function readHeroEnvironment(): HeroEnvironment {
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean; effectiveType?: string } };
  let override: HeroEnvironment['override'] = null;
  try {
    const stored = sessionStorage.getItem(HERO_CHOICE_KEY);
    override = stored === 'live' || stored === 'still' ? stored : null;
  } catch { /* storage refused: no override */ }
  let renderer: string | null = null;
  try {
    // A browser drawing in software refuses a context that asks for no major performance caveat, so a software
    // renderer is known without waiting for one to start.
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: true, antialias: false, depth: false, stencil: false, powerPreference: 'high-performance' });
    if (gl) {
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      renderer = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    } else if (override === 'live') {
      // Only a capture asking for the live land waits for a software context to start, to tell software from none.
      const plain = document.createElement('canvas').getContext('webgl2');
      renderer = plain ? 'software (refused a context without a performance caveat)' : null;
      plain?.getExtension('WEBGL_lose_context')?.loseContext();
    } else if ('WebGL2RenderingContext' in window) renderer = 'software (refused a context without a performance caveat)';
  } catch { renderer = null; }
  const connection = nav.connection;
  return {
    renderer,
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    saveData: Boolean(connection?.saveData) || /(^|-)2g$|^3g$/.test(connection?.effectiveType ?? ''),
    memory: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null,
    cores: typeof nav.hardwareConcurrency === 'number' && nav.hardwareConcurrency > 0 ? nav.hardwareConcurrency : null,
    coarse: matchMedia('(pointer: coarse)').matches,
    shortSide: Math.min(screen.width || innerWidth, screen.height || innerHeight),
    override,
  };
}
