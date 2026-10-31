import { describe, expect, it } from 'vitest';
import { simulatedPassport } from './fixtures';
import { escapeMarkup, stampMarkup, armsMarkup } from './markup';
import { SHARE_GIFTS, SHARE_KINGDOMS, SHARE_STAMPS, composePassportShare, curateShareSpread, shareAlt } from './share';
import type { StampView, VisiblePassportView } from './types';

const many = simulatedPassport('many');
const few = simulatedPassport('few');
const none = simulatedPassport('none');

describe('the share spread is curated by rule, honestly', () => {
  it('takes the newest journeys exactly in the authority’s order and says when more are further back', () => {
    const spread = curateShareSpread(many);
    expect(spread.stamps.map(stamp => stamp.id)).toEqual(many.stamps.items.slice(0, SHARE_STAMPS).map(stamp => stamp.id));
    expect(spread.moreStamps).toBe(true);
    expect(spread.kingdoms.length).toBeLessThanOrEqual(SHARE_KINGDOMS);
    expect(spread.kingdoms.map(visit => visit.kingdom.kingdomId)).toEqual(many.kingdoms.items.slice(0, SHARE_KINGDOMS).map(visit => visit.kingdom.kingdomId));
  });

  it('does not claim more when the first page is the whole history', () => {
    const short: VisiblePassportView = { ...few, stamps: { items: few.stamps.items.slice(0, 2), nextCursor: null } };
    const spread = curateShareSpread(short);
    expect(spread.stamps).toHaveLength(2);
    expect(spread.moreStamps).toBe(false);
    expect(composePassportShare(short).html).not.toContain('further back');
  });

  it('a further page alone is enough to say the book goes on, without loading it', () => {
    const paged: VisiblePassportView = { ...few, stamps: { items: few.stamps.items.slice(0, 1), nextCursor: 'sim:stamps:1' } };
    expect(curateShareSpread(paged).moreStamps).toBe(true);
  });

  it('an empty book is a named flyleaf and room for the first journey, with no stamp, arms or counter', () => {
    const share = composePassportShare(none);
    expect(share.spread.empty).toBe(true);
    expect(share.html).toContain('Room for the first journey');
    expect(share.html).toContain(escapeMarkup(none.holder.name));
    expect(share.html).not.toMatch(/class="(entry|reached|pp-stamp)/);
    expect(share.html).not.toMatch(/\b0 (journeys|stamps|kingdoms)\b/);
    expect(share.alt).toContain('room for the first journey');
  });
});

describe('the share composition', () => {
  it('is the same document for the same book, so the picture never drifts between renders', () => {
    expect(composePassportShare(many).html).toBe(composePassportShare(many).html);
  });

  it('draws each journey with the book’s own stamp markup and ink', () => {
    const html = composePassportShare(few).html;
    few.stamps.items.slice(0, SHARE_STAMPS).forEach((stamp, i) => expect(html).toContain(stampMarkup(stamp, `share-s${i}`)));
  });

  it('fetches nothing and runs nothing: inline styles only, a closed policy, no script and no URL', () => {
    const html = composePassportShare(many, { fontFaces: "@font-face{font-family:'Alegreya';src:url(data:font/woff2;base64,AAAA)}" }).html;
    expect(html).toContain(`default-src 'none'`);
    expect(html).not.toMatch(/<script|javascript:|https?:\/\/(?!www\.w3\.org\/2000\/svg)/i);
    expect(html).toContain('data:font/woff2;base64,AAAA');
  });

  it('escapes every name it was given', () => {
    const hostile = '<img src=x onerror=alert(1)>&"\'';
    const stamp = few.stamps.items.find(item => item.kind === 'raid')! as Extract<StampView, { kind: 'raid' }>;
    const book: VisiblePassportView = {
      ...few, holder: { ...few.holder, name: hostile },
      stamps: { items: [{ ...stamp, kingdom: { ...stamp.kingdom, name: hostile }, leader: { personId: '1', name: hostile }, gifts: [{ id: 'g', name: hostile, direction: 'left', keepsakeId: null }] }], nextCursor: null },
    };
    const html = composePassportShare(book, { places: new Map([[stamp.road.from, hostile]]), site: hostile }).html;
    expect(html).not.toContain('<img');
    expect(html).not.toContain('onerror=alert(1)>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;&amp;&quot;&#39;');
  });

  it('keeps long and non-Latin names whole, isolated for direction, never cut', () => {
    const arabic = 'نور الهدى بنت سليمان من واحة النخيل البعيدة';
    const html = composePassportShare({ ...few, holder: { ...few.holder, name: arabic } }).html;
    expect(html).toContain(`<bdi dir="auto">${arabic}</bdi>`);
    expect(html).toContain('data-length="long"');
    const brindle = few.stamps.items.find(stamp => stamp.kingdom.name.startsWith('Brindlewick'))!;
    expect(html).toContain(brindle.kingdom.name);
    expect(html).not.toMatch(/text-overflow|line-clamp/);
  });

  it('says SIMULATED with one corner chip when the book is simulated, and not otherwise', () => {
    expect(composePassportShare(few).html).toContain('<b>SIMULATED</b>');
    expect(composePassportShare(few).alt).toContain('SIMULATED');
    const live: VisiblePassportView = { ...few, origin: 'live' };
    expect(composePassportShare(live).html).not.toContain('SIMULATED');
    expect(composePassportShare(live).alt).not.toContain('SIMULATED');
  });

  it('names a road’s start only when the book or the card already shows that kingdom', () => {
    const raid = few.stamps.items.find(stamp => stamp.kind === 'raid')! as Extract<StampView, { kind: 'raid' }>;
    const book: VisiblePassportView = { ...few, stamps: { items: [raid], nextCursor: null } };
    expect(composePassportShare(book).html).not.toContain('By the road from');
    expect(composePassportShare(book, { places: new Map([[raid.road.from, 'Gorsehold']]) }).html).toContain('By the road from <bdi dir="auto">Gorsehold</bdi>');
  });

  it('writes accepted gifts left or brought back, and points to the book for the rest', () => {
    const stamp = few.stamps.items[0]!;
    const gifts = Array.from({ length: SHARE_GIFTS + 2 }, (_, i) => ({ id: `g${i}`, name: `Gift ${i}`, direction: i % 2 ? 'brought-back' as const : 'left' as const, keepsakeId: null }));
    const html = composePassportShare({ ...few, stamps: { items: [{ ...stamp, gifts }], nextCursor: null } }).html;
    expect(html).toContain('<span class="way">Left</span> <bdi dir="auto">Gift 0</bdi>');
    expect(html).toContain('<span class="way">Brought back</span> <bdi dir="auto">Gift 1</bdi>');
    expect(html).not.toContain('Gift 2');
    expect(html).toContain('and more written in the book');
  });

  it('describes in words exactly what it shows, with no totals', () => {
    const alt = shareAlt(curateShareSpread(many));
    expect(alt).toContain(`The passport of ${many.holder.name}`);
    for (const stamp of many.stamps.items.slice(0, SHARE_STAMPS)) expect(alt).toContain(stamp.kingdom.name);
    expect(alt).toContain('Older journeys are further back in the book');
    expect(alt).not.toMatch(/\b(84|eighty)/i);
  });
});

describe('the drawn marks', () => {
  it('lands each stamp by its record ID: the same ID draws the same mark, another ID lands differently', () => {
    const stamp = many.stamps.items[0]!;
    expect(stampMarkup(stamp, 'a')).toBe(stampMarkup(stamp, 'a'));
    expect(stampMarkup({ ...stamp, id: `${stamp.id}-other` }, 'a')).not.toBe(stampMarkup(stamp, 'a'));
  });

  it('keeps element IDs safe inside url() references', () => {
    expect(stampMarkup(many.stamps.items[0]!, 'x") y<z')).toContain('id="xyz-ink"');
  });

  it('refuses a tincture the schema would not allow rather than writing it into markup', () => {
    const crest = { ...many.stamps.items[0]!.kingdom.crest, colours: ['#7a432b', 'red;fill:url(x)'] };
    expect(() => armsMarkup(crest, 'a')).toThrow(/tincture/);
  });
});
