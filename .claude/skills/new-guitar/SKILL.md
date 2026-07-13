---
name: new-guitar
description: Build a Reactive Rhythm guitar skin end-to-end — i2i art from the canonical template → cutout → pixel-measured string geometry (SKIN_GEOM verified) → store/loadout/showroom wiring. Use when the owner asks for a new guitar skin or a skin fix.
---

# /new-guitar — the Reactive Rhythm guitar-skin pipeline (v1 · 2026-07-12)

You are building a PLAY SURFACE, not just art: the lanes, catchers, and notes ride the painted strings.
Work in the MAIN repo dir (`D:/sunoai music plan/animev1/veo 3 round 2/can i pet that dog/cloudcode/v2`).

## The one law that rules everything
**A skin may only drive the play surface if `SKIN_GEOM[src].verified === true`** (game.js ~1032, build26
STANDARDIZATION DECREE). Verified means: exactly-5 measured strings, receding-neck template framing
(aspect ≈ 0.5625, e.g. 1080×1920), comfortable bridge fan (span ≈ 0.28-0.30), and the measurement script
found **≥8 clean exactly-5 rows**. Unverified skins are REJECTED at `_applySkinImg` and fall back to the
canonical crimson surface — so a bad skin can never detach catchers from strings again. Lanes are
profile-INVARIANT (5-lane gh decree); the geometry only tells the fitter where the painted strings live.

## Stage 1 — ART (i2i from the canonical template; owner generates)
- Source template: **`assets/guitars/crimson-chaos-ryo.png`** — every successful skin is an i2i restyle of
  it (body/theme changes, STRINGS KEPT CLEAN AND STRAIGHT, receding-neck perspective preserved).
- Write the owner ONE message with exact filename (`assets/guitars/<id>.png`), tool (**gpt_image_2**), and
  the full i2i prompt. Prompt musts: "5-string bass guitar", strings unobstructed nut→bridge (no hands,
  straps, fog, or decorations crossing them), high string-to-background contrast on the neck, same framing
  as the source, portrait 1080×1920.
- Reject art where decoration crosses the strings — it breaks measurement. Ask for a regen, don't force it.

## Stage 2 — CUTOUT + MEASURE (you do this)
1. PIL cutout if the render has background (transparent PNG).
2. Run the measurement pipeline: `assets/guitars/_measure_adaptive.py` (fallbacks `_measure_strings.py` /
   `_calibrate.py`). Method: contrast peaks across 16-26 neck rows → least-squares line per string →
   evaluated at nutFY/bridgeFY. PASS = **≥8 clean exactly-5 rows** (great skins hit 50-110).
3. Generate the Read-tool OVERLAY proof image (the script renders measured lines over the art) and LOOK
   at it: lines must ride the painted strings nut→bridge. 6-string art is acceptable (resampler subsets
   the most centered 5) but prefer true 5-string renders.
4. If measurement fails: the art is wrong, not the tolerance — regenerate (the old flat bass photos were
   0-5 clean rows, unfixable). Never hand-tune XF numbers to force a pass.

## Stage 3 — GEOMETRY ENTRY (game.js `SKIN_GEOM`)
Add: `'assets/guitars/<id>.png': { verified: true, aspect: W/H, nutFY, bridgeFY, nutXF:[5], bridgeXF:[5] }`
with the measured values + a comment recording clean-row count. Catcher-alignment history: when "buttons
aren't on strings", it's the BRIDGE row (bridgeXF) drifting while the nut is fine — re-measure bridgeFY.

## Stage 4 — WIRING (all in index.html unless noted)
- **Loadout**: add to the profile SKINS list (id, title, src, thumb) — thumbnail can be a card crop
  (`assets/guitars/<id>-card.jpg`).
- **Store** (paid skins): STORE_FALLBACK item (`item_type:'skin'`, `item_id:'<id_underscored>'`, price),
  `SKIN_GUITAR['<id>'] = 'assets/guitars/<id>.png'`, `STORE_ART['<id>'] = <card jpg>`. Entitlement ids use
  UNDERSCORES; slug-normalization exists but don't rely on it. Bonus-Sparks price = real price × BONUS_RATE
  (skins only). Showroom hero uses the full PNG — verify it looks right in `openStoreHero`.
- **Free/community skins**: FREE_ITEMS map in catalog.js (e.g. celines_razor grammar).
- **Level pairing**: if the skin ships with a level, set the level's `guitarSkin` field + SKIN_LEVEL_BG
  entry (profile trophy-case background pairing).

## Stage 5 — VERIFY
1. `node --check game.js` · score ceiling still 17 (you didn't touch scoring, but check anyway).
2. Headless (`rr-verify`, main dir): equip via `RhythmGame.equipGuitarSkin(src)` → launch a track →
   capture the play surface (canvas toDataURL) → **Read the image**: catchers ON strings at nut AND
   bridge, notes travel the string fan, no floating buttons.
3. `RhythmGame.isSkinPlayable(src)` returns true; store tile renders; equip/unequip round-trips;
   two-click confirm intact on locked tiles.
4. Ship per the standard flow: `?v` bump (python), CHANGELOG, commit `visual-overhaul`, push, Lovable
   sync message; the owner publishes.

## Quality bar reminders
- Brand: black · crimson · chrome + warm golds; per-skin theme colors allowed (the no-green rule is UI
  chrome only — GH-green fret gems are an intentional exception).
- Every skin needs its CARD art (store/loadout) — a cropped hero of the actual verified play surface
  (the old mismatched hero renders were a user-reported bug).
- Skins are also identity: check the trophy-case showcase (profile) with the skin equipped.
