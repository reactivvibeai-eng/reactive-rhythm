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
- 2026-06-25: **Phase 1 DONE** (build83, commit 450ebbf, ?v=320). Shipped 1.2 buy-confirm, 1.3 Easy first-run, 1.4 GET READY/GO, 1.1 results timing summary, 1.7 cleanups. **Moved 1.6 searchable-videos → Phase 5** (needs videoCard/Watch to not dead-end). **Moved 1.5 winner-card RP delta → Phase 4** (with the MP work). Next: **Phase 2 — Store showroom** (reuse the jukebox two-zone "NOW FOCUSED" deck for a full-screen guitar hero; assets on disk in assets/guitars/*-card.jpg + STORE_ART).
