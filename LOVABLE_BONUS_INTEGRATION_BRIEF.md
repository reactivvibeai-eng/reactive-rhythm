# Reactive Rhythm ↔ Platform — Bonus-Sparks integration brief (for Lovable)

**Hand this to the Lovable agent when you're ready.** This is an **EXPOSE-not-invent** request: the ReactivVibe
platform **already has** both currencies and XP. We are NOT asking Lovable to design a new economy — only to expose
the *existing* one to the game (`reactivvibe.com/play`) through a few endpoints, with one hard safety rule.

---

## Context (what already exists — do not rebuild)
- The platform already has **two currencies**:
  - **Sparks (cashable)** — real-money value, users can cash out.
  - **Bonus Sparks** — platform-only, **cannot** be cashed out; usable in-game / on-platform.
- The platform already has **user XP / levels**.
- The game already authenticates via the **shared Supabase session** (`supabase-js`, same project) and calls a
  shipped catalog/economy function at `…/functions/v1/game-catalog` (`/me`, `/sparks/balance`, `/sparks/spend`,
  `/store`, `/entitlements`). Auth is done — no change needed there.

## THE HARD SAFETY RULE (non-negotiable)
> **Anything the game earns from gameplay, levels, or XP must credit BONUS Sparks ONLY — never cashable Sparks.**
> Minting cashable value from play is an abuse/fraud vector. Cosmetics in the game are **purchased with Bonus Sparks**.
> The cashable Sparks balance must be **read-only** to the game.

## What the game needs (endpoints / fields)
All authed with the existing Supabase bearer token. JSON. Logged-out returns `{signed_in:false}` gracefully.

1. **`GET /bonus/balance`** → `{ signed_in, balance }` — the user's **Bonus** Sparks balance.
   *(If you prefer, add a `currency` discriminator to the existing `/sparks/balance` and let the game pass
   `?currency=bonus`. Either works — the game just needs a clean read of the BONUS number.)*

2. **`POST /bonus/spend`** `{ item_type, item_id, idempotency_key }` → `{ ok, balance, granted, deduped }`
   — spend **Bonus** Sparks on a cosmetic/level/etc. and grant the entitlement. Same shape the game's store already
   expects (`402 insufficient`, `409 price_mismatch`). **Must debit Bonus, never cashable.**

3. **`POST /bonus/award`** `{ reason, amount, idempotency_key }` → `{ ok, balance }`
   — credit **Bonus** Sparks for a gameplay reward (song clear, grade, full-combo, daily). **Server-side rules**
   (clamp the amount, rate-limit, validate against the run) — the client must NOT be trusted to set the amount.
   Suggested triggers (tune to your economy): per song completed, bonus per S/A grade, per full-combo, daily-first-clear.

4. **`GET /profile/progression`** → `{ signed_in, xp, level, level_title }` — so the game can show/feed XP into the
   loop. (Read-only is fine for now; awarding XP from play can be a later phase.)

5. **Store currency** — the game's `/store` items are priced in **Bonus Sparks** for in-game cosmetics. Please confirm
   `/store` + `/sparks/spend` (or the new `/bonus/spend`) operate on **Bonus**, not cashable. The game will relabel the
   in-store currency to **"Bonus Sparks"** once confirmed.

## Bug to fix in the existing function (already live)
- `GET /entitlements` currently returns `{ signed_in, entitlements:[…] }`, but the game client reads `out.owns`.
  Either rename the field to **`owns`** (array of `{ item_type, item_id }`) **or** tell us to read `entitlements` —
  right now ownership never loads. (The game can adapt; flag which key is canonical.)

## NOT in scope for this brief (do not build yet)
- Real-money **Buy Sparks** / Stripe top-up. The current beta is **earn-only**; the in-game "Buy Sparks" stays a
  "Coming Soon" placeholder until we do a dedicated payments pass.

## Cosmetic catalog the game expects (so `/store` + entitlements line up)
`item_type:'skin'` guitar skins, by `item_id`: `crimson_fox`, `crimson_tarot`, `clockwork`, `violet_gothic`,
`bone_daddy`, `melody_pink`. (Each is a verified in-game play-surface. Levels/themes/packs are padlocked "Coming Soon"
in the game until their unlock flow is verified.)
