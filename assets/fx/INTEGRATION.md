# assets/fx — flipbook FX pack + integration

Generated sprite-sheet (flipbook) particle FX for Reactive Rhythm. Brand-aligned
(crimson/ember/gold/chrome, violet only for Skully). Everything here is **assets
only** — no game code was touched. This doc is the contract for wiring it in.

## What's in the pack
7 sheets, each 128×128 cells, RGB on pure black, built for **additive** blending.

| effect | grid | frames | fps | loop | use |
|---|---|---|---|---|---|
| `hit-burst` | 4×4 | 16 | 30 | no | normal note hit |
| `perfect-flare` | 5×4 | 20 | 30 | no | perfect / accent hit |
| `explosion` | 7×4 | 28 | 30 | no | big combo / star / overdrive pop |
| `shockwave` | 4×4 | 16 | 30 | no | impact ring (pairs well under explosion) |
| `fire-loop` | 6×4 | 24 | 24 | **yes** | burning strings at high combo |
| `miss-shatter` | 4×4 | 16 | 24 | no | miss / bomb hit (intentionally muted/dark) |
| `soulwisp-violet` | 6×4 | 24 | 14 | **yes** | ambient drift for the Skully level |

Source clips are in `_src/*.mp4`; extracted frames are gitignored. Rebuild any
sheet with `python build_sheet.py <name> --count N --cols C --rows R [--loop]`.

## Manifest contract (`manifest.json`)
One JSON object, `name -> meta`:
```json
"hit-burst": { "src":"assets/fx/hit-burst.png", "frameW":128, "frameH":128,
               "cols":4, "rows":4, "count":16, "fps":30, "blend":"lighter", "loop":false }
```
- `src` is **repo-root-relative**. The loader resolves the actual image by
  *basename next to manifest.json*, so it works at `/` or a subpath like `/play`.
- `count` may be < `cols*rows` (last cells unused) — always honor `count`.
- `blend:"lighter"` ⇒ draw with `ctx.globalCompositeOperation = "lighter"`.

## Drop-in player (`fx-player.js`) — recommended
Vanilla Canvas2D, no deps, `node --check` clean. Add the script, then:
```js
const fx = await FxPlayer.load('assets/fx/manifest.json'); // adjust path for /play
// ...inside the existing rAF render loop, AFTER the scene is drawn to ctx:
fx.draw(ctx, performance.now());
// on events:
fx.play('hit-burst',    x, y, { scale: 0.9 });
fx.play('perfect-flare',x, y, { scale: 1.2 });
fx.play('miss-shatter', x, y, { scale: 1.0 });
const flame = fx.play('fire-loop', x, y, { scale: 1.5, loop: true });
flame.move(nx, ny);  flame.stop();
```
- `x,y` = effect **center**, canvas px. `scale 1` ⇒ 128px on screen.
- One-shots auto-cull when finished; loops live until `.stop()` (or `fx.clear()`).
- `fx.draw()` must run every frame; it advances + culls and returns the live count.

If you'd rather not add a `<script>`, copy the `FxPlayer` body into `game.js` — the
frame math is ~25 lines (frame = `floor((now-start)/(1000/fps))`, mod `count` for
loops; `sx=(f%cols)*frameW`, `sy=floor(f/cols)*frameH`).

## Suggested wiring (engine agent's call)
- Catcher x = `fretGeom()` string x; y = the catcher/hit line. Scale to lane width
  (≈ laneWidth/128).
- hit → `hit-burst`; perfect/accent → `perfect-flare`; big combo milestone or
  star/overdrive → `explosion` + `shockwave` together; miss/bomb → `miss-shatter`.
- The existing "strings catch fire at combo" could swap to a `fire-loop` handle per
  burning string (spawn on cross-threshold, `.move()` to track, `.stop()` on break).
- Skully level ambient: a few `soulwisp-violet` loops drifting behind the neck.

## Preview / verification
`preview.html` animates the whole pack from the manifest (background + speed +
cell-size toggles) — open via the no-cache server:
`python serve.py` → `http://localhost:8787/assets/fx/preview.html`.
Verified headless: all 7 load, no console errors, additive composite correct.
`window.__fx` / `window.__errs` in preview.html are **dev-only** hooks (harmless,
but strip if you ever ship preview.html — it's a dev tool, not in the deploy set).

---
### NOTE FOR THE GAME-CODE (engine) AGENT
I (FX/assets agent) own `assets/fx/` only and did **not** touch `game.js` /
`index.html` to avoid the file-collision risk called out in CLAUDE.md's two-agent
split. Wiring these into the engine is yours. Everything you need is above:
`fx-player.js` is drop-in and `node --check` clean; the manifest is the stable
contract. Bump `?v=NN` if you add `<script src="assets/fx/fx-player.js?v=NN">` to
index.html. Ping me if you want a different API shape (e.g. an emitter that owns its
own overlay canvas, or per-effect default scales baked into the manifest).
