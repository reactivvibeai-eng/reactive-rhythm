# Performance findings — heavy-load hot paths (for the owner + FPS meter)

A 3-lens read-only audit of the per-frame hot paths (render loop, backdrop, MP), targeting your
"performance under heavy load" complaint. Split into what I **already applied** (zero-risk, shipping
in build121) and what **needs your FPS meter** to validate before I touch it (bigger wins, but they
can't be measured headless and some are regression-sensitive on a live engine).

## ✅ Applied now — build121 (SAFE_NOW, zero behavior change, reviewed)
Pure allocation/compute reductions with byte-identical output:
- **`fretGeom()` memoized per frame** — it was recomputed 3–5× per frame (identical geometry each
  time), each call allocating a rect + 2 arrays. Now computed once and reused.
- **Vignette gradient cached** — the full-screen radial gradient was rebuilt every frame; it's static,
  so it's cached and rebuilt only on resize.
- **`new Path2D()` per lane → direct canvas path** — removed 5 heap allocations/frame in the string glow.
- **Camera-shake translate skipped at rest** — no more per-frame `Math.random()` translate when there's
  no shake.
- **Ember decay `pow()` hoisted** — was ~760 `Math.pow()` calls/frame in the particle loop; now 1.
- **O(1) particle removal** — `splice()` (O(n) per dead particle) → order-preserving compaction.

None of these change a single pixel — they just stop wasting CPU/GC each frame. Should help most on
integrated-GPU / lower-end machines under a dense chart.

## 🔬 Needs your FPS meter to validate (bigger wins, held for your call)
These are real, higher-impact wins, but (a) I can't measure the gain in this headless environment, and
(b) a couple touch regression-sensitive paths, so I'm not shipping them overnight without your eye.
Ranked by expected impact:

1. **Warped-guitar re-slice → offscreen cache (biggest backdrop cost).** `drawCathedralBg` (game.js
   ~6767) re-slices the warped guitar into **64 `drawImage` bands every frame** even though the image
   is identical frame-to-frame (only notes move). Caching the warped composite into an offscreen canvas
   (rebuild only on resize / skin swap / warp change; keep the per-slice path only during the ~2s
   MATERIALIZE intro) collapses 64–128 `drawImage`/frame → **1**. The engine already caches its own
   guitar shadow this exact way, so the pattern is proven. **Likely the single biggest heavy-load win.**

2. **Note loops: active-window cursor (O(total) → O(active)).** The miss-sweep and note-draw both
   iterate the *entire* chart every frame (~1500–3000 notes on a Hard chart) when only ~15–30 are on
   screen — ~360k wasted iterations/sec. A moving `firstLiveIdx` cursor + an early `break` once a note
   is beyond the approach window fixes it. **High impact, but regression-sensitive** (must not drop
   held/resolving hold notes) — wants a careful build + your playtest to confirm no dropped notes.

3. **`drawComboEnergy` feather-mask cache.** During combo it rebuilds ~28 gradients + a 14-slice
   feather mask every frame; the edge-feather geometry is static and can be baked to a cached canvas
   (the moving band/wash gradients stay dynamic). Medium win.

4. **MP `renderGhost` warped-guitar cache.** In split-screen/VS the rival guitar is re-sliced into 40
   `drawImage` bands every frame on a *second* rAF. Same offscreen-cache fix as #1. MP-only.

5. **Per-particle `rgba()` string / `toFixed()` churn.** Hundreds of transient strings/frame at peak
   particle count → GC jitter. Precompute stable color prefixes at spawn; drop `toFixed()` in the loop.
   Low-priority polish (smooths frame-time jitter more than raw FPS).

**My recommendation:** #1 (warped-guitar cache) is the highest value-to-risk — I can build it on your
nod and you validate the FPS delta + confirm the intro still materializes correctly. #2 (note cursor)
is the biggest raw win but I'd want your playtest sign-off given it touches the note loop.
