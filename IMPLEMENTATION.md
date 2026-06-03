# Reactive Rhythm ("Rhythm Rift") — Implementation

This directory is the runnable implementation of the **Rhythm Rift** design handoff
from Claude Design (`claude.ai/design`). It is a browser rhythm game for the
ReactivVibe AI platform: a song plays, glyphs slide down a 6-lane highway, and you
hit the lane as each note reaches the bridge.

The design medium was already production-grade **static HTML/CSS/JS** — there is no
build step and no framework. Implementing it means serving these files as-is; the
prototype *is* the shippable artifact (per `design-source/DEPLOY.md`). It was
assembled from the canonical project files (the newest version — they contain the
final desktop-carousel fix that the `public/play/` copy in the bundle was missing).

## Run it locally

The game **must be served over HTTP** — opening `index.html` as a `file://` URL
shows a black screen, because the demo track loads via `fetch('assets/lunar-waves.mp3')`
which browsers block on `file://`.

```sh
# from this directory
python -m http.server 8787
# then open http://127.0.0.1:8787  (NOT the file path)
```

Any static server works (`npx serve`, `npx http-server`, etc.). All local files,
the Supabase moon video, the hls.js / supabase-js CDNs, and Google Fonts were
verified reachable (HTTP 200).

## Controls

- **Touch** (phones): tap the four lanes at the bottom of the highway.
- **Keyboard** (desktop): `A S D` = left three lanes, `J K L` = right three.
- **MIDI** instruments + **game controllers**: auto-detected on desktop Chrome/Edge.
- `ESC` pause · `SPACE` restart · `M` mute · gear icon → settings (note speed,
  visual-effects quality, latency calibration).

## Project structure

```
index.html      ← entry point (was "Rhythm Rift.html"; renamed per DEPLOY.md)
game.js         ← canvas engine: chart→notes, scoring, render, input, calibration
catalog.js      ← live layer: Supabase catalog API, HLS/file playback, score submit
jukebox.js      ← library UI: coverflow carousel + browse + searchable song list
jukebox.css     ← library UI styles
assets/         ← art, sprites, demo audio, moon video (26 files, ~114 MB)
design-source/  ← preserved handoff reference (README, DEPLOY, ROADMAP, chat, integration specs)
```

## What's external (and offline behavior)

The design intentionally depends on live services so the deployed build stays lean:

- **Moon video** (`start-video`, `bg-video`) streams from the public Supabase bucket.
  A byte-identical local copy exists at `assets/moon-loop.mp4` if you ever want an
  offline fallback (the design ships the streamed URL on purpose). Gameplay still
  renders correctly without it — the canvas draws its own procedural moon/clouds/guitar
  on top; only the start-screen video backdrop would be blank offline.
- **Catalog API** (`…supabase.co/functions/v1/game-catalog`): when reachable it serves
  the real licensed library. When it isn't, `catalog.js` **gracefully falls back to a
  1000-song mock catalog**, and the bundled **demo track ("Lunar Waves") always plays
  fully locally** with in-browser beat analysis. No scores are submitted in demo mode.
- **CDN libs**: `hls.js` (HLS playback) + `supabase-js` (shared auth session).
- **Google Fonts**: Unbounded, JetBrains Mono, Nosifer.

## Deploy contract (from `design-source/DEPLOY.md`)

Serve this folder at **`reactivvibe.com/play`**, *same-origin* with the main site so
the Supabase login session is shared (scores save) and audio autoplay carries over.

- `…/play` — opens the song browser (jukebox)
- `…/play?trackId=<uuid>` — deep-links into a song
- `…/play?pack=<uuid>` — sets pack context for revenue attribution
- `…/play?mock=1` — loads the 1000-song demo catalog (scale testing)

The `SUPABASE_KEY` in `index.html` is the **publishable anon key** — safe to ship
client-side (it's already in the design source).

## Refinement pass (done — see `CHANGELOG.md` for detail)

The two things called out as broken/missing in the handoff are now built & verified:

- ✅ **Desktop layout** — song-select is a full-width "deck" (large reactive coverflow
  + "NOW FOCUSED" hero rail + blood-moon backdrop); the gameplay HUD frames a centered
  880px playfield instead of stranding the score/combo at the screen edges.
- ✅ **Settings** — custom keybind remapping (6 lanes, persisted), live
  controller/MIDI device status, and an Input Test panel that lights a lane from any
  key / pad button / MIDI note.

All changes are desktop-gated or additive; the mobile-first experience is unchanged.
Verified baseline preserved in `design-source/original-build/`.

## Still deferred (net-new systems — next sessions)

- **Pillar B / VS6** — level / progression system.
- **Pillar F / VS8** — player identity, profiles, global/friend leaderboards.
- MIDI/gamepad button → lane *remapping* UI (keyboard remap + device test shipped).
- **Backend blocker**: the live catalog API returns HTTP 500 (`radio_tracks` ↔
  `game_dev_opt_ins` relationship missing in the Supabase schema cache). The game
  falls back gracefully (mock catalog + local demo track), but the real library
  won't load until that's fixed in your Supabase `game-catalog` edge function — it's
  not in this repo.

## Notes

- **Unused assets**: 14 files in `assets/` are source sheets / spare HUD pieces not
  referenced by the current runtime (`body.png`, `neck.png`, `hud-sheet.png`,
  `rings-sheet.png`, `spheres-sheet.png`, `guitar-src.png`, `fret-bg.png`, `moon.png`,
  `react-word.png`, `note-shatter.png`, `hud-badge.png`, `hud-bar.png`, `hud-flame.png`,
  `hud-pause.png`). They're kept because `DEPLOY.md` says ship "the whole folder," but
  pruning them slims `assets/` from ~114 MB to ~26 MB if you want a leaner deploy.
- The original handoff bundle was fetched from
  `https://api.anthropic.com/v1/design/h/QNX-095Be4KHqjqOT0BEjw` (a gzipped tar).
  `design-source/` holds the reference docs and chat from it.
