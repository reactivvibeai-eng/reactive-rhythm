# Reactive Rhythm — ROADMAP (living doc, as of v139)

> Pairs with `CHANGELOG.md` (full history) + `CLAUDE.md` (constraints). Update as we go.
> Owners: **C** = Claude (this repo, `visual-overhaul` branch) · **L** = Lovable (the user's backend agent) ·
> **U** = user (decisions / assets / playtest). **Nothing deploys live until the user says.**
> Hard constraint reminder: the desktop app runs an **older browser engine** than the test preview —
> NO `:has()` / `@container` / modern-only CSS for anything load-bearing (it silently no-ops there).

---

## ✅ WHERE WE ARE (hardened core, post end-to-end audit)

Gameplay is feature-complete and proven out: 5-lane GH engine; **3D marble notes** + lane-colored comet
trails + **slim lane-tinted hold beams** (v139); chords / holds / bombs / gap-fill; palm-mute hit SFX +
miss squelch (music never ducks, miss volume now respects the slider); **pixel-measured string alignment**
per guitar; game-feel HUD. Library = full live catalog with search/browse/coverflow + in-browser charting,
and **every decodable track now always charts** (synthetic-grid fallback, v136). Persistence (career /
best), results star+grade. 4 themed guitars (Crimson default, Skully, Melody, Bone Daddy) with backdrops +
reactive cards. **Per-level mods (speed / mirror / failOn) are wired** (v137). Browse page has a moonless
full-bleed video bg (v130–134). A 9-agent audit fixed the criticals — broken shared `/play` links,
bomb-deflated scoring, re-entrancy, a 2nd `:has()` trap, etc. (v135).

**Gated by your decision (not blockers):** Campaign (`CAMPAIGN_PUBLIC=false`); Multiplayer
(`MP_PUBLIC=false`, held until server-authoritative scoring — `MP_SERVER_SCORING_BRIEF.md` is ready for L).

---

## 🎯 PHASE 1 — LEVEL DESIGN (collaborative: U feeds refs/assets · C wires + verifies) — START NOW

The main push. You have reference images; I now know exactly how a level is assembled.

### Anatomy of a level — the AUTHORED table in `index.html` (~line 4276)
One row per level: `{ id, tier(easy/medium/hard), title, song({trackId}|{stride:N}|{demo}), theme, accent,
cover, bgArt(static backdrop), bgVideo(loop backdrop), guitarSkin, intenseVideo(combo-spike), reactiveCards,
mechanic, boss, mods{speed,mirror,failOn}, unlock{stars|entitlement} }`.

### Assets a new level needs
1. **Guitar skin** — 5-string, built to the **receding-neck template** (i2i from `crimson-chaos-ryo.png`,
   body restyled to theme, strings kept clean) so string-tracking can measure it. ← highest technical bar.
2. **Backdrop** — `bgArt` (static self-heal) + `bgVideo` (looping ambient), full-bleed, themed.
3. **Reactive cards** — the two flanking tarot/fate cards (theme art).
4. **Cover art** — the level-picker tile.
5. (opt) `intenseVideo`, a `mechanic`, `mods`.
All assets follow **THE STYLE FORMULA** (gpt_image_2, key-color transparency, the canonical prompt block in
`ASSET_ORDERS_GUITARS.md §0`).

### Collaborative workflow (who does what)
1. **U:** level concept (theme / vibe / song or `trackId`) + reference images.
2. **C:** convert each into an exact, formula-locked generation prompt + exact target filename + folder.
3. **U:** generate the assets (you own image-gen) and drop them in.
4. **C:** measure strings → `SKIN_GEOM` (`verified:true` gate) → wire the row → apply theme/accent/cards/mods
   → **verify in-engine** (strings ride the catchers, theme applies + clears, marble/beam read well, 0 errors).
5. **Iterate** on your eye.

### Backlog
- [ ] Finalize Melody / Bone Daddy / Skully to the "as good as the public beta" bar.
- [ ] Fill the 3 missing backdrop mp4s (`pulse-loop`, `skully-intense`, `boss-loop`) or drop the keys.
- [ ] New levels from your reference images (track them here as we go).
- [ ] Before Campaign can go live: validate pinned campaign `trackId`s vs the live catalog + define
      `bossProviderFor` so bosses enter boss mode → **then** flip `CAMPAIGN_PUBLIC=true` + retest the
      clear→star→unlock loop on a clean profile.

---

## ✅ PHASE 2 — LEADERBOARDS verified correct (C UI · L backend)

- [ ] A finished run **submits** to the server (`RhythmCatalog.onSubmitResult` → game-catalog `/score`).
- [ ] Per-song (`fetchLeaderboard`) + **global** (`fetchGlobalLeaderboard`) display real rows; your best shows.
- [ ] Submit failures degrade gracefully (no dead-end); mock grade is gated to mock-only (done, v135).
- ⛔ **`/score` endpoint (L):** account-linked write powering real boards. Engine already POSTs to it; dormant
  until L ships it. **C verifies the client path in-engine + hands L the exact contract.**

---

## PHASE 3 — STANDARDS / QA before "beta-ready"

- [ ] Leaderboards verified (Phase 2).
- [ ] **Score-ceiling decision:** hold-sustain payout can exceed `notes_total*1500` — fold sustain into the
      head budget or include it in `notes_total` (match the server rule; same fix unblocks ranked MP).
- [ ] **Browser-compat gate:** keep grepping `:has(` / `@container` before each ship (older desktop engine).
- [ ] **Mobile polish:** search inputs ≥16px (stop iOS zoom), real-device pass.
- [ ] **Strip dev hooks (LAST, at content-freeze):** `__rrDebug`, `__rrChartStats`, FPS meter,
      `?dev/?mock/?novideo/?fps/?ryo`, the `/__cap` sink. Decide keepers (e.g. `?novideo` as a support lever).
- [ ] **Beta gate** (`BETA_GATE_BRIEF.md`) confirmed + activated by L.
- [ ] Final clean-profile end-to-end playtest.

---

## PHASE 4 (later) — Login + Sparks + Store + monetization (L + U + Stripe · C builds in-game UI)

Preserved from the prior roadmap — still the strategic backend arc, phased to ship value early.
- **D1 — Login / SSO (L+C):** game already loads `supabase-js`. If `/play` is same-origin as the site, read
  the site's Supabase session → "signed in as…" + sign-in nudge. *Needs L: how the site stores auth +
  CORS/cookie sharing; U: confirm same-domain serving (Q3).*
- **D2 — Sparks balance (L+C):** L exposes `GET /sparks/balance` + `POST /sparks/spend` (idempotent,
  server-authoritative). C wires the in-game Sparks HUD chip (shell exists). *Needs U: Sparks economics (Q4).*
- **D3 — Entitlements + Store (L+C):** L exposes `GET /entitlements`; C builds the in-game Store (packs /
  add-ons / paid unlock levels) spending Sparks, server-validated. (Store UI shell exists.)
- **D4 — Real-money top-ups ($ + L):** buy Sparks/packs via Stripe (likely on the site, game deep-links). *Needs U: pricing.*

---

## Parking lot (by-design / backend-gated — not beta blockers)
- **Campaign** — fully built, gated off by your choice (pending the levels vision). Flip + prep when ready.
- **MP server scoring** — `MP_SERVER_SCORING_BRIEF.md` ready for L; MP held until then. Also: host-migration,
  random-per-round track, timing-fragile handoffs (all in the brief).

## Open questions (need U decisions)
- **Q1 — Level mapping:** which songs → which levels, and the vibe per tier (WARM-UP / PULSE / FRACTURE)?
- **Q2 — Campaign go-live:** when do you want Campaign unlocked for players (it's one flag + the boss/UUID prep)?
- **Q3 — Serving/SSO:** is `/play` same-origin as the site (shared Supabase login)?
- **Q4 — Sparks economics:** prices for packs / add-ons / paid levels; top-ups in-game (Stripe) or on the site?

## Suggested order (fastest value, least blocking)
1. (done) Hold-beam polish ✅ + this roadmap.
2. **Level design** (Phase 1) — the collaborative build, no backend deps. ← we are here.
3. **Leaderboards verify** (Phase 2) — C verifies client path; L ships `/score`.
4. **Standards/QA** (Phase 3) before calling it beta-ready.
5. **Login/Sparks/Store/Stripe** (Phase 4) once U answers Q3/Q4 and L is ready.
