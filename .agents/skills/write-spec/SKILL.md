---
name: write-spec
description: Write a spec plus a Ralph lane PRD so another worker (a Codex thread or another agent) can build a separable part of Chatdom in its own worktree. Use when the main thread hands off a lane (Atlas, panel, Twitch ingest, content, studio, games).
---

# Hand off a lane

A lane is a separable part of Chatdom that one worker builds in a git worktree on the branch `lane/<name>`,
owning one folder scope. The worker starts cold: it knows only `AGENTS.md`, the vision docs and what you write
here. Write for a strong engineer who has never seen this thread.

## 1. The spec: `work/specs/<nn>-<slug>.md`

If great open source exists for this part, run `$study-reference` before you freeze the spec.

```
# Spec <nn>: <title>        status: frozen <date>
Vision: <chatdom/... sections this serves>

## What and why          (5–10 lines. The experience, not the implementation.)
## Current state         (what exists: file:line, contracts in packages/shared it must use)
## Rules                 (numbered, testable: R1, R2, …)
## Contracts             (types and messages it consumes or produces, pointing at packages/shared)
## Scope                 (folders it may write; everything else is read-only. Never packages/shared.)
## Acceptance            (exact commands and expected results; the screenshots to take, at which sizes)
## Quality bar           (what makes this real rather than a demo; art-direction references)
## References            (work/references/<slug>.md notes: one line each on what to take; see $study-reference)
## Not now               (explicit non-goals)
## Decisions             (dated. This section overrides everything above it.)
```

## 2. The lane PRD: `work/lanes/<name>/PRD.md`

```
# Lane <name>
Spec: work/specs/<nn>-<slug>.md · Branch: lane/<name> · Scope: <globs> · Worker: <codex sol|terra / other>
Every task is done when: <typecheck/test/build command> is green, the screenshots are taken and looked at,
the box is ticked, one line is added to progress.txt, and one commit is on the lane branch.

## Tasks
- [ ] **<L>01 — <outcome in plain words>** · evidence: shot|test|log
- [ ] **<L>02 — …**

## Backlog            (ideas found while working. The worker adds lines here and never picks from it.)
```

Also create an empty `work/lanes/<name>/progress.txt`.

## Sizing

- One task is one coherent, verifiable step of 20–60 minutes of agent work. Write 3–15 tasks per lane, in an
  order that keeps something runnable and visible early. A small lane for one batch of content or one surface
  is fine; prefer more, smaller lanes with disjoint scopes over one big one.
- Hand off early: write a lane's spec in the same turn its contracts freeze.
- Keep generated art (`image_gen`) out of code lanes. Make it in an art lane or in the main thread, and list in
  the spec what art the lane uses and where it lands, so any worker can run the lane.
- Put the first visible result in task 1 or 2, so we can look at it quickly.
- Contracts the lane needs must exist in `packages/shared` **before** the lane starts. Write them yourself, in
  this thread.

## 3. Create the worktree

```
git branch lane/<name> main
git worktree add ../worktrees/<name> lane/<name>
```

Commit the spec and PRD on `main` first, so the branch has them. Then say in your evidence block that lane
`<name>` is ready. The team starts the worker.
