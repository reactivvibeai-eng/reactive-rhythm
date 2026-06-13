# _build6 — Per-level custom guitars + reframed Sparks store (skins + levels)

Ready-to-integrate package. ONE concern, two linked things:
- **(A)** per-level / equipped **custom guitar skin** that swaps `activeGuitarImg` (geometry-safe, self-healing).
- **(B)** **reframed store**: songs are all free, so the store sells **guitar SKINS** (buy → equip → swap globally, persisted)
  + **premium LEVELS** (buy → entitlement unlocks the level in the picker) + optional **themes**. New catalog + client fallback + Lovable brief.

Verified against the REAL files at ROOT (`game.js` ~v84, `index.html` ~v84, `catalog.js`, `jukebox.js`). All anchors below are
**unique existing strings** copy-pasted from those files. Apply by find-anchor → insert/replace.

---

## 1) SUMMARY + WHAT STAYS BYTE-IDENTICAL

**What we add**
- A tiny **guitar-skin layer in game.js**: `RhythmGame.setGuitarSkin(src)` / `clearGuitarSkin()` + `applyEquippedSkin()`. It swaps
  the *image only* (`activeGuitarImg`) — never `LANE_COUNT`, never `ART.nutXF/bridgeXF/aspect/fit`. So note/string geometry is
  untouched. A 404 self-heals back to the lane-profile default image (`guitarImg` / `guitarImg5`).
- A **per-level `guitarSkin` field** on AUTHORED levels. `launchLevel`/`applyLevelTheme` apply it; `clearLevelTheme` restores
  the equipped (or default) skin.
- An **equip system** persisted in `localStorage('rr_skin')`. Applied on engine boot and on every game start (`beginPlay`),
  so the equipped skin is global. Per-level `guitarSkin` temporarily overrides it during that level only.
- **Store reframe** (index.html STORE controller): renders `item_type` of `skin | level | theme`. Skins get an **Equip/Equipped**
  control after purchase (and for already-owned skins); levels/themes keep Buy→Owned. New client STORE fallback catalog so it
  works before the backend `/store` is updated. New `STORE_ART` keys for the new item ids.
- **catalog.js**: `ownsItem(type,id)` helper (the Levels picker already calls `RhythmCatalog.ownsItem` — it does NOT exist yet,
  so premium-level gating silently fails today; this fixes it) + an entitlements cache (`_entitlements`) the picker also reads.
- **ASSET prompts** for geometry-matched skin PNGs + store covers, with exact save paths and code self-heal if absent.
- **LOVABLE brief** to replace `store_items` with the new catalog.

**What stays byte-identical / unchanged**
- **Standard 6-string and gh 5-string gameplay, scoring, timing, input, chart building** — untouched. The skin layer only
  changes which *image* `drawCathedralBg` blits; every geometry source (`fretGeom`, `guitarRect`, `LANE_PROFILES`,
  `ART.nutXF/bridgeXF`) is unchanged. `applyLaneProfile` is unchanged except it now re-asserts the equipped skin AFTER it sets
  the profile default (so switching 6↔5 string keeps your equip).
- `showScreen` exclusivity, `launchTrack`, `openSheet`, the difficulty sheet, leaderboard, profile, splash, reactive cards —
  all unchanged.
- Brand palette/fonts unchanged. No blue/purple in core store/skin UI (a *level* may still use its violet palette).
- Default behavior with **no equipped skin and no per-level skin = exactly today** (`activeGuitarImg` stays the profile default).

**Flag-gating:** none needed for gameplay (no gameplay changes). The store reframe is gated by data only: if the backend still
sends old `pack`/`boss` items, the controller still renders them (back-compat `typeLabel`). New behavior appears as soon as the
new catalog (backend or client fallback) is present.

---

## 2) FLOW / IA

**Equipped skin (global)**
1. Boot: `game.js` reads `localStorage('rr_skin')` → if set, preloads + applies it (self-heal to default on 404).
2. Store → buy a **skin** → after `spendSparks` ok, the card's button becomes **Equip**.
3. Tap **Equip** → `RhythmGame.setGuitarSkin(art_url)` + persist `rr_skin` → button → **Equipped**, others revert to **Equip**.
   A toast confirms. The guitar art updates live if you're on a menu/canvas; otherwise on next game start.
4. Every `beginPlay` re-applies the equipped skin (covers lane-profile swaps / hard reloads).

**Per-level skin (override during one level)**
1. AUTHORED level has `guitarSkin:'assets/guitars/<id>.png'`.
2. `launchLevel → applyLevelTheme` → `RhythmGame.setGuitarSkin(L.guitarSkin)` (temporary; does not touch `rr_skin`).
3. Level ends → `showScreen('menu'|'results')` → `clearLevelTheme()` → `RhythmGame.applyEquippedSkin()` restores the equipped
   (or default) skin. Quick Play / non-level tracks always show the equipped/default skin.

**Premium level gating**
- Picker already computes `authoredUnlocked` and calls `ownsEntitlement → RhythmCatalog.ownsItem(type,id)`. We implement
  `ownsItem` + cache entitlements in catalog.js so a `level` purchase unlocks the matching AUTHORED level
  (`unlock.entitlement:{item_type:'level',item_id:'<id>'}`).

**Store IA (unchanged screens; new content)**
- Header icon `#store-open` → `#store-screen` (exclusive overlay) → grid of items → DONE / Esc closes. Same as today.
- Item card footer now: **Buy** (unowned) → **Equip / Equipped** (owned skin) · **Owned** (owned level/theme). Themes optional.

Back-nav everywhere is the existing Esc / DONE / click-backdrop handlers — untouched.

---

## 3) EXACT INTEGRATION STEPS

> Bump `?v=84` → `?v=85` for **game.js**, **catalog.js**, and the index.html stamp (step 3.7). jukebox.js/jukebox.css untouched.

### 3.1 game.js — add the skin layer (new code; no behavior change when unused)

**Anchor (unique, exists once):**
```js
  try { window.__rrLaneMode = applyLaneProfile; window.__rrGetLaneMode = () => laneProfile; } catch (e) {}
```
**Insert AFTER that line:**
```js
  // ---- GUITAR SKIN LAYER (image-only swap) -------------------------------------
  // Swaps activeGuitarImg to a re-skinned guitar PNG WITHOUT touching geometry
  // (LANE_COUNT / ART.nutXF / ART.bridgeXF / aspect / fit all stay from the lane
  // profile), so notes & strings stay aligned. The skin art MUST share the active
  // profile's silhouette + string positions (see asset prompts). A 404 self-heals
  // back to the lane-profile default image. Equipped skin persists in rr_skin;
  // a per-level guitarSkin is a temporary override that does NOT touch rr_skin.
  const SKIN_STORE = 'rr_skin';
  let equippedSkinSrc = null;       // persisted (rr_skin) — the global equip
  let _levelSkinActive = false;     // true while a per-level override is showing
  function _profileDefaultImg() { const p = LANE_PROFILES[laneProfile]; return (p && p.img) || guitarImg; }
  function _applySkinImg(src) {
    if (!src) { activeGuitarImg = _profileDefaultImg(); return; }
    const im = new Image(); im._ready = false;
    im.onload = () => { im._ready = true; };
    im.onerror = () => { /* self-heal: missing skin → profile default */ if (activeGuitarImg === im) activeGuitarImg = _profileDefaultImg(); };
    im.src = src;
    activeGuitarImg = im;            // drawCathedralBg already guards on _ready, so a not-yet-loaded image just skips a frame
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
  // boot the equipped skin (after the lane profile booted just below; safe to read storage now)
  try { equippedSkinSrc = localStorage.getItem(SKIN_STORE) || null; } catch (e) { equippedSkinSrc = null; }
  window.RhythmGame = window.RhythmGame || {};
  window.RhythmGame.setGuitarSkin = setGuitarSkin;       // per-level temporary override
  window.RhythmGame.equipGuitarSkin = equipGuitarSkin;   // global persisted equip
  window.RhythmGame.applyEquippedSkin = applyEquippedSkin;
  window.RhythmGame.getEquippedSkin = () => equippedSkinSrc;
```

**Why this is safe:** `_applySkinImg` only writes `activeGuitarImg`. The draw site already guards
`if (activeGuitarImg._ready)` (line ~2713) and `if (!activeGuitarImg || !activeGuitarImg._ready) return;` (drawComboEnergy,
~2628), so a not-yet-loaded or failed image never breaks rendering — it just shows the previous frame / falls back.

### 3.2 game.js — make `applyLaneProfile` keep your equip when switching 6↔5 string

`applyLaneProfile` sets `activeGuitarImg = p.img;` (the profile default). After a profile swap we want the equipped skin to
re-assert (unless a per-level override is active).

**Anchor (unique, inside `applyLaneProfile`, exists once):**
```js
    try { if (typeof layoutTapZones === 'function') layoutTapZones(); } catch (e) {}
  }
  try { window.__rrLaneMode = applyLaneProfile; window.__rrGetLaneMode = () => laneProfile; } catch (e) {}
```
**Replace with** (adds one re-assert line inside the function, before its closing brace):
```js
    try { if (typeof layoutTapZones === 'function') layoutTapZones(); } catch (e) {}
    // keep the active skin after a profile swap: per-level override wins, else equipped, else this profile's default (already set above)
    try { if (typeof _applySkinImg === 'function') { if (_levelSkinActive) {} else if (equippedSkinSrc) _applySkinImg(equippedSkinSrc); } } catch (e) {}
  }
  try { window.__rrLaneMode = applyLaneProfile; window.__rrGetLaneMode = () => laneProfile; } catch (e) {}
```
> Note: `_applySkinImg`/`equippedSkinSrc`/`_levelSkinActive` are declared just below this point in source order, but
> `applyLaneProfile` only RUNS later (boot calls it after the whole IIFE body is defined via `bootLaneProfile`), so the
> `typeof` guard + hoisted `let` (TDZ-safe at call time) make this correct. The `equippedSkinSrc` boot read in 3.1 also runs
> before `bootLaneProfile`. (Verified: `bootLaneProfile` is at ~line 981, after all of 3.1's declarations.)

### 3.3 game.js — apply the equipped skin on every game start

**Anchor (unique, exists once — the start of `play`):**
```js
  async function play(prov, opts) {
    provider = prov;
    bossMode = !!(opts && opts.boss) || bossFlag;   // Boss Stage: Levels boss card → playBoss(), or ?boss=1 to test
```
**Replace with:**
```js
  async function play(prov, opts) {
    provider = prov;
    bossMode = !!(opts && opts.boss) || bossFlag;   // Boss Stage: Levels boss card → playBoss(), or ?boss=1 to test
    // re-assert the equipped skin at start UNLESS a per-level override is active (launchLevel sets it just before play())
    try { if (!_levelSkinActive && typeof applyEquippedSkin === 'function') applyEquippedSkin(); } catch (e) {}
```
> Per-level flow calls `setGuitarSkin(L.guitarSkin)` (sets `_levelSkinActive=true`) BEFORE `launchTrack→playUrl→play`, so this
> guard preserves the level override. Quick Play / library tracks have `_levelSkinActive=false` → equipped skin re-asserts.

### 3.4 index.html — per-level `guitarSkin` field + apply/restore in the level lifecycle

**(a) Add `guitarSkin` to the Skully showcase level (and document the field).**

**Anchor (unique, exists once — the frac-01 entry):**
```js
    { id:'frac-01', tier:'hard', title:'The World', song:{ trackId:'53613a30-84c6-417e-89dd-d2aa06549141' }, theme:'violet',
      cover:'assets/levels/tarot.jpg', bgArt:'assets/levels/skully-bg.jpg', bgVideo:'assets/levels/skully-loop.mp4',
      reactiveCards:{ hit:'assets/levels/card-world.jpg', miss:'assets/levels/card-death.jpg' },
      mods:{ speed:1.15, mirror:false }, unlock:{ stars:1 } },   // SKULLY showcase level (Lil' Clay Skullyrae)
```
**Replace with** (adds `guitarSkin`):
```js
    { id:'frac-01', tier:'hard', title:'The World', song:{ trackId:'53613a30-84c6-417e-89dd-d2aa06549141' }, theme:'violet',
      cover:'assets/levels/tarot.jpg', bgArt:'assets/levels/skully-bg.jpg', bgVideo:'assets/levels/skully-loop.mp4',
      reactiveCards:{ hit:'assets/levels/card-world.jpg', miss:'assets/levels/card-death.jpg' },
      guitarSkin:'assets/guitars/violet-gothic.png',   // per-level custom guitar (geometry-matched to assets/guitar.png; 404 → default)
      mods:{ speed:1.15, mirror:false }, unlock:{ stars:1 } },   // SKULLY showcase level (Lil' Clay Skullyrae)
```

**(b) Document the field in the LEVEL SCHEMA comment.**

**Anchor (unique):**
```js
    //  mods  (opt) {speed,mirror,failOn} applied only if LEVELDESIGN_MODS=true (off)
```
**Replace with:**
```js
    //  guitarSkin (opt) 'assets/guitars/x.png' per-level guitar art (MUST match the active profile's silhouette+strings; 404→default)
    //  mods  (opt) {speed,mirror,failOn} applied only if LEVELDESIGN_MODS=true (off)
```

**(c) Apply the per-level skin in `applyLevelTheme` (so it lands with the theme/backdrop).**

**Anchor (unique, the top of `applyLevelTheme`):**
```js
  function applyLevelTheme(L) {
    var g = $('game'); if (!g) return;
    if (L && L.theme && LV_THEMES[L.theme]) { g.classList.add('rr-lvl-themed'); g.setAttribute('data-rrtheme', L.theme); }
    else { g.classList.remove('rr-lvl-themed'); g.removeAttribute('data-rrtheme'); }
```
**Replace with:**
```js
  function applyLevelTheme(L) {
    var g = $('game'); if (!g) return;
    if (L && L.theme && LV_THEMES[L.theme]) { g.classList.add('rr-lvl-themed'); g.setAttribute('data-rrtheme', L.theme); }
    else { g.classList.remove('rr-lvl-themed'); g.removeAttribute('data-rrtheme'); }
    // per-level custom guitar (temporary override; self-heals to default on 404). Falsy guitarSkin → equipped/default.
    try { if (window.RhythmGame && window.RhythmGame.setGuitarSkin) window.RhythmGame.setGuitarSkin(L && L.guitarSkin ? L.guitarSkin : null); } catch (e) {}
```
> `setGuitarSkin(null)` for a level without `guitarSkin` clears any stale override and falls back to the equipped/default —
> correct because levels can be replayed back-to-back.

**(d) Restore the equipped/default skin when a level's theme clears.**

**Anchor (unique, the top of `clearLevelTheme`):**
```js
  function clearLevelTheme() {
    var g = $('game'); if (g) { g.classList.remove('rr-lvl-themed'); g.removeAttribute('data-rrtheme'); }
    hideReactive();
```
**Replace with:**
```js
  function clearLevelTheme() {
    var g = $('game'); if (g) { g.classList.remove('rr-lvl-themed'); g.removeAttribute('data-rrtheme'); }
    hideReactive();
    try { if (window.RhythmGame && window.RhythmGame.applyEquippedSkin) window.RhythmGame.applyEquippedSkin(); } catch (e) {}
```
> `clearLevelTheme` is invoked by `showScreen('menu'|'results')` (game.js line ~190) — so returning to menu/results after a
> custom-guitar level restores the equipped (or default) guitar automatically.

### 3.5 catalog.js — `ownsItem` + entitlements cache (the Levels picker already calls these)

The picker's `ownsEntitlement` calls `RhythmCatalog.ownsItem(type,id)` and reads `RhythmCatalog._entitlements.owns` — neither
exists today, so premium-level gating can't see purchases. Add both.

**Anchor (unique, end of `getEntitlements`):**
```js
  async function getEntitlements() {
    if (!API_BASE) return { signed_in: false, owns: [] };
    try {
      const out = await api('/entitlements', { auth: true });
      return { signed_in: !!(out && out.signed_in), owns: Array.isArray(out && out.owns) ? out.owns : [] };
    } catch (e) { return { signed_in: false, owns: [] }; }
  }
```
**Replace with** (adds a cache + sync `ownsItem`; `getEntitlements` now also populates the cache):
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

**Anchor (unique, the export block):**
```js
    // store / entitlements (LIVE: GET /store, GET /entitlements, POST /sparks/spend)
    getStore, getEntitlements, spendSparks,
```
**Replace with:**
```js
    // store / entitlements (LIVE: GET /store, GET /entitlements, POST /sparks/spend)
    getStore, getEntitlements, spendSparks, ownsItem, _entitlements,
```
> The store controller's `refreshEntitlements()`/`load()` already call `getEntitlements()`, which now fills the cache — so
> after opening the store once, the Levels picker's gating sees owned levels. (Optional polish, not required: call
> `RhythmCatalog.getEntitlements()` once on boot; skip for now to avoid touching boot order.)

### 3.6 index.html — STORE controller: skins + levels + themes, equip control, new fallback catalog

This is the biggest edit. Replace four spots in the existing STORE IIFE (`var screen = $('store-screen');`).

**(a) New `STORE_ART` keys (skins + levels) — keep existing keys for back-compat.**

**Anchor (unique):**
```js
  var STORE_ART = {
    starter_pack: 'assets/store/starter_pack.jpg',
    boss_neon:    'assets/store/boss_neon.jpg',
    theme_neon:   'assets/store/theme_neon.jpg'
  };
```
**Replace with:**
```js
  var STORE_ART = {
    // skins
    violet_gothic: 'assets/store/skin-violet-gothic.jpg',
    crimson_chrome:'assets/store/skin-crimson-chrome.jpg',
    ember_bone:    'assets/store/skin-ember-bone.jpg',
    gold_relic:    'assets/store/skin-gold-relic.jpg',
    // premium levels
    boss_neon:     'assets/store/boss_neon.jpg',
    // themes (optional)
    theme_neon:    'assets/store/theme_neon.jpg',
    // legacy (back-compat if backend still sends it)
    starter_pack:  'assets/store/starter_pack.jpg'
  };
  // SKIN art_url → the in-game guitar PNG to equip. Backend may also send meta.skin_url; this is the client fallback map.
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
  // ---- CLIENT STORE FALLBACK CATALOG: used ONLY when the backend /store returns no items (dormant or pre-update).
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

**(b) `typeLabel` + `blurb` recognise the new types.**

**Anchor (unique):**
```js
  function typeLabel(t) { var m = { pack: 'Pack', level: 'Boss', addon: 'Theme', boss: 'Boss', theme: 'Theme' }; return m[String(t || '').toLowerCase()] || (t ? String(t) : 'Item'); }
```
**Replace with:**
```js
  function typeLabel(t) { var m = { skin: 'Guitar', level: 'Level', theme: 'Theme', pack: 'Pack', addon: 'Theme', boss: 'Level' }; return m[String(t || '').toLowerCase()] || (t ? String(t) : 'Item'); }
```

**Anchor (unique, `blurb`):**
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
**Replace with:**
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

**(c) Equip plumbing: persisted equipped-skin id + the buy/equip button states + handlers.**

**Anchor (unique, the state line):**
```js
  var items = [], balance = 0, signedIn = false, owns = {}, busy = false;
```
**Replace with:**
```js
  var items = [], balance = 0, signedIn = false, owns = {}, busy = false;
  // equipped skin is tracked by item_id (so the right card shows "Equipped"); the guitar PNG is applied via RhythmGame.
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

**Anchor (unique, `buyBtnHtml`):**
```js
  function buyBtnHtml(it) {
    if (isOwned(it)) return '<button class="store-buy owned" disabled>Owned</button>';
    if (!signedIn) return '<button class="store-buy" data-act="signin">Sign in</button>';
    return '<button class="store-buy" data-act="buy" data-type="' + esc(it.item_type) + '" data-id="' + esc(it.item_id) + '">Buy</button>';
  }
```
**Replace with:**
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

**Anchor (unique, `wireBuys`):**
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
**Replace with:**
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

**(d) After a successful skin purchase, auto-equip it (one-tap to play with what you bought).**

**Anchor (unique, inside `buy`'s success branch):**
```js
      toast(res.deduped ? 'Already owned' : 'Unlocked!');
      refreshEntitlements();
      return;
```
**Replace with:**
```js
      var bought = itemById(id);
      if (bought && isSkin(bought)) { equipSkin(bought); toast(res.deduped ? 'Already owned' : 'Unlocked & equipped!'); }
      else toast(res.deduped ? 'Already owned' : 'Unlocked!');
      refreshEntitlements();
      return;
```
> `equipSkin` calls `render()`, which rebuilds the grid (Owned skins now show Equip/Equipped). The manual `owned`-class
> mutation above this anchor is harmless (gets re-rendered) — leave it.

**(e) `load()` uses the client fallback when the backend returns no items.**

**Anchor (unique, inside `load`):**
```js
    try {
      var out = await C.getStore();
      items = out.items || [];
      signedIn = !!out.signed_in;
```
**Replace with:**
```js
    try {
      var out = await C.getStore();
      items = (out.items && out.items.length) ? out.items : STORE_FALLBACK.slice();   // client catalog until backend /store is updated
      signedIn = !!out.signed_in;
```

**(f) (CSS) Equip/Equipped button styling — brand colors, reuse `.store-buy`.**

**Anchor (unique CSS, exists once):**
```css
  @media (max-width: 560px) { .store-title { font-size: 36px; } .store-grid { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; } }
```
**Insert BEFORE that line:**
```css
  .store-buy.equip { background: linear-gradient(180deg,#ff5a47,#c2182a); color:#fff; border:none; box-shadow:0 6px 18px rgba(194,24,42,0.35), inset 0 1px 0 rgba(255,255,255,0.25); }
  .store-buy.equip:hover, .store-buy.equip:focus-visible { box-shadow:0 8px 22px rgba(194,24,42,0.5), inset 0 1px 0 rgba(255,255,255,0.35); }
  .store-buy.equipped { background: linear-gradient(180deg, rgba(224,169,63,0.18), rgba(224,169,63,0.10)); color:#e0a93f; border:1px solid rgba(224,169,63,0.55); cursor:pointer; }
  .store-buy.equipped::before { content:'\2713\00a0'; }   /* ✓ */
```
> `.store-buy` already exists; these are additive modifier classes only. No blue/purple. Gold = equipped (brand), crimson = equip action.

### 3.7 index.html — bump cache-bust + version stamp

Change the three `?v=84` to `?v=85`:
- `<link rel="stylesheet" href="jukebox.css?v=84" />` (leave jukebox.css at 84 if you prefer — it's unchanged; but the stamp
  reads game.js's `?v`, so at minimum bump game.js + catalog.js). **Recommended:** bump game.js and catalog.js to `?v=85`.

**Anchors (each unique):**
```html
<script src="game.js?v=84"></script>
```
→ `<script src="game.js?v=85"></script>`
```html
<script src="catalog.js?v=84"></script>
```
→ `<script src="catalog.js?v=85"></script>`

(jukebox.js/jukebox.css are untouched; leaving them at v84 is fine. The start-screen stamp parses game.js's `?v` so it'll read 85.)

---

## 4) NEW HOOKS + WHERE THEY WIRE

| Hook | Where defined | Read/called by |
|---|---|---|
| `RhythmGame.setGuitarSkin(src)` | game.js (3.1) | `applyLevelTheme` per-level override (3.4c) |
| `RhythmGame.equipGuitarSkin(src)` | game.js (3.1) | Store `equipSkin`/`unequipSkin` (3.6c) |
| `RhythmGame.applyEquippedSkin()` | game.js (3.1) | `play()` start (3.3), `clearLevelTheme` (3.4d) |
| `RhythmGame.getEquippedSkin()` | game.js (3.1) | tooling/tests/verify |
| `localStorage('rr_skin')` | game.js | the persisted equipped guitar PNG src |
| `localStorage('rr_skin_id')` | index.html store | the equipped skin's item_id (UI state) |
| `RhythmCatalog.ownsItem(type,id)` | catalog.js (3.5) | Levels picker `ownsEntitlement` (already calls it) |
| `RhythmCatalog._entitlements` | catalog.js (3.5) | Levels picker fallback path (already reads it) |
| AUTHORED `guitarSkin` field | index.html | `applyLevelTheme` (3.4c) |
| Store `item_type:'skin'/'level'/'theme'` | backend + STORE_FALLBACK | store render + equip + level gating |

**Two persisted keys, two responsibilities (intentional):** `rr_skin` (game.js) = the actual art path the engine equips
(survives even if the store never opens); `rr_skin_id` (store) = which catalog item shows "Equipped". They're set together by
`equipSkin`. If they ever drift (e.g. art path changes), the engine still equips whatever `rr_skin` holds and self-heals on 404.

---

## 5) ASSET GENERATION PROMPTS + SAVE PATHS (+ self-heal)

**CRITICAL GEOMETRY CONSTRAINT (read before generating any guitar skin):** the playfield strings/notes are measured from the
guitar art. A skin for the **standard 6-string** profile MUST be **the same 904×1268 silhouette as `assets/guitar.png`**, with
the 6 strings at the SAME pixel positions (nut cluster ≈ x-fractions 0.450–0.550 at y≈0.05; bridge fan ≈ 0.247→0.750 at y≈0.75),
the same neck angle, the same body outline, transparent background. Only the *finish/color/material* changes. If positions
shift, notes drift off the strings. **Safest production method:** start FROM `assets/guitar.png` (or `assets/guitar-src.png`)
and recolor/retexture in place — do NOT re-pose or re-frame the instrument. The prompts below describe a recolor of the
identical instrument; the asset agent should composite onto / trace the existing silhouette.

**Self-heal already wired:** if any `assets/guitars/<id>.png` is absent, `_applySkinImg.onerror` reverts to the lane-profile
default guitar — so code ships before art exists. Store covers (`assets/store/*.jpg`) fall back to an initial-letter tile via the
existing `<img onerror>`. Nothing 404-fatal.

### Guitar skins (save to `assets/guitars/`, transparent PNG, 904×1268, geometry-identical to assets/guitar.png)

1. **`assets/guitars/violet-gothic.png`** (used by the Skully "The World" level + the violet_gothic store skin)
> Re-skin of the EXACT same electric guitar silhouette and string layout as the reference. Necro-gothic violet finish:
> deep amethyst-to-black lacquer body with subtle engraved filigree, blackened chrome hardware, six bright steel strings in the
> identical positions, faint violet rim-glow. Photoreal product render, transparent background, vertical, head at top bridge at
> bottom — same framing as the reference guitar. Brand-dark, no neon blue. 904×1268.

2. **`assets/guitars/crimson-chrome.png`**
> Same guitar silhouette/strings. Mirror-chrome body with a crimson sunburst burst at the center, polished chrome hardware,
> warm dark edges. Photoreal, transparent background, identical framing. 904×1268.

3. **`assets/guitars/ember-bone.png`**
> Same guitar silhouette/strings. Charred matte-black body with glowing ember-orange cracks and bone-white inlays along the
> neck, brushed-steel hardware. Photoreal, transparent background, identical framing. 904×1268.

4. **`assets/guitars/gold-relic.png`**
> Same guitar silhouette/strings. Hammered antique-gold body with chrome hardware and subtle relic wear, warm highlights.
> Photoreal, transparent background, identical framing. 904×1268.

> (Optional, only if a gh 5-string skin is ever wanted: a separate set matching `assets/guitar5.png` at **1080×1920** with the
> 5 strings at its measured positions. Not required for this build — the per-level/equipped skins above target the standard
> 6-string. If equipped while in gh mode, the 5-string default stays since `_profileDefaultImg()` is profile-aware and the
> standard skin would mis-fit — see Risks.)

### Store covers (save to `assets/store/`, 1:1 square, ~800×800, jpg)

- **`assets/store/skin-violet-gothic.jpg`** — the violet-gothic guitar on a dark crimson-vignette studio backdrop, dramatic rim light.
- **`assets/store/skin-crimson-chrome.jpg`** — the crimson-chrome guitar, chrome reflections, black + crimson backdrop.
- **`assets/store/skin-ember-bone.jpg`** — the ember-bone guitar glowing in the dark, ember sparks.
- **`assets/store/skin-gold-relic.jpg`** — the gold-relic guitar, warm gold key light, black backdrop.
> All: brand palette black · crimson #ff1f2e · ember #ff7a4a · gold #e0a93f · chrome. Square, product-hero composition, no text.
> (Existing `boss_neon.jpg`, `theme_neon.jpg` are reused as-is for the level/theme items.)

---

## 6) LOVABLE BACKEND BRIEF (copy-paste)

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
> (`skin_url`/`art_url` can be absolute CDN URLs if you host them; relative paths resolve against the game's `/play` base.)
>
> **`GET /store`** → `{ items:[{item_type,item_id,title,price_sparks,meta,owned?}], balance, signed_in }` (unchanged shape).
> **`GET /entitlements`** → `{ signed_in, owns:[{item_type,item_id}] }` (unchanged). A `level`/`theme` purchase must appear here.
> **`POST /sparks/spend` { item_type, item_id, idempotency_key }** → `{ ok, balance, granted, deduped }`; 402
> `insufficient_sparks`, 409 `price_mismatch` (unchanged). For `skin`, granting an entitlement is enough — equip is client-side.
>
> Until this ships, the game uses an identical **client fallback catalog**, so skins are buyable+equippable client-side and the
> store renders correctly; `level`/`theme` ownership just needs the backend entitlement to persist across devices.

---

## 7) VERIFY-OFFLINE NOTES + RISKS/COLLISIONS

**Node / structural checks (run after edits):**
- `node --check game.js` and `node --check catalog.js` (must pass).
- index.html inline scripts: extract-and-check the STORE + LEVELS IIFEs, or rely on the preview console (no Node check for HTML).
- Greps to confirm anchors landed (each should now match):
  - game.js: `setGuitarSkin`, `equipGuitarSkin`, `applyEquippedSkin`, `_applySkinImg`, `equippedSkinSrc`, `SKIN_STORE`
  - game.js: still exactly one `activeGuitarImg = p.img;` (in applyLaneProfile) + the new re-assert line
  - index.html: `guitarSkin:'assets/guitars/violet-gothic.png'`, `STORE_FALLBACK`, `SKIN_GUITAR`, `equipSkin`, `data-act="equip"`,
    `.store-buy.equipped`
  - catalog.js: `ownsItem`, `_entitlements`, and `ownsItem, _entitlements,` in the export block
- Confirm **no second** definition of `activeGuitarImg`, `getStore`, `STORE_ART` was introduced (greps should each be 1 def).

**Runtime checks (preview, integrator):**
- Boot with `?dev=1`. In console: `RhythmGame.equipGuitarSkin('assets/guitars/violet-gothic.png')` → `RhythmGame.getEquippedSkin()`
  returns it; reload → still equipped (rr_skin persists). With the PNG absent, no console error, guitar stays default (self-heal).
- Open Store: with backend dormant it shows the 6 fallback items; skins show **Buy** (guest) / after a mocked own show **Equip**.
  Tap Equip → button → **Equipped** (gold ✓), others → **Equip**.
- Launch level `frac-01` (The World): guitar swaps to violet-gothic during the run; return to menu/results → restores
  equipped/default. Notes stay aligned (geometry unchanged) — confirm via `window.__rrChartStats` builds + no drift in the canvas.
- Premium level: mock `RhythmCatalog._entitlements.owns = [{item_type:'level',item_id:'boss_neon'}]`; the `frac-boss`
  card's entitlement gate (`ownsItem`) now returns true.
- End: `preview_console_logs` level error → expect none.

**Risks / collisions**
- **Geometry mismatch (highest risk):** a skin PNG whose strings/silhouette differ from `assets/guitar.png` makes notes drift.
  Mitigation: the asset constraint (recolor the identical instrument) + self-heal. Document this loudly to the asset agent (done).
- **gh 5-string + a 6-string skin:** the equipped 6-string skin would mis-fit the 5-string profile. Current behavior:
  `_applySkinImg` swaps the image regardless of profile, so an equipped standard skin WILL display in gh mode and could look
  slightly off (5 strings drawn over 6-string art). **Recommended guard (optional, low-risk):** make skins profile-tagged — only
  apply when `laneProfile === 'standard'`. If you want this, in game.js `_applySkinImg`/`equipGuitarSkin` gate with
  `if (laneProfile !== 'standard') { activeGuitarImg = _profileDefaultImg(); return; }`. Left OUT of the drop-in to keep the
  default path simplest; flag it to the user. gh is a niche controller mode, so most users never hit it.
- **Two-key drift (`rr_skin` vs `rr_skin_id`):** both set by `equipSkin`; engine trusts `rr_skin` and self-heals — safe.
- **Other build packages touch the same files** (`_build4_menuhub.md`, `_build5_levelidentity.md` touch index.html LEVELS/store
  region). Apply serially; my anchors are specific strings (frac-01 line, `STORE_ART`, `typeLabel`, `buyBtnHtml`, `wireBuys`,
  `load`, `applyLevelTheme`, `clearLevelTheme`) — if a prior package already edited one, re-find the current text and re-apply
  the delta. No two of my edits share an anchor.
- **No gameplay/scoring/timing code is touched** → standard + gh remain byte-identical. The only engine additions are an
  image-swap helper and three `RhythmGame.*` exports, all inert unless a skin is equipped or a level declares `guitarSkin`.
