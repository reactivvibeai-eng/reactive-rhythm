# Reactive Rhythm — Deploy Guide

A web-browser rhythm game that runs on **reactivvibe.com/play**, pulling from your
live licensed music catalog. One responsive codebase: **touch** on phones,
**keyboard / MIDI / game-controller** on desktop.

---

## 1. Files to deploy

Copy these to your site so they're served together under `/play`:

```
play/
├── index.html          ← rename "Rhythm Rift.html" to index.html
├── game.js
├── catalog.js
├── jukebox.js
├── jukebox.css
└── assets/             ← the whole folder (art, moon video, audio, sprites)
```

That's the entire game. No build step — they're static files.

---

## 2. Serve it at /play (same origin)

It **must** be same-origin with the main site (`reactivvibe.com/play`) so:
- the Supabase **login session is shared** (scores save automatically), and
- audio **autoplay permissions** carry over.

In Lovable, add a route/page at `/play` that serves these static files (or an
iframe pointing at a same-origin `/play/index.html`).

---

## 3. Keeping it updated (GitHub auto-deploy)

To avoid copying files by hand every update:
1. Connect your Lovable project to a **GitHub repo** (Lovable Settings → GitHub).
2. Put these game files in that repo under `/public/play/` (or wherever your
   static assets live).
3. From then on, pushing a change to the repo redeploys the site automatically —
   no manual file drops.

Until GitHub is connected, updates are a manual copy of the files above.

---

## 4. Launch / embed contract

- `…/play` — opens the song browser (jukebox).
- `…/play?trackId=<uuid>` — deep-links straight into that song.
- `…/play?pack=<uuid>` — sets the **pack context** for revenue attribution
  (sent as `pack_id` on every play/use; `null` = freeplay).
- `…/play?mock=1` — loads a 1000-song demo catalog (for testing scale only).

---

## 5. Backend it talks to (already live)

`https://bxiejoktoknybpraxebm.supabase.co/functions/v1/game-catalog`

- `GET /tracks` and `GET /track/:id` — licensed catalog (game_dev_opt_ins.enabled),
  returns `chart`, `stream_url`/`wav_url`, `play_token`, `pack_ids[]`, `mood`,
  `artist_name`, `artist_credit_name`, `artwork_url`.
- `POST /plays` — scored plays (includes `pack_id` for 50/50 reconciliation).
- `POST /uses` — non-scored events (`preview`, `loaded`, …).
- `GET /leaderboard/:track_id`.

Auth: Supabase (email + Google), shared session at same-origin `/play`.

---

## 6. Input methods

| Device | Platform | Notes |
|---|---|---|
| **Touch** (tap lanes) | Mobile | Primary mobile control |
| **Keyboard** (A S D · J K L) | Desktop | 6 lanes |
| **MIDI** (keyboard / MIDI guitar / e-drums) | Desktop Chrome/Edge | Auto-detects plugged-in devices |
| **Game controller** (Guitar-Hero style) | Desktop | Buttons 1–6 → lanes |

Real acoustic-guitar pitch detection is **not** included (future R&D).

---

## 7. Responsive — one codebase, two layouts

The game detects viewport width:
- **≤ 900px** → mobile: portrait, full-screen highway, touch tap-zones, top-bar controls.
- **> 900px** → desktop: wider playfield, keyboard/MIDI/controller input.

No separate desktop build — the same files adapt automatically.
