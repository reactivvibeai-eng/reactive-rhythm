# Playtest-2 roadmap — pre-release polish (EXECUTING)

Source: the 9-agent discovery swarm (personas + designers + GH specialist + feasibility), synthesized
2026-06-25. Owner greenlit **build everything, max effort, one feature at a time, through the night.**

## Owner decisions (locked)
- **AI Flixs:** build it ALL this cycle — the poster-led section + searchable videos **and** the
  playable video-background level type. The *playable* part stays DARK until Lovable confirms a
  CORS-decodable per-video `audio_url` (see LOVABLE_BACKEND_ASKS.md). Frame-accurate "video drives the
  clock" is an explicit LATER follow-up; v1 = ambient sync (decode a separate audio track → DemoPlayer
  clock, video plays straight full-screen, journey-advance disabled).
- **HUD:** keep Score big + dominant; ADD a per-song BEST readout + "New Best +X" celebration beside it
  (do NOT demote Score).
- **Golden Buzzer backend field:** WAIT (stays dormant-gated). **Strum calibration:** built, deferred
  until the owner's guitar arrives. **Local Versus:** in scope for release, sequence LAST behind
  `?couch=1`, mandatory 2-person hardware test before "done."
- GH "make it real" work must keep KEYBOARD byte-identical (owner plays keyboard).

## Phases (low-risk-high-value first; XL builds last + isolated)

### Phase 1 — Quick wins  [ ]
- [ ] 1.1 Results early/late timing summary (avg signed bias + mini histogram; `_signed` already computed)
- [ ] 1.2 Store buy-confirm step (gate spendSparks behind one confirm — stops real-money mis-clicks)
- [ ] 1.3 Easy first-run default + one-time nudge (no history → Easy)
- [ ] 1.4 GET READY / GO single-player countdown (reuse MP's)
- [ ] 1.5 Winner-card RP delta + rank-up + combat line (data exists)
- [ ] 1.6 Make videos searchable (search over videoTracks + Music/Flixs toggle)
- [ ] 1.7 Remove stale 6th tap-zone; unify Overdrive "TAP"→"SPACE"; fix Bonus-Sparks legend/code copy

### Phase 2 — Store showroom  [ ]
- [ ] 2.1 Guitar detail HERO view (clickable card → full-screen uncropped portrait + lore + dual price + Buy/Equip)
- [ ] 2.2 Buy-confirm folds into the hero
- [ ] 2.3 Merchandising (rarity tiers, NEW/FEATURED badges, cinematic backdrop+scrim, stronger EQUIPPED state, emoji→SVG)
- [ ] 2.4 (stretch) live on-the-neck preview in the hero

### Phase 3 — Loop & on-ramp polish  [ ]
- [ ] 3.1 Persisted-metric celebration (per-song BEST + New-Best delta on HUD/results) + next-chase CTA
- [ ] 3.2 Full-combo grade floor (FC ≥ B/C)
- [ ] 3.3 Close combo 11–24 dead-zone + stronger OVERDRIVE-READY banner + whiff cue
- [ ] 3.4 Mobile tap-zone coachmark + faint outlines + unmissable first-run How-To strip
- [ ] 3.5 (if capacity) type-system tightening to 3 faces

### Phase 4 — Competitive depth + GH "make it real"  [ ]
- [ ] 4.1 CPU rival runs its own independent chart (decouple from your score; enable combat vs bot)
- [ ] 4.2 Unify wager modal (kill native confirm) + quick-match countdown/"N online"
- [ ] 4.3 GH overstrum penalty + chord-strum fret-settle grace, behind requireStrum + "Strict Strum" toggle (OFF by default for beta)
- [ ] 4.4 Real HOPO/pull-off on default GH path (build-ready; ⚠ no guitar — do not sign off without hardware)
- [ ] 4.5 (build-ready) sustain-whammy OD banking + calibration strum-rate/double-trigger step

### Phase 5 — AI Flixs discovery surface  [ ]
- [ ] 5.1 AI Flixs poster-led destination (first-class home entry, 16:9 grid, hero/featured, film facets, cinema branding)
- [ ] 5.2 videoCard() renderer + poster/thumbnail field (⚠ needs Lovable field; first-frame fallback) + interim muted "Watch"

### Phase 6 — XL builds (LAST, isolated)  [ ]
- [ ] 6.1 AI Flixs PLAYABLE video-bg level (chart over full-screen MV; ambient-sync v1; ⚠ BLOCKED on decodable per-video audio_url)
- [ ] 6.2 Local Versus engine-doubling (factory-wrap per LOCAL_VERSUS_BRIEF.md; behind ?couch=1; ⚠ 2-person hardware test before done)
- [ ] 6.x Cross-cutting: real 2-device MP certification pass + hidden ?mptest harness (never done in-agent)

## Process per item
node --check after every JS edit · headless verify on rr-verify (8790) · 0 console errors · bump ?v · CHANGELOG · commit in batches · run a QA review swarm after each phase · final smoke + QA swarm at the end.

## Progress log
- 2026-06-25: roadmap created, owner greenlit full execution. Starting Phase 1. (Current build base: 77ed6e1 / ?v=319 on visual-overhaul, pushed to origin.)
- 2026-06-25: **Phase 1 DONE** (build83, commit 450ebbf, ?v=320). Shipped 1.2 buy-confirm, 1.3 Easy first-run, 1.4 GET READY/GO, 1.1 results timing summary, 1.7 cleanups. **Moved 1.6 searchable-videos → Phase 5** (needs videoCard/Watch to not dead-end). **Moved 1.5 winner-card RP delta → Phase 4** (with the MP work).
- 2026-06-25: **Phase 2 DONE** (build84, commit aa4c229, ?v=321, pushed). Store showroom hero (`#store-hero`, full uncropped guitar PNG + plinth/reflection/lore/dual-price/Buy-Equip, reuses buy()/equipSkin so buy-confirm intact, Escape capture-phase close) + merchandising (rarity tiers, NEW/FEATURED flags, OWNED/EQUIPPED, emoji→SVG). index.html-only. Stretch 2.4 live-on-neck-preview deferred.
- 2026-06-25: **Phase 3A DONE** (build85, commit 4a1341e, ?v=322, pushed). Per-song BEST chip (`#hud-best`) + live BEAT-BEST flip + `RhythmCatalog.currentTrackId()`; results NEW BEST +X / chase CTA; FC grade floor (clean FC ≥ B); whiff cue (empty press = dry tick + half-kick, no combo/stability hit).
- 2026-06-25: **QA round #1 + Phase 3B DONE.** build86 (commit 06417f2) = 4 QA fixes on builds 83-85 (FC-floor-on-failed-run, hero img onerror, buy-confirm disarm, results CTA order). build87 (commit f95ba6a, ?v=324) = Phase 3B: combo mid-pulse (combo%25==15) + on-highway OVERDRIVE-READY banner + touch lane outlines + first-countdown tap coachmark + unmissable How-To (ack-gate). **Phase 3 COMPLETE.**
  - **GOVERNANCE NOTE:** the wbad0afjh + w1bxkg5rd spec-swarm agents EDITED the live files (workflow agents have write access) — build87's 3B was agent-implemented, then reviewed+verified by the main loop before commit. For risky/gameplay specs, instruct agents "SPEC ONLY — DO NOT EDIT FILES", or always review the git diff + verify live before committing.
- 2026-06-25: **Phase 4 SPEC ready** (workflow w1bxkg5rd output): 3B-1 Strict-Strum toggle (strumCfg.strict default false), 4-1 CPU-rival/chord fret-settle grace (~35ms, KEYBOARD-SAFE, guitar-only, SETTLE_MS hardware-tune-later), 4-2 overstrum penalty (behind Strict-Strum OFF-by-default), + independent CPU rival (multiplayer.js devVsNpc — decouple from player score so you can LOSE). Implement Phase 4 CAREFULLY (gameplay/input — review every edit).
- 2026-06-25: **Phase 5 SPEC ready** (workflow wxl20w98i output, SPEC-ONLY confirmed): AI Flixs discovery — (1) `posterFor()` swap-seam in catalog.js (needs Lovable `poster_url` 16:9 field = ask #2 in LOVABLE_BACKEND_ASKS.md; ships now w/ artwork_url fallback), (2) `allMedia()` cross-search source, (3) promote Videos→"AI FLIXS" hero tile (jukebox.js gt-videos block ~285 + jukebox.css), (4) make videos searchable (currentSongs video-filter ~420 + header search ~572), (5) poster-grid/videoCard + Watch affordance. ARCH: reuse #view-songs with a posterMode flag (NOT a new #view-flixs view+router). The PLAYABLE video level = Phase 6 (blocked on decodable per-video audio_url = ask #1). Low risk (UI/discovery, not gameplay) — implement before Phase 4's gameplay logic.
- 2026-06-25: **Phase 5 DONE** (build88, commit 14a3ffc, ?v=325, pushed). AI FLIXS discovery surface — 6 items: posterFor()/allMedia() seams, full-width AI FLIXS hero (112 films), searchable videos (allMedia + scope='all'), videoCard 16:9 poster grid, interim Watch overlay. Phase 6 boundary kept (launchTrack(video)===false). **Verified live vs the real 112-video catalog, 0 console errors.** Task #164 done.
- 2026-06-25: **QA round #2 DONE** (workflow wte4yd46k, 20 agents): 10 confirmed bugs + 24 design-evolution ideas → captured durably in **QA2_FINDINGS.md** (bugs+fixes, ideas, synthesized sheet).
- 2026-06-25: **build89 (commit 41de611, ?v=326, pushed)** — fixed ALL 10 QA2 bugs (store-hero Escape/focus-trap, stale results-chase, NEW-BEST-first-play, OD-pill-touch, whiff cool color, countdown race, whiff-clobbers-judgment, coach in-app reduce-motion, toast 'info' severity). All minor/nit, keyboard play unchanged. Store fixes verified live; 0 console errors.
- 2026-06-25: **QA round #3 (regression) DONE** (workflow w0ftffquy, 10 agents over JUST the build88+89 diff): found 4 confirmed regressions (correctly dismissed 1 false positive). **build90 (commit 8d83f9f, ?v=327, pushed)** fixed all 4: Watch-handler env side-effect (_preview tag bypasses the env-picker wrapper — Watch no longer churns the menu backdrop/re-rolls the random stage), build89 store-inert-leak (close() tears down the hero so #store-grid.inert can't stick), poster empty-state grid-cell. **Both functional fixes verified live (env mutators 0×, inert leak gone); 0 console errors.** The 3-round QA loop (find→verify→fix→re-verify) has converged.
- **STATE @ build90:** Phases 1,2,3,5 shipped + verified live + pushed. 3 QA rounds done. Remaining: Phase 4 (gameplay/input), the 24 design-evolution ideas, Phase 6 (XL).
- 2026-06-25: **Phase 4 plan + design triage DONE** (workflow wbqaae226) → **PHASE4_DESIGN_PLAN.md** (durable). Phase 4 winner = **shadow-chart** CPU rival (kbSafety 10/10: NPC runs a probabilistic shadow-chart sim, never reads player score; the bug is `multiplayer.js:2869` rival score = player×0.92 = unloseable). 14 DO-NOW design items (juice/onboarding/store/cohesion), each code-anchored + keyboard-safe.
- 2026-06-25: **build91 (commit 7f36326, ?v=328, pushed)** — design-evolution batch 1: **showroom comes alive** (store-hero idle float + ~1.2° sway + tracking reflection + spotlight drift, after the one-shot entrance) + shared **--ease-settle/spring/bar** tokens. CSS-only, overlay-only → keyboard byte-identical. **Verified live** (animations applied, reduce-motion kills + restores base transforms, 0 console errors).
- **NEXT (fresh context):** (1) build92 = next design-evolution batch — render-FX items #1 OD final-2s burn-down cue, #2 Perfect-only catcher snap ring, #3 approach-to-milestone tension band, #4 key-glyph-on-catchers (first runs), #5 first-note PRESS beacon, #6 Easy-nudge inline chip (paste-ready specs in flight); (2) store-hero JS items #9 Bonus-Sparks pricebox nudge + #10 buy/equip celebration; (3) **Phase 4** (task #163, CAREFUL — shadow-chart CPU rival + GH strict-strum, per PHASE4_DESIGN_PLAN.md §A keyboard-safety contract); (4) **Phase 6** (task #165, XL); (5) keep cycling critique/evolution rounds.
