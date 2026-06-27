# Reactive Rhythm — outstanding Lovable items (single hand-off)

The game (served at `reactivvibeai.com/game`) is current on `main`. Everything below is BACKEND/platform work only —
the game already calls every route and reads every field. Ordered by priority. **#1 unblocks revenue.**

All authed routes: accept the game's Supabase JWT (same-origin localStorage key `sb-bxiejoktoknybpraxebm-auth-token`)
and send CORS for the game origin allowing the `authorization` header. (You confirmed CORS `*` + same-origin JWT — good.)

---

## 🔴 1. STORE ITEM REGISTRY — the only thing blocking purchases (REVENUE)
Your 4 store routes are LIVE (`/store`, `/sparks/spend`, `/sparks/balance`, `/entitlements`) — confirmed. **But the
spend registry holds the wrong items** (`starter_pack`, `boss_neon`, `theme_neon`), so a real purchase hits
`/sparks/spend` with an `item_id` the RPC doesn't know → **`404 item_not_found` → buy fails.** Register the items the
game ACTUALLY sells (item_id = the underscore form the game posts), and drop the 3 placeholders (`boss_neon`/`theme_neon`
were removed from the game as never-built; `starter_pack` doesn't exist in-game).

**Skins — `item_type:"skin"`, 50 ✦ each:** `violet_gothic`, `bone_daddy`, `melody_pink`, `crimson_fox`, `crimson_tarot`,
`clockwork`, `shaman_wolf`
**Skins — `item_type:"skin"`, 80 ✦ each:** `alarm_clock`, `sasoka`, `pirate_fox`, `deadkin`, `shorty_skin`, `razor`,
`wormfeast`, `kitsune`, `triemrys`
**Levels — `item_type:"level"`:** `high_seas` = **140 ✦**, `shorty_x` = **120 ✦**, `melody_boss` = **100 ✦**
**Free (grant on request, no charge):** `celines_razor` (skin)

- `/sparks/spend {item_type,item_id,idempotency_key}` → debit `user_sparks` (the same ledger the `/sparks` top-up
  credits) + grant the entitlement. `idempotency_key` must dedupe a retried charge.
- `/entitlements` must then return these same `{item_type,item_id}` (underscore) so owned items show "Owned/Equip" and the
  `high_seas`/`shorty_x` LEVEL entitlements unlock those premium levels in campaign + MP.
- `/store` should list these items too (the game also has its own catalog, but matching `/store` keeps prices in sync).

**Test:** sign in → buy a 50 ✦ skin → 50 Sparks deducted, guitar equips, shows "Owned" on reload, no double-charge on retry.

---

## 🔴 2. LEADERBOARDS — currently return `[]` (so the game shows mock/preview ranks)
- **`POST /plays`** (authed) → validate JWT, upsert a per-`(user_id, track_id, difficulty)` **best** row, return
  `{ play_id, rank_global }`. Key on the authenticated `user_id`, not the anon key.
- **`GET /leaderboard/global?limit=N`** + **`GET /leaderboard/:id?difficulty=&limit=N`** → real ranked rows
  `{ rank, display_name, score, accuracy(0..1), grade }` across users; include the caller's own row (or `you:true`).
  Distinct per-user scores → distinct ranks (fixes "two testers, same rank"). The game drops its mock seed the moment
  these return data.
- **Multiplayer:** persist + pair `POST /mp/round/settle` by `round_id` (re-judge `client_score` = anti-cheat), then add
  **`GET /mp/leaderboard?limit=N`** → `{ rank, player_name, points, wins, losses, draws, streak }` + a "me" row.

---

## 🔴 3. CONTENT-REVIEW HOOK — host/admin "Play in Reactive Rhythm"
Game side is DONE (reads `?review=`, opens the song card with difficulty + level pickers, charts it, run is un-scored).
You provide:
1. The host's **"Play in Reactive Rhythm"** button mints a short-lived **signed token** and opens
   `https://reactivvibeai.com/game?review=<token>`.
2. **`GET /review/resolve?token=<token>`** (authed; **only review-host/admin accounts** may resolve — 403 otherwise, 401
   if expired) → `{ track_id, title, artist_name, artwork_url, genre, duration_seconds, analysis_url, stream_url }`.
   `analysis_url` must be a **CORS-readable, decodable** `.m4a`/`.mp3` (NOT `.m3u8`) — that's what the game charts; HLS-only
   falls back to a Watch preview.

---

## 🟠 4. AI FLIXS — decodable audio rendition (also helps MP stability)
~31 of 143 films are HLS-only (`.m3u8`), so they can't chart in-browser → they show "Watch" not "Play", AND if one is
rolled as an MP tournament track it can't start. Ship a **CORS-readable `audio.m4a` rendition** (Mux) per film and expose
it as `audio_url`/`analysis_url`. Then every film becomes a playable level and MP can use any track safely.

---

## 🟠 5. TELEMETRY — so launch isn't blind
Stand up **`POST /clientlog`** (errors) + **`POST /events`** (funnel) and set `TELEMETRY_BASE` in the game's
`RHYTHM_CONFIG`. The consent-gated client is already built (buffers locally, flushes once the base is set).

---

## 🟢 6. COMMISSION PAGE COPY
Replace the thin `/commission` page copy with `COMMISSION_VALUE_SHEET.md` (in this repo) — the detailed $59.95
"what you get" breakdown (1080p cinematic level world, custom charting, branding) that makes the price read as a deal.

---

### Confirmed already wired (no action) — for your reference
Same-origin static `/game` (no iframe) → the game's `getToken()` reads the site's Supabase JWT; CORS `*` + `authorization`
allowed; `/sparks` top-up page exists (`?need=`, `?return=`, Stripe → `process_spark_purchase` → credits `user_sparks`).
