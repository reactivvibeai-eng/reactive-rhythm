# Reactive Rhythm — ROADMAP (living doc)

> Created from the user's "let's get this stuff done" brief. Pairs with `SESSION_STATE.md` (current
> build state) + `CLAUDE.md` (constraints). Status legend: ✅ done · ⏭️ next/todo · ⛔ blocked.
> Owners: **C** = Claude (in this repo) · **L** = Lovable (backend/React app `src/`, the user's other
> agent) · **U** = user (decisions / assets / one-time auth) · **$** = needs Stripe / money flow.
> Branch: all visual/gameplay work on `visual-overhaul`. **Nothing deploys to live until the user says.**

---

## ✅ SHIPPED THIS SESSION (v68–v71, branch `visual-overhaul`, NOT deployed)
- ✅ **GH string alignment fixed** (v68) — lanes ride the painted strings (cv=0, re-measured).
- ✅ **GH neck-recede WARP** (v69) — guitar "angles down"; image + lanes warp together, still aligned. `?warp=N` to tune (default 0.2).
- ✅ **Opening star-ignition animation** (start screen).
- ✅ **Level Picker v2** (hero ring, per-tier bars, initial-art, polished states + hooks).
- ✅ **Leaderboard section** (global + per-song overlay; local fallback until `/score`).
- ✅ **Sparks + login UI shell** (header chip + identity; catalog seams; stub until backend).
- ✅ **LOGIN_SPARKS_BRIEF.md** (Lovable backend spec) + this ROADMAP.
- ⏳ **NEEDS USER:** playtest the gh warp (tune `?warp`); answer **Q3** (same-origin serving for SSO) + **Q4** (Sparks economics) → unblocks Phase D with Lovable.

---

## PHASE A — Finish the visual overhaul (C) — IN PROGRESS
The "make it feel like a real game engine, not an AI website" pass.
- ✅ Highway perspective (1/z), boost/combo FX, HUD meters, combo texture, scanline (v60–65)
- ✅ **Browse waveform** — real-FFT audio-reactive visualizer on song-select (v66)
- ✅ **Note-type variety #1** — trills + expanded chords behind `?notes=1` (v67) — *needs U playtest*
- ✅ **GH string alignment** — lanes now ride the painted strings exactly (cv=0, re-measured) (v68)
- ⏭️ **Angle the guitar down "a bit more"** (U DECISION — see Open Questions Q1). Two paths:
    (a) keep the flat photo (alignment now perfect) — done; or (b) perspective-WARP the guitar image so
    the neck recedes more (top narrower) with lanes following the warp — bigger build, needs U's eye.
- ⏭️ **Better opening / star animation** (C) — upgrade the boot/loading + first-frame "ignition" into a
    branded star/supernova intro (procedural canvas). See Phase A-detail below. *Needs U: keep the atom
    loader or replace with a star ignition?*
- ⏭️ Note-type variety #2 — **open notes** (strum whole neck) + **HOPOs** (controller-centric), each
    flag-gated + U playtest (per SESSION_STATE).
- ⏭️ WS3/WS5 remaining — deeper HUD framing + a small design-system pass (tokens, iconography).

## PHASE B — Levels & content (C builds framework · U feeds assets) — START NOW
The level picker + co-designed levels the user asked for.
- ⏭️ **Level Picker v2** (C) — promote the existing 18-level campaign scaffold (`#levels-screen`,
    `rr_levelmap`, 3 tiers × 6) into a real, good-looking picker: per-level cards, stars, lock/unlock,
    "NEXT" badge, tier progress. Currently `CAMPAIGN_PUBLIC=false` + `?dev=1` gated. (SESSION_STATE: Level System.)
- ⏭️ **Co-design levels** (C + U) — define each level: song binding, difficulty, theme, modifiers, and
    (later) custom art/video background. *Needs U: which songs → which levels, and the vibe per tier.*
- ⏭️ Boss stages as capstone levels (engine exists: `?boss=1` / `RhythmGame.playBoss`).
- ⏭️ Post-level results loop ("retry / next level / back to campaign").

## PHASE C — Competition & identity (C UI · L backend) 
- ⏭️ **Leaderboard SECTION** (C) — a dedicated leaderboard screen/tab (global + per-song + friends-later),
    not just the in-results widget. UI can ship now reading a stub; goes live when the backend exists.
- ⛔ **`/score` endpoint** (L) — token-less, account-linked write → `game_plays`; powers real leaderboards.
    Engine already POSTs to `/score` (`catalog.js recordLocal`) — dormant until L ships it.
- ⏭️ Career / profile polish (exists: `#profile-screen`, `rr_career`).

## PHASE D — Login + Sparks + monetization (L + U + $ · C builds in-game UI) — STRATEGIC, PHASED
The user's big ask: log in with the SAME account as the website, show **Sparks** (currency) in-game,
and sell **game packs / add-ons / paid unlock levels**. This spans systems — phased so we ship value early.
- **D1 — Login / SSO (L + C):** the game already loads `supabase-js` + references a "shared auth session."
    If `/games/reactive-rhythm` is same-origin as the site, the game can read the site's Supabase session →
    show "signed in as…" + a Sign-in nudge when logged out. *Needs L: confirm how the site stores the auth
    session + CORS/cookie/localStorage sharing; needs U: confirm same-domain serving.*
- **D2 — Sparks balance (L + C):** L exposes `GET /sparks/balance` (account-linked) + `POST /sparks/spend`
    (idempotent, server-authoritative — never trust the client for currency). C adds an in-game Sparks HUD
    chip + balance display. *Needs U: confirm Sparks are the single currency and where top-ups happen.*
- **D3 — Entitlements + store (L + C):** L exposes what the account OWNS (packs/levels) via
    `GET /entitlements`; C builds the in-game **Store** (game packs, add-ons, paid unlock levels) that
    spends Sparks (D2) and unlocks content. Server validates every unlock.
- **D4 — Real-money top-ups ($ + L, optionally C):** buy Sparks (or packs directly) with money via Stripe.
    Likely lives on the website (existing Sparks purchase), with the game deep-linking to it; or a Stripe
    Checkout/Payment-Link flow. *Needs U: pricing, Sparks economics (price per pack/level), and whether
    purchases happen in-game or bounce to the website. Stripe MCP is available when we build this.*

## CROSS-CUTTING / INFRA
- ⛔ **`/games/ 404`** (U + L) — host must serve static `/games/*` as files (files are on `main`).
- ⏭️ Beta gate backend (L) — `BETA_ADMIN_LOVABLE_PROMPT.md` ready; activates the existing in-game gate.
- ⏭️ Mobile polish (C) — search inputs ≥16px (stop iOS zoom), real-device pass.
- ⏭️ GH controller phases 1–2 (C + U hardware) — tap-mode + live calibrator, then strum/whammy/tilt.
- ⏭️ Strip dev hooks before any live push (LAST step; `?dev/?boss/?fps/?notes/?gh`, `__rr*`, FPS meter).

---

## OPEN QUESTIONS (need U decisions to unblock)
- **Q1 — Guitar angle:** alignment is now exact on the flat photo. Do you want it left flat, or should I
    perspective-warp the guitar so the neck recedes more (more "looking down the neck")? The warp is a
    bigger change — best done with you watching on your screen.
- **Q2 — Opening animation:** replace the atom loader with a star/supernova ignition intro, or keep the
    atom and just make it punchier?
- **Q3 — Login/serving:** is `reactivvibe.com/games/reactive-rhythm` same-origin as the site (so the game
    can share the Supabase login session)? This decides how SSO works.
- **Q4 — Sparks economics:** confirm Sparks is the in-game currency; rough prices for packs / add-ons /
    paid unlock levels; do real-money top-ups happen in-game (Stripe) or on the website?
- **Q5 — Level design:** which songs map to which levels, and the vibe per tier (WARM-UP / PULSE / FRACTURE)?

## SUGGESTED ORDER (fastest value, least blocking)
1. (this turn) Alignment ✅ + this roadmap.
2. **Opening star animation** (C, no deps) — quick visible win.
3. **Level Picker v2 + Leaderboard section UI** (C, no deps; backend wires in later).
4. **D1 Login/SSO + D2 Sparks balance display** (needs L + U answers to Q3/Q4) — unlocks monetization.
5. **D3 Store + paid unlock levels**, then **D4 Stripe top-ups**.
6. Open notes / HOPOs, mobile polish, controller phases in parallel as playtests allow.
