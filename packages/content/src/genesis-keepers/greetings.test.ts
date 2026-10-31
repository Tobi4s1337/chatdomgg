import { describe, expect, it } from 'vitest';
import { GREETINGS, hourWord, keeperGreeting, type GreetingFact, type KeeperGreetingFacts, type KeeperSpeaker } from './greetings';
import { KEEPER_ROLES, KEEPER_TEMPERAMENTS } from './types';

const SLOTS = new Set(['name', 'keeper', 'place', 'hour', 'street']);
const slotsOf = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]!);
/** Words and numbers that would state a channel or audience fact no keeper witnessed. */
const CHANNEL_FACT = /\b(follow\w*|subs?|subscri\w*|gift\w*|stream\w*|viewers?|watch\w*|chat\w*|twitch|bits?|cheer\w*|raid\w*|emotes?|hype|prime|clips?|vods?|years?|months?|weeks?|days?|since|anniversary|streak)\b|\d/i;

const speaker = (role: KeeperSpeaker['role'], temperament: KeeperSpeaker['temperament']): KeeperSpeaker =>
  ({ role, temperament, name: 'Wren', placeName: 'Bell Court', seedKey: 'test' });
const citizen = { publicName: 'Moss', nameCheck: 'passed' } as const;
const VISITS = ['first-witnessed', 'returning-witnessed', 'unknown'] as const;
const FACT_SETS: KeeperGreetingFacts[] = [];
for (const c of [citizen, null]) for (const visit of VISITS) for (const home of [{ street: 'Tallow Lane' }, null]) FACT_SETS.push({ citizen: c, visit, realmHour: 19, home });
const SALTS = Array.from({ length: 64 }, (_, i) => `person-${i}/day-${i % 7}`);

describe('authored greeting lines', () => {
  it('have unique ids across every role and temperament', () => {
    const ids = KEEPER_ROLES.flatMap(role => KEEPER_TEMPERAMENTS.flatMap(t => GREETINGS[role][t].map(line => line.id)));
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const role of KEEPER_ROLES) for (const temperament of KEEPER_TEMPERAMENTS) {
    describe(`${temperament} ${role}`, () => {
      const lines = GREETINGS[role][temperament];

      it('can always greet: at least one line needs no facts', () => {
        expect(lines.some(line => line.needs.length === 0)).toBe(true);
      });

      it('uses only known slots, and every personal slot is backed by its fact', () => {
        for (const line of lines) {
          const used = slotsOf(line.text);
          for (const slot of used) expect(SLOTS.has(slot), `${line.id}: {${slot}}`).toBe(true);
          expect(used.includes('name'), line.id).toBe(line.needs.includes('name'));
          expect(used.includes('street'), line.id).toBe(line.needs.includes('street'));
          expect(new Set(line.needs).size).toBe(line.needs.length);
        }
      });

      it('states no channel, stream or audience fact', () => {
        for (const line of lines) expect(line.text, line.id).not.toMatch(CHANNEL_FACT);
      });
    });
  }
});

describe('keeperGreeting', () => {
  it('is deterministic for the same speaker, facts and salt, and varies across salts', () => {
    const facts: KeeperGreetingFacts = { citizen, visit: 'returning-witnessed', realmHour: 9, home: { street: 'Tallow Lane' } };
    for (const role of KEEPER_ROLES) for (const temperament of KEEPER_TEMPERAMENTS) {
      const who = speaker(role, temperament);
      for (const salt of SALTS.slice(0, 8)) expect(keeperGreeting(who, facts, salt)).toEqual(keeperGreeting(who, facts, salt));
      expect(new Set(SALTS.map(salt => keeperGreeting(who, facts, salt).lineId)).size).toBeGreaterThan(1);
    }
  });

  it('speaks only the facts the realm recorded, and fills every slot', () => {
    for (const role of KEEPER_ROLES) for (const temperament of KEEPER_TEMPERAMENTS) {
      const who = speaker(role, temperament);
      for (const facts of FACT_SETS) for (const salt of SALTS) {
        const greeting = keeperGreeting(who, facts, salt);
        const line = GREETINGS[role][temperament].find(l => l.id === greeting.lineId)!;
        expect(line).toBeDefined();
        expect(greeting.used).toEqual(line.needs);
        expect(greeting.text).not.toContain('{');
        expect(greeting.text).not.toContain('}');
        const forbidden: GreetingFact[] = [];
        if (!facts.citizen) forbidden.push('name', 'street');
        if (facts.visit !== 'first-witnessed') forbidden.push('first');
        if (facts.visit !== 'returning-witnessed') forbidden.push('returning');
        if (!facts.home) forbidden.push('street');
        for (const fact of forbidden) expect(greeting.used, `${greeting.lineId} with ${JSON.stringify(facts)}`).not.toContain(fact);
        if (!facts.citizen) expect(greeting.text).not.toContain('Moss');
        if (greeting.used.includes('name')) expect(greeting.text).toContain('Moss');
        if (greeting.used.includes('street')) expect(greeting.text).toContain('Tallow Lane');
      }
    }
  });

  it('never claims a first or returning visit the realm did not witness', () => {
    for (const role of KEEPER_ROLES) for (const temperament of KEEPER_TEMPERAMENTS) {
      for (const c of [citizen, null]) for (const salt of SALTS) {
        const { used } = keeperGreeting(speaker(role, temperament), { citizen: c, visit: 'unknown', realmHour: 14, home: null }, salt);
        expect(used).not.toContain('first');
        expect(used).not.toContain('returning');
      }
    }
  });

  it('refuses a name that did not pass the name check', () => {
    const failed = { citizen: { publicName: 'Moss', nameCheck: 'failed' as unknown as 'passed' }, visit: 'unknown', realmHour: 8, home: null } as const;
    expect(() => keeperGreeting(speaker('innkeeper', 'hearty'), failed, 'salt')).toThrow(/name check/);
  });

  it('refuses a non-finite hour', () => {
    expect(() => keeperGreeting(speaker('lamplighter', 'gentle'), { citizen: null, visit: 'unknown', realmHour: Number.NaN, home: null }, 'salt')).toThrow(/finite/);
  });
});

describe('hourWord', () => {
  it('turns at five, noon and five', () => {
    expect(hourWord(4.99)).toBe('evening');
    expect(hourWord(5)).toBe('morning');
    expect(hourWord(11.99)).toBe('morning');
    expect(hourWord(12)).toBe('afternoon');
    expect(hourWord(16.99)).toBe('afternoon');
    expect(hourWord(17)).toBe('evening');
    expect(hourWord(0)).toBe('evening');
  });

  it('wraps negative hours and hours past a day', () => {
    expect(hourWord(-1)).toBe('evening');
    expect(hourWord(-19)).toBe('morning');
    expect(hourWord(-12)).toBe('afternoon');
    expect(hourWord(24)).toBe('evening');
    expect(hourWord(29)).toBe('morning');
    expect(hourWord(36)).toBe('afternoon');
    expect(hourWord(24 * 5 + 17)).toBe('evening');
  });

  it('throws on a non-finite hour', () => {
    for (const hour of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) expect(() => hourWord(hour)).toThrow(/finite/);
  });
});
