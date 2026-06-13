# _build7 — FINAL store reframe (guitar SKINS + premium LEVELS) — anchors re-verified vs live v84

**STATUS: READY TO APPLY.** Every anchor below was re-verified by reading the CURRENT files at ROOT on this pass
(`game.js`, `index.html`, `catalog.js` — all at `?v=84`). Apply top-to-bottom by find-anchor → insert/replace. This supersedes
`_build6_guitarstore.md` (one anchor in that doc — step 3.2 — no longer matched the live file; corrected here).

**Assets confirmed ON DISK** (verified this pass, wire to these exact paths):
- `assets/guitars/violet-gothic.png`, `assets/guitars/crimson-chrome.png`, `assets/guitars/ember-bone.png`, `assets/guitars/gold-relic.png` (4 recolors, ~700KB each)
- `assets/store/skin-violet-gothic.jpg`, `assets/store/skin-crimson-chrome.jpg`, `assets/store/skin-ember-bone.jpg`, `assets/store/skin-gold-relic.jpg` (4 covers)
- `assets/store/boss_neon.jpg`, `assets/store/theme_neon.jpg` (reused for the premium level + theme items)
- All `assets/guitars/*` are geometry-matched recolors of the base 6-string `assets/guitar.png`, so string geometry stays aligned (notes ride `ART.nutXF/bridgeXF`, not the image).

**Live-code facts confirmed this pass (so you can trust the anchors):**
- `let activeGuitarImg = guitarImg;` declared game.js:209; `const guitarImg` / `const guitarImg5` at 207/208; `let laneProfile='standard'` at 375; `const LANE_PROFILES` at 347 (each profile has a `.img`); `applyLaneProfile` 386–403; the `window.__rrLaneMode` export is game.js:404 (immediately after `applyLaneProfile`'s closing `}`, **no blank line** — this is why _build6 step 3.2 failed); `async function play(prov, opts)` at 905; draw guards `if (!activeGuitarImg || !activeGuitarImg._ready) return;` (2628) and `if (activeGuitarImg._ready)` (2713) — so a not-yet-loaded/failed skin image can never break rendering; `bootLaneProfile` IIFE at 981 (runs `applyLaneProfile` AFTER the whole body is defined → the 3.1 boot read is safe); `window.RhythmGame.showToast` exists (934).
- index.html STORE IIFE: `var STORE_ART` 4089; `function typeLabel` 4104; `function blurb` 4105; `function buyBtnHtml` 4133; `function wireBuys` 4164; `var items = [], balance = 0, ...` 4102; buy-success `toast(...)/refreshEntitlements()/return` 4197–4199; `load()` `items = out.items || [];` 4226. CSS `.store-buy` base at 731 (crimson `#ff2a38→#b3121f`), `.store-buy.owned` gold at 736; mobile `@media (max-width:560px){ .store-title ... }` at 739.
- index.html LEVELS IIFE: schema comment `//  mods  (opt) {speed,mirror,failOn} ...` confirmed; frac-01 4-line entry confirmed; `function applyLevelTheme(L) {` + next 2 lines confirmed; `function clearLevelTheme() {` + `var g...` + `hideReactive();` confirmed. Premium level `frac-boss` already declares `unlock:{ stars:2, entitlement:{ item_type:'level', item_id:'boss_neon' } }` (line ~3392) and the picker's `ownsEntitlement` already calls `RC.ownsItem(...)` (3413) and reads `RC._entitlements.owns` (3414) — neither exists in catalog.js yet (3.5 fixes that).
- catalog.js: `async function getEntitlements()` 124–130 (matches exactly); export line `getStore, getEntitlements, spendSparks,` 874.

**Stays byte-identical:** standard 6-string + gh 5-string gameplay / scoring / timing / input / chart building — untouched. The skin layer only changes which IMAGE `drawCathedralBg` blits. No flag needed (no gameplay change). Default path with no equipped skin + no per-level skin = exactly today.

---

## EDIT 1 — game.js — add the guitar-skin layer (NEW code, inert when unused)

**FILE:** `game.js`
**ANCHOR (unique, exists once — game.js:404):**
```js
  try { window.__rrLaneMode = applyLaneProfile; window.__rrGetLaneMode = () => laneProfile; } catch (e) {}
```
**ACTION: INSERT the following block IMMEDIATELY AFTER that anchor line.**
```js

  // ---- GUITAR SKIN LAYER (image-only swap) -------------------------------------
  // Swaps activeGuitarImg to a re-skinned guitar PNG WITHOUT touching geometry
  // (LANE_COUNT / ART.nutXF / ART.bridgeXF / aspect / fit all stay from the lane
  // profile), so notes & strings stay aligned. The skin art MUST share the active
  // profile's silhouette + string positions (skins target the standard 6-string;
  // assets/guitars/* are recolors of assets/guitar.png). A 404 self-heals back to
  // the lane-profile default image. Equipped skin persists in rr_skin; a per-level
  // guitarSkin is a temporary override that does NOT touch rr_skin.
  const SKIN_STORE = 'rr_skin';
  let equippedSkinSrc = null;       // persisted (rr_skin) — the global equip
  let _levelSkinActive = false;     // true while a per-level override is showing
  function _profileDefaultImg() { const p = LANE_PROFILES[laneProfile]; return (p && p.img) || guitarImg; }
  function _applySkinImg(src) {
    if (!src) { activeGuitarImg = _profileDefaultImg(); return; }
    const im = new Image(); im._ready = false;
    im.onload = () => { im._ready = true; };
    im.onerror = () => { if (activeGuitarImg === im) activeGuitarImg = _profileDefaultImg(); };  // self-heal: missing skin → profile default
    im.src = src;
    activeGuitarImg = im;            // draw site guards on _ready, so a not-yet-loaded image just skips a frame
  }
  // Per-level override (temporary). Pass falsy to drop the override → back to equipped/default.
  function setGuitarSkin(src) {
    if (src) { _levelSkinActive = true; _applySkinImg(src); }
    else { _levelSkinActive = false; _applySkinImg(equippedSkinSrc); }
  }
  // Equip a skin globally (persisted). Pass falsy to clear the equip (back to default).
  function equipGuitarSkin(src) {
    equippedSkinSrc = src || null;
    try { if (equippedSkinSrc) localStorage.setItem(SKIN_STORE, equippedSkinSrc); else localStorage.removeItem(SKIN_STORE); } catch (e) {}
    if (!_levelSkinActive) _applySkinImg(equippedSkinSrc);   // don't stomp an active per-level skin
  }
  // Re-assert the equipped skin (used on game start + after a level clears its override).
  function applyEquippedSkin() {
    _levelSkinActive = false;
    try { equippedSkinSrc = localStorage.getItem(SKIN_STORE) || null; } catch (e) { equippedSkinSrc = null; }
    _applySkinImg(equippedSkinSrc);
  }
  // boot the equipped skin (bootLaneProfile runs applyLaneProfile later, so reading storage now is safe)
  try { equippedSkinSrc = localStorage.getItem(SKIN_STORE) || null; } catch (e) { equippedSkinSrc = null; }
  window.RhythmGame = window.RhythmGame || {};
  window.RhythmGame.setGuitarSkin = setGuitarSkin;       // per-level temporary override
  window.RhythmGame.equipGuitarSkin = equipGuitarSkin;   // global persisted equip
  window.RhythmGame.applyEquippedSkin = applyEquippedSkin;
  window.RhythmGame.getEquippedSkin = () => equippedSkinSrc;
```
> Safe because `_applySkinImg` only writes `activeGuitarImg`; the draw site already guards on `._ready` (game.js 2628 & 2713). `window.RhythmGame = window.RhythmGame || {}` is the same idempotent pattern already used at game.js 518/933.

---

## EDIT 2 — game.js — keep your equip after a 6↔5-string profile swap

**FILE:** `game.js`
**ANCHOR (unique — game.js:402–404; CORRECTED: in the live file the export line is adjacent to the closing `}`, NO blank line between them):**
```js
    try { if (typeof layoutTapZones === 'function') layoutTapZones(); } catch (e) {}
  }
  try { window.__rrLaneMode = applyLaneProfile; window.__rrGetLaneMode = () => laneProfile; } catch (e) {}
```
**ACTION: REPLACE the 3 anchor lines with (adds ONE re-assert line inside `applyLaneProfile`, before its `}`; then EDIT 1's block follows as already inserted):**
```js
    try { if (typeof layoutTapZones === 'function') layoutTapZones(); } catch (e) {}
    // keep the active skin after a profile swap: per-level override wins, else equipped, else this profile's default (already set above)
    try { if (typeof _applySkinImg === 'function') { if (_levelSkinActive) {} else if (equippedSkinSrc) _applySkinImg(equippedSkinSrc); } } catch (e) {}
  }
  try { window.__rrLaneMode = applyLaneProfile; window.__rrGetLaneMode = () => laneProfile; } catch (e) {}
```
> `_applySkinImg`/`equippedSkinSrc`/`_levelSkinActive` are declared just below (EDIT 1) but `applyLaneProfile` only RUNS via `bootLaneProfile` (game.js:981), after the whole body is defined — so the `typeof` guard + hoisted `let` make this correct at call time.
> **APPLY ORDER:** do EDIT 2 first (replace the 3 lines), then EDIT 1 (insert after the now-final `window.__rrLaneMode` line). Either order works because EDIT 1's anchor (`window.__rrLaneMode ...`) is preserved verbatim by EDIT 2.

---

## EDIT 3 — game.js — apply the equipped skin on every game start

**FILE:** `game.js`
**ANCHOR (unique — game.js:905–907):**
```js
  async function play(prov, opts) {
    provider = prov;
    bossMode = !!(opts && opts.boss) || bossFlag;   // Boss Stage: Levels boss card → playBoss(), or ?boss=1 to test
```
**ACTION: REPLACE with:**
```js
  async function play(prov, opts) {
    provider = prov;
    bossMode = !!(opts && opts.boss) || bossFlag;   // Boss Stage: Levels boss card → playBoss(), or ?boss=1 to test
    // re-assert the equipped skin at start UNLESS a per-level override is active (launchLevel sets it via applyLevelTheme before play())
    try { if (!_levelSkinActive && typeof applyEquippedSkin === 'function') applyEquippedSkin(); } catch (e) {}
```
> Confirmed flow: `launchLevel` (index.html:3521) calls `applyLevelTheme(L)` (→ `setGuitarSkin`, sets `_levelSkinActive=true`) at line ~3527, THEN `launchTrack→play` at ~3540 — so the level override survives. Quick Play / library tracks have `_levelSkinActive=false` → equipped skin re-asserts.

---

## EDIT 4 — index.html — per-level `guitarSkin` field + apply/restore in the level lifecycle

### 4a) Add `guitarSkin` to the Skully showcase level (frac-01)

**FILE:** `index.html`
**ANCHOR (unique — the frac-01 entry, 4 lines):**
```js
    { id:'frac-01', tier:'hard', title:'The World', song:{ trackId:'53613a30-84c6-417e-89dd-d2aa06549141' }, theme:'violet',
      cover:'assets/levels/tarot.jpg', bgArt:'assets/levels/skully-bg.jpg', bgVideo:'assets/levels/skully-loop.mp4',
      reactiveCards:{ hit:'assets/levels/card-world.jpg', miss:'assets/levels/card-death.jpg' },
      mods:{ speed:1.15, mirror:false }, unlock:{ stars:1 } },   // SKULLY showcase level (Lil' Clay Skullyrae)
```
**ACTION: REPLACE with (adds `guitarSkin` line):**
```js
    { id:'frac-01', tier:'hard', title:'The World', song:{ trackId:'53613a30-84c6-417e-89dd-d2aa06549141' }, theme:'violet',
      cover:'assets/levels/tarot.jpg', bgArt:'assets/levels/skully-bg.jpg', bgVideo:'assets/levels/skully-loop.mp4',
      reactiveCards:{ hit:'assets/levels/card-world.jpg', miss:'assets/levels/card-death.jpg' },
      guitarSkin:'assets/guitars/violet-gothic.png',   // per-level custom guitar (geometry-matched recolor of assets/guitar.png; 404 → default)
      mods:{ speed:1.15, mirror:false }, unlock:{ stars:1 } },   // SKULLY showcase level (Lil' Clay Skullyrae)
```

### 4b) Document the field in the LEVEL SCHEMA comment

**FILE:** `index.html`
**ANCHOR (unique):**
```js
    //  mods  (opt) {speed,mirror,failOn} applied only if LEVELDESIGN_MODS=true (off)
```
**ACTION: REPLACE with (adds one doc line above it):**
```js
    //  guitarSkin (opt) 'assets/guitars/x.png' per-level guitar art (MUST match the active profile's silhouette+strings; 404→default)
    //  mods  (opt) {speed,mirror,failOn} applied only if LEVELDESIGN_MODS=true (off)
```

### 4c) Apply the per-level skin in `applyLevelTheme`

**FILE:** `index.html`
**ANCHOR (unique — top of `applyLevelTheme`, 3 lines):**
```js
  function applyLevelTheme(L) {
    var g = $('game'); if (!g) return;
    if (L && L.theme && LV_THEMES[L.theme]) { g.classList.add('rr-lvl-themed'); g.setAttribute('data-rrtheme', L.theme); }
```
**ACTION: REPLACE with (adds the override apply right after the opening lines, before the `else {...}` that immediately follows in source):**
```js
  function applyLevelTheme(L) {
    var g = $('game'); if (!g) return;
    // per-level custom guitar (temporary override; self-heals to default on 404). Falsy guitarSkin → equipped/default.
    try { if (window.RhythmGame && window.RhythmGame.setGuitarSkin) window.RhythmGame.setGuitarSkin(L && L.guitarSkin ? L.guitarSkin : null); } catch (e) {}
    if (L && L.theme && LV_THEMES[L.theme]) { g.classList.add('rr-lvl-themed'); g.setAttribute('data-rrtheme', L.theme); }
```
> Inserting BEFORE the `data-rrtheme` line (rather than after) keeps the anchor a contiguous 3-line block whose last line stays intact for the matcher. `setGuitarSkin(null)` for a level without `guitarSkin` clears any stale override → falls back to equipped/default (correct for back-to-back replays).

### 4d) Restore the equipped/default skin when a level's theme clears

**FILE:** `index.html`
**ANCHOR (unique — top of `clearLevelTheme`, 3 lines):**
```js
  function clearLevelTheme() {
    var g = $('game'); if (g) { g.classList.remove('rr-lvl-themed'); g.removeAttribute('data-rrtheme'); }
    hideReactive();
```
**ACTION: REPLACE with (adds the restore after `hideReactive();`):**
```js
  function clearLevelTheme() {
    var g = $('game'); if (g) { g.classList.remove('rr-lvl-themed'); g.removeAttribute('data-rrtheme'); }
    hideReactive();
    try { if (window.RhythmGame && window.RhythmGame.applyEquippedSkin) window.RhythmGame.applyEquippedSkin(); } catch (e) {}
```
> `clearLevelTheme` fires on `showScreen('menu'|'results')` — so returning from a custom-guitar level restores the equipped (or default) guitar automatically.

---

## EDIT 5 — catalog.js — `ownsItem` + entitlements cache (the Levels picker already calls these)

**FILE:** `catalog.js`
**ANCHOR (unique — `getEntitlements`, catalog.js:124–130):**
```js
  async function getEntitlements() {
    if (!API_BASE) return { signed_in: false, owns: [] };
    try {
      const out = await api('/entitlements', { auth: true });
      return { signed_in: !!(out && out.signed_in), owns: Array.isArray(out && out.owns) ? out.owns : [] };
    } catch (e) { return { signed_in: false, owns: [] }; }
  }
```
**ACTION: REPLACE with (prepends a cache + sync `ownsItem`; `getEntitlements` now also fills the cache):**
```js
  // entitlements cache so synchronous callers (Levels picker gating, Store equip state) can read ownership without awaiting.
  const _entitlements = { signed_in: false, owns: [] };
  function _setEntCache(list, signed) {
    _entitlements.owns = Array.isArray(list) ? list.map(function (o) { return { item_type: String(o.item_type), item_id: String(o.item_id) }; }) : [];
    _entitlements.signed_in = !!signed;
  }
  // synchronous ownership check (reads the last-fetched cache). Returns false until getEntitlements()/getStore() has run.
  function ownsItem(item_type, item_id) {
    var t = String(item_type), i = String(item_id);
    return _entitlements.owns.some(function (o) { return o.item_type === t && o.item_id === i; });
  }
  async function getEntitlements() {
    if (!API_BASE) { _setEntCache([], false); return { signed_in: false, owns: [] }; }
    try {
      const out = await api('/entitlements', { auth: true });
      const owns = Array.isArray(out && out.owns) ? out.owns : [];
      _setEntCache(owns, !!(out && out.signed_in));
      return { signed_in: !!(out && out.signed_in), owns: owns };
    } catch (e) { return { signed_in: _entitlements.signed_in, owns: _entitlements.owns.slice() }; }
  }
```

**ANCHOR (unique — the export line, catalog.js:874):**
```js
    getStore, getEntitlements, spendSparks,
```
**ACTION: REPLACE with:**
```js
    getStore, getEntitlements, spendSparks, ownsItem, _entitlements,
```
> The store controller's `refreshEntitlements()`/`load()` already call `getEntitlements()`, which now fills the cache — so after the store opens once, the Levels picker's `ownsItem`/`_entitlements` gating sees owned levels.

---

## EDIT 6 — index.html — STORE controller: skins + levels + themes, equip control, client fallback

Six replacements inside the existing STORE IIFE (`var screen = $('store-screen');`). All anchors verified unique this pass.

### 6a) New `STORE_ART` keys + skin→guitar map + client fallback catalog

**FILE:** `index.html`
**ANCHOR (unique — index.html:4089–4093):**
```js
  var STORE_ART = {
    starter_pack: 'assets/store/starter_pack.jpg',
    boss_neon:    'assets/store/boss_neon.jpg',
    theme_neon:   'assets/store/theme_neon.jpg'
  };
```
**ACTION: REPLACE with:**
```js
  var STORE_ART = {
    // skins (covers on disk: assets/store/skin-*.jpg)
    violet_gothic: 'assets/store/skin-violet-gothic.jpg',
    crimson_chrome:'assets/store/skin-crimson-chrome.jpg',
    ember_bone:    'assets/store/skin-ember-bone.jpg',
    gold_relic:    'assets/store/skin-gold-relic.jpg',
    // premium level + theme (reuse existing covers)
    boss_neon:     'assets/store/boss_neon.jpg',
    theme_neon:    'assets/store/theme_neon.jpg',
    // legacy (back-compat if backend still sends it)
    starter_pack:  'assets/store/starter_pack.jpg'
  };
  // SKIN item_id → the in-game guitar PNG to equip (on disk: assets/guitars/*.png). Backend may also send meta.skin_url.
  var SKIN_GUITAR = {
    violet_gothic: 'assets/guitars/violet-gothic.png',
    crimson_chrome:'assets/guitars/crimson-chrome.png',
    ember_bone:    'assets/guitars/ember-bone.png',
    gold_relic:    'assets/guitars/gold-relic.png'
  };
  function skinSrcFor(it) {
    var m = it && it.meta;
    if (m && m.skin_url) return m.skin_url;
    return SKIN_GUITAR[String(it && it.item_id)] || '';
  }
  function isSkin(it) { return String(it && it.item_type).toLowerCase() === 'skin'; }
  // ---- CLIENT STORE FALLBACK CATALOG: used ONLY when backend /store returns no items (dormant / pre-update).
  // Mirrors the Lovable brief below. Prices in Sparks. Equip works fully client-side; level/theme ownership needs backend.
  var STORE_FALLBACK = [
    { item_type:'skin',  item_id:'violet_gothic',  title:'Violet Gothic',  price_sparks:1200, meta:{ description:'Necro-violet relic finish', art_url:STORE_ART.violet_gothic, skin_url:SKIN_GUITAR.violet_gothic } },
    { item_type:'skin',  item_id:'crimson_chrome', title:'Crimson Chrome', price_sparks:1000, meta:{ description:'Mirror-chrome with crimson burst', art_url:STORE_ART.crimson_chrome, skin_url:SKIN_GUITAR.crimson_chrome } },
    { item_type:'skin',  item_id:'ember_bone',     title:'Ember Bone',     price_sparks:1500, meta:{ description:'Charred bone + ember inlays', art_url:STORE_ART.ember_bone, skin_url:SKIN_GUITAR.ember_bone } },
    { item_type:'skin',  item_id:'gold_relic',     title:'Gold Relic',     price_sparks:2000, meta:{ description:'Hammered gold, chrome hardware', art_url:STORE_ART.gold_relic, skin_url:SKIN_GUITAR.gold_relic } },
    { item_type:'level', item_id:'boss_neon',      title:'THE BREAKER (Boss)', price_sparks:2500, meta:{ description:'Unlock the Fracture boss stage', art_url:STORE_ART.boss_neon } },
    { item_type:'theme', item_id:'theme_neon',     title:'Neon Theme',     price_sparks:800,  meta:{ description:'Neon HUD accent theme', art_url:STORE_ART.theme_neon } }
  ];
```
> `boss_neon` matches the picker's existing premium-level entitlement (`unlock:{ entitlement:{ item_type:'level', item_id:'boss_neon' } }` at index.html ~3392) — buying it unlocks `frac-boss` once entitlements persist.

### 6b) `typeLabel` recognises the new types

**FILE:** `index.html`
**ANCHOR (unique — index.html:4104):**
```js
  function typeLabel(t) { var m = { pack: 'Pack', level: 'Boss', addon: 'Theme', boss: 'Boss', theme: 'Theme' }; return m[String(t || '').toLowerCase()] || (t ? String(t) : 'Item'); }
```
**ACTION: REPLACE with:**
```js
  function typeLabel(t) { var m = { skin: 'Guitar', level: 'Level', theme: 'Theme', pack: 'Pack', addon: 'Theme', boss: 'Level' }; return m[String(t || '').toLowerCase()] || (t ? String(t) : 'Item'); }
```

### 6c) `blurb` recognises the new types

**FILE:** `index.html`
**ANCHOR (unique — index.html:4105–4112):**
```js
  function blurb(it) {
    if (it.meta && it.meta.description) return String(it.meta.description);
    var t = String(it.item_type || '').toLowerCase();
    if (t === 'pack') return 'Track pack — unlocks on link';
    if (t === 'level' || t === 'boss') return 'Boss level';
    if (t === 'addon' || t === 'theme') return 'Visual theme';
    return '';
  }
```
**ACTION: REPLACE with:**
```js
  function blurb(it) {
    if (it.meta && it.meta.description) return String(it.meta.description);
    var t = String(it.item_type || '').toLowerCase();
    if (t === 'skin') return 'Guitar skin — equip to play';
    if (t === 'level' || t === 'boss') return 'Premium level — unlocks in Levels';
    if (t === 'theme' || t === 'addon') return 'Visual theme';
    if (t === 'pack') return 'Track pack — unlocks on link';
    return '';
  }
```

### 6d) Equip state vars + handlers

**FILE:** `index.html`
**ANCHOR (unique — index.html:4102):**
```js
  var items = [], balance = 0, signedIn = false, owns = {}, busy = false;
```
**ACTION: REPLACE with:**
```js
  var items = [], balance = 0, signedIn = false, owns = {}, busy = false;
  // equipped skin tracked by item_id (so the right card shows "Equipped"); the guitar PNG is applied via RhythmGame.equipGuitarSkin.
  function equippedSkinId() { try { return localStorage.getItem('rr_skin_id') || ''; } catch (e) { return ''; } }
  function equipSkin(it) {
    var src = skinSrcFor(it); if (!src) { toast('Skin art missing'); return; }
    try { localStorage.setItem('rr_skin_id', String(it.item_id)); } catch (e) {}
    try { if (window.RhythmGame && window.RhythmGame.equipGuitarSkin) window.RhythmGame.equipGuitarSkin(src); } catch (e) {}
    toast('Equipped ' + (it.title || 'guitar'));
    render();   // refresh Equip/Equipped states across the grid
  }
  function unequipSkin() {
    try { localStorage.removeItem('rr_skin_id'); } catch (e) {}
    try { if (window.RhythmGame && window.RhythmGame.equipGuitarSkin) window.RhythmGame.equipGuitarSkin(null); } catch (e) {}
    toast('Default guitar restored'); render();
  }
```

### 6e) `buyBtnHtml` — Equip/Equipped for owned skins

**FILE:** `index.html`
**ANCHOR (unique — index.html:4133–4137):**
```js
  function buyBtnHtml(it) {
    if (isOwned(it)) return '<button class="store-buy owned" disabled>Owned</button>';
    if (!signedIn) return '<button class="store-buy" data-act="signin">Sign in</button>';
    return '<button class="store-buy" data-act="buy" data-type="' + esc(it.item_type) + '" data-id="' + esc(it.item_id) + '">Buy</button>';
  }
```
**ACTION: REPLACE with:**
```js
  function buyBtnHtml(it) {
    if (isOwned(it)) {
      if (isSkin(it)) {
        var on = equippedSkinId() === String(it.item_id);
        return on
          ? '<button class="store-buy equipped" data-act="unequip" data-id="' + esc(it.item_id) + '">Equipped</button>'
          : '<button class="store-buy equip" data-act="equip" data-id="' + esc(it.item_id) + '">Equip</button>';
      }
      return '<button class="store-buy owned" disabled>Owned</button>';
    }
    if (!signedIn) return '<button class="store-buy" data-act="signin">Sign in</button>';
    return '<button class="store-buy" data-act="buy" data-type="' + esc(it.item_type) + '" data-id="' + esc(it.item_id) + '">Buy</button>';
  }
```

### 6f) `wireBuys` — handle equip/unequip clicks

**FILE:** `index.html`
**ANCHOR (unique — index.html:4164–4174):**
```js
  function wireBuys() {
    var btns = $('store-grid').querySelectorAll('.store-buy');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function () {
        var act = this.getAttribute('data-act');
        if (act === 'signin') { openSite('https://reactivvibeai.com'); return; }
        if (act === 'getmore') { openGetSparks(); return; }
        if (act === 'buy') buy(this);
      });
    }
  }
```
**ACTION: REPLACE with:**
```js
  function itemById(id) { for (var i = 0; i < items.length; i++) if (String(items[i].item_id) === String(id)) return items[i]; return null; }
  function wireBuys() {
    var btns = $('store-grid').querySelectorAll('.store-buy');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function () {
        var act = this.getAttribute('data-act');
        if (act === 'signin') { openSite('https://reactivvibeai.com'); return; }
        if (act === 'getmore') { openGetSparks(); return; }
        if (act === 'equip') { var it = itemById(this.getAttribute('data-id')); if (it) equipSkin(it); return; }
        if (act === 'unequip') { unequipSkin(); return; }
        if (act === 'buy') buy(this);
      });
    }
  }
```

### 6g) Auto-equip a skin right after purchase

**FILE:** `index.html`
**ANCHOR (unique — index.html:4197–4199, inside `buy`'s success branch):**
```js
      toast(res.deduped ? 'Already owned' : 'Unlocked!');
      refreshEntitlements();
      return;
```
**ACTION: REPLACE with:**
```js
      var bought = itemById(id);
      if (bought && isSkin(bought)) { equipSkin(bought); toast(res.deduped ? 'Already owned' : 'Unlocked & equipped!'); }
      else toast(res.deduped ? 'Already owned' : 'Unlocked!');
      refreshEntitlements();
      return;
```
> `equipSkin` calls `render()`, rebuilding the grid (owned skins now show Equip/Equipped). The manual `owned`-class mutation a few lines above (4196) is harmless — it gets re-rendered. Leave it.

### 6h) `load()` falls back to the client catalog when backend returns nothing

**FILE:** `index.html`
**ANCHOR (unique — index.html:4224–4227, inside `load`):**
```js
    try {
      var out = await C.getStore();
      items = out.items || [];
      signedIn = !!out.signed_in;
```
**ACTION: REPLACE with:**
```js
    try {
      var out = await C.getStore();
      items = (out.items && out.items.length) ? out.items : STORE_FALLBACK.slice();   // client catalog until backend /store is updated
      signedIn = !!out.signed_in;
```

---

## EDIT 7 — index.html — CSS for Equip / Equipped buttons (brand colors, additive)

**FILE:** `index.html`
**ANCHOR (unique — index.html:739):**
```css
  @media (max-width: 560px) { .store-title { font-size: 36px; } .store-grid { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; } }
```
**ACTION: INSERT the following 4 lines IMMEDIATELY BEFORE that anchor line.**
```css
  .store-buy.equip { background: linear-gradient(180deg, #ff2a38, #b3121f); color: #fff; border: none; box-shadow: 0 4px 14px rgba(255,31,46,0.35), inset 0 1px 0 rgba(255,255,255,0.22); }
  .store-buy.equip:hover, .store-buy.equip:focus-visible { box-shadow: 0 6px 20px rgba(255,31,46,0.5), inset 0 1px 0 rgba(255,255,255,0.3); }
  .store-buy.equipped { background: linear-gradient(180deg, rgba(224,169,63,0.18), rgba(224,169,63,0.10)); color: #e0a93f; border: 1px solid rgba(224,169,63,0.55); box-shadow: none; cursor: pointer; }
  .store-buy.equipped::before { content: '\2713\00a0'; }   /* gold check ✓ */
```
> Crimson `#ff2a38→#b3121f` is the EXACT base `.store-buy` gradient (index.html:731) — so Equip reads as the primary action; Equipped reuses the gold (`#e0a93f`) of the existing `.store-buy.owned`. No blue/purple. `transition` is inherited from base `.store-buy`; respects `prefers-reduced-motion` because no keyframe animation is added (only box-shadow/color transitions already on the base, which are reduceMotion-safe).

---

## EDIT 8 — index.html — bump `?v=84` → `?v=85` (game.js + catalog.js changed)

**FILE:** `index.html`
Three replacements (jukebox.js/jukebox.css are UNCHANGED — leave at v84; the start-screen stamp parses game.js's `?v`, so it'll read 85):

**ANCHOR (unique — index.html:3220):** `<script src="game.js?v=84"></script>`
**REPLACE:** `<script src="game.js?v=85"></script>`

**ANCHOR (unique — index.html:3222):** `<script src="catalog.js?v=84"></script>`
**REPLACE:** `<script src="catalog.js?v=85"></script>`

> (Optional: also bump `jukebox.js?v=84`→`85` at index.html:3221 and `jukebox.css?v=84`→`85` at index.html:14 for a clean uniform cache-bust, but not required since their bytes don't change.)

---

## LOVABLE BACKEND BRIEF (copy-paste — replace `store_items`)

> **Subject: Replace `store_items` catalog — sell guitar SKINS + premium LEVELS + themes (drop track bundles).**
>
> All 916 songs are free now, so remove track/pack bundles from the Sparks store. The store sells cosmetic **guitar skins**,
> **premium levels** (entitlement unlocks a level in the game), and optional **themes**. The game already calls
> `GET /store`, `GET /entitlements`, `POST /sparks/spend` — keep those contracts; just change the catalog rows.
>
> **`store_items` schema (per row):**
> - `item_type` — one of `skin` | `level` | `theme` (drop `pack`/`boss`)
> - `item_id` — stable string id (used by entitlements + the game)
> - `title` — display name
> - `price_sparks` — integer
> - `meta` (jsonb) — `{ "description": "...", "art_url": "<store cover 1:1 jpg>", "skin_url": "<in-game guitar PNG, skins only>" }`
> - `active` — bool
>
> **Seed rows (match the client fallback so prices agree):**
> | item_type | item_id | title | price_sparks | meta.skin_url | meta.art_url |
> |---|---|---|---|---|---|
> | skin | violet_gothic | Violet Gothic | 1200 | assets/guitars/violet-gothic.png | assets/store/skin-violet-gothic.jpg |
> | skin | crimson_chrome | Crimson Chrome | 1000 | assets/guitars/crimson-chrome.png | assets/store/skin-crimson-chrome.jpg |
> | skin | ember_bone | Ember Bone | 1500 | assets/guitars/ember-bone.png | assets/store/skin-ember-bone.jpg |
> | skin | gold_relic | Gold Relic | 2000 | assets/guitars/gold-relic.png | assets/store/skin-gold-relic.jpg |
> | level | boss_neon | THE BREAKER (Boss) | 2500 | — | assets/store/boss_neon.jpg |
> | theme | theme_neon | Neon Theme | 800 | — | assets/store/theme_neon.jpg |
> (`skin_url`/`art_url` can be absolute CDN URLs; relative paths resolve against the game's `/play` base.)
>
> **`GET /store`** → `{ items:[{item_type,item_id,title,price_sparks,meta,owned?}], balance, signed_in }` (unchanged shape).
> **`GET /entitlements`** → `{ signed_in, owns:[{item_type,item_id}] }` (unchanged). A `level`/`theme` purchase MUST appear here.
> **`POST /sparks/spend` { item_type, item_id, idempotency_key }** → `{ ok, balance, granted, deduped }`; 402
> `insufficient_sparks`, 409 `price_mismatch` (unchanged). For `skin`, granting an entitlement is enough — equip is client-side.
>
> Until this ships, the game uses an identical **client fallback catalog**, so skins are buyable+equippable client-side and the
> store renders correctly; `level`/`theme` ownership just needs the backend entitlement to persist across devices.

---

## VERIFY CHECKLIST

**Static (after edits):**
```
node --check game.js
node --check catalog.js
```
**Greps (each should now match):**
- game.js: `setGuitarSkin`, `equipGuitarSkin`, `applyEquippedSkin`, `_applySkinImg`, `equippedSkinSrc`, `SKIN_STORE`, and exactly ONE `activeGuitarImg = p.img;` + the new re-assert line `else if (equippedSkinSrc) _applySkinImg`
- catalog.js: `function ownsItem`, `const _entitlements`, and `ownsItem, _entitlements,` in the export block (each ONE def)
- index.html: `guitarSkin:'assets/guitars/violet-gothic.png'`, `STORE_FALLBACK`, `SKIN_GUITAR`, `function equipSkin`, `data-act="equip"`, `.store-buy.equipped`, and `game.js?v=85` + `catalog.js?v=85`
- Confirm NO second definition of `activeGuitarImg`, `getStore`, `STORE_ART` was introduced (each ONE def).

**Runtime (Claude_Preview headless, integrator):**
1. `preview_start` "rhythm-rift" → `location.href = '/index.html?cb='+Date.now()` (never `location.replace` — hangs).
2. Console: `RhythmGame.equipGuitarSkin('assets/guitars/violet-gothic.png')` then `RhythmGame.getEquippedSkin()` returns it; reload → still equipped (`rr_skin` persists). Set a bogus path → no console error, guitar stays default (self-heal `onerror`).
3. Open the store (`RhythmLibrary.openStore()` or `#store-open`): with backend dormant it shows the 6 fallback items; skins show **Buy** (guest). Mock-own a skin (`localStorage.setItem('rr_skin_id','violet_gothic')` then reopen) → that card shows **Equipped** (gold ✓), tap another's **Equip** → it becomes **Equipped**, the first reverts to **Equip**.
4. Launch level `frac-01` (The World): guitar swaps to violet-gothic during the run; return to menu/results → restores equipped/default. Notes stay aligned (geometry untouched) — confirm `window.__rrChartStats` builds, no drift.
5. Premium level gate: `RhythmCatalog._entitlements.owns = [{item_type:'level',item_id:'boss_neon'}]` → `RhythmCatalog.ownsItem('level','boss_neon')` returns true → the `frac-boss` card's entitlement gate opens.
6. `preview_console_logs` level error → expect none.

**Risks:** (1) gh 5-string + an equipped 6-string skin would mis-fit (5 strings over 6-string art). Niche controller mode; OPTIONAL hard guard if wanted: in game.js `_applySkinImg`, early-return to `_profileDefaultImg()` when `laneProfile !== 'standard'`. Left out to keep the default path simplest — flag to user. (2) Two persisted keys by design: `rr_skin` (engine art path, self-heals on 404) + `rr_skin_id` (store UI state); both set by `equipSkin`. (3) Other build packages touch index.html LEVELS/store — apply serially; no two of these 8 edits share an anchor.
