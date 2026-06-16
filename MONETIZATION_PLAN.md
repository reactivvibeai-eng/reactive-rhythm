# Reactive Rhythm — Accounts, Economy & Cosmetics Store: One Cohesive Plan

**Author:** Lead game designer pass · **Date:** 2026-06-16 · **Game state:** v43 (live 852-track catalog, 5-lane GH, ReactivVibe brand)

This plan fuses four research inputs (economy, cosmetics, auth/backend, existing-game audit) into **one buildable program**. The governing principle the audit proved: **the client economy already exists** (`catalog.js` seams + the `#store-screen` overlay + `equipGuitarSkin`). We are **not rebuilding** — we are (a) reframing the model to a fair single-currency design, (b) generalizing the single skin slot into a loadout, (c) **leading with cheap/safe non-play-surface cosmetics so we ship without burning AI generations**, and (d) writing one corrected backend brief for Lovable to light up *later*.

> **Reconciliation note up front:** an existing `LOGIN_SPARKS_BRIEF.md` already specs the backend, but with a **two-currency "real money buys Sparks"** model. The new economy research says that path invites currency-obfuscation/regulatory risk. **This plan supersedes that model** with: ONE earned soft currency (Sparks) + premium cosmetics sold for **direct real money**. The corrected spec is in Section 7 (DO-NOT-SEND-YET). The *endpoint shapes already coded against* (`/sparks/balance`, `/sparks/spend`, `/store`, `/entitlements`, `/me`) are kept — only the money-funnel changes.

---

## 1. Economy model — Sparks (single earned currency)

### 1.1 The model in one line
**ONE earned soft currency ("Sparks"), never purchasable as a 1:1 clone. Premium/marquee cosmetics sold for direct real money at fixed USD prices. No gacha, no loot boxes, no two-currency converter.** This is the lowest-risk, most defensible, regulation-proof path (pre-complies with the EU Digital Fairness Act and dodges Belgium/Netherlands loot-box exposure), and it fits the game's locked "no pay-to-win" identity.

### 1.2 Earn loop (faucets — every faucet is server-decided)
Sparks are awarded by the **server** at run-end (the client never names the amount). Reward is scaled to **skill, not repetition**:

| Faucet | Rule | Why |
|---|---|---|
| Finish a song | Base reward × difficulty multiplier (Easy 1.0 / Medium 1.4 / Hard 1.8) | Reward engagement, lean toward skill |
| Accuracy bonus | Scaled by final accuracy % (the `accuracy` already in the `/score` body) | Reward precision over grinding |
| First-clear-of-the-day per track | One-time daily bonus per `track_id` | Drives **breadth** across the 852-song catalog instead of farming one easy song |
| Full-combo bonus | Small flat bonus, ties into existing FC tracking | Skill milestone |
| New personal best | Small bonus, ties into existing `rr_career` grade system | Progress feel |
| Daily streak | Gentle login/play streak bonus | Retention without FOMO pressure |

**Anti-inflation soft ceilings (no hard walls):** daily earn cap, **diminishing returns on repeat-clearing the same easy song**, and a steady drip of new cosmetics so there's always a fresh sink. Target: weekly currency growth **below the ~12%/week instability threshold** the research flags. These rules live **server-side** (Section 7, endpoint `B3 /sparks/earn` folded into `/score`).

### 1.3 Spend loop (sinks — willing, never forced)
Sinks are **cosmetics players gladly buy for self-expression**, never un-grinding artificial friction:
- Note/gem skins, lane/board themes, hit-FX, catcher styles (Tier 1/2 cosmetics — Section 4).
- Guitar skins (calibrated play-surface, Tier 3 — the costly tier).
- Profile flair: titles, nameplates, frames, emblems (Tier 0, pure data).

**Faucet↔sink balance is the core health metric.** Every faucet above maps to a sink the player wants. If growth outpaces sinks, the store goes worthless — so we drip new cosmetics and keep the daily/diminishing caps.

### 1.4 Price ladder (rarity → price, with a real-money anchor)
A simple, readable ladder. Most items earnable in Sparks **AND** premium items direct-buyable:

| Rarity | Examples | Sparks price band | Direct USD (premium only) |
|---|---|---|---|
| **Common** | recolors, alt note-gem palettes | low (frequently earnable) | — |
| **Rare** | full lane/board themes, hit-SFX packs, catcher styles | mid | — or ~$1–3 |
| **Epic / Signature** | themed stages, animated Ryo skins, premium loading themes, calibrated guitar skins | high | ~$3–8 |
| **Legendary / Collab** | artist-themed sets tied to catalog tracks | direct-sale, time-limited | direct only |

**Hard pricing rules:** keep individual cosmetics in the **$1–8** band; reserve a single **~$10–15 bundle/season** as the premium ceiling. **Always show the real-money cost** — never bury price behind opaque units. Most everyday cosmetics are earnable with Sparks; only marquee items are direct-buy.

### 1.5 Prestige (skill-gated, not money-gated)
Tie the **rarest looks to achievements** (full-combo a Hard track, top a leaderboard, hit a career rank) so the flashiest cosmetics read as **earned status symbols**. This deepens attachment, drives word-of-mouth, and keeps the economy fair. These are entitlements granted by the server on achievement, not purchases.

### 1.6 Hard constraints (non-negotiable)
- **Strict cosmetic-only neutrality.** Every skin/FX/SFX/stage must be gameplay-equivalent: identical note readability, timing windows, lane clarity. **Readability floor:** no paid skin is more readable than the free default. (Watch the green fret-1 gem — that's the ratified brand exception, a *functional lane color*, NOT to be "fixed.") This is structurally guaranteed by the engine's art-vs-geometry split (Section 3.5) but must still be a QA check.
- **No gacha / paid loot boxes — do not build.** If we ever want surprise, a transparent mystery box bought **only with earned Sparks**, published odds, pity/dupe-protection — but cleanest is to skip randomized buys entirely.
- **Gentle FOMO only.** Rotating shop + earnable catch-up; never stack countdown timers + opaque currency + impulse bundles.

---

## 2. Accounts / login — and exactly WHY a real login is required

### 2.1 What exists today
`catalog.js` already creates a Supabase client that **inherits the website's session** from shared `localStorage` (default storageKey, no override), with `getToken()`, `getUser()`/`getMe()` (prefers `GET /me`, falls back to the raw session), and `onAuthChange()`. The header identity chip already opens the Career overlay when signed in and the site login when guest (index.html ~6037-6039).

### 2.2 Recommended auth: anonymous-first, upgrade in place
- **Every guest starts as a Supabase anonymous user** (`signInAnonymously()`) on first load — zero friction, matches the current guest-read flow, and gives every player a **stable `auth.uid()` immediately** so their wallet/unlocks/best-scores attach to a server identity from the first touch (today `rr_career` is localStorage-only and is lost on cache-clear/device-switch).
- **Upgrade the SAME user in place** when they want to save progress / play ranked / make a real-money purchase: `updateUser({email})` (magic-link, the default) or `linkIdentity({provider:'google'})` (one-click, highest conversion). **Identity-linking preserves the user id and all earned inventory** through conversion. Skip email+password unless asked. Always set `redirectTo = reactivvibe.com/play`.

### 2.3 WHY a real (permanent) login is required for the economy — precisely
1. **Server-authoritative currency needs a durable identity.** Sparks balance, the ledger, and entitlements are keyed to `auth.uid()`. An anonymous user *can* earn/equip free items, but their identity is ephemeral — clear cache or switch device and it's gone. **A real account is the only thing that makes "what I own" and "my balance" survive.**
2. **Real-money purchases must attach to a recoverable account.** If a player pays $5 for a skin as an anonymous user and loses the device, the purchase is unrecoverable and a refund/support nightmare. **Direct-sale entitlements (and the Stripe webhook that grants them) require a permanent account** — gated behind a restrictive RLS policy `is_anonymous = false`.
3. **Cross-device + multiplayer identity.** Loadout + entitlements live in Postgres keyed to `auth.uid()`, so signing in on any device restores everything. Multiplayer rival decks render *your* equipped cosmetics — which requires a stable identity to broadcast.
4. **Leaderboard integrity / anti-cheat.** Score submission and ranked play should require a permanent account so the board isn't trivially spoofable by spun-up anonymous users.

So: **anonymous = free play + earn/equip free Sparks cosmetics**; **permanent account = save across devices, buy with real money, submit ranked scores, multiplayer.** The restrictive `is_anonymous` RLS policy is the fence.

### 2.4 Anonymous-user hardening (must be in the backend spec)
`signInAnonymously` is unauthenticated (Supabase rate-limits ~30/hr/IP and warns of DB-size abuse). The spec **must** require: Turnstile/CAPTCHA on the anon endpoint, and a scheduled cleanup of stale anonymous users with no progress.

---

## 3. Inventory & entitlements — owned vs equipped, and how cosmetics travel

### 3.1 The two-layer split (industry standard: TF2/Fortnite/osu/Halo)
- **Entitlements = what you OWN.** The single source of truth every mode reads. Already exists: `getEntitlements()` → `owns[]`, with the sync `ownsItem(item_type, item_id)` cache (`_entitlements` in catalog.js) so synchronous callers (store equip-state, levels gating) read ownership without awaiting.
- **Loadout = what you have EQUIPPED per slot.** A dedicated slot map, **not** a flag in the bag.

### 3.2 What exists vs the gap
Today there is exactly **one equip slot**: `rr_skin` (the guitar PNG, via `equipGuitarSkin`) plus the store's `rr_skin_id` tracking the chosen item. **The gap is a real multi-slot loadout.**

### 3.3 Generalize to a slot-keyed loadout
Replace the single `rr_skin_id` with one **`rr_loadout`** object, slot-keyed:

```
rr_loadout = {
  guitar:    <itemId|null>,   // the calibrated play-surface skin (existing rr_skin path)
  noteSkin:  <itemId|null>,   // note/gem recolor
  board:     <itemId|null>,   // lane/board theme
  catcher:   <itemId|null>,   // catcher style
  hitFx:     <itemId|null>,   // hit-FX flipbook (reuse the FX pack)
  hitSfx:    <itemId|null>,   // hit/miss sound skin
  title:     <itemId|null>,   // pure-data profile flair
  frame:     <itemId|null>    // pure-data nameplate frame
}
```

Expose **one generic `equipCosmetic(slot, itemId)`** alongside the existing `equipGuitarSkin` (which becomes the `guitar`-slot implementation). Persist `rr_loadout` in localStorage now; **server-side per account later** (Section 7) for cross-device.

### 3.4 Validation on load (two checks)
On every load, validate **each slot** against:
1. **`ownsItem(slot, itemId)`** — you must own it.
2. **The active lane profile** — e.g. a 6-string guitar skin is invalid in 5-lane mode (the game is 5-lane by decree). The existing `_skinVerified` gate already does the play-surface half of this.

Reset any invalid slot to its default. This makes cross-level + cross-mode persistence **free** — every level/match just reads the validated loadout at load.

### 3.5 How equipped cosmetics travel — level-to-level and into multiplayer
- **Cross-level (free with entitlements):** ownership is account-level, so every level reads the equipped loadout at load. **Never** store owned/equipped in a level def. The existing per-level `setGuitarSkin` is correctly a **temporary override** that never writes `rr_skin` — **generalize that pattern to every slot:** a designer level look is a temporary override, restored when the level theme clears.
- **Into multiplayer (broadcast ids, render locally):** each client **broadcasts its equipped item IDs** (not assets) on the **existing `softPresence` broadcast-heartbeat layer in `multiplayer.js`** — **NOT native Supabase Presence/`channel.track()`**, which has *never synced reliably on this project* (confirmed in project memory). Peers resolve ids against the shared catalog and render locally, **falling back to default if an id can't resolve**. Opponent cosmetics are **untrusted, cosmetic-only display data** — a peer's skin can **never** alter YOUR board. Validate broadcast cosmetics server-side vs entitlements only where it matters (ranked/tournament anti-spoof); since they're purely visual, a lightweight "trust but cosmetic" stance is acceptable elsewhere.

### 3.6 Why cosmetic-only is structurally guaranteed
Notes ride **pixel-measured string positions** (`ART.nutXF`/`ART.bridgeXF`); the skin layer only changes **which image blits**. A cosmetic literally cannot move a note or touch scoring. The flagged risk — a 5-string profile + 6-string skin mis-fit — is handled by the load-time slot validation (3.4) and the existing `_skinVerified` gate.

---

## 4. Store catalog — cosmetic taxonomy & tiers (LEAD WITH SAFE NON-PLAY-SURFACE)

The store overlay (`#store-screen`) and its controller already exist (index.html ~5725-5979) with a `STORE_FALLBACK` catalog, art-tile fallback, buy flow, and equip/unequip. We **extend** it. The ordering principle: **best value-to-cost first** — pure-data and recolors are ~the bulk of cosmetic spend and need near-zero new art; the play-surface guitar is the *only* tier that touches calibration.

### Tier 0 — Pure data (SHIP FIRST, free progression rewards) — ZERO art cost
Titles, nameplates, frames, banners, emblems. No asset generation at all — CSS + text. **Gate these behind progression** (career rank, full-combos, leaderboard placement) as the **free reward loop** that gives the earn loop somewhere to land on day one. Surfaces: Career/Controller profile, results screen, leaderboards, multiplayer rival deck.

### Tier 1 — Recolors & themes (SHIP SECOND, the value core) — cheap, mostly on-disk
**Non-play-surface, so NO calibration required** (the audit's key insight: *only the guitar touches the play surface; off-surface cosmetics need no calibration*):
- **Note/gem skins** — recolors of the existing note PNGs (crimson/chrome/gold palettes). Honor the green fret-1 exception.
- **Lane/board themes** — board tint/accent themes (the existing `theme_neon` slot → rebrand to crimson/chrome/gold variants; **no purple/blue** in chrome).
- **Catcher styles** — recolor/restyle the existing catcher rings.
- **Hit-SFX packs** — alternate chug/squelch SFX (audio, not image — generate via ElevenLabs if needed, cheap).

### Tier 2 — Animated FX (sell for Sparks, fewer) — reuse the FX flipbook pack
Hit-FX, animated catcher/combo FX. **Reuse the existing `assets/fx` flipbook pack** (per memory: 31 additive flipbook FX with manifest + fx-player.js — co-owned with the engine agent; watch name collisions). Higher cost than recolors but **already largely produced** — wire, don't generate.

### Tier 3 — Calibrated guitar skins (the ONE play-surface tier) — curated, gated
A **small curated set** of premium guitar skins via the **proven pipeline**: template-i2i (from `crimson-chaos-ryo.png`) → PIL flood-fill cutout → adaptive measure (`_measure_adaptive.py`, ≥8 clean exactly-5 rows) → overlay-verify → add to `SKIN_GEOM` with **`verified:true`**. Only `verified:true` skins are ever drawn as the playable neck (`_skinVerified` gate); anything else falls back to canonical crimson.

**Already-verified, sellable today (no new generation needed):** `violet-gothic-5`, `crimson-chaos-ryo` (the default), `violet-gothic`, `melody-pink`, `bone-daddy`, `shaman-wolf`.

**FLAGGED BUG (fix before selling — audit confirmed):** `crimson-chrome.png`, `ember-bone.png`, `gold-relic.png` (game.js ~590-598) are in `STORE_FALLBACK` and **sold**, but **lack `verified:true`** → at play they're rejected to crimson. **Either** run them through the measure→verify pipeline and add `verified:true`, **or** pull them from `STORE_FALLBACK` until verified. **Do not sell a skin that doesn't ride the strings.**

### Curated featured layout
Present the store in a **curated "Featured" layout** (reuse the existing coverflow / Featured-Hot-New patterns) — curated shops convert ~22% better than flat lists. Maximize **cosmetic visibility** (the #1 purchase driver): show owned skins in results, the Career profile, leaderboards, and especially multiplayer rival decks where *other players* see them.

---

## 5. The "NO WASTED GENERATIONS" asset strategy + the approval GATE

### 5.1 Cheap/safe vs needs-calibration (decision table)
| Cosmetic | Art cost | Calibration? | Generation needed? |
|---|---|---|---|
| Titles / nameplates / frames / emblems (Tier 0) | Zero (CSS+text) | No | **None** |
| Note/gem recolors (Tier 1) | Recolor existing PNGs (PIL hue shift) | No (off-surface) | **None** — programmatic recolor |
| Board/lane themes (Tier 1) | CSS tint variants | No | **None** |
| Catcher styles (Tier 1) | Recolor existing rings | No | **None** |
| Hit-SFX packs (Tier 1) | Audio | No | Cheap (ElevenLabs) — not image gens |
| Animated hit/combo FX (Tier 2) | **Already produced** (fx flipbook pack) | No | **None** — wire existing |
| Calibrated guitar skins (Tier 3) | i2i render + cutout | **YES** (measure→verify) | **Only here** — and only after the gate |

**~90% of the launch catalog needs ZERO new AI generations.** The only tier that consumes generations is Tier 3, and only the curated set.

### 5.2 The approval + verify GATE (runs BEFORE any generation)
No image generation runs until **all** of these pass — this is the spend-control checkpoint:

1. **Design approval (the user).** The user generates assets themselves (per workflow memory). For each proposed Tier 3 skin I provide an **exact per-file prompt** + the **target folder + exact filename** (e.g. `assets/guitars/<name>.png`, store cover `assets/store/skin-<name>.jpg`). Nothing is generated speculatively.
2. **Template-i2i only.** Tier 3 skins are i2i **from `crimson-chaos-ryo.png`** (dark body under clean strings, ornament at edges) — wild "hero" guitars can't be play surfaces. The 9:16 receding-neck template is mandatory.
3. **Measure gate.** Cutout → `_measure_adaptive.py` must yield **≥8 clean exactly-5-string rows** + a Read of the overlay confirming catchers ride the painted strings nut→bridge. **Fail = do not ship as a surface** (it can still be a non-playable display image, but never the neck).
4. **`verified:true` only.** Only a measure-passing skin gets `verified:true` in `SKIN_GEOM`. The `_skinVerified` runtime gate enforces this regardless.

**Net:** generations are spent **only** on user-approved, template-correct guitar skins that we have a high prior will pass the measure gate — never on speculative art, never on off-surface cosmetics (which are recolors/CSS/already-produced).

---

## 6. Game-side build plan — REUSE the existing shell (priority order)

Everything below extends what the audit found. **Bump `?v=NN` on every JS/CSS edit; `node --check game.js` after every JS edit; verify via Claude_Preview `preview_eval` + `window.__rrDebug`/`window.__rrChartStats`; check `preview_console_logs` (error) at the end.** Brand: warm black/crimson/chrome + gold, **no purple/blue/green in chrome**.

**P0 — Fix the unverified-skin bug (blocks selling).**
- Run `crimson-chrome` / `ember-bone` / `gold-relic` through measure→verify and add `verified:true`, **or** remove them from `STORE_FALLBACK` (index.html ~5772-5781). No skin is sold that doesn't ride the strings. *(game.js ~590-598)*

**P1 — Generalize the loadout (the structural unlock).**
- Add `rr_loadout` slot map + generic `equipCosmetic(slot, itemId)` in game.js, with `equipGuitarSkin` as the `guitar`-slot impl. Keep per-level overrides temporary (generalize `setGuitarSkin`'s pattern to all slots).
- Add load-time validation: each slot vs `ownsItem` **and** the active lane profile; reset invalid → default. *(game.js skin layer ~527-714; catalog.js `ownsItem` ~131)*

**P2 — Ship Tier 0 (pure-data) + Tier 1 (recolors) cosmetics.**
- Tier 0 titles/frames/emblems as **free progression rewards** wired into Career/results/leaderboard surfaces — gives the earn loop a day-one landing spot with zero art.
- Tier 1 note-gem recolors, board themes, catcher styles via programmatic recolor of existing assets. Add to the store catalog (extend `STORE_FALLBACK` / the merge logic at index.html ~5945-5950, which already keeps `skin`/`level` types — add `noteSkin`/`board`/`catcher`/`title`/`frame` types).
- Render the store in the **curated Featured layout**.

**P3 — Wire Tier 2 FX from the existing flipbook pack.**
- Add the FX-pack hit/combo FX as `hitFx` slot items (Sparks-priced). Coordinate with the engine agent on the union-managed FX manifest (watch name collisions).

**P4 — Surface cosmetics everywhere (visibility = conversion).**
- Show equipped loadout in results, Career/Controller profile, leaderboards, and multiplayer rival decks. Add the equipped-id broadcast to the **`softPresence` heartbeat** in `multiplayer.js` (NOT native Presence).

**P5 — Equip UX = Fortnite Locker.**
- One screen per slot type, a grid of owned items, equipped badged (the store already does Equipped vs Equip), instant **live preview of the real board** (note/board skins are read as readability tools, so preview matters). Named whole-kit presets later.

**P6 — Earn loop client wiring.**
- The "Get Sparks" button (`#store-getmore`) currently deep-links to a top-up. Re-point the **earn** path: after each run, the server returns earned Sparks via `/score` (Section 7 folds B3 in); the client re-reads `getSparks()` and shows the gain on results. Keep "Get Sparks" pointing at the **direct-purchase** path (real money), not a Sparks top-up converter.

**Throughout:** the store buy flow (`spendSparks` → 402/409 handling → flip Owned/equip), the `rr_sparks` balance cache, and the guest/signed-in banner already work — **reuse, don't rebuild.**

---

## 7. Lovable backend spec — DO-NOT-SEND-YET

> **STATUS: DRAFT — do NOT hand to Lovable until the user confirms the model and content-freeze.** This **supersedes the money model in `LOGIN_SPARKS_BRIEF.md`** (which specs "real money buys Sparks"). Keep that brief's endpoint *shapes* — the game is already coded against them — but change the money funnel to **direct real-money cosmetic sales** and make Sparks **earn-only**. Deliver shaped like `BETA_GATE_BRIEF.md`.

### 7.1 Top security invariant
**The client is a dumb renderer of server truth.** The browser READS its own wallet/inventory/loadout via RLS (`user_id = auth.uid()`) but **NEVER** writes grants, currency, prices, or purchases. Every mutation goes through a Supabase Edge Function that validates the JWT and writes with the **service role** (held only in Edge Function secrets, never in any client file — the anon key in index.html is correctly public and safe).

### 7.2 Auth config
Enable anonymous sign-in + email magic-link + Google OAuth; enable manual identity-linking; `redirectTo = reactivvibe.com/play`; Turnstile/CAPTCHA on the anon endpoint; scheduled stale-anonymous cleanup. Restrictive RLS policy `(auth.jwt()->>'is_anonymous')::boolean = false` fences real-money purchases, ranked-score submission, and multiplayer ranked — paired with a permissive `true` policy so anonymous users can still earn/equip free items.

### 7.3 Schema (5 core tables + idempotency)
- **`item_catalog`** (server-owned, read-only to authenticated): `id` (text SKU, e.g. `noteskin.crimson`, `skin.guitar.shaman_wolf`, `title.riff_lord`), `kind` (guitar_skin|note_skin|board|catcher|hit_fx|hit_sfx|title|frame|emblem|stage), `display_name`, `rarity`, `price_sparks` (null = not Sparks-buyable), `price_usd_cents` (null = not money-buyable), `stripe_price_id`, `is_purchasable`, `unlock_rule` (null | achievement key for prestige/free Tier 0), `sort`, `meta` jsonb (asset paths/tints, lane_profile compatibility). **Single source of truth for the store + prices.**
- **`user_entitlements`** (server-write only): `user_id`, `item_id`, `source` (purchase|earned|prestige|gift|promo|founder), `granted_at`, `ref` (idempotency/order id), **UNIQUE(user_id, item_id)** (re-grant = no-op). RLS: SELECT own; no client INSERT/UPDATE/DELETE.
- **`user_loadout`** (one row per user = cross-device + multiplayer truth): `user_id` PK, one column per slot (`equipped_guitar`, `equipped_note_skin`, `equipped_board`, `equipped_catcher`, `equipped_hit_fx`, `equipped_hit_sfx`, `equipped_title`, `equipped_frame`), `updated_at`. **Equip guarded by an ownership check** (trigger/policy verifies `user_entitlements`) — safest is to route equip through an Edge Function and make the row client-read-only.
- **`sparks_ledger`** (append-only double-entry; **balance is DERIVED, never a client-settable integer**): `id`, `user_id`, `delta` (signed), `reason` (earn_run|spend_store|refund|prestige|admin), `ref` (idempotency key, UNIQUE), `balance_after`, `created_at`. RLS: SELECT own; no client INSERT. (Reuse the site wallet table if one exists — ask the user.)
- **`user_profile`**: `display_name`, career rollups (lifetime score, runs, best combo, accuracy, full-combos) — migrated off the localStorage `rr_career` blob.
- **Idempotency:** UNIQUE on `ledger.ref` + a request-key check.

### 7.4 Endpoints / RPCs (request/response/errors)
- **`GET /me`** — identity from JWT (`auth.uid()`, never the body). Signed-out → `200 {user:null}`. *(already called)*
- **`GET /sparks/balance`** — derived sum of ledger deltas. Anon → `{balance:0, signed_in:false}`. *(already called + cached as `rr_sparks`)*
- **`POST /score`** (folds in earn) — validates the run, writes the leaderboard row, **computes the Sparks reward server-side** per Section 1.2 rules (difficulty × accuracy + first-clear-of-day + FC/PB + caps/diminishing-returns), writes a positive ledger row, returns `{ok, rank_global, personal_best, sparks_earned}`. **Client never names the amount.** *(already called dormant)*
- **`POST /store/buy`** (was `/sparks/spend`) — Edge Function: get real `user_id` from `getUser()` (not body); re-read **current price from `item_catalog`** (never trust client price); check ownership + derived balance; in ONE atomic `SECURITY DEFINER` transaction insert the spend ledger row + the entitlement; idempotency-keyed. Errors: `401 login_required`, `402 insufficient_sparks`, `409 price_mismatch`. *(already coded against — `spendSparks` handles 402/409)*
- **`POST /loadout/equip`** — `{slot, item_id}`; verify ownership + lane-profile compatibility server-side; update the loadout row.
- **`GET /entitlements`** — `{signed_in, owns:[{item_type,item_id}]}`. *(already called + sync-cached)*
- **`GET /store`** — `item_catalog` + per-user `owned` flags + balance. *(already called)*
- **Real-money: `POST /purchase/checkout` + Stripe webhook** — the grant fires **only** from a verified `checkout.session.completed` webhook (signature-verified, deduped on Stripe event id), which writes the **entitlement directly** (`source:purchase`). **The client's "I paid" is never sufficient.** This is the **direct cosmetic sale** path — NOT a Sparks top-up converter.

### 7.5 Security invariants list (explicit)
Client never writes wallet/grants/prices/loadout-without-ownership-check; service-role only in function secrets; real-money grants only via verified webhook; all mutations idempotent + atomic; **purchases fail CLOSED** (vs the beta gate which fails open); identity from `getUser()` not body; rate-limit `/store/buy` and `/score` per user.

### 7.6 Migration + seed
- **One-time migration:** import existing localStorage `rr_career` / `recordLocal` / best-scores into `user_profile` on a user's first authenticated load, so beta testers don't lose progress.
- **Seed `item_catalog`** with the cosmetics that already exist: verified guitar skins (`shaman_wolf`, `violet_gothic_5`, `melody_pink`, `bone_daddy`, …), Tier 0 titles/frames, Tier 1 note/board/catcher recolors, Tier 2 FX-pack items — **green-fret-1 exception preserved** as a known intentional asset.

---

## 8. Phased roadmap

### Phase A — NOW (client-only, no Lovable, no generations)
1. **P0** fix the unverified-skin bug (verify or pull crimson-chrome/ember-bone/gold-relic). *(blocks honest selling)*
2. **P1** generalize `rr_loadout` + `equipCosmetic(slot,id)` + load-time validation.
3. **P2** ship Tier 0 (pure-data, free progression rewards) + Tier 1 (programmatic recolors); curated Featured store layout.
4. **P3** wire Tier 2 FX from the existing flipbook pack.
5. **P4/P5** surface cosmetics in results/profile/leaderboard/rival-deck; Locker-style equip with live preview.
*All cosmetics earnable client-side; store spends are stubbed against the dormant backend (graceful — `spendSparks` returns `not-authed` when logged out). No money flow yet.*

### Phase B — AFTER LOVABLE (light up the backend)
6. Hand the **corrected** Section 7 spec to Lovable (only after user confirms the single-currency model + content-freeze).
7. Backend goes live → real Sparks balance, server-decided earn at run-end, server-authoritative `/store/buy`, entitlements gating, cross-device loadout, leaderboard.
8. **Direct real-money cosmetic sales** via Stripe webhook (the premium tier). One curated marquee bundle (~$10–15 ceiling).
9. Server-side validation of broadcast cosmetics for ranked/tournament anti-spoof.

### Phase C — BETA LAUNCH & beyond
10. **Strip dev hooks LAST** (`__rrDebug`, `__rrChartStats`, FPS meter, `?novideo`/`?fps`/`?mock`) — only after content-freeze, per the Track-A/Track-B coordination rule.
11. **Phase-2 season pass** (NOT at launch): generous free track + inexpensive (~$10) paid track, both cosmetic, visible ladder, catch-up mechanics — only once we can reliably feed new cosmetics each season (highest conversion ~15–20% but heaviest content load).
12. Prestige cosmetics tied to skill achievements; gentle rotating shop with honest scarcity + earnable catch-up.

---

## 9. Key file references (all absolute, main dir — NOT the stale worktree)
- **`D:\sunoai music plan\animev1\veo 3 round 2\can i pet that dog\cloudcode\v2\catalog.js`** — economy seams: `getUser`/`getMe` (~41), `getSparks` (~81, caches `rr_sparks`), `getStore` (~111), `getEntitlements`/`ownsItem` (~131–143, sync `_entitlements` cache), `spendSparks` (~146, idempotent, 402/409), `api()` (~164), supabase client (~21–36).
- **`…\v2\game.js`** — equip layer: `SKIN_GEOM` + `verified` gate (~561–599; **unverified crimson-chrome/ember-bone/gold-relic at ~590–598 = the bug**), `_skinVerified` (~675), `equipGuitarSkin`/`setGuitarSkin`/`applyEquippedSkin` (~692–714), art-vs-geometry split.
- **`…\v2\index.html`** — store overlay `#store-screen` (~3915–3935), store controller w/ `STORE_FALLBACK`/`SKIN_GUITAR`/buy/equip (~5725–5979, merge logic ~5945–5950), library icons `#profile-open`/`#levels-open`/`#store-open` (~3564–3573), identity chip → Career/site (~6037–6039).
- **`…\v2\LOGIN_SPARKS_BRIEF.md`** — the **existing** backend brief this plan's Section 7 supersedes on the money model (keep endpoint shapes, change money funnel to direct sales + earn-only Sparks).
- **FX pack** — `assets/fx` flipbook (manifest + `fx-player.js`), co-owned with the engine agent (union-managed manifest — watch name collisions) → Tier 2 source.
- **Skin pipeline** — i2i from `assets/guitars/crimson-chaos-ryo.png` → PIL cutout → `_measure_adaptive.py` (≥8 clean rows + Read overlay) → `SKIN_GEOM verified:true`.

## 10. Open questions for the user (confirm before Phase B / generations)
1. **Confirm the model pivot:** single EARNED Sparks + **direct real-money** cosmetic sales (this plan), replacing `LOGIN_SPARKS_BRIEF.md`'s "real money buys Sparks"? 
2. **Earn formula values:** base reward, difficulty multipliers, daily cap, first-clear bonus magnitude.
3. **Existing site wallet:** does ReactivVibe already have a Sparks wallet table + Stripe flow to reuse, or create fresh?
4. **Tier 3 curated set:** which 3–6 new guitar-skin themes to approve for the gated generation pipeline (so I can hand exact prompts + target filenames)?
5. **Content-freeze timing:** when to send the Section 7 spec to Lovable and when to strip dev hooks.