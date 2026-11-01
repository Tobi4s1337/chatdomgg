# DK10 visual review

## First production UI captures — 2026-11-01

Viewed with `view_image` by the lane root and reviewed by Terra high agents:

- `work/evidence/dock/ready-390x844-viewport.png`: wood frame and parchment facts read
  clearly, named actions and brass keyboard focus fit, and no horizontal clipping is
  visible. All primary action groups are visible; undo continues below the fold normally.
- `work/evidence/dock/ready-318x900-full.png`: full page at narrow OBS dock width,1021px
  content height. Crown/Knight names wrap to two lines in their split row, with readable
  labels and generous targets. No horizontal clipping; sign-out and sound are reachable.
- `work/evidence/dock/ready-1440x900-viewport.png`: the page centers a readable narrow
  panel on wood. Status and all primary controls fit; the footer continues below the fold.

The ready harness asserts no browser/console errors, no horizontal overflow and stable
keyboard focus through an authoritative poll. These are freshly built production assets
served over an owned Unix socket. The development HMR harness failed before taking a
shot; it was replaced rather than filtering its errors.

All captures visibly say SIMULATED and show fixture status. They establish UI presentation
and interaction checks only. They do not establish actual Twitch sign-in, moderator grants,
realm commits, stream effects, accepted receipts, undo or watched action clips. The actual
integrated web route and every required real-service act still need their own evidence.

Visual doubts: the small dock is dense at318px and requires vertical scrolling to reach
undo. This is acceptable for the current target list, but real long public names and the
long dusk-moment title must be checked in the integrated scene capture. Fire gathering,
incoming banners/guests and directed undo are still main-owned stream fidelity needs.
