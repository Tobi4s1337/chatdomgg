# Earned keepsakes on the card

`createEarnedShelf` follows the host card's supplied subject and passport disclosure. The host calls
`replace(subject, disclosure, transport)` whenever either changes, and `close()` when the card is dismissed. A missing
subject, disclosure or read transport is unavailable; it is not an empty collection. The transport reads the
existing passport projection and must be bound by main to the actual subject. The adapter checks the returned book
against `PassportBookSchema`, its holder and the snapshotted disclosure origin before showing anything.

A hidden disclosure clears the shelf immediately and starts no read. Old callbacks are ignored. Revision tracking is
separate for each subject and origin; a stale shown disclosure cannot override a newer hidden one. A simulated
projection remains labelled through loading, failure, empty, private and populated states. The card preview shows at
most three supplied keepsakes using the passport's crest marks. When more exist, it says they are in the passport;
the host's existing passport surface owns further pages. Pass `onOpenPassport` to make that notice an accessible
button; without an opener it remains plain text. The adapter does not infer rewards from growth, worn items,
plot IDs or purchases.

Main owns the trusted subject and disclosed earned-record read adapter, plus package export/dependency wiring. The
bench is explicitly simulated and includes a long name and an extra record to exercise the bounded preview. Run
`pnpm exec vitest run apps/panel/src/growth-card/shelf.test.ts` and
`node apps/panel/src/growth-card/render-check.mjs` for focused checks. The single-still panel capture is
`node apps/panel/src/growth-card/capture.mjs`.
