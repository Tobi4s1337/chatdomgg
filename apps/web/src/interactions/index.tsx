// Browser side of spec 37: the look selector, the request session and the carved prompt. The integrator mounts
// these from the kingdom scene (README); the bench at ./bench/index.html runs them against the real room authority.
export { KEEP_CONE, KEEP_SLACK, LOOK_CONE, selectInteraction, viewAlignment, type InteractionCandidate, type InteractionQuiet, type InteractionSelection, type SelectInput } from './select';
export { PENDING_LIMIT_MS, REFUSAL_MS, createInteractionSession, type InteractionAccepted, type InteractionPhase, type InteractionSession, type InteractionSnapshot } from './session';
export { PROMPT_LIFT, promptView, type PromptTone, type PromptView } from './view';
export { InteractionPrompt, mountInteractionPrompt, type PromptMount, type PromptPlacement } from './Prompt';
export { bindUseKey, isTypingTarget, isUsePress } from './keys';
export { PENDING, QUIET, SEATED, VERB } from './copy';
export type { InteractIntent, InteractionCamera, InteractionFeedback, InteractionInbound, InteractionMessage, InteractionRealm, LookFrame, SeatsMessage } from './ports';
