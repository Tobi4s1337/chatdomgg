import { describe, expect, it } from 'vitest';
import { CITIZEN_SHARE_SIZE, CITIZEN_SHARE_STAMPS, CITIZEN_SHARE_WORN, acceptedPortrait, composeCitizenShare, nameInk, type CitizenShareCard } from './card-share';
import { FIXTURE_KINGDOMS, simulatedPassport } from './fixtures';
import { escapeMarkup, stampMarkup } from './markup';
import type { StampView } from './types';

const many = simulatedPassport('many');
const few = simulatedPassport('few');
const none = simulatedPassport('none');
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const card = (overrides: Partial<CitizenShareCard> = {}): CitizenShareCard => ({
  origin: 'live', name: 'Wren Tarnwalker', login: 'wren_tarnwalker', colour: '#b22222',
  standing: ['Knight of the Watch', 'Citizen No. 212'],
  kingdom: { name: 'Lanternmere', crest: { key: 'crest:lantern:1', shape: 'heater', charge: 'star', colours: ['#2d3f66', '#e9c46a', '#8c2f24'], assetHash: null } },
  home: { name: 'Lantern Cottage', street: 'Old Row', tier: 'A cottage' },
  tenure: [{ label: 'Following since', value: '14 Feb 2022', mark: 'follow' }, { label: 'Subscribed', value: '14 months, Tier 1', mark: 'subscribed' }],
  portrait: { src: PNG, alt: 'A painted voxel bust of Wren' },
  worn: [{ name: 'Ember-stitched cloak', story: 'Earned at the Midsummer bonfire' }],
  passport: { hidden: false, book: { ...many, origin: 'live' } },
  ...overrides,
});

/** Everything a hidden passport must keep out of the picture: the book's kingdoms, leaders, gifts, bonds and its counts. */
function travelWords(): string[] {
  const words = new Set<string>(['Raid', 'raid', 'Visited', 'journey', 'passport', 'Passport', 'further back']);
  for (const stamp of many.stamps.items) {
    words.add(stamp.kingdom.name);
    if (stamp.kind === 'raid' && stamp.leader) words.add(stamp.leader.name);
    for (const gift of stamp.gifts) words.add(gift.name);
  }
  for (const bond of many.bonds.items) words.add(bond.name);
  for (const keepsake of many.keepsakes.items) words.add(keepsake.name);
  words.add(many.holder.name === 'Wren Tarnwalker' ? '' : many.holder.name);
  words.delete('');
  return [...words];
}

describe('the citizen share picture', () => {
  it('is the same document for the same card, at the Open Graph size', () => {
    const a = composeCitizenShare(card()), b = composeCitizenShare(card());
    expect(a.html).toBe(b.html);
    expect(a.alt).toBe(b.alt);
    expect([a.width, a.height]).toEqual([CITIZEN_SHARE_SIZE.width, CITIZEN_SHARE_SIZE.height]);
    expect([a.width, a.height]).toEqual([1200, 630]);
    expect(a.html).toContain('html,body{width:1200px;height:630px');
  });

  it('fetches nothing and runs nothing: a closed policy, images only from data, no script and no URL', () => {
    const html = composeCitizenShare(card(), { fontFaces: "@font-face{font-family:'Alegreya';src:url(data:font/woff2;base64,AAAA)}" }).html;
    expect(html).toContain(`default-src 'none'`);
    expect(html).toContain('img-src data:');
    expect(html).not.toMatch(/<script|javascript:|\bon[a-z]+=/i);
    expect(html).not.toMatch(/https?:\/\/(?!www\.w3\.org\/2000\/svg)/i);
    expect(html).toContain('data:font/woff2;base64,AAAA');
  });

  it('escapes every text it was given', () => {
    const hostile = '<img src=x onerror=alert(1)>&"\'';
    const share = composeCitizenShare(card({
      name: hostile, login: hostile, standing: [hostile], kingdom: { ...card().kingdom, name: hostile },
      home: { name: hostile, street: hostile, tier: hostile }, tenure: [{ label: hostile, value: hostile }],
      portrait: { src: PNG, alt: hostile }, worn: [{ name: hostile, story: hostile }],
    }), { site: hostile });
    expect(share.html).not.toContain('<img src=x');
    expect(share.html).not.toContain('onerror=alert(1)>');
    expect(share.html).toContain(escapeMarkup(hostile));
  });

  it('draws only inline PNG or WebP bytes as the portrait, and the kingdom’s arms for anything else', () => {
    const remote = composeCitizenShare(card({ portrait: { src: 'https://example.com/me.png', alt: 'Remote' } }));
    expect(remote.html).not.toContain('example.com');
    expect(remote.html).not.toContain('<img');
    expect(remote.html).toContain('class="window arms"');
    expect(remote.html).toContain('Arms of Lanternmere');
    for (const src of ['data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,AAA" onload="x', 'data:text/html;base64,PGI+', 'data:image/png,raw', 'DATA:image/png;base64,AAAA']) {
      expect(acceptedPortrait({ src, alt: '' })).toBeNull();
      expect(composeCitizenShare(card({ portrait: { src, alt: 'x' } })).html).not.toContain('<img');
    }
    expect(acceptedPortrait({ src: 'data:image/webp;base64,UklGRg==', alt: '' })).not.toBeNull();
    const painted = composeCitizenShare(card());
    expect(painted.html).toContain(`<img src="${PNG}" alt="A painted voxel bust of Wren">`);
    expect(composeCitizenShare(card({ portrait: null })).html).toContain('class="window arms"');
  });

  it('opens the passport on its newest journeys in the authority’s order, drawn with the book’s own ink', () => {
    const share = composeCitizenShare(card());
    const shown = many.stamps.items.slice(0, CITIZEN_SHARE_STAMPS);
    shown.forEach((stamp, i) => expect(share.html).toContain(stampMarkup(stamp, `card-s${i}`)));
    expect(share.html).not.toContain(stampMarkup(many.stamps.items[CITIZEN_SHARE_STAMPS]!, `card-s${CITIZEN_SHARE_STAMPS}`));
    expect(share.html).toContain('Older journeys are further back in the book');
    expect(share.alt).toMatch(/passport lies open on its latest journeys/);
    expect(share.html.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<[^>]+>/g, ' ')).not.toMatch(/\b(84|eighty)\b/i);
    expect(share.alt).not.toMatch(/\b(84|eighty)\b/i);
  });

  it('hidden travels draw no book and leak nothing travel-derived into the picture, its title or its words', () => {
    const share = composeCitizenShare(card({ passport: { hidden: true } }));
    expect(share.html).toContain('data-book="none"');
    expect(share.html).not.toMatch(/class="(book|cover|entry|pp-stamp)/);
    // Everything a reader, a crawler or the picture can carry: the document minus its fixed stylesheet.
    const document = share.html.replace(/<style>[\s\S]*?<\/style>/, '');
    const text = document.replace(/<[^>]+>/g, ' ');
    for (const word of travelWords()) {
      expect(document, word).not.toContain(escapeMarkup(word));
      expect(share.alt, word).not.toContain(word);
      expect(share.title, word).not.toContain(word);
    }
    expect(text).not.toMatch(/\d+\s*(raids?|journeys?|stamps?|kingdoms?|visits?)/i);
    expect(`${text} ${share.alt}`).not.toMatch(/\b84\b|eighty/i);
    expect(share.html).not.toMatch(/passport/i);
    // The card itself is all there.
    expect(share.html).toContain('Wren Tarnwalker');
    expect(share.html).toContain('Lantern Cottage');
  });

  it('an empty visible book lies closed with only its holder’s name, nothing pressed into it', () => {
    const share = composeCitizenShare(card({ name: none.holder.name, passport: { hidden: false, book: none } }));
    expect(share.html).toContain('data-book="closed"');
    expect(share.html).toContain(`<span class="cover-name" data-length="mid"><bdi dir="auto">${none.holder.name}</bdi></span>`);
    expect(share.html).not.toMatch(/class="(entry|pp-stamp|kingdom)/);
    expect(share.html).not.toMatch(/\b0 (journeys|stamps|kingdoms)\b/);
    expect(share.alt).toContain('no journeys in it yet');
  });

  it('prints no staged label, chip or sentence, whether the card or its book is illustrative or live', () => {
    for (const shown of [card(), card({ origin: 'simulated' }), card({ passport: { hidden: false, book: few } }), card({ origin: 'simulated', passport: { hidden: true } })]) {
      const share = composeCitizenShare(shown);
      expect(share.html).not.toContain('SIMULATED');
      expect(share.html).not.toContain('class="sim"');
      expect(share.alt).not.toContain('SIMULATED');
    }
  });

  it('keeps long and non-Latin names whole, isolated for direction, never cut', () => {
    const arabic = 'نور الهدى بنت سليمان من واحة النخيل البعيدة';
    const html = composeCitizenShare(card({ name: arabic, kingdom: { ...card().kingdom, name: '霧の港の灯台守の王国' } })).html;
    expect(html).toContain(`<bdi dir="auto">${arabic}</bdi>`);
    expect(html).toContain('class="name" data-length="long"');
    expect(html).toContain('<bdi dir="auto">霧の港の灯台守の王国</bdi>');
    const brindle: StampView = { ...few.stamps.items[0]!, kingdom: FIXTURE_KINGDOMS.brindlewick };
    expect(composeCitizenShare(card({ passport: { hidden: false, book: { ...few, stamps: { items: [brindle], nextCursor: null } } } })).html)
      .toContain(FIXTURE_KINGDOMS.brindlewick.name);
    expect(html).not.toMatch(/text-overflow|line-clamp/);
  });

  it('writes their name in their chat colour only where it reads on parchment', () => {
    expect(nameInk('#b22222')).toEqual({ ink: '#b22222', swatch: null });
    expect(nameInk('#FFD700')).toEqual({ ink: '#2c2118', swatch: '#ffd700' });
    expect(nameInk(null)).toEqual({ ink: '#2c2118', swatch: null });
    expect(nameInk('red;background:url(x)')).toEqual({ ink: '#2c2118', swatch: null });
    expect(composeCitizenShare(card({ colour: '#00ff7f' })).html).toContain('class="swatch" style="background:#00ff7f"');
  });

  it('names at most the first earned pieces, says "Not known yet" for unwitnessed facts, and is honest about no home', () => {
    const worn = Array.from({ length: CITIZEN_SHARE_WORN + 2 }, (_, i) => ({ name: `Piece ${i}`, story: null }));
    const html = composeCitizenShare(card({ worn, home: null, tenure: [{ label: 'Subscribed', value: null }] })).html;
    expect(html).toContain(`Piece ${CITIZEN_SHARE_WORN - 1}`);
    expect(html).not.toContain(`Piece ${CITIZEN_SHARE_WORN}`);
    expect(html).toContain('<strong class="value unknown">Not known yet</strong>');
    expect(html).toContain('Not settled in <bdi dir="auto">Lanternmere</bdi> yet');
    expect(composeCitizenShare(card({ worn: [] })).html).not.toContain('class="worn"');
  });
});
