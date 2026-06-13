#!/usr/bin/env python3
# Bridge: read the saved show_generations dump(s) (long path > MAX_PATH, so use the
# \\?\ extended-length prefix) and write a compact _gens.json into the project dir.
import json, os

DIR = (r"\\?\C:\Users\tjean\.claude\projects"
       r"\D--sunoai-music-plan-animev1-veo-3-round-2-can-i-pet-that-dog-cloudcode-v2--claude-worktrees-crazy-knuth-5ea5d3"
       r"\93161f5c-e74e-4188-b067-7ed22a07a2b7\tool-results")
DST = (r"D:\sunoai music plan\animev1\veo 3 round 2\can i pet that dog\cloudcode\v2"
       r"\assets\fx\_src\_gens.json")

names = [n for n in os.listdir(DIR) if "show_generations" in n and n.endswith(".txt")]
clips = []
total = 0
ncs = []
for n in sorted(names):
    d = json.load(open(DIR + "\\" + n, encoding="utf-8"))
    items = d.get("items", [])
    total += len(items)
    ncs.append(d.get("next_cursor"))
    for it in items:
        if it.get("status") != "completed":
            continue
        r = (it.get("results") or {}).get("rawUrl")
        if not r:
            continue
        pr = it.get("params") or {}
        clips.append({
            "id": it.get("id"),
            "prompt": pr.get("prompt", ""),
            "rawUrl": r,
            "dur": pr.get("duration"),
            "ar": pr.get("aspect_ratio"),
        })
seen = set(); uniq = []
for c in clips:
    if c["id"] in seen:
        continue
    seen.add(c["id"]); uniq.append(c)

json.dump({"files": len(names), "total_items": total, "next_cursors": ncs,
           "clips": uniq}, open(DST, "w", encoding="utf-8"), indent=1)
print("files:", len(names), "total_items:", total,
      "completed_with_url:", len(uniq), "next_cursors:", ncs)
