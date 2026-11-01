# Home progress card

`HomeProgress` renders a `HomeProgressState`; `createHomeProgress` binds a feed to a home and sends replacement
states to the host. The host must supply the trusted citizen-to-home mapping as `{ kingdomId, plotId }` and must
replace the binding when the subject or disclosure changes. A frame's plot IDs are public presentation data, not
proof of who owns a home. No identity is inferred here.

Call `replace(feed, binding)` for a new binding and `close()` when the host closes the card. Both clear the previous
state before accepting another snapshot. Passing a missing feed or binding produces `unavailable`. Stopped feeds
cannot restore a prior subject. A feed whose label changes, a frame with the wrong origin or kingdom, malformed data,
a conflicting same-sequence home, or a regression in stage, qualified days or best streak produces `invalid`.
Older frames are ignored; a repeated identical snapshot can restore the card after an unavailable signal. Current
streak is allowed to reset. The bounded recent beat tail is never replayed as credit.

A matching snapshot with no home is `empty`, not a fabricated zero; a known simulated feed remains labelled through loading, invalid, unavailable, empty and populated states. The remaining data states are `loading`, `unavailable` and `invalid`. A day means the witnessed minimum of
ten minutes; the card does not claim total watch time. At the maximum stage there is no next goal.

The web bench is simulated. Main owns production subject mapping and package export/dependency wiring; this folder
does not provide an endpoint or an authority. Run `pnpm exec vitest run packages/ui/src/growth-card/adapter.test.ts`
and `node apps/web/src/growth-card/render-check.mjs` for the focused nonvisual checks. The capture runner takes one
still per lock acquisition: `node apps/web/src/growth-card/capture.mjs desktop` or `mobile`.
