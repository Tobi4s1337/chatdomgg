# Dock decisions

DK10 follows the Decided lists in the PRD's vision files. These implementation choices
do not expand the lane's authority over shared, realm or stream code.

- Royal acts belong to the broadcaster. A verified moderator sees town status and the
  reason the royal controls are disabled. Browser claims never establish the role.
- Named targets are direct buttons, three per group with explicit paging. A stable target
  ID preserves keyboard focus during status refreshes; a dropdown plus a second press is
  unnecessary work in the middle of a stream.
- Here, Growing and Coming use authoritative town labels. Gate and fire have separate
  small facts, so an operator can read them without interpreting a ceremony or a receipt.
- An accepted reply requires a witness bound to the exact action, kingdom and origin.
  The renderer, not the dock, produces that witness after a visible draw. Unknown acts
  remain locked across reload until the operator has checked the stream; no command retry
  is automatic.
- Recovery is scoped to the canonical sign-in resume scope and kingdom, in session
  storage. Changed/ended identities discard prior recovery. Without durable intent storage
  the controls refuse to send, rather than silently losing uncertain-action protection.
- Undo submits the realm receipt, never a client-invented inverse command. The realm
  checks its expiry and last-act eligibility. Optional authoritative undo entries override
  the local receipt; an empty authoritative list forbids undo.
- Fetch status immediately after an act and again after 2.2 seconds, in addition to the
  ordinary ten-second poll. This observes the realm's short cadence without optimistically
  enabling buttons or repeating the act. The follow-up is cancelled on replacement/disposal.
- The component loads the shared font kit itself and scopes its layout against the web
  landing page's global CSS. Standalone OBS dock and same-origin `/dock` use the same
  material, layout and 12px minimum product text.
- UI fixture captures are explicitly SIMULATED and cannot establish stream delivery.
  The separate integration bench must use the real retained writer, API, simulated OIDC,
  public stream and independent draw acknowledgement, in a random owned database schema.
  It may not call the witness endpoint on the renderer's behalf.

DK10 stays unchecked until the required real stream acts have been seen in stills and
watched clips. Prepared scripts and passing nonvisual checks alone do not satisfy it.
