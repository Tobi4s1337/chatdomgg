# work/

How Chatdom is being built. `chatdom-main`, the Codex thread that holds the build, writes and keeps these files.

| Path | What |
|---|---|
| `PLAN.md` | The build map: the parts of Chatdom, what is built here and what runs as a lane, the contracts between them, what's done |
| `DECISIONS.md` | Cross-cutting decisions with dates and reasons |
| `specs/<nn>-<slug>.md` | Contracts for separable parts. The Decisions section at the bottom overrides the body |
| `lanes/<lane>/PRD.md` | A lane's task list (Ralph style: one task per iteration, tick, progress line, commit) |
| `lanes/<lane>/progress.txt` | One line per finished task |
| `reviews/` | Adversarial reviews per milestone |
| `references/` | Source studies and the techniques we take into specs |
| `evidence/` | Screenshots and logs worth keeping, per task |

Lanes run in git worktrees on `lane/<name>` branches, each owning one folder scope, and merge into `main` through
`chatdom-main`. See `AGENTS.md` and the `write-spec` / `ralph-lane` skills.
