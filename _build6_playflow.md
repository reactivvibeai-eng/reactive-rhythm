# _build6_playflow.md — Pick-a-LEVEL-when-you-pick-a-song + guided MAIN MENU hub

> **Concern (user's #1 ask):** *"When I pick or browse a song, let me pick a LEVEL/ENVIRONMENT to play
> it in, in clear view, before I initiate."* Today picking a song shows only the DIFFICULTY sheet
> (Drift/Pulse/Fracture) — there is **no** way to choose the visual ENVIRONMENT (the themed backdrop +
> per-level mechanic, e.g. Skully "The World" = violet theme + animated backdrop + DEATH/THE WORLD
> reactive cards). This package adds an **ENVIRONMENT picker row to the song-play sheet** so the player
> chooses *which* level's look/mechanic to play the *picked song* in, then **folds in the guided MAIN
> MENU hub** (from `_build4_menuhub.md`, which is NOT yet applied to the live file — verified).
>
> READ-FIRST done against the **live** files at ROOT:
> - `catalog.js` — `openSheet(track)` (L641) builds the sheet + wires `RhythmGame.setMenuPlayHandler`
>   (the `#play-btn` callback, L676) which routes to `play`/`playUrl`/`playDemo`; `launchTrack(track)`
>   (L700) plays at current difficulty with **no theme**. Both exported on `window.RhythmCatalog` (L870).
> - `index.html` — the **LEVELS IIFE** (L3152): `AUTHORED[]` (L3163) = the environments
>   (theme/bgVideo/bgArt/reactiveCards), `applyLevelTheme(L)` (L3345), `showReactive(L)` (L3392),
>   `clearLevelTheme()` (L3414), `launchLevel(L,ready)` (L3323), `setLevelContext` call (L3327). The
>   song-sheet markup `#song-sheet` (L2211–2251) with `#diff-grid` (L2226). `enter()` (L4345) →
>   currently `menu.classList.add('active')` straight into the library (no hub yet).
> - `game.js` — `#diff-grid .diff-btn` click wiring (L1207), `setLevelContext` (L938), `setDifficulty`
>   (L3120) / `getDifficulty` (L3121), `setMenuPlayHandler` (L3122). `clearLevelTheme` auto-fires on any
>   screen change away from game/countdown (LEVELS IIFE exports it; engine `showScreen` clears theme on
>   menu/results — see CLAUDE.md).
> - `_build4_menuhub.md` — kept; its hub markup/CSS/router are **embedded verbatim here** (Part B) so this
>   one package stands alone. If build4 was *already* applied, **skip Part B** (this doc flags how).

---

## 1) SUMMARY + WHAT STAYS THE SAME / BYTE-IDENTICAL

**What this adds**
- **(A) ENVIRONMENT picker on the song sheet.** A new "Environment" section above the play button shows
  a horizontal, scroll-snap row of selectable environment chips: **Default** (Quick Play, no theme) +
  the authored environments (First Light/gold, Steady Hands/gold, Ember Drift/ember, Heartbeat/crimson,
  Overdrive/ember, Chrome Veins/chrome, **The World**/violet+Skully cards, Hollow Choir/violet, THE
  BREAKER/violet boss). Selecting one re-themes the sheet preview accent and **stages** that environment;
  pressing **INITIATE THE SIGNAL** then plays the **picked song** inside the **chosen environment**
  (applies its theme + bgVideo/bgArt + reactive overlay via the existing `applyLevelTheme`/`showReactive`).
- **(B) Guided MAIN MENU hub** (folds in build4): `#start → MAIN MENU (Campaign / Quick Play /
  Multiplayer / Store / Leaderboards / Profile)`, centered, back-nav, reusing existing screens via the
  existing header buttons + `RhythmLibrary.showView`.
- **(C) A reusable, song-decoupled ENVIRONMENTS list** (`window.RhythmLevels.environments()`), derived
  from `AUTHORED[]` so *any* song can be played in *any* environment. One source of truth.

**What stays byte-identical / untouched (HARD constraints honored)**
- **Standard 6-string + GH 5-string gameplay/scoring/timing:** **zero** edits to hit detection, timing
  windows, scoring, combo/multiplier, overdrive, `LANE_COLORS`, or the locked guitar geometry. The
  environment only sets the **visual theme + backdrop + reactive overlay** (the exact same presentation
  path `launchLevel` already uses) and plays the song via the **existing** `launchTrack`/`play`/`playUrl`
  path with the **already-selected difficulty**. No flag-gating needed because no gameplay code changes.
- **Default environment = today's behavior, byte-identical.** If the player leaves the picker on
  **Default** (the initial selection), INITIATE calls the **unchanged** `_menuPlayHandler` path exactly
  as it does now — no theme applied, `clearLevelTheme()` ensures a clean board. So the *current* flow is
  preserved verbatim; the picker is purely additive.
- `openSheet`'s existing difficulty grid, readiness guards, deep-link, preview-stop — all untouched
  except one additive call (`stageEnvList()`) and one additive branch inside the play handler.
- The LEVELS campaign picker (`#levels-screen`), star gating, `AUTHORED[]` schema — unchanged. We only
  **read** `AUTHORED[]` via a new exported helper; campaign launches still go through `launchLevel`.
- Brand law: Default + all UI chrome stay **black/crimson #ff1f2e/ember #ff7a4a/gold #e0a93f/chrome
  #dad7d2**; only the per-level *violet* (`#a64dff`) appears, and only as an environment accent — exactly
  as `SPLASH_THEME`/`applyLevelTheme` already allow. **No blue/purple in core UI.**
- Fonts: Oxanium/Chakra Petch/Unbounded/JetBrains Mono only. `reduceMotion`-safe (chips have no motion;
  transitions are short and disabled under `html.rr-reduce-motion`).

**Files touched:** `index.html` only (CSS block + sheet markup insert + 1 inline `<script>` for the
environment-picker controller + the LEVELS-IIFE export shim + the hub from build4). **catalog.js is
NOT edited** (we wrap its `setMenuPlayHandler`, see §3 EDIT 4 — the controller intercepts at the DOM
level so no external-file change is required). **Therefore NO `?v=NN` bump is required** (the bump rule
is only for game.js/jukebox.js/catalog.js/jukebox.css edits; this package is index.html-only).

> If you (the integrator) prefer to add the export inside the LEVELS IIFE *and* expose an environment
> apply hook from there (cleaner), that's still index.html — still no `?v` bump.

---

## 2) FLOW / INFORMATION ARCHITECTURE

### Screens & steps
```
#start  ──TAP──▶  #menu-hub (MAIN MENU, centered, 6 tiles)
                     │
   ┌─────────────────┼───────────────────────────────────────────┐
   │ Campaign        │ Quick Play     │ Store/Leaderboards/Profile │ Multiplayer
   ▼                 ▼                ▼  (modal overlays over hub)  ▼
#levels-screen   #menu (library)   existing overlays              #multiplayer-screen
 (campaign)       coverflow/browse   (DONE → back to hub)          (placeholder, BACK→hub)
                     │
              pick / browse a song
                     ▼
              #song-sheet (slides up)
              ┌──────────────────────────────┐
              │ art · title · artist · meta   │
              │ DIFFICULTY  [Drift][Pulse][Fr]│  ← unchanged
              │ ENVIRONMENT [Default][First   │  ← NEW row (scroll-snap chips)
              │   Light][Overdrive][The World]│
              │   …                           │
              │ [ INITIATE THE SIGNAL ↳ ]     │  ← plays picked SONG in chosen ENV
              │ ← Back to songs               │
              └──────────────────────────────┘
                     ▼
              gameplay (chosen song, chosen difficulty, chosen environment theme+backdrop+overlay)
```

### Back-nav
- Hub → any full screen (#menu / #multiplayer-screen): explicit **BACK pill** → `RhythmHub.show()`.
- Hub → modal overlays (Campaign/Store/Leaderboards/Profile): their own **DONE/Esc** returns to the hub
  (they layer at z-261 over the still-`.active` hub — build4 behavior).
- Song sheet → **← Back to songs** (`#sheet-back`, unchanged) closes the sheet to the library.
- Sheet environment selection is **transient**: closing the sheet without INITIATE stages nothing
  (`clearLevelTheme()` is still the engine's source of truth at gameplay teardown).

### Why this is safe
The environment picker reuses the **exact** presentation functions campaign levels already use
(`applyLevelTheme`/`showReactive`) and the **exact** song-launch path the sheet already uses
(`_menuPlayHandler` → `play`/`playUrl`/`playDemo`). We are recombining existing, verified building
blocks — "play THIS song with THAT level's look" — not adding new gameplay.

---

## 3) EXACT INTEGRATION STEPS — PART A (the environment picker; the core ask)

> Apply by finding each **ANCHOR** (a unique existing string copied verbatim from the live file) and
> inserting/replacing as directed.

---

### EDIT 1 — index.html CSS: the environment-picker styles (append inside the single `<style>`)

**FILE:** `index.html`
**ANCHOR (unique existing line — the active difficulty-button rule, L324):**
```css
  .diff-btn.active .lvl { color: var(--crimson); }
```
**ACTION:** INSERT-AFTER that line the following block (additive; no existing rule edited).

```css
  /* ============ ENVIRONMENT PICKER (build6) — choose a LEVEL/ENVIRONMENT for the picked song ============ */
  .env-row { display: flex; gap: 10px; overflow-x: auto; overflow-y: hidden; padding: 2px 2px 8px;
    scroll-snap-type: x proximity; -webkit-overflow-scrolling: touch; scrollbar-width: thin; }
  .env-row::-webkit-scrollbar { height: 5px; }
  .env-row::-webkit-scrollbar-thumb { background: rgba(255,31,46,0.35); border-radius: 999px; }
  .env-chip { scroll-snap-align: start; flex: 0 0 auto; width: 116px; cursor: pointer; position: relative;
    display: flex; flex-direction: column; gap: 0; padding: 0; border: 1px solid var(--line);
    border-radius: 12px; overflow: hidden; background: linear-gradient(180deg, rgba(28,12,14,0.6), rgba(12,6,8,0.85));
    color: var(--ink); font-family: 'Oxanium', sans-serif; text-align: left;
    transition: transform .14s ease, border-color .14s ease, box-shadow .14s ease; }
  .env-chip:hover, .env-chip:focus-visible { transform: translateY(-2px); border-color: var(--ec, var(--crimson));
    box-shadow: 0 8px 22px rgba(0,0,0,0.5), 0 0 18px color-mix(in srgb, var(--ec, #ff1f2e) 36%, transparent);
    outline: none; }
  .env-chip:focus-visible { outline: 2px solid var(--ec, var(--crimson)); outline-offset: 2px; }
  .env-chip.sel { border-color: var(--ec, var(--crimson));
    box-shadow: 0 0 0 1px var(--ec, var(--crimson)) inset, 0 0 20px color-mix(in srgb, var(--ec, #ff1f2e) 45%, transparent); }
  .env-chip .ec-art { position: relative; width: 100%; height: 60px; background-size: cover; background-position: center;
    background-color: var(--ec-bg, #160c0b); display: grid; place-items: center; }
  .env-chip .ec-art .ec-ini { font-family: 'Unbounded', sans-serif; font-weight: 700; font-size: 22px;
    color: color-mix(in srgb, var(--ec, #ff1f2e) 80%, #fff); text-shadow: 0 1px 6px rgba(0,0,0,0.6); }
  .env-chip .ec-art::after { content: ''; position: absolute; inset: 0;
    background: linear-gradient(180deg, transparent 35%, rgba(8,5,6,0.85)); }
  .env-chip.sel .ec-art::before { content: '✓'; position: absolute; top: 5px; right: 6px; z-index: 2;
    font-size: 11px; font-weight: 800; color: #0a0706; background: var(--ec, var(--crimson));
    width: 16px; height: 16px; border-radius: 50%; display: grid; place-items: center; }
  .env-chip .ec-body { position: relative; padding: 7px 9px 9px; }
  .env-chip .ec-name { font-weight: 800; font-size: 12px; letter-spacing: 0.04em; line-height: 1.15;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--ink); }
  .env-chip .ec-tag { font-family: 'Chakra Petch', monospace; font-weight: 600; font-size: 8.5px;
    letter-spacing: 0.14em; text-transform: uppercase; color: var(--ec, var(--ink-dim)); margin-top: 2px; }
  .env-chip .ec-lock { position: absolute; top: 5px; left: 6px; z-index: 2; font-size: 11px; opacity: 0.9; }
  .env-chip.locked { opacity: 0.55; }
  .env-chip.locked:hover { transform: none; }
  .env-hint { font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.04em;
    color: var(--ink-dim); margin-top: 2px; min-height: 13px; }
  html.rr-reduce-motion .env-chip { transition: none; }
  @media (max-width: 480px) { .env-chip { width: 104px; } .env-chip .ec-art { height: 52px; } }
```

> `color-mix` is supported on the user's Chrome target; if unsupported, the property is dropped and the
> chip falls back to its `var(--ec, var(--crimson))` literal — degrades to a crimson chip, never broken.

---

### EDIT 2 — index.html markup: add the ENVIRONMENT section to the song sheet

**FILE:** `index.html`
**ANCHOR (unique existing block — the difficulty section's close + the foot open, L2239–2242):**
```html
        </div>
      </div>

      <div class="sheet-foot">
```
**ACTION:** REPLACE that block with (inserts a new `.sheet-section` for Environment between Difficulty
and the foot):

```html
        </div>
      </div>

      <div class="sheet-section" id="env-section">
        <h3 class="sheet-h">Environment</h3>
        <div class="env-row" id="env-row" role="radiogroup" aria-label="Play environment"></div>
        <div class="env-hint" id="env-hint"></div>
      </div>

      <div class="sheet-foot">
```

> The Environment section is built dynamically by EDIT 4's controller (the `#env-row` chips are injected
> on each `openSheet`), so the markup is just the empty container. The `.sheet-h`/`.sheet-section`
> classes are the **existing** sheet styles (used by the Difficulty section), so it visually matches.

---

### EDIT 3 — index.html: export a reusable ENVIRONMENTS list from the LEVELS IIFE

The LEVELS IIFE owns `AUTHORED[]`, `applyLevelTheme`, `showReactive`, `clearLevelTheme`. We expose a
**song-decoupled** environments list + a tiny `applyEnvironment(envId)` / `clearEnvironment()` pair so
the sheet (or any caller) can stage any environment regardless of which song plays. This is the single
source of truth that keeps environments and campaign levels in sync.

**FILE:** `index.html`
**ANCHOR (unique existing line — inside the LEVELS IIFE public-hooks block, L3638):**
```js
    window.RhythmLibrary.clearLevelTheme = clearLevelTheme;
```
**ACTION:** INSERT-AFTER that line:

```js
    // ---- build6: reusable, SONG-DECOUPLED environment list + apply/clear ----
    // Derived from AUTHORED[] so environments == levels (one source of truth). Each entry exposes the
    // visual identity only (theme/bgVideo/bgArt/reactiveCards) — NOT a fixed song. The sheet plays the
    // PICKED song inside the chosen environment via applyEnvironment(id) + the normal launch path.
    var ENV_ACCENT_HEX = { crimson:'#ff1f2e', ember:'#ff7a4a', gold:'#e0a93f', chrome:'#dad7d2', violet:'#a64dff' };
    function envFromAuthored(L) {
      return {
        id: L.id, name: L.title, tier: L.tier, theme: L.theme || 'crimson',
        accent: ENV_ACCENT_HEX[L.theme] || '#ff1f2e',
        cover: L.cover || '', bgArt: L.bgArt || '', bgVideo: L.bgVideo || '',
        reactiveCards: L.reactiveCards || null, boss: !!L.boss,
        // whether this environment is gated (paid/entitlement); UI may show a lock but Default is always free
        paid: !!(L.unlock && L.unlock.entitlement)
      };
    }
    function environments() {
      // Default (Quick Play, no theme) is always first + always available.
      var list = [{ id:'__default', name:'Default', tier:'', theme:'', accent:'#ff1f2e', cover:'', bgArt:'', bgVideo:'', reactiveCards:null, boss:false, paid:false, isDefault:true }];
      try { for (var i = 0; i < AUTHORED.length; i++) list.push(envFromAuthored(AUTHORED[i])); } catch (e) {}
      return list;
    }
    function envById(id) { var es = environments(); for (var i = 0; i < es.length; i++) if (es[i].id === id) return es[i]; return null; }
    // Stage an environment's visuals (theme + backdrop + reactive overlay) WITHOUT choosing a song.
    // Pass '__default' or falsy to clear back to Quick Play. Idempotent + reduceMotion-safe (reuses the
    // exact campaign presentation path). Sets _activeLevel to a synthetic env-level so the engine's
    // existing clearLevelTheme()/results loop tears it down correctly on exit.
    function applyEnvironment(id) {
      var e = envById(id);
      if (!e || e.isDefault) { clearEnvironment(); return; }
      // build a synthetic "level" object the presentation functions understand (no song binding here;
      // the song comes from the sheet's normal launch). _isEnv marks it non-campaign so star-recording
      // in the results loop won't write campaign progress for a free-play-in-environment run.
      var synthetic = { id: 'env:' + e.id, title: e.name, tier: e.tier || 'medium', theme: e.theme,
        cover: e.cover, bgArt: e.bgArt, bgVideo: e.bgVideo, reactiveCards: e.reactiveCards, boss: false, _isEnv: true };
      _activeLevel = synthetic;
      try { window.RhythmGame.setLevelContext && window.RhythmGame.setLevelContext(synthetic); } catch (e2) {}
      applyLevelTheme(synthetic);
      showReactive(synthetic);
    }
    function clearEnvironment() {
      _activeLevel = null;
      try { window.RhythmGame.setLevelContext && window.RhythmGame.setLevelContext(null); } catch (e) {}
      clearLevelTheme();
    }
    window.RhythmLevels = {
      environments: environments, envById: envById,
      applyEnvironment: applyEnvironment, clearEnvironment: clearEnvironment
    };
```

> **IMPORTANT — `_isEnv` guard for the results loop.** The LEVELS IIFE's `wireResultsLoop()` (L3641)
> calls `recordLevelClear(...)` whenever `#results` becomes active and `_activeLevel` is set. For a
> free-play-in-environment run we do NOT want to write campaign star progress against a synthetic id.
> Add the 1-line guard in **EDIT 3b** below so the synthetic env-level is excluded.

---

### EDIT 3b — index.html: don't record campaign stars for an environment-only run (1-line guard)

**FILE:** `index.html`
**ANCHOR (unique existing line — first line of `recordLevelClear`'s body, L3631):**
```js
      if (!_activeLevel || !results) return;
```
**ACTION:** REPLACE with:

```js
      if (!_activeLevel || !results) return;
      if (_activeLevel._isEnv) return;   // build6: free-play-in-environment runs don't write campaign stars
```

> This keeps campaign progression honest: only real campaign levels (launched via `launchLevel`) record
> stars. Environment runs still record the normal per-song best via `RhythmCatalog.recordLocal` (engine
> path, unchanged).

---

### EDIT 4 — index.html: the ENVIRONMENT-PICKER CONTROLLER (new inline `<script>`)

This is the brain. It (1) rebuilds the chip row each time the sheet opens, (2) tracks the selected
environment, (3) re-tints the sheet preview accent, and (4) **intercepts INITIATE** so the picked song
launches inside the chosen environment. It does this **without editing catalog.js** by wrapping
`RhythmGame.setMenuPlayHandler`: catalog's `openSheet` registers its play handler via that setter; we
proxy the setter so the *actual* registered handler is wrapped to apply the staged environment first.

**FILE:** `index.html`
**ANCHOR (unique existing closing tags at the very end of the file):**
```html
})();
</script>
</body>
</html>
```
**ACTION:** INSERT-BEFORE the `</body>` line the following script block.

```html
<!-- ENVIRONMENT PICKER controller (build6) — choose a LEVEL/ENVIRONMENT for the picked song -->
<script>
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var row = $('env-row'), hint = $('env-hint');
  if (!row) return;

  var selectedEnvId = '__default';   // persists across sheet opens within a session

  // ---- (1) wrap setMenuPlayHandler so EVERY sheet play applies the staged environment first ----
  // catalog.js openSheet() calls RhythmGame.setMenuPlayHandler(realHandler) each open. We proxy the
  // setter: the handler catalog registers gets wrapped to (a) clear/apply the chosen environment, then
  // (b) run catalog's real launch. Default => clear (today's exact behavior, byte-identical).
  try {
    var RG = window.RhythmGame;
    if (RG && typeof RG.setMenuPlayHandler === 'function' && !RG.__envWrapped) {
      var _origSet = RG.setMenuPlayHandler.bind(RG);
      RG.setMenuPlayHandler = function (fn) {
        var wrapped = function () {
          try {
            var L = window.RhythmLevels;
            if (L) {
              if (selectedEnvId && selectedEnvId !== '__default') L.applyEnvironment(selectedEnvId);
              else L.clearEnvironment();   // Default => no theme (current behavior)
            }
          } catch (e) {}
          // run catalog's real launch (play / playUrl / playDemo at the chosen difficulty)
          if (typeof fn === 'function') fn();
        };
        _origSet(wrapped);
      };
      RG.__envWrapped = true;
    }
  } catch (e) {}

  // ---- (2) build the chip row whenever the sheet opens ----
  function chip(e, idx) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'env-chip' + (e.id === selectedEnvId ? ' sel' : '') + (e.locked ? ' locked' : '');
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', e.id === selectedEnvId ? 'true' : 'false');
    b.dataset.env = e.id;
    if (e.accent) b.style.setProperty('--ec', e.accent);
    var artBg = e.cover ? ('background-image:url(\'' + e.cover.replace(/'/g, '') + '\');') : '';
    var ini = (e.name || '?').trim().charAt(0).toUpperCase();
    var tag = e.isDefault ? 'QUICK PLAY' : ((e.boss ? 'BOSS · ' : '') + (e.theme || '').toUpperCase());
    b.innerHTML =
      '<div class="ec-art" style="' + artBg + '">' + (e.cover ? '' : '<span class="ec-ini">' + ini + '</span>') +
        (e.locked ? '<span class="ec-lock">🔒</span>' : '') + '</div>' +
      '<div class="ec-body"><div class="ec-name">' + escAttr(e.name) + '</div><div class="ec-tag">' + escAttr(tag) + '</div></div>';
    b.addEventListener('click', function () {
      if (e.locked) { setHint('Unlock “' + e.name + '” in the Store, or play it in the Campaign.'); return; }
      select(e.id);
    });
    return b;
  }
  function escAttr(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]; }); }
  function setHint(t) { if (hint) hint.textContent = t || ''; }

  function rebuild() {
    var L = window.RhythmLevels;
    var list = (L && L.environments) ? L.environments() : [{ id:'__default', name:'Default', isDefault:true, accent:'#ff1f2e' }];
    // gate paid environments unless owned/dev (mirror the campaign's logic, best-effort; never blocks Default)
    var dev = false; try { dev = localStorage.getItem('rr_dev') === '1'; } catch (e) {}
    list.forEach(function (e) {
      e.locked = false;
      if (e.paid && !dev) {
        var owns = false;
        try {
          var RC = window.RhythmCatalog;
          if (RC && RC.getEntitlements) { /* async; default to locked until owned — Store unlock path */ }
        } catch (x) {}
        e.locked = !owns;
      }
    });
    row.innerHTML = '';
    var frag = document.createDocumentFragment();
    list.forEach(function (e, i) { frag.appendChild(chip(e, i)); });
    row.appendChild(frag);
    // if the previously-selected env is gone/locked, fall back to Default
    var stillOk = list.some(function (e) { return e.id === selectedEnvId && !e.locked; });
    if (!stillOk) selectedEnvId = '__default';
    select(selectedEnvId, true);
  }

  // ---- (3) select an environment: mark chip, re-tint sheet preview accent, set hint ----
  function select(id, silent) {
    selectedEnvId = id;
    var chips = row.querySelectorAll('.env-chip');
    var chosen = null;
    chips.forEach(function (c) {
      var on = c.dataset.env === id;
      c.classList.toggle('sel', on);
      c.setAttribute('aria-checked', on ? 'true' : 'false');
      if (on) chosen = c;
    });
    var L = window.RhythmLevels, e = (L && L.envById) ? L.envById(id) : null;
    // re-tint the sheet's accent so the preview reads themed (CSS var consumed by play-btn glow below)
    var sheet = $('song-sheet');
    if (sheet) sheet.style.setProperty('--sheet-accent', (e && e.accent) || '#ff1f2e');
    if (!silent) {
      if (!e || e.isDefault) setHint('Standard arena — no level theme.');
      else setHint('Play this song in the “' + e.name + '” environment' + (e.reactiveCards ? ' (reactive cards).' : '.'));
    } else if (e && !e.isDefault) {
      setHint('Play this song in the “' + e.name + '” environment' + (e.reactiveCards ? ' (reactive cards).' : '.'));
    } else setHint('Standard arena — no level theme.');
    if (chosen && chosen.scrollIntoView) { try { chosen.scrollIntoView({ inline: 'nearest', block: 'nearest' }); } catch (x) {} }
  }

  // ---- (4) rebuild every time the sheet opens. The sheet is shown by catalog.js adding `.open` to
  // #song-sheet; observe that class so we don't have to edit catalog.js. ----
  var sheet = $('song-sheet');
  if (sheet && window.MutationObserver) {
    var mo = new MutationObserver(function () {
      if (sheet.classList.contains('open')) rebuild();
    });
    mo.observe(sheet, { attributes: true, attributeFilter: ['class'] });
  }
  // initial build (in case the sheet is already open on a deep-link)
  if (sheet && sheet.classList.contains('open')) rebuild(); else rebuild();

  // expose for tests / other packages
  try { window.RhythmEnvPicker = { rebuild: rebuild, select: select, selected: function () { return selectedEnvId; } }; } catch (e) {}
})();
</script>
```

**EDIT 4 add-on — optional sheet-accent glow on INITIATE (pure CSS, append after EDIT 1's block):**
```css
  /* build6: the play button picks up the chosen environment's accent as a subtle edge */
  .song-sheet[style*="--sheet-accent"] .play-btn {
    box-shadow: 0 0 0 1px var(--sheet-accent, var(--crimson)), 0 14px 44px color-mix(in srgb, var(--sheet-accent, #ff1f2e) 36%, transparent);
  }
```

> **Why wrap `setMenuPlayHandler` instead of editing catalog.js?** It keeps this an index.html-only
> package (no `?v` bump, no merge collision with other build packages editing catalog.js). The wrap is
> idempotent (`__envWrapped` guard) and falls through to catalog's exact handler, so Default behavior is
> byte-identical. If the integrator would rather edit catalog.js's `openSheet` to call
> `RhythmLevels.applyEnvironment` directly, that also works — but then bump `?v=84→85`.

---

## 3) EXACT INTEGRATION STEPS — PART B (the MAIN MENU hub, folded in from build4)

> **GATE:** Run `rg -n 'id="menu-hub"' index.html`. If it returns **0 hits** (verified true against the
> live file at time of writing), apply EDITS B1–B5 below. If it returns ≥1 hit, build4 is already
> applied — **skip Part B entirely**; only Part A is new.

Part B is **byte-for-byte the build4 package** (CSS, `#menu-hub` + `#multiplayer-screen` markup, the
`#menu-back` BACK pill, the `RhythmHub` router, and the `enter()` reroute). It is reproduced here so this
package stands alone. Anchors below are re-verified against the **current** live file.

### EDIT B1 — hub CSS
**ANCHOR (unique existing line near end of `<style>`):**
```css
  body:has(.menu-screen.active) .mute-btn { display: none; }
```
**ACTION:** INSERT-AFTER it the full `.menu-hub` / `.mh-*` / `.hub-back` / `.multiplayer-screen` CSS
block from `_build4_menuhub.md` §EDIT 1 (lines 104–185 of that file). *(Reproduced verbatim — copy that
block.)*

### EDIT B2 — hub + multiplayer markup
**ANCHOR (unique existing — the version-stamp `</script>` immediately followed by the MENU SCREEN banner):**
```html
  </script>

  <!-- ============================================================
       MENU SCREEN
       ============================================================ -->
  <div class="screen menu-screen" id="menu">
```
**ACTION:** INSERT-BEFORE the `<!-- ===... MENU SCREEN ... -->` comment the `#menu-hub` +
`#multiplayer-screen` markup from `_build4_menuhub.md` §EDIT 2 (verbatim).

### EDIT B3 — library BACK pill
**ANCHOR (unique existing):**
```html
  <div class="screen menu-screen" id="menu">
    <div class="lib">
```
**ACTION:** REPLACE with the same two lines + the `#menu-back` button, per `_build4_menuhub.md` §EDIT 3.

### EDIT B4 — hub router script
**ACTION:** INSERT-BEFORE `</body>` the `RhythmHub` router `<script>` from `_build4_menuhub.md` §EDIT 4
(verbatim). **Order note:** place it **before** the Part-A environment-picker script is fine; both are
independent IIFEs. (Either order works — they touch disjoint ids.)

### EDIT B5 — reroute `enter()` to the hub
**ANCHOR (unique existing — the `enter()` 600ms timeout body, L4351):**
```js
    setTimeout(function () {
      start.classList.remove('active', 'leaving');
      menu.classList.add('active');
      // the library was hidden behind the start screen (zero size) — relayout the
      // carousel the instant it's visible so there's no black flash.
      var relay = function () { try { window.RhythmLibrary && window.RhythmLibrary.relayout(); } catch (e) {} window.dispatchEvent(new Event('resize')); };
      relay(); requestAnimationFrame(relay);
      setTimeout(relay, 60); setTimeout(relay, 200); setTimeout(relay, 450);
    }, 600);
```
**ACTION:** REPLACE with the build4 §EDIT 5 reroute (route to `window.RhythmHub.show()` with the
old-behavior fallback). Verbatim from `_build4_menuhub.md`.

> Part B adds **no** external-file edits → still no `?v` bump.

---

## 4) NEW HOOKS + WHERE THEY WIRE

| Hook | Defined in | Consumed by | Contract |
|---|---|---|---|
| `window.RhythmLevels.environments()` | index.html LEVELS IIFE (EDIT 3) | env-picker controller (EDIT 4) | returns `[{id,name,tier,theme,accent,cover,bgArt,bgVideo,reactiveCards,boss,paid,isDefault?}]`; Default first. Song-decoupled. |
| `window.RhythmLevels.envById(id)` | EDIT 3 | EDIT 4 (accent/hint) | lookup or null. |
| `window.RhythmLevels.applyEnvironment(id)` | EDIT 3 | EDIT 4 INITIATE wrap | stages theme+backdrop+reactive via existing `applyLevelTheme`/`showReactive`; sets synthetic `_activeLevel._isEnv`. `'__default'`/falsy → clear. |
| `window.RhythmLevels.clearEnvironment()` | EDIT 3 | EDIT 4 (Default path) | reverts to Quick Play via existing `clearLevelTheme`. |
| `window.RhythmEnvPicker.{rebuild,select,selected}` | EDIT 4 | tests / other packages | drive the picker programmatically. |
| `window.RhythmHub.{show,toLibrary,toMultiplayer}` | EDIT B4 (build4) | `enter()`, BACK pills | guided hub nav. |

**Reused existing (unchanged):** `RhythmGame.setMenuPlayHandler` (wrapped, not edited),
`RhythmGame.setLevelContext`/`setDifficulty`/`getDifficulty`, `RhythmCatalog.openSheet`/`launchTrack`,
the LEVELS IIFE `applyLevelTheme`/`showReactive`/`clearLevelTheme`/`AUTHORED[]`,
`RhythmLibrary.showView`/`relayout`, header buttons `#levels-open`/`#store-open`/`#leaderboard-open`/`#profile-open`.

**Wire seam for the difficulty selection:** the chosen difficulty already flows through the **existing**
`#diff-grid` buttons (game.js L1207 sets `difficulty`); the env picker does **not** touch difficulty, so
"Drift/Pulse/Fracture" + "Default/First Light/The World/…" are independent axes — exactly the ask
("pick a level AND a difficulty before INITIATE").

---

## 5) ASSET GENERATION PROMPTS + SELF-HEAL

The picker reads each environment's **existing** `cover` (`assets/levels/*-cover.jpg` / `tarot.jpg` /
`necromancer.jpg`) for the chip thumbnail. Where a cover is missing, the chip **self-heals to a branded
initial** (`.ec-ini`, accent-tinted) — no broken image, code ships first. The Default chip uses a
crimson initial "D" (no art needed).

These covers may already exist (campaign cards use them). If any are absent, generate and save under
`assets/levels/` (16:9-ish, dark, warm, **no text**, very dark so the chip overlay text stays legible):

- **`assets/levels/warmup-cover.jpg`** (First Light, gold): *"Dark warm-black album-cover key art, a
  single warm gold sunrise glow rising through haze over a stylized guitar neck silhouette, ember
  particles, cinematic, no text, square-ish, very dark edges, on-brand crimson/gold."*
- **`assets/levels/steadyhands-cover.jpg`** (Steady Hands, gold): *"Dark warm key art, a steady gold
  metronome-pulse motif over warm-black, faint chrome filaments, calm, no text, very dark, cinematic."*
- **`assets/levels/emberdrift-cover.jpg`** (Ember Drift, ember): *"Drifting ember-orange sparks across
  a warm-black void, soft motion-blur streaks, no text, cinematic, very dark, brand ember #ff7a4a."*
- **`assets/levels/heartbeat-cover.jpg`** (Heartbeat, crimson): *"Pulsing crimson #ff1f2e heart-rate
  waveform across warm-black, glowing, high contrast, no text, cinematic, very dark."*
- **`assets/levels/overdrive-cover.jpg`** (Overdrive, ember): *"Overdriven ember/crimson amp-glow,
  blown-out warm highlights over warm-black, energetic, no text, cinematic, very dark."*
- **`assets/levels/chromeveins-cover.jpg`** (Chrome Veins, chrome): *"Brushed-chrome #dad7d2 veins
  threading through warm-black rock, cold metallic glints over warm shadow, no text, cinematic, dark."*
- **`assets/levels/tarot.jpg`** (The World, violet — Skully showcase): *"Gothic violet #a64dff tarot
  'The World' card aesthetic, ornate skull motif, drifting violet fog, warm-black shadows, eerie,
  no text, cinematic, very dark."* *(Likely already exists.)*
- **`assets/levels/hollowchoir-cover.jpg`** (Hollow Choir, violet): *"Violet cathedral interior
  dissolving into fracture light, cold purple fog over warm-black, eerie, no text, cinematic, dark."*
- **`assets/levels/necromancer.jpg`** (THE BREAKER boss, violet): *"Menacing violet-and-crimson boss
  sigil, pulsing dark core, swirling smoke, high contrast, ominous, no text, cinematic, very dark."*

**Backdrops** referenced by environments (`bgVideo`/`bgArt`) already have self-heal in `applyLevelTheme`
(video 404 → static `bgArt` → moon loop), so a missing backdrop never blocks an environment — the chip
+ theme still apply. Only generate missing ones if you want the full animated backdrop (prompts for
`pulse-bg.jpg`/`fracture-bg.jpg`/`boss-bg.jpg`/loops already enumerated in `_build5_levelidentity.md` §4
— reuse those exact prompts/paths).

**No new asset is *required* to ship Part A** — every chip falls back gracefully.

---

## 6) LOVABLE BACKEND BRIEF (optional — only if paid environments are gated)

Part A ships fully on the existing backend. The only backend touchpoint is **gating paid
environments** (e.g. `THE BREAKER`'s `entitlement {item_type:'level', item_id:'boss_neon'}`). Today the
picker locks paid envs unless `?dev`. To let owners pick a purchased environment, the existing
entitlements endpoint already used by the campaign suffices — **no new endpoint needed**. If you want the
chip to reflect ownership live (instead of lock-until-Store), wire the controller's `e.locked` to a
synchronous ownership check:

> **Brief for Lovable:** *No schema change required.* Ensure `GET /entitlements` (already consumed by
> `RhythmCatalog.getEntitlements`) returns owned `{item_type:'level', item_id}` rows for the signed-in
> user. The game caches them on `RhythmCatalog._entitlements` and the picker reads
> `RhythmCatalog.ownsItem('level', id)` if/when you expose that helper (the LEVELS IIFE already calls
> `ownsItem`/`_entitlements.owns`). Optionally add a `playable_environments` boolean per `store_items`
> row of `item_type='level'` so the Store can surface "play any song here" as a sell. Otherwise nothing
> is required — Part A is backend-neutral.

---

## 7) VERIFY-OFFLINE NOTES (greps / structural / node-check) + RISKS

### Greps (run after applying)
- Env section markup present once: `rg -n 'id="env-row"' index.html` → 1 hit.
- Env CSS appended: `rg -n '\.env-chip' index.html` → multiple (CSS) + JS class strings.
- Reusable list exported: `rg -n 'RhythmLevels' index.html` → def (EDIT 3) + uses in EDIT 4.
- Controller present + wrap guard: `rg -n '__envWrapped|RhythmEnvPicker' index.html` → both appear.
- Campaign-star guard added: `rg -n '_activeLevel\._isEnv' index.html` → 2 hits (EDIT 3 synthetic set +
  EDIT 3b guard).
- Default path unchanged: confirm EDIT 4's wrap calls `fn()` (catalog's real handler) on every branch.
- **No external-file edits:** `git diff --stat` should show **only** `index.html` (+ this .md). If
  catalog.js/game.js/jukebox.* are untouched, **leave `?v=84` as-is** (`rg -n '\?v=84' index.html`
  → still 4 hits at L14/3031/3032/3033). If you chose the optional catalog.js edit, bump all 4 to `?v=85`.
- Hub gate: `rg -n 'id="menu-hub"' index.html` → 1 hit after Part B (0 before).

### Structural
- The sheet markup adds one `.sheet-section` (`<div>…</div>`) before `.sheet-foot` — confirm
  `#song-sheet` still has balanced tags (one extra open+close pair). EDIT 2's REPLACE preserves the
  `</div></div>` that closed the Difficulty section, so balance holds.
- The page can't fully boot headless (CDN `supabase-js` blocks the parser per MEMORY), but the integrator
  runtime-tests in Claude_Preview: open a song sheet, confirm the Environment row renders chips, pick
  "The World", press INITIATE, confirm violet theme + Skully backdrop + DEATH/THE WORLD cards appear on
  the **picked song** (not the campaign's pinned track), then return to menu and confirm a Default run is
  clean (no theme). Check `preview_console_logs` (error level) = clean.
- `node --check` is **not** needed (no .js files edited; all JS is inline in index.html). If you took the
  optional catalog.js route, run `node --check catalog.js`.

### Risks / collisions
- **`setMenuPlayHandler` wrap ordering:** the wrap must exist **before** the first `openSheet` runs.
  catalog.js `openSheet` only runs on a user song-pick (long after DOMContentLoaded), and EDIT 4's script
  is before `</body>` (runs at parse end), so the wrap is installed first. The `__envWrapped` guard makes
  it idempotent if another package also wraps it. **Mitigation if a deep-link auto-opens a sheet at boot:**
  EDIT 4 also calls `rebuild()` immediately, and the wrap is synchronous at script-run — still before any
  user INITIATE.
- **`_activeLevel` shared between env-picker and campaign:** EDIT 3 sets a *synthetic* `_activeLevel`
  with `_isEnv:true`; EDIT 3b excludes it from star-recording; the engine's `clearLevelTheme()` (fired on
  any exit to menu/results) nulls the theme. If a user opens the campaign picker after an env run, `build()`
  recomputes from storage (not `_activeLevel`), so no leak. **Verify:** play a song in "The World", finish,
  open Campaign — frac-01's stars should NOT have incremented from the env run.
- **Locked paid envs:** the picker defaults paid envs (only `THE BREAKER`) to **locked** unless `?dev`
  (Part A's conservative default), with a hint to use the Store/Campaign. This never blocks Default or the
  free environments. Adjust via the §6 entitlement wiring when ready.
- **Reduce-motion / fxLite:** chips have no animation; `applyLevelTheme`/`showReactive` are already
  reduceMotion/fxLite-safe (build5 + their own guards). No new motion introduced.
- **Brand:** the only non-crimson/ember/gold/chrome accent is violet `#a64dff`, applied **only** as an
  environment accent (allowed per CLAUDE.md for the gothic level). Core UI chrome stays warm. No blue.
- **Gameplay byte-identical:** no scoring/timing/lane code touched; Default run path is the unchanged
  catalog handler. GH 5-string and standard 6-string are unaffected (no `LANE_COLORS`/geometry edits).
- **Collision with build4/build5:** Part B is build4 (apply only if not already present). build5 edits
  game.js + a different CSS region (`#game.rr-lvl-themed`); this package's CSS is in the sheet region
  (after L324) and the inline scripts are new IIFEs — disjoint anchors, no overlap. If build5's
  `setLevelAccent` exists, environment runs benefit from it automatically (applyLevelTheme already calls
  it). No coordination needed beyond "apply build5's game.js edits independently."

---

### 4-LINE SUMMARY
1. Adds an ENVIRONMENT picker row to the song sheet (between Difficulty and INITIATE): scroll-snap chips for **Default + every authored environment** (First Light/gold … The World/violet+Skully cards … THE BREAKER/boss), so the player picks which level's theme+backdrop+reactive-overlay to play the **picked song** in — reusing the exact `applyLevelTheme`/`showReactive` campaign path via a new song-decoupled `window.RhythmLevels.environments()/applyEnvironment()` exported from the LEVELS IIFE.
2. INITIATE is intercepted by **wrapping `RhythmGame.setMenuPlayHandler`** (so catalog.js is NOT edited and **no `?v` bump** is needed); Default = today's behavior byte-identical, and a `_isEnv` guard keeps free-play-in-environment runs from writing campaign stars — gameplay/scoring/timing untouched.
3. Folds in the guided MAIN MENU hub from `_build4_menuhub.md` (Part B, apply only if `id="menu-hub"` is absent — currently verified absent): Start → centered hub (Campaign/Quick Play/Multiplayer/Store/Leaderboards/Profile) with BACK-nav reusing existing screens.
4. index.html-only, brand-safe (violet only as a level accent, no blue), reduceMotion-safe, assets self-heal to branded initials when covers are missing (generation prompts + `assets/levels/` paths included); verify offline via the listed greps + Claude_Preview runtime test (pick The World on any song → violet/Skully/DEATH+WORLD cards; Default run stays clean).
