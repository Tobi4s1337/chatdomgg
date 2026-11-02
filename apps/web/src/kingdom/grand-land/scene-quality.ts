import type { PostQuality } from '@chatdom/render';

/**
 * The quality a person may choose for the kingdom scene (play SEAMS A2 item 3: the ledger's setting).
 * It scales effects only: the post stack's budgets (resolution, ambient occlusion, bloom, depth of field) and the
 * water's reflection size. The palette, the light, the near voxel detail and the dusk windows never change (E10).
 * `null` is automatic: the post stack keeps the size picked when the scene opened and the water follows the
 * canvas width, exactly as before any choice existed.
 */
export type SceneQuality = 'high' | 'balanced' | 'low';
export const SCENE_QUALITIES: readonly SceneQuality[] = Object.freeze(['high', 'balanced', 'low']);

export interface SceneQualityBudget {
  readonly choice: SceneQuality | null;
  readonly post: Extract<PostQuality, SceneQuality>;
  readonly water: 'full' | 'reduced';
}

/** The automatic choice the scene opened with: narrow canvases (phones) start low. */
export function automaticSceneQuality(cssWidth: number): SceneQuality {
  return cssWidth < 600 ? 'low' : 'high';
}

export function isSceneQuality(value: unknown): value is SceneQuality {
  return typeof value === 'string' && (SCENE_QUALITIES as readonly string[]).includes(value);
}

/** What each layer draws at, given the person's choice, the quality picked at opening and today's canvas width. */
export function sceneQualityBudget(choice: SceneQuality | null, opened: SceneQuality, cssWidth: number): SceneQualityBudget {
  if (choice !== null && !isSceneQuality(choice)) throw new Error(`Unknown scene quality: ${String(choice)}`);
  return Object.freeze({ choice, post: choice ?? opened,
    water: choice === null ? (cssWidth < 600 ? 'reduced' : 'full') : choice === 'low' ? 'reduced' : 'full' });
}
