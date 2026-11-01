# WT10 working state — 2026-11-01 17:00

Read PRD and needs.md first. WT10 is the only task and remains unchecked. Do not write LANE COMPLETE.

Branch is lane/walking-together. Main synced cleanly in merge ac12111 (through c39a5f6); no pushes or main writes. Earlier checkpoints: aff3fcb (controls/door recovery), d341507 (worn appearances/gestures/labels), d2ec52a (records). Current source checkpoint is recorded in progress.txt.

Implemented this iteration:
- World-space flat-ground foot contacts, articulated two-bone legs, alternating-foot stop recovery, seated/tiptoe transition contact, shortest-arc heading and matched arm/body phase. Discontinuities and culled/hidden history rebase; no stale footsteps on reentry. CitizenRenderer.footfalls reports latest-update touchdowns. Exact slope contact is still impossible while visible and physical terrain disagree.
- Wardrobe save guard for authority replacement, external saved-look refresh and disposal; newer local drafts survive canonical save completion. Authority reference is person-scoped; display names are not identity keys. Phone save status is visible (new layout not screenshot-verified).
- Full native founded-world CPU fixture and explicit check-town.mjs diagnostic. Three bodies passed forward/reverse/stop, support and clearance across 659 compiled placements. Compile took ~83 s. An initial heavyweight Vitest version exceeded 60 s and was removed in favour of the explicit diagnostic; no timeout was hidden by weakening its checks.
- Prepared capture-town.mjs for one still or real-time clip, three SDK connections, actual Kingdom component, complete native collision and visible SIMULATED provenance. Linted/reviewed, **not run**. Do not describe it as accepted town evidence.
- integration.patch now includes approved appearances, gesture port and gait-driven footstep audio. Apply-check passed against current main-owned walk-scene.ts; never apply it inside this lane.

Main-owned needs are in needs.md: room/watch admit only six starter looks, no authenticated gesture transient, no saved recipe/tool projection, visible smooth terrain differs from collision columns, no deterministic shared neighbour sample for soft push. Town/stream acceptance and real-GPU feel are still outstanding. Do not substitute component evidence for those requirements.

Verification:
- Final focused set: 85 tests passed (citizens, avatar-builder, controller, label clearance, movement), explicit 20 s test timeout. Final full typecheck, scoped ESLint and build passed. Logs are in evidence/checks.
- Earlier aggregate: 172/174 passed. The style-adapter test was made physically coherent (actual root motion and explicit time) and now passes without lowering its grip-motion threshold. The unchanged SDK correction test failed again in the aggregate and isolated run. Its direct predicted-state injection may leak before acknowledgement; do not claim a production reconciler defect without boundary instrumentation. Keep assertion unchanged. Logs are copied into evidence/checks. Same assertion has failed in three observed runs across checkpoints; stop retrying it without a new diagnosis and record blocked:.
- Previous full pnpm test was stopped exit 130 after default-timeout/moment failures; isolated moments later passed 5/5 with a 20 s timeout. No full green pnpm verify claim.

Captures:
- Phone motion session 3271 completed and screenshot was opened with view_image; copied into work/evidence/walking-together/motion/motion@390x844.png. It predates final seat/tiptoe fixes, has no contact shadows and proves component rendering only.
- Phone wardrobe session 17965 and wave clip session 32109 terminated with No free review port; each released its resources. A later read-only probe confirmed every allowed capture port occupied. Do not poll these terminal sessions or blindly restart them. Do not touch existing services or fall back to reserved/ephemeral capture ports.
- Existing selector stills (1440×900, 390×844) and desktop motion still (1440×900) were opened and committed earlier. No watched clip is accepted yet.

Next useful work: inspect new main commits for supplied seams; isolate SDK test injection/ack boundary in main-owned code; when capture capacity changes, run one motion clip and one phone wardrobe still at a time, inspect them, then bind the supplied contracts and demonstrate actual town + stream acceptance. WT10 is not blocked solely on the capture lock.
