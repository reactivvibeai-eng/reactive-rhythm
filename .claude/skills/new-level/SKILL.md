---
name: new-level
description: Build a Reactive Rhythm campaign level to the evolved final standard — concept → 1080p video journey → chart/mechanics → wiring → capture-verified ship. Use when the owner asks for a new level, boss level, or level rework.
---

# /new-level — the Reactive Rhythm level pipeline (evolved standard, v1 · 2026-07-12)

You are the senior level designer for Reactive Rhythm. This skill encodes everything learned shipping
Alarm Clock Hero, Sasoka, High Seas Showdown, Deadkin's Carnival, Triemrys, and the Tier-I RIFTFIELD
rework. Work in the MAIN repo dir (`D:/sunoai music plan/animev1/veo 3 round 2/can i pet that dog/cloudcode/v2`
— session worktrees are stale). Read `VFX_RIFTFIELD_v1.md` + the memory index before designing.

## The design philosophy (non-negotiable)
DOPAMINE + VERTIGO + JUICE. Match-then-exceed Guitar Hero. Every level is a JOURNEY the player's combo
*earns*: quiet base state → combo advances the world → the destination is a spectacle. Self-critique each
concept: "would a bored teenager screenshot this?" Brand: black · crimson · chrome · warm golds — NO
purple/blue drift outside a deliberate theme exception (violet=gothic theme exists).

## Stage 0 — CONCEPT (with the owner, always)
One-page pitch before any asset: title, character/world, the 4-5 stop story arc (each stop = one sentence),
the destination payoff, tier (easy/medium/hard), free vs paid, matching guitar skin (pair levels+skins as
bundles). The owner green-lights concepts; never generate assets for an unapproved concept.

## Stage 1 — ASSET PLAN + PROMPTS (owner generates; you write EXACT prompts)
The owner generates all art from your prompts (asset-handoff-workflow). Deliver a single message with, per
file: exact FILENAME, target folder, tool, and the full prompt. Standards:
- Stills: **gpt_image_2 ONLY** (owner rejects nano_banana). Instruments are 5-string bass guitars.
- Video: **Seedance, 1080p** for showcase/front-runner levels (720p reads soft; ~1.5-2× cost — preflight
  the count with the owner). Watch Seedance NSFW false-positives on horror content — soften gore words.
- The journey needs, for N stops: `<id>-stopK.jpg` (anchor still) + `<id>-stopK-loop.mp4` (ambient loop)
  + `<id>-travel-K-K+1.mp4` (transition) + optional destination cutaway + 1-2 `intense` cutaways +
  `<id>-cover.jpg` (card key art) + optional wordmark PNG.
- **MATCHED-FRAME LAW**: every travel clip must START on the previous loop's look and END on the next
  stop's look (generate travels FROM the anchor stills, i2v). Loops must be seamless (frame A == frame B);
  the base loop must read as *almost still* — ambient life only. Combo cutaways are the ONLY drama.
- Camera grammar: POV horror-cam / cinematic push-ins beat static wides. Generate anchor stills FIRST,
  get owner approval on the set, THEN write the video prompts from the approved stills.

## Stage 2 — LEVEL DEFINITION (index.html, `AUTHORED` array ~line 9105)
The schema comment above the array is the living source of truth. Real fields:
`{ id, tier:'easy|medium|hard', title, song:{trackId:'<uuid>'}, theme:'crimson|ember|gold|chrome|violet|bone',
cover, bgArt, bgVideo, intenseVideos:[...], guitarSkin:'assets/guitars/x.png', reactiveCards:{hit,miss},
mechanic:{type,...}, journey:[{bgArt,loop,travelIn?},...], procBg:'dawn|weave|ember', mods:{speed},
boss:true?, unlock:{stars:N, entitlement:{item_type,item_id}} }`
- Pin a REAL catalog track by trackId (verify it decodes: `audio_url` mp3/m4a, never HLS-only).
- Journey stops advance on combo floors via the journey engine (`_journeyAdvance` ~index.html:10002) —
  the combo TRAVELS FORWARD and never reverts; a failed travel decode hard-cuts to the stop's loop.
- Add the id to `RR_FINISHED_LEVELS` when shipping (unfinished ids render as COMING SOON).
- Launch path: campaign grid → `launchLevel` → `RhythmCatalog.launchTrack(track, {keepEnvironment:true})`.
  NEVER clearEnvironment on level launch (env-picker bug class).

## Stage 3 — PER-LEVEL FEEL (what makes it *this* level)
- **VFX kit**: per-level hit-particle KIT (game.js `_hitTheme` / VFX-2.0 kits — shaped bursts, fake-3D z,
  combo-scaled, rainbow ≥100 combo/OD). Give every level its own palette + shape.
- **procBg**: if the level has no video journey, give it a RIFTFIELD-backed procedural backdrop
  (`procBg` field; themes/knobs in procbg.js `_RF_THEMES` — see VFX_RIFTFIELD_v1.md).
- **Mechanics** (optional, `mechanic:{type}`): existing rigs — 'skull' (jaw chatters on hits). New
  mechanic types are welcome — build the rig in game.js, keep it render-only vs scoring.
- **reactiveCards**: hit/miss fate-pair art (tombstone cracks / chalice fills grammar).
- **Audio**: song from catalog; SFX layer already global (Suno pack per RR_AUDIO_DIRECTION.md).

## Stage 4 — CHART & DIFFICULTY (the scoring LAWS — break these and leaderboards die)
- **SCORE CEILING LAW**: exactly **17 `score +=` sites** in game.js and `CHART_VERSION` gates history.
  After ANY chart/scoring edit: `grep -c "score +=" game.js` must equal 17; bump CHART_VERSION only with
  the owner's sign-off (it re-segments leaderboard eras).
- **STAR-PLACEMENT TRAP**: never regroup star notes — placeStars converts accents→stars and stars forfeit
  accent PERFECT pay; moving stars moves the ceiling.
- **BOMB CEILING TRAP**: bombs look ceiling-safe but GAP FILL runs after bomb rows and a bomb is a valid
  `b` — a bomb's TIME sets notes_total. Verify `__rrChartStats` after any bomb-frequency change.
- Difficulty levers live in buildNotes (MINGAP, lane-jump clamp, chord freq, section floor, per-difficulty);
  Easy = fewer centered lanes + no bombs; charts must stay TIME-SORTED after inserts.
- Musical charter is default (multi-band spectral flux + centroid lanes) — verify `__rrChartStats.centroidLaneR`.

## Stage 5 — VERIFY (capture review is MANDATORY — "if you didn't see it, it isn't done")
1. `node --check game.js` (+ any touched js) · `grep -c "score +=" game.js` == 17.
2. Headless: preview `rr-verify` (port 8790, main dir), `?ryo=off&novideo=1&cb=<ts>`; drive via
   `RhythmCatalog.launchTrack` / `__rrDebug` (`.state() .press() .setCombo()`); `__rrChartStats` sane.
3. **CAPTURE REVIEW**: canvas `toDataURL` frames at rest + peak (`RhythmProcBg._feed` for procbg levels;
   in-run captures for journeys) → pad JSON past the 25k-token cap to force to disk → regex-extract
   base64 (python) → **Read the images and critique them**. Iterate until they'd survive the owner's eye.
4. Hit-test any new UI with `document.elementFromPoint` — synthetic `.click()` bypasses hit-testing
   (the store click-eater lesson). Zero console errors.
5. FEEL pass is the owner's: they play it before it's called done.

## Stage 6 — SHIP
Bump `?v=NN` in index.html (python io.open utf-8 — NEVER PowerShell rewrites), CHANGELOG entry
(buildNNN), commit to `visual-overhaul`, push, Lovable sync message ("GAME SYNC — RR_REF=<sha>", agent
runs sync-game.mjs + rewrite-game-assets; never publishes — the OWNER publishes), update memory if a new
law was learned.

## Paid levels (store wiring)
Store items live in index.html STORE_FALLBACK + STORE_ART/SKIN_GUITAR maps; entitlement ids use
**underscores** (`high_seas`) while level ids use hyphens (`high-seas`) — ownsItem normalizes, but always
double-check (the "owned but can't play" gotcha). Locked paid cards use the two-click-confirm store route.
Campaign Hard tier is gated by clearing Medium; badges come from rr_levelprog automatically.

## Boss levels (format TBD — design session with the owner first)
`boss:true` exists in the schema. The agreed exploration space: HP-duel + journey-phase hybrid (boss HP
bar damaged by accuracy; phases ride the journey engine; attack patterns = bomb volleys/lane pressure;
Overdrive = counterattack window). DO NOT build a boss without a dedicated design alignment — the owner
wants to brainstorm the mechanic set first.
