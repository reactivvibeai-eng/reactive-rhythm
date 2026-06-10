# CONTINUATION HANDOFF — Reactive Rhythm @ v98 (read with CLAUDE.md + memories)

Branch `visual-overhaul`, **currently v98**, tree committed (commits `f621fbc`→`f315362`), serve.py
running (http 200, no-cache). **DO NOT deploy.** This supersedes `_HANDOFF_v91.md` — its 5-item queue
is **DONE**, plus v97–v98 passes that wired the asset agent's ENTIRE 31-effect FX union (incl. a
results-screen celebration surface). **NEXT: a user-co-designed roadmap (user directive 2026-06-09) —
top items: per-guitar precision alignment (user confirms skins misaligned; note the tall-skin aspect
problem: e.g. crimson-chrome is 904×2194 vs base 904×1268 → contain-fit makes its lanes ~4× narrower)
and the Skully level(s) as the template. measure.html is a ready string-calibrator (currently
guitar5-only — generalize it). Do NOT start roadmap work before the user signs off.**

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
