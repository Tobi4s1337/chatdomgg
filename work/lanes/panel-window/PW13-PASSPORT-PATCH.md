# PW13 Passport owner patch

PW13 remains unticked. These are unapplied handoff patches, not changes to the shared owners or an accepted worktree zip.

needs: main/front-door Review and apply `PW13-PASSPORT-NEEDS.patch`, then `PW13-PASSPORT-PANEL.patch`. Both dry-run cleanly against this checkpoint. The first touches `packages/ui`, `packages/shared` and `apps/api/src/passport`, outside this lane's write scope. The companion contains the panel import switches and transport tests; applying it before the new exports exist would break the panel build.

## Boundary and compatibility

The existing general Passport schema and all general exports remain. Record definitions and the book's duplicate/date/privacy rules move into one shared factory. Its live constructor accepts only `origin: 'live'`; it never relabels an answer. The API reply reader shares strict keys, record schemas, page bounds and denials, with the chosen book reader supplied at its boundary. The general reader still accepts the existing bench protocol.

The Book and Reading retain their layout, controls and session implementation. Three provenance-seal branches are removed under decision 25. `@chatdom/ui/passport/live` exports the existing book, reading, session, `CrestArms` and view types without fixtures or the legacy disclosure-acknowledgement helper. This is a presentation entry: wire validation remains mandatory. There is no copied Book, second protocol parser, string obfuscation or weakened simulation guard.

The companion switches three runtime UI imports and the transport to `readLivePassportReply` from `apps/api/src/passport/live-contracts`. Refused replies remain unavailable. Its tests supply a test-only live card and origin to the authoritative reader before it constructs a reply; separate cases reject non-live and unknown wire books. The lane's unused simulation props and source flag were removed in the actual worktree; bench transport and its actual book origin remain intact.

## Demonstrated candidate

An isolated current-panel copy under `/tmp/panel-window-passport-candidate` uses workspace links to the candidate UI and shared packages. No actual owner file was edited, even temporarily.

- Both patches pass `patch --dry-run -p1` against the worktree.
- Six scoped existing suites pass, 52 tests: shared passport schema, API contracts and reader, UI session and pages, and panel transport. Focused strict TypeScript passes including the updated transport test.
- Additional runtime checks accept a valid live visible book and page, reject unknown/non-live origins, extra hidden-book data, duplicate page records and an empty continuation page. The legacy reader still accepts its bench-origin hidden book. Session checks cover hiding before a read, ignoring stale disclosure and discarding a late reply after hiding.
- The original packager passed every existing hosted-asset guard. The lane then corrected its incomplete first-load accounting and reran the full candidate with that strengthened checker. The JavaScript simulation guard and all other guards remain intact.
- The final candidate zip is 17 files, 482 KiB. Complete conservative local graphs, including fonts, textures and transitive modules: Panel 888,934 bytes / 12 files; Mobile 888,919 / 12; Config 635,866 / 11; Live Config 635,871 / 11. These are below both decimal 1 MB and 1 MiB. Remote Helper and backend responses are outside these totals. See `work/evidence/panel-window/PW13/passport-live-package.txt`.
- Three real-checker fixture tests cover an oversized nested font, missing nested fonts/modules, module cycles and SVG/data-URI fragments. They run without Twitch or a workspace build: `node --test apps/panel/scripts/extension-assets.test.mjs`.

The full GPU batch used `--wait 30 --max 10` and returned exit 3, Chrome disconnected; it created no live lease job or services. This is not busy-lease contention or a PW11 contention blocker. Under the shared host capture lock, the single permitted SwiftShader fallback shows the candidate Passport at 318×496: `work/evidence/panel-window/PW13/passport-live-candidate@318x496.png`. It was inspected at native size: parchment, stamp, thumb tabs and footer fit without horizontal overflow. This is explicitly an invented layout fixture, not a real citizen or production wire proof. The temporary candidate Vite server on 5182 and browser were stopped and the lock released. No fps claim is made for static UI.

## Limits and owner verification

The actual lane panel still imports the general Passport entry and therefore correctly fails the strict simulation guard in its viewer/window chunks. Its build, scoped types, changed-file lint and 40 focused adapter/card/transport checks pass. No actual worktree zip is accepted. After the owners apply both patches, rerun the normal packager and the complete leased screenshot matrix, and inspect the images. The full GPU matrix and Hosted Test remain unrun; registration owner identity, the real Tier 1 founding entry and production gift effects remain separate open seams in `PW13-NEEDS.md`.
