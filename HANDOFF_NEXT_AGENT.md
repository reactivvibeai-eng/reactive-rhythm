# HANDOFF — Reactive Rhythm (read this FIRST, then CLAUDE.md)

You're continuing a browser rhythm game (vanilla JS + Canvas 2D, no build step). Branch **`visual-overhaul`**,
currently **v84**, tree clean, committed. **DO NOT DEPLOY** — the live site is the old v47 and the user is holding;
all work is local. User is on **Windows / Chrome**, tests at **http://localhost:8787** via `python serve.py`.

## WHERE / RUN
- Main dir (edit + serve here): `D:\sunoai music plan\animev1\veo 3 round 2\can i pet that dog\cloudcode\v2`
  (you may be invoked in a `.claude/worktrees/...` worktree — use absolute paths to the MAIN dir; commits go to it).
- Files: `index.html` (shell: ALL CSS in one `<style>`, all screen markup, many inline `<script>`s, RHYTHM_CONFIG +
  supabase-js v2 CDN), `game.js` (engine), `catalog.js` (`window.RhythmCatalog`), `jukebox.js` (library/coverflow),
  `serve.py` (no-cache dev server).
- Bump `?v=NN` (4 spots in index.html) on ANY game.js/jukebox.js/catalog.js/jukebox.css change. index.html-only
  changes need no bump (no-cache serves fresh) — but bumping anyway makes the start-screen version stamp tick.

## ⭐ YOU CAN BOOT + TEST THE GAME (do this before handing anything to the user — they insist on tested-first)
The Claude_Preview headless browser HAS internet, so it boots the game fully (the old "can't boot" belief was wrong).
RECIPE: (1) kill ALL stale procs on 8787 first (a leftover serve.py makes preview's http.server fail → `chrome-error`):
`Get-NetTCPConnection -LocalPort 8787 | %{ Stop-Process -Id $_.OwningProcess -Force }` + kill python serve.py/http.server.
(2) `preview_start` name `rhythm-rift`. (3) `preview_eval` `window.location.href='http://127.0.0.1:8787/index.html?dev=1&cb='+Date.now()`
(use location.href + cb cache-bust; NEVER location.replace — hangs). (4) wait ~8s. (5) confirm `{hasGame:!!window.RhythmGame}`.
DRIVE IT: `RhythmCatalog.launchTrack(t)` (quick play); `RhythmCatalog.openSheet(t)` then `RhythmEnvPicker.select('frac-01')`
+ click `#play-btn` (env picker); `RhythmLibrary.openLevels()` + click `[data-lvl="frac-01"]` (campaign); `RhythmHub.show()`
(menu hub); `__rrDebug.state()/jt()/score()`; `document.elementFromPoint(innerWidth/2,innerHeight/2)` + `[...document.querySelectorAll('.screen.active')].map(s=>s.id)`
to catch screen-stacking; `RhythmLevelFx.onHit('great',0)/onMiss(0)` to test reactive cards; `preview_console_logs` (error).
WHEN DONE: `preview_stop` + restart serve.py (no-cache) so the user has a clean server. Also: `node --check game.js`
after JS edits; validate inline scripts via `new Function()`. See memory `rhythm-game-local-verify`.

## DONE THIS SESSION (don't redo)
- Full GPT Image 2 **photoreal asset set**: 9 level covers + 3 store items + 4 backdrops (assets/levels, assets/store).
- **Skully level** (`frac-01` "The World"): violet theme + `skully-loop.mp4` animated backdrop + DEATH/THE WORLD
  **reactive cards** that now sit LOW by the bridge and **FILL UP** (fate meters: Death on miss, World on hit).
- **Full-bleed level backdrops** (`#game-bg` layer — backdrop fills the whole game screen behind the HUD).
- **Store vault background** (assets/store/store-bg.jpg).
- **Version stamp** on the start screen (`vNN · host`).
- 🐛 **Two critical fixes (verified):** (1) `showScreen` is now EXCLUSIVE (overlays no longer stack over the game →
  fixed "playing kicks back to browser"). (2) `clearLevelTheme` only fires on menu/results, NOT loading (→ fixed
  "levels play plain"; the level theme/backdrop/cards survive into gameplay).
- **Environment picker** on the song sheet: pick any song → choose a level/ENVIRONMENT → play that song in it
  (`window.RhythmLevels.environments()/applyEnvironment()`, wraps `setMenuPlayHandler`; Default = byte-identical).
- **Guided Main Menu hub** (`#menu-hub`, `window.RhythmHub`): Start → Campaign/Quick Play/Multiplayer/Store/LB/Profile.
- (earlier) mobile polish, charting bomb-rows/variety (`?notes`), open-notes/HOPO (`?open`), guitar combo/miss/
  MASS-FAIL wipeout FX, store-art client fallback, level intro splash.

## REMAINING QUEUE (design packages exist at ROOT, all verifier-ok unless noted; integrate ONE per turn + preview-test)
1. **`_build6_guitarstore.md`** — per-level CUSTOM GUITARS (e.g. Skully violet guitar; swap `activeGuitarImg`; SAFEST =
   recolor the base guitar PNG so string geometry stays aligned — see package) + **reframed STORE** (sells GUITAR SKINS
   + CUSTOM LEVELS, NOT song bundles — all 916 songs are free) + equip system + a copy-paste **Lovable brief** for the
   new store_items catalog + client fallback. Anchors are current (build6). Self-heals if guitar art absent.
2. **`_build6_multiplayer.md`** — online **OPEN-LOBBY** multiplayer via Supabase Realtime **presence** (NOT room codes):
   click Multiplayer → lobby showing everyone online → **host badge** → challenge anyone → side-by-side + winner; plus
   **user leaderboards** (see ranks). Adds `multiplayer.js` (script tag LAST after catalog.js) + `?v` bump to 85.
   MUST-FIXES from verify: move `_fireSongEnd('end')` to AFTER `_lastResults = results` in game.js endGame; fix the dead
   server-chart flag (use `chart_status==='ready'`/`has_chart`); add `__buffered: (url,meta)=>bufferedProvider(url,meta)`
   to the RhythmGame Object.assign. The `#multiplayer-screen` placeholder + `RhythmHub.toMultiplayer()` already exist.
3. **`_build6_polish.md`** — better LOADING animation + BROWSE-section video backdrop wiring (the `browse-loop.mp4`
   asset comes from the asset agent; code self-heals to the static moon if absent). Minor: a scrim used `rgba(7,6,10)`
   (faint blue tint) — make it warm (R≥G≥B).
4. **`_build5_levelidentity.md`** — per-level themed HUD/notes/ambient. ⚠️ NEEDS RE-ANCHORING: its STEP A anchor
   (`...opacity: 0.55; transition: opacity 0.4s ease; }` on `#game.rr-lvl-themed .game-center::before`) was REMOVED when
   the full-bleed work relocated that accent to `#game.rr-lvl-themed #game-bg .bg-accent`. Re-anchor STEP A + the
   `.game-center::before` rules accordingly. STEP E (applyLevelTheme/clearLevelTheme) also edited since — re-anchor. B2
   catcher glow is exact; B3 note-aura: replace `gfx.base` with `lw*0.46*sc` (or ship B2-only). game.js STEP B/C/D anchors OK.

## USER DIRECTIVES / REFRAMES (also in memory: reactive-rhythm-store-catalog, reactive-rhythm-multiplayer-spec)
- STORE sells **guitar skins + custom levels**, NOT songs (all songs free).
- MULTIPLAYER = **open lobby** (presence) + **host badge** + challenge anyone; networked side-by-side.
- Each LEVEL should have its own **custom guitar** matching its theme (Skully = violet/gothic).
- Reactive cards: by the bridge + fill up (DONE).

## ASSET AGENT (separate session — Higgsfield MCP)
The user runs a SEPARATE asset-gen agent (brief: `ASSET_AGENT_BRIEF.md`; detailed prompts: `ASSET_PROMPTS.md`). It ONLY
touches `assets/` + ASSET_PROMPTS.md (no game code) → commits on the SAME branch, no collisions. **Your Higgsfield MCP
may be disconnected** — if you need art, hand prompts to the asset agent (put exact prompts + paths in the build package).
Pending art it's producing: `assets/levels/browse-loop.mp4` (job 16aa24b8 may have NSFW-flagged → re-roll), guitar skins
(`assets/guitars/`), store covers. Your code must self-heal when an asset is missing.

## HARD CONSTRAINTS
Brand: black · crimson #ff1f2e · ember #ff7a4a · gold #e0a93f · chrome #dad7d2; warm darks (R≥G≥B); **NO blue/purple in
core UI** (a LEVEL may use its own palette, e.g. violet #a64dff for the gothic Skully level). Fonts Oxanium / Chakra Petch /
Unbounded / JetBrains Mono. Standard 6-string + gh 5-string gameplay/scoring/timing must stay **byte-identical** unless
flag-gated. Keep the game muted when you drive it. Commit small, focused. Don't strip dev hooks (`?dev/?notes/?open/?gh/
?warp/__rr*`/FPS meter) until the user declares content-freeze (LAST, before any deploy). Don't deploy until the user says.
