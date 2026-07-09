# POLISH_REVIEW_v1 — Fable 5 final design-coherence review of build147→155

**Author:** Fable 5 (creative director) · 2026-07-09 · READ-ONLY review — no game code touched.
**Scope reviewed:** MECHANICS_DIRECTION_v1/v2 + MP_HARDENING_v1 against the realized code
(game.js, catalog.js, jukebox.js, multiplayer.js, index.html at `?v=453` / build155).
**Verdict up front: it landed.** The realization is unusually faithful — most specs were
implemented to the letter (constants, bands, gating, byte-identity guards, probes). What follows
is the residue: four genuine intent-gaps, one bug-class find, and a short prioritized polish list.

---

## 1. COHERENCE CHECK — spec vs. realization, mechanic by mechanic

### T1 Flow Shield — **LANDED, with one feel-drift (the audio contradicts the text)**
`game.js:5748–5769` is exactly the spec: OD-active miss burns `FLOW_SHIELD_COST=0.25` of the
meter, combo/`comboTierCur` deliberately not reset, `counts.miss++` keeps accuracy honest, bombs
never route here, P2 mirrored (`:9353`), reset per run (`:3132`), ceiling untouched by
construction. **The drift:** the spec said *"a dopamine event, not a mercy event… combo flares
crimson-gold SAVED + OD-drain SFX."* The realized moment plays the **full miss vocabulary** —
`playMissSfx(false)` (the squelch), `spawnMissDud`, `registerMissFx` (which slams
`laneDesat[lane]=1`, the string goes dead-grey) — and only the `'◆ SAVED'` text carries the win.
The player HEARS "you failed" while READING "you're saved." The single highest-leverage feel fix
in this whole review (see §2.1).

### T5 Multiplier ramp — **LANDED exactly**
`_comboStepFor()` (`game.js:4215–4219`): hard/rift step 8, classic-profile only, `tight`
untouched, routed through all six read-sites (curMult :4223, hit path :5088, HUD gauge
:6076/6079, P2 :9193). Ceiling math untouched. Nothing to add — verified `{easy:12, medium:12,
hard:8, rift:8}` per changelog.

### T8 RIFT tier — **LANDED + exceeded on naming, but THE TROPHY DOESN'T DISPLAY**
The picker now surfaces the v1 tier names — Drift/Pulse/Fracture/Rift ride the `.lvl` line of
each diff button (`index.html:6606–6621`), gold rift styling, locked state, 85% latch in
`endGame` (`game.js:3722–3727`). Better than I asked for.
**The find (bug-class):** a RIFT run's best is *written* under `trackId+'|rift'`
(`catalog.js:1240` keys off `res.difficulty`) but **never read back** — `getBest()`
(`catalog.js:1230`) and the GRADE-UP prev-best scan (`catalog.js:2016`) both iterate
`['easy','medium','hard']` only. So the cover grade chip, the sheet BEST line, and the GRADE-UP
badge are all blind to RIFT runs. RIFT's whole pitch is *"the wall is the trophy"* — and the
trophy is invisible. §2.2.
Minor: the RIFT-unlock toast fires at 1200ms after grade (`:3725`) — the exact same beat the
ratings panel un-hides (`:3674`). Two ceremonies collide once-ever; cheap to de-collide (§2.6).
The leaderboard already segments by `?difficulty=` (catalog.js:796/2135) so rift rows are
naturally separate **if** the backend accepts the value — confirm with Lovable, and the
leaderboard UI has no rift tab yet (§2.9).

### T2/T3/T4 Slide Rails — **LANDED faithfully, dark, one teaching-order gap**
The flagship is real and correct: `_railFromHold` (`game.js:1646–1694`) honors every waypoint
invariant (±1 steps, clamp-don't-reflect, per-difficulty min-seg/max-transfers, degrade→
`_railClamped++`); `railX` (`:6532`) interpolates the measured arrays and provably reduces to
`noteX` (railGeom max|Δ|=0px at 2 sizes per changelog); transfers resolve through the EXISTING
GRACE/SLIP/DROP bands with **zero score** (`_railMigrate :4332`, `_railSustainStep :4344`);
keyboard finger-roll, GH fret-change strum-bypass (`:4907`), touch drag (`:4587–4608`), P2
mirror (`:9308`) all present. Chevrons + bend-width-equals-window in the ribbon (`:6844+`).
**The gap:** v2 §C1 required *"guarantee ≥2 plain holds chart before the first rail"* on Easy —
the escalation ladder (hold → hold → rail) IS the tutor. Not implemented: `_railFromHold`
converts the first qualifying sustain it meets, even if it's the chart's first hold. The
isolation bubble + SLIDE▸ chip mitigate, but the ladder is the design law (chart-is-the-tutor).
§2.5. Also correctly still OFF by default — the flag flip is an owner session, not a code task.

### T6 Note grammar — **LANDED**
Chord chrome-capsule crossbar (`:6785+`), hold grip-ring + drain arc + gold notch at exactly the
banked-0.75 position (`:7703–7725` — the notch math is right), accent spike-ring at 1.12× tips
(`:7684–7702`), bomb desat + thin ember outline + hazard chevrons with the bright halo removed
(`drawBomb :7749+`), bombs excluded from the dark-halo lift by construction (they never route
through `drawNote`). All render under fxLite/reduceMotion as specced. The grip-ring sits at
1.16× gem radius vs my "≈1.3×, growth ≤+10%" — it stays inside the existing glow footprint, so
the silhouette law holds; accept as-built. Greyscale legibility at full speed remains an
**owner-eyes** check — the code is right; only the 60fps screen can confirm the pop.

### T7 First-encounter teaching — **LANDED** (modulo the rail-order gap above)
Easy-only, never-MP post-pass (`:2215–2249`): 1.5s isolation drops `_fill` only, ≤2 tags per
mechanic from `rr_hints`, credit on clean/GRACE completion (`_teachCredit :4251`, wired at
:4269/:4293 — rails require ALL transfers), chip renders in-world on approach (`:7730–7742`),
retire-at-2 proven headless. Exactly the spec.

### D Ratings — **LANDED end-to-end; the moment does NOT feel bolted on**
The realized flow honors every law in D0: inline module after `#results-badges`
(`index.html:7619–7640`), un-hidden 1.2s after the grade on the same real-run gate `recordLocal`
uses (`_ratingsTidFor game.js:3575` — practice/preview/MP/demo suppressed, **failed runs still
show it**, which is exactly the calibration data I wanted), pre-lit from `ratingFor`, one gold
pulse (`_goldPulse`), arrow-rove that never steals the results Enter/Esc, no nag copy anywhere.
catalog.js store + `rr_ratings_queue` drain mirrors `submitReport` (`:2354–2445`); jukebox `★
4.2` at n≥3 in rows/badges (`jukebox.js:24–34, 160–167, 663`); sheet line with tier-aware felt
fallback (`catalog.js:1578+`); backend live per changelog. Chip wording (Chill/Fair/Tested
me/Brutal/Unfair) matches. Only watch-item: on an S/A/FC run the ENCORE block (`#results-encore`)
and the ratings module both occupy the post-grade beat — stacking is probably fine but wants one
owner glance (§2.6).

### MP legibility (build154/155) — **~85% LANDED; the reason-stack unification and escalation timers didn't ship**
Realized and correct: the connection chip is real + tap-to-retry + mirrored mini
(`multiplayer.js:2933–2936`, wired :6770); WHO'S HERE roster with live RINGING countdown,
PICKING TRACK / READY ✓ / JOINING… / IN ROOM / WAITING chips, spectator count, PRIVATE label
(`_roomRosterModel :3197`, `paintRoomPanel :3208`); failure cards replace every dead-end banner
I named — CALL DECLINED (:3101), NO ANSWER + CALL AGAIN (:3106), COULDN'T SYNC THE START
(:3147), MISSED BATTLE CALL (:3173), ROOM CLOSED (:3786), ROOM DIDN'T ANSWER + TRY AGAIN
(:3799); the "share the code" dead-end copy is gone; conn-loss overrides every waiting line
(`paintWaitStatus :824–834`); build155's adversarial pass closed the resub-loop/watchdog/dedupe
lifecycle bugs with correct teardown hygiene. Brand: warm-dark cards, crimson rule, gold READY —
no purple/blue/green anywhere in the new chrome.
**Three intent-gaps:**
1. **§4.4's single `paintPhase()` priority-stack renderer was not built.** `mpx-waitstatus` and
   `mpx-readystate` both still paint (e.g. :764 vs :771, :876). Fragmentation went 7 surfaces →
   ~3, which is most of the value — but two lines can still disagree about "what happens next."
2. **No waiting-state escalation.** "Waiting for your opponent to join…" is byte-identical at 2s
   and 5 minutes (spec §4.4 items 5/8: 20s/60s copy escalation + elapsed count). The RINGING chip
   counts down; nothing else does.
3. **Roster has no LEFT / NO ANSWER chip states.** A departed opponent falls out of
   `room.members` → the roster regresses to the ghost "WAITING" row (`:3205`) while the reason
   line correctly says "opponent left" — the panel and the line disagree at the exact moment
   trust matters.
Also: **B1 (MP telemetry funnel) did not ship** — zero `mp_*` events in multiplayer.js. My §5
matrix sign-off rule says a failed row is diagnosed by its telemetry event; without B1 the
owner's 2-account session degrades back to console archaeology. And B2 join-by-code was skipped
in favor of B3 link-first copy — that trade was explicitly allowed; no action.

### build147 readability batch — accepted as realized (GEM_K 1.8, dark rim/halo under every gem
`:7622–7632`, first-note runway, Hard −30%). Gem aesthetic on a real 60fps screen = owner.

---

## 2. POLISH LIST (prioritized — apply top-down)

**2.1 [quick-win] [headless-safe → owner-must-feel to finalize] Make the SAVED moment sound like a save.**
`game.js:5754–5768`: on a shielded miss, (a) skip `spawnMissDud`, (b) replace
`playMissSfx(false)` with a distinct shield SFX — the cheapest correct option is the existing OD
riser/ignite sample at low gain or a pitched-up, half-gain squelch variant so it reads "sizzle"
not "clam," (c) halve the `laneDesat` slam (pass a soft flag into `registerMissFx` or set 0.5
directly). Keep the string flash and the crimson-gold text. The mechanic already works; this
makes the flagship mercy read as the dopamine beat it was designed to be. Final gain levels are
owner-ear, but the asymmetry fix is codeable now.

**2.2 [quick-win] [headless-safe] Surface the RIFT trophy.** Add `'rift'` to the two difficulty
scans: `catalog.js:1230` (`getBest`) and `catalog.js:2016` (GRADE-UP prev-best). Consider making
the sheet BEST chip name the tier (`BEST S · 812,400 · RIFT`) so a rift best reads as the brag it
is. Zero risk — read-side only; `saveBest` already writes the rift key.

**2.3 [quick-win] [headless-safe] Roster truth-chips: LEFT and NO ANSWER.**
`_roomRosterModel` (`multiplayer.js:3197`): when a previously-present opponent expires from
presence, render their row with a crimson `LEFT` chip (the room already tracks `room._lastP2`;
keep the name) instead of falling back to the ghost WAITING row; when `_callState.phase`
resolves to `missed`, show `NO ANSWER` (crimson) for one paint before the fail card takes over.
One function, no transport changes, spectator-gating untouched.

**2.4 [quick-win] [headless-safe] Waiting-state escalation timers.** In `paintWaitStatus` /
the room waiting line: append a live elapsed count and swap copy at 20s ("…still waiting — they
may have stepped away") and 60s ("Taking a while — resend the invite link") per §4.4. One
bounded 1s interval, cleared in `teardownMatch`/`leaveRoomChannel`/`resetForRematch` (the B8
pattern build155 already enforces).

**2.5 [quick-win] [headless-safe] Easy rail ordering (the tutor ladder).** In the hold-emission
loop (`game.js:1714–1716`): on Easy only, count holds emitted so far this build and have
`_railFromHold` return `'no'` until ≥2 plain holds precede it (spec C1). Keeps hold → hold →
rail escalation honest. Verify: Easy `railAudit()` still 0 violations; first two sustains chart
as holds with the flag on.

**2.6 [quick-win] [headless-safe] De-collide the 1.2s ceremony beat.** Move the RIFT-unlock
toast (`game.js:3725`) from 1200ms → ~2400ms so grade → ratings-panel → unlock land as three
beats, not two-at-once. While there: when `#results-encore` is visible, delay the ratings
un-hide by ~600ms so ENCORE gets its moment first. (Stacking itself is fine; the beat spacing is
the polish.)

**2.7 [bigger] [headless-safe] B1 — the MP telemetry funnel, BEFORE the owner's 2-account
matrix.** Wire the ~10 consent-gated `RhythmTelemetry.event` calls from MP_HARDENING_v1 §3-B1
(`mp_call_sent / mp_ring_shown{rail} / mp_call_answered / mp_join_converged{path,ms} / mp_ready /
mp_start / mp_error{stage}` + conn-state transitions). Without it, any red row in the §5 matrix
has no data and we're back to archaeology. game.js untouched; multiplayer.js/catalog.js only.

**2.8 [bigger] [owner-must-feel] The rails owner session.** `?rails=1` on a track with a real
pitch-slide (the ambient demo has none — pick a synth-lead or vocal-glide track), tune
`RAIL_TW` / `RAIL_DRIFT_MIN` / `RAIL_MIN_LEN` by hand-feel, GH fret-change hammer-on feel, touch
drag feel. Only after that: a Settings toggle and the default-ON decision (my recommendation:
default ON for Easy/Medium first, Hard/RIFT after a week of felt-difficulty ratings data).

**2.9 [bigger] [headless-safe] RIFT leaderboard surfacing.** Client already submits and fetches
per-difficulty; add the RIFT segment to the leaderboard UI and confirm with Lovable that
`difficulty='rift'` rows are accepted + segmented (RIFT charts have more notes → a higher
honest ceiling; mixing tiers on one board would let RIFT dominate).

**2.10 [bigger] [headless-safe] `paintPhase()` unification (§4.4).** Fold `mpx-waitstatus` +
`mpx-readystate` into the single priority-ordered reason renderer. Deliberately sequenced AFTER
the owner's 2-account matrix — don't churn the surfaces the test is about to validate.

**Honest owner-only list (do not pad these into code tasks):** T6 greyscale pop at full speed ·
gem size/rim aesthetic on 60fps · Flow-Shield drain % (25%) and Hard comboStep (8) feel ·
RAIL_* tunables + GH/touch rail feel · felt-chip wording taste · the entire §5 MP matrix
(R1–R6, J, S, C, L rows) — MP remains unprovable headless.

---

## 3. THE SINGLE HIGHEST-IMPACT NEXT THING

**Make the Flow-Shield SAVED moment unmistakably a win (2.1), and ship 2.2 with it.**
Reasoning: Flow Shield fires at the precise moment the old game created despair — the mid-streak
miss. It's the one mechanic whose entire purpose is emotional (Law 2: a miss costs score, never
a death spiral), and right now its feedback mix is ~80% punishment vocabulary with a text label
doing all the lifting. Fixing the audio/FX mix converts every OD-shielded miss from "I failed
but kept my combo (confusing)" into "the game just SAVED me (spend OD for insurance again)" —
that's the retention loop teaching itself. Pairing it with the RIFT-best read fix (2.2) closes
the other dopamine leak in the same reward loop: the top players' new trophy actually displays.
Both are small, headless-safe, and zero-risk to the leaderboard ceiling.

---

## 4. WHAT NOT TO TOUCH

- **`fretGeom()` / `railX`.** The 0px endpoint probe passed at two sizes. Any "improvement" to
  the geometry model is a regression waiting to happen. Rails must keep interpolating the
  measured arrays — never an independent x-model.
- **The one-mercy-model.** Rail transfer failures resolve through the existing GRACE/SLIP/DROP
  bands — resist any urge to add a rail-specific punishment or a new callout vocabulary.
- **Score/ceiling surfaces.** `comboCap`, `MAX_MULT`, `notes_total*1500`, transfers-pay-zero, no
  new score sites, no CHART_VERSION bump. All verified intact; keep it that way.
- **RAILS_ON default-OFF + flag-off byte-identity.** That's the safety net for everything in §A.
  No Settings toggle until the owner has played it.
- **Hard's −30% softening.** Do not re-add density to FRACTURE "because RIFT exists" — RIFT is
  the outlet, FRACTURE's contract is "every note humanly chainable."
- **MP invariants.** softPresence (never `channel.track()`), spectate byte-identity
  (`!spectating` gates incl. the roster's), each-readies-auto-start, the public `rr-*` channel
  policies, build155's resub/teardown timer hygiene.
- **The ratings non-nag law.** No "please rate" copy, no toasts, n≥3 threshold stays. The
  feature's charm is that it never asks.
- **The bomb's dimness.** It is the only dim object on the board *by design* — a future
  "readability pass" must not brighten it.
- **Green fret-1 gems, lane colors, JetBrains Mono status chips** (established brand exceptions
  and an established font — 174 prior uses).
- **The tier names in the picker** (Drift/Pulse/Fracture/Rift) — better than the spec asked for;
  they're canon now.
