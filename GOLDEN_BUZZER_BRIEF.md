# Golden Buzzer — backend brief (for Lovable)

**One sentence:** Add a boolean `golden_buzzer` field to each track so the game can surface
"Golden Buzzer Winner" songs (gold glow + crown + tag + crowd cheer). The game already ships the
surfacing UI — it is **dormant** until this field starts coming back `true` for chosen tracks.

## Why a backend flag (not a client list)
The owner's decree: **no curated client-side list, no hardcoded song IDs.** Which songs are
"golden buzzer winners" is editorial/promotional data that changes over time — it must live in the
catalog, controlled from the backend, not baked into the game build. The game reads the flag and
renders the treatment; it never decides who wins.

## The field
- **Name:** `golden_buzzer`
- **Type:** boolean
- **Default:** `false`
- **Where:** on the track/song row, returned by **every** track-bearing endpoint the game reads:
  - `GET /tracks` (list — each item)
  - `GET /track/:id` (single)
  - (and any `featured` / `hot` / `new` collections that return track objects)

That's it. When the field is absent or `false`, the game shows the normal card. When it's `true`,
the card lights up gold with a crown + "Golden Buzzer Winner" tag and a one-time crowd cheer plays
on launch.

## Game-side swap-seam (already built)
`catalog.js` reads it tolerantly so the backend can name it a few ways without a game redeploy:
```
goldenBuzzer(t) = !!(t.golden_buzzer || t.goldenBuzzer || t.is_golden_buzzer || t.golden)
```
Prefer **`golden_buzzer`**. If you must use a different name, tell us and we'll add it to the seam.

## Optional (nice-to-have, not required for launch)
- `golden_buzzer_at` (ISO timestamp) — so we can sort a "Golden Buzzer" shelf newest-first.
- `golden_buzzer_by` (string) — the judge/curator name, if you want it in the tag tooltip.

## Acceptance
1. Set `golden_buzzer = true` on 1–2 test tracks in the catalog.
2. Reload the game's song list → those cards show the gold treatment + tag; all others unchanged.
3. Launch a flagged track → crowd cheer plays once; launching a normal track → no cheer.
4. Set it back to `false` → treatment disappears on next load. No client redeploy needed either way.
