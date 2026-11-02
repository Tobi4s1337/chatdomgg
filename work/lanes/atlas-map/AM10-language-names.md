# AM10 language-name checkpoint

The Atlas now takes its English language labels from
`apps/surveyor/src/cartography/language-names-1.json`. The table remains
**proposed**, with reviewer and approval date empty. Its [review sheet](language-names-1-review.md)
lists every observed code, mapped size and sensitive naming choice. It covers
all 184 ISO two-letter codes plus `asl`, `other` and `zh-hk`; this coverage
superset does not claim that Twitch offers every reserved code.

Russian and Ukrainian map titles say “Streams in Russian” and “Streams in
Ukrainian”. Ukrainian keeps its own isle. `zh-hk` is Cantonese, `asl` is
American Sign Language, and `other` is Other languages. The default English
labels do not change channel names or their spelling. Cards and door handoffs
use the same table, with English language metadata for assistive reading.

Labels are presentation, keyed by language code. New `survey-preview-5`
artifacts retain codes in their historical label fields. The browser projects
the current table over both new artifacts and retained `survey-preview-4`
artifacts. No label lookup uses runtime locale data. A label edit changes
neither geography nor immutable artifact IDs; existing open sessions and
their aligned live frames remain readable.

## Evidence

- TypeScript, scoped ESLint, service build and web production build passed.
- 73 distinct focused tests passed: language coverage and no runtime locale
  lookup, label projection over hostile historical strings, rename without
  geometry mutation, preview generation and v4 retention, local preview
  rebuilding, holding handoff, data model and still composition.
- `atlas:check` passed against the lane-owned real revision
  `obs-20261101T185031Z-db1a6987a0e6`: 487,655 observed channels, 57,289 mapped
  holdings, 75.09 hours of observation, 1,503 sweeps and no gaps. Nothing founded.
- A local rebuild produced `pv-20261101T185031Z-d5dd4e33e7f8`. Compared with
  `pv-20261101T185031Z-7265e33c55d1`, **zero holdings moved**. Coasts, head order,
  region holding columns and decor stayed identical. See
  `work/evidence/atlas-map/am10-language-geometry.json`.
- A read-only live sweep at 22:17 UTC aligned 7,520 live holdings and 24,511
  pencil dabs to the new preview. The previous v4 preview and its live frame
  also passed verification. Its world still returns successfully.
- The ten largest language lands, in descending size: English, Russian,
  German, Spanish, French, Portuguese, Japanese, Chinese, Italian and Polish.
  Their 1440×900 PNGs and the 1440×900 / 390×844 overview were opened and
  reviewed. Paths and counts are in
  `work/evidence/atlas-map/am10-language-shots.json`; no browser page errors.
  The long cartouche/key is existing chrome awaiting the prescribed UI pass.

The real-GPU lease was occupied during the first attempt. The complete idle,
panning, hero and phone performance pass remains AM10 work; no software-rendered
frame times are used as performance evidence. The previous checkpoint's hero
performance gap remains open.

A supplemental capture of Ukrainian, Cantonese, ASL and Other languages did not
complete: three bounded attempts waited for WebGL readiness for 60 seconds.
The final diagnostic found a rendered still and no page errors, but no `map`
readiness signal. Restarting the lane preview after the final build did not
resolve it. Stop retrying this capture this turn; investigate still-to-map
readiness before the final AM10 visual pass. No supplemental PNGs are claimed.
The twelve completed images above remain the reviewed language evidence.

## Operator adoption after merge

Only the operator adopts code on the live service. This lane changed neither
the live service nor its data. No new public route is needed.

1. Rebuild the web and service from the merged commit.
2. With the existing service data directory, run the niced `atlas:preview`
   command. It verifies the current local revision and draws derived files
   without opening the collector, changing the import pointer/ledger or founding
   an edition. Do not start a fresh import just to update labels. Retain the old
   preview files for clients already pinned to them.
3. Run `atlas:live --once` with the operator's existing collector configuration,
   then `atlas:check`; confirm the new preview and its live frame align.
4. Restart the operator-owned service and adopt the matching web build through
   the existing workflow. Confirm the map and a card show the new labels.

The new command refuses corrupt local input and leaves existing previews alone
on verification failure. Tests prove rebuilding works after the collector is
closed and preserves the import ledger and pointer byte for byte.

needs: Tobias's review of `apps/surveyor/src/cartography/language-names-1.json`,
using the review sheet above. Actual approval is required before setting its
reviewer, date or status to reviewed. This does not block faces, the next AM10
checkpoint. Search fallback, carved chrome and the final GPU/phone pass follow.

Temporary service 5199 and preview 5175 were stopped. The prior checkpoint's
lost-handle test listener on 5198 still requires operator cleanup; the live
service on 5193 was never signalled.
