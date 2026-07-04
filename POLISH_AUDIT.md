# Polish / Optimization / Refinement audit — ranked fix list

Read-only adversarial Opus audit (4 lenses: feel / optimization / refinement / correctness) across game.js,
index.html, catalog.js, multiplayer.js, procbg.js. 29 raw findings → 15 kept, ranked by severity ×
owner-visibility × low-effort. Each is tied to a real location + a specific fix. Grouped here by the wave
that lands it (file-scoped to respect the monolith single-writer constraint).

## Wave P1 — game.js (feel + hot-loop perf) — IN PROGRESS
1. **[opt·high·S] Note render loop scans ALL notes, no early break.** `render()` ~5681 iterates the whole
   time-sorted notes array every frame; once `d>1.02` every later note is future too. Change the
   `continue` to `break` (guarded on `!held && !resolving`). Byte-identical output, stops visiting future notes.
2. **[opt·high·M] Miss-detection loop scans ALL notes every frame.** `loop()` ~5194 walks the full array
   unconditionally to find newly-missed notes. Add a monotonic `_missCursor` (never moves back) + break past
   the due window. Reset in beginPlay/restart. Verify miss timing unchanged via `__rrDebug`.
4. **[feel·high·S] Combo number never pulses per hit.** `updateHUD()` ~5097 just swaps textContent; only the
   rare tier milestones animate. Add a subtle per-hit tick (≤1.08 scale, ≤120ms, reduce-motion gated) — the
   missing primary dopamine signal.
5. **[feel·high·M] Ceremonial callouts stomp each other.** All callouts share one `#judge-flash` slot, so
   GOLDEN MODE!! / OVERDRIVE READY / CLUTCH get overwritten by the next note's GREAT. Add a priority guard
   (ceremonial flash holds the slot ~400ms) or route the big ones to their own layer.
6. **[feel·med·S] MISS feedback is uniform.** Breaking a 300-combo feels like a stray whiff. Scale the miss
   reaction by the streak that died (bigger crimson flash / shake / a "STREAK BROKEN" callout at ≥50).
8. **[feel·med·S] No audio stinger on a normal (B/C/D) pass.** The ~900ms results count-up is silent unless
   an encore fired. Always play a grade-scaled sting for non-failed runs.
10. **[feel·med·S] PERFECT is the quietest outcome.** Best-case hit suppresses its word and its chug is barely
    hotter than GREAT. Give PERFECT a distinct non-verbal signature (crisper core-flash + a short bright accent).

## Wave P2 — catalog.js (correctness + startup perf) — IN PROGRESS
3. **[correct·high·S] A flaky page mid-crawl nukes the whole live catalog.** `loadCatalog()` ~866 runs the
   entire paged crawl in ONE try/catch; a transient failure on page N+1 discards all already-fetched real
   tracks and drops to 1000 mock songs — and `catalogLive` stays false, blocking server-charted launches all
   session. Fix: per-page try/catch, break-and-keep partial; only fall to mock when ZERO real tracks fetched.
15. **[opt·med·M] Catalog pages load serially + O(n²) concat.** 5 sequential round-trips gate jukebox
    readiness; `all.concat` reallocates each page. Use X-Total-Count to fire remaining pages in parallel;
    `push(...list)` instead of concat. Sequential fallback if the header is absent. (Pairs with #3.)

## Wave P3 — index.html (refinement/consistency/copy) — QUEUED (after Weekly Rift commits; same file)
7. **[refine·med·S] Results reveal isn't sequenced.** Score count-up, grade bloom, stars, breakdown all fire
   within ~90ms. Cascade them: delay the count-up ~350-450ms; stagger the sub-sections. Honor reduce-motion.
   (game.js delay + index.html CSS — done in the index.html wave to keep the cross-file edit atomic.)
9. **[refine·med·S] Two difficulty pickers, different fonts + casing.** `.rvl-diff` (Chakra Petch, "EASY")
   vs `.set-seg` (JetBrains Mono, "Easy"). Share one segmented-control style + casing.
11. **[refine·med·M] Control labels split across two typefaces in Settings.** `.set-l` / `.set-seg` use
    JetBrains Mono while section headers use Chakra Petch. Move interactive labels to Chakra Petch; reserve
    mono for numeric/data. (Or sanction JetBrains Mono as a 4th tier in CLAUDE.md.)
12. **[refine·med·S] "Sign in" vs "Sign In" inconsistent** across auth surfaces. Standardize on sentence-case.
13. **[refine·low·S] "Level's" toggle label reads as a typo** next to "My Guitar". Rebalance the pair.
14. **[opt·low·S] Bungee font fetched from Google Fonts but never used** (line 29). Remove from the URL —
    it's dead weight on the render-blocking font fetch.

## Notes
- P1 + P2 run concurrently (disjoint files) alongside the Weekly Rift finish (index.html). P3 is serialized
  after Weekly Rift commits. Each wave gets an adversarial Opus review before ship.
- The two hot-loop perf fixes (#1, #2) are the note-loop cursor work flagged as "regression-sensitive" in
  PERF_FINDINGS.md — #1 is byte-identical (safe); #2 must be verified to not skip a miss.
