#!/usr/bin/env node
// Generates the exhaustive EventSub catalogue from the official Twitch docs HTML:
//   references/subscription-types.md   - every subscription type+version (condition, auth/scopes, status)
//   references/subscription-types.json - same data, machine-readable
//   references/event-objects.md        - every object table from the EventSub Reference page
//                                        (conditions, events, shared objects) as markdown tables
//   references/payloads.md             - curated top events (list in payloads-curation.ts): fields + example JSON
//   assets/templates/types.ts          - TS event/condition types for every type (latest version)
//
// Usage:
//   node scripts/gen-subscription-types.ts                 # fetch live pages from dev.twitch.tv
//   node scripts/gen-subscription-types.ts --html-dir DIR  # use DIR/eventsub_eventsub-subscription-types.html
//   node scripts/gen-subscription-types.ts --html-dir DIR --only channel.follow,channel.raid --out src/eventsub/types.ts
//                                                          # trimmed types.ts for a project (writes nothing else)
//                                                          #   + DIR/eventsub_eventsub-reference.html
// Zero dependencies (Node >= 22, type stripping). Erasable TS only.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CURATED } from './payloads-curation.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REFS = join(HERE, '..', 'references');
const TYPES_URL = 'https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/';
const REF_URL = 'https://dev.twitch.tv/docs/eventsub/eventsub-reference/';

// ---------- tiny HTML helpers (the docs HTML is regular, Jekyll-generated) ----------
function decode(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'").replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}
/** HTML fragment -> one line of markdown-ish text. */
function text(html: string): string {
  return decode(
    html
      .replace(/<code[^>]*>([\s\S]*?)<\/code>/g, '`$1`')
      .replace(/<(strong|b)>([\s\S]*?)<\/\1>/g, '$2')
      .replace(/<li>/g, ' • ')
      .replace(/<br\s*\/?>/g, ' ')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function cellText(html: string): string {
  return text(html).replace(/\|/g, '\\|');
}

type Row = { cells: string[]; raw: string[]; depth: number };
function parseTable(tableHtml: string): { head: string[]; rows: Row[] } {
  const head = [...tableHtml.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => text(m[1] ?? ''));
  const body = tableHtml.split(/<tbody>/)[1] ?? '';
  const rows: Row[] = [];
  for (const tr of body.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const raw = [...(tr[1] ?? '').matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1] ?? '');
    if (!raw.length) continue;
    const lead = /^(\s*?)((?: |&nbsp;|\s)*)/.exec(raw[0] ?? '')?.[2] ?? '';
    const nb = (lead.match(/ |&nbsp;/g) ?? []).length;
    rows.push({ cells: raw.map(cellText), raw, depth: nb ? Math.max(1, Math.round(nb / 3)) : 0 });
  }
  return { head, rows };
}

type Heading = { level: number; id: string; title: string; start: number; end: number };
function headings(html: string): Heading[] {
  const out: Heading[] = [];
  // Some headings are not closed in the source HTML (e.g. `<h1 id="objects">Objects`), so stop at the next heading too.
  for (const m of html.matchAll(/<h([1-4]) id="([^"]+)"[^>]*>([\s\S]*?)(?:<\/h\1>|(?=<h[1-6][\s>]))/g)) {
    const title = text((m[3] ?? '').split('\n')[0] ?? '');
    out.push({ level: Number(m[1]), id: m[2] ?? '', title, start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  }
  return out;
}

// ---------- known doc-table defects, fixed here (marked in the output) ----------
const FIX_NOTE = ' [generator fix: doc table is flat/mistyped]';
const FIXUPS: Record<string, (fs: Field[]) => Field[]> = {
  // transport sub-fields are listed at top level in the doc table
  'conduit-shard-disabled-event': (fs) => {
    let inTransport = false;
    return fs.map((f) => {
      if (f.depth === 0 && f.name === 'transport') { inTransport = true; return f; }
      if (inTransport && f.depth === 0 && ['method', 'callback', 'session_id', 'connected_at', 'disconnected_at'].includes(f.name)) {
        return { ...f, depth: 1, description: f.description + FIX_NOTE };
      }
      return f;
    });
  },
  // message.text is documented as "object" but is the plain-text string (see the example payload)
  'channel-chat-notification-event': (fs) =>
    fs.map((f) => (f.depth === 1 && f.name === 'text' && /^object$/i.test(f.type) ? { ...f, type: 'string', description: f.description + FIX_NOTE } : f)),
};

// ---------- domain grouping ----------
const DOMAINS: Array<[string, RegExp]> = [
  ['Channel (info, follows, raids, ads, shoutouts)', /^channel\.(update|follow|raid|ad_break\.|shoutout\.)/],
  ['Chat', /^channel\.(chat\.|chat_settings\.|shared_chat\.)/],
  ['Subscriptions (subs, resubs, gift subs)', /^channel\.(subscribe|subscription\.)/],
  ['Bits & cheers', /^channel\.(cheer|bits\.)/],
  ['Channel Points', /^channel\.channel_points_/],
  ['Power-ups', /^channel\.custom_power_up/],
  ['Polls', /^channel\.poll\./],
  ['Predictions', /^channel\.prediction\./],
  ['Hype Train', /^channel\.hype_train\./],
  ['Goals', /^channel\.goal\./],
  ['Charity', /^channel\.charity_campaign\./],
  ['Moderation (bans, mods, VIPs, warnings, unban requests, suspicious users, shield mode)', /^channel\.(ban|unban|unban_request\.|moderate|moderator\.|vip\.|warning\.|suspicious_user\.|shield_mode\.)/],
  ['AutoMod', /^automod\./],
  ['Guest Star (BETA)', /^channel\.guest_star/],
  ['Stream', /^stream\./],
  ['User & authorization', /^user\.(update|authorization\.)/],
  ['Whispers', /^user\.whisper\./],
  ['Conduit', /^conduit\./],
  ['Extensions', /^extension\./],
  ['Drops', /^drop\./],
];
function domainOf(type: string): string {
  for (const [name, re] of DOMAINS) if (re.test(type)) return name;
  return 'Other';
}

// ---------- model ----------
export type Field = { name: string; type: string; typeRef?: string; required: string; description: string; depth: number };
type SubType = {
  name: string; // display name from summary table
  type: string;
  version: string;
  status: string; // GA | NEW | BETA | ...
  description: string;
  anchor: string; // section anchor on the subscription types page
  authorization: string;
  scopes: string[];
  scopesOptional: boolean; // "No authorization required" types where a scope only adds fields
  transports: string; // 'webhook, websocket, conduit' or a restriction stated in the docs
  notes: string[]; // NOTE / IMPORTANT paragraphs from the section intro
  extraBody: string[]; // request-body fields other than type/version/condition/transport
  conditionRef: string | null; // anchor in eventsub-reference
  condition: Field[];
  eventRef: string | null; // anchor in eventsub-reference
  example?: unknown; // `event` object of the first notification example in the section (not written to JSON)
  exampleFull?: unknown; // the whole { subscription, event } example (written to assets/fixtures/)
};

async function load(file: string, url: string, dir: string | undefined): Promise<string> {
  if (dir) return readFile(join(dir, file), 'utf8');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.text();
}

function sectionHtml(html: string, hs: Heading[], idx: number, stop: (h: Heading) => boolean): string {
  const h = hs[idx];
  if (!h) return '';
  let end = html.length;
  for (let j = idx + 1; j < hs.length; j++) {
    const hj = hs[j];
    if (hj && stop(hj)) { end = hj.start; break; }
  }
  return html.slice(h.end, end);
}

const TYPE_HEADING = /^[a-z_]+(\.[a-z_]+)+(\s+v\d+)?$/i;

type RefTable = { title: string; level: number; intro: string; fields: Field[]; head: string[] };
function main(typesHtml: string, refHtml: string): { subs: SubType[]; refMd: string; warnings: string[]; refTables: Map<string, RefTable> } {
  const warnings: string[] = [];
  // reference objects: id -> first table rows
  const rhs = headings(refHtml);
  const refTables = new Map<string, RefTable>();
  rhs.forEach((h, i) => {
    const sec = sectionHtml(refHtml, rhs, i, () => true);
    const tbl = /<table>[\s\S]*?<\/table>/.exec(sec)?.[0];
    const intro = [...sec.split('<table>')[0]!.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((m) => text(m[1] ?? '')).join(' ');
    if (!tbl) { refTables.set(h.id, { title: h.title, level: h.level, intro, fields: [], head: [] }); return; }
    const { head, rows } = parseTable(tbl);
    const hasReq = head.some((x) => /required/i.test(x));
    const fields = rows.map((r) => ({
      name: (r.cells[0] ?? '').replace(/`/g, ''),
      type: r.cells[1] ?? '',
      typeRef: /href="#([a-z0-9-]+)"/.exec(r.raw[1] ?? '')?.[1],
      required: hasReq ? (r.cells[2] ?? '') : '',
      description: hasReq ? (r.cells[3] ?? '') : (r.cells[2] ?? ''),
      depth: r.depth,
    }));
    refTables.set(h.id, { title: h.title, level: h.level, intro, fields: FIXUPS[h.id]?.(fields) ?? fields, head });
  });

  // summary table (first table on the page)
  const summary = parseTable(/<table>[\s\S]*?<\/table>/.exec(typesHtml)?.[0] ?? '');
  const hs = headings(typesHtml);
  const isTypeHeading = (h: Heading) => h.level === 3 && TYPE_HEADING.test(h.title);
  const subs: SubType[] = [];

  for (const r of summary.rows) {
    const anchor = /href="#([^"]+)"/.exec(r.raw[0] ?? '')?.[1] ?? '';
    const pill = /pill[^"]*">([^<]+)</.exec(r.raw[0] ?? '')?.[1]?.trim() ?? '';
    const name = text((r.raw[0] ?? '').replace(/<span class="pill[\s\S]*?<\/span>/g, ''));
    const type = (r.cells[1] ?? '').replace(/`/g, '');
    const version = (r.cells[2] ?? '').replace(/`/g, '');
    const idx = hs.findIndex((h) => h.id === anchor);
    if (idx < 0) warnings.push(`no section for ${type} v${version} (#${anchor})`);
    const sec = idx >= 0 ? sectionHtml(typesHtml, hs, idx, (h) => h.level <= 2 || isTypeHeading(h)) : '';
    // sub-headings inside the section
    const subHs = headings(sec);
    const part = (re: RegExp) => {
      const i = subHs.findIndex((h) => re.test(h.title));
      return i < 0 ? '' : sectionHtml(sec, subHs, i, () => true);
    };
    const authHtml = part(/^Authorization$/i);
    const authorization = [...authHtml.matchAll(/<(p|li)>([\s\S]*?)<\/\1>/g)]
      .map((m) => (m[1] === 'li' ? '• ' : '') + text(m[2] ?? ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    const scopes = [...new Set([...authHtml.matchAll(/<(?:code|strong)[^>]*>([a-z_]+(?::[a-z_]+)+)<\/(?:code|strong)>/g)].map((m) => m[1] ?? ''))];
    const firstSub = subHs[0]?.start ?? sec.length;
    const notes = [...sec.slice(0, firstSub).matchAll(/<p>([\s\S]*?)<\/p>/g)]
      .map((m) => text(m[1] ?? ''))
      .filter((t) => /^(NOTE|IMPORTANT)\b/.test(t));
    const transports = notes.some((n) => /only supported by webhooks and conduits/i.test(n)) ? 'webhook, conduit (NOT websocket)' : 'webhook, websocket, conduit';
    const scopesOptional = /^No authorization required/i.test(authorization);
    const extraBody: string[] = [];
    const reqHtml = part(/Request Body/i);
    const reqTbl = /<table>[\s\S]*?<\/table>/.exec(reqHtml)?.[0] ?? '';
    const req = parseTable(reqTbl);
    let conditionRef: string | null = null;
    let condition: Field[] = [];
    let docVersion = '';
    let inCond = false;
    for (const row of req.rows) {
      const key = (row.cells[0] ?? '').replace(/`/g, '').trim();
      if (key === 'version') docVersion = /(?:`|\*\*)?([0-9a-z]+)(?:`|\*\*)?\.?\s*$/.exec(text((row.raw[3] ?? '').replace(/<strong>([^<]+)<\/strong>/g, '`$1`')))?.[1] ?? '';
      if (key === 'condition') {
        const href = /eventsub-reference\/?#([a-z0-9-]+)/.exec(row.raw[1] ?? '')?.[1];
        if (href) conditionRef = href; else inCond = true;
        continue;
      }
      if (key === 'transport') { inCond = false; continue; }
      if (!inCond && key !== 'type' && key !== 'version' && key) extraBody.push(`\`${key}\` (${row.cells[1] ?? ''}, ${row.cells[2] ?? ''}): ${row.cells[3] ?? ''}`);
      if (inCond) condition.push({ name: key, type: row.cells[1] ?? '', required: row.cells[2] ?? '', description: row.cells[3] ?? '', depth: 0 });
    }
    if (conditionRef) {
      const t = refTables.get(conditionRef);
      if (!t) warnings.push(`${type} v${version}: condition ref #${conditionRef} not found`);
      else condition = t.fields;
    }
    if (!condition.length) warnings.push(`${type} v${version}: no condition fields parsed`);
    if (docVersion && docVersion !== version) warnings.push(`${type}: summary says v${version}, request body says v${docVersion}`);
    const payHtml = part(/Payload/i);
    const eventRef = /eventsub-reference\/?#([a-z0-9-]+)">event</.exec(payHtml)?.[1] ?? /eventsub-reference\/?#((?!subscription")[a-z0-9-]+)/.exec(payHtml)?.[1] ?? null;
    if (!eventRef) warnings.push(`${type} v${version}: no event ref`);
    else if (!refTables.has(eventRef)) warnings.push(`${type} v${version}: event ref #${eventRef} not found`);
    let example: unknown;
    let exampleFull: unknown;
    for (const pre of sec.matchAll(/<pre[^>]*>([\s\S]*?)<\/pre>/g)) {
      const raw = decode((pre[1] ?? '').replace(/<[^>]+>/g, '')).replace(/\u00a0/g, ' ');
      const cleaned = raw.replace(/\/\/[^\n"]*$/gm, '').replace(/,(\s*[}\]])/g, '$1');
      try {
        const j = JSON.parse(cleaned) as { event?: unknown };
        if (j && typeof j === 'object' && 'event' in j) { example = j.event; exampleFull = j; break; }
      } catch { /* not JSON / not an example */ }
    }
    const status = version === 'beta' || pill === 'BETA' ? 'BETA' : pill === 'NEW' ? 'GA (NEW)' : 'GA';
    subs.push({ name, type, version, status, description: r.cells[3] ?? '', anchor, authorization, scopes, scopesOptional, transports, notes, extraBody, conditionRef, condition, eventRef, example, exampleFull });
  }

  // every type-heading section must be covered by a summary row
  for (const h of hs.filter(isTypeHeading)) {
    if (!subs.some((s) => s.anchor === h.id)) warnings.push(`section #${h.id} (${h.title}) missing from summary table`);
  }

  // ---------- event-objects.md (all reference tables) ----------
  const lines: string[] = [];
  const topIds = rhs.filter((h) => h.level <= 3 && !['eventsub-reference', 'objects', 'request-fields', 'response-fields'].includes(h.id));
  for (const h of topIds) {
    const t = refTables.get(h.id);
    if (!t) continue;
    const hdr = h.level === 2 ? '##' : '###';
    lines.push(`${hdr} ${h.title} {#${h.id}}`, '');
    if (t.intro) lines.push(t.intro, '');
    if (t.fields.length) {
      const hasReq = t.head.some((x) => /required/i.test(x));
      lines.push(hasReq ? '| Field | Type | Required | Description |' : '| Field | Type | Description |');
      lines.push(hasReq ? '|---|---|---|---|' : '|---|---|---|');
      for (let f of t.fields) {
        const nm = `${'↳ '.repeat(f.depth)}\`${f.name}\``;
        if (f.typeRef && f.typeRef !== h.id) f = { ...f, type: `${f.type} (→ #${f.typeRef})` };
        lines.push(hasReq ? `| ${nm} | ${f.type} | ${f.required} | ${f.description} |` : `| ${nm} | ${f.type} | ${f.description} |`);
      }
      lines.push('');
    }
  }
  return { subs, refMd: lines.join('\n'), warnings, refTables };
}

function fieldList(fs: Field[]): string {
  if (!fs.length) return '_none_';
  return fs
    .map((f) => {
      const req = /^yes/i.test(f.required) ? 'required' : /^no/i.test(f.required) ? 'optional' : f.required || '?';
      return `\`${f.name}\` (${req})`;
    })
    .join(', ');
}

async function run(): Promise<void> {
  const argv = process.argv.slice(2);
  const di = argv.indexOf('--html-dir');
  const dir = di >= 0 ? argv[di + 1] : undefined;
  const typesHtml = await load('eventsub_eventsub-subscription-types.html', TYPES_URL, dir);
  const refHtml = await load('eventsub_eventsub-reference.html', REF_URL, dir);
  const { subs, refMd, warnings, refTables } = main(typesHtml, refHtml);
  const today = new Date().toISOString().slice(0, 10);
  const src = dir ? 'a local HTML snapshot of dev.twitch.tv' : 'live dev.twitch.tv';

  // --only a,b,c [--out file]: write a TRIMMED types.ts for just those types into a project (nothing else).
  // The full assets/templates/types.ts covers all types (~170 KB); most apps need a handful.
  const oi = argv.indexOf('--only');
  if (oi >= 0) {
    const want = new Set((argv[oi + 1] ?? '').split(',').map((t) => t.trim()).filter(Boolean));
    const unknown = [...want].filter((t) => !subs.some((s) => s.type === t));
    if (unknown.length) throw new Error(`unknown subscription type(s): ${unknown.join(', ')}`);
    const oo = argv.indexOf('--out');
    const outFile = oo >= 0 ? argv[oo + 1]! : 'types.ts';
    await writeFile(outFile, buildTypes(subs.filter((s) => want.has(s.type)), refTables, src, today));
    console.log(`wrote ${outFile} (${want.size} types)`);
    return;
  }

  // ---------- subscription-types.md ----------
  const out: string[] = [];
  const byDomain = new Map<string, SubType[]>();
  for (const s of subs) {
    const d = domainOf(s.type);
    if (!byDomain.has(d)) byDomain.set(d, []);
    byDomain.get(d)!.push(s);
  }
  const order = [...DOMAINS.map((d) => d[0]), 'Other'].filter((d) => byDomain.has(d));
  const uniqTypes = new Set(subs.map((s) => s.type)).size;
  out.push(
    '# EventSub subscription types — complete catalogue (GENERATED)',
    '',
    `> Generated by \`scripts/gen-subscription-types.ts\` from ${src} on ${today}. Do not hand-edit; re-run the script.`,
    `> **${subs.length} subscription type+version combinations** (${uniqTypes} distinct type strings) as listed in the official`,
    '> Subscription Types table. Condition fields come from the EventSub Reference condition objects (or the inline request-body table).',
    '> Event payload fields for every type: `references/event-objects.md` (anchor shown per entry) or `scripts/event-section.sh <type> [version]`.',
    '',
    '**Status legend:** GA = generally available; GA (NEW) = recently released, tagged NEW in the docs; BETA = public beta (unstable,',
    'version string is literally `"beta"`, auto-deleted 30 days after the GA version ships — do not use in production).',
    '',
    '**Authorization reminder:** scopes listed are what the *user in the condition* (broadcaster / moderator / chatting user) must have',
    'granted to YOUR client ID. WebSocket: subscribe with that user\'s user access token. Webhook/conduit: subscribe with an app access',
    'token — Twitch checks that the user previously authorized your client ID with those scopes. "No authorization required" types cost',
    '1 against `max_total_cost` unless the user has authorized your app.',
    '',
    '## Removed / deprecated versions not in the current table',
    '',
    'These no longer appear on the Subscription Types page; creating them fails (`410 Gone` for removed type+version) — use the replacement.',
    '',
    '| Old | Replacement | Source (change log) |',
    '|---|---|---|',
    '| `channel.hype_train.begin` / `.progress` / `.end` **v1** | same types **v2** (v2 has `type` treasure/golden_kappa/regular, `is_shared_train`, `shared_train_participants`, `all_time_high_level/total`; no `is_golden_kappa_train`) | 2025-06-13 V1 deprecated; 2026-02-05 withdrawal timeline announced with removal of Get Hype Train Events |',
    '| `channel.follow` **v1** (no moderator) | `channel.follow` **v2** (needs `moderator_user_id` + `moderator:read:followers`) | 2023-09-06 legacy follows shutdown |',
    '| `channel.update` **v1** (`is_mature`) | `channel.update` **v2** (`content_classification_labels`) | 2023-06-29 / 2023-07-17 |',
    '| `channel.channel_points_automatic_reward_redemption.add` v1 | still listed (GA) but **v2** is the current shape (`reward` object + `message.fragments`) | 2025-02-27 |',
    '| `automod.message.hold` / `automod.message.update` v1 | still listed; **v2** adds `reason` (automod / blocked_term / blocked_link) and only public blocked terms | 2024-12-05, 2026-09-16 |',
    '| `channel.moderate` v1 | still listed; **v2** adds warnings (`warn` action + `warn` object) | 2024-06-19 |',
    '',
    '## Index',
    '',
    '| Type | Ver | Status | Scopes (user must grant) | Condition | Domain |',
    '|---|---|---|---|---|---|',
  );
  for (const d of order) {
    for (const s of byDomain.get(d)!) {
      const cond = s.condition.map((f) => (/^yes/i.test(f.required) ? f.name : `${f.name}?`)).join(', ');
      const sc = s.scopes.map((x) => `\`${x}\``).join(' / ');
      const scopeCell = s.scopesOptional ? (sc ? `none (optional ${sc})` : 'none') : sc || '— (see entry)';
      const ver = s.transports.startsWith('webhook, conduit (') ? `${s.version} ⚠webhook/conduit only` : s.version;
      out.push(`| [\`${s.type}\`](#${s.anchor}) | ${ver} | ${s.status} | ${scopeCell} | ${cond} | ${d.split(' (')[0]} |`);
    }
  }
  out.push('', '`field?` = optional condition field. Scope lists joined with `/` — read the entry: some are "any of", some "all of". Known doc quirk: the `channel.moderate` v2 request-body table says version 1 — send `"2"` (as the summary table and webhook example do).', '');
  for (const d of order) {
    out.push(`## ${d}`, '');
    for (const s of byDomain.get(d)!) {
      out.push(`### ${s.type} v${s.version} {#${s.anchor}}`, '');
      out.push(`- **Name:** ${s.name} — **type** \`${s.type}\`, **version** \`"${s.version}"\`, **status** ${s.status}`);
      out.push(`- **What:** ${s.description}`);
      out.push(`- **Condition:** ${fieldList(s.condition)}`);
      out.push(`- **Authorization:** ${s.authorization || '_(not stated)_'}`);
      if (s.transports !== 'webhook, websocket, conduit') out.push(`- **Transports:** ${s.transports}`);
      for (const n of s.notes) out.push(`- **Doc note:** ${n}`);
      for (const x of s.extraBody) out.push(`- **Extra request-body field:** ${x}`);
      out.push(`- **Event fields:** \`references/event-objects.md\` → \`#${s.eventRef ?? '?'}\` · official: https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/#${s.anchor}`);
      out.push('');
    }
  }
  const mdPath = join(REFS, 'subscription-types.md');
  // TOC (file is long)
  const slug = (h: string) => h.toLowerCase().replace(/[^a-z0-9 -]/g, '').replace(/ /g, '-');
  const toc = ['## Contents', '', '- [Removed / deprecated versions](#removed--deprecated-versions-not-in-the-current-table)', '- [Index](#index)', ...order.map((d) => `- [${d}](#${slug(d)}) (${byDomain.get(d)!.length})`), ''];
  const headerEnd = out.indexOf('## Removed / deprecated versions not in the current table');
  out.splice(headerEnd, 0, ...toc);
  await writeFile(mdPath, out.join('\n'));
  await writeFile(join(REFS, 'subscription-types.json'), JSON.stringify(subs.map(({ example: _ex, exampleFull: _f, ...s }) => ({ ...s, domain: domainOf(s.type) })), null, 1));

  const refHeader = [
    '# EventSub Reference objects (GENERATED)',
    '',
    `> Generated by \`scripts/gen-subscription-types.ts\` from ${src} on ${today} (https://dev.twitch.tv/docs/eventsub/eventsub-reference/).`,
    '> Every object table: request/response, **Conditions**, **Events** (payload `event` fields for every type), and shared objects',
    '> (Transport, Subscription, Reward, Choices, Outcomes, Top Contributions, Shield Mode, Shoutout Create/Received, …).',
    '> `↳` marks a nested field (one arrow per nesting level). Find an event: `grep -n "^### Channel Follow Event" references/event-objects.md`.',
    '',
  ];
  // compact TOC (file is long): one line per group of h2 sections, h3s listed under their h2
  const refToc: string[] = ["## Contents", ""];
  for (const line of refMd.split('\n')) {
    const m = /^(##|###) (.+) \{#([a-z0-9-]+)\}$/.exec(line);
    if (!m) continue;
    if (m[1] === "##") refToc.push(`- [${m[2]}](#${m[3]})`);
    else refToc[refToc.length - 1] += `${refToc[refToc.length - 1]!.includes(': ') ? ' · ' : ': '}[${m[2]}](#${m[3]})`;
  }
  refToc.push("");
  await writeFile(join(REFS, 'event-objects.md'), refHeader.join("\n") + "\n" + refToc.join("\n") + '\n' + refMd + '\n');

  await writeFile(join(REFS, 'payloads.md'), buildPayloads(subs, refTables, src, today, warnings));
  await writeFile(join(HERE, '..', 'assets', 'templates', 'types.ts'), buildTypes(subs, refTables, src, today));
  // fixtures: the official notification example of every type → assets/fixtures/<type>.v<version>.json
  const fx = join(HERE, '..', 'assets', 'fixtures');
  await mkdir(fx, { recursive: true });
  let nFx = 0;
  for (const s of subs) {
    if (s.exampleFull === undefined) { warnings.push(`fixture: no notification example for ${s.type} v${s.version}`); continue; }
    await writeFile(join(fx, `${s.type}.v${s.version}.json`), JSON.stringify(s.exampleFull, null, 2) + '\n');
    nFx++;
  }
  console.log(`fixtures written: ${nFx}`);

  console.log(`subscription type+versions: ${subs.length} (${uniqTypes} distinct types)`);
  for (const d of order) console.log(`  ${byDomain.get(d)!.length.toString().padStart(3)}  ${d}`);
  if (warnings.length) { console.log(`\nWARNINGS (${warnings.length}):`); for (const w of warnings) console.log('  - ' + w); }
}


// ---------- payloads.md (curated top events) ----------
function compactJson(v: unknown, indent = ''): string {
  const one = JSON.stringify(v);
  if (one === undefined) return 'null';
  if (one.length + indent.length <= 100 || v === null || typeof v !== 'object') return one;
  const next = indent + '  ';
  if (Array.isArray(v)) return `[\n${v.map((x) => next + compactJson(x, next)).join(',\n')}\n${indent}]`;
  const entries = Object.entries(v as Record<string, unknown>);
  return `{\n${entries.map(([k, x]) => `${next}${JSON.stringify(k)}: ${compactJson(x, next)}`).join(',\n')}\n${indent}}`;
}
function shortDesc(d: string): string {
  // first sentence + any sentence that carries nullability / allowed values
  const sentences = d.split(/(?<=\.)\s/);
  const short0 = (sentences[0] ?? '').length < 15; // e.g. "Optional." — keep the real description too
  const keep = sentences.filter((x, i) => i === 0 || (i === 1 && short0) || /null|optional|possible values|valid values|one of/i.test(x));
  const out = keep.join(' ');
  return out.length > 400 ? out.slice(0, 397) + '…' : out;
}
function fieldTree(fields: Field[], refTables: Map<string, RefTable>, base = 0, seen = new Set<string>()): string[] {
  const out: string[] = [];
  fields.forEach((f, i) => {
    const pad = '  '.repeat(base + f.depth);
    out.push(`${pad}- \`${f.name}\` *${f.type}* — ${shortDesc(f.description)}`);
    // inline shared objects (Choices, Outcomes, Reward, Message, ...) unless the table already nests children
    if (f.typeRef && !seen.has(f.typeRef)) {
      const t = refTables.get(f.typeRef);
      const nextIsChild = (fields[i + 1]?.depth ?? 0) > f.depth;
      if (t && t.fields.length && !nextIsChild) {
        const s2 = new Set(seen); s2.add(f.typeRef);
        out.push(...fieldTree(t.fields, refTables, base + f.depth + 1, s2));
      }
    }
  });
  return out;
}
function buildPayloads(subs: SubType[], refTables: Map<string, RefTable>, src: string, today: string, warnings: string[]): string {
  const out: string[] = [
    '# EventSub payloads — the ~30 most-used events',
    '',
    `> Field lists and example JSON are GENERATED from ${src} on ${today} by \`scripts/gen-subscription-types.ts\``,
    '> (curation + notes in `scripts/payloads-curation.ts`). Field names/types are copied verbatim from the EventSub Reference.',
    '> Every other type: `scripts/event-section.sh <type> [version]` or `references/event-objects.md`.',
    '> The JSON shows only the `event` object. Full notification = `{ subscription, event }` (webhook body) or',
    '> `{ metadata, payload: { subscription, event } }` (WebSocket frame).',
    '',
    'Conventions that hold for every event: IDs are strings (never parse to number); `*_login` = lowercase login, `*_name` = display',
    'name; timestamps are RFC3339 strings with nanosecond precision (`Date.parse` handles them, just loses sub-ms digits); optional',
    'objects are `null` (not absent) when not applicable — check `!= null`. Nested shared objects (Choices, Outcomes, Reward, …) are',
    'expanded inline below.',
    '',
    '## Contents',
    '',
  ];
  const body: string[] = [];
  for (const c of CURATED) {
    const s = subs.find((x) => x.type === c.type && x.version === c.version);
    if (!s) { warnings.push(`payloads: curated ${c.type} v${c.version} not found`); continue; }
    const t = s.eventRef ? refTables.get(s.eventRef) : undefined;
    const slug = `${c.type}-v${c.version}`.replace(/[^a-z0-9-]/g, '');
    out.push(`- [\`${c.type}\` v${c.version}](#${slug}) — ${c.why}`);
    body.push(`## ${c.type} v${c.version}`, '');
    body.push(`${s.description} · scopes: ${s.scopesOptional || !s.scopes.length ? 'none' : s.scopes.map((x) => `\`${x}\``).join(' / ')} · condition: ${s.condition.map((f) => `\`${f.name}\`${/^yes/i.test(f.required) ? '' : '?'}`).join(', ')}`, '');
    for (const n of c.notes) body.push(`- ⚠ ${n}`);
    body.push('', '**Event fields**', '');
    if (t) body.push(...fieldTree(t.fields, refTables));
    else body.push('_(event object not found)_');
    body.push('');
    if (s.example !== undefined) body.push('```json', compactJson(s.example), '```', '');
    else body.push('_(no notification example on the docs page)_', '');
  }
  return [...out, '', ...body].join('\n');
}

// ---------- assets/templates/types.ts (event + condition types for EVERY subscription type) ----------
const SHARED_NAMES: Record<string, { name: string; array: boolean }> = {
  choices: { name: 'PollChoice', array: true },
  outcomes: { name: 'PredictionOutcome', array: true },
  'top-predictors': { name: 'PredictionTopPredictor', array: true },
  'top-contributions': { name: 'HypeTrainContribution', array: true },
  emotes: { name: 'ResubEmote', array: true },
  message: { name: 'ResubMessage', array: false },
  reward: { name: 'ChannelPointsReward', array: false },
  image: { name: 'RewardImage', array: false },
  'global-cooldown': { name: 'GlobalCooldown', array: false },
  'max-per-stream': { name: 'MaxPerStream', array: false },
  'max-per-user-per-stream': { name: 'MaxPerUserPerStream', array: false },
  'bits-voting': { name: 'BitsVoting', array: false },
  'channel-points-voting': { name: 'ChannelPointsVoting', array: false },
  'custom-power-up': { name: 'CustomPowerUp', array: false },
  product: { name: 'ExtensionProduct', array: false },
};
function pascal(s: string): string {
  return s.split(/[._\-\s]+/).filter(Boolean).map((p) => p[0]!.toUpperCase() + p.slice(1)).join('');
}
function scalarTs(t: string): string {
  const x = t.replace(/\s*\(→.*$/, '').trim().toLowerCase();
  if (/^(string|str)$/.test(x)) return 'string';
  if (/^(int|integer|number|float)( \(or null\))?$/.test(x)) return x.includes('null') ? 'number | null' : 'number';
  if (/^(bool|boolean)$/.test(x)) return 'boolean';
  if (x === 'string[]' || x === '[]string') return 'string[]';
  return 'unknown';
}
/** "Possible values: • a • b" / "Valid values are `a`, `b`" -> 'a' | 'b' | (string & {}) (open union: Twitch adds values). */
function enumUnion(desc: string): string | null {
  const m = /(possible values|valid values|one of)[^:•`]*:?([\s\S]*)$/i.exec(desc);
  if (!m) return null;
  const tail = m[2] ?? '';
  let items: string[] = [];
  if (tail.includes('•')) items = tail.split('•').slice(1).map((x) => x.trim().replace(/^`|`$/g, '').split(/[\s`—–-]+/)[0] ?? '');
  else items = [...tail.split('.')[0]!.matchAll(/`([^`]+)`/g)].map((x) => x[1] ?? '');
  items = [...new Set(items.filter((x) => /^[a-z0-9_]+$/i.test(x)))];
  if (items.length < 2) return null;
  return `${items.map((x) => `'${x}'`).join(' | ')} | (string & {})`;
}
function isArrayType(t: string): boolean {
  const x = t.replace(/\s*\(→.*$/, '').trim().toLowerCase();
  return x.endsWith('[]') || x.startsWith('[]') || x === 'array';
}
function tsFields(fields: Field[], indent: string, used: Set<string>): string[] {
  const out: string[] = [];
  const siblingTypes = new Map<string, string>();
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i]!;
    const kids: Field[] = [];
    let j = i + 1;
    while (j < fields.length && fields[j]!.depth > f.depth) { kids.push(fields[j]!); j++; }
    let ty: string;
    const shared = f.typeRef ? SHARED_NAMES[f.typeRef] : undefined;
    if (kids.length) {
      const base = Math.min(...kids.map((k) => k.depth));
      const inner = tsFields(kids.map((k) => ({ ...k, depth: k.depth - base })), indent + '  ', used);
      const obj = `{\n${inner.join('\n')}\n${indent}}`;
      ty = isArrayType(f.type) || shared?.array ? `Array<${obj}>` : obj;
    } else if (/^shared_chat_/.test(f.name) && siblingTypes.has(f.name.replace(/^shared_chat_/, ''))) {
      // "This field has the same information as the `X` field" → reuse X's type
      ty = siblingTypes.get(f.name.replace(/^shared_chat_/, ''))!.replace(/ \| null$/, '');
    } else if (shared) {
      used.add(f.typeRef!);
      ty = shared.array ? `${shared.name}[]` : shared.name;
    } else {
      ty = scalarTs(f.type);
      if (ty === 'string') ty = enumUnion(f.description) ?? ty;
      if (ty === 'unknown' && /^object/i.test(f.type)) ty = isArrayType(f.type) ? 'Array<Record<string, unknown>>' : 'Record<string, unknown> | null';
    }
    const desc = f.description;
    const optional = /^\**optional\b/i.test(desc);
    const nullable = optional || /\bnull\b/i.test(desc);
    if (nullable && !ty.includes('null')) ty += ' | null';
    const doc = shortDesc(desc).replace(/\*\//g, '* /');
    out.push(`${indent}/** ${doc} */`);
    siblingTypes.set(f.name, ty);
    out.push(`${indent}${/^[a-z_][a-z0-9_]*$/i.test(f.name) ? f.name : JSON.stringify(f.name)}${optional ? '?' : ''}: ${ty};`);
    i = j - 1;
  }
  return out;
}
function buildTypes(subs: SubType[], refTables: Map<string, RefTable>, src: string, today: string): string {
  // latest version per type (numeric max; 'beta' only if nothing else)
  const latest = new Map<string, SubType>();
  for (const s of subs) {
    const cur = latest.get(s.type);
    const v = (x: SubType) => (x.version === 'beta' ? 0 : Number(x.version));
    if (!cur || v(s) > v(cur)) latest.set(s.type, s);
  }
  const used = new Set<string>();
  const evIfaces: string[] = [];
  const condIfaces: string[] = [];
  const mapLines: string[] = [];
  const condMapLines: string[] = [];
  const verLines: string[] = [];
  for (const s of [...latest.values()].sort((a, b) => a.type.localeCompare(b.type))) {
    const n = pascal(s.type);
    const t = s.eventRef ? refTables.get(s.eventRef) : undefined;
    evIfaces.push(`/** \`${s.type}\` v${s.version}${s.status === 'BETA' ? ' (BETA)' : ''} — ${s.description.replace(/\*\//g, '* /')} */`);
    evIfaces.push(`export interface ${n}Event {\n${t ? tsFields(t.fields, '  ', used).join('\n') : '  [key: string]: unknown;'}\n}`, '');
    condIfaces.push(`export interface ${n}Condition {\n${s.condition.map((f) => `  /** ${shortDesc(f.description).replace(/\*\//g, '* /')} */\n  ${f.name}${/^yes/i.test(f.required) ? '' : '?'}: string;`).join('\n')}\n}`);
    mapLines.push(`  '${s.type}': ${n}Event;`);
    condMapLines.push(`  '${s.type}': ${n}Condition;`);
    verLines.push(`  '${s.type}': '${s.version}',`);
  }
  const sharedIfaces: string[] = [];
  // shared objects may reference other shared objects -> resolve transitively
  const done = new Set<string>();
  while ([...used].some((u) => !done.has(u))) {
    for (const id of [...used]) {
      if (done.has(id)) continue;
      done.add(id);
      const t = refTables.get(id);
      const nm = SHARED_NAMES[id]!.name;
      sharedIfaces.push(`/** EventSub Reference object #${id} */\nexport interface ${nm} {\n${t ? tsFields(t.fields, '  ', used).join('\n') : ''}\n}`, '');
    }
  }
  return `// GENERATED by twitch-eventsub/scripts/gen-subscription-types.ts from ${src} on ${today}. Do not hand-edit.
// Event payload + condition types for EVERY EventSub subscription type (latest version of each),
// field names copied verbatim from https://dev.twitch.tv/docs/eventsub/eventsub-reference/.
// Nullability is inferred from the docs ("Optional" -> \`?: T | null\`, "null if ..." -> \`T | null\`).
// Usage:  import type { EventSubEnvelope, EventSubEventMap, EventSubType } from './types.ts';
//         switch (e.type) { case 'channel.follow': e.event.user_name; ... }   // e: EventSubEnvelope

// ---------------------------------------------------------------- envelope (hand-written in the generator)
export type EventSubTransport =
  | { method: 'webhook'; callback: string; secret?: string }
  | { method: 'websocket'; session_id: string; connected_at?: string; disconnected_at?: string }
  | { method: 'conduit'; conduit_id: string };

/** Subscription status values (Get EventSub Subscriptions). Everything except 'enabled'/'webhook_callback_verification_pending' means disabled. */
export type EventSubSubscriptionStatus =
  | 'enabled' | 'webhook_callback_verification_pending' | 'webhook_callback_verification_failed'
  | 'notification_failures_exceeded' | 'authorization_revoked' | 'moderator_removed' | 'user_removed'
  | 'chat_user_banned' | 'version_removed' | 'beta_maintenance' | 'websocket_disconnected'
  | 'websocket_failed_ping_pong' | 'websocket_received_inbound_traffic' | 'websocket_connection_unused'
  | 'websocket_internal_error' | 'websocket_network_timeout' | 'websocket_network_error'
  | 'websocket_failed_to_reconnect' | 'conduit_deleted';

export interface EventSubSubscription<T extends EventSubType = EventSubType> {
  id: string;
  status: EventSubSubscriptionStatus;
  type: T;
  version: string;
  cost: number;
  condition: EventSubConditionMap[T];
  transport: EventSubTransport;
  created_at: string;
}

/** Body of a webhook notification / \`payload\` of a WebSocket notification. */
export interface EventSubNotification<T extends EventSubType = EventSubType> {
  subscription: EventSubSubscription<T>;
  event: EventSubEventMap[T];
}
/** Union of all notifications. NOTE: TS cannot narrow on the NESTED \`subscription.type\` — convert to EventSubEnvelope first. */
export type AnyEventSubNotification = { [T in EventSubType]: EventSubNotification<T> }[EventSubType];

/**
 * Flat discriminated union: \`switch (e.type)\` narrows \`e.event\` to the exact payload type.
 * Build it with: \`const e = { type: n.subscription.type, version: n.subscription.version, event: n.event, subscription: n.subscription } as EventSubEnvelope;\`
 */
export type EventSubEnvelope = {
  [T in EventSubType]: { type: T; version: string; event: EventSubEventMap[T]; subscription: EventSubSubscription<T> };
}[EventSubType];

/** Request body for POST /helix/eventsub/subscriptions. */
export interface CreateSubscriptionBody<T extends EventSubType = EventSubType> {
  type: T;
  version: string;
  condition: EventSubConditionMap[T];
  transport: EventSubTransport;
  /** Only drop.entitlement.grant (must be true). */
  is_batching_enabled?: boolean;
}

// ---------------------------------------------------------------- WebSocket frames
export interface WsMetadata {
  message_id: string;
  message_type: 'session_welcome' | 'session_keepalive' | 'notification' | 'session_reconnect' | 'revocation';
  message_timestamp: string;
  subscription_type?: string;
  subscription_version?: string;
}
export interface WsSession {
  id: string;
  status: 'connected' | 'reconnecting';
  connected_at: string;
  keepalive_timeout_seconds: number | null;
  reconnect_url: string | null;
}
export type WsMessage =
  | { metadata: WsMetadata & { message_type: 'session_welcome' }; payload: { session: WsSession } }
  | { metadata: WsMetadata & { message_type: 'session_keepalive' }; payload: Record<string, never> }
  | { metadata: WsMetadata & { message_type: 'session_reconnect' }; payload: { session: WsSession } }
  | { metadata: WsMetadata & { message_type: 'notification' }; payload: AnyEventSubNotification }
  | { metadata: WsMetadata & { message_type: 'revocation' }; payload: { subscription: EventSubSubscription } };

// ---------------------------------------------------------------- maps
/** Latest documented version for each type — pass this as \`version\` when subscribing. */
export const EVENTSUB_VERSIONS = {
${verLines.join('\n')}
} as const;
export type EventSubType = keyof typeof EVENTSUB_VERSIONS;

export interface EventSubEventMap {
${mapLines.join('\n')}
}

export interface EventSubConditionMap {
${condMapLines.join('\n')}
}

// ---------------------------------------------------------------- shared reference objects
${sharedIfaces.join('\n')}
// ---------------------------------------------------------------- conditions
${condIfaces.join('\n\n')}

// ---------------------------------------------------------------- events
${evIfaces.join('\n')}`;
}

await run();
