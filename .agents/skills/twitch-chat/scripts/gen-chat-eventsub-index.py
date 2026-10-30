#!/usr/bin/env python3
"""Generate the chat-related EventSub index table (type, version, condition, authorization)
straight from the official docs, so nothing is skipped or invented.

Usage:
  python3 -I gen-chat-eventsub-index.py                 # fetches dev.twitch.tv live (needs curl-able network)
  python3 -I gen-chat-eventsub-index.py <html-dir>      # uses eventsub_eventsub-subscription-types.html +
                                                        # eventsub_eventsub-reference.html from a local dir
Prints Markdown to stdout. Paste/replace the generated block in references/eventsub-chat.md.
Needs: python3 + beautifulsoup4 (same as twitch-dev/scripts/refresh-docs.sh).
"""
import re, sys, urllib.request
from bs4 import BeautifulSoup

# Which subscription types count as "chat-related" for this skill. Matched as prefixes.
CHAT_PREFIXES = (
    "channel.chat.", "channel.chat_settings.", "channel.shared_chat.", "channel.suspicious_user.",
    "channel.warning.", "automod.", "user.whisper.", "channel.moderate", "channel.ban", "channel.unban",
    "channel.moderator.", "channel.vip.", "channel.shield_mode.", "channel.shoutout.",
)

def load(name: str, src: str | None) -> BeautifulSoup:
    if src:
        html = open(f"{src}/eventsub_{name}.html", encoding="utf-8").read()
    else:
        url = f"https://dev.twitch.tv/docs/eventsub/{name}/"
        html = urllib.request.urlopen(url, timeout=60).read().decode("utf-8")
    return BeautifulSoup(html, "html.parser")

def text(el) -> str:
    return re.sub(r"\s+", " ", el.get_text(" ", strip=True)).strip()

def main() -> None:
    src = sys.argv[1] if len(sys.argv) > 1 else None
    types = load("eventsub-subscription-types", src)
    ref = load("eventsub-reference", src)

    # 1) Overview table at the top: Subscription Type | Name | Version | Description
    overview = types.find("table")
    rows = []
    for tr in overview.find_all("tr")[1:]:
        tds = tr.find_all("td")
        if len(tds) < 4:
            continue
        a = tds[0].find("a")
        anchor = a["href"].split("#")[-1] if a and a.has_attr("href") else ""
        name = text(tds[1]); version = text(tds[2]); desc = text(tds[3])
        if name.startswith(CHAT_PREFIXES):
            rows.append((name, version, desc, anchor, text(tds[0])))

    print("| Type | Ver | Condition fields | Authorization (verbatim from docs) |")
    print("|---|---|---|---|")
    for name, version, desc, anchor, label in rows:
        auth, cond = "?", "?"
        h = types.find(id=anchor) if anchor else None
        if h is not None:
            # Walk siblings until the next subscription-type heading.
            for sib in h.find_next_siblings():
                if sib.name == "h3" and sib.get("id", "").startswith("authorization"):
                    p = sib.find_next_sibling()
                    parts = []
                    while p is not None and p.name in ("p", "ul", "ol"):
                        parts.append(text(p)); p = p.find_next_sibling()
                    auth = " ".join(parts)
                if sib.name == "table" and "condition" in text(sib):
                    link = sib.find("a", href=re.compile(r"condition"))
                    if link:
                        cid = link["href"].split("#")[-1]
                        ch = ref.find(id=cid)
                        if ch is not None:
                            ct = ch.find_next("table")
                            fields = []
                            for tr in ct.find_all("tr")[1:]:
                                tds = tr.find_all("td")
                                if len(tds) >= 3:
                                    req = text(tds[2]).lower()
                                    fields.append(f"`{text(tds[0])}`" + ("" if req.startswith("y") else " (opt)"))
                            cond = ", ".join(fields)
                    else:
                        # Inline condition: indented rows following the `condition` row.
                        fields, inside = [], False
                        for tr in sib.find_all("tr")[1:]:
                            tds = tr.find_all("td")
                            if len(tds) < 3:
                                continue
                            raw = tds[0].decode_contents()
                            indented = raw[:1] in (" ", "\u00a0")
                            nm = text(tds[0])
                            if nm == "condition":
                                inside = True; continue
                            if inside and indented:
                                req = text(tds[2]).lower()
                                fields.append(f"`{nm}`" + ("" if req.startswith("y") else " (opt)"))
                            elif inside:
                                break
                        cond = ", ".join(fields) or "?"
                    break
                if sib.name == "h3" and sib.get("id") and not sib["id"].startswith(("authorization",)) \
                        and "request-body" not in sib["id"] and sib is not h and text(sib).count(".") >= 1 \
                        and " " not in text(sib):
                    break  # reached next type without finding a condition table
        beta = " **BETA**" if "beta" in version.lower() else ""
        print(f"| `{name}` | {version}{beta} | {cond} | {auth.replace('|', '/')} |")

if __name__ == "__main__":
    main()
