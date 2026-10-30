---
name: study-reference
description: Find the best open-source examples for a part of Chatdom (water, sky, voxel meshing and lighting, crowds, netcode, maps, UI motion), take them apart with sub-agents, and write what we take into a reference note that the spec cites. Use before specifying or building any part where someone has already done it beautifully, and whenever Tobias drops a repo link.
---

# Learn from the best

Someone has often already solved the hard part beautifully. Study it before you design ours, so our version
starts at their bar and goes past it. We take techniques, numbers and ideas, never their look: Chatdom has its
own (`chatdom/Artstyle-Soul-Feel.md`).

## 1. Find candidates

Skip this when Tobias gave you the repo.
- Use the built-in web search, the Exa MCP (its code search is good at this), and
  `gh search repos "<topic>" --sort stars --limit 20`.
- Look for: something actually beautiful or clever (open its demo or screenshots), a matching stack (three.js,
  WebGL2, TypeScript), alive in the last year or so, and a license we can use.
- Pick one to three.

## 2. Clone outside the repo

```
git clone --depth 1 https://github.com/<owner>/<repo> /tmp/chatdom-refs/<owner>-<repo>
```

- Never clone inside the repo or a worktree.
- Read; don't run blindly. Running its demo to look at it is often worth it. Install with `--ignore-scripts`,
  serve it on a port in 5170–5199, take shots as in `$look` and view them. Never give it env files or
  credentials.

## 3. Take it apart with sub-agents

Clone first, then fan out the reading, one question per sub-agent with disjoint focus. Sub-agents never run git.
- **A scout on `gpt-6-luna`** maps it: the structure, the entry points, where each technique lives, the license,
  and the size.
- **One or two on `gpt-6.1-terra`** go deep, one technique each. They report the algorithm, the parameters and
  why those values, the shader and performance tricks, the phone fallbacks, the pitfalls, and `file:line`
  pointers into the clone.
- **`gpt-6.1-sol`** goes deep instead when the technique is architecture (netcode, an ECS, a job system).

Then judge it yourself. What fits Chatdom is a taste call, and it is yours.

## 4. Write the note: `work/references/<slug>.md`

```
# Reference: <name>       <url> · <license> · studied at <short sha>
For: <the spec or part of Chatdom>
## What it is              (3–5 lines: what makes it great)
## What we take            (techniques, with file:line in the clone and the numbers that matter)
## What we do differently  (our art style, devices, contracts, and why)
## Leave behind
## License                 (code we may adapt with credit, or ideas only)
```

Then cite it in the spec's **References** section (`$write-spec`): one line per note on what to take.

## Licenses

- **Adapting code is fine, with credit:** MIT, BSD, Apache-2.0, ISC, Zlib, MPL-2.0 (per file), CC0, Unlicense.
  - Put a header comment in the adapted file naming the source and its license.
  - Add a line to `THIRD_PARTY.md`: name, URL, license, and what we adapted where.
- **Ideas only; write our own code:** GPL, AGPL, LGPL, no license, or anything unclear.
- **Assets have their own licenses:** models, textures, sounds, fonts. Check each separately. Never ship NC, ND
  or unclear ones.
