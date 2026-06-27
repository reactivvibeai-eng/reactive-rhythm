# Reactive Rhythm — Monetization Strategy

> **Scope.** A practical, prioritized revenue plan for **Reactive Rhythm** (UI brand: ReactivVibe AI),
> the browser 5-lane Guitar-Hero-style rhythm game shipping at **reactivvibe.com/play**, playing real
> tracks from the ReactivVibe music platform.
>
> **Anchor facts this doc builds on (do NOT contradict — see CLAUDE.md + project memory):**
> - **Two currencies already designed.** **Sparks** = cashable, real-money platform currency, *never*
>   minted by gameplay. **Bonus Sparks** = platform-only soft currency, the *only* thing gameplay/XP awards.
> - Backend = the owner's Supabase, edited via the **Lovable** agent. It already ships **real auth** + a
>   single-balance **`/sparks/*`** API. Bonus Sparks is an **expose-not-invent** integration on top.
> - The game already has: a **Store** with **paid campaign levels** (priced at Sparks, **$0.05/unit**) and
>   **paid cosmetic guitar skins**; a **free story campaign** (beat a level to unlock the next); a
>   **Career/progression** system; **multiplayer tournaments** (3–10p); **admin/owner gets everything unlocked**.
> - Marquee paid content = **authored premium levels** (big AI-generated traveling-journey video backdrops).

---

## 1. TL;DR — the bet

Reactive Rhythm should monetize like a **premium-cosmetic + content-drop** game, **not** like a
slot machine. The two-currency split the platform already has is exactly the right backbone:
**gameplay rewards Bonus Sparks (soft), real money flows through Sparks (hard)**, and the funnel
from one to the other is the whole game.

**Top 3 moves, in priority order:**

1. **Cosmetic store, dual-priced.** Sell guitar skins / note skins / board themes / victory FX for
   **real Sparks** *and* let them be earned with **Bonus Sparks**. Lowest effort (the skin pipeline +
   Store already exist), highest margin, zero leaderboard risk. This is the daily revenue engine.
2. **Premium level "Season" drops.** Bundle the marquee authored levels into themed **3–5 level packs**
   on a cadence. Each pack is a marketing event and a purchase. The production cost is real (Seedance
   video), so price it to clear that cost with margin.
3. **Battle Pass (free + premium track).** The retention + recurring-revenue layer. Free lane pays
   Bonus Sparks; premium lane (bought once with Sparks per season) pays exclusive cosmetics. Ship this
   *after* the store and one season exist — it needs content to give away.

Everything else (tournaments-with-prizes, artist tipping, ads) is **later / optional** and several
carry real risk (gambling/regulatory, brand). Treat them as v2+ experiments, not launch revenue.

---

## 2. Revenue streams, ranked by effort-vs-return (solo creator)

| # | Stream | Effort | Return | Risk | When |
|---|--------|--------|--------|------|------|
| A | **Cosmetic store** (skins, note skins, board themes, victory FX) — real Sparks **and** Bonus Sparks | **Low** (Store + skin pipeline exist) | **High, recurring** | Low | **Beta → v1** |
| B | **Premium level packs / "Season" drops** (authored journey levels) | Med (content is the cost) | **High per drop** | Low | **v1** |
| C | **Battle Pass / season track** (free + premium lanes) | Med–High | **High, recurring** | Low–Med | **v1.1** (after a season exists) |
| D | **Tournament entry / prize pools** | High | Med | **High (gambling/regulatory)** | **v2, gated** |
| E | **"Support the artist" tipping** on real tracks | Med (backend split needed) | Low–Med, goodwill | Med (payout/tax/legal) | **v2** |
| F | **Ads** (light / or none) | Low | Low | Med (brand) | **Default: NO ads.** Reconsider only as a guest-tier nudge |

### A. Cosmetic store — *the daily engine* (ship first)
The Store, the **$0.05/Spark** price unit, paid **guitar skins**, and the skin measurement/fit
pipeline all already exist. Extend the *catalog*, not the plumbing:

- **Guitar skins** — already shipping. Keep producing themed ones (tie to seasons).
- **Note/gem skins** — reskin the note PNGs/gems. (Respect the ratified **green fret-1 gem exception**;
  brand "no-green" is UI chrome only.)
- **Board / lane themes** — neck overlays, fret-line styles, hit-zone glow palettes.
- **Victory FX / results flourishes** — the screen that fires on a full-combo / grade-up.
- **Loading + atom skins, mascot (RYO) variants** — low-effort vanity.

**Dual pricing is the point:** every cosmetic shows a **real-Sparks price** *and* a **Bonus-Sparks price**.
F2P players grind toward it; payers skip the grind. Same SKU, two doors. This is what turns the soft
currency into a funnel instead of a dead-end.

### B. Premium level packs / "Season" drops — *the marquee content*
The authored traveling-journey levels (AI video backdrops, multi-stop combo cutaways) are the
showpiece and the thing worth paying for. They're expensive to make (Seedance, now 1080p for
front-runners per memory), so monetize them as **events**:

- **Single premium level** — buyable à la carte (Sparks).
- **Pack / Season** — 3–5 themed levels at a **bundle discount** vs. à la carte, dropped on a cadence
  (monthly or 6-weekly). Each drop = a reason to re-open the game + an email/social beat.
- Keep the **free story campaign** as the on-ramp (beat one → unlock next). Premium packs sit *beside*
  it as optional, higher-production content — never paywall the core progression.

### C. Battle Pass / season track — *recurring revenue + retention*
Two parallel tracks across a season's tiers, leveled by XP from play:

- **Free lane** → Bonus Sparks, a free cosmetic or two, small consumables. Real, satisfying.
- **Premium lane** (one Sparks purchase to unlock the season) → exclusive cosmetics + more Bonus Sparks,
  netting *more Bonus Sparks than the pass costs in Bonus-equivalent* so it feels generous.
- **Crucially: cosmetics only.** No gameplay power, no leaderboard edge (see §4).
- Ship **after** the store and at least one season's worth of cosmetics exist — a pass with nothing
  good to give away is worse than no pass.

### D. Tournaments with entry / prize pools — *high risk, gate it*
Multiplayer tournaments (3–10p) exist. Money on top is tempting but dangerous:

- **Bonus-Sparks "stakes"** (soft currency in, soft currency + cosmetics out) = fine, fun, no legal exposure.
- **Real-Sparks entry → real-Sparks prize pool** = effectively **paid competition / possibly gambling**,
  jurisdiction-dependent, and **fundamentally at odds with leaderboard integrity** on a free PC where
  inputs are scriptable. **Do not ship cash prize pools at launch.** If ever pursued: legal review,
  anti-cheat hardening, region gating, age checks — a v2+ project of its own.

### E. "Support the artist" tipping — *goodwill, later*
Because tracks are real ReactivVibe artist songs, a **tip jar on a track** ("Loved this? Tip the artist")
spending **real Sparks**, with a transparent platform/artist split, is on-brand and good for the music
side. But it needs a backend **payout split + tax/legal** path — that's a Lovable/platform project, not a
game-side quick win. Park for v2; it pairs naturally with the platform's existing creator economy.

### F. Ads — *default off*
A premium, music-branded experience with paid cosmetics should **not** run intrusive ads — they cheapen
the brand and conflict with the paid tiers. **Recommendation: no ads in the core experience.** The only
defensible use is a *light, optional, rewarded* nudge for **guest (logged-out) players** — e.g. "watch a
short clip for a handful of Bonus Sparks" — and even that is optional and should be A/B'd. Never gate
gameplay behind a forced ad.

---

## 3. The two-currency design, done right

The platform already has the hard part (real auth + `/sparks/*`). The game's job is to use it correctly
and **expose** a Bonus-Sparks balance — not invent a second money system.

### What each currency may buy

| | **Sparks** (cashable, real money) | **Bonus Sparks** (platform-only, earned) |
|---|---|---|
| **How you get it** | Buy on the platform (real $) | **Only** from gameplay / XP / Battle-Pass / daily play |
| **Premium level packs / Seasons** | ✅ | ➖ (optional: small Bonus discount, never free) |
| **Cosmetics** (skins, notes, boards, FX) | ✅ | ✅ (dual-priced — the funnel) |
| **Battle Pass unlock** | ✅ | ➖ (keep premium pass a real purchase) |
| **Tournament entry (soft stakes)** | ➖ | ✅ |
| **Artist tipping** | ✅ | ❌ (tips must be real value to the artist) |
| **Can gameplay MINT it?** | ❌ **NEVER** | ✅ that's its whole job |

### Why gameplay must NEVER mint cashable Sparks
If a 5-minute song paid out even **fractional cashable Sparks**, the game becomes a **money printer**:
bots/macros farm cashable currency → direct fraud + chargeback exposure + the platform's real-money
economy is debased. **Hard rule: gameplay only ever credits Bonus Sparks.** Sparks are bought, full stop.
This single boundary is the most important guardrail in the whole document — encode it in the backend, not
just the UI.

### The F2P loop that funnels to real Sparks
```
play song ─▶ earn Bonus Sparks + XP ─▶ see a skin you want (dual-priced)
   │                                          │
   │                                   grind Bonus  ──or──  pay Sparks (skip the grind)
   │                                          │                    │
   └──────────── come back tomorrow ◀─────────┘            ◀── real revenue
```
Bonus Sparks make F2P players **feel ownership and momentum**; the dual price tag makes the *fast* path
cost real money. Players who never pay still progress (good for retention, leaderboards, word-of-mouth);
the impatient and the whales convert. The Battle Pass and Season drops give the loop fresh targets.

### ✅ Entitlements shape — RESOLVED (verified 2026-06-20)
An earlier concern (the client read `out.owns` but the API returns `{entitlements:[]}`, so ownership
wouldn't resolve and players could pay without receiving) is **already fixed in code** (build50 + build58).
`getEntitlements` reads **both** `out.owns` and `out.entitlements`, and `_setEntCache` normalizes every
row shape (`{item_type,item_id}` | `{type,id}` | `"level:high_seas"` string) before caching, returning the
normalized cache so store/level consumers key consistently — no double-charge. **Not a blocker.**
*Still do* run one live purchase→entitlement→unlock integration test against the real backend before the
gated beta exposes a paid SKU (verify the round-trip end-to-end), but no client code change is owed.

---

## 4. Ethical guardrails (non-negotiable)

This is a **competitive rhythm game with leaderboards**. Trust is the asset. Hard rules:

- **Cosmetics, never power.** Nothing bought (with either currency) may affect notes, timing windows,
  scoring, hit detection, or any leaderboard outcome. **No pay-to-win, ever.** Skins, FX, themes — visual only.
- **No predatory loot boxes.** Prefer **direct purchase** — you see the exact item and its price before you buy.
- **If anything is randomized** (e.g. a "mystery skin"): **publish the odds**, guarantee **no duplicates**
  (or auto-convert dupes to Bonus Sparks), and offer a **pity/bad-luck ceiling**. Better: just sell items directly.
- **Generous, real F2P path.** Every cosmetic obtainable with reasonable Bonus-Sparks grind. The free
  campaign and ranked play are fully playable without spending a cent.
- **No dark patterns.** No fake countdown timers, no confusing currency math designed to obscure real cost,
  no "almost-enough-currency" forced top-ups. Show the **real-money equivalent** near Bonus prices.
- **Leaderboard integrity.** Because inputs are scriptable on PC, **never attach real money to ranked
  outcomes** (ties directly into §2.D). Keep cash prizes out until anti-cheat + legal exist.
- **Minors / spend safety.** Respect platform auth's age signals; clear purchase confirmations; no
  spend pressure aimed at kids.
- **Admin/owner unlock stays internal.** The owner-gets-everything path is a dev/QA convenience — it must
  be keyed to the authenticated owner identity (per memory: ADMIN on authenticated session email, **not** a
  query/localStorage backdoor), so it can never be a consumer paywall bypass.

---

## 5. Pricing ladder (anchored on $0.05 / Spark)

The existing unit is **1 Spark = $0.05** (a level was priced at "Sparks = $0.05/unit"). Anchor everything
to that so the math stays consistent. Prices below are **suggested starting points to A/B**, not law.

| Item | Sparks | ≈ USD | Notes |
|------|-------:|------:|-------|
| **Single premium level** | 20–40 | **$1–2** | À la carte; matches "level = paid content" today |
| **Level pack / Season (3–5 levels)** | 60–120 | **$3–6** | **~25–35% cheaper** than buying à la carte — the bundle incentive |
| **Cosmetic — common** (note skin, board theme) | 20–40 | **$1–2** | Or grindable in a few sessions of Bonus Sparks |
| **Cosmetic — premium** (hero guitar skin, signature victory FX) | 60–100 | **$3–5** | Or a longer Bonus grind |
| **Battle Pass (season premium unlock)** | 100–160 | **$5–8** | One purchase per season; pays back > its cost in Bonus + exclusives |
| **Bonus-Sparks "value": cosmetic grind** | — | — | Tune so a common cosmetic = ~2–4 focused sessions; premium = ~1–2 weeks casual |

**Sparks top-up packs** (real-money entry points — platform-side) should follow standard tiering with a
mild **bulk discount** (e.g. $5 / $10 / $20 / $50), so the cosmetic and pass prices above always sit
*just past* a common pack size (classic "need a few more" nudge — kept honest, not predatory).

**Guardrail on the grind:** set Bonus-Sparks earn rates and cosmetic costs so the **free path is real but
not instant** — fast enough that F2P players feel progress every session, slow enough that the *fast* path
(real Sparks) stays attractive. Start generous; you can always slow earn rates, but clawing them back feels
like a takeaway.

---

## 6. Phased rollout

Mapped to **what already exists in the codebase** vs **what needs the Lovable backend**.

### Phase 0 — Gated beta (the SHIP track, in flight)
**Goal: prove the purchase→ownership→unlock loop end-to-end with real Sparks. Minimal SKUs.**
- ✅ *Exists:* Store, paid levels, paid guitar skins, `/sparks/*` API, real auth, beta-code gate spec.
- 🔧 *Backend (Lovable):* the entitlements-shape bug is **already handled client-side (§3)** — just run one
  live purchase→ownership round-trip to confirm; expose a **Bonus-Sparks balance** read/write on top of
  `/sparks/*`; confirm purchase persistence.
- 🎮 *Game-side:* show **dual prices** (Sparks + Bonus) on existing Store items; credit **Bonus Sparks**
  on run completion; surface balances in HUD/Career.
- 🚫 *Not yet:* Battle Pass, tournaments-with-money, tipping, ads. **Strip dev hooks LAST**, only at content-freeze.

### Phase 1 — v1 public launch
**Goal: a real cosmetic economy + the first paid Season.**
- 🎮 Expand cosmetic catalog: **note skins, board themes, victory FX** (reuse skin pipeline).
- 🎮 First **premium level pack / Season** as a launch event (à la carte + bundle).
- 🔧 Backend: entitlement durability at scale; receipts; refund/restore path; basic purchase analytics.
- 🛡️ Lock in §4 guardrails in code (cosmetic-only enforcement, real-money-equivalent labels).

### Phase 1.1 — first content cadence
- 🎮 Ship **Battle Pass** (free + premium lanes) tied to the season — now there's content to give away.
- 🎮 Establish a **drop cadence** (monthly/6-weekly Season + pass). Each drop = a marketing beat.
- 📊 Tune Bonus-Sparks earn vs. cosmetic cost from real conversion data.

### Phase 2+ — experiments (each its own project, each gated)
- 🧪 **Soft-stakes tournaments** (Bonus Sparks in / cosmetics out) — fun, low risk.
- 🧪 **Artist tipping** — needs platform payout split + tax/legal (Lovable/platform).
- 🧪 **Cash tournaments** — **only** with anti-cheat + legal review + region/age gating. May never ship; that's fine.
- 🧪 **Optional rewarded guest-tier nudge** (the *only* ad consideration) — A/B, never forced.

---

## 7. What to build next, in order (game-side punch list)

1. **[DONE — verify only] Entitlements read.** Client already reads both `out.owns`/`out.entitlements` and
   normalizes row shapes (build50/58). Just run one live purchase→ownership→unlock round-trip before paid SKUs ship.
2. **Wire a Bonus-Sparks balance** (read/write via the platform layer; local stand-in + swap seam if the
   backend field isn't live yet) and **credit Bonus Sparks on run completion** (XP-scaled, capped — never Sparks).
3. **Dual-price the Store.** Every cosmetic SKU shows **Sparks price AND Bonus-Sparks price**; buying with
   either grants the same entitlement. Show the **real-$ equivalent** near Bonus prices.
4. **Expand the cosmetic catalog** beyond guitar skins: note/gem skins, board/lane themes, victory FX.
   (Mind the green fret-1 gem keep.)
5. **Enforce cosmetic-only in code.** A single guard so no purchasable item can ever touch scoring,
   timing, or leaderboard state. Add a test that asserts it.
6. **Season/pack bundling in the Store** — group premium levels into a discounted bundle SKU with a
   "Season" presentation; à la carte still available.
7. **Battle Pass scaffold** — free/premium tracks, XP→tier mapping, claim flow, cosmetic-only rewards.
   Build the data model now; light it up once one season of content exists.
8. **Purchase-safety + honesty pass** — confirmations, receipts surfaced, restore-purchases, no dark
   patterns, transparent odds **if** anything random ships (prefer direct-buy and skip random entirely).
9. **Soft-stakes tournament mode** (Bonus Sparks only) — reuse the 3–10p tournament system; **no cash**.
10. **Analytics hooks** — conversion (Bonus→Sparks), pack attach rate, pass uptake, cosmetic popularity —
    to tune earn rates and prices with data, not guesses.

---

### One-paragraph pitch to the owner
Monetize Reactive Rhythm as a **premium-cosmetic + seasonal-content** game, riding the two-currency split
the platform already has: **gameplay only ever pays out Bonus Sparks; real money is Sparks; cosmetics are
dual-priced so the soft currency funnels players toward real purchases.** Lead with the **cosmetic store**
(cheapest to extend, highest margin, zero leaderboard risk), make the **authored journey levels** into
paid **Season drops** (each one a marketing event), then add a **Battle Pass** for recurring revenue once
there's content to give away. Keep cash *out* of competitive play, never sell power, keep the F2P path
genuinely generous — and **run one live purchase→ownership round-trip before a single dollar moves**
(the client-side entitlements read is already correct).
