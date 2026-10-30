#!/usr/bin/env node
// Print the full official section (auth, URL, params, body, response, codes, examples) for a
// Twitch Helix endpoint from references/official/api_reference.md.
//
//   node scripts/endpoint.ts "Create Poll"          exact/fuzzy name (case-insensitive)
//   node scripts/endpoint.ts poll                   several matches -> lists them
//   node scripts/endpoint.ts "POST /helix/polls"    match by method + path (or just a path)
//   node scripts/endpoint.ts create-poll            match by anchor
//   node scripts/endpoint.ts --list                 list every endpoint (name, method, path)
//   node scripts/endpoint.ts "Get Streams" --brief  only Authorization + URL + query params
//
// Node 22+ (runs .ts natively by stripping types). No dependencies.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ref = join(here, "..", "references", "official", "api_reference.md");
const lines = readFileSync(ref, "utf8").split("\n");

type Section = { name: string; anchor: string; start: number; end: number; method: string; path: string };

const sections: Section[] = [];
const h2 = /^## (.+?)\s+\{#([^}]+)\}\s*$/;
for (let i = 0; i < lines.length; i++) {
  const m = h2.exec(lines[i]!);
  if (!m) continue;
  if (sections.length) sections[sections.length - 1]!.end = i;
  sections.push({ name: m[1]!.trim(), anchor: m[2]!, start: i, end: lines.length, method: "", path: "" });
}
for (const s of sections) {
  for (let i = s.start; i < s.end; i++) {
    const u = /`([A-Z]+) https?:\/\/[^/]+(\/[^`\s]*)`/.exec(lines[i]!);
    if (u) { s.method = u[1]!; s.path = u[2]!; break; }
  }
}

const args = process.argv.slice(2);
const brief = args.includes("--brief");
const query = args.filter((a) => !a.startsWith("--")).join(" ").trim();

if (args.includes("--list") || !query) {
  if (!query && !args.includes("--list")) {
    console.error('usage: node scripts/endpoint.ts "<endpoint name | anchor | METHOD /path>" [--brief] | --list');
  }
  for (const s of sections) console.log(`${s.name.padEnd(42)} ${s.method.padEnd(6)} ${s.path}`);
  process.exit(query || args.includes("--list") ? 0 : 1);
}

const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9/ ]+/g, " ").replace(/\s+/g, " ").trim();
const q = norm(query);
const qWords = q.split(" ").filter(Boolean);
// Singular/plural tolerant word match ("rewards" ~ "reward", "polls" ~ "poll").
const stem = (w: string) => w.replace(/(es|s)$/, "");
const hasWord = (hay: string[], w: string) => hay.some((h) => h === w || stem(h) === stem(w) || h.startsWith(w));

function score(s: Section): number {
  const n = norm(s.name);
  if (n === q || s.anchor === query.toLowerCase()) return 100;
  const mp = norm(`${s.method} ${s.path}`);
  if (mp === q || norm(s.path) === q || norm(s.path) === norm(`/helix${query}`)) return 90;
  const words = n.split(" ");
  if (qWords.every((w) => hasWord(words, w))) return 50 + (qWords.length / words.length) * 10;
  if (n.includes(q)) return 40;
  if (q.includes("/") && mp.includes(q)) return 30;
  return 0;
}

const ranked = sections.map((s) => ({ s, sc: score(s) })).filter((x) => x.sc > 0).sort((a, b) => b.sc - a.sc);
if (!ranked.length) {
  console.error(`No endpoint matches "${query}". Try --list.`);
  process.exit(1);
}
// Print a single section if exactly one top-scoring hit and it's a strong match.
const top = ranked[0]!;
const ties = ranked.filter((x) => x.sc === top.sc);
const pathHits = ranked.filter((x) => x.sc === 90);
if (ties.length > 1 && !(top.sc === 90 && pathHits.length > 1)) {
  console.log(`"${query}" matches ${ranked.length} endpoints — be more specific:`);
  for (const { s } of ranked) console.log(`  ${s.name.padEnd(42)} ${s.method.padEnd(6)} ${s.path}`);
  process.exit(2);
}
const pick = top.sc === 90 && pathHits.length > 1 ? pathHits.map((x) => x.s) : [top.s];
if (top.sc < 100 && ranked.length > 1 && pick.length === 1) {
  console.error(`(best match for "${query}"; others: ${ranked.slice(1, 6).map((x) => x.s.name).join(", ")})`);
}

for (const s of pick) {
  let out = lines.slice(s.start, s.end).filter((l) => !/^\s*\[✎\]\(cloudcannon:/.test(l));
  if (brief) {
    const keep: string[] = [out[0]!];
    let on = false;
    for (const l of out.slice(1)) {
      if (l.startsWith("### ")) on = /^### (Authorization|URL|Request Query Param)/.test(l);
      if (on) keep.push(l);
    }
    out = keep;
  }
  console.log(out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd());
  console.log(`\n(source: references/official/api_reference.md line ${s.start + 1}, https://dev.twitch.tv/docs/api/reference/#${s.anchor})\n`);
}
