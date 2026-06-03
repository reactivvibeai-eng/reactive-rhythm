# Connect the ReactivVibe library to the Rhythm Game — implementation spec

**Goal:** make `/play` show and play **real tracks from the ReactivVibe catalog** (real
cover art, real audio from Mux), with **new uploads appearing automatically**, instead of
the demo/mock list it shows today.

**Status:** the game's catalog layer is **already built and scale-ready** (it pages the whole
library, streams Mux HLS, renders artwork, submits scores + leaderboards, and auto-refreshes
for new uploads). It is silently falling back to a 1,000-song mock because the data feed
errors:

```
GET …/functions/v1/game-catalog/tracks  →  500
"Could not find a relationship between 'radio_tracks' and 'game_dev_opt_ins' in the schema cache"
```

So this is **one missing data feed**, not a rebuild. There are two ways to deliver it. **Do
the FAST PATH first** — it can ship real music in ~an hour and needs no chart pipeline.

---

## ⚡ FAST PATH — a track feed + in-browser charts (ship real music now)

The game can generate the note-chart **in the browser** at load time (a few seconds per
song), so you do **not** need a server chart pipeline to start. Give it a list of eligible
tracks and it plays them.

### Easiest option: a static JSON (no edge-function fix needed)
If fixing the `game-catalog` function is slow, **skip it.** Run one query for game-eligible
tracks and write the result to a static file the game can fetch (e.g.
`https://<your-host>/game-tracks.json`, regenerated on a schedule or on upload). Shape:

```json
[
  {
    "id": "uuid",
    "title": "Lunar Waves",
    "artist_name": "Kunin Kitsune",
    "genre": "Synthwave",
    "bpm": 120,
    "duration_seconds": 184,
    "artwork_url": "https://.../cover.jpg",
    "created_at": "2026-05-30T12:00:00Z",
    "play_count": 1234,
    "featured": true,
    "chart_status": "ready",
    "stream_url": "https://stream.mux.com/<PLAYBACK_ID>.m3u8",
    "audio_url":  "https://stream.mux.com/<PLAYBACK_ID>/audio.m4a"
  }
]
```

Field notes:
- **`stream_url`** = Mux **HLS** manifest (`…/<PLAYBACK_ID>.m3u8`) — used for *playback*. The
  game already plays HLS. A direct mp3/m4a/wav also works.
- **`audio_url`** = a **direct, downloadable** audio file (mp3 / m4a / wav) **with CORS
  allowed** (`Access-Control-Allow-Origin`) — used for *in-browser chart analysis* only.
  Mux can emit a static MP3/M4A rendition; point this at it. **This is the one field people
  forget — without a CORS-readable file the browser can't analyze the song.** (If you can
  only provide HLS, send `bpm` and the game falls back to a beat-grid chart.)
- **`chart_status: "ready"`** — the game only lists tracks marked ready. (In the fast path,
  "ready" just means "has playable audio".)
- Only include tracks the artist **opted into the game** (your `game_dev_opt_ins` gate) —
  resolve that server-side and return the allowed list. This sidesteps the broken join.

Tell me the JSON URL (or hand me the file) and I wire the game to it. New uploads appear the
moment they're added to that feed.

---

## 🏁 SCALE PATH — pre-baked charts + real leaderboards (next, additive)

Once the loop works, pre-bake charts so songs load instantly and leaderboards are
competition-grade. **No game changes** — the engine prefers a pre-baked chart when present
and falls back to in-browser otherwise.

1. **Fix the feed properly** (so it's live, not a static file): add the FK relationship
   between `radio_tracks` and `game_dev_opt_ins`, OR rewrite the `game-catalog` query to not
   rely on the embedded PostgREST join, OR reload the PostgREST schema cache.
2. **Generate charts**: run the provided Deno function (`design-source/integration/
   generate-chart.ts`) over each eligible track → produces `chart_v1` (onset times); store it;
   set `chart_status='ready'`. **Trigger it on new upload** so fresh tracks auto-bake.
3. Backfill existing tracks.

---

## Exact contract the game consumes (already built — match these)

Config: `index.html` → `window.RHYTHM_CONFIG` (`API_BASE` + Supabase URL + anon key).

- **`GET /game-catalog/tracks?limit=&offset=`** → array of:
  `id, title, artist_name, genre, artwork_url, bpm, duration_seconds, created_at,
  play_count, featured, chart_status` (game lists only `chart_status === "ready"`; it pages
  in chunks of 200 up to the whole library).
- **`GET /game-catalog/track/:id`** → one track with the playable detail:
  `title, artist_name, artist_credit_name, genre, artwork_url, duration_seconds,
  chart_status, chart: { beats:[…], duration }, play_token,` and an audio source —
  `stream_url` (HLS .m3u8 **or** direct file) | `wav_url` | `analysis_url`.
  - In the **fast path** you can omit `chart` and the game charts in-browser from `audio_url`
    (or a bpm grid).
- **`POST /game-catalog/plays`** → score submit (uses single-use `play_token` for anti-cheat).
- **`POST /game-catalog/uses`** → analytics (preview / loaded / skipped …).
- **`GET /game-catalog/leaderboard/:track_id?difficulty=&limit=`** → top scores.

Auth: same Supabase session, same-origin at `/play` (scores save automatically when signed in;
anonymous play still works, just unscored).

---

## TL;DR for the agent
1. **Now:** return a list of game-eligible tracks as `{id, title, artist_name, genre, bpm,
   duration_seconds, artwork_url, created_at, play_count, featured, chart_status:"ready",
   stream_url (HLS), audio_url (CORS-readable mp3/m4a)}` — via a **static JSON** if that's
   faster than fixing the function. → real songs play immediately, in-browser charts.
2. **Next:** fix the `radio_tracks ↔ game_dev_opt_ins` relationship so it's a live endpoint,
   then run `generate-chart.ts` on upload to pre-bake charts (instant load + leaderboards).
3. **Send me the feed URL (or JSON)** and I connect it — zero UI changes needed.
