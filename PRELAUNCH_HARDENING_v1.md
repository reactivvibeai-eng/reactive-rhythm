# PRELAUNCH_HARDENING_v1 — owner punch list

_Audit date: 2026-07-10. Scope: player-facing stability, analytics, usability, a11y/mobile,
performance. Findings survived an adversarial "not-a-bug" refutation pass; the two highest-severity
ones were re-verified against the live code before this was written. Every claim cites file:line._

---

## 1. The verdict in three sentences

The game itself is in good shape — the core loop plays, scores, and persists correctly, and I found
**no bug that loses a player's money, account, or run data, and nothing that makes the game
unplayable**. The single biggest risk is that **you cannot see anything**: 364 real completed plays
have produced **zero** gameplay funnel events, so every tuning decision in the roadmap is being made
blind (SHIP-BLOCKER for the *purpose* of a beta, not for the players). The single cheapest big win is
adding a **Cancel button to the loading screen** (~8 lines) so a mistapped dead track stops reading as
"the game crashed."

---

## 2. SHIP-BLOCKERS

**There are no player-facing ship-blockers.** Nothing here loses money, corrupts accounts, or bricks
the core play loop. I am not going to manufacture drama — the engine, scoring, and persistence are
solid.

**There is one _beta-purpose_ blocker** you should treat as a gate before you call the beta
"data-driven":

- **Gameplay analytics funnel is 100% dark in production.** `telemetry.js:120` +
  `game.js:3497/3981/3983`. You are shipping instrumentation that emits nothing. See §4 for the SQL
  proof. If the goal of this beta is to learn what to tune, this must be fixed *first* — otherwise the
  beta produces opinions, not data. It does **not** block players from playing, which is why it's here
  and not in "unplayable."

---

## 3. The ranked punch list

Severity = player impact. `[cheap]` = under ~20 lines, no design decision required.

### HIGH

| # | Problem | Where | Fix |
|---|---------|-------|-----|
| 1 | Funnel events never reach the DB — 364 plays, 0 `song_start`/`song_complete`/`run_fail` rows. Prime suspect: consent gate defaults to `unset`, so nothing flushes; pre-consent buffer is in-memory only and lost on reload. | `telemetry.js:120`, buffer at `telemetry.js:127-135` | Curl the `/events` route to confirm it inserts into `game_funnel_events`; auto-accept telemetry for non-EU beta users so `getConsent()==='accepted'`; persist the pre-consent buffer to localStorage. **Not cheap** — needs a consent/privacy decision. |

### MEDIUM

| # | Problem | Where | Fix |
|---|---------|-------|-----|
| 2 | A failed AI-Flix launch leaks a **perpetual rAF loop** that force-sets the failed flix video as the backdrop for the entire rest of the session — the menu and every later song render with the wrong video fighting their real backdrop, burning CPU/battery, until a full run finally drains the stale callback. Trigger: any flix whose audio fails to decode/chart (the documented HLS/partial-audio weak spot). | `catalog.js:1874` (loop), teardown gated at `catalog.js:1882`, failure path never reaches `showScreen('game')` at `game.js:3424`; `play()` catch at `game.js:3100-3109` never tears it down. | `[cheap]` In the frame loop, also tear down when `_flixActive && !active && getLiveStats()===null` past a short grace window; or clear the flix backdrop from `play()`'s catch. |
| 3 | **Loading screen is a dead-air trap**: no Cancel/Back, a fake fixed-step progress meter (frozen at 8%), and up to a **30s hang** on any slow/unreachable track before it self-recovers. On a first beta session this reads as a crash. | `game.js:2672` (showScreen), 30s abort at `game.js:2630`, fixed meter values at `game.js:2677-2679`, no cancel control in `index.html:7553-7596`. | `[cheap]` Add a Cancel affordance on `#loading` that bumps `_playGen` and returns to menu; surface a "Taking longer than usual…" line after ~6s. **The cheapest big win.** |
| 4 | **Reduce Motion does not stop the looping full-screen menu videos.** The reduce-motion CSS only hides `.scr-vidbg`; the three primary backdrops (`#start-video`, `#menu-hub-video`, `#menu-bg-video`) are only hidden under `rr-perf-bg`, and the decoder observer actively **resumes** them with no reduce-motion guard. | CSS hide at `index.html:1077`; the three videos at `index.html:5788/5851/6596`; observer resumes at `index.html:8196`. | `[cheap]` Add the three IDs to a `html.rr-reduce-motion { display:none }` rule mirroring line 1077, and gate the observer's `play()` on `!rr-reduce-motion`. |

### LOW

| # | Problem | Where | Fix |
|---|---------|-------|-----|
| 5 | Comet note-trail allocates **2 gradients + 2 shadowBlur strokes per approaching note per frame** — the dominant per-frame cost under heavy charts, live for every non-Lite user. | `game.js:7579` (+ `7591`, blurs at `7588/7593`), gated `!fxLite && !reduceMotion` at `7575`. | Bake per-lane trail sprites once and `drawImage`, or cache gradients keyed by lane; drop `shadowBlur` (the `lighter` stroke already glows). **Not cheap** — render refactor. |
| 6 | Library spectrum-visualizer rAF **runs forever**, including during gameplay — a second always-on loop doing 4 DOM reads/frame concurrent with the game loop. | `jukebox.js:1570` (re-arm), early-return at `1573`. | `[cheap]` Gate the rAF re-arm on the jukebox view being active (drive from the existing MutationObserver). |
| 7 | A **transient 5xx/offline** on the first reclaim-deltas fetch permanently disables the PASSED-YOU reclaim card for the whole session — `_reclaimDone=true` is set *before* the await, and the catch never resets it. | `catalog.js:2853` (flag before await at `2854`), guard at `catalog.js:2801`. | `[cheap]` Set `_reclaimDone=true` only after a successful resolve (or only on a definitive 4xx). |
| 8 | Hub retention tiles (Daily/Weekly Rift, status strip) can strand on **"Loading…"** and never self-heal until the hub is re-entered, because nothing repaints the hub when the async catalog crawl resolves. | `index.html:12420` (Daily), `12484/12493` (Weekly); boot only repaints library at `catalog.js:3419-3420` + `1497-1498`. | `[cheap]` Dispatch `rr:catalog-ready` on `loadCatalog()` resolve and re-run the paint functions if the hub is active (~6 lines). |
| 9 | **Multiple touch targets below 44px.** Welcome-card dismiss × is **22px**; library header icons shrink to **36px** on phones; hub gear is **38px**. Mis-taps between adjacent controls (e.g. Exit-to-site vs Search). | `index.html:4251` (22px ×), `3971` (36px icons), `2237` (38px gear). | `[cheap]` Bump to ≥44px hit area or add invisible padding / `::before` hit box. Pure CSS. (Findings for the 22px × and the 36px icons are the same class — fix together.) |
| 10 | Viewport meta **blocks pinch-zoom** (`user-scalable=no` + `maximum-scale=1`) — a hard WCAG 1.4.4 fail; Android Chrome honors it, locking low-vision users out of zoom. | `index.html:6`. | `[cheap]` Drop `maximum-scale=1, user-scalable=no`. If the intent was to kill iOS double-tap-zoom mid-tapping, scope it with `touch-action: manipulation` on the tap-zone/canvas instead. |
| 11 | **Mute button never updates accessible state** — screen readers hear "Mute audio" whether audio is on or muted; state is icon-only. | `index.html:6618` (label), `syncIcon` at `11962-11972`. | `[cheap]` Add `aria-pressed` and swap the label in `syncIcon`; same for the floating `#mute-btn`. |

### DATA / CONTENT (not a code bug — see §4)

| # | Problem | Where | Fix |
|---|---------|-------|-----|
| 12 | **96 server-'ready' pre-baked charts are effectively unused** — exactly **1 of 96** has ever completed a play. The one instant + leaderboard-safe path is returning ~zero gameplay. | `rr_consented_tracks` (SQL in §4). | Surface ready-charted tracks first in the jukebox ("Ready to play instantly" rail); verify `liveProvider` actually wins over in-browser analyze for these. Otherwise the server-charting pipeline isn't paying for itself. |

---

## 4. What the production data says

### 4a. The funnel is empty (confirms the "instrumentation blind" memory note)

```sql
select event, count(*) from game_funnel_events group by event;
-- rr_review_mint = 85, rr_show_invite = 8, test_swarm = 2
-- song_start / song_complete / run_fail = 0 ROWS
```

```sql
select count(*) from game_plays;   -- 364 completed runs
```

**The contradiction, baked into the code:** `game.js:3497/3981/3983` fire
`RhythmTelemetry.event('song_start'|'run_fail'|'song_complete')` and `index.html:7923` wires
`TELEMETRY_BASE` — so the code *believes* it is emitting a funnel. Production says otherwise: **364
real plays produced 0 funnel rows** while `POST /plays` (`catalog.js:788`) lands fine. So `/plays`
works and `/events` does not populate the table. Prime suspect is game-side (the consent gate,
finding #1); the alternative is that the `/events` route on `game-catalog` is unwired to
`game_funnel_events`. **Curl the route to disambiguate before touching the consent code.**

### 4b. The expensive server-charting path is dead

```sql
select chart_status, count(*),
       count(*) filter (where exists (select 1 from game_plays p where p.track_id = id))
from rr_consented_tracks group by chart_status;
-- chart_status='ready' = 96 tracks, only 1 ever played

select count(*) from game_plays p
  join rr_consented_tracks t on t.id = p.track_id
 where t.chart_status = 'ready';   -- 1 play total
```

95 of 96 ready charts have **never been touched**. Either they aren't surfaced/prioritized in the
catalog UI, or players never reach them.

_(Tables that were checked and had content: `game_plays` = 364. The funnel table
`game_funnel_events` was **not** empty overall — it had 95 rows — but had **zero** gameplay-lifecycle
rows.)_

---

## 5. What we chose NOT to fix, and why

- **Comet-trail perf (#5)** — deferred. It's a real per-frame cost but it's a render refactor, not a
  cheap edit, and it only bites heavy charts on mid machines. Fix after the beta tells you whether
  frame drops are actually a reported complaint (which #1 would let you see).
- **The `/events` endpoint itself** — I did not modify backend (Lovable-owned). The audit stops at
  "curl it to confirm"; the wiring decision is the owner's.
- **The 5 known/tracked items** in the brief (phantom-room MP, `ME.signedIn` write-once, Golden
  Buzzer coverflow, `?open`/`?rails` unrank) — already fixed or logged; not re-reported.
- **Standing-law surfaces** (scoring sites, CHART_VERSION, MP transport, spectate byte-identity) —
  audited-around, not touched. No finding proposes violating them.
- **The 96 dead ready-charts (#12)** — flagged as content/surfacing strategy, not a code fix, because
  the correct action (a "play instantly" rail vs. deprioritizing the pipeline) is a product decision.

---

## 6. Instrumentation gaps — what we cannot currently see

| We cannot see… | Because | Smallest change to see it |
|----------------|---------|---------------------------|
| Song start → complete → fail funnel (drop-off, most-played, quit points) | Funnel events never land (#1) | Curl `/events`; if it inserts, fix the consent default + persist the buffer. If it doesn't, wire the route to `game_funnel_events`. **This unlocks nearly all the roadmap's data questions.** |
| Whether a track was actually **charted server-side vs. in-browser** for a given play | No provider field on the play row | Add `provider: 'live'\|'buffered'` to the `POST /plays` payload at `catalog.js:788`; then #12 becomes measurable instead of inferred. |
| Frame-rate / perf in the field (does #5 actually hurt real machines?) | No perf telemetry event | Once #1 lands, emit a one-shot `perf_sample` with median FPS on song complete. |
| Loading-screen abandonment (how often #3's 30s trap fires) | Loading has no start/cancel/timeout event | A `load_start` / `load_cancel` / `load_timeout` event on the `#loading` path — free once the funnel works. |

**Bottom line:** fix finding #1 first. It is the lens through which you'd measure #3, #5, #12, and
every difficulty/pruning question in the roadmap. Everything else on this list is a cheap, isolated,
low-risk polish edit — the game is fundamentally sound.
