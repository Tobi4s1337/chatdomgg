import type { Camera, Matrix4, Scene } from 'three';
import {
  equippedTool, heldTool, onSlotsChanged, worldPrompts,
  type HeldToolHandle, type PlayContext, type ToolContext, type WorldPromptProvider,
} from './slots';

/**
 * Held tools and world prompts (work/lanes/pier/SEAMS.md, section 2). The walk scene lends what a tool needs: the
 * walking room's channel, the walker's pose and grip, the scene and the camera. The session routes the captured
 * mouse's buttons and the use action here first; whatever is not taken goes on to the world.
 */
export interface PlayWorld {
  readonly room: ToolContext['room'];
  pose(): ReturnType<ToolContext['pose']>;
  hand(): Matrix4 | null;
  holdPose(pose: 'cast' | 'hold' | 'reel' | null): void;
  readonly scene: Scene;
  readonly camera: Camera;
  /** The room clock, in the units the room's messages use. */
  now(): number;
  /** A realm interaction target is highlighted: E and the click belong to it, not to a world prompt. */
  interactionFocused(): boolean;
}

export interface ShownPrompt { readonly id: string; readonly label: string; readonly at: readonly [number, number, number] }

export interface ToolRuntime {
  /** The tool in hand, or null. */
  readonly tool: string | null;
  /** The world prompt shown now, or null. */
  readonly prompt: ShownPrompt | null;
  onPrompt(listener: (prompt: ShownPrompt | null) => void): () => void;
  /** Once per frame, with seconds since the last. */
  frame(dt: number): void;
  /** A press of the captured mouse (or the touch tool button). True when the tool took it. */
  pointer(type: 'down' | 'up', button: number): boolean;
  /** The use action. True when a world prompt took it. */
  use(): boolean;
  /** Put the tool down and stop listening: the ledger, a seat or leaving the walk. */
  pause(paused: boolean): void;
  dispose(): void;
}

/** How often prompts are asked where the walker stands. */
const PROMPT_EVERY_S = .2;

export function createToolRuntime(ctx: PlayContext, world: PlayWorld): ToolRuntime {
  let handle: HeldToolHandle | null = null, holding: string | null = null, equipping = false, disposed = false, paused = false;
  let shown: (ShownPrompt & { readonly provider: WorldPromptProvider }) | null = null, since = PROMPT_EVERY_S;
  const promptListeners = new Set<(prompt: ShownPrompt | null) => void>();
  const toolContext: ToolContext = {
    get kingdomId() { return ctx.kingdomId; },
    get self() { return ctx.self; },
    get live() { return ctx.live; },
    get mode() { return ctx.mode; },
    get settings() { return ctx.settings; },
    requestCursor: reason => ctx.requestCursor(reason),
    closeLedger: () => ctx.closeLedger(),
    requestInput: reason => ctx.requestInput(reason),
    hideSelf: reason => ctx.hideSelf(reason),
    room: world.room,
    pose: () => world.pose(),
    hand: () => world.hand(),
    holdPose: pose => { if (!disposed && (handle || equipping)) world.holdPose(pose); },
    scene: world.scene,
    camera: world.camera,
  };
  const putDown = () => {
    if (!handle) return;
    const was = handle;
    handle = null; holding = null;
    world.holdPose(null);
    try { was.dispose(); } catch (error) { console.error('A held tool failed to put down', error); }
  };
  const sync = () => {
    if (disposed) return;
    const wanted = equippedTool();
    if (wanted === holding) return;
    putDown();
    const provider = wanted ? heldTool(wanted) : undefined;
    if (!provider) return;
    equipping = true;
    try { handle = provider.equip(toolContext); holding = provider.id; } catch (error) { world.holdPose(null); console.error(`The tool ${provider.id} could not be taken up`, error); }
    finally { equipping = false; }
  };
  const show = (next: typeof shown) => {
    const same = next?.id === shown?.id && next?.label === shown?.label;
    shown = next;
    if (same) return;
    const view = next ? { id: next.id, label: next.label, at: next.at } : null;
    for (const listener of [...promptListeners]) listener(view);
  };
  const ask = () => {
    const pose = world.pose();
    if (!pose || paused) { show(null); return; }
    let best: typeof shown = null, bestDistance = Infinity;
    for (const provider of worldPrompts()) {
      let answer: ReturnType<WorldPromptProvider['prompt']>;
      try { answer = provider.prompt({ position: pose.position, yaw: pose.yaw }); } catch { answer = null; }
      if (!answer || typeof answer.label !== 'string' || !answer.label.trim() || !answer.at.every(Number.isFinite)) continue;
      const distance = Math.hypot(answer.at[0] - pose.position[0], answer.at[1] - pose.position[1], answer.at[2] - pose.position[2]);
      if (distance < bestDistance) { bestDistance = distance; best = { id: provider.id, label: answer.label, at: answer.at, provider }; }
    }
    show(best);
  };
  const stopSlots = onSlotsChanged(sync);
  sync();
  return {
    get tool() { return holding; },
    get prompt() { return shown ? { id: shown.id, label: shown.label, at: shown.at } : null; },
    onPrompt(listener) { promptListeners.add(listener); return () => promptListeners.delete(listener); },
    frame(dt) {
      if (disposed) return;
      if (handle && !paused) { try { handle.update(dt); } catch (error) { console.error(`The tool ${holding} failed`, error); } }
      since += dt;
      if (since >= PROMPT_EVERY_S) { since = 0; ask(); }
    },
    pointer(type, button) {
      if (disposed || paused || !handle) return false;
      try {
        if (button === 0) { if (type === 'down') handle.press(world.now()); else handle.release(world.now()); return true; }
        if (button === 2) { if (type === 'down') handle.cancel(); return true; }
      } catch (error) { console.error(`The tool ${holding} failed`, error); return true; }
      return false;
    },
    use() {
      if (disposed || paused || !shown || world.interactionFocused()) return false;
      try { shown.provider.use(ctx); } catch (error) { console.error(`The prompt ${shown.id} failed`, error); }
      return true;
    },
    pause(next) {
      if (paused === next) return;
      paused = next;
      if (paused) { if (handle) { try { handle.cancel(); } catch { /* already down */ } } show(null); }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stopSlots(); putDown(); show(null); promptListeners.clear();
    },
  };
}
