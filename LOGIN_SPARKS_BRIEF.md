# LOGIN_SPARKS_BRIEF.md — Login/SSO + Sparks + Entitlements + Score backend (hand to the Lovable agent)

## Goal
Make the rhythm game (**Reactive Rhythm**, shipping at `reactivvibe.com/play`) a first-class part of the
ReactivVibe account: **(A)** log in with the *same* account as the website, **(B)** read & spend the
account's **Sparks** currency (server-authoritative), **(C)** know what the account **owns** (packs / paid
levels / add-ons), and **(D)** persist scores to the existing leaderboard, account-linked, with no extra
token. The game is a **static front end** (vanilla JS + Canvas 2D, no build step). It already loads
`supabase-js` and reads the shared Supabase session. **Build the backend below; the game-side code is being
written against this exact contract.**

This brief covers everything that is currently *dormant or stubbed* in the game so the Lovable agent can light
it up. It maps to ROADMAP **PHASE D (D1–D4)** and reuses the same `game-catalog` edge-function conventions
already in production (`/tracks`, `/track/:id`, `/plays`, `/uses`, `/leaderboard/:id`).

---

## 0) What already exists on the game side (READ — do not duplicate)
The Lovable agent should treat these as the integration surface. Paths are relative to the project root.

- **`index.html`** — `window.RHYTHM_CONFIG` (the only config the game reads):
  ```js
  window.RHYTHM_CONFIG = {
    API_BASE:     'https://bxiejoktoknybpraxebm.supabase.co/functions/v1/game-catalog',
    SUPABASE_URL: 'https://bxiejoktoknybpraxebm.supabase.co',
    SUPABASE_KEY: '<publishable/anon JWT — safe client-side>'
  };
  ```
  This is **the same Supabase project as the website.** `SUPABASE_KEY` is the anon/publishable key.
- **`catalog.js`** — the live layer (`window.RhythmCatalog`). It already:
  - Creates a Supabase client with the **default storageKey** so a same-origin embed *inherits the website's
    login session from `localStorage`* (no override):
    ```js
    supa = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY,
      { auth: { storage: window.localStorage, persistSession: true, autoRefreshToken: true } });
    async function getToken(){ const {data}=await supa.auth.getSession();
      return data?.session ? data.session.access_token : null; }
    ```
  - Has a single API helper every backend call goes through:
    ```js
    async function api(path, { method='GET', body=null, auth=false } = {}) {
      const headers = { 'content-type':'application/json' };
      if (auth) { const tk = await getToken(); if (tk) headers.authorization = 'Bearer ' + tk; }
      const res = await fetch(API_BASE + path, { method, headers, body: body?JSON.stringify(body):undefined });
      ... // throws on !res.ok, parses {error} for the message
    }
    ```
    **So: every endpoint below is `API_BASE + <path>`. When `auth:true`, the request carries
    `Authorization: Bearer <Supabase user session JWT>`. When the user is logged out, no Authorization header
    is sent** (the helper just omits it).
  - **Already POSTs `/score`** (currently dormant — it succeeds silently if the backend isn't there, falls back
    to local-only, and nudges "Sign in on ReactivVibe…" when there's no token). This brief makes `/score` real.
  - Already does revenue attribution: `getPackId()` reads `?pack=<id>` from the embed URL, and `logUse(trackId,
    eventType, opts)` fire-and-forget POSTs `/uses` (anon OK; user_id added when a JWT is present). The catalog
    also surfaces `pack_ids[]` per track. **Entitlements (C) should reuse this `pack` vocabulary.**
- **`#levels-screen`** (in `index.html`) — the campaign/level scaffold. Levels read a client map (`rr_levelmap`,
  3 tiers × 6) and a `CAMPAIGN_PUBLIC` flag. Today unlock is **star-gated & client-side only**. Entitlements (C)
  layer **paid/owned** unlocks on top of (not replacing) the star progression.
- **`#profile-screen`** (`rr_career`) — local career aggregate. Sparks/entitlements will enrich it once live.
- **Beta gate** — separate, already briefed in `BETA_GATE_BRIEF.md` (`/beta/status`, `/beta/redeem`). Keep that
  contract intact; this brief is additive.

**House conventions to follow:** extend the existing `game-catalog` edge function (or add sibling functions
behind the same base — the game only needs the *paths* to resolve under `API_BASE`). Return JSON. On error
return `{ "error": "<machine-readable-code>" }` with a non-2xx status (the game reads `.error`). All
currency/entitlement mutations are **server role only** behind RLS.

---

## A) LOGIN / SSO — same account as the website

**No new endpoint is required for login itself** — the game uses Supabase Auth and inherits the website's
session. The Lovable agent's job is to make the inheritance *work* and expose one small **identity** endpoint
so the game can render "Signed in as …".

### Requirement L1 — same-origin session sharing (the real unblock)
The game can only read the website's login if it shares `localStorage` with it. That means **serve the game
same-origin** with the site, e.g. `https://reactivvibe.com/play` (or `/games/reactive-rhythm`). Then supabase-js
finds the existing `sb-<projectref>-auth-token` key and the session "just works" — no new login.
- **Confirm:** the site stores its Supabase session under the **default storage key** (it does if it uses the
  standard `createClient` without a custom `storageKey`). If the site overrides `storageKey`, tell us the exact
  key so we can match it.
- **If the game must live on a different origin** (iframe / subdomain), say so — then we need either (a) a
  postMessage handshake from the parent page passing the access token, or (b) a short-lived token-exchange
  endpoint. Same-origin is strongly preferred; pick it if at all possible.

### Endpoint L2 — `GET /me`  (identity)
Auth: `Authorization: Bearer <token>` (the game sends `auth:true`). Anonymous → `200 { "user": null }`.
- **Response (signed in):**
  ```json
  { "user": { "id":"<uuid>", "display_name":"Riff Lord", "avatar_url":"https://…", "email_verified":true } }
  ```
- **Response (signed out):** `{ "user": null }`  (HTTP 200 — logged-out is a normal state, not an error).
- Derive identity from the JWT (`auth.uid()`); join the site's existing profile table for `display_name` /
  `avatar_url`. **Never accept a user id from the request body — only from the verified JWT.**

### Security notes (A)
- **The JWT is the only source of identity.** The edge function must verify the Supabase JWT (signature + exp)
  and use `auth.uid()`; never trust a client-supplied `user_id`.
- CORS: allow the game's origin(s) and the `Authorization`, `apikey`, `content-type` headers. (The existing
  `game-catalog` function already does this for the live catalog — match it.)
- Logged-out is first-class: every endpoint must degrade gracefully (no 500s when there's no token).

---

## B) SPARKS — currency (read balance + server-authoritative idempotent spend)

Sparks is the in-game currency, shared with the website wallet (same account = same Sparks). **The client never
computes or asserts a balance.** It reads the balance and *requests* spends; the server is the sole authority.

### Tables (Supabase)
**`sparks_wallets`** — one row per account (or reuse the site's existing wallet table if one exists; if so, tell
us the table/columns and skip this).
| column | type | notes |
|---|---|---|
| `user_id` | uuid → auth.users, **PK** | the account |
| `balance` | bigint, default 0 | current Sparks; **never negative** |
| `updated_at` | timestamptz, default now() | |

**`sparks_ledger`** — append-only audit of every change (earn, spend, top-up, refund).
| column | type | notes |
|---|---|---|
| `id` | uuid, PK | |
| `user_id` | uuid → auth.users | |
| `delta` | bigint | negative = spend, positive = grant/top-up |
| `reason` | text | `'spend:pack'`, `'spend:level'`, `'earn:play'`, `'topup:stripe'`, `'refund'` … |
| `ref_type` | text, null | `'pack'`, `'level'`, `'stripe_session'`, … |
| `ref_id` | text, null | the pack/level/session id |
| `idempotency_key` | text, **unique** | client-supplied for spends; dedupes retries |
| `balance_after` | bigint | snapshot for audit |
| `created_at` | timestamptz, default now() | |

### Endpoint B1 — `GET /sparks/balance`
Auth required. Anonymous → `{ "balance": 0, "signed_in": false }`.
- **Response:** `{ "balance": 1240, "signed_in": true, "currency": "sparks" }`
- Read-only; reflects `sparks_wallets.balance` for `auth.uid()`. Cheap — the game polls it after a spend and
  on store open.

### Endpoint B2 — `POST /sparks/spend`  (idempotent, server-authoritative)
Auth required. The **only** way the game removes Sparks.
- **Request:**
  ```json
  {
    "amount": 500,
    "item_type": "pack",            // "pack" | "level" | "addon"
    "item_id": "synthwave-vol1",
    "idempotency_key": "spend_8f2a…"  // client-generated UUID, unique per intent
  }
  ```
- **Server logic (all inside ONE transaction):**
  1. Resolve the user from the JWT (`auth.uid()`). No token → `401 {"error":"login_required"}`.
  2. **Look up the price of `item_type`+`item_id` from a server-side `store_items` table — do NOT trust
     `amount` from the client.** If client `amount` ≠ server price → `409 {"error":"price_mismatch","price":<server_price>}`.
  3. If a ledger row with this `idempotency_key` already exists → **return the prior result unchanged**
     (`{ "ok":true, "balance": <current>, "deduped": true }`). This makes retries safe.
  4. If `balance < price` → `402 {"error":"insufficient_sparks","balance":<current>,"price":<price>}`.
  5. Atomically: `balance -= price`, insert the ledger row, **grant the entitlement** (insert into
     `entitlements`, section C) — all or nothing.
  6. Return:
     ```json
     { "ok": true, "balance": 740, "granted": { "item_type":"pack", "item_id":"synthwave-vol1" }, "deduped": false }
     ```
- **Never let balance go negative.** Use a conditional update (`UPDATE … WHERE balance >= price`) or `SELECT …
  FOR UPDATE` so two concurrent spends can't both succeed.

### Endpoint B3 (optional) — `POST /sparks/earn`  (gameplay rewards, if we award Sparks for playing)
Auth required. **Server decides the reward — never the client.** The client may POST a completed run reference
(or this is folded into `/score`, see D); the server computes Sparks from its own scoring rules and writes a
positive ledger row. If you don't want gameplay-earned Sparks at launch, skip this; the game treats earning as
optional. **Do not let the client name the amount.**

### Security notes (B) — the hard rules
- **NEVER trust the client for currency.** Prices live server-side (`store_items`); balances change only inside
  transactions on the edge function with the **service role**. The client's `amount` is validated, not obeyed.
- **Idempotency:** the `idempotency_key` UNIQUE constraint is the dedupe mechanism — a double-tap, a retry after
  a flaky network, or a replayed request all collapse to one spend. The endpoint must be safe to call twice.
- **RLS:** `sparks_wallets` and `sparks_ledger` are **NOT client-writable**, ever. Reads of *one's own* wallet
  may be allowed via RLS (`user_id = auth.uid()`) if you prefer the game read the table directly, but the
  `/sparks/balance` endpoint is the supported path; ledger rows are never client-readable in bulk.
- **Rate-limit** `/sparks/spend` per user (e.g. ≤ 10/min) — a spend storm is either a bug or an attack.
- Wrap balance mutation + entitlement grant in **one DB transaction**: a spend that deducts Sparks but fails to
  grant the item (or vice-versa) is a refund ticket. Atomic or nothing.

---

## C) ENTITLEMENTS — what the account owns (packs / levels / add-ons)

Entitlements are the **durable record of what's unlocked** for an account — earned by spending Sparks (B2),
bought with money (D), or granted (gift/promo). The game asks "what do I own?" once on load and gates content.

### Table — `entitlements`
| column | type | notes |
|---|---|---|
| `id` | uuid, PK | |
| `user_id` | uuid → auth.users | owner |
| `item_type` | text | `'pack'` \| `'level'` \| `'addon'` |
| `item_id` | text | matches `store_items.item_id` / the catalog's `pack_ids[]` |
| `source` | text | `'sparks'` \| `'stripe'` \| `'grant'` \| `'beta'` |
| `granted_at` | timestamptz, default now() | |
| unique (`user_id`,`item_type`,`item_id`) | | own a thing once |

### Table — `store_items` (the price list — source of truth for B2 and the store UI)
| column | type | notes |
|---|---|---|
| `item_type` | text | `'pack'` \| `'level'` \| `'addon'` |
| `item_id` | text | stable slug, e.g. `synthwave-vol1` |
| `title` | text | "Synthwave Vol. 1" |
| `price_sparks` | bigint, null | Sparks cost (null = not buyable with Sparks) |
| `price_usd_cents` | int, null | real-money cost (null = not directly buyable for money) |
| `stripe_price_id` | text, null | for D4 |
| `active` | bool, default true | |
| `sort` | int | display order |
| `meta` | jsonb | art url, track_ids[], level refs, blurb |

### Endpoint C1 — `GET /entitlements`
Auth required. Anonymous → `{ "owns": [], "signed_in": false }`.
- **Response:**
  ```json
  { "signed_in": true,
    "owns": [ {"item_type":"pack","item_id":"synthwave-vol1"},
              {"item_type":"level","item_id":"fracture-boss"} ] }
  ```
- The game caches this and unlocks the matching packs / levels / add-ons. **Authoritative for gating** — the
  game must re-check entitlement before launching paid content (don't rely on a stale client flag).

### Endpoint C2 — `GET /store`  (the catalog the in-game Store renders)
Auth optional (prices are public; ownership shown if signed in).
- **Response:**
  ```json
  { "items": [
      { "item_type":"pack","item_id":"synthwave-vol1","title":"Synthwave Vol. 1",
        "price_sparks":500,"price_usd_cents":299,"owned":false,
        "meta":{"art":"…","blurb":"6 neon tracks","track_count":6} }
    ],
    "balance": 1240, "signed_in": true }
  ```
- `owned` is computed per-user from `entitlements` when a token is present (false/absent when logged out).

### How entitlements gate the existing scaffolds
- **Packs ↔ catalog:** the live catalog already carries `pack_ids[]` per track and the embed reads `?pack=`.
  A pack entitlement unlocks playing/charting that pack's tracks in the library beyond a free preview.
- **Paid levels ↔ `#levels-screen`:** keep the **star-gated** progression as-is for free tiers; a `level`
  entitlement unlocks a **paid** tier/boss level *in addition to* the star requirement. The game checks
  `owns[]` before launch; locked paid levels show a "Unlock for N Sparks" card that calls B2.
- **Add-ons ↔ gameplay modifiers:** cosmetic/feature add-ons (themes, modifiers, extra difficulties) are
  `addon` entitlements; the game reads `owns[]` to toggle them.

### Security notes (C)
- **Entitlements are written server-side only** (by B2's transaction, by D's Stripe webhook, or by an admin
  grant). **Never** via a client write. RLS: a user may *read their own* entitlements (`user_id = auth.uid()`)
  but never insert/update/delete.
- The game's unlock UI is **convenience, not enforcement** — the server re-verifies ownership on any action that
  matters (launching a paid level, charting a paid pack). Treat the client flags as hints.
- `store_items` is the single price source; never let the store UI's displayed price drive a charge.

---

## D) `/score` — leaderboard, token-less-friendly, account-linked → `game_plays`

The game **already calls this** (dormant). Make it real. It records a completed run to the existing
`game_plays` / `game_leaderboard` tables, linked to the account, and returns the player's rank + the top board.

### Endpoint D1 — `POST /score`  (the game already sends this exact body)
Auth: `Authorization: Bearer <token>` (game sends `auth:true`). **"Token-less" means:** when the user is logged
out the game still *attempts* it; the server should respond `401 {"error":"login_required"}` and the game shows
the "Sign in to save your score" nudge (already wired). A signed-in run is recorded and ranked.
- **Request (verbatim from `catalog.js`):**
  ```json
  { "track_id":"<uuid>", "difficulty":"easy|medium|hard",
    "score": 184200, "accuracy": 0.962, "max_combo": 312,
    "notes_hit": 540, "notes_total": 561 }
  ```
- **Server logic:**
  1. Verify JWT → `auth.uid()`. No token → `401 {"error":"login_required"}` (game falls back to local-only).
  2. Validate `track_id` exists and `difficulty` ∈ {easy,medium,hard}; clamp/validate `accuracy` ∈ [0,1],
     `score`/`combo`/`notes` ≥ 0 and self-consistent (`notes_hit ≤ notes_total`). Reject implausible scores
     (e.g. `score` above a theoretical max for the chart) → `422 {"error":"invalid_score"}`.
  3. Insert into `game_plays` (user_id from JWT, track_id, difficulty, score, accuracy, max_combo, notes_hit,
     notes_total, created_at). Update `game_leaderboard` to keep the user's **best** per (track, difficulty).
  4. Compute the user's global rank for that (track, difficulty).
- **Response:**
  ```json
  { "ok": true, "rank_global": 7, "personal_best": true }
  ```

### Endpoint D2 — `GET /leaderboard/:trackId?difficulty=hard&limit=10`  (already called by the game)
Auth optional. **Response (the game already renders this shape):**
```json
{ "leaderboard": [
    { "rank":1, "display_name":"Riff Lord", "score":201340, "accuracy":0.981 },
    { "rank":2, "display_name":"anon",       "score":188900, "accuracy":0.95 }
] }
```
This endpoint name already exists for server-charted tracks; ensure it also covers in-browser-charted runs
submitted via D1 (today *all* live tracks are in-browser-charted, so this is the main path).

### Security notes (D)
- **Identity from JWT only** (`auth.uid()`), never from the body. The body carries gameplay numbers, not who you
  are. (The body has no `user_id` — keep it that way.)
- **Anti-cheat is server-side:** validate ranges + plausibility; **rate-limit** submissions per user (a run
  takes ~2–4 min, so >1 submit / few seconds for the same track is suspect). Optionally require the score to be
  consistent with a server-known chart difficulty. Until charts are server-baked, treat the beta leaderboard as
  "honor-system with sanity bounds" and label it as beta.
- **RLS:** `game_plays` / `game_leaderboard` are written **server-side only**; reads (the public leaderboard)
  may be anon-allowed via RLS or via the `/leaderboard/:id` endpoint. A user must not be able to write another
  user's plays or edit the board directly.
- Idempotency is less critical here (a duplicate play is mostly harmless) but de-dupe an identical
  (user, track, difficulty, score, created within N seconds) to avoid double-counts from retries.

---

## How the game will call this (maps to `RhythmCatalog` / `RHYTHM_CONFIG`)

All calls go through the existing `api(path, {method, body, auth})` helper in `catalog.js`. Same-origin embed →
`getToken()` returns the website's session JWT automatically. Mapping:

| Feature | Game call (via `api()`) | Surfaced on `window.RhythmCatalog` |
|---|---|---|
| A · identity | `api('/me', { auth:true })` | new `getMe()` → "Signed in as …" chip + sign-in nudge |
| B · read balance | `api('/sparks/balance', { auth:true })` | new `getSparks()` → in-game Sparks HUD chip |
| B · spend | `api('/sparks/spend', { method:'POST', auth:true, body:{amount,item_type,item_id,idempotency_key} })` | new `spendSparks()` → Store buy buttons; refreshes balance + entitlements on `ok` |
| C · ownership | `api('/entitlements', { auth:true })` | new `getEntitlements()` → unlock packs in library + paid levels in `#levels-screen` |
| C · store list | `api('/store', { auth:true })` | new `getStore()` → in-game Store grid |
| D · submit score | `api('/score', { method:'POST', auth:true, body:{…} })` | **already wired** in `recordLocal()` |
| D · board | `api('/leaderboard/'+id+'?difficulty=…&limit=10')` | **already wired** (`onSubmitResult` renders it) |

The game already: reads `?pack=` (`getPackId()`) and POSTs `/uses` for attribution (`logUse()`); records every
run locally (`recordLocal()` → `rr_career`, cover-art grades) regardless of backend; and falls back cleanly when
logged out or when the backend is absent (no regressions). So **shipping these endpoints is purely additive** —
nothing breaks if a path 404s during rollout; features simply light up as each endpoint goes live.

---

## Monetization model (packs / add-ons / paid levels) + where Stripe vs Sparks fit

**Two currencies, one wallet model:**
- **Sparks = the in-game soft currency** (already a website concept). Players spend Sparks to unlock **packs**
  (song bundles), **paid levels** (premium tiers/boss levels in the campaign), and **add-ons** (themes,
  modifiers, extra difficulties). Every spend is server-authoritative + idempotent (section B) and grants a
  durable **entitlement** (section C). Optionally, gameplay can *earn* small Sparks (B3) to drive the loop.
- **Real money (Stripe) = how you get Sparks (or buy a pack outright).** Top-ups are a *funding* step, not a
  gameplay step.

### D4 — Stripe top-ups (where real money enters)
Two supported shapes — pick per item; both end at the **same entitlement/ledger writes**, so the game side is
identical:
1. **Buy Sparks (preferred / primary):** the player buys a Sparks bundle with money, then spends Sparks in-game.
   - Recommended flow: the in-game Store's "Get Sparks" button **deep-links to the website's existing Sparks
     purchase / Stripe Checkout** (since the website already owns billing + the user's payment context). On
     return, the game re-reads `GET /sparks/balance`. This keeps card handling off the game entirely.
   - Backend: a **Stripe webhook** (`checkout.session.completed` / `payment_intent.succeeded`) credits Sparks
     by writing a positive `sparks_ledger` row (`reason:'topup:stripe'`, `ref_id:<session_id>`,
     `idempotency_key:<stripe event id>`). **The webhook is the trust boundary — never credit Sparks from a
     client "I paid" callback.** Verify the Stripe signature; dedupe on the Stripe event id.
2. **Buy a pack/level directly for money (optional):** `store_items.price_usd_cents` + `stripe_price_id`. A
   Checkout for that price; the webhook writes the **entitlement** directly (`source:'stripe'`) instead of
   Sparks. Use this for premium packs you don't want priced in Sparks.

**Recommended default:** real money buys **Sparks** (one funnel, one webhook), and *everything in-game is priced
in Sparks*. Direct-USD packs are a later option. This keeps the in-game economy simple (one currency) and routes
all card processing through the website's proven Stripe setup; the game never touches a card. (Stripe MCP is
available when wiring the webhook/products.)

### Security notes (monetization)
- **The Stripe webhook is the ONLY thing that mints Sparks or grants paid entitlements from money** — verify the
  signature, dedupe on the event id, and write inside a transaction. A client must never be able to claim a
  purchase.
- Prices live in `store_items` (Sparks) and Stripe (money) — server-side only. The game displays them but never
  drives a charge from a client-supplied amount.
- Keep **earning** (B3) and **buying** (D4) writes as positive ledger rows with distinct `reason`s, so the
  economy is fully auditable.

---

## U — open questions for the user (please confirm before/while building)
- **Origin:** will the game be served **same-origin** with the site (`reactivvibe.com/play`)? (Decides whether
  SSO "just works" via shared `localStorage`, or needs a postMessage/token-exchange — section A.)
- **Existing wallet:** does the website already have a Sparks wallet table + a Stripe Sparks-purchase flow we
  should reuse (tell us the table/columns/Checkout), or do we create `sparks_wallets`/`sparks_ledger` fresh?
- **Economics:** confirm Sparks is the single in-game currency; rough **Sparks prices** per pack / paid level /
  add-on, and the **USD→Sparks** bundle pricing.
- **Top-up location:** do real-money top-ups happen **in-game (Stripe Checkout/Payment Link)** or by **bouncing
  to the website's** existing purchase page (recommended)?
- **Earned Sparks:** do completed runs **earn** Sparks (B3), and if so, the server-side reward formula?

## Build order (matches ROADMAP PHASE D1→D4)
1. **A** same-origin SSO + `GET /me` (D1) — unlocks "signed in as…".
2. **D** make `/score` + `/leaderboard/:id` real (already called) — fastest visible win, account-linked board.
3. **B** `/sparks/balance` + `/sparks/spend` (idempotent, server-authoritative) (D2) — the Sparks HUD + spend.
4. **C** `/entitlements` + `/store` (D3) — the in-game Store + paid-level gating.
5. **D4** Stripe top-up webhook → credit Sparks (or grant pack) — the money funnel.
