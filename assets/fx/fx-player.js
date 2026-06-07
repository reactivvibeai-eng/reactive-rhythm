/*
 * fx-player.js — flipbook (sprite-sheet) FX player for Reactive Rhythm.
 * Vanilla Canvas2D, zero dependencies. Reads assets/fx/manifest.json.
 *
 * Sheets are RGB on pure black and meant for ADDITIVE compositing
 * (globalCompositeOperation = "lighter") — the black contributes nothing,
 * so effects glow over the guitar neck without a visible quad edge.
 *
 *   const fx = await FxPlayer.load('assets/fx/manifest.json');
 *
 *   // in the game's existing render loop, AFTER drawing the scene:
 *   fx.draw(ctx, performance.now());
 *
 *   // one-shots (auto-expire):
 *   fx.play('hit-burst',    x, y, { scale: 0.9 });
 *   fx.play('perfect-flare',x, y, { scale: 1.2 });
 *   fx.play('explosion',    x, y, { scale: 1.6 });
 *   fx.play('shockwave',    x, y, { scale: 1.4 });
 *   fx.play('miss-shatter', x, y, { scale: 1.0 });
 *
 *   // loops (return a handle):
 *   const flame = fx.play('fire-loop', x, y, { scale: 1.5, loop: true });
 *   flame.move(x2, y2);   // follow a burning string
 *   flame.stop();         // remove it
 *
 * Notes
 *  - x,y is the effect CENTER, in canvas pixels.
 *  - scale 1 => 128px on screen (the native frameW). Scale to lane width.
 *  - manifest.loop is the default; opts.loop overrides per spawn.
 *  - Sheet image URLs resolve relative to the manifest URL, so this works
 *    whether the game is served at "/" or a subpath like "/play".
 */
(function (global) {
  "use strict";

  function basename(p) { return String(p).split("/").pop(); }

  function FxPlayer(manifest, images, baseUrl) {
    this.manifest = manifest;     // name -> meta
    this.images = images;         // name -> HTMLImageElement
    this.baseUrl = baseUrl;
    this.active = [];             // live instances
  }

  // Load manifest + preload every sheet. Resolves once all images settle.
  FxPlayer.load = function (manifestUrl) {
    return fetch(manifestUrl)
      .then(function (r) {
        if (!r.ok) throw new Error("fx manifest " + r.status);
        return r.json();
      })
      .then(function (manifest) {
        var base = new URL(manifestUrl, global.location.href);
        var names = Object.keys(manifest);
        var images = {};
        return Promise.all(names.map(function (name) {
          return new Promise(function (resolve) {
            var img = new Image();
            // sheets sit next to manifest.json -> resolve by basename
            img.onload = function () { images[name] = img; resolve(); };
            img.onerror = function () {
              console.warn("[fx] missing sheet:", manifest[name].src);
              resolve();
            };
            img.src = new URL(basename(manifest[name].src), base).href;
          });
        })).then(function () { return new FxPlayer(manifest, images, base); });
      });
  };

  // Spawn an effect. Returns a handle (useful for loops): { move, stop, alive }.
  FxPlayer.prototype.play = function (name, x, y, opts) {
    var meta = this.manifest[name];
    if (!meta || !this.images[name]) {
      console.warn("[fx] unknown/again unloaded effect:", name);
      return { move: function () {}, stop: function () {}, alive: function () { return false; } };
    }
    opts = opts || {};
    var inst = {
      meta: meta, img: this.images[name],
      x: x, y: y,
      scale: opts.scale != null ? opts.scale : 1,
      rot: opts.rot || 0,
      alpha: opts.alpha != null ? opts.alpha : 1,
      loop: opts.loop != null ? opts.loop : !!meta.loop,
      start: null,            // set on first draw so timing is frame-accurate
      dead: false
    };
    this.active.push(inst);
    return {
      move: function (nx, ny) { inst.x = nx; inst.y = ny; },
      setScale: function (s) { inst.scale = s; },
      stop: function () { inst.dead = true; },
      alive: function () { return !inst.dead; }
    };
  };

  FxPlayer.prototype.clear = function () { this.active.length = 0; };

  // Call once per game frame, after the scene is drawn.
  FxPlayer.prototype.draw = function (ctx, now) {
    var live = this.active, kept = [];
    for (var n = 0; n < live.length; n++) {
      var it = live[n];
      if (it.dead) continue;
      if (it.start === null) it.start = now;
      var m = it.meta;
      var dur = 1000 / m.fps;
      var f = Math.floor((now - it.start) / dur);
      if (it.loop) {
        f = ((f % m.count) + m.count) % m.count;
      } else if (f >= m.count) {
        continue; // one-shot finished -> cull
      }
      var sx = (f % m.cols) * m.frameW;
      var sy = ((f / m.cols) | 0) * m.frameH;
      var w = m.frameW * it.scale, h = m.frameH * it.scale;
      ctx.save();
      ctx.globalAlpha = it.alpha;
      ctx.globalCompositeOperation = m.blend === "lighter" ? "lighter" : "source-over";
      ctx.translate(it.x, it.y);
      if (it.rot) ctx.rotate(it.rot);
      ctx.drawImage(it.img, sx, sy, m.frameW, m.frameH, -w / 2, -h / 2, w, h);
      ctx.restore();
      kept.push(it);
    }
    this.active = kept;
    return kept.length;
  };

  global.FxPlayer = FxPlayer;
})(typeof window !== "undefined" ? window : this);
