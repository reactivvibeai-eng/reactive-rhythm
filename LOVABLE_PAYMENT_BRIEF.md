# Reactive Rhythm — Payment / Revenue Capture Brief

> **Audience:** the Lovable platform agent (backend) **and** the game-side lead (client wiring).
> **Purpose:** make the game's real-money economy actually capture revenue — let a real dollar enter
> the system and grant an entitlement. This is the single highest-leverage launch gap: today the
> store can *spend* Sparks but there is **no way to acquire them**, so revenue is $0.
>
> **Owner decision (LOCKED, 2026‑06‑25):** **"Platform handles payment."** The cashable Sparks
> top‑up / checkout lives on the **platform** (reactivvibeai.com / the Lovable backend) — **NOT**
> inside the game. The game never sees a card, never runs Stripe, never mints cashable Sparks. It
> deep‑links out to the platform top‑up, then re‑reads the (server‑authoritative) balance on return.

---

## 0. Read this first — the model is now DECIDED (resolves a doc contradiction)

Two monetization docs in this folder **contradict each other** on the money funnel:

| Doc | Money model it specs |
|---|---|
| **`MONETIZATION.md`** | **Two currencies.** Cashable **Sparks** = real money, bought on the platform; gameplay mints **only Bonus Sparks** (soft, non‑cashable, cosmetics‑only). |
| **`MONETIZATION_PLAN.md`** (§1, §7, §10‑Q1) | **Single EARNED Sparks** + **direct real‑money cosmetic sales** via a Stripe webhook — Sparks would be earn‑only and **never purchasable**. Explicitly marked **"DRAFT — DO‑NOT‑SEND‑YET,"** pending owner confirmation. |

**The owner's decision resolves this in favor of the two‑currency model.**

- ✅ **`MONETIZATION.md` is now AUTHORITATIVE** for the money model. It matches the shipped code
  (`getSparks`/`spendSparks`/`/sparks/*` cashable family vs the separate Bonus‑Sparks family in
  `catalog.js`).
- ⚠️ **`MONETIZATION_PLAN.md` §7 + §10‑Q1 are SUPERSEDED on the money funnel only.** Its
  single‑currency / direct‑Stripe‑sale path is **rejected** by the owner. The rest of that doc
  (cosmetic taxonomy, loadout generalization, anonymous‑first auth, the unverified‑skin P0 bug, the
  server‑authoritative security invariants, the asset gate) **remains valid** and should still guide
  the store/cosmetic build — only the "how a dollar enters" section changes.
- The one change vs `MONETIZATION_PLAN.md` §239: there **is** a Sparks top‑up path (the platform
  one), and it **is** a top‑up/credit flow — not a per‑item direct‑sale converter. Real money buys
  **Sparks**; Sparks (server‑authoritative) buy entitlements via the already‑coded `/sparks/spend`.

**The chosen model, in one line:**
> **Cashable Sparks** = real money, acquired via a **platform top‑up** (reactivvibeai.com), spent
> in‑game server‑side via `/sparks/spend`. **Bonus Sparks** = earned by play, non‑cashable,
> cosmetics‑only, capped at **50/week**. Gameplay **NEVER** mints cashable Sparks.

---

## 1. The goal & the flow (end to end)

```
 ┌─────────────────────────── GAME (reactivvibe.com/play) ───────────────────────────┐
 │  Store overlay → "Get Sparks" button (openGetSparks)                               │
 │       │  sets pendingTopup = true                                                  │
 │       ▼                                                                            │
 │  window.open( SITE_SPARKS )  ──────────────────────────────┐  (new tab)            │
 └────────────────────────────────────────────────────────────┼──────────────────────┘
                                                               ▼
 ┌──────────────────────── PLATFORM (reactivvibeai.com) ──────────────────────────────┐
 │  Top‑up page (sparks=open) → pick a pack ($5/$10/$20/$50) → Stripe Checkout         │
 │       │                                                                            │
 │  Stripe charges the card → checkout.session.completed                              │
 │       ▼                                                                            │
 │  Signed webhook (server) → verify signature + amount → CREDIT cashable Sparks      │
 │       │   (append to the user's server‑authoritative balance, idempotent)         │
 │       ▼                                                                            │
 │  Balance row updated for auth.uid()                                                │
 └────────────────────────────────────────────────────────────────────────────────────┘
                                                               │
   user closes/returns to the game tab → window 'focus' / 'visibilitychange'
                                                               ▼
 ┌─────────────────────────────────── GAME ───────────────────────────────────────────┐
 │  recheckBalance() (pendingTopup) → RhythmCatalog.getSparks() → GET /sparks/balance  │
 │     → new balance paints in the store + header chip; store re‑renders Buy buttons   │
 │  user clicks Buy → POST /sparks/spend (server‑authoritative) → entitlement granted  │
 └────────────────────────────────────────────────────────────────────────────────────┘
```

A dollar enters on the **platform**; the game only **reads** the resulting balance and **spends** it
server‑side. The single new revenue primitive the backend must build is the **top‑up → webhook →
credit** loop. Everything downstream (`/sparks/balance`, `/sparks/spend`, `/store`, `/entitlements`)
is **already shipped and already called by the game.**

---

## 2. BACKEND requirements (Lovable / platform)

The game already calls these — confirm they behave as specced, then **add the top‑up path.**

### 2.1 Endpoints the game ALREADY calls (must keep working)
| Endpoint | Method | Game caller (`catalog.js`) | Contract |
|---|---|---|---|
| `/sparks/balance` | GET (auth) | `getSparks()` | `{ balance:int, signed_in:bool, currency:"sparks" }`. Anon → `{balance:0, signed_in:false}`. **Balance is the server‑authoritative cashable Sparks total. Must reflect a completed top‑up.** |
| `/sparks/spend` | POST (auth) | `spendSparks(item_type,item_id,idem)` | Body `{item_type,item_id,idempotency_key}` → `{ok,balance,granted,deduped}`. `402 insufficient_sparks`, `409 price_mismatch`. **Server re‑reads the price (never trusts the client), checks balance, debits + grants the entitlement atomically, idempotent on the key.** |
| `/store` | GET (auth) | `getStore()` | `{items:[…], balance, signed_in}`. |
| `/entitlements` | GET (auth) | `getEntitlements()` / `ownsItem()` | `{signed_in, owns:[{item_type,item_id}]}` (the client also tolerates `{entitlements:[…]}` and `{type,id}`/string rows). |
| `/me` | GET (auth) | `getUser()` | Identity from the JWT; signed‑out → `200 {user:null}`. |

> All of these are **already live and wired.** The balance read + cache key is `rr_sparks`; the spend
> flow already handles 402/409 and updates the cache. **No game‑side change is owed for these.**

### 2.2 What the backend MUST ADD — the top‑up / checkout (the revenue primitive)

This is **the** missing piece. Build it on the **platform** (reactivvibeai.com), not in the game.

1. **A top‑up entry point (a page/route).** The game deep‑links to it (currently
   `https://reactivvibeai.com/live?sparks=open` — see §3). It must:
   - require the user to be **signed in** (the same Supabase auth the game shares via localStorage —
     so the game's `auth.uid()` and the platform's are the **same user**);
   - present the **top‑up packs** (§2.3);
   - launch **Stripe Checkout** (or the platform's existing payment rails if one already exists —
     **ask the owner: is there already a site Sparks wallet + Stripe flow to reuse?**).

2. **A signed Stripe webhook that CREDITS the balance.** On `checkout.session.completed`:
   - **verify the Stripe signature** (reject unsigned/forged calls);
   - **dedupe on the Stripe event id** (a replayed webhook must not double‑credit);
   - map the line item → a Sparks amount, and **append a positive entry to the
     server‑authoritative balance** for that `user_id` (ideally an **append‑only ledger**, balance =
     derived sum, so it is auditable and refund/chargeback‑reversible).
   - **Grant ONLY on a verified, completed payment.** The client saying "I paid" is **never**
     sufficient. A pending/failed/disputed session credits nothing.

3. **The balance read must reflect the new total immediately after the webhook lands**, so the game's
   on‑return `GET /sparks/balance` shows the post‑purchase number (§3). If Stripe webhook delivery
   can lag, the platform top‑up page should also reconcile the session on its own
   success‑redirect (don't rely solely on the async webhook for the user‑visible number).

4. **Spend stays server‑authoritative.** Top‑up only ever **credits**. Spending happens through the
   existing `/sparks/spend` which **re‑reads the price from the catalog, checks the balance, and
   debits + grants atomically** — the client never names a price or a delta.

### 2.3 Top‑up packs (real‑money entry points)
Anchored on the existing unit **1 Spark = $0.05** (store skins are 50–80 Sparks ≈ $2.50–$4; levels
100–140 ≈ $5–$7). Standard tiering with a **mild bulk discount** so cosmetic/level prices sit *just
past* a common pack size (an honest "need a few more" nudge, not a dark pattern):

| Pack | Price | Sparks (suggested) | Notes |
|---|---:|---:|---|
| Starter | **$5** | ~100 | clears one common skin with a little left |
| Plus | **$10** | ~220 | ~10% bonus — covers a skin + change |
| Pro | **$20** | ~460 | ~15% bonus |
| Mega | **$50** | ~1,200 | ~20% bonus — best value, the whale tier |

> Bonus amounts are **suggested** to A/B; the **price points ($5/$10/$20/$50) and bulk‑discount
> shape are the spec.** Show the **real‑money equivalent** clearly; no opaque currency math.

### 2.4 What the backend must NOT do
- **Never let gameplay mint cashable Sparks.** `/score`/`/plays` must never write a positive cashable
  ledger entry. Gameplay rewards are **Bonus Sparks only** (a separate balance, capped 50/week — see
  §4). This boundary is the most important guardrail in the system; encode it in the backend, not
  just the UI.
- **Never grant on an unverified client claim.** No "I paid" body, query param, or localStorage flag
  grants Sparks — only the signature‑verified, deduped webhook (or a server‑side session reconcile).

---

## 3. GAME‑SIDE integration contract (the lead implements this later)

The game's role is intentionally tiny: **deep‑link out, then re‑read the server balance on return.**
Most of this **already exists** — the change is making the on‑return re‑read also refresh the store
grid + entitlements, not just the header number.

### 3.1 What already exists (reuse, do not rebuild)
- **`SITE_SPARKS`** (`index.html`, store controller): the deep‑link target —
  `'https://reactivvibeai.com/live?sparks=open'`. *(Domain note: the game front is
  reactivvibe.com but auth/Sparks deep‑links correctly point to **reactivvibeai.com** — this is
  intentional per the domain‑split decision; do NOT "fix" it.)*
- **`openGetSparks()`** (`index.html`): sets `pendingTopup = true` then `openSite(SITE_SPARKS)`
  (opens a new tab). Wired to the store's **"Get Sparks"** button (`#store-getmore`) and to the
  "Not enough Sparks → Get Sparks" fallback (`toGetMore`).
- **`pendingTopup`** + **`recheckBalance()`** (`index.html`): on `window 'focus'` and
  `document 'visibilitychange'` (when not hidden), if `pendingTopup` is set it calls
  `RhythmCatalog.getSparks()` → `GET /sparks/balance` and repaints the store balance, then clears
  the flag.
- **`RhythmCatalog.getSparks()`** (`catalog.js`): auth'd `GET /sparks/balance`, caches `rr_sparks`,
  falls back to cache when logged‑out / on a backend hiccup.
- **`window.__rrSparksRefresh`** (`index.html`, header chip script): re‑reads the user + balance and
  repaints the **header Sparks chip**. *(This is a dev/test hook today — see §6.)*

### 3.2 The minimal game‑side change to wire
> **✅ build100b — the high‑value game side is now DONE.** `recheckBalance()` (the `pendingTopup`
> path) now also calls `refreshEntitlements()` on return, so a platform‑granted/restored entitlement
> flips owned items to **Equip** the moment `/entitlements` returns it — no reload. And the
> insufficient‑Sparks CTA now deep‑links out with **`&need=<item price>`** (`reactivvibeai.com/live?sparks=open&need=NN`)
> so the top‑up page can pre‑select the smallest covering pack. These are READ paths — they just need
> the backend endpoints below to return real data. (Remaining optional game nicety: also call
> `window.__rrSparksRefresh()` so the header chip updates when the user returns with the store closed.)

On return from a top‑up, `recheckBalance()` repaints the **store balance number** and (build100b) the
store grid + entitlements. The full on‑return refresh the backend enables:

1. In `recheckBalance()` (the `pendingTopup` path), after `getSparks()` resolves, also:
   - re‑render the store grid / Buy buttons against the new balance (the store controller's
     `setBalance(...)` + a `render()` — so a previously‑unaffordable item flips to a live **Buy**),
   - call **`RhythmCatalog.getEntitlements()`** → `refreshEntitlements()` (covers the case where the
     platform top‑up flow also granted/restored an entitlement, so owned items flip to **Equip**),
   - call **`window.__rrSparksRefresh()`** so the **header chip** updates too (not just the store
     overlay), since the user may return with the store closed.
2. Keep the **focus + visibilitychange** listeners as the trigger (already present) — they're the
   correct "user came back from the top‑up tab" signal. The `pendingTopup` guard keeps it cheap (only
   fires after an actual deep‑link‑out, not on every tab switch).
3. **No new endpoints, no payment UI, no Stripe** in the game. The game only **reads**
   `/sparks/balance` + `/entitlements` and **spends** via the already‑wired `/sparks/spend`.

> Net game‑side change: ~a few lines extending `recheckBalance()` to also refresh
> store grid + entitlements + header chip. Bump `?v=NN` on the edit (per project convention).

---

## 4. Security / integrity (non‑negotiable)

- **Spend + balance are server‑authoritative — never trust the client.** The browser READS its own
  balance/entitlements (RLS `user_id = auth.uid()`) but **never writes** grants, prices, currency, or
  purchases. Every mutation goes through a server function that derives `user_id` from the JWT (not
  the request body), re‑reads the price from the catalog, and writes with the service role.
- **Cosmetic‑only enforcement.** Nothing purchasable (with **either** currency) may affect notes,
  timing windows, scoring, hit‑detection, or any leaderboard outcome. Skins/themes/FX are visual
  only. This is structurally true (notes ride pixel‑measured string positions; a skin only changes
  which image blits) **and** must remain a QA check. **No pay‑to‑win, ever.**
- **Gameplay mints ONLY Bonus Sparks, capped 50/week.** Cashable Sparks are **bought, full stop** —
  `/score`/`/plays` never credit them. Bonus Sparks live in a separate balance (`rr_bonus_sparks`
  today; a `/bonus-sparks/*` swap‑seam later), are **non‑cashable**, spent only on cosmetics, and
  hard‑capped at `BONUS_WEEKLY_CAP = 50` per ISO week. If cashable Sparks were ever minted by play,
  the game becomes a money printer (bot/macro farming → fraud + chargeback exposure). **This is the
  most important guardrail in the whole system.**
- **Guest Bonus‑Sparks reconciliation (P3, backend).** A signed‑out guest can earn + spend Bonus
  Sparks; those cosmetic unlocks persist only in `localStorage` (`rr_bonus_owns`), so they survive on
  the same device but are **lost on sign‑in from a new device**. When a guest authenticates, **merge
  their local `rr_bonus_owns` cosmetic unlocks into the account entitlement set** (one‑time, additive,
  cosmetics‑only — never touches cashable Sparks) so earned skins follow the account. Low‑stakes
  (non‑cashable, same‑device‑safe today) but the right long‑term home is the account.
- **Real‑money grants fire CLOSED, only from a verified webhook.** Signature‑verified + deduped on
  the Stripe event id; a pending/failed/disputed payment grants nothing.
- **Idempotency end‑to‑end.** Top‑up credit deduped on the Stripe event id; `/sparks/spend` deduped
  on the per‑intent `idempotency_key` the game already sends (one key per purchase intent, reused
  across retries so a lost‑response re‑click can't double‑charge).
- **Admin/owner unlock stays gated to the authenticated owner email.** Already implemented:
  `ADMIN_EMAILS = ['reactivvibeai@gmail.com']`, keyed on the **authenticated Supabase session email**
  (a signed JWT via `getUser`), **not** a query param or localStorage flag. The localhost/`?dev`
  dev‑unlock is **localhost‑only** (hardened in build65/66; it does NOT unlock paid content in
  production). **Add both to the test checklist (§5) — a regression here is a consumer paywall
  bypass.**

---

## 5. Revenue‑readiness checklist (ordered by leverage)

What blocks launch revenue **today**, highest‑impact first:

1. **🔴 #1 — No top‑up path exists.** The single highest‑leverage gap. The store can *spend* Sparks
   but there is **no way to buy them**, so revenue is structurally $0. **Build the platform top‑up →
   signed Stripe webhook → credit‑balance loop (§2.2) + the $5/$10/$20/$50 packs (§2.3).** Nothing
   else matters until a dollar can enter.
2. **🟠 #2 — On‑return re‑read is partial.** The game repaints only the balance number on return, not
   the store grid / entitlements / header chip. **Broaden `recheckBalance()` (§3.2)** so a fresh
   top‑up (and any granted entitlement) appears without a reload — otherwise a paying user doesn't
   see what they just bought and bounces.
3. **🟡 #3 — Integration round‑trip unproven.** Run **one live purchase→balance→spend→entitlement→
   unlock round‑trip** against the real backend before exposing a paid SKU in the gated beta. Confirm
   the webhook credits, the balance reflects it, the spend debits + grants, and `ownsItem` flips the
   card to Equip. (The client entitlements read is already correct — build50/58 — so this is a
   verify, not a code change.)
4. **🟡 #4 — Bundles / AOV.** Lift average order value: ensure cosmetic/level prices sit just past a
   common pack (the honest nudge), and surface a "best value" Mega pack. Later: themed level/season
   bundles at a ~25–35% discount vs à la carte.
5. **🟢 #5 — Exclusivity / desirability.** Cosmetics players actually want to pay for — featured/
   curated store layout, prestige looks tied to achievements, visible‑everywhere equipped cosmetics
   (results, Career, leaderboards, multiplayer rival decks). Conversion follows desire.
6. **🟢 #6 — Analytics.** Instrument top‑up start→complete, pack mix, spend‑per‑user, cosmetic attach
   rate, and Bonus→Sparks funnel, so earn rates and prices can be tuned with data, not guesses.

### Test checklist (gate before the first paid SKU goes live)
- [ ] Top‑up of each pack ($5/$10/$20/$50) credits the **correct** Sparks total, server‑side.
- [ ] Webhook is **signature‑verified** and **deduped** (replay a `checkout.session.completed` →
      balance does **not** double‑credit).
- [ ] A pending/failed/disputed session credits **nothing**.
- [ ] On return to the game tab, the new balance **and** any granted entitlement appear with **no
      reload** (store grid + header chip + Equip state) (§3.2).
- [ ] `/sparks/spend` re‑reads the catalog price (tamper the client price → `409 price_mismatch`),
      debits + grants atomically, and is idempotent on a replayed `idempotency_key`.
- [ ] Gameplay credits **only Bonus Sparks**, capped at 50/week; **never** cashable Sparks.
- [ ] Cosmetic‑only: no purchasable item changes notes/timing/scoring/leaderboard.
- [ ] Admin unlock works **only** for the authenticated owner email; a guest / spoofed query param /
      localStorage flag does **not** unlock paid content; `?dev`/localhost does **not** unlock in
      production.

---

## 6. Notes & cross‑references
- **Dev hooks to strip at content‑freeze (LAST):** `window.__rrSparksRefresh`, `window.__rrDebug`,
  `window.__rrChartStats`, the FPS‑meter block, and the `?novideo`/`?fps`/`?mock` flags. If §3.2
  reuses `__rrSparksRefresh` for the header refresh, either keep a non‑dev internal alias for it or
  inline the chip refresh — don't let stripping the dev hook break the on‑return balance paint.
- **Bonus‑Sparks swap‑seam:** the Bonus family (`getBonusSparks`/`awardBonusSparks`/
  `spendBonusSparks`/`bonusBuy`) is client‑side localStorage today with a documented swap‑seam to a
  future `/bonus-sparks/*` API. Move the **weekly cap + balance server‑side before Bonus has real
  economic weight** (a modded client can currently mint Bonus locally). Out of scope for *this*
  brief — this brief is the **cashable** path — but flagged so it isn't forgotten.
- **Authoritative docs:** money model → **`MONETIZATION.md`** (this brief implements its top‑up).
  Cosmetic taxonomy / loadout / auth / asset gate → **`MONETIZATION_PLAN.md`** §§1–6, 8–9 (valid);
  its §7/§10‑Q1 money funnel is **superseded** by the owner decision captured here.
- **Open question for the owner / Lovable:** does reactivvibeai.com **already** have a Sparks wallet
  table + Stripe flow to reuse, or is the top‑up built fresh? Either way the game‑side contract (§3)
  is unchanged.
