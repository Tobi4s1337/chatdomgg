---
name: ralph-lane
description: The protocol for a lane worker building Chatdom from work/lanes/<name>/PRD.md in its own worktree, one task at a time (Ralph loop). Use when you are a lane worker, or when asked to work through a lane PRD.
---

# Ralph lane protocol

You are a lane worker in a git worktree on the branch `lane/<name>`. Do exactly one task per iteration (or per goal
turn), end to end.

1. **Sync.** If `main` has new commits, run `git merge --no-edit main`. Resolve conflicts only inside your scope.
   If a conflict sits outside your scope, stop and note it in progress.
2. **Read** `work/lanes/<name>/PRD.md`, `progress.txt`, the lane's spec in full (Decisions first), and the
   vision sections it points to. The spec is the contract; you own the how.
3. **Pick** the first unchecked task (`- [ ]`). Strict order. Never pick from Backlog.
4. **Build it** inside the lane scope only. `packages/shared` is read-only: if you need a contract change,
   write `needs: <what>` in your progress line and do the parts that don't depend on it.
5. **Verify.** Run the PRD's done-check: typecheck, tests, build, and screenshots looked at with `$look`. Fix
   until green.
6. **Record.**
   - Tick the box in the PRD.
   - Append one line to `progress.txt`:
     `<id>: <what you did + decisions + doubts> — <short sha> — <YYYY-MM-DD HH:MM>`
   - Commit on the lane branch: `feat(<name>): <id> <outcome>`, with the decisions in the body.
   - Never push. Never touch `main`.
7. **Stop** after one task. When every box is ticked, write `LANE COMPLETE` as the last progress line.

## Rules

- No placeholders, no stubs that pretend, and no unlabelled fake data. Label simulated data SIMULATED in the UI.
- If the same failure happens three times, stop, write what you learned in the progress line with `blocked:`,
  and end the iteration.
- Ideas you notice go into Backlog as one line each. Don't build them.
- Sub-agents may help with sweeps and assets inside your scope. Name their model, and never let them run git.
