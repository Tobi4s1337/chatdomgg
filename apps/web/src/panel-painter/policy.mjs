import { createHash } from 'node:crypto';

export const MAX_STILL_BYTES = 60 * 1024;
export const LIVE_INTERVAL_MS = 60_000;
export const RESTING_INTERVAL_MS = 3_600_000;
export const MAX_PAINTED_WINDOWS = 400;

/** The upload header for a painting's lit windows: `slot:x:y` joined by commas, x and y in ten-thousandths. */
export function windowsHeader(marks) {
  const valid = Array.isArray(marks) && marks.length <= MAX_PAINTED_WINDOWS && marks.every(mark => Array.isArray(mark) && mark.length === 3
    && mark.every(part => Number.isSafeInteger(part) && part >= 0) && mark[0] <= 65535 && mark[1] <= 10_000 && mark[2] <= 10_000)
    && new Set(marks.map(([slot]) => slot)).size === marks.length;
  if (!valid) throw new Error('The painting\'s lit windows are unreadable.');
  return marks.map(mark => mark.join(':')).join(',');
}

/** Heartbeat timestamps and delivery sequence numbers do not change the visible kingdom. */
export function paintingRevision(snapshot, clockTime) {
  if (snapshot?.status !== 'kingdom' || snapshot.manifest?.origin !== 'live' || snapshot.presence?.origin !== 'live'
    || snapshot.kingdomId !== snapshot.manifest.kingdomId || snapshot.kingdomId !== snapshot.presence.kingdomId) {
    throw new Error('The painter requires matching public live realm data.');
  }
  const live = snapshot.stream === 'live';
  const windows = snapshot.presence.windows.map(({ slot, present, publicName, since, look }) => ({ slot, present, publicName, since, look }))
    .sort((a, b) => a.slot - b.slot);
  return createHash('sha256').update(JSON.stringify({ scene: snapshot.manifest.sceneHash, stream: snapshot.stream,
    connection: snapshot.presence.connection, windows, moment: snapshot.moment ?? null,
    // A real day cycle changes a live painting even when no citizen moved.
    minute: live ? Math.floor(clockTime / LIVE_INTERVAL_MS) : null,
  })).digest('hex');
}

export function paintingDue(previous, revision, live, now) {
  return !previous || (previous.revision !== revision && now - previous.capturedAt >= (live ? LIVE_INTERVAL_MS : RESTING_INTERVAL_MS));
}

export function readPainterConfig(env) {
  const origin = name => {
    let url;
    try { url = new URL(env[name]); } catch { throw new Error(`${name} must be an HTTP origin.`); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error(`${name} must be an HTTP origin.`);
    }
    return url.origin;
  };
  const secret = name => {
    const value = env[name];
    if (typeof value !== 'string' || value.length < 32 || /[\r\n]/.test(value)) throw new Error(`${name} must contain at least 32 characters.`);
    return value;
  };
  const kingdomIds = [...new Set((env.PANEL_PAINTER_KINGDOM_IDS ?? '').split(',').map(id => id.trim()).filter(Boolean))];
  if (!kingdomIds.length || kingdomIds.length > 16 || kingdomIds.some(id => !/^[1-9][0-9]{0,19}$/.test(id))) {
    throw new Error('PANEL_PAINTER_KINGDOM_IDS must list 1 to 16 channel IDs.');
  }
  const ingressSecret = secret('REALM_INGRESS_PANEL_SECRET'), uploadSecret = secret('PANEL_PAINTER_SECRET');
  if (ingressSecret === uploadSecret) throw new Error('PANEL_PAINTER_SECRET must differ from REALM_INGRESS_PANEL_SECRET.');
  const cdpOrigin = env.PANEL_PAINTER_CDP_ORIGIN ? origin('PANEL_PAINTER_CDP_ORIGIN') : undefined;
  if (cdpOrigin && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(cdpOrigin).hostname)) throw new Error('PANEL_PAINTER_CDP_ORIGIN must use the local GPU tunnel.');
  return { webOrigin: origin('PANEL_PAINTER_WEB_ORIGIN'), apiOrigin: origin('PANEL_PAINTER_API_ORIGIN'), cdpOrigin,
    realmOrigin: origin('PANEL_PAINTER_REALM_ORIGIN'), ingressSecret, uploadSecret, kingdomIds };
}
