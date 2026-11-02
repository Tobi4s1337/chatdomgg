import type { PostQuality } from '@chatdom/render';

/**
 * The quality a person may choose for the kingdom scene (play SEAMS A2 item 3: the ledger's setting).
 * It scales effects and distance only: the post stack's budgets (resolution, ambient occlusion, bloom, depth of
 * field), the water's reflection size and how fine far land is drawn. The palette, the light, the near voxel detail
 * and the dusk windows never change (E10).
 * `null` is automatic: the quality governor (quality-governor.ts) moves the automatic tier from the one the scene
 * opened with; the water also follows the canvas width.
 */
export type SceneQuality = 'high' | 'balanced' | 'low';
export const SCENE_QUALITIES: readonly SceneQuality[] = Object.freeze(['high', 'balanced', 'low']);

export interface SceneQualityBudget {
  readonly choice: SceneQuality | null;
  readonly post: Extract<PostQuality, SceneQuality>;
  readonly water: 'full' | 'reduced';
  /** Far land error in pixels for the hosted land (`null`: its own width-based default, 1.5 or 2). */
  readonly landDetail: number | null;
}
/**
 * Far land coarsens a step per tier: at 3 px level 1 starts at about 370 m on a 1080p stream instead of 740 m. These
 * are rendered pixels: the scene converts them to the drawing buffer when the post stack draws below canvas size.
 */
const LAND_DETAIL: Readonly<Record<SceneQuality, number | null>> = Object.freeze({ high: null, balanced: 2, low: 3 });

/** The automatic choice the scene opened with: narrow canvases (phones) start low. */
export function automaticSceneQuality(cssWidth: number): SceneQuality {
  return cssWidth < 600 ? 'low' : 'high';
}

export function isSceneQuality(value: unknown): value is SceneQuality {
  return typeof value === 'string' && (SCENE_QUALITIES as readonly string[]).includes(value);
}

/** What each layer draws at, given the person's choice, the automatic tier and today's canvas width. */
export function sceneQualityBudget(choice: SceneQuality | null, automatic: SceneQuality, cssWidth: number): SceneQualityBudget {
  if (choice !== null && !isSceneQuality(choice)) throw new Error(`Unknown scene quality: ${String(choice)}`);
  const tier = choice ?? automatic;
  return Object.freeze({ choice, post: tier,
    water: tier === 'low' || (choice === null && cssWidth < 600) ? 'reduced' : 'full', landDetail: LAND_DETAIL[tier] });
}
