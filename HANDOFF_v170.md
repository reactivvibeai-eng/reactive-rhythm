# Reactive Rhythm — Handoff @ v170 (READ THIS, then CLAUDE.md + CHANGELOG.md)

Browser 5-lane Guitar-Hero rhythm game (vanilla JS + Canvas, no build). This file = where things stand + the
gotchas that will bite you. Full history in **CHANGELOG.md**; deeper plans in **RR_EVOLUTION.md** (whole-game roadmap)
and **MP_GAMEPLAN.md** (multiplayer architecture + what's left).

## ⚠️ ENVIRONMENT GOTCHAS (these cost time — read first)
- **WORKTREE IS STALE.** The session cwd is a git worktree at `…\v2\.claude\worktrees\focused-galileo-f97b2e` that
  sits at an OLD checkpoint and is MISSING current game files. The LIVE game is the **MAIN dir**:
  `D:\sunoai music plan\animev1\veo 3 round 2\can i pet that dog\cloudcode\v2\`. `serve.py` self-pins there. **Always
  Read/Edit/Glob with absolute MAIN-dir paths** — bare `Glob`/`Bash` hit the stale tree and lie to you.
- **NEVER rewrite project files with PowerShell** (PS 5.1 reads BOM-less UTF-8 as cp1252 → mojibake). Use the Edit tool,
  or `python -c "..."` for the `?v=` bumps (that's how this session did it).
- **Bump `?v=NN`** on the 6 local refs in index.html on every JS/CSS edit (currently **v170**). Bump via python:
  `python -c "import io;p='index.html';s=io.open(p,encoding='utf-8').read();io.open(p,'w',encoding='utf-8',newline='').write(s.replace('?v=170','?v=171'));print('v171')"`
- **`node --check game.js` / `multiplayer.js` / `jukebox.js` / `catalog.js` after every JS edit.**

## HOW TO RUN / VERIFY
- `serve.py` on `http://localhost:8787` (no-cache). Verify via **Claude_Preview** server name **`rhythm-rift`**:
  `location.href='/index.html?cb='+Date.now()` (never `location.replace` — hangs), then read DOM/computed styles.
- **Headless limits (real, plan around them):** the animated canvas times out `preview_screenshot`; rAF is throttled
  (combos/score barely climb on their own); the preview window is locked ~**704px wide** (so it always takes the MOBILE
  branch — can't verify the desktop split-screen visually); real-time songs can't be fast-forwarded. So: verify CSS
  values / DOM / state / `node --check`, and rely on the user's 60fps desktop for *feel* + the desktop split.
- Force `document.hidden=false` to beat auto-pause-on-blur. Console buffer **persists across reloads** — old `?v=167`/
  `?mock=1` errors linger; check the `?v=` tag to tell stale from new. `?mock=1` gives FAKE track ids that 404 on
  `/track/:id` — use the REAL catalog (no `?mock`) to test actual playback (the preview has internet).
- Dev MP harness: `window.__mpDev` — `.solo(n)` create bracket+bots, `.spectate(true/false)` (on=auto-run+auto-advance;
  off=manual play + manual START NEXT ROUND), `.diff('easy'|'medium'|'hard')`, `.run(n)` full auto solo bracket,
  `.status()`. Tournaments use `fakeTourChannel` offline (no 2nd client). `__rrDebug` for engine state.

## WHAT THIS SESSION SHIPPED (v158→v170) — all in CHANGELOG.md
- **Split-screen versus**: guitar height-fit (was over-zoomed), HUD into the side gaps + score abbreviation + grouped
  combo, rival GHOST deck lit up (crimson lanes/catcher/gems + hit-miss flash), grid hardened, Bone Daddy reactive
  cards hidden in vs-mode.
- **Tournament cinematic flow**: ROUND/VS/3·2·1 countdown overlay, verdict beat, champion reveal build-up.
- **CRITICAL tournament fixes**: (v167) first-run How-To overlay was occluding the round + fail-loud watchdog + audio
  unlock on the START gesture; (v169) **the watchdog was false-aborting valid rounds during the track decode** —
  now it waits through `#loading`. Rounds start + play + advance bracket→champion. NPC difficulty added.
- **(v170) Live SPECTATE mode**: NPCs ramp scores over ~20s (watchable race, not instant) + live lead-highlight +
  a "● SPECTATING — LIVE" board badge when eliminated/bye/not-in-pair.
- **Browse**: removed the center-top "red moon" (`.lib::before` glow + the desktop `.lib::after` moon.png), fixed the
  `‹ MENU`-vs-brand-row overlap, widened desktop, AI-radio badge render (`.cover-badges`, awaits backend `badges` field).
- **Start screen**: generated chrome/crimson **wordmark** `assets/rr-wordmark.png` (replaces the Nosifer text; text
  fallback on img error), CTA pill, motion/perf thinned.
- **Results grade** tier-colored (S=gold bloom…), **global beat-pulse** (`--rr-beat` glow on HUD), type unified to
  Unbounded, page-by-page review fixes (brand greens/blues→chrome, etc.).
- **Deliverables for the user**: `BADGES_BACKEND_BRIEF.md` (hand to Lovable), `RR_EVOLUTION.md`, `MP_GAMEPLAN.md`.

## CONVENTIONS / CONSTRAINTS
- Brand: warm black + crimson #ff1f2e + chrome #dad7d2 + gold #e0a93f (gold = win/OD only). **NO blue/green/cyan/purple
  in UI chrome.** Sanctioned exceptions: GH-green note gem on lane 1; per-level world art. (`--cyan`/`--green` are
  aliased to silver/gold — landmine; don't trust the var names.) No `:has()`/`@container` (older embed engine no-ops).
- Fonts: Unbounded (display), Oxanium (numbers), Chakra Petch (labels), JetBrains Mono (mono).
- **Confirm credit cost + get a yes/no before ANY Higgsfield/Meshy generation** (standing user rule). Balance ~832cr.
- Dev hooks (`__mpDev`, `__rrDebug`, `__rrChartStats`, FPS meter, `?novideo`/`?fps`/`?mock`, fakeTourChannel) are
  strip-before-launch — do NOT strip until the user declares content-freeze.

## WHAT'S NEXT (user will choose; nothing in-flight)
The user just said tournament works + dismissed the "what next" picker → **wait for their instruction.** When they pick,
candidates from RR_EVOLUTION.md top-10 / MP_GAMEPLAN.md:
- First-run interactive tutorial + a no-fail **Jam/Watch** mode (persona-flagged funnel gaps).
- More/new **levels** + a level picker.
- **3D assets** (Higgsfield+Meshy: rigged beat-reactive Ryo / hero guitar skin) — cost-gated.
- More **beat-pulse / juice** polish.
- MP **before-public** track (server-authoritative scoring [needs Lovable], reconnection, host migration) — larger.

## STATE: now v174 (was v170). Since v170, three passes landed — see CHANGELOG.md (top entries):
- **v171 JUICE** — global beat-bloom on EVERY stage (themed video too) + at 1× mult; Overdrive ignition flash+shockwave;
  results S/A ember burst; menu atom-breathe + primary-CTA crimson heartbeat. Pure CSS/canvas, reduce-motion/fx-lite gated.
- **v172–v173 MP BEFORE-PUBLIC HARDENING (build42)** — `t-snapshot` host heartbeat (self-heal), reconnection
  (sessionStorage rejoin), host migration (election + snapshot resume, replaces "dissolve"), proof-of-life forfeit guard
  (never forfeit a player still streaming `t-tick`), score sanitation; `t-final` now carries chart context + `ranked`.
  All ADDITIVE — the verified bracket flow is untouched. `MP_SERVER_SCORING_BRIEF.md` updated (server re-judge is the
  remaining `MP_PUBLIC=true` gate; `MP_PUBLIC` now lives in `multiplayer.js`).
- Verified headless to the harness's limit (8-player auto bracket: R1 full lifecycle + R1→R2 advance, snapshot version
  0→32, 0 new errors). The desktop split-screen + full-song feel + the TRUE 2-client reconnect/migration handoff need the
  user's machine (offline harness has no 2nd client; headless throttles idle timers).
- **v174 FOLLOW-UP** — JUICE is now **live-tunable to taste** (`window.__rrJuice` presets/`set`/persist — no rebuild;
  the canvas magic numbers live in a `JUICE` config in game.js). MP netcode **validated over the REAL Supabase
  transport** (automated 2-peer test: subscribe + soft-presence + `t-snapshot` heartbeat + `t-final` sanitation all
  round-tripped with a genuine 2nd client). **`MP_SMOKE_TEST.md`** = the 2-device manual procedure (the full UI
  reconnect/host-migration handoff needs two real game instances).
- Git: the **v173 checkpoint is committed** (`db10878` on `visual-overhaul`); v174 is a follow-up commit on the same
  branch. Origin = github.com/reactivvibeai-eng/reactive-rhythm (not pushed).
