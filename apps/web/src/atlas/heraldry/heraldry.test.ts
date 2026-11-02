// @vitest-environment node
import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  blazon, channelSeed, chargeSpots, CHARGE_KINDS, COLOURS, designFromSeed, DIVISIONS, drawShield, isMetal,
  METALS, obeysRuleOfTincture, ORDINARIES, PARTITION_LINES, patternKind, sha256, SHIELD_ASPECT, shieldDesign,
  shieldPath, shieldPolygon, toHex, type FieldPattern, type ShieldContext, type ShieldDesign, type Tincture,
} from './index';

// Several sweeps here walk tens of thousands of IDs or every design at every size: seconds of pure CPU on a busy
// shared host, more when the web package runs its files in parallel workers.
vi.setConfig({ testTimeout: 30_000 });

const nodeSha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** A small deterministic generator so the "random" IDs are the same on every run. */
function xorshift(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return s / 0x1_0000_0000;
  };
}

function randomId(r: () => number): string {
  const digits = 4 + Math.floor(r() * 7); // 4 to 10 digits, like real Twitch IDs
  let id = String(1 + Math.floor(r() * 9));
  for (let i = 1; i < digits; i++) id += Math.floor(r() * 10);
  return id;
}

const r = xorshift(20261030);
const SEQUENTIAL = Array.from({ length: 20_000 }, (_, i) => String(141_000_000 + i));
const RANDOM = Array.from({ length: 20_000 }, () => randomId(r));
const ALL = [...SEQUENTIAL, ...RANDOM].map((id) => ({ id, design: shieldDesign(id) }));

/** Everything that shows on the map, without the texture seed. */
const look = (design: ShieldDesign): string => JSON.stringify({ ...design, grain: 0 });

describe('sha256', () => {
  it('matches node:crypto on the standard vectors and on awkward lengths', () => {
    const enc = new TextEncoder();
    expect(toHex(sha256(new Uint8Array()))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(toHex(sha256(enc.encode('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    for (const len of [1, 31, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 1000, 4097]) {
      const bytes = new Uint8Array(randomBytes(len));
      expect(toHex(sha256(bytes))).toBe(nodeSha(bytes));
    }
    const multibyte = 'Grüße, 王国 🏰';
    expect(toHex(sha256(enc.encode(multibyte)))).toBe(nodeSha(enc.encode(multibyte)));
  });

  it('seeds a channel with SHA-256 of its decimal ID', () => {
    for (const id of ['1', '12826', '141981764', '99999999999999999999999999999999', ...RANDOM.slice(0, 200)]) {
      const seed = channelSeed(id);
      expect(seed).toHaveLength(32);
      expect(toHex(seed)).toBe(createHash('sha256').update(id, 'utf8').digest('hex'));
    }
  });

  it('rejects anything that is not a decimal channel ID', () => {
    const bad = ['', '0', '012', '12a', ' 12', '12 ', '-1', '1e9', '1.5', '١٢٣', 'tobi4s_', 'chatdom', '1'.repeat(33)];
    for (const id of bad) {
      expect(() => channelSeed(id)).toThrow(TypeError);
      expect(() => shieldDesign(id)).toThrow(TypeError);
    }
    expect(() => shieldDesign(12826 as unknown as string)).toThrow(TypeError);
    expect(() => designFromSeed(new Uint8Array(16))).toThrow(RangeError);
  });
});

describe('shieldDesign', () => {
  it('is deterministic and takes only the channel ID', () => {
    expect(shieldDesign.length).toBe(1);
    for (const { id, design } of ALL.slice(0, 2000)) {
      expect(shieldDesign(id)).toEqual(design);
      expect(designFromSeed(channelSeed(id))).toEqual(design);
    }
  });

  it('keeps the arms of real channels stable (bump HERALDRY_VERSION when these change on purpose)', () => {
    expect(shieldDesign('12826')).toEqual({ version: 1, field: 'azure', pattern: 'pile', line: 'straight', second: 'or', grain: 1878582336 });
    expect(shieldDesign('71092938')).toEqual({
      version: 1, field: 'argent', pattern: 'chief', line: 'straight', second: 'vert', grain: 1048411495,
      charge: { kind: 'mullet', count: 3, placement: 'onOrdinary', tincture: 'argent' },
    });
    expect(blazon(shieldDesign('26261471'))).toBe('Sable, three fishes naiant Argent');
    expect(blazon(shieldDesign('1'))).toBe('Per chevron Gules and Argent');
  });

  it('obeys the rule of tincture over 40,000 sequential and random IDs', () => {
    for (const { id, design } of ALL) {
      if (!obeysRuleOfTincture(design)) throw new Error(`${id}: ${blazon(design)}`);
      // Two tinctures only, one metal and one colour.
      expect(isMetal(design.field)).not.toBe(isMetal(design.second));
      const c = design.charge;
      if (c && c.tincture !== 'counterchanged') expect([design.field, design.second]).toContain(c.tincture);
    }
  });

  it('spreads across every tincture, pattern, line and charge, with Gules never ahead of another colour', () => {
    const tinctures = new Map<Tincture, number>();
    const patterns = new Map<FieldPattern, number>();
    const lines = new Set<string>();
    const charges = new Set<string>();
    let charged = 0, plain = 0, divisions = 0, ordinaries = 0;
    for (const { design } of ALL) {
      for (const t of [design.field, design.second]) tinctures.set(t, (tinctures.get(t) ?? 0) + 1);
      patterns.set(design.pattern, (patterns.get(design.pattern) ?? 0) + 1);
      lines.add(design.line);
      if (design.charge) { charged++; charges.add(design.charge.kind); }
      const kind = patternKind(design.pattern);
      if (kind === 'plain') plain++; else if (kind === 'division') divisions++; else ordinaries++;
    }
    for (const t of [...METALS, ...COLOURS]) expect(tinctures.get(t) ?? 0).toBeGreaterThan(1000);
    for (const p of ['plain', ...DIVISIONS, ...ORDINARIES] as FieldPattern[]) expect(patterns.get(p) ?? 0).toBeGreaterThan(400);
    expect([...lines].sort()).toEqual([...PARTITION_LINES].sort());
    expect([...charges].sort()).toEqual([...CHARGE_KINDS].sort());

    const gules = tinctures.get('gules')!;
    for (const c of COLOURS) if (c !== 'gules') expect(gules).toBeLessThan(tinctures.get(c)!);

    const n = ALL.length;
    // Intended: about 30 % charged, 7 % plain fields (always charged), 41 % divisions, 52 % ordinaries.
    expect(charged / n).toBeGreaterThan(0.25);
    expect(charged / n).toBeLessThan(0.35);
    expect(plain / n).toBeGreaterThan(0.05);
    expect(plain / n).toBeLessThan(0.09);
    expect(divisions / n).toBeGreaterThan(0.36);
    expect(ordinaries / n).toBeGreaterThan(0.46);
    // Most edges are straight; patterned lines are an accent.
    const straight = ALL.filter(({ design }) => design.line === 'straight').length / n;
    expect(straight).toBeGreaterThan(0.65);
    expect(straight).toBeLessThan(0.85);
  });

  it('gives neighbouring IDs different arms in the vast majority of cases', () => {
    const rnd = xorshift(7);
    let same = 0, total = 0;
    for (const id of [...SEQUENTIAL.slice(0, 2500), ...RANDOM.slice(0, 2500)]) {
      const pos = Math.floor(rnd() * id.length);
      const old = Number(id[pos]);
      let digit = (old + 1 + Math.floor(rnd() * 9)) % 10;
      if (pos === 0 && digit === 0) digit = old === 1 ? 2 : 1;
      const other = id.slice(0, pos) + digit + id.slice(pos + 1);
      expect(other).not.toBe(id);
      total++;
      if (look(shieldDesign(other)) === look(shieldDesign(id))) same++;
    }
    expect(same / total).toBeLessThan(0.02);
  });

  it('places every charge inside the shield', () => {
    for (const { design } of ALL.slice(0, 5000)) {
      const spots = chargeSpots(design);
      expect(spots).toHaveLength(design.charge?.count ?? 0);
      for (const s of spots) {
        expect(s.x - s.size / 2).toBeGreaterThanOrEqual(0);
        expect(s.x + s.size / 2).toBeLessThanOrEqual(1);
        expect(s.y - s.size / 2).toBeGreaterThanOrEqual(0);
        expect(s.y + s.size / 2).toBeLessThanOrEqual(SHIELD_ASPECT);
      }
    }
  });

  it('blazons every design in words', () => {
    for (const { design } of ALL.slice(0, 3000)) {
      const words = blazon(design);
      expect(words.length).toBeGreaterThan(8);
      expect(words).not.toMatch(/undefined|null/);
    }
  });
});

describe('drawing', () => {
  /** A stand-in context that records calls, so drawing can be checked without a canvas. */
  function recorder(scale = 2): { ctx: ShieldContext; calls: string[]; depth: () => number } {
    const calls: string[] = [];
    let depth = 0;
    const gradient = { addColorStop: () => undefined };
    const target: Record<string, unknown> = {
      save: () => { depth++; calls.push('save'); },
      restore: () => { depth--; calls.push('restore'); },
      getTransform: () => ({ a: scale, b: 0, c: 0, d: scale }),
      createLinearGradient: () => gradient,
    };
    const ctx = new Proxy(target, {
      get(t, key: string) {
        if (key in t) return t[key];
        return (...args: unknown[]) => {
          calls.push(key);
          for (const a of args) if (typeof a === 'number' && !Number.isFinite(a)) throw new Error(`${key}: non-finite argument`);
        };
      },
      set(t, key: string, value) { t[key] = value; return true; },
    }) as unknown as ShieldContext;
    return { ctx, calls, depth: () => depth };
  }

  it('draws every kind of design at every size without leaking state', () => {
    const seen = new Set<string>();
    const samples = ALL.filter(({ design }) => {
      const key = `${design.pattern}/${design.line}/${design.charge?.kind ?? '-'}/${design.charge?.placement ?? '-'}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    for (const { design } of samples) {
      for (const width of [14, 20, 32, 48, 96]) {
        const { ctx, calls, depth } = recorder(width > 40 ? 1 : 2);
        drawShield(ctx, design, 10, 10, width, { halo: true });
        expect(depth()).toBe(0);
        expect(calls).toContain('clip');
        expect(calls.filter((c) => c === 'stroke').length).toBeGreaterThan(0);
      }
    }
  });

  it('traces the outline for hit areas', () => {
    const { ctx, calls } = recorder();
    shieldPath(ctx, 0, 0, 20);
    expect(calls[0]).toBe('moveTo');
    expect(calls.at(-1)).toBe('closePath');
    const poly = shieldPolygon(5, 7, 20);
    expect(poly.length % 2).toBe(0);
    const ys = poly.filter((_, i) => i % 2 === 1);
    expect(Math.min(...ys)).toBeCloseTo(7);
    expect(Math.max(...ys)).toBeCloseTo(7 + 20 * SHIELD_ASPECT);
  });
});
