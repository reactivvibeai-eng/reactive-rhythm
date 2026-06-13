# _build4_menuhub.md — Guided Console MAIN MENU Hub (ready-to-integrate)

Concern: add a centered, guided **Main Menu hub** between the splash and the library so the flow is
`#start (TAP TO BEGIN) → #menu-hub → chosen path → guided sub-step → PLAY`, with a **BACK** button on
every destination that returns to the hub. Reuse existing screens as destinations — do not rebuild
the picker/store/leaderboard/profile.

This package is **HTML + CSS + inline `<script>` only**. It touches **index.html exclusively**. It does
**NOT** edit game.js / jukebox.js / catalog.js, so **no `?v=NN` bump is required** (the bump rule is only
for external-file changes). All anchors below are verified against the live file.

---

## 1) SUMMARY + WHAT STAYS BYTE-IDENTICAL

**What changes (4 surgical edits, all in index.html):**
1. **One CSS block** appended inside the existing `<style>` (the `.menu-hub` styles). Additive — no
   existing rule edited.
2. **One markup block** inserted **after the `#start` screen's closing `</div>` + its version-stamp
   `<script>` block, before the MENU SCREEN comment** — the new `#menu-hub` screen.
3. **One inline `<script>`** inserted just before `</body>` — the hub router (`window.RhythmHub`) +
   BACK buttons wired onto every overlay via the existing close handlers.
4. **One 6-line change** to the existing `enter()` function in the start-intro script: route
   `TAP TO BEGIN` to the hub instead of straight to `#menu`.

**What stays byte-identical (do NOT touch):**
- `game.js`'s `showScreen()` (it only governs menu/loading/game/countdown/results — untouched; the hub
  and overlays are NOT in its `screens` map and never were).
- Every existing overlay IIFE's `open()`/`close()` (`#levels-screen`, `#store-screen`,
  `#leaderboard-screen`, `#profile-screen`, `#howto-screen`, settings) — we **reuse** their existing
  `*-open` / `*-close` buttons via `.click()`; we do not rewrite them.
- jukebox.js entirely (we call its existing `window.RhythmLibrary.showView('jukebox')` + `relayout()`).
- The header icon row in `#menu` (`refresh / mute / search / how-to / calibrate / profile / levels /
  leaderboard / store / Sparks / Sign in`) — **stays fully wired and working** as a secondary path.
- `#start` cinematic intro, ember/supernova canvas, `RhythmIntro`, the `dismissed` guard.
- The `.screen` base rule, the overlay `z-index:261`, `cardIn` keyframe, brand `:root` vars.

**Risk profile:** very low. The only behavioral change is the *destination* of the first tap
(`#menu` → `#menu-hub`). Every old entry point still works, so even if the hub is hidden the game is
reachable (QUICK PLAY just re-shows `#menu`, which is what the old flow did).

---

## 2) INFORMATION ARCHITECTURE / FLOW

### Screens (existing unless marked NEW)
- `#start` — splash, `TAP TO BEGIN` (existing).
- **`#menu-hub` — NEW.** Centered console. 6 big tiles + a small "Skip to library" affordance.
- `#menu` — the library/coverflow (existing; `class="menu-screen"`, id `menu`). This IS "QUICK PLAY".
- `#levels-screen` — campaign picker (existing). = CAMPAIGN.
- `#store-screen` (existing) = STORE. `#leaderboard-screen` (existing) = LEADERBOARDS.
- `#profile-screen` (existing) = PROFILE.
- **`#multiplayer-screen` — NEW placeholder** (the other package fills it). Has its own BACK.

### Why overlays "just work" with a hub
The overlay screens (`#levels-screen`/`#store-screen`/`#leaderboard-screen`/`#profile-screen`) are
**z-261 modals that add `.active` on top of whatever is beneath** — their `open()` is
`screen.classList.add('active')` and they never deactivate the layer below. Today that layer is `#menu`.
With the hub, we open them **on top of `#menu-hub`**, so their existing DONE buttons (`*-close`) drop
the player right back onto the hub automatically. No re-plumbing of their close logic needed.

### Transitions
| From | Action | To | Mechanism |
|---|---|---|---|
| `#start` | TAP / Enter / Space | `#menu-hub` | edited `enter()` → `RhythmHub.show()` |
| `#menu-hub` | **CAMPAIGN** | `#levels-screen` (overlay over hub) | `$('levels-open').click()` |
| `#menu-hub` | **QUICK PLAY** | `#menu` (library) | `RhythmHub.toLibrary()` |
| `#menu-hub` | **MULTIPLAYER** | `#multiplayer-screen` | `RhythmHub.toMultiplayer()` |
| `#menu-hub` | **STORE** | `#store-screen` (overlay) | `$('store-open').click()` |
| `#menu-hub` | **LEADERBOARDS** | `#leaderboard-screen` (overlay) | `$('leaderboard-open').click()` |
| `#menu-hub` | **PROFILE** | `#profile-screen` (overlay) | `$('profile-open').click()` |
| any overlay | DONE/Esc | `#menu-hub` (revealed underneath) | existing `*-close` (no change) |
| `#menu` (library) | **BACK** | `#menu-hub` | NEW back button → `RhythmHub.show()` |
| `#multiplayer-screen` | **BACK** | `#menu-hub` | NEW back button → `RhythmHub.show()` |

**Back-nav rule:** CAMPAIGN/STORE/LEADERBOARDS/PROFILE are modal overlays — their DONE button already
returns to whatever is under them, which is now the hub. QUICK PLAY (`#menu`) and MULTIPLAYER are
full screens, so they each get an explicit BACK button → hub.

### Centering
The hub uses the existing `.screen { display:flex; align-items:center; justify-content:center }` base,
so the console card is dead-center at any size — directly fixing the "sits too far on the side / felt
stuck" complaint.

---

## 3) EXACT INTEGRATION STEPS

> Apply by finding each ANCHOR (a unique existing string) and inserting/replacing as directed. Anchors
> are copied verbatim from the live file.

---

### EDIT 1 — CSS (append the hub styles)

**FILE:** `index.html`
**ANCHOR (unique existing line, the menu's floating-mute rule near end of `<style>`):**
```
  body:has(.menu-screen.active) .mute-btn { display: none; }
```
**ACTION:** INSERT-AFTER that line the following block.

```css
  /* ============ MAIN MENU HUB (guided console) ============ */
  .menu-hub { z-index: 240; padding: 24px; overflow-y: auto;
    background:
      radial-gradient(ellipse at 50% 22%, rgba(163,6,15,0.30), transparent 60%),
      radial-gradient(ellipse at 50% 100%, rgba(255,31,46,0.10), transparent 55%),
      linear-gradient(180deg, #0a0706 0%, #160c0b 100%); }
  .mh-card { width: min(920px, 94vw); display: flex; flex-direction: column; align-items: center;
    gap: 6px; padding: 8px; text-align: center; }
  .menu-hub.active .mh-card { animation: cardIn 0.46s cubic-bezier(.2,1,.3,1) both; }
  .mh-brand { display: flex; align-items: center; gap: 12px; margin-bottom: 2px; }
  .mh-brand img { width: 26px; height: 26px; filter: drop-shadow(0 0 10px rgba(255,31,46,0.55)); }
  .mh-brand span { font-family: 'JetBrains Mono', monospace; font-size: 12px; letter-spacing: 0.32em;
    color: var(--ink-dim); }
  .mh-pre { font-family: 'JetBrains Mono', monospace; font-size: 12px; letter-spacing: 0.4em;
    color: var(--crimson); }
  .mh-pre::before { content: '// '; color: var(--ink-dim); }
  .mh-title { font-family: 'Oxanium', sans-serif; font-weight: 800; font-size: clamp(40px, 7vw, 68px);
    letter-spacing: 0.03em; line-height: 0.96; color: var(--ink);
    text-shadow: 0 0 34px rgba(255,42,48,0.5); margin: 4px 0 2px; }
  .mh-sub { font-family: 'Chakra Petch', monospace; font-size: 12px; color: var(--ink-dim);
    letter-spacing: 0.04em; line-height: 1.5; margin: 0 0 18px; max-width: 540px; }
  .mh-grid { width: 100%; display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
  .mh-tile { position: relative; display: flex; flex-direction: column; align-items: center;
    justify-content: center; gap: 10px; min-height: 150px; padding: 22px 16px;
    border: 1px solid var(--line); border-radius: 16px; cursor: pointer;
    background: linear-gradient(180deg, rgba(28,12,14,0.6), rgba(12,6,8,0.85));
    color: var(--ink); font-family: 'Oxanium', sans-serif;
    transition: transform .14s ease, border-color .14s ease, box-shadow .14s ease, background .14s ease; }
  .mh-tile:hover, .mh-tile:focus-visible { transform: translateY(-4px); border-color: var(--crimson);
    box-shadow: 0 14px 38px rgba(0,0,0,0.5), 0 0 26px rgba(255,31,46,0.3);
    background: linear-gradient(180deg, rgba(40,14,18,0.7), rgba(16,7,9,0.9)); outline: none; }
  .mh-tile:focus-visible { outline: 2px solid var(--crimson); outline-offset: 2px; }
  .mh-tile.primary { border-color: rgba(255,42,48,0.55);
    box-shadow: 0 0 0 1px rgba(255,42,48,0.14) inset, 0 8px 26px rgba(255,31,46,0.18); }
  .mh-tile .mh-ico { width: 38px; height: 38px; color: var(--crimson);
    filter: drop-shadow(0 0 8px rgba(255,31,46,0.45)); }
  .mh-tile .mh-ico svg { width: 100%; height: 100%; }
  .mh-tile .mh-t { font-weight: 800; font-size: 18px; letter-spacing: 0.1em; text-transform: uppercase; }
  .mh-tile .mh-d { font-family: 'Chakra Petch', monospace; font-weight: 600; font-size: 10.5px;
    letter-spacing: 0.06em; color: var(--ink-dim); text-transform: uppercase; }
  /* corner brackets on the primary tile to read "console" */
  .mh-tile.primary::before, .mh-tile.primary::after { content: ''; position: absolute; width: 16px;
    height: 16px; border: 1px solid var(--crimson); opacity: 0.7; }
  .mh-tile.primary::before { top: -1px; left: -1px; border-right: none; border-bottom: none; }
  .mh-tile.primary::after { bottom: -1px; right: -1px; border-left: none; border-top: none; }
  .mh-soon { position: absolute; top: 10px; right: 10px; font-family: 'Chakra Petch', monospace;
    font-size: 9px; font-weight: 700; letter-spacing: 0.16em; color: var(--gold);
    border: 1px solid rgba(224,169,63,0.45); border-radius: 999px; padding: 3px 8px; }
  .mh-skip { margin-top: 18px; background: none; border: none; cursor: pointer;
    font-family: 'JetBrains Mono', monospace; font-size: 11px; letter-spacing: 0.2em;
    text-transform: uppercase; color: var(--ink-dim); transition: color .15s ease; }
  .mh-skip:hover, .mh-skip:focus-visible { color: var(--chrome); outline: none; }
  /* universal BACK pill used by full-screen destinations (library + multiplayer) */
  .hub-back { position: absolute; top: max(calc(env(safe-area-inset-top, 0px) + 12px), 16px); left: 16px;
    z-index: 70; display: inline-flex; align-items: center; gap: 7px; padding: 9px 15px 9px 11px;
    border: 1px solid var(--line); border-radius: 999px; cursor: pointer;
    background: rgba(12,6,8,0.78); color: var(--ink); font-family: 'JetBrains Mono', monospace;
    font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; backdrop-filter: blur(8px);
    transition: border-color .15s ease, box-shadow .15s ease, color .15s ease; }
  .hub-back:hover, .hub-back:focus-visible { border-color: var(--crimson); color: var(--chrome);
    box-shadow: 0 0 16px rgba(255,31,46,0.32); outline: none; }
  .hub-back svg { width: 15px; height: 15px; }
  /* the library back rides INSIDE #menu (positioned vs the .lib bar) */
  #menu-back { position: absolute; }
  /* MULTIPLAYER placeholder screen */
  .multiplayer-screen { z-index: 240; overflow-y: auto;
    background: radial-gradient(ellipse at 50% 26%, rgba(120,12,20,0.55), transparent 64%), #0a0706;
    backdrop-filter: blur(14px); }
  .mp-card { width: min(620px, 94vw); display: flex; flex-direction: column; align-items: center;
    gap: 12px; padding: 16px; text-align: center; }
  .multiplayer-screen.active .mp-card { animation: cardIn 0.42s cubic-bezier(.2,1,.3,1) both; }
  .mp-title { font-family: 'Oxanium', sans-serif; font-weight: 800; font-size: 46px; letter-spacing: 0.03em;
    color: var(--ink); text-shadow: 0 0 30px rgba(255,42,48,0.55); margin: 4px 0 0; line-height: 1; }
  .mp-sub { font-family: 'Chakra Petch', monospace; font-size: 13px; color: var(--ink-dim);
    line-height: 1.6; max-width: 460px; }
  @media (max-width: 760px) {
    .mh-grid { grid-template-columns: repeat(2, 1fr); }
    .mh-tile { min-height: 124px; padding: 18px 12px; }
    .mh-title { font-size: clamp(34px, 10vw, 48px); }
  }
  @media (max-width: 420px) { .mh-grid { grid-template-columns: 1fr; } }
```

---

### EDIT 2 — MARKUP (insert the `#menu-hub` + `#multiplayer-screen` screens)

**FILE:** `index.html`
**ANCHOR (unique existing block — the version-stamp script's IIFE close + the MENU SCREEN comment that
follows the `#start` screen):**
```
  </script>

  <!-- ============================================================
       MENU SCREEN
       ============================================================ -->
  <div class="screen menu-screen" id="menu">
```
**ACTION:** INSERT-BEFORE the `<!-- ===... MENU SCREEN ... -->` comment (i.e. between the `</script>`
that closes the version-stamp IIFE and the `MENU SCREEN` comment) the following two screen blocks.

> NOTE: this anchor's `</script>` is specifically the one at index.html ~line 2030 (closes the version
> stamper `(function () { ... })();`). The unique multi-line shape (the `</script>` immediately followed
> by the `MENU SCREEN` banner comment and `<div class="screen menu-screen" id="menu">`) disambiguates it.

```html
  <!-- ============================================================
       MAIN MENU HUB — guided console (START → here → a path → PLAY)
       ============================================================ -->
  <div class="screen menu-hub" id="menu-hub" data-screen-label="main-menu">
    <div class="mh-card">
      <div class="mh-brand"><img src="assets/atom.png" alt="" /><span>REACTIVVIBE.AI</span></div>
      <div class="mh-pre">MAIN MENU</div>
      <h1 class="mh-title">REACTIVE RHYTHM</h1>
      <p class="mh-sub">Choose your path. Every mode runs the same neck — pick how you want to play.</p>
      <div class="mh-grid" id="mh-grid">

        <button class="mh-tile primary" id="mh-campaign" type="button">
          <span class="mh-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 3 8l9 5 9-5-9-5z"></path><path d="M3 13l9 5 9-5"></path></svg></span>
          <span class="mh-t">Campaign</span>
          <span class="mh-d">Climb the tiers</span>
        </button>

        <button class="mh-tile" id="mh-quickplay" type="button">
          <span class="mh-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 4 20 12 6 20 6 4" fill="currentColor" stroke="none"></polygon></svg></span>
          <span class="mh-t">Quick Play</span>
          <span class="mh-d">Pick any track</span>
        </button>

        <button class="mh-tile" id="mh-multiplayer" type="button">
          <span class="mh-soon">SOON</span>
          <span class="mh-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.2"></circle><path d="M3.5 20a5.5 5.5 0 0 1 11 0"></path><circle cx="17.5" cy="9" r="2.6"></circle><path d="M15.2 20a5 5 0 0 1 6.3-4.5"></path></svg></span>
          <span class="mh-t">Multiplayer</span>
          <span class="mh-d">Head to head</span>
        </button>

        <button class="mh-tile" id="mh-store" type="button">
          <span class="mh-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v1a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0V6l-3-4z"></path><path d="M4 9.5V20a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9.5"></path><path d="M9 21v-5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v5"></path></svg></span>
          <span class="mh-t">Store</span>
          <span class="mh-d">Spend Sparks</span>
        </button>

        <button class="mh-tile" id="mh-leaderboard" type="button">
          <span class="mh-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8"></path><path d="M12 17v4"></path><path d="M7 4h10v4a5 5 0 0 1-10 0V4z"></path><path d="M5 5H3v2a3 3 0 0 0 3 3"></path><path d="M19 5h2v2a3 3 0 0 1-3 3"></path></svg></span>
          <span class="mh-t">Leaderboards</span>
          <span class="mh-d">Top runs</span>
        </button>

        <button class="mh-tile" id="mh-profile" type="button">
          <span class="mh-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"></circle><path d="M5.5 21a6.5 6.5 0 0 1 13 0"></path></svg></span>
          <span class="mh-t">Profile</span>
          <span class="mh-d">Your career</span>
        </button>

      </div>
      <button class="mh-skip" id="mh-skip" type="button">Skip to library →</button>
    </div>
  </div>

  <!-- ============================================================
       MULTIPLAYER — placeholder entry screen (the multiplayer package fills this)
       ============================================================ -->
  <div class="screen multiplayer-screen" id="multiplayer-screen" data-screen-label="multiplayer">
    <button class="hub-back" id="mp-back" type="button" aria-label="Back to main menu">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"></path></svg>
      Back
    </button>
    <div class="mp-card">
      <div class="mh-pre">VERSUS</div>
      <h2 class="mp-title">MULTIPLAYER</h2>
      <p class="mp-sub">Head-to-head battles are coming online. Hang tight — this room is being wired up.</p>
    </div>
  </div>
```

---

### EDIT 3 — MARKUP (add a BACK button inside the library `#menu`)

The library is a full screen (`#menu`), not a modal overlay, so it needs an explicit BACK to the hub.
Drop a back pill at the very top of the `.lib` container (it's `position:absolute`, so it floats over
the bar without disturbing the existing grid/flex layout).

**FILE:** `index.html`
**ANCHOR (unique existing line — the library wrapper that opens `#menu`):**
```
  <div class="screen menu-screen" id="menu">
    <div class="lib">
```
**ACTION:** REPLACE that 2-line anchor with:

```html
  <div class="screen menu-screen" id="menu">
    <div class="lib">
      <button class="hub-back" id="menu-back" type="button" aria-label="Back to main menu">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"></path></svg>
        Menu
      </button>
```

> The `.lib` element is the positioning context (it fills the screen). `#menu-back` overrides `.hub-back`'s
> default with `position:absolute` (set in EDIT 1) so it anchors to `.lib`'s top-left, clear of the
> header brand/search.

---

### EDIT 4 — SCRIPT (the hub router + BACK wiring) — insert before `</body>`

**FILE:** `index.html`
**ANCHOR (unique existing closing tags at the very end of the file):**
```
})();
</script>
</body>
</html>
```
**ACTION:** INSERT-BEFORE the `</body>` line (i.e. after the final `</script>`, before `</body>`) the
following script block.

```html
<!-- MAIN MENU HUB router — fronts the existing screens with a guided centered console + back-nav -->
<script>
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var hub = $('menu-hub'), menu = $('menu'), mp = $('multiplayer-screen');
  if (!hub) return;

  // Show the hub. Deactivate the full-screen layers (start/menu/multiplayer); modal overlays
  // (levels/store/leaderboard/profile) close themselves via their own DONE buttons.
  function showHub() {
    try { ['start', 'menu', 'multiplayer-screen'].forEach(function (id) { var el = $(id); if (el) el.classList.remove('active'); }); } catch (e) {}
    hub.classList.add('active');
    try { hub.querySelector('.mh-card').focus && hub.querySelector('.mh-card').focus(); } catch (e) {}
  }

  // QUICK PLAY → the existing library/coverflow (#menu). Mirrors the old start->menu reveal so the
  // carousel relayouts cleanly (it has zero size while hidden behind the hub).
  function toLibrary() {
    hub.classList.remove('active');
    menu.classList.add('active');
    var relay = function () {
      try { window.RhythmLibrary && window.RhythmLibrary.showView && window.RhythmLibrary.showView('jukebox'); } catch (e) {}
      try { window.RhythmLibrary && window.RhythmLibrary.relayout && window.RhythmLibrary.relayout(); } catch (e) {}
      window.dispatchEvent(new Event('resize'));
    };
    relay(); requestAnimationFrame(relay);
    setTimeout(relay, 60); setTimeout(relay, 200);
  }

  function toMultiplayer() { if (!mp) return; hub.classList.remove('active'); mp.classList.add('active'); }

  // CAMPAIGN / STORE / LEADERBOARDS / PROFILE: reuse the existing header buttons' click handlers so we
  // inherit all their build/load/gating logic. They open AS MODAL OVERLAYS on top of the hub; their
  // own DONE/Esc returns to the hub automatically (the hub stays .active underneath).
  function via(openId) { return function () { var b = $(openId); if (b) b.click(); }; }

  // ---- tile wiring ----
  var W = [
    ['mh-campaign',    via('levels-open')],
    ['mh-quickplay',   toLibrary],
    ['mh-multiplayer', toMultiplayer],
    ['mh-store',       via('store-open')],
    ['mh-leaderboard', via('leaderboard-open')],
    ['mh-profile',     via('profile-open')],
    ['mh-skip',        toLibrary]
  ];
  W.forEach(function (p) { var el = $(p[0]); if (el) el.addEventListener('click', p[1]); });

  // ---- BACK buttons on the two full-screen destinations ----
  var mb = $('menu-back'); if (mb) mb.addEventListener('click', showHub);
  var pb = $('mp-back');   if (pb) pb.addEventListener('click', showHub);

  // Esc on the library or multiplayer (with no overlay open) returns to the hub.
  window.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var overlayOpen = ['levels-screen', 'store-screen', 'leaderboard-screen', 'profile-screen', 'howto-screen', 'settings-screen']
      .some(function (id) { var el = $(id); return el && el.classList.contains('active'); });
    if (overlayOpen) return;  // let the overlay's own Esc handler win
    if (menu.classList.contains('active') || (mp && mp.classList.contains('active'))) { showHub(); }
  });

  // public hook so other packages / results screen can route home
  try {
    window.RhythmHub = {
      show: showHub, toLibrary: toLibrary, toMultiplayer: toMultiplayer
    };
  } catch (e) {}
})();
</script>
```

---

### EDIT 5 — ROUTE "TAP TO BEGIN" TO THE HUB (6-line change inside the existing start-intro script)

The splash's `enter()` currently reveals `#menu` directly. Reroute it to the hub. We keep the exact
`leaving` animation + intro-stop, just change the reveal target.

**FILE:** `index.html`
**ANCHOR (unique existing block — the body of `enter()` after the 600ms timeout):**
```
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
**ACTION:** REPLACE that block with:

```javascript
    setTimeout(function () {
      start.classList.remove('active', 'leaving');
      // Route the first tap to the guided MAIN MENU hub (not straight into the library).
      // RhythmHub.show() is defined by the hub router script later in the document.
      if (window.RhythmHub && window.RhythmHub.show) {
        window.RhythmHub.show();
      } else {
        // fallback (hub not present): old behavior — go straight to the library
        menu.classList.add('active');
        var relay = function () { try { window.RhythmLibrary && window.RhythmLibrary.relayout(); } catch (e) {} window.dispatchEvent(new Event('resize')); };
        relay(); requestAnimationFrame(relay);
        setTimeout(relay, 60); setTimeout(relay, 200); setTimeout(relay, 450);
      }
    }, 600);
```

> `RhythmHub` is defined in EDIT 4's script which is placed *before* `</body>` (i.e. after the start-intro
> script). That's fine: `enter()` only runs on user tap, long after DOMContentLoaded, so `window.RhythmHub`
> is already defined. The fallback covers the impossible-but-safe case.

---

## 4) NEW PUBLIC HOOKS + WHERE THEY WIRE

- **`window.RhythmHub.show()`** — reveal the Main Menu hub (deactivates start/menu/multiplayer). Wired
  into the start `enter()` (EDIT 5), the library BACK (`#menu-back`), and the multiplayer BACK
  (`#mp-back`). Other packages (e.g. results "BACK TO MENU") can call this to land on the hub instead of
  the library.
- **`window.RhythmHub.toLibrary()`** — open the coverflow library + relayout (QUICK PLAY path). Reusable
  by any "browse songs" affordance.
- **`window.RhythmHub.toMultiplayer()`** — open the `#multiplayer-screen` placeholder. The multiplayer
  package replaces the placeholder card markup and can keep this exact entry point.

**Integration seam for the multiplayer package:** it owns the inside of `#multiplayer-screen` (replace
`.mp-card`). It should keep the `#mp-back` button (or re-wire its own back to `RhythmHub.show()`). The
hub already routes to it via `RhythmHub.toMultiplayer()` and the `#mh-multiplayer` tile (drop the `SOON`
badge by deleting the `<span class="mh-soon">SOON</span>` line when MP ships).

**Existing hooks reused (unchanged):** `RhythmLibrary.showView`, `RhythmLibrary.relayout` (jukebox.js);
header buttons `#levels-open`, `#store-open`, `#leaderboard-open`, `#profile-open` (their IIFE
`open()`/`close()` untouched).

---

## 5) ASSETS

**None required.** All six tile icons are inline SVGs reused/adapted from the existing header icon row
(levels=layers, store=bag, leaderboard=trophy, profile=person) plus a play-triangle (QUICK PLAY) and a
two-people glyph (MULTIPLAYER) drawn inline. Brand atom reuses `assets/atom.png` (already shipped).

*(Optional future polish — not needed to ship: a 6-up tinted icon sheet. If desired, generate with:
"Set of 6 minimalist line icons on transparent background, 2px crimson #ff1f2e stroke, rounded caps,
48x48 each: layered-diamond (campaign), play-triangle, two-people (versus), shopping-bag, trophy,
person-bust. Flat, no fill, no shadow, dark-UI game console style." But inline SVG ships today.)*

---

## 6) VERIFY OFFLINE (greps + structural checks) + RISKS

### Greps (run after applying)
- Hub screen present exactly once:
  `rg -n 'id="menu-hub"' index.html`  → 1 hit (markup).
- Router + all 6 tile ids wired:
  `rg -n 'mh-campaign|mh-quickplay|mh-multiplayer|mh-store|mh-leaderboard|mh-profile|mh-skip' index.html`
  → each id appears twice (markup button + router `W[]` entry) except `mh-soon` (badge only).
- Back buttons exist:
  `rg -n 'id="menu-back"|id="mp-back"' index.html` → 1 hit each.
- Public hook defined + start routes through it:
  `rg -n 'RhythmHub' index.html` → defined in EDIT 4, called in EDIT 5 (`window.RhythmHub.show`).
- Reuse (not rebuild) of overlays — these `*-open`/`*-close` must still exist & be untouched:
  `rg -n "\$\('levels-open'\)|\$\('store-open'\)|\$\('leaderboard-open'\)|\$\('profile-open'\)" index.html`
  → original handler hits (lines ~3556/3963/3782/3095) PLUS the new `via(...)` references.
- `showScreen` (game.js) NOT referenced by this package:
  `rg -n 'showScreen' index.html` → 0 hits (confirms we didn't touch the engine's screen map).

### Structural checks
- Balanced tags: the markup block adds 2 `<div class="screen ...">` … `</div>` pairs and the script adds
  one `<script>…</script>`. Open `index.html` and confirm the `MENU SCREEN` comment still immediately
  precedes `<div class="screen menu-screen" id="menu">` after EDIT 2.
- CSS: the appended block is inside the single `<style>` (anchor is well within it). Confirm no stray
  `}` — the block is brace-balanced as written.
- No `?v=NN` bump needed (no external JS/CSS changed). Leave `game.js?v=80 / jukebox.js?v=80 /
  catalog.js?v=80 / jukebox.css?v=80` as-is.
- Page can't boot headless (CDN scripts block the parser) — verify by reading the applied diff +
  these greps. No `node --check` needed (no .js files edited).

### RISKS / COLLISIONS
- **Floating gameplay mute reappearing on the hub:** the existing rule hides `.mute-btn` only via
  `body:has(.menu-screen.active)`. The hub is `.menu-hub`, not `.menu-screen`, so the floating mute
  would *not* be auto-hidden over the hub. The hub has no mute need, and the mute is small/top-right —
  acceptable. If undesired, optionally extend EDIT 1's CSS anchor rule to
  `body:has(.menu-screen.active) .mute-btn, body:has(.menu-hub.active) .mute-btn { display: none; }`
  (purely cosmetic; left out by default to keep EDIT 1 strictly additive).
- **Esc key ordering:** existing overlay IIFEs add `keydown` Esc handlers in **capture** phase
  (`true`) with `stopImmediatePropagation()`. The hub's Esc handler is **bubble** phase and explicitly
  bails if any overlay is `.active`, so overlay-Esc always wins — no double-handling.
- **CAMPAIGN gating unchanged:** `#levels-open` still respects `CAMPAIGN_PUBLIC`/`?dev`. The tile just
  fronts that button, so testers see the same gated behavior (toast on locked) — intended.
- **Coverflow black-flash:** QUICK PLAY replicates the start→menu relayout cadence
  (rAF + 60/200ms) used by the original `enter()`, so the carousel sizes correctly. Verified the source
  pattern matches jukebox.js `relayout()` expectations.
- **Header icons still work:** untouched. They remain a valid secondary path while the hub is primary.
  No collision — they live inside `#menu`, reachable only after QUICK PLAY.
- **Two screens at z-240 (hub + multiplayer):** only one is `.active` at a time (router enforces), and
  modal overlays sit higher at z-261, so stacking is correct.

---

### 4-LINE SUMMARY
1. Adds a centered, guided `#menu-hub` console (6 brand tiles: Campaign/Quick Play/Multiplayer/Store/Leaderboards/Profile) plus a `#multiplayer-screen` placeholder, via 4 additive index.html edits + 1 six-line reroute of the splash's `enter()`; no game.js/jukebox.js/catalog.js changes, so no `?v` bump.
2. Reuses every existing destination as-is — Campaign/Store/Leaderboards/Profile open via their real header buttons' `.click()` (modal overlays whose own DONE returns to the hub), Quick Play opens the real library through `RhythmLibrary.showView('jukebox')`+`relayout()`, and back-nav is BACK pills (`#menu-back`,`#mp-back`) + Esc → `RhythmHub.show()`.
3. New public hooks `window.RhythmHub.{show,toLibrary,toMultiplayer}` (wired into `enter()` and both BACK buttons; the multiplayer package keeps `toMultiplayer` as its seam), with all anchors verified against the live file at ROOT.
4. Risk is minimal (only the first tap's destination changes; all old entry points still work; offline-verifiable via the listed greps), with the one cosmetic note that the floating gameplay mute isn't auto-hidden over `.menu-hub` (optional one-line CSS fix included).
