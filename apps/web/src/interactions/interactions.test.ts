import { describe, expect, it } from 'vitest';
import type { Vec3 } from '@chatdom/shared';
import type { CollisionWorld, SolidBox } from '@chatdom/shared/realm';
import { STANDING, createInteractionRegistry, interactionTargetId } from '../../../../packages/world/src/interactions';
import { FINISHED_FAMILIES, type AudioCue, type AudioCueOptions } from '@chatdom/audio';
import { createInteractionController } from './controller';
import { interactionSound } from './feedback';
import type { InteractIntent, InteractionPlaces } from './ports';
import { selectInteraction } from './select';
import { createInteractionSession } from './session';

const box = (min: Vec3, max: Vec3): SolidBox => ({ min, max });
const worldOf = (solids: readonly SolidBox[]): CollisionWorld => ({ revision: 1, query: q => solids.filter(b => b.min[0] < q.max[0] && b.max[0] > q.min[0] && b.min[1] < q.max[1] && b.max[1] > q.min[1] && b.min[2] < q.max[2] && b.max[2] > q.min[2]) });
const LOG = interactionTargetId.campfireSeat('t', 'log'), ANVIL = interactionTargetId.anvil('t'), FAR = interactionTargetId.campfireSeat('t', 'far');
const GROUND = box([-20, -1, -20], [20, 0, 20]);
const placements = [{ source: 'test', origin: [0, 0, 0] as Vec3, turn: 0 as const, cell: 1 as const, anchors: [
  { id: LOG, kind: 'campfire-seat' as const, zone: 'street', position: [-1.5, .4, 0] as Vec3, approach: [-1.5, 0, .7] as Vec3, rest: [-1.5, .4, 0] as Vec3, reach: 1.8 },
  { id: ANVIL, kind: 'anvil' as const, zone: 'street', position: [1.5, .8, 0] as Vec3, approach: [1.5, 0, .8] as Vec3, reach: 1.8 },
  { id: FAR, kind: 'campfire-seat' as const, zone: 'street', position: [0, .4, -4] as Vec3, approach: [0, 0, -4.7] as Vec3, rest: [0, .4, -4] as Vec3, facing: 0, reach: 1.8 },
] }];
const actor = { walkerId: 'w', zone: 'street', state: STANDING, ownedPlotId: null };

describe('the browser only hints, and never takes back what it let go', () => {
  it('follows the look between two reachable targets, and drops one the moment a wall hides it', () => {
    const open = worldOf([GROUND]);
    const records = createInteractionRegistry({ layoutRevision: 'a', world: open, placements }).records;
    const at = (forward: Vec3, previous: string | null, world = open) => selectInteraction({ frame: { feet: [0, 0, 0], forward }, records, world, actor, seats: [], previous }).focus?.record.target.id ?? null;
    expect(at([-1, -.3, 0], null)).toBe(LOG);
    expect(at([1, -.3, 0], LOG)).toBe(ANVIL);
    // 38° off the log: kept while it was the focus (hysteresis), not chosen fresh.
    const slanted: Vec3 = [-Math.cos(38 * Math.PI / 180), 0, Math.sin(38 * Math.PI / 180)];
    expect(at(slanted, LOG)).toBe(LOG);
    expect(at(slanted, null)).toBe(null);
    // A wall between eye and log: never kept, whatever the last frame chose.
    const walled = worldOf([GROUND, box([-.9, 0, -1], [-.7, 3, 1])]);
    expect(at([-1, -.3, 0], LOG, walled)).toBe(null);
    // Someone on the log: a quiet line, never the actionable prompt.
    const taken = selectInteraction({ frame: { feet: [0, 0, 0], forward: [-1, 0, 0] }, records, world: open, actor, seats: [{ targetId: LOG, walkerId: 'other', generation: 1, status: 'occupied' }], previous: null });
    expect(taken).toMatchObject({ focus: null, quiet: { reason: 'occupied' } });
  });

  it('sends one request per press, and a late acceptance after Escape updates state without retaking the camera', () => {
    let now = 0;
    const sent: InteractIntent[] = [];
    const session = createInteractionSession({ realm: { send: intent => { sent.push(intent); } }, clock: () => now });
    const accepted: string[] = [];
    session.onAccepted(a => { accepted.push(a.requestId); });
    expect(session.request(LOG, 'sit')).toBe(false);       // not connected: nothing is sent
    session.connect('epoch-1');
    expect(session.request(LOG, 'sit')).toBe(true);
    expect(session.snapshot().phase.kind).toBe('pending'); // at once, before any reply
    expect(session.request(LOG, 'sit')).toBe(false);       // a repeat while pending sends nothing
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({ version: 1, type: 'interact', id: sent[0]!.id, targetId: LOG, action: 'sit' });

    session.receive({ type: 'receipt', receipt: { version: 1, id: sent[0]!.id, status: 'applied', writerEpoch: 'epoch-old', state: STANDING } });
    expect(session.snapshot().phase.kind).toBe('pending');
    expect(accepted).toEqual([]);
    session.abandon();
    const state = { revision: 1, mode: 'seated' as const, targetId: LOG, plotId: null };
    session.receive({ type: 'receipt', receipt: { version: 1, id: sent[0]!.id, status: 'applied', writerEpoch: 'epoch-1', state } });
    expect(accepted).toEqual([]);
    expect(session.snapshot().self).toEqual(state);
    // An older self state arriving late, or one from another writer epoch, changes nothing.
    session.receive({ type: 'interaction', requestId: null, writerEpoch: 'epoch-1', state: { ...state, revision: 0, mode: 'standing', targetId: null } });
    session.receive({ type: 'interaction', requestId: null, writerEpoch: 'epoch-0', state: { ...state, revision: 9, mode: 'standing', targetId: null } });
    expect(session.snapshot().self).toEqual(state);

    // A refusal is the room's sentence, and it fades back to the look.
    now = 100;
    expect(session.request(LOG, 'stand')).toBe(true);
    session.receive({ type: 'receipt', receipt: { version: 1, id: sent[1]!.id, status: 'refused', message: 'Stand up first.' } });
    expect(session.snapshot().phase).toMatchObject({ kind: 'refused', message: 'Stand up first.' });
    session.tick(100 + 3200);
    expect(session.snapshot().phase.kind).toBe('idle');
    session.disconnect();
    expect(session.request(LOG, 'stand')).toBe(false);
  });

  it('one controller: look, click, key, button and Escape go through the same rules, and nothing late takes the camera back', () => {
    const open = worldOf([GROUND]);
    const records = createInteractionRegistry({ layoutRevision: 'a', world: open, placements }).records;
    const position = (id: string) => records.find(r => r.target.id === id)!.target.position;
    let now = 0;
    const sent: InteractIntent[] = [];
    const session = createInteractionSession({ realm: { send: intent => { sent.push(intent); } }, clock: () => now });
    session.connect('e1');
    let owner: 'walking' | 'released' | 'disposed' = 'walking';
    const camera = { get owner() { return owner; }, release() { owner = 'released'; }, resume() { owner = 'walking'; } };
    const opened: string[] = [];
    let closes = 0, closeFromPlace: (() => void) | null = null;
    const places: InteractionPlaces = { open: ({ action, record }, closed) => { opened.push(`${action} ${record.target.id}`); closeFromPlace = closed; return { close() { closes++; } }; } };
    const keyboard = new EventTarget(), page = Object.assign(new EventTarget(), { hidden: false });
    const surface = Object.assign(new EventTarget(), { getBoundingClientRect: () => ({ left: 0, top: 0 }) as DOMRect });
    const pad = { connected: true, buttons: [0, 1, 2, 3].map(() => ({ pressed: false })) };
    const eye: Vec3 = [0, 2.2, 3];
    let aim: Vec3 = position(ANVIL), forward: Vec3 = [-1, -.3, 0];
    const controller = createInteractionController({ prompt: () => ({ update() {}, dispose() {} }), surface, session, camera, places, keyboard, page, gamepads: () => [pad] });
    const frame = () => controller.frame({
      now, look: { feet: [0, 0, 0], forward }, records, world: open, actor: { walkerId: 'w', zone: 'street', ownedPlotId: null },
      project: () => ({ x: 10, y: 10 }), ray: () => ({ origin: eye, direction: [aim[0] - eye[0], aim[1] - eye[1], aim[2] - eye[2]] }),
    });
    const words = () => controller.debug.prompt?.words ?? null;
    const key = (code: string, extra: { repeat?: boolean; target?: unknown } = {}) => {
      const event = Object.assign(new Event('keydown', { cancelable: true }), { code, key: code === 'KeyE' ? 'e' : code, repeat: extra.repeat ?? false, isComposing: false, ctrlKey: false, metaKey: false, altKey: false });
      if (extra.target) Object.defineProperty(event, 'target', { value: extra.target });
      keyboard.dispatchEvent(event);
    };
    const keyup = (code: string) => keyboard.dispatchEvent(Object.assign(new Event('keyup'), { code }));
    const tap = () => { for (const type of ['pointerdown', 'pointerup']) surface.dispatchEvent(Object.defineProperty(Object.assign(new Event(type), { pointerId: 1, isPrimary: true, pointerType: 'touch', button: 0, clientX: 5, clientY: 5 }), 'timeStamp', { value: 0 })); };
    let revision = 0;
    const reply = (state: { mode: 'standing' | 'seated'; targetId: string | null }) => session.receive({ type: 'receipt', receipt: { version: 1, id: sent.at(-1)!.id, status: 'applied', writerEpoch: 'e1', state: { revision: ++revision, plotId: null, ...state } } });

    // Turning the head between the log and the anvil changes what E will do, from the same feet, sending nothing.
    frame(); expect(words()).toBe('Sit by the fire');
    forward = [1, -.3, 0]; frame(); expect(words()).toBe('Work the anvil');
    // A tap on a log out of reach says so quietly and sends nothing; a tap on the anvil uses it, wherever you look.
    forward = [0, 0, 1]; frame(); expect(words()).toBe(null);
    aim = position(FAR); tap(); frame();
    expect(controller.debug.pick).toEqual({ targetId: FAR, used: false });
    expect(controller.debug.prompt).toMatchObject({ tone: 'quiet', words: 'Walk a little closer', actionable: false });
    expect(sent).toEqual([]);
    aim = position(ANVIL); tap();
    expect(sent.map(i => [i.targetId, i.action])).toEqual([[ANVIL, 'forge']]);
    expect(controller.debug.prompt).toMatchObject({ tone: 'pending', words: 'Reaching for the anvil…' });
    expect(controller.debug.localResponse).toBeLessThan(100);
    // The room says yes: the Forge takes the camera and E is no longer the world's. Escape hands it straight back.
    reply({ mode: 'standing', targetId: null });
    expect([owner, opened, controller.debug.prompt]).toEqual(['released', [`forge ${ANVIL}`], null]);
    key('KeyE'); keyup('KeyE');
    expect(sent).toHaveLength(1);
    key('Escape');
    expect([owner, closes, controller.debug.held]).toEqual(['walking', 1, null]);
    expect(sent).toHaveLength(1);

    // E on the log: one press is one request; repeat sends nothing. Seated, the seat's view holds the camera.
    forward = [-1, -.3, 0]; frame();
    key('KeyE'); key('KeyE', { repeat: true }); keyup('KeyE');
    expect(sent.at(-1)).toMatchObject({ targetId: LOG, action: 'sit' });
    expect(sent).toHaveLength(2);
    reply({ mode: 'seated', targetId: LOG }); frame();
    expect([owner, opened.at(-1), words()]).toEqual(['released', `sit ${LOG}`, 'Stand up']);
    // Escape: camera and input back at once, the stand is asked for and stays honestly pending.
    key('Escape');
    expect([owner, closes]).toEqual(['walking', 2]);
    expect(sent.at(-1)).toMatchObject({ targetId: LOG, action: 'stand' });
    expect(controller.debug.prompt).toMatchObject({ tone: 'pending', words: 'Getting up…' });
    reply({ mode: 'standing', targetId: null }); frame();
    expect([owner, opened.length, words()]).toEqual(['walking', 2, 'Sit by the fire']);

    // Typing: E in a field is the field's, and that press stays spent until the key comes up.
    const field = { tagName: 'INPUT', type: 'text', closest: () => null };
    key('KeyE', { target: field }); key('KeyE');
    expect(sent).toHaveLength(3);
    keyup('KeyE'); key('KeyE'); keyup('KeyE');
    expect(sent.at(-1)).toMatchObject({ targetId: LOG, action: 'sit' });
    // Escape while pending forgets it here; the late yes updates the truth but takes no camera.
    key('Escape');
    reply({ mode: 'seated', targetId: LOG }); frame();
    expect([owner, opened.length, controller.debug.self.mode, words()]).toEqual(['walking', 2, 'seated', 'Stand up']);
    // Walking away from the seat asks to stand.
    key('KeyW');
    expect(sent.at(-1)).toMatchObject({ targetId: LOG, action: 'stand' });
    reply({ mode: 'standing', targetId: null }); frame();

    // The gamepad's West button is E: one press, one request, polled per frame.
    pad.buttons[2]!.pressed = true; frame(); frame();
    expect(sent.filter(i => i.action === 'sit')).toHaveLength(3);
    pad.buttons[2]!.pressed = false;
    reply({ mode: 'seated', targetId: LOG }); frame();
    expect(owner).toBe('released');
    // Moderation (an unsolicited standing state) ends the seat's view in the same turn.
    session.receive({ type: 'interaction', requestId: null, writerEpoch: 'e1', state: { revision: ++revision, mode: 'standing', targetId: null, plotId: null } });
    expect([owner, closes]).toEqual(['walking', 3]);

    // A place that closes itself hands the camera back; the room still says seated, so E still offers to stand.
    frame(); key('KeyE'); keyup('KeyE'); reply({ mode: 'seated', targetId: LOG }); frame();
    expect(owner).toBe('released');
    closeFromPlace!();
    frame();
    expect([owner, closes, controller.debug.held, words()]).toEqual(['walking', 3, null, 'Stand up']);
    // Seated with the view held again, then the connection drops: the camera is back and nothing is actionable.
    key('KeyE'); keyup('KeyE'); reply({ mode: 'standing', targetId: null }); frame();
    key('KeyE'); keyup('KeyE'); reply({ mode: 'seated', targetId: LOG }); frame();
    expect(owner).toBe('released');
    session.disconnect(); frame();
    expect([owner, controller.debug.prompt]).toEqual(['walking', null]);
    // Back on the same room: "not now" is its own tone, the room's own sentence.
    session.connect('e1'); frame();
    key('KeyE'); keyup('KeyE');
    session.receive({ type: 'receipt', receipt: { version: 1, id: sent.at(-1)!.id, status: 'unavailable', message: 'The kingdom moved on. Reconnect to try again.' } });
    expect(controller.debug.prompt).toMatchObject({ tone: 'unavailable', words: 'The kingdom moved on. Reconnect to try again.' });

    controller.dispose();
    const before = sent.length;
    now += 5000; key('KeyE'); keyup('KeyE'); pad.buttons[2]!.pressed = true; tap();
    expect(sent).toHaveLength(before);
  });

  it('cues the press, the yes and the no on the existing bus, with finished families only', () => {
    const calls: string[] = [];
    const sound = interactionSound({ cue: (kind: AudioCue, options?: AudioCueOptions) => { calls.push(kind === 'wood' ? `wood:${options?.ui ?? 'wood'}` : ['place', 'remove', 'step', 'material'].includes(kind) ? `${kind}:${options?.material ?? 'wood'}` : kind); return true; } });
    for (const action of ['sit', 'tavern', 'forge', 'stand', 'enter-home', 'exit-home'] as const) for (const kind of ['pending', 'accepted', 'refused', 'unavailable'] as const) sound.cue(kind, action);
    expect(new Set(calls)).toEqual(new Set(['wood:brass', 'place:wood', 'place:metal', 'remove:wood', 'wood:wood', 'wood:parchment']));
    for (const family of calls) expect(FINISHED_FAMILIES).toContain(family);
  });
});
