# Reactive Rhythm - Revenue Roadmap (economy research swarm, 2026-06-26)

Synthesized by a 6-lens research swarm. The conversion + retention lenses landed; the psychology / merch /
economy-deep / benchmark lenses were API rate-limited and can be re-run to deepen this. Ethical posture held
throughout: direct-buy only (NO loot boxes), always show the real-$ equivalent, real launch-window gates not
fake countdown timers, and Bonus Sparks stay NON-cashable (the legal / non-gambling basis).

## Executive summary

Reactive Rhythm's economy is architecturally premium and ethically clean, but revenue-UNREADY at the one moment that matters: there is no way to acquire Sparks inside the game and no first-purchase trigger, so today the store can SPEND but the funnel collects $0 (confirmed: SITE_SPARKS at index.html:8467 is a one-way deep-link that ejects players to the website with no price, no pack picker, no return-and-resume). The single highest-leverage build is therefore the in-game Sparks-pack picker + a one-time Founder's Starter Pack — these break the spend barrier once (first-time buyers are 5–10x more likely to buy again, per mobilefreetoplay/solar-engine) and turn the already-shipped $0.05/Spark anchor into a real checkout funnel. The second gap is RECURRING revenue: there is zero return-trigger (no rr_streak/lastLogin key exists) and no Season Pass — yet daily-login mechanics appear in ~95% of games (xtremepush) and battle passes drive 30–60% of revenue in many titles (redappletech), so an opt-in Bonus-only daily streak plus a Sparks-priced Season Pass are the biggest compounding levers after the funnel. The dual-currency split (cashable Sparks bought on-platform vs. non-cashable earned Bonus Sparks, capped at 50/week) is exactly right and is what keeps the model legally clean and non-gambling — do not weaken it; the only economy flaw is that BONUS_RATE=30 makes the cheapest skin a ~30-week grind, so deep the "grind-or-pay the same SKU" funnel psychology never fires — lower it to 15 so the free path is visible-but-slow, keeping the $2.50 pay path obviously faster. Three near-free wins should ride along: route the locked-level/locked-loadout taps straight to openStoreHero for THAT item (one-tap intent preservation), make the results CTA fire only on a genuine NEW BEST/GRADE UP (already computed at catalog.js:1387), and list the spec'd-but-unwired $59.95 custom-level commission as a 'legendary' anchor that makes the 100–140✦ levels feel reasonable. Ethical posture is strong and should stay that way: every recommendation here is direct-buy (no loot boxes), shows the real-$ equivalent, uses real launch-window gates not fake countdowns, and keeps Bonus non-cashable — the only dark-pattern risks are a fake timer on the perpetual Founder's pack or a phantom anchor, both explicitly avoided. Net read: the game is ~2 focused build-weeks of CLIENT work (picker, starter pack, streak, contextual CTAs) plus matching Lovable backend (top-up return-token, once-per-account gate, Bonus balance API) away from being genuinely revenue-ready — the plumbing exists, the funnel does not yet.

## Proposed economy rebalance (concrete numbers)

    CONCRETE NUMBERS (anchored to the shipped 1 Spark = $0.05 and current code: BONUS_RATE=30, BONUS_WEEKLY_CAP=50, faucet 1–8/run).
    
    == SPARKS TOP-UP PACKS (new in-game picker; checkout stays on platform/Stripe per LOVABLE_PAYMENT_BRIEF — game never sees a card) ==
    Ship 4 tiers, bonus-% climbing so the tagged middle tier is the true best $/Spark (honest decoy, not phantom):
      • Spark   — 100 Sparks  / $4.99  (0% bonus)            → ~$0.050/Spark
      • Stack ★ — 250 Sparks  / $9.99  (+10% = 275, "BEST VALUE") → ~$0.036/Spark  ← the real best value, tagged truthfully
      • Vault   — 600 Sparks  / $19.99 (+15% = 690)          → ~$0.029/Spark
      • Legend  — 1400 Sparks / $44.99 (+20% = 1680)         → ~$0.027/Spark
    Pricing rule preserved: every store SKU sits JUST PAST a smaller pack so a top-up is "buy the next size" — e.g. an 80✦ skin clears with the 100✦ pack; a 140✦ level needs the 250✦ tier. Insufficient-Sparks path (toGetMore, index.html:8865) pre-selects the SMALLEST pack that covers the blocked item.
    
    == FOUNDER'S STARTER PACK (one-time SKU, never-paid users only, server-gated once/account) ==
      • $4.99 → 120 Sparks + 1 premium 80✦ guitar of buyer's choice. Anchor shown struck-through "≈ $10 value" (120✦=$6 + 80✦ skin=$4). No countdown on a perpetual offer; gate by "first 14 days OR until first purchase" instead. Pin first in render() sort (index.html:8685), surface via banner() (8633) for never-paid users.
    
    == STORE SKU PRICES (keep current; add the high anchor) ==
      • Skins: 50✦ ($2.50 standard) / 80✦ ($4 premium) — UNCHANGED (already sane).
      • Premium levels: 100✦ ($5) / 120✦ ($6) / 140✦ ($7) — UNCHANGED.
      • NEW legendary anchor: list the $59.95 Custom-Level Commission as its own 'legendary' card (deep-links to reactivvibeai.com/commission per LOVABLE_CUSTOM_LEVEL_BRIEF). Its price RE-ANCHORS the 100–140✦ levels as "reasonable." It's a real product, not a phantom anchor.
      • NEW Season Pass: 100✦ ($5) one-time/season, premium lane, MUST net > 100✦-equivalent in Bonus + exclusive cosmetics so it reads generous (per MONETIZATION.md §C).
    
    == BONUS SPARKS REBALANCE (fix the dead-end; keep it non-cannibalizing & non-cashable) ==
    Problem in code today: BONUS_RATE=30 makes a 50✦ skin cost 1,500 Bonus; at the 50/week cap that's 30 WEEKS — so deep it's not a funnel, it's a wall (players never see the finish line, so the "grind-or-pay same SKU" dual-door psychology never fires).
    Fix — make the cheapest cosmetics genuinely reachable while keeping premium content real-money-only:
      • LOWER BONUS_RATE 30 → 15. A 50✦ skin = 750 Bonus (~3–4 weeks of capped play, or faster with streak+missions below). An 80✦ skin = 1,200 Bonus (~6 weeks). Premium LEVELS stay real-Sparks-only (bonusPriceFor() already returns 0 for non-skins — keep it).
      • RAISE the run faucet slightly: S=8, A=5, B=3, C=2, D=1 (+3 full-combo kicker) → 1–11/run (was 1–8). Keeps the per-run dopamine line ("+N BONUS SPARKS", catalog.js:1433) feeling alive.
      • RAISE BONUS_WEEKLY_CAP 50 → 75, BUT add streak/mission earnings OUTSIDE the run-cap (a separate ledger) so a 7-day streak (3+8+20...) and daily missions can stack ~40–60 extra/week. Net: a dedicated F2P player reaches a 50✦ skin in ~2–3 weeks — real, motivating, not instant. The fast path (pay 50✦ = $2.50) stays obviously attractive.
      • HARD LINE (unchanged): gameplay NEVER mints cashable Sparks; Bonus stays non-cashable (legal/non-gambling basis); premium levels + the $59.95 commission permanently OFF the Bonus path.
    
    == WHAT EACH CURRENCY BUYS (final matrix) ==
      • SPARKS (real $): everything — skins, premium levels, Season Pass premium lane, Founder's pack, top-up packs. The custom commission is its own $-flow.
      • BONUS SPARKS (earned, capped): cosmetic SKINS only (note/board/FX skins as they ship), soft-stakes wager tournaments (already Bonus-only, _wagerForceBonus locked), Season Pass FREE-lane rewards. Never levels, never the pass unlock, never cash.

## Prioritized roadmap (10 items)

### R1 - In-game Sparks pack picker (stop ejecting players to the website to top up)
`P0` - L effort - high revenue impact - owner: **code**

**What:** New modal mirroring the store-hero overlay pattern (index.html:8761 openStoreHero) triggered by 'Get Sparks' (store-getmore, index.html:5395 / openGetSparks 8863) and the insufficient-Sparks path (toGetMore, 8865). Shows 4 Sparks bundles using the live $0.05 anchor; hands checkout to the platform via the existing deep-link but passes the chosen pack + a return token so pendingTopup/recheckBalance resumes the blocked buy on return. Pre-selects the smallest pack that covers the blocked item.

**Why it converts:** The funnel currently collects $0 because there is no in-game acquisition path — this is pure checkout-friction reduction at the exact point of intent (mobilefreetoplay; ironsource). It is the prerequisite that makes every other paid SKU actually capturable.

**Ethical guardrail:** Friction-reduction only. Real-money checkout stays on the platform with clear prices and an explicit confirm (owner-locked: game never sees a card); never auto-charge a stored card. Document the pack SKUs + return-token handshake in LOVABLE_PAYMENT_BRIEF.md (needs a matching Lovable backend endpoint).

### R2 - One-time Founder's Starter Pack (the missing first-purchase trigger)
`P0` - M effort - high revenue impact - owner: **code**

**What:** Add one SKU to STORE_FALLBACK (index.html:8539): '$4.99 → 120 Sparks + one 80✦ premium guitar of choice', struck-through '≈ $10 value'. Pin first in render() sort (8685), surface via banner() (8633) to never-paid users only. Gate once-per-account server-side (Lovable).

**Why it converts:** Breaking the first-spend barrier once is the strongest lever in F2P — first-time buyers are 5–10x likelier to buy again (mobilefreetoplay; solar-engine). A clearly-better-value one-time bundle is the classic, ethical way to do it.

**Ethical guardrail:** Genuinely better value, labeled once. NO fake 'expires in 4:59' countdown on a perpetual offer — gate by a real 'first 14 days OR until first purchase' window. Brand it 'Founder's' (crimson/chrome) as a launch honor, not a casino lure. Needs Lovable once-per-account enforcement.

### R3 - Contextual one-tap offers at the locked-level & locked-loadout seams
`P1` - S effort - high revenue impact - owner: **code**

**What:** When a locked premium level or locked guitar is tapped, call openStoreHero(it) for THAT specific item (the hero exists, index.html:8761) instead of the generic store open(). Price + USD anchor + Buy land in view; if short on Sparks, the hero's buy → toGetMore (8865) opens the R1 picker pre-set to the smallest covering pack.

**Why it converts:** Natural-spend-moment timing + intent preservation — the player already reached for the locked thing; shortening the path to it serves their own expressed intent (segwise.ai). Cheapest high-value conversion lift in the set.

**Ethical guardrail:** Healthy persuasion (serves expressed intent), not a dark pattern. Depends on R1 existing for the close-the-loop step.

### R4 - Bonus-Sparks rebalance: lower BONUS_RATE 30→15, raise faucet/cap, so the dual-price funnel actually fires
`P1` - S effort - medium revenue impact - owner: **code**

**What:** catalog.js: change BONUS_RATE 30→15 (bonusPriceFor, index.html:8472); raise run faucet to S=8/A=5/B=3/C=2/D=1 +3 FC kicker (catalog.js:1425); raise BONUS_WEEKLY_CAP 50→75 (catalog.js:170) and earn streak/mission Bonus on a SEPARATE ledger outside the run-cap. Premium levels stay real-Sparks-only (bonusPriceFor already returns 0 for non-skins — keep).

**Why it converts:** Today a 50✦ skin costs 1,500 Bonus = ~30 weeks at cap — so deep the 'grind-or-pay the same SKU' psychology never engages. Making the cheapest skin reachable in ~2–3 weeks creates a visible finish line that makes the $2.50 fast-path obviously attractive (MONETIZATION.md §3 funnel; ironsource non-cannibalization).

**Ethical guardrail:** Keeps Bonus non-cashable (legal/non-gambling basis) and gameplay never minting cashable Sparks. Free path becomes real-but-slow, not instant — does not let onboarding grant a lump that buys a skin outright. Start generous; never claw back earn rates (feels like a takeaway).

### R5 - Opt-in Daily Streak (Bonus Sparks only) — the core return-trigger RR has zero of today
`P1` - S effort - high revenue impact - owner: **code**

**What:** New localStorage 'rr_streak' {lastDay,count}; streak chip on #start (index.html ~4233) and first results render. Escalating Bonus reward day1=3 / day3=8 / day7=20 via awardBonusSparks('daily_streak'), credited OUTSIDE BONUS_WEEKLY_CAP (separate ledger per R4) so a day-7 reward doesn't eat a week's run earnings.

**Why it converts:** Daily-login appointment mechanics appear in ~95% of games and lift D7 retention (median only ~4%) via habit + loss-aversion (xtremepush; herald-dispatch). No return-trigger exists today — greenfield, highest-leverage retention add. Web/localStorage with no push notifications = zero nagging risk.

**Ethical guardrail:** Forfeited GAIN only — a broken streak never claws back owned/paid assets and never blocks play to claim. Bonus-only so it never mints cashable Sparks. Invitational copy, never 'your streak DIED'.

### R6 - Reduce first-session bounce: skippable RYO intro, deferred calibration, a 'win' in <60s
`P1` - M effort - high revenue impact - owner: **code**

**What:** Audit the start chain in index.html: RYO intro (#start ~4271, gated on 'rr_seen'), consent bar (#rr-consent ~9958, keep non-blocking), first-run calibration nudge (calib-slider ~4997). Make the intro ONE tap to skip + never replay; DEFER calibration until after the first song; land players on the Easy on-ramp so combo/fire FX + the first '+N BONUS SPARKS' line fire fast.

**Why it converts:** D1 retention is the strongest predictor of LTV; a player who doesn't get a fast dopamine win quits before any monetization mechanic can apply (iabdi; game-wisdom). Every user saved here multiplies all downstream revenue.

**Ethical guardrail:** Pure pro-player/pro-revenue — no dark-pattern tension. Do NOT strip the EU consent/privacy gate to chase the metric.

### R7 - List the $59.95 Custom-Level Commission as a 'legendary' store anchor (spec'd but UNWIRED today)
`P1` - S effort - medium revenue impact - owner: **lovable**

**What:** Add the commission as a legendary-rarity card in STORE_FALLBACK / featured rail (rarityOf at index.html:8587 already routes levels to legendary). Deep-link to reactivvibeai.com/commission (per LOVABLE_CUSTOM_LEVEL_BRIEF — sign-in gated, Stripe, admin queue). Confirmed zero code refs exist today — pure new wire (~10 lines client once URL is live).

**Why it converts:** Two effects: (1) a real high-ticket SKU ($59.95) for whales/superfans; (2) price-anchoring — its presence re-frames the 100–140✦ premium levels as reasonable by comparison (getmonetizely; simon-kucher).

**Ethical guardrail:** Must be a REAL, fulfillable product (not a phantom anchor). Show transparent itemized deliverables before Buy (LOVABLE_CUSTOM_LEVEL_BRIEF §2). Charge-first, deliver-to-admin on signed Stripe webhook. Owner must finalize the deliverables list + turnaround ETA.

### R8 - Sparks-priced Season Pass — the only true RECURRING real-money engine RR lacks
`P2` - L effort - high revenue impact - owner: **code**

**What:** 'Season' overlay reusing the #levels-screen tier scaffold + rr_career. FREE lane → Bonus Sparks + one free skin; PREMIUM lane unlocked for ~100✦ ($5) one-time, paying exclusive skins + a marquee Season level (High Seas / Shorty X / Melody SKUs in STORE_FALLBACK are natural capstones). Tier progress = runs completed (recordLocal already counts c.runs).

**Why it converts:** Battle passes drive 30–60% of revenue in many live titles and lift return frequency among premium buyers (redappletech; Deconstructor of Fun) — turns one-time sales into forecastable season-over-season revenue. MONETIZATION.md greenlights it as the v1.1 recurring layer.

**Ethical guardrail:** Cosmetics + content only, never power/timing/scoring/leaderboard (MONETIZATION.md §4). Premium lane must net MORE Bonus-equivalent than it costs so it reads generous. Ship AFTER one season of cosmetics exists; watch ARPU for cannibalization of à-la-carte skin sales.

### R9 - Earned, contextual results-screen Store CTA (replace the quiet ghost button — only on a real achievement)
`P2` - S effort - medium revenue impact - owner: **code**

**What:** On a NEW BEST / GRADE UP run (flags already computed at catalog.js:1387 results._newBest/_gradeUp), swap the quiet ghost button for ONE brighter contextual line ('You earned a new look — see the [tier] guitars') deep-linking via openStoreHero to a STORE_FEATURED skin (index.html:8594). On ordinary runs leave the quiet button so it never nags.

**Why it converts:** Post-achievement is a high-intent, celebratory moment; reward-framed CTAs convert better there than a generic ghost button (segwise.ai). Materials already persist — low build.

**Ethical guardrail:** Single non-blocking line, fires ONLY on genuine achievement, always skippable. Becomes a dark pattern if it forces a modal on every results screen — keep it celebratory, never interrupting.

### R10 - Opt-in Daily/Weekly Missions routing reward toward the Store, plus a gentle lapsed-player win-back
`P3` - M effort - medium revenue impact - owner: **code**

**What:** 3 rotating daily + 1 weekly mission as a DISMISSIBLE card on #start (reuse the coach-card pattern ~4479), tied to signals RR emits (combo-tier ladder, results.full_combo, Easy-level clear, play a premium/Season track). Reward capped Bonus + occasionally a Store discount token. Win-back: if rr_career.lastPlay >3 days old, a one-time warm 'Welcome back' card (small Bonus + one new Season skin spotlight).

**Why it converts:** Quests give a checklist reason to return; re-surfacing the player's OWN best/rank/streak is autonomy-supporting and the cheapest re-engagement (D30 <3%, juegostudio; ACM SDT). Discount tokens push toward a real-Sparks buy rather than inflating Bonus.

**Ethical guardrail:** Missions OPT-IN, ~3/day max, never punish skipping (forfeited gain only — SDT autonomy line); never gate campaign progression behind a mission; never couple 'do X or lose your streak'. Win-back copy invitational, never guilt/loss-framed.
