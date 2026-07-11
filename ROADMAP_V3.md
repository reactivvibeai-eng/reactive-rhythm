# ROADMAP v3 — Reactive Rhythm (2026-07-11)

> Produced by a full-system, end-to-end audit: **30 agents** (8 deep area auditors → adversarial
> skeptic verification of every serious claim → synthesis) + a **live harness E2E pass** + fresh
> prod data. Every "CONFIRMED" item below survived an independent attempt to refute it against the
> real code. Supersedes NIGHT_ROADMAP v2. Companion docs: `SHOW_READINESS.md` (today),
> `CHANGELOG.md` build181 (the fixes that already landed from this audit).

---

## The honest state of the platform

**Structurally healthy.** The engine core, perf layer, satellites, and UI survived adversarial
audits with only edge-tier defects. The sacred invariants all hold: score ceiling (17 sites,
CHART_VERSION 2), notes time-sorted, music never ducks, brand hues clean, z-ladder disciplined,
economy double-charge-protected, chat XSS-escaped everywhere. The live E2E pass ran boot → play →
pause/exit → every overlay → MP room lifecycle with **zero console errors**.

The real problems cluster in exactly three places — and they align with the standing decrees:

1. **The acquisition funnel leaks at every step** (D1/D3): previews could play the wrong audio
   *(fixed build181)*, the preview metric is polluted by passive browsing, the first note is 8+
   ceremonies away for a new player, and the Hero Set front door isn't built yet.
2. **The measurement pipe was still lossy** (D5): accepted users' telemetry drained into a dead
   transport *(fixed build181)*; the `mp_round_scores` INSERT path has never been proven end-to-end.
3. **MP's 1v1 core is hardened, but** the tournament/wager layer (D6-frozen) has confirmed wedge +
   payout-divergence bugs, and the battle-call growth bet has a dead VS-HUD vs mobile opponents and
   an unpairable round-id ledger gap.

**Scale reality (fresh prod):** 19 lifetime players, 5 weekly-active, 368 plays. Only **12 tracks
in the whole catalog have ≥3 plays**. The catalog the jukebox now surfaces is 1,270 songs + 162
Flixs — the dead-tail problem grew. Distribution and first impressions, not features, are the
constraint. **SUBTRACT (D6) stands: no new surface this month.**

---

## ✅ Fixed in build181 (the 4 show-critical items — live-verified)

| Sev | Fix | Where |
|---|---|---|
| P0 | Consent bar no longer covers the mobile tap-zones during gameplay (returns on results/menu); live-show RETURN pill raised above the bar | index.html |
| P1 | Previews resolve via the HLS-skipping `trackAudioUrl()` — never m3u8 silence, never the demo track passed off as the artist's song | catalog.js |
| P1 sec | The show HOST is never kickable/mutable by a forged broadcast | multiplayer.js |
| P1 | sendBeacon fully retired — unload telemetry flushes via fetch keepalive (the proven transport) | telemetry.js |

---

## 📋 THIS WEEK (post-show) — measure honestly, curate the front door, make the growth bet reliable

| # | Item | Why | Effort | Owner |
|---|---|---|---|---|
| W1 | **Post-show prod probe**: confirm build180 funnel rows landed at expected volume | telemetry has silently been dark twice; one SQL pass validates the pipe everything below depends on | S | lovable |
| W2 | **Split `preview_auto` vs `preview_intent`** (+3s minimum) + session cache for `/track/:id` | CONFIRMED: every coverflow settle logs an indistinguishable 'preview' + an uncached API hit — the 1,913→368 cliff metric is polluted noise until this lands | S | game |
| W3 | **Replace the lead-in runway note deletion with `_practicePreroll`** | CONFIRMED P2 fairness: `notes_total` currently depends on the player's Note Speed setting — slow-scroll players are structurally capped below fast-scroll on the same chart (ceiling-law violation) | S | game |
| W4 | **Build the HERO SET front door** — curated ~25–40 track rail as the default library view | D3, owner-endorsed, not yet built. Seed with the 12 proven tracks (below) + an automated verify sweep (decode + chart-quality score) to fill to ~40 | M | game |
| W5 | **Backend catalog cleanup**: hide/flag HLS-only, failing-artist clusters, test-track rows | D3's other half — what the Hero Set protects new players from | M | lovable |
| W6 | **Daily Rift pool: apply `_discoverConfident`** | the one global same-pick surface that skips the confidence bias — an unlucky date parks the daily (x3 rewards!) on a dead track for everyone | S | game |
| W7 | **Battle-call reliability pair**: tick-synthesized VS HUD (fixes 0/EVEN vs mobile opponents) + crit-send the server round-id (makes the anti-cheat ledger pairable) | CONFIRMED ×2 on the one growth bet D6 keeps | S | game |
| W8 | **Prove `mp_round_scores` end-to-end** on the 2-peer authed harness | client wiring verified correct; the server INSERT/RLS path has never produced a row — one harness run answers whether the backend half works | S | game |
| W9 | **Scope + dedupe the `--rr-beat` write** (root → `#game`, quantized) | CONFIRMED: a whole-document style invalidation on most playing frames, ~10 lines to fix | S | game |

**Hero Set seed (the only tracks with ≥3 plays — all verified-completing):**
Mermaid Dreams (Evanwayne, 6 players) · Silver Anchor (Melanie Heart) · Good Hands Keep Time (Alarm
Clock Hero) · Shadowulf and Sisoka (Sisoka) · I'll Make You Mine (G.S Lab) · BullBombz
(CelinesRazor) · I Wanna Cry (Mind Over Images) · Get Busy (Bone Daddy) · Red Bull vs Coffee
(Savrok) · Six Months Later (After Eve) · Before It Could Bloom (ACH) · I Still Love You
(MidnightNeko2001). Fill to ~40 via the automated decode+chart-quality sweep in W4.

---

## 📅 THIS MONTH — funnel, boot, and the measured loop

| # | Item | Why | Effort | Owner |
|---|---|---|---|---|
| M1 | **Cache the warped-guitar composite** after materialize (128 drawImage/frame → 1) | CONFIRMED: the largest steady render cost in shipped GH mode, exactly on the iGPU/mobile devices where auto-lite fires | M | game |
| M2 | **Boot pass**: self-host + defer the CDN scripts (hls.js/supabase-js = a third-party single point of failure loaded BEFORE game.js), add `esbuild --minify` to sync-game.mjs (~2.15MB unminified JS today) | first impressions die on load; also removes a CDN outage taking down the show URL | M | game |
| M3 | **One-tap PLAY on the focused cover** + preview-end "PLAY IT" CTA + pre-decode on preview (the `lastDecoded` cache already exists) | attacks the measured funnel bottleneck at the moment of interest; kills the 5–15s loading wall for the common path | M | game |
| M4 | **FIRST RIFF**: one-button first-run path (daily pick, Easy, How-To folded into the countdown) | a converting show viewer crosses 8+ ceremonies today; all the pieces exist | M | game |
| M5 | **Aggregate `decode_error` telemetry → auto-hide/badge undecodable tracks** | D5's new signal turns dead-catalog curation from guesswork into a self-healing filter | M | game |
| M6 | **Shared `resolveAudioSources(t,{purpose})`** replacing the four divergent priority lists | every past wrong-audio P0 traces to one list drifting — kill the bug class permanently | S | game |
| M7 | **Carry chart source in the MP 'start' payload** | CONFIRMED latent: arms the moment server pre-charts ship — two players would score different note lists in one ranked duel | S | game |
| M8 | **Repro + fix the server pre-chart pipeline** (chart_status:ready → 0 completes) | ready-charted tracks are currently the only UNplayable ones; needs targeted repro then a fallback path | M | lovable |
| M9 | **MP attach follow-ups**: F6 REJOIN pill, F9 stale-room discovery, F4 retrying preflight (game) + F5 server-of-record rooms (lovable) | makes the battle-call bet survivable across reloads at real-user scale | M | both |
| M10 | **Spectator 'final' coercion + combo-tier re-thresholding** (percent-of-chart so INFERNO/ASCENDANT are reachable — prod median max-combo is ~102; tiers at 300/500 are dead content) | small confirmed fixes on kept surfaces | S | game |
| M11 | **Consent as a deliberate first-run moment** (fold into How-To / start CTA) | most users stay 'unset' by design of an ignorable bar; an explicit moment un-blinds full telemetry and retires the overlay class | M | game |
| M12 | **Owner decisions batch** (one sitting): streak-freeze semantics · Classic-vs-Musical default · Fail-Mode default · 2-account MP test · split-screen 2-person test | four tuning calls + two human tests gate downstream work | S | owner |
| M13 | **reactivvibeai.com SEO prerender fix** (track catalog pages) | diagnosed root cause of the sister site's dead discoverability; feeds the acquisition top-of-funnel | M | lovable |
| M14 | **Contract-drift probe script** run after every Lovable deploy | the "agent says Ships while prod 404s" failure mode has burned this project repeatedly; make it structurally impossible to miss | S | game |

---

## 🔭 LATER (post-freeze) — when tournaments/wagers unfreeze or data justifies

- **Tournament reliability kit** (CONFIRMED P1s, frozen surface): t-round re-emit + snapshot-driven
  launch (one dropped packet currently = strand + auto-forfeit) · per-pair settle deadline + host
  FORCE SETTLE (zero-finals pair currently wedges the whole bracket).
- **Wager integrity** (CONFIRMED, frozen): host-authoritative settlement broadcast (client replicas
  currently disagree with the pot after a kick → Bonus-Spark mint/burn); flip to the deployed
  server escrow.
- **Server-authoritative room moderation** via edge fn (closes the whole forged-broadcast class the
  build181 host-guard only patches). — lovable
- **Unify roomless duels onto the room+match path** (challenge/lobby-pair miss snapshots, spectator
  streaming, reconnect seat-holds). L
- **Data-fed difficulty density pass (D4)** + Hard on-ramp — now that the funnel measures.
- **Career/bests server sync** via the deployed `/me/scores` (device change currently resets the
  grade-chase to zero).
- **Weekly Rift shared leaderboard** (first post-freeze new surface — cheapest real competition).
- **SUBTRACT hygiene batch**: split the 8k-line inline CSS into game.css (shrinks the mojibake
  blast radius) · tokenize the z-ladder · MP timer registry · delete dead ducking machinery + the
  broken GIF fallback encoder · one shared profanity module · `__rrCeiling` tripwire dev hook.
- **Deferred**: address-bar `mprole=host` share footgun · AI-Flixs playable level + Local Versus XL
  builds (new surface; wait out the freeze + real MP usage data).
- **P3s parked**: charter lane-wrap teleport (one-line `reflect()` fix — ride the next chart-shape
  review) · streak-freeze unlimited-gap semantics (waits on M12's owner call) · calib header icon
  lands on Settings instead of deep-opening the wizard · filter benign video-play noise out of the
  error capture · pause ~80 idle-screen CSS animations + the SMIL loader under reduced-motion.

---

## Optimization themes (the "why" behind the batches)

1. **Un-blind the pipe** → every roadmap decision is supposed to be data-fed; W1/W2 + M5/M14 make
   the funnel numbers mean something.
2. **Collapse the preview→play cliff** → true conversion is unknown but worse than 19%; W4 + M3/M4
   attack friction at the moment of interest. Moving it toward 30% ≈ doubles plays at current traffic.
3. **Curate the front door** → 12 proven tracks vs 1,270 surfaced; a new player's first three picks
   must always start.
4. **Frame budget on real devices** → M1 + W9 are the two biggest wins; both verifiable with the
   existing `?fps` meter.
5. **Boot cost** → 2.15MB unminified JS + blocking CDNs is where first impressions die.
6. **MP scoped to the growth bet** → 1v1 battle-call only; tournaments/wagers stay frozen but their
   confirmed bugs are documented above for the unfreeze.
7. **SUBTRACT** → every hygiene item retires a documented recurring bug class.

---

## Standing laws (unchanged, re-verified this audit)

17 `score +=` / CHART_VERSION 2 · notes time-sorted · music never ducks · warm darks, no
purple/blue (green-fret exception) · 5-lane by decree · softPresence, never native presence ·
measured string geometry, never even-spaced · owner Publishes; agents never publish.
