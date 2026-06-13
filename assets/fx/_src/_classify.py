#!/usr/bin/env python3
# Re-read the saved show_generations dump (long path) WITH extra fields, classify
# each clip, and print buckets. Writes _gens.json (full, with bucket) for later use.
import json, os, re

DIR = (r"\\?\C:\Users\tjean\.claude\projects"
       r"\D--sunoai-music-plan-animev1-veo-3-round-2-can-i-pet-that-dog-cloudcode-v2--claude-worktrees-crazy-knuth-5ea5d3"
       r"\93161f5c-e74e-4188-b067-7ed22a07a2b7\tool-results")
DST = (r"D:\sunoai music plan\animev1\veo 3 round 2\can i pet that dog\cloudcode\v2"
       r"\assets\fx\_src\_gens.json")

names = sorted(n for n in os.listdir(DIR) if "show_generations" in n and n.endswith(".txt"))
raw = []
for n in names:
    d = json.load(open(DIR + "\\" + n, encoding="utf-8"))
    for it in d.get("items", []):
        if it.get("status") != "completed":
            continue
        r = (it.get("results") or {}).get("rawUrl")
        if not r:
            continue
        pr = it.get("params") or {}
        raw.append({"id": it.get("id"), "prompt": pr.get("prompt", "") or "",
                    "rawUrl": r, "dur": pr.get("duration"), "ar": pr.get("aspect_ratio"),
                    "model": it.get("model"), "nmedia": len(pr.get("medias") or [])})
# de-dupe by id
seen = set(); clips = []
for c in raw:
    if c["id"] in seen: continue
    seen.add(c["id"]); clips.append(c)

OTHER = ["12-second","commercial","storyboard","reference:","hyper-realistic","kodak",
         "anamorphic","white house","walmart","minivan","grocery","bioprinter","black bear",
         "first-person pov","@wittlething","product demo","essential","karen","decadent",
         "volumetric","<<<","extend from","extend video"]
BG = ["background","game-menu","menu background","night sky","graveyard","arena","cathedral",
      "vinyl record","red moon","drifting clouds","hero intro","spotlight","fox"]

def bucket(c):
    p = c["prompt"].lower().strip()
    if not p:
        return "EMPTY"
    if any(k in p for k in OTHER):
        return "OTHER"
    if any(k in p for k in BG):
        return "BG"
    return "FX"

for c in clips:
    c["bucket"] = bucket(c)

from collections import Counter
cnt = Counter(c["bucket"] for c in clips)
print("BUCKETS:", dict(cnt), "of", len(clips), "clips")
for b in ("FX","BG","EMPTY"):
    print("\n==== %s ====" % b)
    for c in clips:
        if c["bucket"] == b:
            print("%s d%s n%s %-13s | %s" % (
                c["id"][:8], c["dur"], c["nmedia"], c["model"] or "?",
                " ".join(c["prompt"].split())[:84]))

json.dump({"clips": clips}, open(DST, "w", encoding="utf-8"), indent=1)
print("\nwrote", len(clips), "clips to _gens.json")
