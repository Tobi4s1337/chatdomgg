# AM10 final local phone and browser checks

The fixed Canvas2D map avoids re-laying out an offscreen selection and avoids
re-lettering its head when background chunks arrive. Bloom also reuses its
motion-preference query. The input's row response stays prompt, but card latency
remains variable: initial runs painted in 82.5 / 92.3 ms, a later run took
708.7 ms, and the final run after the cache changes took 293.2 ms. The stronger
100 ms card diagnostic is not met. These are browser checks on this host at
390×844, not physical-phone or GPU performance claims.

## Decisions

- `layoutStillSelection` reuses the base layout for an absent, withheld,
  stale-store, already drawn or wholly offscreen selection. `stampPlacement`
  supplies the exact same anchor/aspect/width/hash geometry to this relevance
  check and the ordinary placement pass. Partially visible stamps stay relevant.
- A visible lower-tier or collision-suppressed selection still receives the full
  selected-first collision pass. No forced stamp is appended over existing
  labels. A completely offscreen mark no longer displaces visible neighbours
  through its invisible margin claims. The cached visible layout stays stable.
- Tests prove both the no-query/no-letter-measurement path and the retained
  selected-first stamp, shield and name. Withheld and stale identities remain
  rejected. No immutable files, holdings, placement or names change.
- `SettlerStore.labelsVersion` changes for a names/visibility projection or
  actual name expiry, not a town/village chunk. The still's lettering follows
  it; existing `version` behavior remains intact for moving-map and live
  consumers. Selected lower-tier names refresh, disappear under withholding
  and return correctly. Background chunks still update the live wash.
- Each mounted scene retains one `MediaQueryList` and reads its live `.matches`
  value for bloom. Previously each of roughly 21,757 stains called
  `matchMedia` again. The sampled native work disappears from the after-cache
  profile's top entries without freezing the preference or adding a listener.
- Moving-map acceptance reads the outer embed's readiness and the inner scene's
  state, context and names. A visibility timeout alone is not evidence that the
  renderer failed. One diagnostic reached `map / ready / ok / ready` despite
  the original checking timeout. Geometry checks verify the existing full-size
  scene root; this checkpoint changes no root CSS.

## Strict-CSP prerequisite

The actual public CSP records a blocked `Function` capability probe from Zod's
object-JIT initialization in the page's static shared-schema imports. The trace
is at 325.3 ms; the Atlas chunk begins loading at 409.2 ms. This happens before
Atlas can configure anything. The map can render through the caught probe, but
the full zero-violation gate remains unmet.

`am10-phone-final-provenance.json` records the stack and resource order;
`am10-phone-final-csp-diagnostic.json` records actual scene readiness and the
policy violation. Main/front-door must use the public
`config({ jitless: true })` API from `zod` in a bootstrap module evaluated before
shared schema modules, or configure then dynamically import the app entry.
Putting the call in the main module body after static schema imports is too
late. Keep the CSP unchanged. The need is recorded in both lanes' `SEAMS.md`;
this lane does not modify their bootstrap or the shared package.

The focused checker defaults to the real strict-CSP gate. Its explicit
`ATLAS_TEST_CSP_JITLESS=1` mode injects the missing host prerequisite in the test
only and writes separately named `with-bootstrap` artifacts with a
`requiredHostBootstrap` field. That mode can demonstrate the Atlas consumer
under the required configuration, never completion of the shipped page's CSP
acceptance. Product data and pictures remain the actual retained survey.

## Verification

Scoped TypeScript, ESLint, the web build, and 83 model/composition/parity/live
paint tests pass.
The phone fallback guards demonstrate keyboard selection, the correct ring and
card, Escape, the real offscreen search result, prompt row/card response and
unchanged visible labels. First-run results and the subsequent strict-CSP
timeout are retained in `am10-phone-final-checks.json`; the timeout is not
rewritten as a pass. The final phone-only result has 8/9 passing checks: the
100 ms card-paint diagnostic fails (137.8 ms DOM, 293.2 ms two-frame paint),
while row acknowledgement takes 5.7 ms and identity, keyboard, ring, Escape,
cached labels and page-error checks pass. See `am10-phone-final-still-checks.json`.

The before/after CPU profiles retain the failed and successful selections.
After-cache paint samples are 309.6, 63.8 and 329.1 ms. Native `drawImage` work
dominates and long tasks of 161–327 ms overlap or precede input. The profiles
span background chunk/wash work, so they do not attribute every cost to the
selection itself. The card target failed in three focused trials; it is
recorded as blocked rather than retried or relaxed. The next investigation is
coalescing or moving the indivisible wash canvas paint off the interaction path.

The separate moving diagnostic reaches `map / ready / ok / ready` with the
test-only host bootstrap, 65 tiles, zero uncovered/failed tiles and zero CSP
violations. Its sampled 44.4 s startup is SwiftShader evidence only; earlier
samples show root baking and fading, not a promise that startup is reliable.
The broad conditional sweep still timed out and produced no four-size capture
set. `am10-phone-final-moving-diagnostic.json` preserves those gates.

Three PNGs were opened and judged: the actual strict-CSP desktop map, the
separately labelled moving diagnostic with its required bootstrap, and the
latest real Squeezie phone card. The dated stamp wraps after UTC midnight;
the card keeps its actions and selected identity readable. Default moving-map
word counts, hero/phone moving captures and the full final tour remain unproven.

No collector import, public Twitch write or production service change ran.
The owned service reads `pv-20261101T223528Z-0eafe4c17e44` on
`127.0.0.2:5199`; the owned web preview is `127.0.0.2:5175` during checks only.
The real-GPU lease again returned exit 3 (tunnel disconnected), recorded in
`am10-phone-final-gpu.json`. This is the third consecutive goal turn with that
same external blocker, following search fallback and carved UI. No new GPU
speed claim is made, and the old 24.9 fps hero sample remains a failed target.

## Remaining AM10 acceptance

AM10 stays unchecked. It still needs reliable card responsiveness, the actual
host CSP bootstrap, the shared
official Twitch mark/footer integration, real-GPU `/map` and hero stills and
idle/drift/panning measurements at 1920×1080 and 390×844, and Tobias's physical
phone review of touch, keyboard, card, audio and frame pacing. The name table's
review request already exists; approval is not fabricated. Earlier operator
env/proxy adoption needs remain.

Once those prerequisites are available, rerun the default checker without the
test bootstrap, the existing embed cleanup checks, and the real-device passes.
The active user objective explicitly says that after the same failure repeats
three times, record it as blocked and move to the next task. Under that
instruction AM11 is next, while every AM10 gate remains open. The complete goal
and its boxes are unchanged.
