# Reactive Rhythm → reactivvibeai.com/game — MASTER LOVABLE PROMPT

> **Hand this whole file to the Lovable agent.** It is the single source of truth for taking the game live at
> **`reactivvibeai.com/game`** and wiring every backend system (payments, economy, multiplayer, AI Flixs, custom
> levels, telemetry). The deep specs live in the sibling `*_BRIEF.md` files in this same repo — this prompt is the
> index + the integration plan; each section says which brief has the full detail.

**Decisions already made by the owner (do not re-ask):**
- **URL:** the game lives at **`reactivvibeai.com/game`** (NOT `reactivvibe.com/play` — ignore any older `/play` refs).
- **Code source:** pull this **public GitHub repo** (`reactivvibeai-eng/reactive-rhythm`, branch `main`).
- **Payments:** Stripe is **already connected** on reactivvibeai.com — wire to the existing account.
- **Rollout:** **everything at once** — payments, economy, multiplayer, AI Flixs renditions, custom levels all live together.

The game is **static HTML/CSS/vanilla-JS + Canvas 2D — no build step, no framework.** It is fully self-contained and
already wired to read every backend field / fire every event / deep-link out the moment the backend exists. **No
game-code rewrite is needed** — your job is (1) serve it at `/game` and (2) stand up the backend it already expects.

---

## 0. DEPLOY — serve the game at `reactivvibeai.com/game`

**Deployable file set** (everything else is dev-only):
`index.html`, `game.js`, `catalog.js`, `jukebox.js`, `jukebox.css`, `multiplayer.js`, `couch.js`, `procbg.js`,
`share.js`, `telemetry.js`, and **`assets/`**.
**Do NOT deploy:** `serve.py`, `launch-game.bat`, `design-source/`, any `*.md` (briefs/changelog), `*.py` tooling.

**Mount — DECIDED: static route, NO React shell, NO iframe (option (a)).** Serve the files at **`/game` and `/game/*`**
as a SPA-bypass static route (the game is the top document — it owns the canvas, fullscreen, and keyboard capture; an
iframe shell just adds focus/sizing friction for zero benefit). It's same-origin with the React app, so the user's
Supabase session (in `localStorage`) carries automatically — sign-in "just works." All in-game asset references are
**relative** (`assets/…`, `game.js?v=NN`, …), so they resolve under the `/game/` base with zero rewrite.

**Getting the files in — DECIDED: sync from this public repo (don't paste/zip).** The churning surface is 10 code/CSS
files; assets are a one-time import. Use **`deploy/sync-game.mjs`** (in this repo) as a prebuild step in your repo
(`"prebuild": "node scripts/sync-game.mjs"`) — it fetches the 10 files from
`raw.githubusercontent.com/reactivvibeai-eng/reactive-rhythm/main/…` into `public/game/`. **Verified 2026-06-27: every
URL returns 200, `main` HEAD = `9241c72`.** This means the two remaining game-side fast-follows (wager-escrow wiring +
the pre-public dev-hook strip) **auto-roll-out on your next build** — no re-coordination. **Assets** are a one-time
import (grab the repo tarball `codeload.github.com/reactivvibeai-eng/reactive-rhythm/tar.gz/refs/heads/main`): light
assets → `public/game/assets/`; the heavy `assets/levels/*.mp4` (~1 GB) → **Supabase Storage** — the game references
them by the **relative** path `assets/levels/<name>.mp4` (55 refs, all in index.html), so map `/game/assets/levels/*`
→ the Storage bucket and the game resolves them with **zero code change**.

**⚠️ Heavy media decision (`assets/` is ~1.1 GB, mostly traveling-level `.mp4` videos):**
- The light assets (guitar art, note PNGs, covers, SFX, the moon-loop backdrop) are small and belong in the deploy.
- The **bulk is `assets/levels/*.mp4`** (per-level journey loops/travels/cutaways for Alarm Clock Hero, Deadkin,
  Sasoka, Shorty-X, Triemrys, etc.). **Strongly recommended:** host those on **Supabase Storage** (the same project
  that already serves the AI Flix videos + posters) and serve them from there, rather than shipping ~1 GB in every
  static deploy. The game already loads remote media by URL for AI Flixs, so this is the proven pattern. (The owner
  will confirm whether to ship the full repo as-is or move `assets/levels/` media to Storage — coordinate on this.)

**`window.RHYTHM_CONFIG`** (top of `index.html`, ~line 5780) is where all backend wiring is read. Today it holds the
Supabase URL + anon key + catalog API base. **You will add** `TELEMETRY_BASE`, the site URLs, and any Stripe/public
keys here (see each section). Bump the `?v=NN` cache-bust query on `index.html`'s local JS/CSS refs after any edit.

---

## 1. 🔴 PAYMENTS + ECONOMY (Sparks) — the revenue core  · brief: `LOVABLE_PAYMENT_BRIEF.md`

Two currencies (do not blur them):
- **Sparks** = real money (~**$0.05** each), **bought** on the site. Spend on guitar skins + levels.
- **Bonus Sparks** = **earned by play**, **NON-cashable**, cosmetics-only, hard-capped ~50/ISO-week. **Never minted by
  `/score` or `/plays`** — this is the legal / anti-fraud guardrail. Do not let play create cashable Sparks, ever.

**Build (Stripe already connected):**
1. **Sparks top-up → credit loop:** a sign-in-gated top-up page → **Stripe Checkout** → a **signed, idempotent, deduped
   webhook** → credit the user's **server-authoritative Sparks balance**. The game's "Get Sparks" button already
   deep-links here and **re-reads the balance on return** (no game change). The insufficient-Sparks CTA already passes
   `&need=<price>` so you can pre-select the smallest covering pack. Suggested packs (owner to confirm): **$5 / $10 /
   $20 / $50** with a small bulk bonus.
2. **Purchase + entitlement recording (server-authoritative):** on spend, **debit Sparks + grant the entitlement
   atomically + idempotently** (a retry must never double-charge). Expose owned entitlements so the game's
   `ownsItem(item_type, item_id)` reads them. Shape: `{item_type, item_id}`. The game **gates paid skins + levels on
   ownership** (locked → routes to Store) and re-fetches entitlements on top-up return — both already built.
3. **Endpoints the game already calls** (`game-catalog` function base, anon-read OK): `getSparks`/`spendSparks`
   (`/sparks/balance`, `/sparks/spend`), `getEntitlements` (`/entitlements`). Re-read price server-side on spend; never
   trust the client. Full request/response shapes + the spend-flow diagram are in `LOVABLE_PAYMENT_BRIEF.md`.
4. **Bonus Sparks EARNING — WIRED to your shipped contract + LIVE (`BONUS_SERVER:true`, build100j).** Flow: every
   scored run POSTs `/score` (or `/plays`) → you return `{ id, play_id, rank_global }` → the game POSTs
   `/bonus-sparks/earn { play_id, daily_rift }` → you return `{ balance, earned, capped, grade, full_combo, reason }`
   and the game paints "+N BONUS SPARKS" + caches the balance. The game **reads `/bonus-sparks/balance` for the
   authoritative balance when signed in** and falls back to a capped LOCAL mint only when signed-out / the flag is off.
   Confirmed scale **S=4 · A=3 · B=2 · C=1 · D=0, +1 full-combo** (max 5/run, 15 under a validated Daily Rift), the
   50/ISO-week cap + the per-run idempotency all live on your side. **Spend is server-authoritative too:** the in-game
   store now `await`s `/bonus-sparks/spend { item_type, item_id, amount }` for signed-in users (so the balance actually
   drops). Bonus stays **NON-cashable**.
   - ⚠️ **ONE open gap — wager escrow/credit:** the in-game Bonus-**wager** tournaments (entry-fee pools + side-bets) are
     a LOCAL stand-in with no backend, so they can't debit/credit the server balance. The game now **gates signed-in
     Bonus wagers** (`error:'bonus_wager_server_pending'`) until you ship a wager **escrow + credit** path (a pot that
     holds buy-ins, pays the champion, refunds on cancel). Signed-out users keep the local wager economy. Lowest-priority
     of the economy work — flag when you want to tackle it and I'll wire the game side.

Economy tuning + conversion rationale (pack sizing, the in-game acquisition funnel) is in `REVENUE_ROADMAP.md`.

---

## 2. 🔴 CUSTOM LEVEL COMMISSION — $59.95 UGC purchase → admin queue  · brief: `LOVABLE_CUSTOM_LEVEL_BRIEF.md`

A sign-in-gated **"Commission a Custom Level"** flow (page on reactivvibeai.com; the game deep-links to it):
- **Upload up to 5 reference images** *(owner revised this down from the brief's "10" — use **5**)* — jpg/png/webp,
  ≤10 MB each, drag/drop, removable thumbnails. These are the mood/character/brand references the owner builds from.
- **Structured description form** (not a blank box): title idea · song/artist (or "surprise me") · mood/genre ·
  character(s)/theme · setting · specific moments/"drops" · difficulty vibe · off-limits · extra notes.
- **Transparent "what you get"** shown BEFORE the buy button (a charted playable level of your song + a cinematic
  level world from your refs + reactive combo/Overdrive moments + branding/title card; state a realistic ETA). The
  point: make the value + the work obvious so $59.95 converts. Itemize it — see the brief for the exact list.
- **Buy — $59.95 via Stripe Checkout (one-time).**
- **On the SIGNED, deduped webhook** (charge first, deliver-to-admin on the webhook — never the client redirect):
  write a **submission record to an admin-only "Custom Level Requests" queue**:
  `{ submission_id, buyer_user_id, buyer_email, created_at, amount_paid, stripe_payment_id, status:'paid',
     title_idea, song_or_artist, mood, theme, setting, requested_moments, difficulty, off_limits, extra_notes,
     reference_images:[signed URLs ×≤5] }`.
  Surface it in **admin controls** (newest-first list, the images, the fields, payment confirmation, a status the owner
  advances: paid → in-progress → delivered) + **notify the owner** on each new paid submission. Keep ref images in
  private storage with signed, owner-only URLs. Validate uploads server-side (type/size/count, strip EXIF).
- **Game-side hook (~10 lines, I wire it once you give me the URL):** a "Commission a Custom Level" card in the Store
  deep-links to `reactivvibeai.com/commission` (or your URL). Nothing to sync back on return — it's a fulfillment flow.

---

## 3. 🔴 MULTIPLAYER — make it work end-to-end  · brief: `MP_SERVER_SCORING_BRIEF.md`

The MP client is fully built (open lobby, rooms, Quick Match, tournaments/brackets, combat mode, local versus). It runs
on **Supabase Realtime** (broadcast + a soft-presence heartbeat) using the project in `RHYTHM_CONFIG`. To make it work
live + competitive-safe:
1. **Confirm Supabase Realtime is enabled** on the project and the anon key may use broadcast channels (the game uses
   broadcast for room/match sync + a `softPresence` heartbeat — it deliberately does NOT use native presence). If
   Realtime is off or rate-limited, MP can't sync — turn it on.
2. **Server-authoritative score re-judge (unlocks the public leaderboard GA):** recompute + clamp `/score`
   server-side using the single-use `play_token` the client already carries, so a modded client can't top the global
   board. The local/seeded ladder is fine until this lands; the **public** leaderboard should gate on it. Full spec in
   `MP_SERVER_SCORING_BRIEF.md`.
   **Round lifecycle WIRED to your shipped endpoints (build100j — game side is LIVE):** at match start the **HOST**
   POSTs `/mp/round/start { room_id, round_id:'r<n>', track_id, difficulty, mode, player_ids:[host,p2] }` and broadcasts
   the returned **server round uuid** to the peer over the match channel. At each player's round-end the game
   fire-and-forgets `/mp/round/settle { round_id:<that uuid>, track_id, difficulty, client_score, client_accuracy (0..1),
   client_max_combo, notes_hit, notes_total, player_id, player_name }` — human matches only (CPU warm-ups + spectators
   never report). Re-judge/clamp each submission, record to the **global MP ladder**, optionally return
   `{ leaderboard:[…] }`. All fail-open: the in-match win/lose verdict stays peer-broadcast (client-trusted), so a
   missing/slow `start`/`settle` never blocks a duel — these endpoints are the trustworthy **system-of-record** for the
   public MP standings + an anti-cheat audit trail. (If `/start` didn't return a uuid, the game settles with a
   `matchId:trackId` fallback id — safe to ignore server-side.)
3. **Rate-limit / guard the anon write endpoints** `POST /plays`, `/score`, `/uses` (the anon key is client-reachable).
4. Combat (a combo streak shocks/freezes the opponent ~2 s), tournament wagers (Bonus-Sparks-only), and host-pacing are
   all client-side already — they just need #1 (Realtime) to be live to sync between real peers.

---

## 4. 🔴 AI FLIXS — make every film a PLAYABLE level (owner's #1 content blocker)  · brief: `LOVABLE_LAUNCH_HANDOFF.md §7`

**PROVEN root cause (not a game bug):** a film becomes a playable level only if it has a **decodable audio rendition**
(`.m4a`). Right now **112 of 144 films are playable** (their `audio_url` is a Mux static rendition,
`stream.mux.com/{id}/audio.m4a`); **32 are Watch-only** because their `audio_url` is just the **HLS `.m3u8` manifest** —
a browser can't decode that into a chart. (Proof: for a Watch-only film, the derived `/audio.m4a` returns **HTTP 404** —
the rendition was never generated.)
**FIX:** in the **Mux ingest pipeline**, enable a **static/MP4 audio rendition** (`mp4_support` / `audio.m4a`) on
**every** asset, set the row's `audio_url` to that `.m4a` (not the `.m3u8`), and **backfill the 32**. Verify per asset:
`curl -I https://stream.mux.com/{PLAYBACK_ID}/audio.m4a` → must be `200`. Then **every film — today's 32 and every
future daily upload — auto-becomes a playable level with zero game changes** (the engine already charts from
`audio_url`). Also audit `is_video`/`media_type`/`video_url` tagging so all music-videos are flagged. Full detail +
exact example ids in `LOVABLE_LAUNCH_HANDOFF.md §7` (+ §4 for the tagging audit).

---

## 5. 🟠 TELEMETRY — so launch isn't blind  · brief: `TELEMETRY_BACKEND_BRIEF.md`

Stand up `POST /clientlog` (errors) + `POST /events` (funnel) and set **`TELEMETRY_BASE`** in `RHYTHM_CONFIG`. The
consent-gated telemetry **client is already built** (buffers locally, flushes once the base is set, strict EU consent
gate). Without it we launch with no crash rate + no load→pick→first-note→finish funnel.

---

## 6. INTEGRATION — "Play in Reactive Rhythm" host review hook (spec now, wire later)  · `LOVABLE_LAUNCH_HANDOFF.md §INTEGRATION`

Your hosts review songs/videos and want a **"Play in Reactive Rhythm"** button that sends an unapproved track to the
game to be played + judged on the spot. The engine can already chart + play any decodable `audio_url` via
`RhythmGame.playUrl(url, meta)` / a `?trackId=` deep link. Decide ONE handoff mechanism (a signed `?review=` URL, or
`postMessage` if embedded) + a **signed short-lived token** so an unapproved track is only playable by the reviewing
host. ~20 lines of game-side reader once you pick the mechanism. Spec in the handoff doc.

---

## 7. What the GAME already does (no backend change needed — for your confidence)
- Reads `media_type`/`is_video`/`video_url` authoritatively; lists every watchable film; charts every decodable one.
- Gates paid skins + levels on `ownsItem` entitlements; locked → routes to Store; refreshes entitlements on top-up return.
- Deep-links "Get Sparks" + "Commission a Custom Level" out to the site; re-reads balance on return.
- Carries a single-use `play_token` on `/score`; buffers consent-gated telemetry; soft-presence MP heartbeat.
- Daily Rift, Campaign (incl. 2 AI-Flix video-levels), Store, Leaderboard, Career, Multiplayer, Local Versus — all built.

## 8. VERIFICATION before public (run these)
1. **One live $-round-trip:** buy Sparks → balance credits on return → spend on a skin → entitlement grants → owned on
   reload (and on a 2nd device). Confirm a retried spend does **not** double-charge.
2. **One custom-level purchase** → the paid record + ref images land in the admin queue + owner is notified.
3. **MP 2-peer:** two real browsers — room create/join, a match syncs, scores settle, leaderboard updates.
4. **AI Flixs:** a backfilled film now shows **Play** (not Watch) + charts a level; `curl -I …/audio.m4a` → 200.
5. **Telemetry:** events arrive at `TELEMETRY_BASE`; consent gate respected.

**One-line summary for Lovable:** *Serve this repo's static game at `reactivvibeai.com/game`; wire Stripe→Sparks
top-up/credit + server entitlements, the $59.95 custom-level→admin-queue flow, Supabase-Realtime MP + server score
re-judge, the Mux `audio.m4a` rendition for all 144 films, and the two telemetry endpoints — all specs are in the
sibling `*_BRIEF.md` files. The game already reads every field and fires every event.*
