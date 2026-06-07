# assets/fx — flipbook FX pack + integration

Generated sprite-sheet (flipbook) particle FX for Reactive Rhythm. Brand-aligned
(crimson/ember/gold/chrome, violet only for Skully). Everything here is **assets
only** — no game code was touched. This doc is the contract for wiring it in.

## What's in the pack
31 sheets, each 128×128 cells, RGB on pure black, built for **additive** blending.
Every entry's grid + fps + loop + a suggested default `scale` live in `manifest.json`
— read those at runtime, don't hard-code. Effects by category:

- **Core hit feedback (one-shot):** `hit-burst` (normal hit), `perfect-flare` (perfect/accent),
  `combo-burst` (combo milestone), `multiplier-up` (multiplier up), `note-comet` (per-note streak),
  `star-pickup` (collectible), `explosion` (big pop), `shockwave` (impact ring),
  `gradeup-flare` (grade up), `miss-shatter` (miss).
- **Bomb mechanic (engine agent's set):** `bomb-fuse` (lit-fuse loop), `bomb-explode` (detonation), `bomb-warn` (warning pulse loop).
- **Sustained loops:** `fire-loop` (burning strings), `overdrive-aura` (star power active),
  `charge-loop` (meter building), `ember-rise` (warm ambient), `chrome-pulse-ring` (catcher idle).
- **Lane / string (one-shot):** `lane-pulse` (lane strike column), `string-ripple` (strum wave).
- **Fracture tier:** `shard-burst` (glass shatter).
- **Skully tier (violet):** `skull-flame-violet` (loop aura), `soul-burst-violet` (hit), `soulwisp-violet` (ambient loop).
- **Bone Daddy tier (bone/ember):** `bone-shatter` (hit), `ember-skull-loop` (loop aura).
- **Melody tier (pink/cute):** `note-sparkle-pink` (musical sparkle), `heart-pop-pink` (heart), `paw-poof` (cat-paw).
- **Celebratory:** `confetti-pop` (level clear), `firework-gold` (results).

Source clips are in `_src/*.mp4`; extracted frames are gitignored. Rebuild any
sheet with `python build_sheet.py <name> --count N --cols C --rows R [--loop]`.

## Manifest contract (`manifest.json`)
One JSON object, `name -> meta`:
```json
"hit-burst": { "src":"assets/fx/hit-burst.png", "frameW":128, "frameH":128, "cols":4,
               "rows":4, "count":16, "fps":30, "blend":"lighter", "loop":false, "scale":0.9 }
```
- `src` is **repo-root-relative**. The loader resolves the actual image by
  *basename next to manifest.json*, so it works at `/` or a subpath like `/play`.
- `count` may be < `cols*rows` (last cells unused) — always honor `count`.
- `blend:"lighter"` ⇒ draw with `ctx.globalCompositeOperation = "lighter"`.
- `scale` is a suggested default size multiplier (1 ⇒ 128px on screen). `FxPlayer.play()`
  uses it when you don't pass an explicit `opts.scale`; tune to lane width as needed.

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
Verified headless: all sheets load, no console errors, additive composite correct.
`window.__fx` / `window.__errs` in preview.html are **dev-only** hooks (harmless,
but strip if you ever ship preview.html — it's a dev tool, not in the deploy set).

---
### NOTE FOR THE GAME-CODE (engine) AGENT
I (FX/assets agent) own `assets/fx/` only and did **not** touch `game.js` /
`index.html` to avoid the file-collision risk called out in CLAUDE.md's two-agent
split. Wiring these into the engine is yours. Everything you need is above:
`fx-player.js` is drop-in and `node --check` clean; the manifest is the stable
contract. Bump `?v=NN` if you add `<script src="assets/fx/fx-player.js?v=NN">` to
index.html. Per-effect default `scale` is now baked into the manifest and applied by
`FxPlayer.play()` when you omit `opts.scale`. Ping me if you want a different API shape
(e.g. an emitter that owns its own overlay canvas), more variants, or theme re-skins.
