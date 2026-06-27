# Reactive Rhythm — Lovable backend handoff (ONE-SWOOP launch checklist)

**Date:** 2026-06-26 · **Game build:** `?v=355` (branch `visual-overhaul`)
**Purpose:** the single hand-off the owner gives Lovable when `/play` deploys tonight. Each item says
**what to build**, **why it matters**, **priority**, and which detailed brief has the full spec. The game
CLIENT for every item below is already built and waiting — it deep-links / reads the field / fires the event
the moment the backend exists. Nothing here requires a game-code change.

Catalog API base (live, anon-read OK): `https://bxiejoktoknybpraxebm.supabase.co/functions/v1/game-catalog`

---

## 🔴 LAUNCH-BLOCKING for *paid* revenue (do these to actually take money)

### 1. Sparks top-up → credit loop  (the revenue enabler)
**Build:** a sign-in-gated **top-up page on reactivvibeai.com** → Stripe Checkout → a **signed, idempotent,
deduped webhook** → credit the user's **server-authoritative Sparks balance**.
**Why:** today the in-game "Get Sparks" button deep-links to this page and it doesn't exist yet — so there is
**no way for anyone to buy Sparks** (audit P-02). Sparks = real money (~$0.05 each). Without this, cashable
revenue is **$0**. The game already: deep-links out, and **re-reads the balance on return** (no client change).
**Spec:** `LOVABLE_PAYMENT_BRIEF.md`. **Priority: P0 for paid SKUs.**

### 2. Purchase + entitlement recording  (server-authoritative ownership)
**Build:** when a user spends Sparks on a skin/level, **record the purchase + grant the entitlement
server-side**, idempotently (a retry must never double-charge). Expose owned entitlements so the game's
`ownsItem(item_type, item_id)` reads them.
**Why:** the game now **gates paid guitar skins on ownership** (audit P-01 — we closed a leak where every paid
skin equipped free). Paid levels gate the same way. Without server-side entitlements, a purchase doesn't stick
across devices and the client can't be trusted. The spend flow UI is built but **unproven end-to-end** (P-12).
**Ask:** confirm `ownsItem`'s entitlement shape `{item_type, item_id}` and run **one live
purchase → spend → entitlement round-trip** before paid SKUs go public. **Priority: P0 for paid SKUs.**

> If the top-up page + purchase recording are **not** ready tonight: keep the launch **free-to-play** and the
> owner should hold paid SKUs (the game already shows them as locked/aspirational, which is harmless — clicking
> a locked skin routes to the Store, clicking a locked paid level routes to the Store; neither charges anything).

---

## 🟠 STRONGLY WANTED before a public launch (data + integrity)

### 3. Telemetry endpoints  (so the beta isn't blind)
**Build:** `POST /clientlog` (errors) + `POST /events` (funnel) and set `TELEMETRY_BASE` in `RHYTHM_CONFIG`.
**Why:** the consent-gated telemetry **client is already built**; without the endpoints we launch with **no
crash rate and no load→pick→first-note→finish funnel**. Day-one data is how we tune.
**Spec:** `TELEMETRY_BACKEND_BRIEF.md`. **Priority: P1.**

### 4. Video catalog data-quality (`is_video` / `media_type` / `video_url`)
**Status:** ✅ the columns now ship (`is_video`, `media_type`, `video_url`) — good. The game reads them
authoritatively. **142 of 1179 tracks** are flagged as video and now all appear in AI Flixs (we fixed a client
bug that was hiding 30 of them).
**Ask:** a **data audit** — make sure **every music-video row** has `is_video = true` (and `media_type='video'`
+ a `video_url`). Example found during QA: the artist **"After Eve"** has **7** rows flagged video, but the
owner believes there are more — the extras are currently tagged as **audio** and so show up as songs, not films.
Re-tag any mis-classified videos. **Priority: P1 (content correctness on a promoted feature).**

### 5. Protect anonymous write endpoints
**Build:** rate-limit / guard `POST /plays`, `POST /score`, `POST /uses` (the anon key is reachable client-side).
**Why:** before `/play` is public, these are spammable. **Priority: P1.**

---

## 🟡 GATES THE COMPETITIVE FEATURES (not the free launch)

### 6. Server-authoritative score re-judge  (unlocks the public leaderboard)
**Build:** recompute + clamp `/score` server-side using the single-use `play_token` it already carries.
**Why:** a modded client could top the global leaderboard. Gates the **public leaderboard GA** (the local/
seeded ladder is fine for launch). **Spec:** `MP_SERVER_SCORING_BRIEF.md`. **Priority: P2.**

---

## 🟢 NICE-TO-HAVE (quality, not launch)

### 7. Film audio renditions — the ONLY way to make every film a PLAYABLE level (owner priority)
**Context:** **31 of 143 films are HLS-only** — their only source is a Mux `.m3u8` stream (`stream.mux.com/….m3u8`),
which a browser **cannot decode** for charting. So those 31 are **Watch-only** in AI Flixs (they appear + play as a
video, but can't become a playable rhythm level). The other **112 films have a decodable audio rendition** (Mux
`audio.m4a`) and ARE fully playable. The game already lists all 143 and cleanly shows Play (chartable) vs Watch
(HLS-only) — the gap is purely the missing audio renditions.
**Ask (now P1 — the owner: "lots of content is uploaded daily, make sure this system works"):** configure the **Mux
ingest pipeline to ALWAYS generate a decodable, CORS-readable audio-only rendition** (`.m4a`/`.mp3`, NOT `.m3u8`) for
**every** film, and expose it as `audio_url` on the track row. Backfill the existing 31. Then every film — today's and
every future daily upload — **auto-becomes a playable level** with zero game-side changes (the engine already charts
from `audio_url`). Without this, daily-uploaded films stay Watch-only. **Priority: P1.**

### 8. Landscape poster for films (`poster_url`)
A 16:9 `poster_url` on video rows makes the AI Flixs grid sharper (today it cover-crops the square artwork).
**Priority: P3.**

---

## 🔵 INTEGRATION — Host "Play in Reactive Rhythm" review hook (owner flagged)

**Context:** on the platform, hosts review songs/videos; a **"Play in Reactive Rhythm"** button sends a
not-yet-approved track to the game to be **played live + judged on the spot**. It works on the website today; the
owner wants the game + backend **ready to handle it cleanly** so it's not a last-minute scramble.

**Game side — already 90% there:** the engine can chart + play any track from a decodable `audio_url` via
`RhythmGame.playUrl(url, meta)` / the `?trackId=` deep link, with NO server chart required. What's missing is a
defined, secure HANDOFF from the website to the game. Decide ONE mechanism with Lovable:
- **(a) URL hand-off** — the host button opens `reactivvibe.com/play?review=<decodable_audio_url>&title=...&artist=...&token=<signed>`.
  The game reads it on boot → `playUrl`. Simplest; works cross-tab. (A tiny client reader is the only game-side add.)
- **(b) postMessage** — if the game is embedded in the review page, `window.postMessage({type:'rr-review-play', audioUrl, meta, token})`.

**Backend asks for this hook:**
1. **A signed, short-lived `token`** so an UNAPPROVED track is only playable by the reviewing host — not exposed
   publicly via a guessable URL. The game forwards the token; the audio fetch (or a `/review/:id` resolve) validates it.
2. **A decodable `audio_url`** for the under-review track (non-HLS `.m4a`/`.mp3`, CORS-readable) — same requirement
   as the catalog. (HLS-only → the game can only *watch*, not chart.)
3. **(optional) result callback** — `POST /review/:id/result { score, grade, accuracy }` so the host's moderation
   screen can see how it judged. The game already computes all of this at song end.

**Priority: P2** (not a launch blocker for public free play, but spec it now so the integration is a config change,
not a rebuild). Tell me which mechanism (a/b) you pick and I'll wire the ~20-line game-side reader.

## Quick reference — what the CLIENT already does (no backend change needed)
- Reads `media_type` / `is_video` / `video_url` authoritatively; lists every watchable film.
- Gates paid skins + levels on `ownsItem` entitlements; locked → routes to Store.
- Deep-links "Get Sparks" to the website top-up and re-reads the balance on return.
- Buffers consent-gated telemetry locally and flushes to `TELEMETRY_BASE` once it's set.
- Carries a single-use `play_token` on `/score`.

**One-line summary for Lovable:** *Build the Sparks top-up→webhook→credit loop and server-side purchase/
entitlement recording (P0 for paid), stand up the two telemetry endpoints + set TELEMETRY_BASE (P1), audit the
is_video tagging so all music-videos are flagged (P1), and rate-limit the anon write endpoints (P1). Everything
else is already wired on the game side.*
