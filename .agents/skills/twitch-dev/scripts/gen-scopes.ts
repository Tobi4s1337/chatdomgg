#!/usr/bin/env node
// Generate the exhaustive scope table in references/scopes.md (between the GENERATED markers)
// and references/scopes.json (used by `node scripts/token.ts scopes <query>`).
//
// Sources (all official dev.twitch.tv snapshots, refreshed by scripts/refresh-docs.sh):
//   1. references/official/authentication_scopes.md            (primary: every scope + what it unlocks)
//   2. <api reference>  api_reference.md  (optional cross-check: "### Authorization" of every endpoint)
//   3. <eventsub types> eventsub_eventsub-subscription-types.md (optional cross-check: per-type Authorization)
// Items found only via the cross-checks are marked with a dagger (†) so you can see where the
// scopes page is incomplete.
//
// Usage: node scripts/gen-scopes.ts [--api <api_reference.md>] [--eventsub <eventsub-subscription-types.md>] [--check]
//   --check  : do not write, exit 1 if the generated output differs from what is on disk (CI use).
// Node >= 22.18 runs this .ts file directly (type stripping). Only erasable TS syntax is used.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const skill = resolve(here, '..');
const suite = resolve(skill, '..');

function flag(name: string): string | undefined {
	const i = process.argv.indexOf(name);
	return i >= 0 ? process.argv[i + 1] : undefined;
}

const scopesPath = join(skill, 'references/official/authentication_scopes.md');
const apiPath = flag('--api') ?? join(suite, 'twitch-api/references/official/api_reference.md');
const esPath = flag('--eventsub') ?? join(suite, 'twitch-eventsub/references/official/eventsub_eventsub-subscription-types.md');
const checkOnly = process.argv.includes('--check');

interface Link { name: string; anchor: string; note?: string; extra?: boolean }
interface Scope {
	scope: string;
	section: 'api' | 'irc' | 'pubsub';
	description: string;
	api: Link[];
	eventsub: Link[];
}

// ---------- 1. scopes page ----------
const scopesMd = readFileSync(scopesPath, 'utf8');
const scopes = new Map<string, Scope>();
let section: Scope['section'] = 'api';
for (const line of scopesMd.split('\n')) {
	if (line.startsWith('## IRC')) section = 'irc';
	else if (line.startsWith('## PubSub')) section = 'pubsub';
	const m = /^\| `([a-z_:]+)` \| (.*) \|$/.exec(line);
	if (!m) continue;
	const [, scope, rest] = m as unknown as [string, string, string];
	const apiIdx = rest.indexOf('**API**');
	const esIdx = rest.indexOf('**EventSub**');
	const cut = [apiIdx, esIdx].filter((i) => i >= 0);
	const description = (cut.length ? rest.slice(0, Math.min(...cut)) : rest).trim();
	const part = (start: number, end: number) => (start < 0 ? '' : rest.slice(start, end < 0 || end < start ? undefined : end));
	const links = (s: string): Link[] => {
		const out: Link[] = [];
		const re = /\[([^\]]+)\]\(([^)]+)\)(\s*\((optional)\))?/g;
		let x: RegExpExecArray | null;
		while ((x = re.exec(s))) out.push({ name: x[1]!, anchor: (x[2]!.split('#')[1] ?? '').replace(/^\//, ''), note: x[4] });
		return out;
	};
	scopes.set(scope, {
		scope,
		section,
		description,
		api: links(part(apiIdx, esIdx)),
		eventsub: links(part(esIdx, -1)),
	});
}
if (scopes.size < 60) throw new Error(`Only parsed ${scopes.size} scopes from ${scopesPath} - page format changed?`);
const scopeNames = [...scopes.keys()].sort((a, b) => b.length - a.length); // longest first for matching

function scopesIn(text: string): string[] {
	const found = new Set<string>();
	for (const s of scopeNames) {
		const re = new RegExp(`(^|[^a-z_:])${s.replace(/[:_]/g, (c) => `\\${c}`)}($|[^a-z_:])`);
		if (re.test(text)) found.add(s);
	}
	return [...found];
}

// ---------- 2. API reference cross-check ----------
let apiChecked = false;
if (existsSync(apiPath)) {
	apiChecked = true;
	const md = readFileSync(apiPath, 'utf8');
	for (const sec of md.split(/\n## /).slice(1)) {
		const head = /^(.*?)\s+\{#([^}]+)\}/.exec(sec.split('\n')[0] ?? '');
		if (!head) continue;
		const [, name, anchor] = head as unknown as [string, string, string];
		if (anchor === 'create-eventsub-subscription') continue; // generic: its auth text only gives example scopes
		const auth = /### Authorization[^\n]*\n([\s\S]*?)(\n### |$)/.exec(sec)?.[1] ?? '';
		for (const s of scopesIn(auth)) {
			const entry = scopes.get(s)!;
			if (!entry.api.some((l) => l.anchor === anchor || l.name.toLowerCase() === name.toLowerCase()))
				entry.api.push({ name, anchor, extra: true });
		}
	}
}

// ---------- 3. EventSub subscription types cross-check ----------
let esChecked = false;
if (existsSync(esPath)) {
	esChecked = true;
	const md = readFileSync(esPath, 'utf8');
	// Each type: "### <type> [Vn|BETA]  {#anchor}" ... "### Authorization  {#authorization-n}" <text> "### ..."
	const re = /\n### ([a-z_.]+(?: [Vv]\d+)?(?: BETA)?)\s+\{#([^}]+)\}([\s\S]*?)(?=\n### [a-z_.]+(?: [Vv]\d+)?(?: BETA)?\s+\{#|\n## |$)/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(md))) {
		const [, typeName, anchor, body] = m as unknown as [string, string, string, string];
		if (!typeName.includes('.')) continue;
		const auth = /### Authorization[^\n]*\n([\s\S]*?)(\n### |$)/.exec(body)?.[1] ?? '';
		for (const s of scopesIn(auth)) {
			const entry = scopes.get(s)!;
			const label = typeName;
			const n = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, ''); // "Channel Chat User Message Hold" ~ channel.chat.user_message_hold
			if (!entry.eventsub.some((l) => l.anchor === anchor || n(l.name) === n(label) || n(l.anchor) === n(anchor))) entry.eventsub.push({ name: label, anchor, extra: true });
		}
	}
}

// ---------- output ----------
const apiUrl = (a: string) => `https://dev.twitch.tv/docs/api/reference/#${a}`;
const esUrl = (a: string) => `https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/#${a}`;
const fmt = (ls: Link[], url: (a: string) => string) =>
	ls.length ? ls.map((l) => `[${l.name}](${url(l.anchor)})${l.note ? ` (${l.note})` : ''}${l.extra ? '†' : ''}`).join(', ') : '—';
const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

const all = [...scopes.values()];
const rows = (sec: Scope['section']) => all.filter((s) => s.section === sec);
const lines: string[] = [];
lines.push(`<!-- BEGIN GENERATED by scripts/gen-scopes.ts from official docs snapshot ${readFileSync(join(skill, 'references/official/FETCHED_ON'), 'utf8').trim()}. Do not edit by hand. -->`);
lines.push('');
lines.push(`${rows('api').length} API/EventSub scopes, ${rows('irc').length} IRC scopes, ${rows('pubsub').length} PubSub scope(s). ` +
	`† = found only by cross-checking the ${apiChecked ? 'API reference' : '(API reference not found)'} / ${esChecked ? 'EventSub types' : '(EventSub types not found)'} Authorization sections, not listed on the scopes page.`);
lines.push('');
lines.push('### Twitch API and EventSub scopes');
lines.push('');
lines.push('| Scope | Allows | Helix API endpoints | EventSub types |');
lines.push('|---|---|---|---|');
for (const s of rows('api')) lines.push(`| \`${s.scope}\` | ${esc(s.description)} | ${fmt(s.api, apiUrl)} | ${fmt(s.eventsub, esUrl)} |`);
lines.push('');
lines.push('### IRC chat scopes (legacy IRC transport only)');
lines.push('');
lines.push('| Scope | Allows |');
lines.push('|---|---|');
for (const s of rows('irc')) lines.push(`| \`${s.scope}\` | ${esc(s.description)} |`);
lines.push('');
lines.push('### PubSub scopes (PubSub is shut down — listed for completeness only)');
lines.push('');
lines.push('| Scope | Allows |');
lines.push('|---|---|');
for (const s of rows('pubsub')) lines.push(`| \`${s.scope}\` | ${esc(s.description)} |`);
lines.push('');
lines.push('<!-- END GENERATED -->');
const generated = lines.join('\n');

const outMd = join(skill, 'references/scopes.md');
const outJson = join(skill, 'references/scopes.json');
const json = JSON.stringify(all.map((s) => ({ ...s, description: esc(s.description) })), null, 1) + '\n';
const current = existsSync(outMd) ? readFileSync(outMd, 'utf8') : '# Scopes\n\n<!-- BEGIN GENERATED -->\n<!-- END GENERATED -->\n';
const next = current.replace(/<!-- BEGIN GENERATED[\s\S]*<!-- END GENERATED -->/, generated);
if (next === current && !current.includes('BEGIN GENERATED')) throw new Error('scopes.md has no GENERATED markers');

if (checkOnly) {
	const jsonCur = existsSync(outJson) ? readFileSync(outJson, 'utf8') : '';
	const stale = next !== current || jsonCur !== json;
	console.log(stale ? 'scopes.md/scopes.json are STALE - run node scripts/gen-scopes.ts' : 'scopes.md/scopes.json up to date');
	process.exit(stale ? 1 : 0);
}
writeFileSync(outMd, next);
writeFileSync(outJson, json);
const extras = all.reduce((n, s) => n + s.api.filter((l) => l.extra).length + s.eventsub.filter((l) => l.extra).length, 0);
console.log(`Wrote ${all.length} scopes to references/scopes.md + scopes.json (${extras} cross-check additions; api=${apiChecked} eventsub=${esChecked}).`);
