// Writes apps/studio/sound/ambience.json from the measured results. Called by render.mjs.
import { writeFileSync } from 'node:fs';

const LICENCE = {
  genesis: 'Original procedural synthesis authored in this repository (packages/audio/src/genesis-biomes); no recordings (packages/audio/src/genesis-biomes/THIRD_PARTY.md).',
  forge: 'Original procedural synthesis authored in this repository (packages/audio/src/forge); no recordings or third-party code (packages/audio/src/forge/README.md, Credits).',
  moment: 'Original procedural synthesis authored in this repository (apps/web/src/twitch-moments/sound.ts); no samples, recordings or downloaded audio.',
  teaser: 'Original procedural synthesis authored for the teaser in this repository (apps/studio/sound/ambience); no recordings.',
  kenney: pack => `Original synthesis authored in this repository (packages/audio/src/cues) layered with recorded foley from Kenney "Impact Sounds" 1.0 (${pack}), CC0 1.0 (Kenney Vleugels, kenney.nl), as listed in packages/audio/THIRD_PARTY.md.`,
  footsteps: 'Footsteps: packages/audio `step` cue, original synthesis (packages/audio/src/cues/materials) layered with recorded footsteps from Kenney "Impact Sounds" 1.0 (footstep-concrete, footstep-wood), CC0 1.0 (Kenney Vleugels, kenney.nl), per packages/audio/THIRD_PARTY.md.',
};

const SHOTS = {
  'bed-evening-town': {
    what: 'Evening town bed, a seamless 30 s loop. Dusk on the harbour town: the sea breaking left and right and lapping at the quay, rigging and hulls, a few gulls, blackbirds and a wood pigeon settling, a frog by the water, crickets just starting; people talking a street away (now and then a laugh), a hearth crackling through an open window, three passers-by on the cobbles and the boardwalk.',
    shots: 'S01 the channel at dusk; S05-S07 the Way Home at golden hour (the walk to their door, the window lights, the door opens); S08 chat becomes lights, under the window wave.',
  },
  'bed-night-town': {
    what: 'Night town bed, a seamless 30 s loop. The harbour at night in a light sea mist: soft sea and wind, the hull and rigging, crickets, an owl in the trees, the bell buoy offshore rung by the swell, and a brazier fire burning near the ear (more roar than the hearth). No people.',
    shots: 'S17 the gate wakes (braziers, walkers gathering); S20 arrival at a town whose lights come on; S22 the night town close.',
  },
  'hero-light': { what: 'One window lighting because someone came home: a fingertip of glass, the wick catching in a soft puff, a warm glow blooming into one note of the palette.', shots: 'S06 the window lights on the Way Home; S20 single windows coming on.' },
  'hero-wave': { what: 'A street lighting up behind the first window: five more windows catch one after another, travelling across the stereo field, their glows gathering into one soft chord with a warm undertone.', shots: 'S08 chat becomes lights (the window wave); S20 the town lighting up.' },
  'hero-beacon': { what: 'The castle beacon: a torch set down into the brazier (a low, dull wooden knock), the oil catching in a rising whoomph with sparks, the castle windows catching, and one broad warm chord rising from the bottom up to a crest and back to quiet inside five seconds.', shots: 'S17 the gate braziers catch.' },
  'hero-crowd-murmur': { what: 'The town turning to look: a crowd "ooh" that rises to a peak about 1.5 s in and lets go.', shots: 'S14 the raid arrives, just before the crowd erupts.' },
  'hero-crowd-cheer': { what: 'The crowd erupting: a bright "aah" that leaps and falls away, with hands clapping across the street.', shots: 'S14-S15 the crowd erupts for the raid.' },
  'hero-horn': { what: 'A short brass horn call from the gate, a rising fourth (D to G), the filter opening like a lip buzz.', shots: 'S14-S16 the raid horn.' },
  'hero-cart-roll': { what: 'A cart rolling in: wooden wheels on packed earth, a low rumble that swells and fades, with a pony\'s soft hoof clops on top.', shots: 'S15-S16 the caravan through the gate.' },
  'hero-festival-drum': { what: 'A festive frame-drum figure with a tambourine: low open strokes, quick high slaps, jingles on the offbeats and a shaken roll into the last big stroke.', shots: 'S15-S16 under the caravan, if the score leaves room for it.' },
  'hero-forge-strike': { what: 'The Forge strike: the hammer lifting, the swing, the impact (about 1.0 s in) with the dull squash of hot iron and a body thump, then the anvil ringing out for about 7 s with sparks crackling away.', shots: 'S11 the Forge strike.' },
  'hero-forge-landing': { what: 'The Forge flight and landing: the release thump, air following the part along its arc, the contact on the roof (about 3.4 s in) with tiles chattering and dust settling, one small timber creak.', shots: 'S12 the forged thing lands.' },
  'hero-forge-ritual': { what: 'The whole Forge ritual on its authored 21 s schedule: the words (bellows breath, rune glints, the gather), the blueprint latch, the pour (clanks, molten bubbles), the seal (wax, press, ribbon, hammer lift), the strike and ring, the quench and cooling ticks, the flight and the landing.', shots: 'S10-S12 the Forge, as a guide track or to cut pieces from.' },
};

function source(name, task, result, beds) {
  if (result.kind === 'bed') {
    return beds[name].map(spec => {
      const layer = task[spec.layer], gain = result.mix.find(m => m.layer === spec.layer)?.gainDb;
      return { layer: spec.layer, gainDb: gain, ...describe(layer) };
    });
  }
  return describe(task[name]);
}

function describe(task) {
  switch (task.kind) {
    case 'land': return {
      module: 'packages/audio/src/genesis-biomes/offline.ts', function: 'renderGenesisSoundscape',
      settings: {
        recipe: `compileChannelGenesis(OBSERVED_GENESIS_FIXTURES, broadcasterId ${task.channel}) (packages/world/src/genesis; the observed meadow-soul fixture)`,
        landscape: task.character, hour: task.hour, weather: task.weather,
        listener: task.towardsForest !== undefined ? `${task.towardsForest} m from the harbour shore point towards the nearest forest edge, ${task.height} m up` : `${task.fromHarbour} m from the harbour shore point towards the plaza, ${task.height} m up`,
        realmOffsetSeconds: `${task.realmOffsetSeconds ?? 0} (a window of realm time chosen from a 300 s survey for its calls)`,
        postProcess: 'in the bed mix: 2nd-order Butterworth high-pass at 35 Hz',
        mix: 'kingdom profile, master 0.4225 (the kingdom default)', preroll: `${task.preroll} s rendered and discarded so every bed has eased in`,
        realmClockBaseMs: 1793377944392,
      },
      licence: LICENCE.genesis,
    };
    case 'kingdom': {
      const cues = [...new Set(task.script.map(s => s.cue))];
      const steps = task.script.filter(s => s.cue === 'step');
      return {
        module: 'packages/audio/src/offline.ts', function: 'renderKingdomAudio',
        settings: steps.length
          ? { cue: 'step', steps: steps.length, materials: [...new Set(steps.map(s => s.options.material))], distanceMetres: [Math.min(...steps.map(s => s.options.distance)), Math.max(...steps.map(s => s.options.distance))], volume: 0.65, random: `seeded (${task.seed})`, script: 'three passers-by, see LAYER_TASKS evening-steps in render.mjs' }
          : { cues, at: task.script.map(s => s.at), volume: 0.65, random: `seeded (${task.seed})` },
        licence: steps.length ? LICENCE.footsteps : LICENCE.kenney({ light: 'impact-glass-light', wave: 'impact-glass-light', beacon: 'impact-plank-medium and impact-glass-light' }[cues[0]] ?? 'see THIRD_PARTY.md'),
      };
    }
    case 'moment': return {
      module: 'apps/web/src/twitch-moments/sound.ts', function: 'createProceduralMomentSound(...).play',
      settings: { cues: task.cues.map(c => c.cue), gain: 1, context: 'OfflineAudioContext; the port\'s wall-clock disconnect timer is held back while scheduling (offline rendering runs on its own clock)' },
      licence: LICENCE.moment,
    };
    case 'forge': return {
      module: 'packages/audio/src/forge/offline.ts', function: 'renderForgeAudio',
      settings: {
        frames: `ForgeRitualFrame on the authored FORGE_SPANS schedule (packages/audio/src/forge/conductor.ts), elapsed ${task.from} s to ${task.to} s, source 'simulated', 60 frames a second`,
        after: task.to >= 21 ? 'the ended landed frame (ritual over)' : 'null frames (the anvil is clear): what rings, rings out; nothing new starts',
        mix: 'volume 1', lead: `${task.lead} s of silence before the first frame`,
      },
      licence: LICENCE.forge,
    };
    case 'fire': return {
      module: 'apps/studio/sound/ambience/fire.ts', function: 'renderFire',
      settings: { seed: task.seed, size: task.size, distance: task.distance, pan: task.pan },
      licence: LICENCE.teaser,
    };
    case 'murmur': return {
      module: 'apps/studio/sound/ambience/murmur.ts', function: 'renderMurmur',
      settings: { seed: task.seed, talkers: task.talkers, airHz: task.air },
      licence: LICENCE.teaser,
    };
  }
}

/** When the land's calls and the passers-by sound in a bed (seconds into the 30 s loop; 30-34 s folds into 0-4 s). */
function timeline(name, tasks, beds, sessionReport) {
  const out = [];
  for (const spec of beds[name]) {
    const task = tasks[spec.layer], info = sessionReport.layers?.[spec.layer]?.info;
    if (task.kind === 'land' && info?.timeline) for (const e of info.timeline) {
      const t = e.t >= 30 ? e.t - 30 : e.t;
      out.push({ t: Number(t.toFixed(2)), what: `${e.call}${e.distance ? ` (${e.distance} m)` : ''}` });
    }
    if (task.kind === 'kingdom') {
      const groups = [];
      for (const step of task.script) {
        const last = groups[groups.length - 1];
        if (last && step.at - last.to < 1 && step.options.material === last.material) last.to = step.at; else groups.push({ from: step.at, to: step.at, material: step.options.material });
      }
      for (const g of groups) out.push({ t: g.from, what: `footsteps on ${g.material === 'stone' ? 'cobbles' : 'boards'}, ${g.from.toFixed(1)}-${g.to.toFixed(1)} s` });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

export function writeManifest({ results, sessionReport, tasks, beds, manifestFile, media }) {
  const files = Object.entries(results).map(([name, result]) => {
    const m = result.edit_measure, raw = result.raw_measure;
    const src = source(name, tasks, result, beds);
    const licences = Array.isArray(src) ? [...new Set(src.map(s => s.licence))] : [src.licence];
    return {
      id: name,
      file: result.edit,
      raw: result.raw,
      spectrogram: `${media}/spectrograms/${name}.png`,
      what: SHOTS[name].what,
      shots: SHOTS[name].shots,
      source: src,
      licence: licences.join(' '),
      durationSeconds: m.duration,
      loop: result.kind === 'bed' ? 'Seamless loop: rendered 34 s, the last 4 s cross-faded (equal power) into the first 4 s. No fade in or out; loop it or fade it in the edit.' : 'One-shot; starts 50 ms in, silent tail trimmed to 150 ms with a 50 ms fade.',
      format: { edit: 'WAV, 48 kHz, stereo, 24-bit PCM', raw: 'WAV, 48 kHz, stereo, 32-bit float' },
      normalisation: { gainDb: result.gainDb, rule: result.rule },
      loudness: {
        integratedLufs: m.integratedLufs, truePeakDbtp: m.truePeakDbtp, loudnessRangeLu: m.loudnessRangeLu, samplePeakDbfs: m.samplePeakDbfs,
        shortTermLufs: m.shortTermLufs, dcOffset: m.dcOffset, flatFactor: m.flatFactor,
      },
      rawLoudness: { integratedLufs: raw.integratedLufs, truePeakDbtp: raw.truePeakDbtp },
      ...(result.kind === 'bed' ? { heard: timeline(name, tasks, beds, sessionReport) } : {}),
      ...(result.seam ? { seam: { ...result.seam, note: 'largest last-to-first sample jump vs the median sample-to-sample step' } } : {}),
    };
  });
  const manifest = {
    title: 'Chatdom teaser: the kingdom\'s own ambience',
    generated: new Date().toISOString(),
    media,
    sampleRate: 48000,
    formats: { edit: 'WAV, 48 kHz, stereo, 24-bit PCM (media .../ambience/edit/)', raw: 'WAV, 48 kHz, stereo, 32-bit float, as rendered (media .../ambience/raw/; bed layers in raw/layers/)' },
    levels: 'Beds: linear gain to -28 LUFS integrated, true peak kept below -6 dBTP. Hero sounds: linear gain so the true peak sits at -6 dBTP. Measured with ffmpeg ebur128 (peak=true) and astats.',
    rerender: {
      all: 'cd /srv/chatdom/teaser && nice -n 19 node apps/studio/sound/ambience/render.mjs',
      remixOnly: 'nice -n 19 node apps/studio/sound/ambience/render.mjs --mix-only',
      oneLayer: 'nice -n 19 node apps/studio/sound/ambience/render.mjs <layer-name> (for example evening-fire)',
      how: 'Builds the bench page (apps/studio/sound/ambience/index.html, main.ts) with Vite, takes the shared capture lock, renders every layer in headless Chromium through OfflineAudioContext on the first free capture port, closes the browser and server and releases the lock, then mixes, loops, measures and normalises in Node with ffmpeg (nice -n 19, -threads 4). Deterministic: every render is seeded.',
    },
    notes: [
      'Soul audio (packages/audio/src/soul, renderSoulAudio) is not used: it always plays its own music (lute, and strings, woodwind and choir with presence) and has no switch to turn that off, which would clash with the score. The Genesis land layer it reuses for birds, harbour and water is used directly instead.',
      'The Genesis land has no people in it by design (population: real-presence-only). The evening murmur and the fire are therefore authored for the teaser in apps/studio/sound/ambience (murmur.ts, fire.ts) and are labelled so; they are not package sounds.',
      'Door: the kingdom has no door cue (packages/audio cues are wood, light, wave, beacon, step, place, remove, material; the moment cues have none either). No door sound was made.',
      'The bell buoy is the Genesis land\'s own call (rung by the swell; the light mist in the night bed makes it speak more often). Whether it rings, and when, comes from the seed.',
      'Owls and blackbirds come from the meadow soul of the observed fixture 4363967; the coastal fixture 63920635 would give oystercatchers and curlews instead and no owl.',
      'Inputs are chosen for the teaser shots (hour, weather, ear position, the Forge schedule, the passers-by): they are not events from a real kingdom.',
    ],
    renderSession: { rendered: sessionReport.rendered, buildFingerprint: sessionReport.buildFingerprint, consoleErrors: sessionReport.consoleErrors ?? [] },
    files,
  };
  writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
}
