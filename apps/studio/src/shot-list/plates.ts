// The kingdom plate the player shows in every page shot, and the S03 push-through continues full frame. It is one
// take, so the page and the full-frame picture are the same frames. TS10 shot `stream-dusk` (screenshots, 1500
// frames); the first cut uses the film take `film-stream-dusk` (a clean canvas capture, rig/film.mjs) once its
// master is verified and unpacked to frames (`node rig/plate-frames.mjs film-stream-dusk`).
export const PLAYER_PLATE: { take: string; frames: number; ext: 'jpg' } = { take: 'stream-dusk', frames: 1500, ext: 'jpg' };
