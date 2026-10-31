// Browser side of spec 37: the look selector, the request session, the carved prompt and the one controller that
// binds them to a kingdom view. The integrator mounts the controller from the kingdom scene (README); the bench at
// ./bench/index.html runs it against the real room authority.
export { KEEP_CONE, KEEP_SLACK, LOOK_CONE, PICK_RADIUS, assessTarget, pickInteraction, selectInteraction, viewAlignment, type InteractionCandidate, type InteractionHold, type InteractionPick, type InteractionQuiet, type InteractionSelection, type PickInput, type SelectInput, type TargetAssessment } from './select';
export { PENDING_LIMIT_MS, REFUSAL_MS, UNANSWERED, createInteractionSession, type InteractionAccepted, type InteractionPhase, type InteractionSession, type InteractionSnapshot } from './session';
export { PROMPT_LIFT, promptView, type PromptTone, type PromptView } from './view';
export { InteractionPrompt, mountInteractionPrompt, type PromptMount, type PromptPlacement } from './Prompt';
export { bindUseKey, isOtherControl, isTypingTarget, isUsePress, type UseKeyOptions } from './keys';
export { GAMEPAD_LEAVE, GAMEPAD_USE, HINT_MS, createInteractionController, type InteractionController, type InteractionControllerDebug, type InteractionControllerOptions, type InteractionFrame } from './controller';
import { createInteractionController, type InteractionController, type InteractionControllerOptions } from './controller';
import { mountInteractionPrompt } from './Prompt';

/** The controller with the carved prompt drawn in `host` (the kingdom root, above the canvas). */
export function mountInteractionController(options: Omit<InteractionControllerOptions, 'prompt'> & { readonly host: HTMLElement; readonly coarse?: boolean }): InteractionController {
  const { host, coarse, ...rest } = options;
  return createInteractionController({ ...rest, prompt: onUse => mountInteractionPrompt(host, { onUse, ...(coarse === undefined ? {} : { coarse }) }) });
}
export { interactionSound, type InteractionSoundBus } from './feedback';
export { PENDING, QUIET, SEATED, VERB } from './copy';
export type { GamepadLike, InteractIntent, InteractionCamera, InteractionCueKind, InteractionFeedback, InteractionInbound, InteractionMessage, InteractionPlaces, InteractionRealm, InteractionView, LookFrame, PointerRay, SeatsMessage } from './ports';
