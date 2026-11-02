// The film takes: every kingdom plate the first cut needs, rendered on the GPU by rig/shoot.mjs. Each take records
// its shot plus a handle of HANDLE seconds, so the edit can slide a cut onto the music's beat without running out.
//
// Sizes: the grand land and the Atlas render at any pixel count, so their plates are 3840×2160 (1920×1080 CSS at
// device scale 2). The kingdom scene's post stack is capped near 2.1 million pixels (packages/render
// post-stack.ts), so its plates are 1920×1080, the most it draws; the master scales them up.
export const TAKES_DIR = '/srv/chatdom/media/teaser/takes';
export const HANDLE = 1;

const set = (scene, params) => `/studio/set.html?scene=${scene}&${params}`;
const IDLE = 'window.__set ? window.__set.idle() : true';
/** The stream view hides nothing in its canvas; WebCodecs captures only the canvas, so its DOM never reaches a plate. */
const STREAM_IDLE = 'window.__chatdomKingdom && window.__chatdomKingdom.stats.ready && window.__chatdomKingdom.stats.fieldSettled';

const shot = (take, shotId, scene, params, seconds, size = {}) => ({ take, shot: shotId, url: set(scene, params), from: 0, to: seconds + HANDLE, settle: IDLE, preroll: 0.1, ...size });
const UHD = { size: '1920x1080', scale: 2 };

export const FILM = [
  // The player plate for the page shots (S01–S03, S08, S09) and the S03 push-through: the stream view at dusk.
  { take: 'film-stream-dusk', shot: 'S01', url: '/stream?source=simulated&layout=stage&seam=starting&hour=19.3', from: 0, to: 30, settle: STREAM_IDLE, size: '1920x1080', scale: 1 },
  shot('film-S04', 'S04', 'grand', 'channel=tobi4s_&path=island-golden', 6, UHD),
  shot('film-S05', 'S05', 'kingdom', 'shot=S05', 4),
  shot('film-S06', 'S06', 'kingdom', 'shot=S06', 4),
  shot('film-S07', 'S07', 'kingdom', 'shot=S07', 4),
  shot('film-S09', 'S09', 'kingdom', 'shot=S09', 3),
  // The whole ritual at real speed; the edit cuts its four moments out of it.
  { ...shot('film-S11', 'S11', 'forge', 'shot=S11', 13), to: 13 },
  shot('film-S12', 'S12', 'kingdom', 'shot=S12&forgeFixture=1', 4),
  // The growth stage loads for a minute or more and each step can restart its light workers: no preroll.
  { ...shot('film-S13', 'S13', 'growth', 'shot=S13', 5), preroll: 0 },
  shot('film-S15', 'S15', 'raid', 'shot=S15', 4),
  shot('film-S16', 'S16', 'raid', 'shot=S16', 3),
  shot('film-S17', 'S17', 'kingdom', 'shot=S17', 4),
  shot('film-S18', 'S18', 'kingdom', 'shot=S18', 3),
  shot('film-S19rise', 'S19', 'grand', 'channel=tobi4s_&path=island-rise', 4, UHD),
  shot('film-S19map', 'S19', 'atlas', 'shot=S19', 5, UHD),
  shot('film-S20', 'S20', 'raid', 'shot=S20', 3),
  shot('film-S21', 'S21', 'atlas', 'shot=S21', 4, UHD),
  shot('film-S22', 'S22', 'kingdom', 'shot=S22', 7),
];
