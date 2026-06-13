# BUILD 7 — Multiplayer HOOKS PATCH (apply against the LIVE v84 files)

Final, ready-to-apply integration for **online OPEN-LOBBY multiplayer**. The engine is the new file
`multiplayer.js` (already written at ROOT, `node --check` clean). This doc is the **exact** set of
find-anchor edits to wire it in.

> Every anchor below was copied verbatim from the CURRENT files on disk (branch `visual-overhaul`, v84).
> Apply top-to-bottom. After all edits: `node --check game.js`, reload the preview, two tabs to
> `index.html` → MULTIPLAYER tile.

## REALITY CHECK — what is ALREADY integrated (do NOT recreate; this changes the plan vs `_build6`)

`_build6_multiplayer.md` assumed a fresh `#multiplayer` overlay + a header icon. The repo has since
integrated a **different** scaffold, so this patch targets the REAL DOM:

- The MP screen **already exists** as `#multiplayer-screen` (a full hub child, `z-index:240`), with a
  placeholder `.mp-card` (index.html **2236-2240**) and a `#mp-back` button.
- It is reached via the **main-menu hub tile** `mh-multiplayer` → `RhythmHub.toMultiplayer()` (index.html
  **4728/4733**), which adds `.active` to `#multiplayer-screen`. **There is NO header icon and we add none.**
- `multiplayer.js` therefore **detects `.active`** on `#multiplayer-screen` (MutationObserver) and joins the
  lobby; `RhythmMP.open()` delegates to `RhythmHub.toMultiplayer()`.
- The existing `.mp-card` / `.mp-title` / `.mp-sub` CSS (index.html **2016-2022**) **stays**. All NEW
  multiplayer markup/CSS is namespaced **`.mpx-*`** (and the in-game panel `#mp-opp`) → **zero collision**.
- `#mp-back` and the hub Esc handler already route to `RhythmHub.show()`; during a LIVE match the active
  screen is `#game` (the engine), so neither can fire mid-song. `multiplayer.js` adds a `#mp-back` listener
  only to tear the channels down cleanly when you back out from a non-playing step.

Net: **`multiplayer.js` + 4 game.js MUST-FIXES + 1 HTML body-fill + 1 CSS block + script tag + ?v bumps**.
(`catalog.js`, `jukebox.js`, `jukebox.css` byte-identical. Gameplay/scoring/timing byte-identical.)

---

## PATCH 1 — `game.js`: the 4 MUST-FIXES + the 3 MP seams (additive)

### 1A — add the public seams (getLiveStats / onSongEnd / startAt + `__buffered` alias)

**ANCHOR (unique — the close of the `Object.assign(window.RhythmGame,{...})` block, game.js 3127-3128):**
```js
    getInputStatus: () => ({ midi: midiInputs.slice(), gamepads: gamepadList(), midiSupported: !!navigator.requestMIDIAccess }),
  });
```
**REPLACE WITH** (adds the `__buffered` alias INSIDE the object — the MUST-FIX "fix the buffered seam" —
then appends the 3 documented hooks AFTER the block):
```js
    getInputStatus: () => ({ midi: midiInputs.slice(), gamepads: gamepadList(), midiSupported: !!navigator.requestMIDIAccess }),
    __buffered: (url, meta) => bufferedProvider(url, meta),   // MP tight-sync seam (deferred provider)
  });

  // ===========================================================================
  // MULTIPLAYER ENGINE SEAMS (additive; default-inert if multiplayer.js absent).
  //   getLiveStats() — read the live run state each frame (opponent sync source)
  //   onSongEnd(cb)  — fire-once-per-run callback at natural end / fail / exit
  //   startAt(prov,{atMs,difficulty}) — synchronized launch at a shared wall clock
  // All reads are existing module-scope identifiers (verified present in v84).
  // ===========================================================================
  window.RhythmGame.getLiveStats = function () {
    var hit = counts.perfect + counts.great + counts.good;
    var done = hit + counts.miss;
    var accFrac = done > 0
      ? (counts.perfect * 1.0 + counts.great * 0.85 + counts.good * 0.5) / done : 1;
    var prog = (songDuration > 0 && player) ? Math.max(0, Math.min(1, songTime() / songDuration)) : 0;
    return {
      score: Math.round(score),
      combo: combo,
      maxCombo: maxCombo,
      acc: Math.round(accFrac * 1000) / 10,        // 0..100, 1 decimal
      progress: Math.round(prog * 1000) / 1000,    // 0..1
      playing: state === 'playing',
      grade: (function (p) { return p >= 95 ? 'S' : p >= 88 ? 'A' : p >= 75 ? 'B' : p >= 60 ? 'C' : 'D'; })(accFrac * 100)
    };
  };

  // onSongEnd — register fire-once listeners. Drained on each fire.
  var _songEndCbs = [];
  window.RhythmGame.onSongEnd = function (cb) { if (typeof cb === 'function') _songEndCbs.push(cb); };
  function _fireSongEnd(reason) {
    var cbs = _songEndCbs.slice(); _songEndCbs.length = 0;
    for (var i = 0; i < cbs.length; i++) {
      try { cbs[i](reason, (window.RhythmGame.lastResults && window.RhythmGame.lastResults()) || null); } catch (e) {}
    }
  }

  // startAt — synchronized launch. `atMs` is a Date.now()-domain wall clock shared via
  // broadcast. We schedule the SAME play(prov) on both clients. The engine's own 3..1
  // countdown still runs after; judgment stays 100% LOCAL (each client times its own
  // audio), so a small offset only affects the comparative bar, never fairness.
  window.RhythmGame.startAt = function (prov, opts) {
    opts = opts || {};
    if (opts.difficulty) { try { window.RhythmGame.setDifficulty(opts.difficulty); } catch (e) {} }
    var delay = Math.max(0, (opts.atMs || Date.now()) - Date.now());
    setTimeout(function () { try { getAC().resume(); } catch (e) {} try { play(prov); } catch (e) {} }, delay);
  };

  // Public getAC alias so multiplayer.js can resume audio inside the synced fire path.
  if (!window.RhythmGame.getAC) window.RhythmGame.getAC = function () { return getAC(); };
```

> All identifiers (`bufferedProvider`@841, `counts`, `score`/`combo`/`maxCombo`, `songDuration`, `player`,
> `songTime`, `state`, `getAC`@408, `play`, `setDifficulty`, `lastResults`@940, `__demoProvider`@941) are
> verified present in the live game.js. `node --check game.js` MUST pass after this.

### 1B — MUST-FIX: fire the song-end callback AFTER `_lastResults = results`

**ANCHOR (unique — game.js 1103, inside `endGame`):**
```js
    _lastResults = results;   // expose for the Levels results-loop (NEXT/RETRY + per-level stars)
```
**REPLACE WITH:**
```js
    _lastResults = results;   // expose for the Levels results-loop (NEXT/RETRY + per-level stars)
    try { _fireSongEnd('end'); } catch (e) {}   // MP: report final AFTER results object is ready
```
> This is the "move `_fireSongEnd('end')` to AFTER `_lastResults = results`" must-fix. It fires before
> `showScreen('results')` (line 1106) flips the screen; `showWinner()` in multiplayer.js then re-adds
> `.active` to `#multiplayer-screen`, so the WINNER overlay correctly sits ON TOP of the results screen.

### 1C — MUST-FIX: fire on EXIT too (in-game pause → EXIT)

**ANCHOR (unique — game.js 1218):**
```js
  $('exit-btn').addEventListener('click', () => { hidePause(); stopGame(); showScreen('menu'); });
```
**REPLACE WITH:**
```js
  $('exit-btn').addEventListener('click', () => { hidePause(); stopGame(); try { _fireSongEnd('exit'); } catch (e) {} showScreen('menu'); });
```

> **MUST-FIX "dead server-chart flag":** already correct in the live catalog.js — `hasServerChart(t)`
> (catalog.js 465) is `t.chart_status === 'ready' || t.has_chart`, and `launchTrack` (700) uses it. No edit
> needed in catalog.js. `multiplayer.js`'s own `hasServerChart()` mirrors the same flag (plus extra fallbacks),
> so the server-chart branch is live for both. **MUST-FIX "start a track at a timestamp":** provided by
> `RhythmGame.startAt` (1A) + the `__buffered` deferred-provider seam, consumed by `resolveAndStart` in
> multiplayer.js. **MUST-FIX "`__buffered` on the Object.assign":** added in 1A.

---

## PATCH 2 — `index.html`: fill the existing `#multiplayer-screen .mp-card` placeholder

**ANCHOR (unique — the placeholder body of the existing MP card, index.html 2237-2239):**
```html
      <div class="mh-pre">VERSUS</div>
      <h2 class="mp-title">MULTIPLAYER</h2>
      <p class="mp-sub">Head-to-head battles are coming online. Hang tight — this room is being wired up.</p>
```
**REPLACE WITH** (keeps the same `.mp-card` wrapper at 2236; adds `data-mp-step="lobby"` to it via the
title block + the 4 namespaced steps):
```html
      <div class="mh-pre">// VERSUS · LIVE LOBBY</div>
      <h2 class="mp-title">MULTIPLAYER</h2>

      <!-- STEP: LOBBY (everyone currently online) -->
      <div class="mpx-step mpx-step-lobby">
        <p class="mp-sub">Everyone online is below. Challenge anyone to a live head-to-head on the same track.</p>
        <div class="mpx-youbar">
          <span class="mpx-you-av" id="mpx-you-av">?</span>
          <span class="mpx-you-name" id="mpx-you-name">You</span>
          <span class="mpx-badge host" id="mpx-you-host" hidden>HOST</span>
          <span class="mpx-you-tag">that's you</span>
        </div>
        <div class="mpx-rosterhead"><span id="mpx-roster-count">0 online</span><span class="mpx-live-dot">● LIVE</span></div>
        <div class="mpx-roster" id="mpx-roster"></div>
        <p class="mpx-roster-empty" id="mpx-roster-empty" hidden>No one else is online right now. Keep this open — challengers appear here live.</p>
        <div class="mpx-banner" id="mpx-lobby-msg" hidden></div>
      </div>

      <!-- STEP: MATCH-SETUP (lock song, ready check) -->
      <div class="mpx-step mpx-step-setup" hidden>
        <div class="mpx-vsbar">
          <span class="mpx-dot you" id="mpx-dot-you">YOU</span>
          <span class="mpx-vs">VS</span>
          <span class="mpx-dot opp" id="mpx-dot-opp" data-state="waiting">WAITING…</span>
        </div>
        <div class="mpx-songpick">
          <div class="mpx-pick-head">TRACK</div>
          <button class="mpx-pick" id="mpx-pick" aria-label="Choose a track">
            <span class="mpx-pick-art" id="mpx-pick-art">♪</span>
            <span class="mpx-pick-txt"><span class="mpx-pick-t" id="mpx-pick-t">Host picks a track</span><span class="mpx-pick-a" id="mpx-pick-a">—</span></span>
            <span class="mpx-pick-chev" id="mpx-pick-chev">›</span>
          </button>
          <div class="mpx-diff set-seg" id="mpx-diff">
            <button data-diff="easy">Drift</button>
            <button data-diff="medium" class="active">Pulse</button>
            <button data-diff="hard">Fracture</button>
          </div>
          <div class="mpx-picker" id="mpx-picker" hidden>
            <input class="mpx-search" id="mpx-search" type="text" placeholder="Search a track…" autocomplete="off" spellcheck="false" />
            <div class="mpx-results" id="mpx-results"></div>
          </div>
        </div>
        <div class="mpx-readyrow">
          <button class="ghost-btn primary mpx-ready" id="mpx-ready" disabled>READY</button>
          <div class="mpx-readystate" id="mpx-readystate">Host: pick a track to begin.</div>
        </div>
        <button class="ghost-btn" id="mpx-leave-setup" style="margin-top:14px;">BACK TO LOBBY</button>
        <div class="mpx-banner" id="mpx-setup-msg" hidden></div>
      </div>

      <!-- STEP: GO (both ready → syncing) -->
      <div class="mpx-step mpx-step-go" hidden>
        <div class="mpx-go-num" id="mpx-go-num">GET READY</div>
        <p class="mp-sub">Syncing both decks…</p>
      </div>

      <!-- STEP: WINNER -->
      <div class="mpx-step mpx-step-winner" hidden>
        <div class="mpx-verdict" id="mpx-verdict">YOU WIN</div>
        <div class="mpx-scorecard">
          <div class="mpx-sc you">
            <div class="mpx-sc-who">YOU</div>
            <div class="mpx-sc-score" id="mpx-sc-you">0</div>
            <div class="mpx-sc-meta" id="mpx-sc-you-meta">—</div>
          </div>
          <div class="mpx-sc-vs">VS</div>
          <div class="mpx-sc opp">
            <div class="mpx-sc-who" id="mpx-sc-opp-who">OPPONENT</div>
            <div class="mpx-sc-score" id="mpx-sc-opp">0</div>
            <div class="mpx-sc-meta" id="mpx-sc-opp-meta">—</div>
          </div>
        </div>
        <div class="pause-actions" style="margin-top:18px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
          <button class="ghost-btn" id="mpx-rematch">REMATCH</button>
          <button class="ghost-btn" id="mpx-backlobby">BACK TO LOBBY</button>
          <button class="ghost-btn primary" id="mpx-leave-win">LEAVE</button>
        </div>
      </div>
```

> The existing `.mp-card` wrapper (line 2236) and `#mp-back` button (2232) are untouched; we only swap the
> three placeholder lines for the four steps. `multiplayer.js` toggles `.mpx-step-*[hidden]` so exactly one
> shows. The `.mpx-diff` reuses the existing `.set-seg` styling (index.html 2297-class group).

---

## PATCH 3 — `index.html`: CSS block (append into the single `<style>`)

**ANCHOR (unique — the existing MP card base rule, index.html 2018):**
```css
  .multiplayer-screen.active .mp-card { animation: cardIn 0.42s cubic-bezier(.2,1,.3,1) both; }
```
**INSERT-AFTER** that line:
```css
  /* ===== MULTIPLAYER (versus) — open-lobby steps (namespaced .mpx-*; in-game #mp-opp) ===== */
  .mp-card[data-mp-step] { } /* (data attr set by JS for future per-step theming; no rule needed) */
  .mp-card .mpx-step { display: block; width: 100%; }
  .mp-card .mpx-step[hidden] { display: none; }

  /* lobby: you-bar + roster */
  .mpx-youbar { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-radius: 14px; text-align: left;
    background: linear-gradient(180deg, rgba(255,31,46,0.14), rgba(255,31,46,0.05)); border: 1px solid rgba(255,31,46,0.34); margin: 6px 0 14px; }
  .mpx-you-av, .mpx-r-av { width: 38px; height: 38px; flex: 0 0 auto; border-radius: 50%; display: grid; place-items: center;
    font-family: 'Oxanium', sans-serif; font-weight: 800; font-size: 16px; color: #0a0706; background: var(--chrome, #dad7d2); background-size: cover; background-position: center; overflow: hidden; }
  .mpx-you-name, .mpx-r-name { font-family: 'Oxanium', sans-serif; font-weight: 700; font-size: 16px; color: var(--ink, #f3eceb); }
  .mpx-you-tag { margin-left: auto; font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.18em; color: #9c918e; }
  .mpx-badge { font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.16em; padding: 3px 8px; border-radius: 999px; }
  .mpx-badge.host { color: #0a0706; background: linear-gradient(180deg, #f0c25a, #d39a2c); border: 1px solid rgba(224,169,63,0.6); box-shadow: 0 0 14px rgba(224,169,63,0.4); }
  .mpx-rosterhead { display: flex; justify-content: space-between; align-items: center; font-family: 'JetBrains Mono', monospace; font-size: 11px; letter-spacing: 0.16em; color: #9c918e; margin: 4px 2px 8px; }
  .mpx-live-dot { color: #ff7a4a; }
  .mpx-roster { display: flex; flex-direction: column; gap: 8px; max-height: 320px; overflow-y: auto; text-align: left; }
  .mpx-row { display: flex; align-items: center; gap: 12px; padding: 9px 12px; border-radius: 12px;
    background: rgba(218,215,210,0.05); border: 1px solid var(--line, rgba(218,215,210,0.14)); }
  .mpx-row .mpx-r-meta { display: flex; flex-direction: column; min-width: 0; flex: 1; }
  .mpx-row .mpx-r-sub { font-family: 'Chakra Petch', sans-serif; font-size: 11px; color: #9c918e; }
  .mpx-challenge { margin-left: auto; flex: 0 0 auto; padding: 7px 14px; border-radius: 10px; cursor: pointer;
    font-family: 'Oxanium', sans-serif; font-weight: 800; font-size: 12px; letter-spacing: 0.06em; color: #fff;
    background: linear-gradient(180deg, #ff2a38, #b3121f); border: 1px solid rgba(255,31,46,0.5); transition: transform .12s ease, box-shadow .12s ease; }
  .mpx-challenge:hover { transform: translateY(-1px); box-shadow: 0 8px 22px rgba(255,31,46,0.4); }
  .mpx-challenge[disabled] { opacity: 0.5; cursor: default; background: rgba(218,215,210,0.08); color: #9c918e; border-color: var(--line, rgba(218,215,210,0.14)); }
  .mpx-row.incoming { border-color: rgba(224,169,63,0.5); background: rgba(224,169,63,0.08); }
  .mpx-acc { padding: 6px 12px; border-radius: 9px; font-family: 'Oxanium', sans-serif; font-weight: 800; font-size: 12px; cursor: pointer; color: #0a0706; background: var(--gold, #e0a93f); border: none; margin-left: auto; }
  .mpx-dec { padding: 6px 10px; border-radius: 9px; font-family: 'Oxanium', sans-serif; font-size: 12px; cursor: pointer; color: #b9aeac; background: transparent; border: 1px solid var(--line, rgba(218,215,210,0.18)); margin-left: 6px; }
  .mpx-roster-empty { font-family: 'Chakra Petch', sans-serif; color: #8d8380; font-size: 13px; padding: 18px 8px; }

  /* match-setup */
  .mpx-vsbar { display: flex; align-items: center; justify-content: center; gap: 12px; margin: 6px 0 16px; font-family: 'Oxanium', sans-serif; font-weight: 700; }
  .mpx-dot { padding: 7px 14px; border-radius: 999px; font-size: 13px; letter-spacing: 0.06em; border: 1px solid var(--line, rgba(218,215,210,0.18)); }
  .mpx-dot.you { color: #fff; background: linear-gradient(180deg, #ff2a38, #b3121f); border-color: rgba(255,31,46,0.5); }
  .mpx-dot.opp[data-state="waiting"] { color: #8d8380; }
  .mpx-dot.opp[data-state="here"] { color: #0a0706; background: var(--chrome, #dad7d2); border-color: var(--chrome, #dad7d2); }
  .mpx-dot.opp[data-state="left"] { color: #ff7a4a; border-color: rgba(255,122,74,0.5); }
  .mpx-vs { color: #6f6663; font-size: 12px; }
  .mpx-songpick { text-align: left; margin: 4px 0 16px; }
  .mpx-pick-head { font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.3em; color: var(--crimson, #ff1f2e); margin-bottom: 7px; }
  .mpx-pick { display: flex; align-items: center; gap: 12px; width: 100%; padding: 11px 14px; border-radius: 12px;
    background: rgba(218,215,210,0.05); border: 1px solid var(--line, rgba(218,215,210,0.16)); cursor: pointer; color: var(--ink, #f3eceb); }
  .mpx-pick[disabled] { opacity: 0.6; cursor: default; }
  .mpx-pick-art { width: 40px; height: 40px; flex: 0 0 auto; border-radius: 8px; display: grid; place-items: center;
    background: linear-gradient(135deg, rgba(255,31,46,0.25), rgba(255,122,74,0.12)); font-size: 18px; background-size: cover; background-position: center; overflow: hidden; }
  .mpx-pick-txt { display: flex; flex-direction: column; align-items: flex-start; flex: 1; min-width: 0; }
  .mpx-pick-t { font-family: 'Oxanium', sans-serif; font-weight: 700; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
  .mpx-pick-a { font-family: 'Chakra Petch', sans-serif; font-size: 12px; color: #9c918e; }
  .mpx-pick-chev { color: #6f6663; font-size: 22px; }
  .mpx-diff { margin-top: 10px; }
  .mpx-picker { margin-top: 10px; border-radius: 12px; border: 1px solid var(--line, rgba(218,215,210,0.16)); overflow: hidden; background: rgba(10,7,6,0.7); }
  .mpx-search { width: 100%; box-sizing: border-box; padding: 11px 14px; border: none; border-bottom: 1px solid var(--line, rgba(218,215,210,0.14));
    background: transparent; color: var(--ink, #f3eceb); font-family: 'Chakra Petch', sans-serif; font-size: 14px; }
  .mpx-results { max-height: 230px; overflow-y: auto; }
  .mpx-result { display: flex; align-items: center; gap: 10px; padding: 9px 14px; cursor: pointer; border-bottom: 1px solid rgba(218,215,210,0.06); }
  .mpx-result:hover { background: rgba(255,31,46,0.08); }
  .mpx-result .r-t { font-family: 'Oxanium', sans-serif; font-weight: 600; font-size: 14px; color: var(--ink, #f3eceb); }
  .mpx-result .r-a { font-family: 'Chakra Petch', sans-serif; font-size: 12px; color: #9c918e; }
  .mpx-readyrow { display: flex; flex-direction: column; align-items: center; gap: 8px; }
  .mpx-ready { min-width: 220px; }
  .mpx-ready.armed { background: linear-gradient(180deg, #2fd27a, #11955a); border-color: rgba(47,210,122,0.5); }
  .mpx-readystate { font-family: 'JetBrains Mono', monospace; font-size: 11px; letter-spacing: 0.05em; color: #9c918e; }

  /* go step */
  .mpx-go-num { font-family: 'Oxanium', sans-serif; font-weight: 800; font-size: clamp(40px, 12vw, 88px); color: var(--crimson, #ff1f2e); letter-spacing: 0.04em; }

  /* winner step */
  .mpx-verdict { font-family: 'Unbounded', sans-serif; font-size: clamp(34px, 8vw, 60px); margin: 6px 0 18px; letter-spacing: 0.02em; }
  .mpx-verdict.win { color: var(--gold, #e0a93f); text-shadow: 0 0 28px rgba(224,169,63,0.5); }
  .mpx-verdict.lose { color: #8d8380; }
  .mpx-verdict.draw { color: var(--chrome, #dad7d2); }
  .mpx-scorecard { display: flex; align-items: stretch; justify-content: center; gap: 12px; }
  .mpx-sc { flex: 1; max-width: 200px; padding: 16px 12px; border-radius: 14px; background: rgba(218,215,210,0.04); border: 1px solid var(--line, rgba(218,215,210,0.14)); }
  .mpx-sc.you { border-color: rgba(255,31,46,0.4); }
  .mpx-sc-who { font-family: 'JetBrains Mono', monospace; font-size: 11px; letter-spacing: 0.2em; color: #9c918e; }
  .mpx-sc-score { font-family: 'Oxanium', sans-serif; font-weight: 800; font-size: 32px; color: var(--ink, #f3eceb); margin: 4px 0; }
  .mpx-sc-meta { font-family: 'Chakra Petch', sans-serif; font-size: 12px; color: #9c918e; }
  .mpx-sc-vs { align-self: center; font-family: 'Oxanium', sans-serif; font-weight: 800; color: #6f6663; font-size: 14px; }

  .mpx-banner { margin-top: 14px; padding: 10px 14px; border-radius: 10px; font-family: 'Chakra Petch', sans-serif; font-size: 13px;
    background: rgba(255,122,74,0.1); border: 1px solid rgba(255,122,74,0.3); color: #ffb695; }

  /* IN-GAME OPPONENT PANEL (self-mounted into #game by multiplayer.js) */
  #mp-opp { position: absolute; top: 14px; right: 14px; z-index: 40; width: 196px; padding: 12px 14px; border-radius: 14px;
    background: linear-gradient(180deg, rgba(20,10,10,0.86), rgba(10,7,6,0.9)); border: 1px solid rgba(218,215,210,0.18);
    box-shadow: 0 10px 30px rgba(0,0,0,0.5); pointer-events: none; font-family: 'Oxanium', sans-serif; }
  #mp-opp .mo-who { font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.22em; color: #c9a25a; display: flex; justify-content: space-between; }
  #mp-opp .mo-live { color: #2fd27a; }
  #mp-opp .mo-live.gone { color: #ff7a4a; }
  #mp-opp .mo-score { font-weight: 800; font-size: 26px; color: var(--chrome, #dad7d2); margin: 2px 0; letter-spacing: 0.02em; }
  #mp-opp .mo-row { display: flex; justify-content: space-between; font-size: 12px; color: #9c918e; font-family: 'Chakra Petch', sans-serif; }
  #mp-opp .mo-bar { margin-top: 8px; height: 6px; border-radius: 3px; background: rgba(218,215,210,0.12); overflow: hidden; }
  #mp-opp .mo-bar > span { display: block; height: 100%; width: 0%; background: linear-gradient(90deg, var(--ember, #ff7a4a), var(--chrome, #dad7d2)); transition: width .18s linear; }
  #mp-opp.lead { border-color: rgba(255,31,46,0.55); }            /* opponent ahead → crimson edge */
  #mp-opp .mo-delta { font-weight: 800; font-size: 13px; }
  #mp-opp .mo-delta.ahead { color: #2fd27a; }                    /* YOU ahead */
  #mp-opp .mo-delta.behind { color: var(--crimson, #ff1f2e); }
  @media (max-width: 760px) { #mp-opp { width: 140px; top: 8px; right: 8px; padding: 9px 10px; } #mp-opp .mo-score { font-size: 20px; } }
  html.rr-reduce-motion #mp-opp .mo-bar > span { transition: none; }
  html.rr-reduce-motion .mpx-challenge:hover { transform: none; }
```

> No blue/purple. HOST badge = gold; YOU = crimson; opponent-ahead edge = crimson; READY-armed = green
> (a status color, not a brand accent — same green the rest of the app uses for "armed"/"go"). Honors
> `html.rr-reduce-motion`.

---

## PATCH 4 — `index.html`: load `multiplayer.js` LAST + bump `?v` (the 4 spots)

**ANCHOR (unique — the three module script tags, index.html 3220-3222):**
```html
<script src="game.js?v=84"></script>
<script src="jukebox.js?v=84"></script>
<script src="catalog.js?v=84"></script>
```
**REPLACE WITH** (multiplayer.js LAST, after `RhythmGame` + `RhythmCatalog` exist):
```html
<script src="game.js?v=85"></script>
<script src="jukebox.js?v=85"></script>
<script src="catalog.js?v=85"></script>
<script src="multiplayer.js?v=85"></script>
```

**ANCHOR (unique — the CSS ref, index.html line 14):**
```html
<link rel="stylesheet" href="jukebox.css?v=84" />
```
**REPLACE WITH:**
```html
<link rel="stylesheet" href="jukebox.css?v=85" />
```
> Four `?v` spots bumped 84→85 (game.js, jukebox.js, catalog.js, jukebox.css), per the project rule.
> `multiplayer.js` ships at `?v=85` from the start.

---

## PATCH 5 — `index.html` (OPTIONAL, recommended): leaderboard live-flip on sign-in

The leaderboard IIFE already renders `fetchGlobalLeaderboard`/`fetchLeaderboard` with a local "You"
fallback (the "guest standing"). This one addition re-renders it the moment the user signs in.

**ANCHOR (unique — the leaderboard IIFE open/close wiring, index.html 4065-4066):**
```js
  var ob = $('leaderboard-open'); if (ob) ob.addEventListener('click', open);
  var cb = $('leaderboard-close'); if (cb) cb.addEventListener('click', close);
```
**INSERT-AFTER** those two lines:
```js
  // live-flip: when auth changes (sign-in/out), re-render if the board is open.
  try {
    if (RC() && RC().onAuthChange) RC().onAuthChange(function () { if (screen.classList.contains('active')) render(); });
  } catch (e) {}
```
> `RC()` (4906→3906), `screen` (3905), `render` (4007) all in-scope in that IIFE. No catalog.js change:
> the boards flip to real users once `GET /leaderboard/global` returns ranked rows with display names
> (Lovable brief in `_build6_multiplayer.md` §6 item 5). Until then, the guest standing line shows.

---

## VERIFY

```
# A) engine hooks + must-fixes landed in game.js
grep -n "getLiveStats\|onSongEnd\|RhythmGame.startAt\|_fireSongEnd\|__buffered" game.js
#   expect: 3 hook defs + __buffered alias + _fireSongEnd helper + 2 wired calls (endGame 1103 tail + exit-btn)
node --check game.js          # MUST pass
node --check multiplayer.js   # MUST pass (already verified clean)

# B) the steps + ids exist in index.html (note: screen id is #multiplayer-screen, ids are mpx-*)
grep -n 'mpx-step-lobby\|mpx-step-setup\|mpx-step-winner\|id="mpx-roster"\|id="mpx-you-host"\|mpx-challenge' index.html

# C) CSS + script wiring + versions (4 spots)
grep -n '.mpx-roster\|.mpx-badge.host\|#mp-opp' index.html
grep -n 'multiplayer.js?v=85' index.html
grep -n 'game.js?v=85\|jukebox.js?v=85\|catalog.js?v=85\|jukebox.css?v=85' index.html

# D) collision sanity — namespaced ids unique; existing .mp-card/.mp-title untouched; RhythmMP only in multiplayer.js
grep -n 'id="mpx-' index.html | sort
grep -n 'RhythmMP' index.html game.js catalog.js jukebox.js   # zero hits → only multiplayer.js defines it
```

**Claude_Preview runtime test (integrator):**
1. `preview_eval`: `location.href = '/index.html?cb='+Date.now()` → TAP TO BEGIN → hub → **MULTIPLAYER** tile.
2. Open a SECOND tab to the same URL → both should appear in each other's `#mpx-roster`; the earliest-joined
   wears the gold **HOST** badge.
3. Tab A CHALLENGE → Tab B ACCEPT → host picks a track (`#mpx-pick` search) + difficulty → both READY →
   both run the SAME chart with the `#mp-opp` opponent panel visible → WINNER on both.
4. Disconnect one mid-song (close tab) → the other shows "LEFT" on `#mp-opp` and auto-wins at song end.
5. `preview_console_logs` (level error) → expect none. If Realtime is unavailable, the lobby shows
   "Sign in to play online — multiplayer needs a connection." and nothing else breaks.

## NOTES / CONSTRAINTS HONORED
- Gameplay/scoring/timing **byte-identical**: MP starts a normal `play(provider)` via the same paths; the
  only additions are *when* it fires (`startAt` setTimeout) + an out-of-engine read-only `#mp-opp` panel.
- `catalog.js` / `jukebox.js` / `jukebox.css` **unchanged**. game.js gains 3 hooks + 1 alias + 2 one-line
  `_fireSongEnd` calls. The existing `.mp-card`/`.mp-title`/`.mp-sub` CSS is untouched (new = `.mpx-*`).
- Brand: black · crimson #ff1f2e · ember #ff7a4a · gold #e0a93f · chrome #dad7d2; warm darks; no blue/purple.
- **MP ships visible** because the `mh-multiplayer` hub tile already exists and routes here. If you want it
  dark for beta, hide the tile (`#mh-multiplayer{display:none}`) — `multiplayer.js` is inert until activated.
- No raster assets required (icon is the existing hub tile; lobby/badge/panels are pure CSS; avatars fall
  back to a chrome initial chip). Optional polish art (`assets/mp/versus-key.png`, `win-burst.png`) is listed
  in `_build6_multiplayer.md` §5 with self-healing fallbacks — code ships correct without them.
