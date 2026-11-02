# Blind kit certification (policy v7)

The Forge never asks a vision model whether one wish's piece "looks like the wish". Two failed repeatability sets
and a failed wrong-image control (policy v6) showed that rating is noisy and swayed by the caption beside the
picture. Every piece is an authored motif, so likeness is a property of the kit and is measured once, blind.

## Protocol (`apps/codex/src/certificates/protocol.ts`, policy `forge-motif-blind-choice-v1`)

- For each kingdom family and kit revision, all 7 motifs × 3 finishes (accent none) are assembled on the native
  house's real sockets, with mountings rotating across chimney, lantern and weathervane.
- `renderForgeCertificationSheet` draws them as numbered tiles: a lit front view and a lit three-quarter view of each
  whole piece. The sheet has no caption, title, plan or motif name: only tile numbers.
- The order is shuffled with a fixed seed per family and round, so position cannot leak and rounds differ.
- One fresh read per sheet (`gpt-6.1-terra`, high effort, no tools) picks one word per tile from 22 choices: every
  true answer plus near neighbours (bird, lizard, snake, cat, dog, rabbit, squirrel, daisy, sun, fan, heart, leaf,
  tree, banana) and `unclear`. Parsing is strict; a malformed read counts as a miss for every tile.
- Three rounds per family. Three correct reads: `reads`; two: `weak`; fewer: `unread`.
- `data.ts` keeps only the counts and a digest of the exact geometry drawn. A re-authored motif no longer matches
  its digest and becomes `uncertified` until it is certified again. Grades are recomputed from counts, never stored.

Run (serial, `nice -n 10`, 9 model calls per revision):

```sh
node work/lanes/forge-wish/repeatability.mjs certify <kit-revision> [evidence-directory]
```

Private sheets, counts and call accounting go to `/tmp/chatdom-forge-wish/certify-<revision>-<id>/` (mode 0700/0600).
Paste the summary's counts and digests into `apps/codex/src/certificates/data.ts`.

## How the score uses it

Per wish, the quality score (`scoreForgeMeasure`) is computed from finite facts only: the word gate's and the
result gate's independent readings of which catalogue subject and slot the words ask for, the plan's motif and
kind, this certificate, and whether the named slot exists. `checkForge` has already proved one connected, supported,
quiet piece. The same evidence always gives the same score. The image read keeps the safety floor only.

The drafter is told which finishes read clearly per motif in the home's kingdom (`forgeReadableFinishes`).

## Results, kit revision 1 (current product kit), 2 November 2026

9 calls, 0 failed reads, 138 s of model time, 109,447 reported tokens. Answers were stable across rounds for
almost every tile.

| Motif | Hearth | Tide | Grove |
|---|---|---|---|
| sleeping dragon | reads in all finishes | reads in all finishes | reads in all finishes |
| crescent moon | reads in all | reads in all | reads in all |
| watchful owl | native reads; copper/ceramic unread ("rabbit") | native reads; copper/ceramic weak | reads in all |
| sunflower | native and ceramic read; copper weak | native and ceramic read; copper unread ("tree") | native reads; others unread ("tree", "daisy") |
| scallop shell | copper and ceramic read; native unread ("heart") | copper weak; native and ceramic unread ("heart", "leaf") | copper and ceramic weak; native unread ("tree") |
| sleeping fox | unread in all ("lizard", "unclear") | unread in all | unread in all |
| shooting star | unread in all ("bird") | unread in all | unread in all |

The first revision-2 run (before re-authoring) gave the same picture, and its clearer fox still failed ("shell",
"lizard"). On revision 1 the sleeping fox and the shooting star cannot be delivered as asked: a wish for them gets
the authored piece with the private "closest I can make" line, never a refusal.

## Results, kit revision 2 (re-authored fox, shooting star and scallop shell), 2 November 2026

After the three motifs were re-authored (`packages/content/src/forge-ornaments`, revision 1 byte-identical):
9 calls, 0 failed reads, 78 s, 89,587 reported tokens. 59 of 63 entries read, 3 are weak, 1 is unread.

| Motif | Hearth | Tide | Grove |
|---|---|---|---|
| sleeping dragon | reads in all | reads in all | reads in all |
| crescent moon | reads in all | reads in all | reads in all |
| watchful owl | native reads; copper/ceramic weak ("rabbit" once) | reads in all | reads in all |
| sunflower | reads in all | native and ceramic read; copper unread ("sun", "tree") | native and ceramic read; copper weak |
| scallop shell | reads in all | reads in all | reads in all |
| sleeping fox | reads in all | reads in all | reads in all |
| shooting star | reads in all | reads in all | reads in all |

Every motif reads in its native finish in every family. The counts and geometry digests are in
`apps/codex/src/certificates/data.ts`; `binding.test.ts` fails if any certified shape changes without a new run.
Revision 2 ships only when main promotes it (`SEAMS.md` §9); until then new pieces use revision 1 and its grades.
Before/after art sheets: `work/evidence/forge-wish/certificates/kit2-art-{before,after}-*.png`.

Blind sheets (round 1) are in `work/evidence/forge-wish/certificates/`.
