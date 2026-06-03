# Rhythm Rift × ReactivVibe — Integration Handoff

Everything the backend needs to wire the game to the radio catalog. Three files:

| File | Purpose |
|---|---|
| `chart_v1.schema.json` | Exact shape of `radio_tracks.chart_v1` |
| `generate-chart.ts` | Deno edge function — ports the browser analyzer server-side |
| `game_scores.sql` | Migration: chart columns + `game_scores` + leaderboard view |

---

## TL;DR decisions (answers to your 3 questions)

1. **Chart shape** → one **lane-agnostic** `chart_v1` (onset times + strength). The
   game derives easy/normal/hard at runtime. No per-difficulty charts in the DB.
2. **Score payload** → keep every play row; best = highest `score` per
   `(track_id, difficulty)`. Columns + leaderboard view in `game_scores.sql`.
3. **Difficulty** → derived client-side from the single chart (see "Lane mapping").

---

## Why lane-agnostic

The chart stores only **when** a hit happens and **how strong** it is. The game
turns that into lanes + difficulty deterministically, so:

- analyze each track **once** (cheap backfill over thousands of tracks),
- charts stay ~6–10 KB,
- difficulty curves can be re-tuned later **without re-analyzing anything**.

### Deterministic lane mapping (client-side, frozen)
For each onset `i` at time `t` with strength `s`, lane = `floor(t*8.97 + s*3.1 + i*1.7) % 4`,
then nudged forward if it collides with either of the previous two lanes. This is
pure/deterministic → every player gets the identical chart for a track, and it
matches the current standalone build. **Do not replicate this server-side** — it
lives in the game client; the DB only holds onsets.

### Difficulty derivation (client-side)
- **Drift (easy):** keep strongest ~55% of onsets, slow approach, wide hit window.
- **Pulse (normal):** ~85% of onsets.
- **Fracture (hard):** all onsets, fast approach, tight window.
Filtering keys off `s` (strength) so easy modes keep the musically-important kicks.

---

## Chart generation pipeline

1. **Hook:** in the admin "promote to radio_tracks" step, `POST` the new `track_id`
   to `…/functions/v1/generate-chart`.
2. **Backfill:** loop existing `radio_tracks where chart_status='none'`, POST each
   id, concurrency ~3. Sets `chart_status` pending→ready/failed.
3. **Audio source priority** (best onset detection first):
   `download_wav_url` (lossless, exact)  →  Mux `…/audio.m4a` rendition.

> ⚠️ **Deno Deploy has no Web Audio API / ffmpeg.** The function decodes WAV in
> pure JS (exact) and mp3 via wasm. **m4a/aac decode is unreliable in pure JS** —
> for tracks with no WAV, either have Mux emit an **mp3 static rendition**, or
> route those stragglers to a tiny **Node + Playwright** worker that runs the real
> `OfflineAudioContext` (byte-identical to the browser). The DSP math
> (200 Hz RBJ low-pass → 23 ms RMS → 1.45× local-mean peak picking) is identical
> across all three paths.

---

## Embed contract (`/play?trackId=xxx`, iframe)

Game boot sequence inside the iframe:

```
1. read trackId from URL
2. GET /game-catalog/track/:id   (Bearer GAME_DEV_API_KEY)
   → { stream_url(.m3u8), analysis_url, wav_url, chart, chart_status, title, artist_name, artwork_url, duration_seconds }
3. if chart_status !== 'ready'  -> show "Chart baking… try again shortly"
4. PLAYBACK: <audio> + hls.js on stream_url (HLS). decodeAudioData is NOT used at
   play time anymore — the chart is already baked, so we just stream + schedule notes.
5. on finish: POST /game-catalog/score  (see payload below)
```

Two playback notes:
- **Timing master clock** = `audio.currentTime` from the HLS `<audio>` element
  (not AudioContext, since we're streaming not buffering). Notes schedule against it.
- Mux HLS needs `hls.js` on non-Safari browsers; Safari plays `.m3u8` natively.

---

## Score submit payload

`POST /game-catalog/score` (RLS lets a user insert only their own row):

```json
{
  "track_id": "uuid",
  "difficulty": "normal",
  "score": 184250,
  "accuracy": 96.4,
  "max_combo": 312,
  "grade": "S",
  "full_combo": false,
  "perfect_count": 380,
  "great_count": 22,
  "good_count": 8,
  "miss_count": 4,
  "notes_total": 414,
  "chart_version": 1,
  "client_meta": { "app_version": "0.4.1", "mods": [] }
}
```
`user_id` is taken from the auth session server-side — never trust it from the client.

---

## Catalog endpoints (your spec, confirmed good)

```
GET /game-catalog/track/:id
GET /game-catalog/tracks?random=1&genre=lofi&limit=20   // list: id,title,artist_name,genre,artwork_url,has_chart
```
For the in-game track picker, filter `has_chart = (chart_status='ready')` so players
never land on an unbaked track.

---

## Open product choices (not blocking — pick when ready)

- **Picker UX:** Radio Roulette (random + prefetch next) vs. genre playlists vs.
  Daily Drop. The game's menu can host any of these against the `/tracks` endpoint.
- **Per-track leaderboards** are the growth lever: every artist's song page gets a
  "Play & compete" button → artists share the link → fans play their track.
- **Anti-cheat:** `notes_total` must match `chart.onsets.length` (post-difficulty);
  reject impossible accuracy/score combos at the edge function before insert.
