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

### 7. Film audio renditions (make more films *playable*, not just watchable)
**Context:** **30 of 142 films** have a `video_url` but **no decodable audio rendition**, so they're
**Watch-only** (they appear in AI Flixs and play as a video, but can't be charted into a playable rhythm level).
**Ask (optional):** generate an `audio_url` (a decodable, CORS-readable `.m4a`/`.mp3` — NOT an HLS `.m3u8`) for
those films and they automatically become playable levels. **Priority: P3.**

### 8. Landscape poster for films (`poster_url`)
A 16:9 `poster_url` on video rows makes the AI Flixs grid sharper (today it cover-crops the square artwork).
**Priority: P3.**

---

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
