# Overnight work log — 5-string GH mode, level system, polish

Started: user went to sleep, asked for autonomous overnight work. Goals by morning:
1. **Level system** — core framework + picker + progression (wired to existing catalog songs; assets come tomorrow).
2. **Guitar (5-string) on point** — fix alignment + sizing/zoom + professional polish.
3. **UI polish**.
4. **Research-informed improvements** — GH mechanics, input latency/response, beat mapping.

Hard constraints: NO deploy (keep local). Can't screenshot live canvas → verify alignment via offline PNG render harness + node --check + headless eval. Bump ?v on JS/CSS change. Keep `standard` (6-lane) byte-identical.

## Progress
- [x] Research workflow (mechanics / latency / beat-mapping / level-design) — DONE
- [x] Guitar transparency fixed (flood-fill key-out; was baked checkerboard) — v49
- [x] Guitar alignment verified via offline render harness (catchers on saddles, notes on strings)
- [x] Guitar sizing/zoom — adaptive zoom-into-neck (fanTarget 0.40, zoomMax 2.0) — v51, see _gh_preview.png
- [x] Controller config UI (PS5/any gamepad remap + holds) — v50
- [x] **Level system / campaign** — 3 tiers × 6 = 18 levels, stable song binding (rr_levelmap),
      per-difficulty stars, sequential unlock, tier star-counts, progress bar, NEXT badge, dev unlock-all.
      CAMPAIGN_PUBLIC=false (testers locked) / ?dev=1 = live progression. Verified, no errors — v52
- [x] A/V calibration / response time — ALREADY in the game (audioOffset tap-cal + slider + per-event inputLag
      compensation at game.js:1252). Verified present — THIS is why it felt tight. No change needed.
- [x] Safe juice — INVESTIGATED: combo-break feedback (glitch+shake+squelch), per-hit accuracy flair
      (PERFECT/GREAT/GOOD differ, game.js:1319-21), multiplier tracking ALREADY exist. Game is well-juiced;
      declined to pile blind changes onto a loved game. Remaining juice = playtest-dependent items (see roadmap).
- [x] In-game LANE MODE toggle (Settings → 6-Lane Keys / 5-String Guitar) — verified switches profile + footer
      keys 6↔5, no URL needed, guarded against mid-run switch. v53
- [x] UI polish — new campaign UI (stars/locks/progress bar/NEXT badge) + lane-mode toggle; both verified clean.
- [x] Morning summary — written.

## FINAL STATUS (morning)
DONE + VERIFIED tonight: guitar transparency, adaptive zoom & alignment (offline-render verified), controller
config UI, the LEVEL CAMPAIGN (3 tiers/18 levels, stars, sequential unlock — verified end-to-end incl. launch),
in-game lane-mode toggle, and gh-mode confirmed PLAYABLE (335-note chart on 5 lanes, zero errors). All node-valid,
?v=53, nothing deployed (local only), standard 6-lane game byte-identical. serve.py restored on :8787.
KEY FINDING: response-time/calibration & juice were already strong — the game is well-built.
NEXT (need you awake / playtest / assets): see SESSION_STATE "RESEARCH-BACKED ROADMAP" + build level art/video.

## Research findings → plan (full report saved by workflow)
Ranked mechanics gaps: (1) Overdrive should DOUBLE multiplier + earn from phrases [HOLD — changes scoring
ceiling, needs playtest], (2) multiplier cap 4x chunky meter [med risk], (3) PERFECT-hit "center-cut" flair
[SAFE if no bonus pts], (4) **A/V calibration offset [SAFE, high value — DOING]**, (5) HOPO flow notes [high
effort, hold], (6) combo-break/milestone juice [SAFE — DOING], (7) NPS density per difficulty + protect rest
gaps [med, hold]. Decision: do the SAFE additive wins (calibration, juice) tonight; leave balance-changing
scoring for user playtest. Beat-mapping (BPM quantization) = bigger change, hold for review.

## Needs USER eyes in the morning
- Guitar gh mode on YOUR screen: load `?gh=1`, confirm framing/alignment feel right (fanTarget/zoomMax in
  game.js gh profile are easy dials if you want more/less zoom).
- Campaign: load `?dev=1`, open Levels — play level 1, confirm star + unlock flow feels right.
- Decide: enable Overdrive-doubling + 4x multiplier (bigger feel, needs your playtest to balance).

## Decisions / notes
(updated as I go)

## Needs USER eyes in the morning
(things I couldn't fully verify)
