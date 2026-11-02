// Read only the supplied local revision; write a review sheet to an explicitly supplied destination.
import { createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
const [dataDir, output] = process.argv.slice(2);
if (!dataDir || !output) throw new Error('usage: language-review.mjs <lane-owned data directory> <review.md>');
const table = JSON.parse(await readFile(new URL('../src/cartography/language-names-1.json', import.meta.url), 'utf8'));
const pointer = JSON.parse(await readFile(join(dataDir, 'current.json'), 'utf8'));
const counts = new Map();
for await (const line of createInterface({ input: createReadStream(join(dataDir, 'revisions', pointer.revision, 'channels.ndjson')), crlfDelay: Infinity })) {
  if (!line) continue;
  const channel = JSON.parse(line);
  counts.set(channel.language, (counts.get(channel.language) ?? 0) + 1);
}
// The preview is a verified derivative of the same revision, with names kept out of the public geometry.
const { readdir } = await import('node:fs/promises');
let world;
for (const id of await readdir(join(dataDir, 'previews'))) {
  const candidate = JSON.parse(await readFile(join(dataDir, 'previews', id, 'world.json'), 'utf8'));
  if (candidate.revision === pointer.revision && (!world || candidate.algorithm > world.algorithm)) world = candidate;
}
if (!world) throw new Error('Draw the local preview before generating its review sheet');
const mapped = new Map(world.regions.filter(region => region.language).map(region => [region.language, region.members]));
const short = {
  ru: 'Language, not nationality; separate from uk.', uk: 'Own isle; never folded into ru.',
  zh: 'No country, script or Mandarin inference.', 'zh-hk': 'Cantonese, never a political region.',
  asl: 'This sign language, not all sign languages.', other: 'Language unspecified by Twitch.',
  tl: 'Tagalog follows the supplied code.', ms: 'Observed; no mapped holding yet.',
};
const rows = [...counts].sort((a, b) => (mapped.get(b[0]) ?? 0) - (mapped.get(a[0]) ?? 0) || a[0].localeCompare(b[0], 'en'));
const lines = [
  '# Language names 1 — founder review', '',
  '**PROPOSED.** Reviewer and date are empty. Tobias: approve the table or mark exact changes; nothing here claims approval.', '',
  `Survey: \`${pointer.revision}\`; ${world.counts.channelsObserved.toLocaleString('en-US')} observed channels, ${world.counts.mapped.toLocaleString('en-US')} mapped holdings. Land = holdings meeting the survey threshold, not population or territory.`, '',
  'All labels describe stream languages. The English UI keeps each channel’s own spelling. A name change never changes the land, IDs, coasts or coordinates. The table covers all 184 ISO two-letter codes plus `asl`, `other` and `zh-hk`; reserved codes do not assert Twitch support.', '',
  '| Code | Map label | Land | Note |', '|---|---|---:|---|',
];
for (const [code] of rows) {
  const entry = table.names[code];
  if (!entry) throw new Error(`Language ${code} needs a checked-in label before publication`);
  lines.push(`| ${code} | ${(entry.mapLabel ?? entry.label).replaceAll('\n', ' ')} | ${(mapped.get(code) ?? 0).toLocaleString('en-US')} | ${short[code] ?? ''} |`);
}
lines.push('', 'Full table and review fields: [language-names-1.json](../../../apps/surveyor/src/cartography/language-names-1.json). The remaining ISO codes have zero observed holdings in this survey; their English names are in that same reviewable table.', '',
  'Sources: [Twitch’s broadcaster-language field](https://dev.twitch.tv/docs/api/reference/#get-channel-information), [Twitch’s stream-language guide](https://help.twitch.tv/s/article/languages-on-twitch#streamlang), [Twitch’s ASL announcement](https://blog.twitch.tv/en/2016/07/15/say-hello-hallo-bonjour-ni-hao-hola-or-kon-nichiwa-to-multi-language-filters-twitch-blog-fa37fbbc4c07/), and [ISO language codes](https://www.loc.gov/standards/iso639-2/php/code_list.php). The guide did not render during this review; the ISO superset avoids relying on an incomplete menu list.', '',
  '**Sign-off:** set `review.status` to `reviewed`, `reviewedBy` to the reviewer’s name and `reviewedAt` to the approval date only after Tobias’s actual approval. Keep the current proposal otherwise.', '');
await writeFile(output, lines.join('\n'));
console.log(`Review sheet: ${rows.length} observed codes; ${Object.keys(table.names).length} labels; status ${table.review.status}`);
