# CONTINUATION HANDOFF — Reactive Rhythm @ v99 (read with CLAUDE.md + memories)

Branch `visual-overhaul`, **currently v99**, tree committed (commits `f621fbc`→`4d1f112`), serve.py
running (http 200, no-cache). **DO NOT deploy.**

**ROADMAP (user-co-designed 2026-06-09, memory `reactive-rhythm-5lane-spec`):** ✅ Phase 1 PRECISION
shipped in v99 — THE GAME IS 5-LANE (gh boots default; legacy 6-string = dormant `?gh=0` toggle);
invariant-lane skin fit (lanes never move, skin art conforms via per-string PIXEL-MEASURED SKIN_GEOM —
verified in real play: skin on/off Δ0.00px at catchers); `?align=1` overlay + `__rrDebug.lanesPx/rect`.
**v100 SHIPPED (commits `670342d`+`f5b6367`):** TITLE SCREEN rebuilt as full-bleed RYO key art
(lower-third lockup, meta bar, ENTER/SPACE; mascot + the hub's pasted RYO rect removed) and the SKULLY
playability pass (cards hug the guitar arm via the new public `RhythmGame.getLaneFrame()`, themed neck
scrim, re-lit tinted gems, accent bombs) + two critical e2e fixes (title-Enter fired the engine's menu
play shortcut; first-run how-to popped under the title/intro — both guarded).
**v101 SHIPPED (commits `0fdaeb1`+`4b7cc81`) — the user's Skully playtest feedback:** (a) **SKIN
HIGHWAY PROJECTION** — flat custom-guitar art texture-mapped onto the notes' 1/z plane (neck tilts
down into the level, video visible around it, full runway → pacing matches default; the "guitar too
big / not tilted / marbles too fast" fix); bomb-warn telegraph rides wall-bombs. (b) **RhythmUiFx
menu-layer FX** — title ember ambience, ENTER ignition (bursts + the `assets/fx/_src/*.mp4` clips'
BASS via pooled `<audio>`), per-tile click bursts; **RYO intro plays WITH SOUND** (unmuted
post-gesture, muted-retry). New dev hooks to strip at freeze: `__rrUiFx`, `__rrUiFxTest`.
**v102 SHIPPED (`c6c4099`):** LEVEL-START CINEMATIC (backdrop zoom-settle + the guitar MATERIALIZES
horizon→bridge behind an accent frontier; `_skinBuildT`, `__rrDebug.buildT()`) + hub-Enter leak fixed
(library-only shortcut). Full beta sweep: zero console errors.
**v103 SHIPPED (`e1eb785`) — the user's screenshots caught two bugs:** (1) projection dest width was
`sc*iw` (~676k px → Chrome silently no-ops) → **Skully had NO guitar**; fixed (`dw=sc`, body
`rows*(sc/iw)`). (2) The user's stored pre-decree `standard` made their default the huge flat
6-string; one-time migration → gh (`rr_lane_migrated5`, deliberate post-decree standard sticks).
⚠️ **TESTING LESSON (binding):** single-pixel ALPHA probes cannot verify art (scrim/strings mimic
it) — verify canvas art with **REGION RGB-DISTANCE probes across a state toggle** (skin on/off,
build 0→1): v103's numbers were 74/px print-sweep, 66–120/px skin-vs-default, 3/px re-applied.
**v104 (`21f1407`):** SQUARE-MARBLES fix — gem tint's `multiply` made the sprite canvas fully opaque
(squares on every tinted level since build8); fixed with `destination-in` alpha restore +
`__rrDebug.gemTint` corner/center probe (sprite-canvas alpha checks are now part of the test kit).
**v107–v108 (`d048135`) — playtest + 31-agent adversarial review:** custom guitars are PROFILE RESKINS
now (whole art, cover-fit, lanes on their OWN measured strings — both the invariant fit and the
projection are deleted; the user's verdict). FX sheets are LUMINANCE-KEYED at load (`RhythmFxKey`,
production export — black-box root cause: additive-on-transparent). Backdrop = contain + blurred fill.
⚠ **ASSET DEBT for the asset agent:** (1) `ryo-intro.mp4` HAS NO AUDIO TRACK — re-export with audio
(lunar-waves bed is the stopgap); (2) crimson-chrome + gold-relic guitars too tall for natural framing
(spawn ~300px off-screen) — re-render framed like guitar5 (mostly neck, ~0.56 aspect, body sliver).
**v105–v106 (`eabe0bf`→`700e234`):** gameplay signed off with precision input probes (exact-time
press → PERFECT on both guitars; early press consumes nothing); Skully guitar reshaped to the
DEFAULT's anatomy (projection = tapering NECK BAND 1.8× lane span + body strip at PROFILE scale —
the "blown up" fix); FX became impacts (PEAK-frame spawn via FX_TIM/_playTuned — measure peaks with
the luminance-argmax sweep; combo escalation 25/50/75/century; multiplier tiers; odend). User count
correction: the FX pack is 31 total ("100" was exaggeration) — FX_BATCH2_BRIEF.md exists if more are
ever commissioned. **Skully gate still open: the user must approve the level visually before any new
level is built.**
**ASSET TRUTH (the user's "100 effect videos"):** the repo holds **36 mp4s** (31 FX — all wired — +
3 level loops + moon + ryo-intro); no asset-agent commits in 3 days. A bigger clip batch is NOT in
the repo. Drop path when it lands: clips → `assets/fx/_src/` → `python build_sheet.py <name> --count
N --cols C --rows R [--loop]` → UNION-merge `manifest.json` (never overwrite; bomb-* names are
engine-owned) → the engine auto-loads any manifest entry; wire new names into THEME_FX/_fxLayers/the
UI MAP as fits. The engine agent (me) can tile + wire the moment files exist.
**NEXT:** user PLAYS SKULLY (the verdict gates the template lock-in). Dial knobs ready: zoom amount
(rrCineZoom 1.16), print speed (dt/2.0), frontier colors, NSL slices, scrim alpha, boom volumes, the
click-FX MAP. Open beta-feedback items (user's call): intro-every-launch fatigue (consider instant-
skip memory), Random-default stickiness per session, strings-visible-before-wood during the print,
pause-menu press FX, ENTER label on touch. Carryover: `?align=1` skin eyeball (melody-pink/ember-bone
roughest); 2-device MP test; asset wishes (transparent RYO cutout, Skully hazard art).

## HOW TO TEST (memory `rhythm-game-local-verify` — read it)
Claude_Preview headless browser CAN boot+run the game. Recipe: kill all 8787 procs → `preview_start`
`rhythm-rift` → `location.href='http://127.0.0.1:8787/index.html?dev=1&cb='+Date.now()` (never
`location.replace`) → wait ~8s → `preview_resize 1366x768` → drive via RhythmCatalog/RhythmLibrary/
RhythmLevels/RhythmEnvPicker/RhythmMP/__rrDebug → `preview_console_logs` (error) → `preview_stop` →
restart serve.py. `node --check game.js multiplayer.js` after JS edits; bump `?v=NN` once per change.

> ⚠️ **WORKTREE FOOTGUN (hit + fixed this session):** the `rhythm-rift` launch.json ran
> `python -m http.server 8787` with **no `--directory`**, so it serves the *session cwd*. In a
> `.claude/worktrees/...` session that's the worktree (stale, lacks `visual-overhaul` files). Fix:
> the worktree's `.claude/launch.json` rhythm-rift entry now pins `--directory <main v2 dir>`. If a
> future worktree session's preview shows a stale version stamp, re-apply that `--directory` pin
> (or serve from / edit the main v2 dir). Always confirm the served version via `#rr-version`.

## DONE + VERIFIED THIS PASS (v92→v96) — all additive, gameplay byte-identical
- **v92 Flipbook FX** (`game.js`+`index.html`): `fx-player.js` wired in; hit/perfect/miss/combo/
  overdrive bursts at the real sites, themed per `#game[data-rrtheme]`; bombs ride a **bomb-fuse**
  loop + **bomb-explode** on strike. `__rrDebug.fx/fxEmit/fxDraw`.
- **v93 Guitars** (`game.js`+`index.html`): `SKIN_GEOM` for crimson_chrome/ember_bone/gold_relic;
  store sells all 6 premium skins. `__rrDebug.geom()`.
- **v94 Levels** (`index.html`): Bone Daddy (medium, `bone`, booty-shake) + Melody (hard BOSS,
  `pink`, cat-paw, `melody_boss` store unlock); `bone`/`pink` themes in all 6 theme maps; per-level
  `mechanic` field + `buildMechanic()`; **Random** env chip (rolls each play) + "Arena" plain.
- **v95 Multiplayer ROOM SYSTEM** (`multiplayer.js`+`index.html`): rooms (open/browse/join/close),
  quick-match, spectate, room→match handoff. Match engine NOT forked.
- **v96 RYO menu visuals** (`index.html`): hub `menu-loop.mp4` + RYO hero; 6 living tiles; atom-core
  loader (self-heals to SVG); RYO `ryo-intro.mp4` intro.
- **v97 FX deepening + startup intro** (`game.js`+`index.html`): themed ambient AURA loops behind the
  neck (Skully `skull-flame-violet`, Bone Daddy `ember-skull-loop`, low-alpha, NOT a wash); Melody hit
  FX = `paw-poof`; sustained `overdrive-aura` loop during star power; `star-pickup` on surge notes. RYO
  intro is now the **every-startup** intro (was first-run-once), skippable + reduce-motion-safe,
  `?ryo=off` disables. `__rrDebug.fx().names` lists live sheets.

## OPEN / NEXT
1. **MULTIPLAYER needs a real 2-device (or 2-tab) test** — a single headless browser can't host two
   Supabase presences, so room-join / quick-match pairing / spectate / room-start handoff are
   verified only structurally. Test plan: `_build8_multiplayer.md` §11. Watch: seat assignment,
   the deterministic qm proposer (smaller id), READY auto-arm across the handoff, REMATCH not
   re-entering `startRoomMatch` (the `!matchCh` guard), spectator tick feed, room-gone prune (~4s).
2. **Visual fine-tuning (the user's eye — canvas screenshots time out headless):**
   - Per-skin lane alignment: equip each new guitar, `__rrDebug.geom()`, nudge `SKIN_GEOM` nut/bridge
     until the 6 lanes sit on the painted strings.
   - Per-level mechanic feel: Bone Daddy booty position/size at the spawn end; Melody paw swipe arc.
   - FX intensity (`FX_GLOBAL` in game.js), bomb-fuse scale, menu-video opacity, RYO hero scale/crop.
3. **Carryover from v91:** Track A ship path (move deployable set into `reactiv435/reactivvibeailive`
   at `/play`, beta-code gate per `BETA_GATE_BRIEF.md`, **strip dev hooks LAST**); server-side `?q=`
   search at scale; "Your Tracks" shelf (needs backend owner id).

## COORDINATION (asset agent works `assets/` only, same branch)
- Union-merge `assets/fx/manifest.json` / `preview.html` / `INTEGRATION.md`. The bomb set
  (bomb-fuse/explode/warn) is engine-authoritative. NEVER `git clean`/`rm` the agent's untracked
  files (the `_build*.md` docs + `assets/ryo/` were untracked this session — left untouched).
- Atom loader self-heals to SVG: drop `assets/atom-loading.png` in to light up the raster core.

## HARD CONSTRAINTS (unchanged) — see CLAUDE.md
Brand black·crimson·ember·gold·chrome, warm darks, NO blue/purple in core UI (a LEVEL may use its
own palette — violet Skully, bone, pink). Bump `?v` (6 spots: jukebox.css + 5 script tags incl.
fx-player.js) on any JS/CSS change. Keep muted when driving. Don't strip dev hooks
(`__rr*`/`?dev/?novideo/?ryo=off`/FPS meter) until content-freeze. Don't deploy until the user says.
