# WT10 working state

Read PRD and needs.md first. WT10 is the only task, still unchecked; do not write LANE COMPLETE yet.

Checkpoints: aff3fcb (controls and door-recovery fix), d341507 (worn appearance bridge, gestures/turning, optional controller seam, label clearance, component benches). No pushes or main writes. Scope remains the PRD's paths.

Main-owned integration needs are real: only six starter appearance IDs are allowed in room/watch; no gesture transient; no saved builder recipe binding; no persisted tool slot; visible smooth terrain differs from half-metre collision columns; no neighbour input to the shared movement step. The exact optional walk-scene consumer patch is integration.patch (apply-check passed); never apply it inside this lane.

Remaining lane work includes genuine foot planting (current distance-driven sine is not enough), reviewing all gesture poses/motion, phone/body/wardrobe visual checks, then end-to-end town evidence once seams are provided. Do not substitute a bench for town acceptance. The three-citizen motion bench is explicitly SIMULATED and has no contact shadows; it proves only component rendering/compilation.

Tool sessions still running when this note was written (do not duplicate):
- 3271: phone motion capture, queueing on shared lock, output shots/walking-together/motion@390x844.png (process started before capture runner tag rename).
- 17965: phone wardrobe capture, output shots/walking-together/wardrobe@390x844.png.
- 32109: 3 s wave review clip, output shots/walking-together/motion-wave-clip@1440x900.mp4 and frame PNGs. Review extracted frames/motion before making any claim about it.
The isolated moments test (36592) finished: all 5 passed with a 20 s test timeout, including the two sky assertions. Its first case took 5.4 s, beyond the default timeout. Log: /tmp/walking-together-moments.log. No outside-scope fixes were made.

The earlier desktop motion capture (85809) completed, shader compiled, was opened with view_image, and is copied into work/evidence/walking-together/motion. Control screenshots at both standard web sizes were also opened with view_image and committed. Each capture closes its browser and server and releases its lock after one still or clip. Never end up treating queue wait as a lane blocker.

Final typecheck, lint, build, scoped test sets and patch checks passed; full pnpm test was stopped with exit 130 after known red moment/light-field cases, not claimed green. See evidence README. No full-suite retry is needed until the isolated failure diagnosis yields new information.
