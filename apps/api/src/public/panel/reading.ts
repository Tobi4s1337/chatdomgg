import type { Pool } from 'pg';
import type { CardHome, CardSource, CitizenKey, KingdomId } from '../../citizen-card/contracts';
import type { PanelCardWire, PanelHomeTier, PanelReading, PanelViewerWire } from './contracts';
import type { PanelViewer } from './token';
import type { TwitchUsers } from './twitch-users';

/**
 * The kingdom's own records, read for one viewer's panel. Read-only against the realm schema the realm writes:
 *
 * - a home is an installed deed (`realm_deeds`), with the street, number, tier and quarter the settlement plan gave it,
 *   and the day the kingdom raised it;
 * - a guest is the realm's own guest record (three homes kept elsewhere);
 * - the name is the person's public Twitch display name (Helix), falling back to the name the kingdom already approved
 *   for them from chat or sign-in;
 * - other homes show only once the person has signed in to Chatdom or shared their identity with the panel.
 *
 * Nothing is invented: what no authority has witnessed yet (follow date, subscription, citizen number, portrait) is
 * left for the card to say "not known yet".
 */
export interface PanelAuthority {
  reading(viewer: PanelViewer, signal?: AbortSignal): Promise<PanelReading>;
  /** The trusted card source for the passport reader: the same records, in the card authority's terms. */
  cardSource(key: CitizenKey, sharedAt: number, signal?: AbortSignal): Promise<CardSource>;
}

export interface PanelAuthorityOptions {
  readonly pool: Pool;
  readonly origin: 'live' | 'simulated';
  readonly publicOrigin: string;
  readonly users: TwitchUsers;
  /** The approved public name of a kingdom, as the realm's entry gate serves it. Null when it has none. */
  readonly kingdomName: (kingdomId: string) => Promise<string | null>;
}

interface DeedRow { kingdom_id: string; placement: string; settled_ms: string | null; allocated_ms: string; status: string }
interface Placement { street: string; ordinal: number; tier: PanelHomeTier | null; quarterYear: number | null; style: string | null }

const TIERS: ReadonlySet<string> = new Set(['hut', 'cottage', 'house', 'manor', 'hall']);
const TIER_NOUN: Record<PanelHomeTier, string> = { hut: 'hut', cottage: 'cottage', house: 'house', manor: 'manor house', hall: 'hall' };
const STYLE_WORDS: Record<string, string> = {
  hearth: 'warm timber and plaster, with a deep hearth',
  tide: 'whitewashed walls and a sea-blue door',
  grove: 'mossy stone and a low thatched roof',
};
const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const CONTROL = /[\p{Cc}؜‎‏‪-‮⁦-⁩]/gu;
const clean = (value: string, max: number) => value.replace(CONTROL, '').normalize('NFC').trim().slice(0, max);

function placementOf(raw: string): Placement | null {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const street = typeof value.street === 'string' ? clean(value.street, 96) : '';
    const ordinal = typeof value.ordinal === 'number' && Number.isInteger(value.ordinal) && value.ordinal >= 0 ? value.ordinal : null;
    if (!street || ordinal === null) return null;
    return {
      street, ordinal,
      tier: typeof value.tier === 'string' && TIERS.has(value.tier) ? value.tier as PanelHomeTier : null,
      quarterYear: typeof value.quarterYear === 'number' && Number.isInteger(value.quarterYear) ? value.quarterYear : null,
      style: typeof value.style === 'string' ? value.style : null,
    };
  } catch { return null; }
}

/** "Number 5" (plots count from zero; streets count from one). */
const homeName = (placement: Placement) => `Number ${placement.ordinal + 1}`;

export function createPanelAuthority(options: PanelAuthorityOptions): PanelAuthority {
  const { pool, origin } = options;
  const kingdoms = new Map<string, { at: number; value: Promise<PanelReading['kingdom']> }>();

  async function loadKingdom(kingdomId: string): Promise<PanelReading['kingdom']> {
    const known = await pool.query<{ homes: string; plots: string }>(
      `SELECT (SELECT count(*) FROM realm_deeds d WHERE d.kingdom_id = k.kingdom_id AND d.origin = k.origin AND d.status = 'installed') AS homes,
              (SELECT count(*) FROM realm_layout_heads h JOIN realm_layout_plots p ON p.kingdom_id = h.kingdom_id AND p.revision = h.revision
                 WHERE h.kingdom_id = k.kingdom_id AND h.origin = k.origin) AS plots
         FROM realm_kingdoms k WHERE k.kingdom_id = $1 AND k.origin = $2`, [kingdomId, origin]);
    const row = known.rows[0];
    if (!row) return null;
    const name = await options.kingdomName(kingdomId);
    if (!name) return null;
    const homes = Number(row.homes), plots = Number(row.plots);
    const motto = homes === 0 ? `${plots} ${plots === 1 ? 'home' : 'homes'} waiting for chat` : homes === 1 ? `One home lit by chat, of ${plots}` : `${homes} homes lit by chat, of ${plots}`;
    return { name, tier: plots > 64 ? 'town' : 'hamlet', motto, walk: `${options.publicOrigin}/?walk=1&kingdom=${kingdomId}` };
  }

  function kingdom(kingdomId: string): Promise<PanelReading['kingdom']> {
    const cached = kingdoms.get(kingdomId);
    if (cached && Date.now() - cached.at < 30_000) return cached.value;
    const value = loadKingdom(kingdomId);
    kingdoms.set(kingdomId, { at: Date.now(), value });
    value.catch(() => kingdoms.delete(kingdomId));
    if (kingdoms.size > 1_000) kingdoms.delete(kingdoms.keys().next().value!);
    return value;
  }

  /** Everything the records say about one person, read in one round of queries. */
  async function records(personId: string, kingdomId: string) {
    const [deeds, guest, person, chatName] = await Promise.all([
      pool.query<DeedRow>(`SELECT kingdom_id, placement, settled_ms::text, allocated_ms::text, status FROM realm_deeds
        WHERE person_id = $1 AND origin = $2 AND status = 'installed' ORDER BY allocated_ms LIMIT 3`, [personId, origin]),
      pool.query<{ reason: string }>('SELECT reason FROM realm_guests WHERE kingdom_id = $1 AND person_id = $2', [kingdomId, personId]),
      pool.query<{ created_ms: string; public_name: string | null }>(`SELECT (extract(epoch FROM created_at) * 1000)::bigint::text AS created_ms, public_name
        FROM realm_persons WHERE person_id = $1 AND origin = $2`, [personId, origin]),
      pool.query<{ public_name: string }>('SELECT public_name FROM realm_citizen_names WHERE person_id = $1 AND origin = $2', [personId, origin]),
    ]);
    return {
      deeds: deeds.rows.map(row => ({ kingdomId: row.kingdom_id, placement: placementOf(row.placement), at: Number(row.settled_ms ?? row.allocated_ms) }))
        .filter((deed): deed is { kingdomId: string; placement: Placement; at: number } => deed.placement !== null),
      guest: guest.rows.length > 0,
      signedInAt: person.rows[0] ? Number(person.rows[0].created_ms) : null,
      knownName: person.rows[0]?.public_name ?? chatName.rows[0]?.public_name ?? null,
    };
  }

  async function elsewhereOf(deeds: readonly { kingdomId: string; placement: Placement }[], here: string) {
    const out: { kingdomId: string; kingdom: string; home: string; street: string }[] = [];
    for (const deed of deeds) {
      if (deed.kingdomId === here) continue;
      // A home in a kingdom without an approved public name stays off the card rather than showing a number.
      const name = await options.kingdomName(deed.kingdomId).catch(() => null);
      if (name) out.push({ kingdomId: deed.kingdomId, kingdom: name, home: `${homeName(deed.placement)}, ${deed.placement.street}`, street: deed.placement.street });
    }
    return out;
  }

  return {
    async reading(viewer, signal) {
      const place = await kingdom(viewer.channelId);
      if (viewer.kind !== 'shared') return { version: 1, kingdom: place, viewer: { kind: viewer.kind } };
      if (!place) return { version: 1, kingdom: null, viewer: { kind: 'unknown', reason: 'This channel has no kingdom yet, so there is no card to show here.' } };
      const [twitch, record] = await Promise.all([options.users.person(viewer.personId, signal), records(viewer.personId, viewer.channelId)]);
      // A display name that cleans to nothing falls back to the login Twitch shows for the same person.
      const name = [twitch?.displayName, twitch?.login, record.knownName].map(value => (value ? clean(value, 128) : '')).find(Boolean) ?? null;
      if (!name) return { version: 1, kingdom: place, viewer: { kind: 'unknown', reason: 'Twitch has not told us your name just now. Try again in a moment.' } };
      const here = record.deeds.find(deed => deed.kingdomId === viewer.channelId) ?? null;
      // The viewer shared who they are with this panel: their own card shows their other homes to them.
      const elsewhere = (await elsewhereOf(record.deeds, viewer.channelId)).map(({ kingdom, home }) => ({ kingdom, home }));
      const monarch = viewer.personId === viewer.channelId;
      const standing = monarch ? `Monarch of ${place.name}` : here ? `Citizen of ${place.name}` : record.guest ? `Guest of ${place.name}` : `Welcome to ${place.name}`;
      const card = (home: PanelCardWire['home']): PanelCardWire => ({
        name, colour: twitch?.colour ?? null, standing, following: null, subscribed: null, home, elsewhere,
      });
      let result: PanelViewerWire;
      if (monarch) result = { kind: 'monarch', card: card({ name: 'The castle', tier: null }) };
      else if (here) {
        const p = here.placement;
        result = {
          kind: 'citizen', card: card({ name: homeName(p), tier: p.tier }),
          home: {
            street: p.street,
            place: p.quarterYear ? `${homeName(p)} on ${p.street}, in the ${p.quarterYear} quarter` : `${homeName(p)} on ${p.street}`,
            description: p.tier ? `A ${TIER_NOUN[p.tier]} of ${STYLE_WORDS[p.style ?? ''] ?? 'the kingdom’s own style'}. The kingdom raised it for you on ${DAY.format(here.at)}.`
              : `The kingdom raised it for you on ${DAY.format(here.at)}.`,
            since: DAY.format(here.at),
          },
        };
      } else if (record.guest) result = { kind: 'guest', card: card(null) };
      else result = { kind: 'newcomer', card: card(null) };
      return { version: 1, kingdom: place, viewer: result };
    },

    async cardSource(key, sharedAt, signal) {
      const place = await kingdom(key.kingdomId);
      if (!place) throw new Error('This channel has no kingdom');
      const [twitch, record] = await Promise.all([options.users.person(key.personId, signal), records(key.personId, key.kingdomId)]);
      if (!twitch) throw new Error('Twitch did not answer for this person');
      const here = record.deeds.find(deed => deed.kingdomId === key.kingdomId) ?? null;
      const monarch = String(key.personId) === String(key.kingdomId);
      const elsewhere = await elsewhereOf(record.deeds, key.kingdomId);
      const homes: CardHome[] = [
        ...(here && !monarch ? [{ kingdomId: key.kingdomId, kingdomName: place.name, home: homeName(here.placement), street: here.placement.street, image: null, path: null }] : []),
        ...elsewhere.filter(home => home.kingdomId !== String(key.personId))
          .map(home => ({ kingdomId: home.kingdomId as KingdomId, kingdomName: home.kingdom, home: home.home.split(',')[0]!, street: home.street, image: null, path: null })),
      ];
      const latest = Math.max(0, ...record.deeds.map(deed => deed.at));
      return {
        document: {
          key, kingdomName: place.name, origin,
          // Revisions only grow as records accrue, so the passport reader's never-backwards rule holds.
          revision: { person: Math.max(record.signedInAt ?? 0, latest), citizen: latest },
          identity: { login: twitch.login, name: clean(twitch.displayName, 128) || twitch.login, colour: twitch.colour, office: monarch ? 'monarch' : null, portrait: null },
          tenure: { followedAt: null, subscribedMonths: null, activeTier: null },
          citizenNumber: null,
          address: here && !monarch ? { home: homeName(here.placement), street: here.placement.street } : null,
          homes: homes.slice(0, 3),
          castle: monarch ? { kingdomId: key.kingdomId, kingdomName: place.name, home: 'The castle', street: null, image: null, path: null } : null,
          // No Gate stamps are recorded for anyone yet; the book shows its honest empty pages.
          passport: { hidden: false, stamps: { availability: 'known', entries: [], next: null } },
          pieces: { availability: 'unavailable' }, honours: { availability: 'unavailable' }, house: null,
        },
        // The panel viewer is reading their own card, having verified who they are through Twitch: that share is
        // their own entrance, for their own view only. It is never written anywhere or shown to anyone else.
        subjectFirstSignedInAt: record.signedInAt ?? sharedAt,
        travelsHidden: false,
        dependencies: [],
      };
    },
  };
}
