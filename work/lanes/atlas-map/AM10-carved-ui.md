# AM10 carved UI checkpoint

One walnut cartouche holds the Atlas title, search and a dated survey seal.
Five engraved key buttons describe Live, Founded, Waiting land, Road and Your
home only when inspected. The phone key opens as a bottom sheet. Holding and
waiting-land cards keep their identity and Enter, Watch and Share actions visible
while their dated register details scroll.

## Decisions

- The shared `@chatdom/ui/kit.css` provides the material and type tokens. Atlas
  fittings live in `atlas/ui/chrome.css` until front-door can adopt reusable
  pieces. Native button/link/input behavior remains intact. Brass focus rings
  cover the controls, and a focusable details region permits keyboard scrolling.
- The ordinary still's verbose ribbon gives way to the compact seal. Survey
  date and live/held clock remain visible; hover, focus or tap gives one short
  explanation. A previous-day held clock retains its complete UTC date and can
  wrap beneath the title. A failed land bake still discloses the incomplete map
  outside the normal seal; exceptional states are not hidden to meet a word cap.
- Default desktop framing uses the full map width. A selected card reserves
  space in the moving camera's framing; the phone accounts for its cartouche.
  No immutable land, names or coordinates change.
- The key's caption occupies reserved space on phones, preventing a bottom sheet
  from moving its own hit targets when a pointer enters. First Escape clears the
  caption; the second closes the sheet and restores focus to its Key control.
- Shutters and wax have short weighted motion; the wax reaches its compressed
  card keyframe 36 ms into its animation. A selection first presses the real
  search row's seal, then yields a painted frame before opening the card. Both
  owned animation frames cancel on query changes, blur, Escape and disposal.
  This gives prompt visible feedback even when a region must load or the still
  must lay out the selected holding. Reduced motion removes the animations.
  Quiet material cues allocate audio only after a control gesture, bound voice
  count and bursts, suppress stale asynchronous unlocks, stop on mute/hidden/
  hero, and close their owned context on disposal. Search selection by keyboard
  receives the same wax cue. Unmuting does not replay previous cues.
- `options.slots.footer(element)` optionally mounts front-door-owned footer
  content and returns its cleanup. It is mounted only in explore and cleaned
  when switching to hero or disposing. The runtime-free embed entry remains
  light. The clarification is recorded in both lanes' `SEAMS.md`.
- This checkout has the earlier carved kit, not front-door's newer site exports.
  Watch remains a truthful text link. The official Twitch mark must come from
  front-door unchanged after its shared exports merge; it is never redrawn here.

## Verification and evidence

Scoped TypeScript, ESLint and the web production build pass. 86 focused tests
pass with `vitest run --environment node` across still composition, material
sound ownership, formatting, history and route parsing. The web test runner's
default environment requires an unavailable `jsdom`; these pure modules use
the explicit Node environment, and the real DOM is exercised in Chrome.

Browser guards and capture paths are recorded in
`work/evidence/atlas-map/am10-carved-checks.json`: 58/58 pass with zero page
errors. The default has 18 desktop / 19 phone words; first painted row seal
compression measures 21.0 ms / 15.1 ms from pointer-down. The browser counts visible
control copy including the search placeholder, excluding geographic and channel
labels drawn on the map. It tests the five single-line descriptions, phone sheet
dismissal/focus, visible Watch action, seal timing, reduced motion, a retained
frame at the next UTC date, the incomplete-land warning, and footer lifecycle.
The clock-shift and induced bake-failure tests produce no product screenshots.
The focused reduced-motion follow-up passes for the phone key, card and wax
seal (`am10-carved-reduced-motion.json`); it caught and fixed a more specific
phone entrance selector overriding the original accessibility rule.

Real-data PNGs use the owned preview `pv-20261101T223528Z-0eafe4c17e44` and its
retained live frame. Default, focused search and selected Squeezie card appear
at 1440×900 and 390×844; the phone key and the hero/explore bench complete the
set. These are the dated Canvas2D fallback with WebGL disabled. Every retained
PNG is opened and judged against the art direction. The captures demonstrate
layout and truthful retained data, not camera flight or GPU speed.

No import, public Twitch write, service change or immutable data update ran.
The owned service and preview use `127.0.0.2:5199` and `127.0.0.2:5175` only
during verification and are stopped afterwards. The real-GPU lease returned
exit 3 (tunnel disconnected). A single short SwiftShader capture reached
`ready=map`, `state=ready`, `context=ok`, `names=ready` without page or console
errors; see `am10-carved-swiftshader-1440.png` and its JSON beside the other
evidence. The previously observed readiness timeout did not reproduce in that
one capture; it does not establish startup reliability or GPU speed.

The phone still's selected-holding path can synchronously rerun `layoutStill`
when the holding is outside the current crop. The initial captures measured
242–373 ms from click to card mount on this host. The final sweep measured
571.4 ms from pointer-down to phone card mount (567.5 ms from click), with the
card's compressed keyframe at 607.4 ms. The new row press is painted before
that work, and its response is measured separately; card mount is not claimed
to be under 100 ms. Avoiding the full selected-only relayout remains part of
the final phone/performance pass.

## Integration and next checks

No server adoption is needed for this client-only checkpoint; rebuild the web
client after merge. Front-door should mount its How it works/footer through the
optional slot and adopt the new engraved key/compact seal fittings into the kit
where useful. After its site exports merge, reuse its official `TwitchMark` /
`WatchOnTwitch` on Watch links and the map corner without modifying the mark.
The earlier gateway/env adoption and proposed language-name review remain as
recorded in the preceding checkpoints.

AM10 remains unchecked. Next is the final WebGL readiness, real-GPU and phone
pass: `/map` and `/-/atlas-embed?mode=hero` at 1920×1080 and 390×844, idle and
panning speed, first frame, and the actual phone's touch/key/card/audio behavior.
