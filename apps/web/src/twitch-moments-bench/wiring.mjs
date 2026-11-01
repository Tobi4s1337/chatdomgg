// The sky moments' seams in main's files, as exact edits: the town takes the sky's light, and the stream shows the
// moment's credit. Main applies them (work/lanes/sky-moments/wiring.patch, written from this list by
// write-wiring-patch.mjs); until then the lane's captures can preview them in memory with `--wired`, so a shot
// shows exactly what main's tree will draw. Nothing here edits main's files on disk.

/** @type {readonly { file: string; why: string; edits: readonly [string, string][] }[]} */
export const WIRING = [
  {
    file: 'apps/web/src/kingdom/moments/index.ts',
    why: 'keep the view’s sky light for the scene, one value per frame',
    edits: [
      ['  let lastPresence: KingdomPresenceFrame | undefined;\n',
        '  let lastPresence: KingdomPresenceFrame | undefined;\n  let skyGlow: SkyGlow | null = null;\n'],
      ['    parent, material: material.material, kit: options.kit, sound: options.sound,\n',
        '    parent, material: material.material, kit: options.kit, sound: options.sound, light: glow => { skyGlow = glow; },\n'],
      ['    captions: () => disposed || !prepared ? [] : view.labels(camera),\n',
        '    captions: () => disposed || !prepared ? [] : view.labels(camera),\n    /** The sky moment\'s light on the town this frame (aurora, bursts, the dimmed dusk), or null. */\n    glow: () => disposed ? null : skyGlow,\n'],
      ["import { createTwitchMomentView, createTwitchMoments, type CameraLease, type MomentSoundPort, type TwitchMomentFeed } from '../../twitch-moments';\n",
        "import { createTwitchMomentView, createTwitchMoments, type CameraLease, type MomentSoundPort, type SkyGlow, type TwitchMomentFeed } from '../../twitch-moments';\n"],
    ],
  },
  {
    file: 'apps/web/src/kingdom/scene.ts',
    why: 'light the town by the hour’s grade answered by the sky moment',
    edits: [
      ['const grade=getEnvironment(hour);', 'const grade=skyLitEnvironment(getEnvironment(hour),moments?.glow());'],
      ["import type { ScreenCaption, TwitchMomentFeed } from '../twitch-moments';\n",
        "import { skyLitEnvironment, type ScreenCaption, type TwitchMomentFeed } from '../twitch-moments';\n"],
    ],
  },
  {
    file: 'apps/web/src/stream/index.tsx',
    why: 'credit the moment on the stream picture',
    edits: [
      ["import { Corner, Crest, Flame, StreamDefs } from './fittings';\n",
        "import { Corner, Crest, Flame, StreamDefs } from './fittings';\nimport { SkyCaptions, type ScreenCaption } from '../twitch-moments';\n"],
      ['  const [walkers, setWalkers] = createSignal<readonly WalkerLabel[]>([]);\n',
        '  const [walkers, setWalkers] = createSignal<readonly WalkerLabel[]>([]);\n  const [momentCaptions, setMomentCaptions] = createSignal<readonly ScreenCaption[]>([]);\n'],
      ['presenceOrigin: params.presenceOrigin, onWalkers: setWalkers })',
        'presenceOrigin: params.presenceOrigin, onWalkers: setWalkers, onMomentCaptions: setMomentCaptions })'],
      ['        <div class="stream-speech citizen-speech">',
        '        <SkyCaptions captions={momentCaptions()} />\n        <div class="stream-speech citizen-speech">'],
    ],
  },
];

/** Apply one file's edits to its text; every anchor must occur exactly once. */
export function wire(file, text) {
  const entry = WIRING.find(w => file.endsWith(w.file));
  if (!entry) return text;
  for (const [from, to] of entry.edits) {
    const at = text.indexOf(from);
    if (at < 0 || text.indexOf(from, at + 1) >= 0) throw new Error(`Wiring anchor in ${entry.file} is missing or not unique: ${from.slice(0, 60)}`);
    text = text.slice(0, at) + to + text.slice(at + from.length);
  }
  return text;
}

/** A Vite plugin that serves main's files with the wiring applied, for `--wired` previews only. */
export function wiringPreview() {
  return {
    name: 'sky-moments-wiring-preview',
    enforce: 'pre',
    transform(code, id) {
      const path = id.split('?')[0];
      return WIRING.some(w => path.endsWith(w.file)) ? { code: wire(path, code), map: null } : null;
    },
  };
}
