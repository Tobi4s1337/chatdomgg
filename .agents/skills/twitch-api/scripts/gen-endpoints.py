#!/usr/bin/env python3
"""Generate references/endpoints.md from references/official/api_reference.md.

Run after twitch-dev/scripts/refresh-docs.sh:
    python3 -I scripts/gen-endpoints.py            (from the skill dir, or anywhere)

Parses every `## <Endpoint>  {#anchor}` section of the official Twitch API reference
(markdown snapshot) and emits one table row per endpoint, grouped by category, with:
method + path, token type, scopes, status (NEW/BETA), paging (`first` max), extra
per-endpoint rate limits, and the one-line purpose from the reference's summary table.
Standard library only. Exits non-zero if the section count and the summary table disagree.
"""
import re
import sys
from collections import OrderedDict
from pathlib import Path

SKILL = Path(__file__).resolve().parent.parent
SRC = SKILL / "references" / "official" / "api_reference.md"
OUT = SKILL / "references" / "endpoints.md"

text = SRC.read_text(encoding="utf-8")
lines = text.splitlines()

# --- 1. summary table: name -> (category, status, purpose) -------------------
summary = OrderedDict()
in_tbl = False
for ln in lines:
    if ln.startswith("| Resource | Endpoint |"):
        in_tbl = True
        continue
    if in_tbl:
        if not ln.startswith("|"):
            break
        cells = [c.strip() for c in ln.strip().strip("|").split("|")]
        if len(cells) < 3 or set(cells[0]) <= {"-"}:
            continue
        cat, name, desc = cells[0], cells[1], " | ".join(cells[2:])
        status = ""
        m = re.match(r"^(NEW|BETA|DEPRECATED)\s+(.*)$", desc)
        if m:
            status, desc = m.group(1), m.group(2)
        desc = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", desc)  # strip md links
        summary[name] = (cat, status, desc)

# --- 2. sections ----------------------------------------------------------------
H2 = re.compile(r"^## (.+?)\s+\{#([^}]+)\}\s*$")
sections = []  # (name, anchor, body_lines)
cur = None
for ln in lines:
    m = H2.match(ln)
    if m:
        cur = (m.group(1).strip(), m.group(2), [])
        sections.append(cur)
    elif cur is not None:
        cur[2].append(ln)


def subsection(body, title_re):
    """Return lines of the first ### subsection whose title matches title_re."""
    out, on = [], False
    for ln in body:
        if ln.startswith("### "):
            if on:
                break
            on = re.search(title_re, ln[4:], re.I) is not None
            continue
        if on:
            out.append(ln)
    return out


SCOPE = re.compile(r"(?:\*\*|`)([a-z_]+(?::[a-z_]+)+)(?:\*\*|`)")
BOT_SCOPES = {"user:bot", "channel:bot"}


def classify_auth(name, auth):
    low = auth.lower()
    scopes = []
    for s in SCOPE.findall(auth):
        if s not in scopes:
            scopes.append(s)
    main = [s for s in scopes if s not in BOT_SCOPES]
    bots = [s for s in scopes if s in BOT_SCOPES]
    note = ""
    if "json web token" in low:
        tok = "Extension JWT"
    elif "eventsub" in name.lower():
        tok = "app (webhook/conduit) or user (WebSocket)"
    elif "headers are not required" in low:
        tok = "none"
    else:
        has_app = "app access token" in low
        has_user = ("user access token" in low or "user-access token" in low
                    or "oauth scope" in low)
        prior = "prior authorization" in low
        if prior and has_user:
            tok = "user or app†"
        elif has_app and has_user:
            tok = "app or user"
        elif has_app:
            tok = "app"
        elif has_user:
            tok = "user"
        else:
            tok = "?"
        if "extensions may use an app access token" in low:
            tok = "user"  # app token only for extensions the broadcaster granted the scope
            note = "an extension may use an app token if the broadcaster granted the scope"
    sc = " or ".join(main) if main else "—"
    if tok.startswith("app (webhook"):
        sc = "per subscription type (see twitch-eventsub skill)" if name.startswith("Create") else "—"
    if bots:
        sc += " (app† also needs " + " + ".join(bots) + ")"
    return tok, sc, note


rows = OrderedDict()
problems = []
for name, anchor, body in sections:
    auth = "\n".join(subsection(body, r"^Authorization"))
    url_lines = [l for l in subsection(body, r"^URL") if l.strip()]
    m = re.search(r"`([A-Z]+) https?://[^/]+(/[^`\s]*)`", " ".join(url_lines))
    if not m:
        problems.append(f"no URL for {name}")
        method, path = "?", "?"
    else:
        method, path = m.group(1), m.group(2)
    tok, sc, note = classify_auth(name, auth)
    # paging: `first` row in the query-params table
    q = "\n".join(subsection(body, r"^Request Query Param"))
    paging = ""
    fm = re.search(r"^\| first \|[^\n]*", q, re.M)
    if fm:
        mx = re.search(r"maximum (?:is|value of) ([\d,]+)", fm.group(0))
        paging = f"first≤{mx.group(1).replace(',', '')}" if mx else "first"
    elif re.search(r"^\| after \|", q, re.M):
        paging = "after"
    if re.search(r"^\| before \|", q, re.M):
        paging += (", " if paging else "") + "before"
    # extra per-endpoint rate limits
    rl = ""
    whole = "\n".join(body)
    rm = re.search(r"\*\*Rate Limits?\*\*:?\s*(.+)", whole)
    if rm:
        rl = re.split(r"(?<=\.)\s", rm.group(1).strip())[0]
        rl = re.sub(r"\*\*", "", rl)
        # a limits table right after the sentence (e.g. Check AutoMod Status)
        after = whole[rm.end():].lstrip("\n").splitlines()
        tbl = []
        for ln in after[:8]:
            if not ln.startswith("|"):
                if tbl:
                    break
                continue
            c = [x.strip() for x in ln.strip("|").split("|")]
            if c and not set(c[0]) <= {"-"} and c[0] not in ("Account type",):
                tbl.append(f"{c[0]} {'/'.join(c[1:])}")
        if tbl:
            rl += " (per min/per hour: " + ", ".join(tbl) + ")"
    cat, status, purpose = summary.get(name, ("?", "", ""))
    if name not in summary:
        problems.append(f"{name} missing from summary table")
    if "BETA" in "\n".join(body[:8]) and not status:
        status = "BETA"
    notes = "; ".join(x for x in (note, rl) if x)
    rows.setdefault(cat, []).append(
        dict(name=name, anchor=anchor, method=method, path=path, tok=tok, sc=sc,
             status=status, paging=paging, notes=notes, purpose=purpose))

missing = [n for n in summary if n not in {s[0] for s in sections}]
problems += [f"{n} in summary table but no section" for n in missing]

total = sum(len(v) for v in rows.values())


def esc(s):
    return s.replace("|", "\\|")


out = []
out.append("# Twitch Helix endpoint index (generated)\n")
out.append(f"<!-- GENERATED by scripts/gen-endpoints.py from references/official/api_reference.md. "
           f"Do not hand-edit; re-run the script. -->\n")
out.append(f"**{total} endpoints** in {len(rows)} categories. Base URL `https://api.twitch.tv` "
           "(all paths start with `/helix`, except where shown).\n")
out.append("Full details for any row: `node scripts/endpoint.ts \"<name>\"` or "
           "`grep -n \"^## <Name>  \" references/official/api_reference.md` (heading = Name column).\n")
out.append("""## Legend

- **Token** — `user`: user access token only. `app`: app access token only. `app or user`: either
  (scopes, if listed, apply to the user token). `user or app†`: user token, **or** an app access token
  where the user named by the request's `broadcaster_id`/`moderator_id`/`user_id`/`sender_id` previously
  authorized your client ID with those scopes (the 2026 app-token expansion: open beta 2026-02-27, GA
  2026-05-29). `Extension JWT`: EBS-signed JWT with `role: external` (see the twitch-extensions skill).
  `none`: no Client-Id/Authorization needed.
- **Scopes** — `a or b` = any one of them is enough. `(app† also needs user:bot + channel:bot)` = extra
  scopes only for the app-token path (bot-style chat actions). `—` = no scope.
- **Status** — as marked in the official reference (`NEW`, `BETA`); blank = GA.
- **Paging** — `first≤N`: supports cursor pagination with max page size N (default usually 20);
  `before` = also supports backward paging. Blank = not paginated.
- **Notes** — endpoint-specific limits on top of the global token-bucket rate limit.
""")
out.append("## Categories\n")
out.append(" · ".join(f"[{c}](#{re.sub(r'[^a-z0-9 -]', '', c.lower()).replace(' ', '-')}) ({len(v)})"
                      for c, v in rows.items()) + "\n")
for cat, items in rows.items():
    out.append(f"## {cat}\n")
    out.append("| Endpoint (heading) | Method & path | Token | Scopes | Status | Paging | Notes | Purpose |")
    out.append("|---|---|---|---|---|---|---|---|")
    for r in items:
        out.append("| " + " | ".join([
            f"{esc(r['name'])} `#{r['anchor']}`",
            f"`{r['method']} {r['path']}`",
            r["tok"], esc(r["sc"]), r["status"], r["paging"], esc(r["notes"]), esc(r["purpose"]),
        ]) + " |")
    out.append("")

OUT.write_text("\n".join(out) + "\n", encoding="utf-8")
print(f"wrote {OUT} — {total} endpoints, {len(rows)} categories, "
      f"summary table rows: {len(summary)}")
for p in problems:
    print("WARN:", p, file=sys.stderr)
sys.exit(1 if problems or total != len(summary) else 0)
