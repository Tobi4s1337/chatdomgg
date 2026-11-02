// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { formatRoute, parseRoute } from './route';

describe('Atlas routes', () => {
  it('reads the map and a channel, case-insensitively', () => {
    expect(parseRoute('/map')).toEqual({ kind: 'map' });
    expect(parseRoute('/map/')).toEqual({ kind: 'map' });
    expect(parseRoute('/map/KaiCenat')).toEqual({ kind: 'channel', login: 'kaicenat' });
    expect(parseRoute('/map/x_q_c')).toEqual({ kind: 'channel', login: 'x_q_c' });
  });

  it('reserves no word by accident: a lone road, line, season or atlas is a login', () => {
    for (const word of ['road', 'line', 'season', 'atlas']) expect(parseRoute(`/map/${word}`)).toEqual({ kind: 'channel', login: word });
    expect(parseRoute('/map/line/')).toEqual({ kind: 'channel', login: 'line' });
  });

  it('reads a road between two different logins', () => {
    expect(parseRoute('/map/road/KaiCenat/chrisnxtdoor')).toEqual({ kind: 'road', a: 'kaicenat', b: 'chrisnxtdoor' });
    expect(parseRoute('/map/road/xqc/xqc')).toEqual({ kind: 'unknown' });
    expect(parseRoute('/map/road/xqc')).toEqual({ kind: 'unknown' });
    expect(parseRoute('/map/road/xqc/a/b')).toEqual({ kind: 'unknown' });
  });

  it('reads the reserved line and season routes', () => {
    expect(parseRoute('/map/line/eu-night-train')).toEqual({ kind: 'line', id: 'eu-night-train' });
    expect(parseRoute('/map/season/3')).toEqual({ kind: 'season', n: 3 });
    expect(parseRoute('/map/season/0')).toEqual({ kind: 'unknown' });
    expect(parseRoute('/map/season/x')).toEqual({ kind: 'unknown' });
  });

  it('turns anything else away as unknown', () => {
    expect(parseRoute('/map/not%20a%20login')).toEqual({ kind: 'unknown' });
    expect(parseRoute('/map/%E0%A4%A')).toEqual({ kind: 'unknown' });
    expect(parseRoute(`/map/${'a'.repeat(26)}`)).toEqual({ kind: 'unknown' });
    expect(parseRoute('/kingdom/xqc')).toEqual({ kind: 'unknown' });
    expect(parseRoute('/mapx')).toEqual({ kind: 'unknown' });
  });

  it('writes what it reads', () => {
    for (const path of ['/map', '/map/xqc', '/map/road/kaicenat/chrisnxtdoor', '/map/line/eu-night-train', '/map/season/3']) {
      expect(formatRoute(parseRoute(path))).toBe(path);
    }
    expect(formatRoute({ kind: 'unknown' })).toBe('/map');
  });
});
