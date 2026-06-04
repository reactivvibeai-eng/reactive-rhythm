# Reactive Rhythm — ReactivVibe AI

A browser **rhythm game** (Guitar-Hero-style, 6 lanes on a guitar neck) that plays real tracks from
the ReactivVibe music platform. Pure static **HTML / CSS / vanilla JS + Canvas 2D** — no build step,
no framework. Ships at `reactivvibe.com/play`.

## Run locally
```
python serve.py        # serves http://127.0.0.1:8787  (no-cache dev server)
```
Open <http://localhost:8787> in Chrome. (On Windows you can double-click the **Reactive Rhythm**
desktop shortcut — it starts the server and opens the game in a Chrome app window.)

## Files
| File | What it is |
|---|---|
| `index.html` | The shell — all CSS, all screen markup, config, overlays (Levels, Career, How-to, Settings). |
| `game.js` | The engine — game loop, Canvas render, input (key/touch/MIDI/gamepad), scoring, chart builder, in-browser onset analyzer, audio + FX, progression (career/grades/stars), optional fail-mode. |
| `catalog.js` | Wires the engine to the live catalog API (`game-catalog`, 850+ tracks); per-song best + lifetime career (localStorage). |
| `jukebox.js` | The song-select UI — coverflow, browse, search. |
| `serve.py` | The no-cache dev server. |
| `CLAUDE.md` | **Full project state & handoff — read this first.** |
| `CHANGELOG.md` | Increment-by-increment history. |

## Deploy
Static files: host `index.html`, `game.js`, `jukebox.js`, `catalog.js`, `jukebox.css`, and `assets/`
at `reactivvibe.com/play`. Local JS/CSS carry a `?v=NN` cache-bust query — bump on every change.
**Before public launch:** strip the dev hooks (FPS meter, `__rrDebug`, `__rrChartStats`, and the
`?mock` / `?novideo` / `?fps` URL flags).

## Get it on GitHub (so the Lovable agent can pull it)
This folder is already a git repo with full history. One-time push:
```
# 1. Create a new PRIVATE repo on github.com (empty — no README, we have one)
# 2. From this folder:
git branch -M main
git remote add origin https://github.com/<your-user>/<your-repo>.git
git push -u origin main
```
Then in **Lovable** → connect that GitHub repo to the project so its agent pulls the latest. After
that, every change here is one `git push` away from Lovable.

## Backend
Catalog API is a Supabase edge function (`game-catalog`), managed via the Lovable agent. The game
reads the live library and records per-song best + career locally; competitive leaderboards arrive
with server-baked charts (future). The Supabase **anon** key in `index.html` is public-safe by design
(row-level security protects data).
