# The forge remembers

`GET /api/realm/forge/ledger?kingdomId=<id>` lists every piece a kingdom's forge has made, newest first: the piece
(its plan, family and kit revision), its title and plaque, the maker's name and when it was forged. The contract is
`packages/shared/src/forge-ledger.ts`.

- `projection.ts` builds the view from the realm's private state, field by field. Only `state.attachments` is read:
  it holds exactly the pieces whose `forge.commitApproved` fact committed, so a refused, held, cold or waiting wish
  can never appear. The private record's words, approval receipt, owner and home never leave the function.
  Superseded pieces (another piece took their socket later) stay remembered.
- The maker's name is the approved name on their home today, the one the citizen card shows; if they no longer
  hold a home here, the name the piece was forged under.
- `http.ts` serves it publicly with no session. An open kingdom is read directly; a resting one is held through the
  same retained registry the founded reader uses, only for the read. One kingdom is answered from memory for
  `FORGE_LEDGER_LIMITS.cacheMs`; a passing failure (503) is not remembered.

Readers: the wall at the forge and the Esc ledger page (`apps/web/src/forge/ledger/`), and the Twitch panel
(panel-window). The seam is in `work/lanes/forge-wish/SEAMS.md`, section FW12.
