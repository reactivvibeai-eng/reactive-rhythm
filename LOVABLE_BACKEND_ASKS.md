# Lovable backend asks — pre-release (send early; these unblock client work)

Four asks, in priority order. Each is additive and the game ships dark/stubbed until the field/endpoint
exists, so nothing breaks if these land later — but the corresponding features can't go live without them.

## 1. CORS-decodable per-video `audio_url` (unblocks the AI Flixs PLAYABLE level) — HIGH
For the **playable music-video level** (notes charted over the full-screen music video), the game must
**decode the video's audio** to build a chart. Today `trackAudioUrl()` refuses HLS/`.m3u8` (playback-only,
not decodable via WebAudio).
- **Ask:** for each video/music-video row, expose a direct **CORS-readable `audio_url`** (mp3/m4a/aac) —
  the same decodable format music tracks already have — alongside any `stream_url`.
- **Why:** WebAudio can only `decodeAudioData()` a real audio file. With it, we chart the video exactly
  like a song and play the muted video full-screen behind the highway. Without it, the playable level
  stays dark.

## 2. Poster / thumbnail field for video rows (unblocks the AI Flixs DISCOVERY section) — HIGH
The AI Flixs Browse section is poster-led (16:9 cinema grid), but video rows currently have no image.
- **Ask:** a `poster_url` (or `thumbnail_url`) per video row — a 16:9 still/key-art.
- **Why:** without it we fall back to the video's first frame (lower quality, needs extra fetch). A real
  poster makes the section look like a streaming app. The `videoCard()` renderer ships ready; we wire the
  field when it lands.

## 3. `/bonus-sparks/*` endpoints + server-side weekly earn cap (proper Sparks integration) — MED
Bonus Sparks (the platform-only, non-cashable, gameplay-earned currency) currently lives in `localStorage`
with the 50/week earn cap enforced client-side — a modded client could mint them.
- **Ask:** the planned `/bonus-sparks/*` endpoints (get balance, award, spend) **and** move the **50/week
  earn cap server-side** so the cap is authoritative.
- **Why:** the client is built against a stable swap-seam (load/save/award/spend BonusSparks) — flipping
  from localStorage to these endpoints is a seam swap, no redesign. Real money (Sparks) is already
  server-authoritative; this brings Bonus Sparks to the same integrity bar.

## 4. Golden Buzzer field — CONFIRM IT STAYS DEFERRED — (owner said WAIT)
The game already ships the Golden-Buzzer surfacing (gold ring/crown/tag + crowd cue), fully **dormant**
until a backend flag turns it on (see GOLDEN_BUZZER_BRIEF.md, field `golden_buzzer:boolean`).
- **Ask:** **no action needed this release** — confirm the field stays unset so the treatment stays dark.
  When you're ready post-launch, set `golden_buzzer=true` on chosen tracks and it lights up with no client
  redeploy.

---
**Summary for the backend owner:** #1 and #2 unblock the AI Flixs marquee feature; #3 hardens the Bonus
economy; #4 is a no-op confirmation. The game is built to degrade gracefully without all four, so ship
them when ready — but the AI Flixs *playable* level genuinely cannot work until #1 exists.
