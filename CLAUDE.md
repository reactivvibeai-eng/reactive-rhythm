<!-- ═══════════════════════════════════════════════════════════════════════════
  ▶ NEW AGENT / RESUMING DEVELOPMENT? DO THIS:
     1. This project is plain files on disk at:
        D:\sunoai music plan\animev1\veo 3 round 2\can i pet that dog\cloudcode\v2\
     2. Read this whole file, then CHANGELOG.md (full history).
     3. Run it:  cd into that folder, then `python serve.py`  → http://127.0.0.1:8787
     4. Continue. Nothing about this project lives in any chat/agent memory — it's all here.
  ═══════════════════════════════════════════════════════════════════════════ -->

# Reactive Rhythm — project state & handoff (READ THIS FIRST)

> A new agent picking this up: read this whole file, then `CHANGELOG.md` for the detailed
> history. This file is the source of truth for **where the game lives, how to run it, how it's
> built, and what's next.**

## What this is
**Reactive Rhythm** (UI brand: ReactivVibe AI) — a browser **rhythm game** (Guitar-Hero-style,
6 lanes on a guitar neck). Plays real tracks from the ReactivVibe music platform. Pure static
**HTML/CSS/vanilla-JS + Canvas 2D** (no build step, no framework). Ships at `reactivvibe.com/play`.

## WHERE IT LIVES (the user wasn't sure)
```
D:\sunoai music plan\animev1\veo 3 round 2\can i pet that dog\cloudcode\v2\
```
(Git Bash path: `/d/sunoai music plan/animev1/veo 3 round 2/can i pet that dog/cloudcode/v2`)
Everything below is relative to that folder. A verified baseline backup is in
`design-source/original-build/` (restore point — do not edit it).

## HOW TO RUN / TEST
```
cd <project root>
python serve.py        # serves http://127.0.0.1:8787  (localhost-only, NO-CACHE headers)
```
- `serve.py` is a tiny no-cache Python server so a **normal browser refresh always loads the
  latest** (no hard-refresh needed). Localhost-only bind on purpose (sandbox blocks 0.0.0.0).
- Open `http://localhost:8787`. The user tests on **Windows / Chrome**.
- Diagnostic flags: `?novideo=1` (disable the moon video backdrop), `?fps=0` (hide FPS meter),
  `?mock=1` (force the 1000-song mock catalog instead of live).

## FILE MAP
- **`index.html`** — the shell: all CSS (one big `<style>`), all screen markup (start, jukebox,
  game HUD, settings, how-to-play, results, loading), `window.RHYTHM_CONFIG` (Supabase URL +
  anon key + API base), dev FPS-meter script, `?novideo` script. Local JS/CSS carry a
  **`?v=NN` cache-bust query — bump NN on every JS/CSS change** (currently **v41**).
- **`game.js`** (~115KB, THE engine) — game loop (rAF), Canvas render, input (key/touch/MIDI/
  gamepad), scoring, the chart builder (`buildNotes`), the in-browser onset analyzer
  (`analyzeBeats`), providers (`demoProvider`, `bufferedProvider`/`playUrl`), audio (DemoPlayer
  WebAudio + hit/miss SFX buffers), all visual FX. Exposes `window.RhythmGame` (play, playUrl,
  playDemo, setDifficulty, applySettings, isMuted, DemoPlayer…) and dev hooks.
- **`catalog.js`** — wires the engine to the live catalog API (`game-catalog`). Paged fetch of
  the whole library, `trackReady`/`trackAudioUrl`, `liveProvider` (server-charted), routes a
  picked track to `playUrl` (in-browser chart) or `liveProvider`. Exposes `window.RhythmCatalog`.
- **`jukebox.js`** — the song-select UI: coverflow (Featured/Hot/New/Surprise), Browse
  (genres/artists), the searchable songs list, the header search bar.
- **`serve.py`** — the no-cache dev server.
- **`assets/`** — guitar.png, note PNGs, rings, moon-loop.mp4 (bg video), atom.png, mascot.png,
  **hit-chug.mp3** (hit SFX), **miss-squelch.mp3** (miss SFX), lunar-waves.mp3 (demo track).
- **`CHANGELOG.md`** — full increment-by-increment history (read for detail).
- **`LOVABLE_BRIEF.md` / `CATALOG_SCALE_BRIEF.md`** — specs handed to the user's backend
  ("Lovable") agent for the catalog API.
- `IMPLEMENTATION.md` — original design-handoff notes. `prize-wheel.html` — unrelated.

## ARCHITECTURE NOTES
- **Geometry is locked to the guitar art.** `guitarRect()` contain-fits `assets/guitar.png`;
  `fretGeom()` derives per-lane string x-positions from **pixel-measured** `ART.nutXF` /
  `ART.bridgeXF` (the painted strings fan out). Catchers/notes/tap-zones all ride these so they
  sit exactly on the strings at any size. **Don't "even-space" the lanes** — they're measured.
- **Charts:** every song needs note timings. Two paths: (a) **in-browser** — `bufferedProvider`
  fetches a track's `audio_url`, decodes (WebAudio), runs `analyzeBeats` (onset detection),
  plays the decoded buffer via `DemoPlayer`. Used for all live tracks today (they're
  `chart_status:"pending"` = no server chart). (b) **server pre-baked** (`liveProvider`, when
  `chart_status:"ready"`) — instant + leaderboard-safe; engine prefers it when present.
- **Note types** (`buildNotes`): tap, accent, star, **hold** (real sustain — head scored, hold
  the key, pays out), **chord** (2 simultaneous lanes), **bomb** (✕ hazard — DON'T hit; passing
  it is safe), plus **gap-fill** filler taps so no dead air. All re-sorted by time after inserts
  (hit-detection's early-`break` assumes ascending time — **keep notes time-sorted**).
- **Audio:** music plays at full level always (no ducking). Hit = palm-mute **chug** (per-lane
  pitch). Miss/bomb = **squelch** SFX. SFX buffers decoded once in `loadHitSfx()`.
- **Catalog API:** `https://bxiejoktoknybpraxebm.supabase.co/functions/v1/game-catalog`
  `GET /tracks?limit=&offset=&q=&sort=new|hot|az` (852 tracks, X-Total-Count header, server
  search), `GET /track/:id`, `POST /plays`, `POST /uses`, `GET /leaderboard/:id`. Anon read OK.
  Backend = the user's Supabase, changed via their **Lovable** agent (we can't touch it — hand
  off a brief). Track audio: `audio_url` is a direct CORS-readable mp3/m4a (decodable);
  `stream_url` may be HLS (`.m3u8`, playback-only, NOT decodable for charting).

## CONVENTIONS & HARD CONSTRAINTS
- **Bump `?v=NN`** in index.html on any JS/CSS edit (or the user's cache serves stale). Keep CHANGELOG updated.
- **Brand = black · crimson · chrome. NO purple/blue.** Darks must be warm (R≥G≥B); the old
  blue-greys read as purple and the user hated it. Fonts: **Oxanium** (numbers/HUD) + **Chakra
  Petch** (labels) for game feel; Unbounded only for big display headers.
- **Server bind localhost only.** Keep the game **muted** when you drive it (don't blast audio
  on the user's PC). After using Claude_Preview, **restart `python serve.py`** — launching the
  preview reclaims port 8787 and kills serve.py.
- Don't edit `design-source/original-build/` (backup).

## HOW TO VERIFY CHANGES (important — screenshots don't work here)
- The animated canvas **times out `preview_screenshot`**, and headless **throttles rAF** (the
  game loop barely advances when idle, so combos/score won't climb on their own). So:
- Use **`mcp__Claude_Preview__preview_start` (name "rhythm-rift") → `preview_eval`**: navigate
  with a cache-bust (`location.replace('/index.html?cb='+Date.now())`), then read DOM / computed
  styles / `window.__rrChartStats` / `window.__rrDebug`. Always check `preview_console_logs`
  (level error) at the end. `node --check game.js` after every JS edit.
- **`window.__rrDebug`** (dev hook): `.state() .jt() .score() .lanes() .nextHold() .press(lane)
  .release(lane) .chargeOd() .od() .audio()`. **`window.__rrChartStats`** = note/hold/chord/bomb/filler
  counts after a chart builds.
- To verify visuals I can't see (flames at mult≥2, lightning at combo%25): confirm the code is
  node-valid + no console errors, and tell the user it'll show on their 60/30fps machine.

## DEV HOOKS TO STRIP BEFORE LAUNCH
`window.__rrDebug`, `window.__rrChartStats`, the **FPS-meter** `<script>` block in index.html,
and the `?novideo`/`?fps`/`?mock` flags are test-only. Remove before shipping to `/play`.

## CURRENT STATE (as of v41)
Feature-complete v1: full 852-track live catalog (search/sort/fresh-first, all playable via
in-browser charting), hold notes, chords, bombs, gap-fill density, palm-mute hit SFX + miss
squelch (music never ducks), exact string alignment, game-feel HUD (Oxanium/Chakra Petch,
corner brackets, animated score count-up), strings-catch-fire + catcher flames + lightning on
combo, branded animated atom loading screen, How-to-Play overlay, prominent header search,
no-cache server. Brand colors locked (no purple). See CHANGELOG increments 1–26 for detail.
**v26–v29 (overnight, agent A):** Overdrive/Star Power is now keyboard-playable (**Space**, was
mouse-only) with a READY cue + riser SFX; Space no longer restarts your run (footgun removed). New
self-serve **Music Volume** + **Hit Sound** sliders in Settings (persisted). Results/Pause keyboard
flow (Enter/Esc) + slider a11y labels. Now under local git (focused commits per batch).
**v33 (overnight, agent B) — the reward loop / progression:** real plays now **persist** (every run
records locally via `RhythmCatalog.recordLocal` → per-song best + lifetime career; the cover grades
were previously only the mock `_mockBest` seed). New **Career / Controller Profile** overlay (person
icon in the library header) — lifetime score/runs/songs/best-combo/accuracy/full-combos, a grade
distribution, and a climbing rank title; backed by `rr_career`. Results screen gained a **star
rating** + a **GRADE UP** badge. (Built sole-editor after a concurrent agent — agent A — went idle.)

## OPEN / NEXT
1. **FPS** — the user still owes a `?novideo=1` vs normal reading; 30fps is likely the moon
   video compositing OR their monitor refresh. Decides whether to swap the backdrop.
3. **"Your Tracks" shelf** — needs the backend to return an owner id / `/my-tracks` (brief it).
4. **Server-side search** — switch the header search to the `?q=` endpoint when the library
   grows into the thousands (currently client-side over all 852, instant).
5. **Launch prep** — strip dev hooks, then deploy to `reactivvibe.com/play`.
6. Playtest dial-ins the user may request: chug/squelch volume, bomb/chord frequency, fire intensity.
