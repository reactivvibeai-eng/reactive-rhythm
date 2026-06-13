# BUILD PACKAGE 4 — Online Multiplayer (2 devices) via Supabase Realtime

> Concern: **Online 1v1 multiplayer** — room codes, live opponent panel, synchronized start, winner screen.
> Transport: **Supabase Realtime** (broadcast + presence). NO custom websocket server for the core loop.
> supabase-js v2 is already loaded as a CDN `<script>`; `window.RHYTHM_CONFIG` has the live URL + anon key.
> Apply by **searching for each anchor string** below, then insert/replace exactly as marked. The integrator
> applies this serially against the REAL files at ROOT. Every anchor here was copied from the live files.

---

## 1) SUMMARY + WHAT STAYS BYTE-IDENTICAL

**What this adds**
- A new `#multiplayer` overlay screen (Create / Join room, song lock, ready check, winner) — same `.screen`
  pattern + open/close IIFE used by `#levels-screen` / `#store-screen`. Opened from a new header icon.
- A new external module **`multiplayer.js`** (the only new JS file) that owns: its own supabase client,
  the Realtime room channel (presence + broadcast), state sync, the in-game **opponent panel**, and the
  winner screen wiring. Exposes `window.RhythmMP`.
- One CSS block appended to the single `<style>` in index.html (opponent panel + MP screen).
- **Small additive engine hooks** in `game.js`: `RhythmGame.getLiveStats()`, `RhythmGame.onSongEnd(cb)`,
  `RhythmGame.startAt(provider, opts)` (synchronized start at a wall-clock timestamp), and a tiny
  `RhythmGame.mpProgress()` read. All are additive — no existing call path changes.

**What stays byte-identical (do NOT touch)**
- `catalog.js`, `jukebox.js`, `jukebox.css` — **unchanged**. (MP reuses `RhythmCatalog.allTracks`,
  `launchTrack`, `getUser` read-only; it does NOT modify them.)
- The existing `showScreen()` in game.js (core flow `menu/loading/game/countdown/results`) — **unchanged**.
  The MP screen is an **overlay** toggled by `classList.add('active')` exactly like `#levels-screen`,
  so it never enters game.js's `screens{}` map.
- `play()`, `beginPlay()`, `runCountdown()`, `loop()`, scoring, `endGame()` bodies — **unchanged**. The new
  engine hooks are appended near the existing `Object.assign(window.RhythmGame, {...})` block and call into
  existing functions only.
- All brand tokens, fonts, the supernova intro, beta gate, error guard — untouched.

**Design budget honored**: black · crimson `#ff1f2e` · ember `#ff7a4a` · gold `#e0a93f` · chrome `#dad7d2`;
warm darks; NO blue/purple; fonts Oxanium (numbers) / Chakra Petch (labels) / Unbounded (headers) /
JetBrains Mono (mono/pre-titles). Centered card layout matching `.levels-card` / `.store-card`.

**Realtime auth note (anon key)**: Supabase Realtime accepts the anon JWT for `broadcast` and `presence`
channels by default (no Realtime RLS policy is required for ephemeral broadcast — only for Postgres-changes
streams). The client is created with the anon key exactly like `catalog.js` does. Channel names are
namespaced `rr-mp-<ROOMCODE>` so two rooms never collide. **If** the project has flipped on Realtime
authorization (RLS-on-channels, a newer opt-in), the Lovable brief in §7 covers the one policy needed.

---

## 2) INFORMATION ARCHITECTURE / FLOW

```
#start ("TAP TO BEGIN")
   └─► #menu (library)  ── header icon row ──► [new "Versus" icon #mp-open]
                                                       │
                                                       ▼
                                              #multiplayer (overlay .screen)
   ┌───────────────────────────────────────────────────────────────────────────┐
   │  Step LOBBY:  [ CREATE ROOM ]   [ JOIN ROOM ]                               │
   │     • Create → generate 4-char CODE, become HOST, channel rr-mp-<CODE>      │
   │     • Join   → enter CODE, become GUEST, subscribe channel                  │
   │  Step ROOM (both connected via presence):                                   │
   │     • shows BIG room code (host) / "connected" (guest)                      │
   │     • HOST: [ Pick song ] (mini track list from RhythmCatalog.allTracks)    │
   │              + difficulty seg (Easy/Med/Hard) → broadcast 'song'            │
   │     • GUEST: sees locked song + difficulty (read-only)                      │
   │     • both: [ READY ] toggle → broadcast 'ready'                            │
   │  Step COUNTDOWN: when BOTH ready, HOST broadcasts 'start' {startAtMs, ...}   │
   │     • both clients call RhythmGame.startAt(...) at the shared timestamp      │
   │     → #game (overlay closes; engine runs; opponent panel mounts in #game)   │
   │  Step PLAYING: each client broadcasts 'tick' {score,combo,acc,prog} ~5/s    │
   │     • each renders the opponent's last tick in the in-game opponent panel    │
   │  Step END: on local song end → broadcast 'final' {score,acc,combo,grade}     │
   │     • when both finals in (or 8s timeout) → reopen #multiplayer at WINNER     │
   │  Step WINNER: YOU WIN / YOU LOSE / DRAW + side-by-side scorecard             │
   │     • [ REMATCH ] (same room, back to ROOM step)  [ LEAVE ] (close → menu)   │
   └───────────────────────────────────────────────────────────────────────────┘
```

**Back-nav / exits**
- Esc or the DONE/LEAVE button on `#multiplayer` → `close()` (untrack presence, `removeChannel`, screen
  loses `active`). Matches the `#levels-screen` Esc handler pattern.
- **Opponent disconnect**: presence `leave` event → opponent panel shows "OPPONENT LEFT"; if it happens
  during PLAYING, the local run continues solo and you auto-win at song end.
- Closing the MP screen mid-PLAYING is NOT offered (the game screen is active, not the overlay); leaving is
  via the existing in-game pause → EXIT, which fires `RhythmGame.onSongEnd` cleanup so MP tears down.

**Gating**: mirror the campaign gate. Default the header icon visible only when `?dev` OR a
`MP_PUBLIC = false` flag flipped to true (so it can ship dark, like Levels' `CAMPAIGN_PUBLIC`). The screen
itself works regardless; the flag only controls the icon's visibility.

---

## 3) EXACT INTEGRATION STEPS

> Order: 3A (engine hooks) → 3B (opponent panel hook point, none needed — panel is self-mounted) →
> 3C (HTML screen) → 3D (CSS) → 3E (header icon) → 3F (new file multiplayer.js) → 3G (script tag + ?v bump).

---

### 3A — `game.js`: add public hooks (additive)

**ANCHOR (unique, exists at ~line 3110):**
```js
  Object.assign(window.RhythmGame, {
    play,                              // play(provider)
    playDemo: () => play(demoProvider),
    playUrl: (url, meta) => play(() => bufferedProvider(url, meta)),   // in-browser chart a live track
```

**INSERT-AFTER** the **closing** of that `Object.assign({...});` block — i.e. after this exact existing line:
```js
    getInputStatus: () => ({ midi: midiInputs.slice(), gamepads: gamepadList(), midiSupported: !!navigator.requestMIDIAccess }),
  });
```

**DROP-IN CODE:**
```js
  // ===========================================================================
  // MULTIPLAYER ENGINE SEAMS (additive; default-inert if multiplayer.js absent)
  //   getLiveStats() — read the live run state each frame (opponent sync source)
  //   onSongEnd(cb)  — fire-once-per-run callback at natural end / fail / exit
  //   startAt(prov, {atMs, difficulty}) — synchronized start: schedule beginPlay so
  //                    the song's t=0 lands on a shared wall-clock timestamp.
  // ===========================================================================
  window.RhythmGame.getLiveStats = function () {
    var total = (typeof notes !== 'undefined' && notes) ? notes.length : 0;
    var hit = counts.perfect + counts.great + counts.good;
    var done = hit + counts.miss;
    var accFrac = done > 0
      ? (counts.perfect * 1.0 + counts.great * 0.85 + counts.good * 0.5) / done : 1;
    var prog = (songDuration > 0 && player) ? Math.max(0, Math.min(1, songTime() / songDuration)) : 0;
    return {
      score: Math.round(score),
      combo: combo,
      maxCombo: maxCombo,
      acc: Math.round(accFrac * 1000) / 10,   // 0..100 (1 decimal)
      progress: Math.round(prog * 1000) / 1000,
      playing: state === 'playing',
      grade: (function (p) { return p >= 95 ? 'S' : p >= 88 ? 'A' : p >= 75 ? 'B' : p >= 60 ? 'C' : 'D'; })(accFrac * 100)
    };
  };

  // onSongEnd — register fire-once listeners. Cleared each new beginPlay.
  var _songEndCbs = [];
  window.RhythmGame.onSongEnd = function (cb) { if (typeof cb === 'function') _songEndCbs.push(cb); };
  function _fireSongEnd(reason) {
    var cbs = _songEndCbs.slice(); _songEndCbs.length = 0;
    for (var i = 0; i < cbs.length; i++) { try { cbs[i](reason, window.RhythmGame.lastResults && window.RhythmGame.lastResults()); } catch (e) {} }
  }

  // startAt — synchronized launch. `atMs` is a performance.timeOrigin-independent
  // wall-clock (Date.now) target shared via broadcast. We compute the local delay
  // and schedule the SAME play() call on both clients. The 3s in-engine countdown
  // still runs; `atMs` is when beginPlay (decode+countdown) KICKS OFF, so both
  // clients' songs line up within one network RTT + decode jitter (acceptable for a
  // versus bar — judgment stays 100% local).
  window.RhythmGame.startAt = function (prov, opts) {
    opts = opts || {};
    if (opts.difficulty) { try { window.RhythmGame.setDifficulty(opts.difficulty); } catch (e) {} }
    var delay = Math.max(0, (opts.atMs || Date.now()) - Date.now());
    setTimeout(function () { try { getAC().resume(); } catch (e) {} play(prov); }, delay);
  };

  // mpProgress — lightweight read for the MP screen winner card
  window.RhythmGame.mpProgress = function () { return window.RhythmGame.getLiveStats(); };
```

**Then wire `_fireSongEnd` into the two existing end paths (replace, surgical):**

**ANCHOR 1 (exists ~line 1074, the `endGame` declaration):**
```js
  async function endGame() {
    stopGame();
    const total = notes.length;
```
**REPLACE WITH:**
```js
  async function endGame() {
    stopGame();
    try { _fireSongEnd('end'); } catch (e) {}
    const total = notes.length;
```

**ANCHOR 2 (exists ~line 1212, EXIT button handler):**
```js
  $('exit-btn').addEventListener('click', () => { hidePause(); stopGame(); showScreen('menu'); });
```
**REPLACE WITH:**
```js
  $('exit-btn').addEventListener('click', () => { hidePause(); stopGame(); try { _fireSongEnd('exit'); } catch (e) {} showScreen('menu'); });
```

> Note: `notes`, `counts`, `score`, `combo`, `maxCombo`, `songDuration`, `player`, `songTime`, `state`,
> `getAC`, `play`, `stopGame` are all module-scope identifiers verified present in game.js (lines 157, 171,
> 899, 1036, 1053, 1443, 402). `getLiveStats` and `startAt` reference only those — no new globals.

---

### 3B — Opponent panel mount (NO game.js edit)

The opponent panel is a **self-mounted DOM element** created by `multiplayer.js` (appended to `#game` on
match start, removed on song end). This keeps game.js untouched. The panel reads the engine via
`RhythmGame.getLiveStats()` each rAF tick (multiplayer.js runs its own light rAF only while a match is
live) and renders the opponent from the last received `tick` broadcast. See §6 for the exact panel markup
the module injects.

---

### 3C — `index.html`: the `#multiplayer` overlay screen

**ANCHOR (unique — the closing of the STORE screen, exists ~line 2443):**
```html
      <button class="ghost-btn primary" id="store-close" style="margin-top:18px;min-width:200px;">DONE</button>
    </div>
  </div>
```
**INSERT-AFTER** that exact block (i.e. the `</div></div>` that closes `#store-screen`):

**DROP-IN CODE:**
```html
  <!-- ============================================================
       MULTIPLAYER — 1v1 online (Supabase Realtime room codes).
       Self-owned overlay (.screen, toggled via classList 'active'),
       driven by multiplayer.js (window.RhythmMP). Steps switch via
       data-mp-step on the card; only one .mp-step block shows at a time.
       ============================================================ -->
  <div class="screen mp-screen" id="multiplayer">
    <div class="mp-card" data-mp-step="lobby">
      <div class="pre-title" style="font-family:'JetBrains Mono';font-size:12px;letter-spacing:0.4em;color:var(--crimson);">// VERSUS</div>
      <h2 class="mp-title">MULTIPLAYER</h2>

      <!-- STEP: LOBBY -->
      <div class="mp-step mp-step-lobby">
        <p class="mp-sub">Race a friend on the same track, live on two devices. One creates a room, the other joins with the code.</p>
        <div class="mp-lobby-actions">
          <button class="mp-bigbtn" id="mp-create">
            <span class="mp-bigbtn-k">CREATE ROOM</span>
            <span class="mp-bigbtn-s">Host a match · get a code</span>
          </button>
          <div class="mp-join">
            <input id="mp-code-in" class="mp-code-in" type="text" inputmode="latin" maxlength="4" autocomplete="off" spellcheck="false" placeholder="CODE" aria-label="Room code" />
            <button class="mp-bigbtn alt" id="mp-join">
              <span class="mp-bigbtn-k">JOIN ROOM</span>
              <span class="mp-bigbtn-s">Enter a friend's code</span>
            </button>
          </div>
        </div>
        <div class="mp-banner" id="mp-lobby-msg" hidden></div>
      </div>

      <!-- STEP: ROOM (lock song, ready check) -->
      <div class="mp-step mp-step-room" hidden>
        <div class="mp-roomhead">
          <div class="mp-codebox" id="mp-codebox">
            <span class="mp-codebox-l">ROOM CODE</span>
            <span class="mp-codebox-v" id="mp-codebox-v">----</span>
          </div>
          <div class="mp-presence">
            <span class="mp-dot you" id="mp-dot-you">YOU</span>
            <span class="mp-vs">VS</span>
            <span class="mp-dot opp" id="mp-dot-opp" data-state="waiting">WAITING…</span>
          </div>
        </div>

        <div class="mp-songpick" id="mp-songpick">
          <div class="mp-pick-head">TRACK</div>
          <button class="mp-pick" id="mp-pick" aria-label="Choose a track">
            <span class="mp-pick-art" id="mp-pick-art">♪</span>
            <span class="mp-pick-txt"><span class="mp-pick-t" id="mp-pick-t">Host picks a track</span><span class="mp-pick-a" id="mp-pick-a">—</span></span>
            <span class="mp-pick-chev" id="mp-pick-chev">›</span>
          </button>
          <div class="mp-diff set-seg" id="mp-diff">
            <button data-diff="easy">Easy</button>
            <button data-diff="medium" class="active">Medium</button>
            <button data-diff="hard">Hard</button>
          </div>
          <!-- inline track picker (host only) -->
          <div class="mp-picker" id="mp-picker" hidden>
            <input class="mp-search" id="mp-search" type="text" placeholder="Search a track…" autocomplete="off" spellcheck="false" />
            <div class="mp-results" id="mp-results"></div>
          </div>
        </div>

        <div class="mp-readyrow">
          <button class="ghost-btn primary mp-ready" id="mp-ready" disabled>READY</button>
          <div class="mp-readystate" id="mp-readystate">Host: pick a track to begin.</div>
        </div>
        <button class="ghost-btn" id="mp-leave-room" style="margin-top:14px;">LEAVE ROOM</button>
        <div class="mp-banner" id="mp-room-msg" hidden></div>
      </div>

      <!-- STEP: COUNTDOWN (brief; both ready → starting) -->
      <div class="mp-step mp-step-go" hidden>
        <div class="mp-go-num" id="mp-go-num">GET READY</div>
        <p class="mp-sub">Syncing both decks…</p>
      </div>

      <!-- STEP: WINNER -->
      <div class="mp-step mp-step-winner" hidden>
        <div class="mp-verdict" id="mp-verdict">YOU WIN</div>
        <div class="mp-scorecard">
          <div class="mp-sc you">
            <div class="mp-sc-who">YOU</div>
            <div class="mp-sc-score" id="mp-sc-you">0</div>
            <div class="mp-sc-meta" id="mp-sc-you-meta">—</div>
          </div>
          <div class="mp-sc-vs">VS</div>
          <div class="mp-sc opp">
            <div class="mp-sc-who" id="mp-sc-opp-who">OPPONENT</div>
            <div class="mp-sc-score" id="mp-sc-opp">0</div>
            <div class="mp-sc-meta" id="mp-sc-opp-meta">—</div>
          </div>
        </div>
        <div class="pause-actions" style="margin-top:18px;">
          <button class="ghost-btn" id="mp-rematch">REMATCH</button>
          <button class="ghost-btn primary" id="mp-leave-win">LEAVE</button>
        </div>
      </div>

      <button class="mp-close-x" id="mp-close" aria-label="Close multiplayer">✕</button>
    </div>
  </div>
```

---

### 3D — `index.html`: CSS (append into the single `<style>`)

**ANCHOR (unique — the store screen base rule, exists ~line 650):**
```css
  .store-screen { z-index: 261; background: radial-gradient(ellipse at 50% 28%, rgba(120,12,20,0.55), transparent 64%), #0a0706; backdrop-filter: blur(18px); overflow-y: auto; }
```
**INSERT-AFTER** that line (keeps MP visual language identical to the other overlays):

**DROP-IN CODE:**
```css
  /* ===== MULTIPLAYER (versus) overlay + in-game opponent panel ===== */
  .mp-screen { z-index: 262; background: radial-gradient(ellipse at 50% 28%, rgba(120,12,20,0.55), transparent 64%), #0a0706; backdrop-filter: blur(18px); overflow-y: auto; }
  .screen.active .mp-card { animation: cardIn 0.42s cubic-bezier(.2,1,.3,1) both; }
  .mp-card { position: relative; width: min(560px, 92vw); margin: auto; padding: 30px 28px 26px; border-radius: 22px;
    background: linear-gradient(180deg, rgba(24,12,12,0.96), rgba(10,7,6,0.97)); border: 1px solid rgba(255,31,46,0.28);
    box-shadow: 0 24px 80px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(218,215,210,0.04); text-align: center; }
  .mp-title { font-family: 'Unbounded', sans-serif; font-size: clamp(30px, 6vw, 46px); margin: 8px 0 14px; color: var(--ink, #f3eceb); letter-spacing: 0.02em; }
  .mp-sub { font-family: 'Chakra Petch', sans-serif; color: #b9aeac; font-size: 14px; line-height: 1.5; margin: 0 auto 18px; max-width: 420px; }
  .mp-step { display: block; }
  .mp-step[hidden] { display: none; }

  /* lobby */
  .mp-lobby-actions { display: flex; flex-direction: column; gap: 14px; max-width: 380px; margin: 0 auto; }
  .mp-bigbtn { display: flex; flex-direction: column; align-items: flex-start; gap: 3px; width: 100%; padding: 16px 20px;
    border-radius: 14px; border: 1px solid rgba(255,31,46,0.4); cursor: pointer; text-align: left;
    background: linear-gradient(180deg, #ff2a38, #b3121f); color: #fff; transition: transform .12s ease, box-shadow .12s ease; }
  .mp-bigbtn:hover { transform: translateY(-1px); box-shadow: 0 8px 26px rgba(255,31,46,0.4); }
  .mp-bigbtn.alt { background: rgba(218,215,210,0.06); border-color: var(--line, rgba(218,215,210,0.18)); color: var(--ink, #f3eceb); }
  .mp-bigbtn-k { font-family: 'Oxanium', sans-serif; font-weight: 800; font-size: 17px; letter-spacing: 0.06em; }
  .mp-bigbtn-s { font-family: 'Chakra Petch', sans-serif; font-size: 12px; opacity: 0.82; }
  .mp-join { display: flex; gap: 10px; align-items: stretch; }
  .mp-join .mp-bigbtn { flex: 1; }
  .mp-code-in { width: 116px; flex: 0 0 auto; text-align: center; font-family: 'Oxanium', sans-serif; font-weight: 800;
    font-size: 24px; letter-spacing: 0.22em; text-transform: uppercase; color: var(--gold, #e0a93f);
    background: rgba(10,7,6,0.7); border: 1px solid rgba(224,169,63,0.4); border-radius: 14px; padding: 0 8px; }
  .mp-code-in::placeholder { color: rgba(224,169,63,0.35); letter-spacing: 0.22em; }

  /* room */
  .mp-roomhead { display: flex; flex-wrap: wrap; gap: 14px; align-items: center; justify-content: space-between; margin-bottom: 16px; }
  .mp-codebox { display: flex; flex-direction: column; align-items: flex-start; padding: 10px 18px; border-radius: 12px;
    background: rgba(224,169,63,0.08); border: 1px solid rgba(224,169,63,0.32); }
  .mp-codebox-l { font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.3em; color: #c9a25a; }
  .mp-codebox-v { font-family: 'Oxanium', sans-serif; font-weight: 800; font-size: 34px; letter-spacing: 0.18em; color: var(--gold, #e0a93f); }
  .mp-presence { display: flex; align-items: center; gap: 10px; font-family: 'Oxanium', sans-serif; font-weight: 700; }
  .mp-dot { padding: 6px 12px; border-radius: 999px; font-size: 12px; letter-spacing: 0.08em; border: 1px solid var(--line, rgba(218,215,210,0.18)); }
  .mp-dot.you { color: #fff; background: linear-gradient(180deg, #ff2a38, #b3121f); border-color: rgba(255,31,46,0.5); }
  .mp-dot.opp[data-state="waiting"] { color: #8d8380; }
  .mp-dot.opp[data-state="here"] { color: #0a0706; background: var(--chrome, #dad7d2); border-color: var(--chrome, #dad7d2); }
  .mp-dot.opp[data-state="left"] { color: #ff7a4a; border-color: rgba(255,122,74,0.5); }
  .mp-vs { color: #6f6663; font-size: 11px; }

  .mp-songpick { text-align: left; margin: 4px 0 16px; }
  .mp-pick-head { font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.3em; color: var(--crimson, #ff1f2e); margin-bottom: 7px; }
  .mp-pick { display: flex; align-items: center; gap: 12px; width: 100%; padding: 11px 14px; border-radius: 12px;
    background: rgba(218,215,210,0.05); border: 1px solid var(--line, rgba(218,215,210,0.16)); cursor: pointer; color: var(--ink, #f3eceb); }
  .mp-pick[disabled] { opacity: 0.6; cursor: default; }
  .mp-pick-art { width: 40px; height: 40px; flex: 0 0 auto; border-radius: 8px; display: grid; place-items: center;
    background: linear-gradient(135deg, rgba(255,31,46,0.25), rgba(255,122,74,0.12)); font-size: 18px; background-size: cover; background-position: center; }
  .mp-pick-txt { display: flex; flex-direction: column; align-items: flex-start; flex: 1; min-width: 0; }
  .mp-pick-t { font-family: 'Oxanium', sans-serif; font-weight: 700; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
  .mp-pick-a { font-family: 'Chakra Petch', sans-serif; font-size: 12px; color: #9c918e; }
  .mp-pick-chev { color: #6f6663; font-size: 22px; }
  .mp-diff { margin-top: 10px; }
  .mp-picker { margin-top: 10px; border-radius: 12px; border: 1px solid var(--line, rgba(218,215,210,0.16)); overflow: hidden; background: rgba(10,7,6,0.7); }
  .mp-search { width: 100%; box-sizing: border-box; padding: 11px 14px; border: none; border-bottom: 1px solid var(--line, rgba(218,215,210,0.14));
    background: transparent; color: var(--ink, #f3eceb); font-family: 'Chakra Petch', sans-serif; font-size: 14px; }
  .mp-results { max-height: 230px; overflow-y: auto; }
  .mp-result { display: flex; align-items: center; gap: 10px; padding: 9px 14px; cursor: pointer; border-bottom: 1px solid rgba(218,215,210,0.06); }
  .mp-result:hover { background: rgba(255,31,46,0.08); }
  .mp-result .r-t { font-family: 'Oxanium', sans-serif; font-weight: 600; font-size: 14px; color: var(--ink, #f3eceb); }
  .mp-result .r-a { font-family: 'Chakra Petch', sans-serif; font-size: 12px; color: #9c918e; }

  .mp-readyrow { display: flex; flex-direction: column; align-items: center; gap: 8px; }
  .mp-ready { min-width: 220px; }
  .mp-ready.armed { background: linear-gradient(180deg, #2fd27a, #11955a); border-color: rgba(47,210,122,0.5); }
  .mp-readystate { font-family: 'JetBrains Mono', monospace; font-size: 11px; letter-spacing: 0.05em; color: #9c918e; }

  /* countdown step */
  .mp-go-num { font-family: 'Oxanium', sans-serif; font-weight: 800; font-size: clamp(40px, 12vw, 88px); color: var(--crimson, #ff1f2e); letter-spacing: 0.04em; }

  /* winner step */
  .mp-verdict { font-family: 'Unbounded', sans-serif; font-size: clamp(34px, 8vw, 60px); margin: 6px 0 18px; letter-spacing: 0.02em; }
  .mp-verdict.win { color: var(--gold, #e0a93f); text-shadow: 0 0 28px rgba(224,169,63,0.5); }
  .mp-verdict.lose { color: #8d8380; }
  .mp-verdict.draw { color: var(--chrome, #dad7d2); }
  .mp-scorecard { display: flex; align-items: stretch; justify-content: center; gap: 12px; }
  .mp-sc { flex: 1; max-width: 200px; padding: 16px 12px; border-radius: 14px; background: rgba(218,215,210,0.04); border: 1px solid var(--line, rgba(218,215,210,0.14)); }
  .mp-sc.you { border-color: rgba(255,31,46,0.4); }
  .mp-sc-who { font-family: 'JetBrains Mono', monospace; font-size: 11px; letter-spacing: 0.2em; color: #9c918e; }
  .mp-sc-score { font-family: 'Oxanium', sans-serif; font-weight: 800; font-size: 32px; color: var(--ink, #f3eceb); margin: 4px 0; }
  .mp-sc-meta { font-family: 'Chakra Petch', sans-serif; font-size: 12px; color: #9c918e; }
  .mp-sc-vs { align-self: center; font-family: 'Oxanium', sans-serif; font-weight: 800; color: #6f6663; font-size: 14px; }

  .mp-banner { margin-top: 14px; padding: 10px 14px; border-radius: 10px; font-family: 'Chakra Petch', sans-serif; font-size: 13px;
    background: rgba(255,122,74,0.1); border: 1px solid rgba(255,122,74,0.3); color: #ffb695; }
  .mp-close-x { position: absolute; top: 14px; right: 14px; width: 34px; height: 34px; border-radius: 50%; cursor: pointer;
    background: rgba(218,215,210,0.06); border: 1px solid var(--line, rgba(218,215,210,0.16)); color: #b9aeac; font-size: 16px; line-height: 1; }
  .mp-close-x:hover { color: #fff; border-color: var(--crimson, #ff1f2e); }

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
  #mp-opp.lead { border-color: rgba(255,31,46,0.55); }     /* opponent is ahead → crimson edge */
  #mp-opp .mo-delta { font-weight: 800; font-size: 13px; }
  #mp-opp .mo-delta.ahead { color: #2fd27a; }              /* YOU ahead */
  #mp-opp .mo-delta.behind { color: var(--crimson, #ff1f2e); }
  @media (max-width: 760px) { #mp-opp { width: 140px; top: 8px; right: 8px; padding: 9px 10px; } #mp-opp .mo-score { font-size: 20px; } }
  .rr-reduce-motion #mp-opp .mo-bar > span { transition: none; }
```

---

### 3E — `index.html`: header "Versus" icon (library top bar)

**ANCHOR (unique — the Store icon button, exists ~line 2087):**
```html
          <button class="icon-btn" id="store-open" aria-label="Store">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v1a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0V6l-3-4z"></path><path d="M4 9.5V20a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9.5"></path><path d="M9 21v-5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v5"></path></svg>
          </button>
```
**INSERT-AFTER** that button:

**DROP-IN CODE:**
```html
          <button class="icon-btn" id="mp-open" aria-label="Multiplayer versus" hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 7l-4 10"></path><circle cx="6.5" cy="8" r="2.5"></circle><circle cx="17.5" cy="16" r="2.5"></circle><path d="M9 8h3l1 3"></path><path d="M15 16h-3l-1-3"></path></svg>
          </button>
```
> Icon ships `hidden`; multiplayer.js un-hides it when `MP_PUBLIC` or `?dev`/`?mp` is set (mirrors how the
> Levels icon is gated). The icon's `id="mp-open"` is wired in multiplayer.js (not inline) — same pattern as
> `levels-open`/`store-open` (their handlers live in their IIFEs, lines 3556 / 3963).

---

### 3F — NEW FILE: `multiplayer.js`

Create at ROOT: `D:/.../cloudcode/v2/multiplayer.js`. Full module below (drop-in, self-contained). It
creates its own supabase client from `RHYTHM_CONFIG` (exactly like catalog.js does), so it has zero
dependency on internal catalog symbols.

```js
// ===========================================================================
// REACTIVE RHYTHM — Online Multiplayer (1v1) via Supabase Realtime
//   • Room codes (host CREATE / guest JOIN), presence + broadcast channel.
//   • Host locks song+difficulty → broadcast; ready check; synchronized start.
//   • Live opponent panel during play; winner screen at song end.
// Self-contained: own supabase client, own rAF tick, own DOM panel.
// Exposes window.RhythmMP. No edits to catalog.js / jukebox.js.
// ===========================================================================
(function () {
  var CFG = window.RHYTHM_CONFIG || {};
  var $ = function (id) { return document.getElementById(id); };
  var screen = $('multiplayer'); if (!screen) return;

  // ---- gating: show the header icon for dev/opt-in; ship dark by default ----
  var MP_PUBLIC = false;                       // flip true to expose to all users
  var qs = location.search;
  var SHOW = MP_PUBLIC || /[?&](dev|mp)=?1?(&|$)/.test(qs) || /[?&]dev(&|$)/.test(qs);
  var openBtn = $('mp-open');
  if (openBtn && SHOW) openBtn.hidden = false;

  // ---- supabase client (own instance; mirrors catalog.js config) ----
  var supa = null;
  try {
    if (window.supabase && CFG.SUPABASE_URL && CFG.SUPABASE_KEY) {
      supa = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY, {
        auth: { storage: window.localStorage, persistSession: true, autoRefreshToken: true },
      });
    }
  } catch (e) { /* offline / no realtime → MP simply won't connect */ }

  // ---- identity (read-only via catalog if present; else anon id) ----
  var ME = { id: 'p_' + Math.random().toString(36).slice(2, 9), name: 'Player' };
  (function resolveMe() {
    try {
      if (window.RhythmCatalog && window.RhythmCatalog.getUser) {
        window.RhythmCatalog.getUser().then(function (u) { if (u) { ME.id = u.id || ME.id; ME.name = u.name || ME.name; } }).catch(function () {});
      }
    } catch (e) {}
  })();

  // ---- state ----
  var ch = null;            // realtime channel
  var role = null;          // 'host' | 'guest'
  var code = null;          // room code
  var oppPresent = false, oppLeft = false;
  var sel = { trackId: null, title: null, artist: null, art: null, difficulty: 'medium', demo: false };
  var meReady = false, oppReady = false;
  var matchLive = false, finishedLocal = false;
  var myFinal = null, oppFinal = null;
  var lastOppTick = null;   // {score,combo,acc,prog,name}
  var oppPanel = null, oppRaf = 0;

  function genCode() {
    var A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no ambiguous 0/O/1/I
    var s = ''; for (var i = 0; i < 4; i++) s += A[Math.floor(Math.random() * A.length)];
    return s;
  }
  function chName(c) { return 'rr-mp-' + c; }

  // ---- step switching on the card ----
  function step(name) {
    var card = screen.querySelector('.mp-card'); if (card) card.setAttribute('data-mp-step', name);
    ['lobby', 'room', 'go', 'winner'].forEach(function (s) {
      var el = screen.querySelector('.mp-step-' + s); if (el) el.hidden = (s !== name);
    });
  }
  function banner(id, txt) { var el = $(id); if (!el) return; if (txt) { el.textContent = txt; el.hidden = false; } else { el.hidden = true; } }

  function open() { step('lobby'); banner('mp-lobby-msg', ''); screen.classList.add('active'); }
  function close() {
    teardown();
    screen.classList.remove('active');
  }

  // ---- channel lifecycle ----
  function joinChannel(c, asRole) {
    if (!supa) { banner('mp-lobby-msg', 'Multiplayer needs a connection — check your network and sign-in.'); return; }
    role = asRole; code = c;
    ch = supa.channel(chName(c), { config: { presence: { key: ME.id }, broadcast: { self: false } } });

    ch.on('presence', { event: 'sync' }, onPresenceSync);
    ch.on('presence', { event: 'leave' }, onPresenceLeave);
    ch.on('broadcast', { event: 'song' }, function (m) { onSong(m.payload); });
    ch.on('broadcast', { event: 'ready' }, function (m) { onReady(m.payload); });
    ch.on('broadcast', { event: 'start' }, function (m) { onStart(m.payload); });
    ch.on('broadcast', { event: 'tick' }, function (m) { onTick(m.payload); });
    ch.on('broadcast', { event: 'final' }, function (m) { onFinal(m.payload); });
    ch.on('broadcast', { event: 'rematch' }, function () { resetForRematch(); });

    ch.subscribe(function (status) {
      if (status === 'SUBSCRIBED') {
        ch.track({ id: ME.id, name: ME.name, role: role, at: Date.now() });
        enterRoom();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        banner(role === 'host' ? 'mp-room-msg' : 'mp-lobby-msg', 'Could not reach the realtime server. Try again.');
      }
    });
  }

  function enterRoom() {
    step('room');
    $('mp-codebox-v').textContent = code;
    $('mp-dot-opp').setAttribute('data-state', 'waiting');
    $('mp-dot-opp').textContent = 'WAITING…';
    var isHost = role === 'host';
    $('mp-pick').disabled = !isHost;
    $('mp-pick-chev').style.visibility = isHost ? '' : 'hidden';
    [].forEach.call($('mp-diff').children, function (b) { b.disabled = !isHost; });
    $('mp-readystate').textContent = isHost ? 'Pick a track, then hit READY.' : 'Waiting for host to pick a track…';
    refreshReadyEnabled();
  }

  function onPresenceSync() {
    var st = ch.presenceState();
    var ids = Object.keys(st);
    var others = ids.filter(function (k) { return k !== ME.id; });
    oppPresent = others.length > 0;
    var opp = oppPresent ? st[others[0]][0] : null;
    var dot = $('mp-dot-opp');
    if (dot) {
      if (oppPresent) { dot.setAttribute('data-state', 'here'); dot.textContent = (opp && opp.name) ? opp.name.slice(0, 12) : 'OPPONENT'; oppLeft = false; }
      else { dot.setAttribute('data-state', 'waiting'); dot.textContent = 'WAITING…'; }
    }
    // host re-broadcasts current selection so a late-joining guest catches up
    if (role === 'host' && oppPresent && sel.trackId) broadcastSong();
    refreshReadyEnabled();
  }
  function onPresenceLeave() {
    var st = ch ? ch.presenceState() : {};
    var others = Object.keys(st).filter(function (k) { return k !== ME.id; });
    if (others.length === 0) {
      oppPresent = false; oppLeft = true;
      var dot = $('mp-dot-opp'); if (dot) { dot.setAttribute('data-state', 'left'); dot.textContent = 'OPPONENT LEFT'; }
      if (matchLive) { markOppGone(); }            // they bailed mid-song → you auto-win at end
      else { oppReady = false; refreshReadyEnabled(); }
    }
  }

  // ---- song selection (host) ----
  function broadcastSong() {
    if (!ch) return;
    ch.send({ type: 'broadcast', event: 'song', payload: sel });
  }
  function onSong(payload) {
    if (!payload) return;
    sel = payload;
    paintSelection();
    // a (re)selection invalidates readiness
    meReady = false; oppReady = false; setReadyBtn(); refreshReadyEnabled();
    $('mp-readystate').textContent = role === 'host' ? 'Track locked. Hit READY.' : 'Host locked a track. Hit READY when set.';
  }
  function paintSelection() {
    $('mp-pick-t').textContent = sel.title || 'Host picks a track';
    $('mp-pick-a').textContent = sel.artist || '—';
    var art = $('mp-pick-art');
    if (sel.art) { art.style.backgroundImage = 'url("' + String(sel.art).replace(/["\\]/g, '') + '")'; art.textContent = ''; }
    else { art.style.backgroundImage = ''; art.textContent = '♪'; }
    [].forEach.call($('mp-diff').children, function (b) { b.classList.toggle('active', b.getAttribute('data-diff') === sel.difficulty); });
  }

  // ---- ready check ----
  function refreshReadyEnabled() {
    var ok = oppPresent && !!sel.trackId;
    $('mp-ready').disabled = !ok;
    if (!ok && !sel.trackId) $('mp-readystate').textContent = role === 'host' ? 'Pick a track to enable READY.' : 'Waiting for host to pick a track…';
    else if (!ok) $('mp-readystate').textContent = 'Waiting for an opponent to join…';
  }
  function setReadyBtn() {
    var b = $('mp-ready'); b.classList.toggle('armed', meReady); b.textContent = meReady ? 'READY ✓' : 'READY';
  }
  function toggleReady() {
    if ($('mp-ready').disabled) return;
    meReady = !meReady; setReadyBtn();
    ch.send({ type: 'broadcast', event: 'ready', payload: { ready: meReady, id: ME.id } });
    maybeStart();
  }
  function onReady(p) { oppReady = !!(p && p.ready); maybeStart(); }
  function maybeStart() {
    if (meReady && oppReady && sel.trackId) {
      // HOST is authoritative on the start timestamp (avoid double-start race)
      if (role === 'host') {
        var atMs = Date.now() + 1200;            // lead-in so both clients schedule together
        ch.send({ type: 'broadcast', event: 'start', payload: { atMs: atMs, sel: sel } });
        beginMatch(atMs, sel);
      }
    }
  }
  function onStart(p) { if (p && p.atMs) beginMatch(p.atMs, p.sel || sel); }

  // ---- synchronized match start ----
  function beginMatch(atMs, s) {
    sel = s || sel;
    matchLive = true; finishedLocal = false; myFinal = null; oppFinal = null; oppLeft = false;
    step('go'); $('mp-go-num').textContent = 'GET READY';
    // resolve the chart provider from RhythmCatalog by trackId
    var prov = resolveProvider(sel);
    if (!prov) { banner('mp-room-msg', 'Could not load that track. Pick another.'); matchLive = false; step('room'); return; }
    // register a one-shot song-end handler that reports our final + flips to winner flow
    window.RhythmGame.onSongEnd(onLocalSongEnd);
    // start engine synchronized; engine resumes audio + runs its own 3..1 countdown
    window.RhythmGame.startAt(prov, { atMs: atMs, difficulty: sel.difficulty });
    // close the overlay just before the game screen takes over, then mount panel + tick
    var delay = Math.max(0, atMs - Date.now());
    setTimeout(function () { screen.classList.remove('active'); mountOppPanel(); startTick(); }, delay + 40);
  }

  // resolve a provider fn from the selection using public RhythmGame entry points.
  function resolveProvider(s) {
    try {
      if (s.demo) return window.RhythmGame.__demoProvider ? window.RhythmGame.__demoProvider() : null;
      var RC = window.RhythmCatalog;
      var t = RC && RC.allTracks ? RC.allTracks().filter(function (x) { return x.id === s.trackId; })[0] : null;
      if (!t) return null;
      // mirror catalog.launchTrack's branch but return a provider for startAt:
      if (RC.liveProvider && t._serverChart) return RC.liveProvider(t.id);   // server chart path (if present)
      var url = t.audio_url || (t.audio && t.audio.url);
      if (url) return function () { return window.RhythmGame.__buffered ? window.RhythmGame.__buffered(url, { title: t.title, artist: t.artist_credit_name || t.artist_name, genre: t.genre, artwork: t.artwork_url }) : null; };
    } catch (e) {}
    return null;
  }

  // ---- live tick broadcast + opponent panel ----
  function mountOppPanel() {
    var game = $('game'); if (!game) return;
    if (!oppPanel) {
      oppPanel = document.createElement('div'); oppPanel.id = 'mp-opp';
      oppPanel.innerHTML =
        '<div class="mo-who"><span id="mo-name">OPPONENT</span><span class="mo-live" id="mo-live">LIVE</span></div>' +
        '<div class="mo-score" id="mo-score">0</div>' +
        '<div class="mo-row"><span id="mo-combo">0x</span><span class="mo-delta" id="mo-delta">—</span></div>' +
        '<div class="mo-bar"><span id="mo-bar"></span></div>';
    }
    var nm = oppPanel.querySelector('#mo-name'); if (nm) nm.textContent = (lastOppTick && lastOppTick.name) || ($('mp-dot-opp') && $('mp-dot-opp').textContent) || 'OPPONENT';
    game.appendChild(oppPanel);
  }
  function unmountOppPanel() { if (oppPanel && oppPanel.parentNode) oppPanel.parentNode.removeChild(oppPanel); }
  function markOppGone() { var l = oppPanel && oppPanel.querySelector('#mo-live'); if (l) { l.textContent = 'LEFT'; l.classList.add('gone'); } }

  var _lastSend = 0;
  function startTick() {
    stopTick();
    function frame() {
      oppRaf = requestAnimationFrame(frame);
      var now = performance.now();
      var s = window.RhythmGame.getLiveStats ? window.RhythmGame.getLiveStats() : null;
      // broadcast my state ~6/s
      if (s && ch && now - _lastSend > 160) {
        _lastSend = now;
        ch.send({ type: 'broadcast', event: 'tick', payload: { score: s.score, combo: s.combo, acc: s.acc, prog: s.progress, name: ME.name } });
      }
      // render opponent
      if (oppPanel && oppPanel.parentNode) renderOpp(s);
    }
    oppRaf = requestAnimationFrame(frame);
  }
  function stopTick() { if (oppRaf) cancelAnimationFrame(oppRaf); oppRaf = 0; }

  function renderOpp(myStats) {
    var o = lastOppTick;
    var sc = oppPanel.querySelector('#mo-score'), cb = oppPanel.querySelector('#mo-combo'),
        br = oppPanel.querySelector('#mo-bar'), dl = oppPanel.querySelector('#mo-delta');
    if (o) {
      sc.textContent = Number(o.score || 0).toLocaleString();
      cb.textContent = (o.combo || 0) + 'x';
      br.style.width = Math.round((o.prog || 0) * 100) + '%';
    }
    if (myStats && o) {
      var d = (myStats.score || 0) - (o.score || 0);
      dl.textContent = (d >= 0 ? '+' : '') + d.toLocaleString();
      dl.className = 'mo-delta ' + (d >= 0 ? 'ahead' : 'behind');
      oppPanel.classList.toggle('lead', d < 0);
    }
  }
  function onTick(p) { if (p) lastOppTick = p; }

  // ---- end of song → finals → winner ----
  function onLocalSongEnd(reason, results) {
    finishedLocal = true; stopTick();
    var s = (results) ? {
      score: results.score, combo: results.max_combo, acc: Math.round((results.accuracy || 0) * 1000) / 10, grade: results.grade
    } : (window.RhythmGame.getLiveStats ? window.RhythmGame.getLiveStats() : { score: 0, combo: 0, acc: 0, grade: 'D' });
    myFinal = s;
    if (ch) ch.send({ type: 'broadcast', event: 'final', payload: Object.assign({ name: ME.name }, s) });
    settleIfReady();
    // safety: if opponent never reports (or left), settle after 8s
    setTimeout(settleIfReady.bind(null, true), 8000);
  }
  function onFinal(p) { if (p) oppFinal = p; settleIfReady(); }
  function settleIfReady(force) {
    if (!matchLive) return;
    if (!finishedLocal) return;
    if (!oppFinal && !force && !oppLeft) return;     // wait for opponent unless forced/left
    matchLive = false;
    unmountOppPanel();
    showWinner();
  }

  function showWinner() {
    // results screen is currently active (engine showed it); raise the MP overlay over it
    var me = myFinal || { score: 0, acc: 0, combo: 0 };
    var op = oppFinal;
    $('mp-sc-you').textContent = Number(me.score || 0).toLocaleString();
    $('mp-sc-you-meta').textContent = (me.acc != null ? me.acc + '% · ' : '') + (me.combo || 0) + 'x' + (me.grade ? ' · ' + me.grade : '');
    $('mp-sc-opp-who').textContent = (op && op.name) ? op.name.slice(0, 14) : 'OPPONENT';
    if (op) {
      $('mp-sc-opp').textContent = Number(op.score || 0).toLocaleString();
      $('mp-sc-opp-meta').textContent = (op.acc != null ? op.acc + '% · ' : '') + (op.combo || 0) + 'x' + (op.grade ? ' · ' + op.grade : '');
    } else {
      $('mp-sc-opp').textContent = oppLeft ? '—' : '…';
      $('mp-sc-opp-meta').textContent = oppLeft ? 'left the match' : 'no result';
    }
    var v = $('mp-verdict'), win, draw = false;
    if (!op || oppLeft) win = true;
    else if (me.score > op.score) win = true;
    else if (me.score < op.score) win = false;
    else { draw = true; }
    v.className = 'mp-verdict ' + (draw ? 'draw' : win ? 'win' : 'lose');
    v.textContent = draw ? 'DRAW' : win ? 'YOU WIN' : 'YOU LOSE';
    step('winner');
    screen.classList.add('active');
  }

  function resetForRematch() {
    myFinal = null; oppFinal = null; lastOppTick = null; meReady = false; oppReady = false;
    finishedLocal = false; matchLive = false; setReadyBtn();
    step('room'); paintSelection(); refreshReadyEnabled();
    $('mp-readystate').textContent = 'Rematch — READY when set.';
  }

  function teardown() {
    stopTick(); unmountOppPanel();
    matchLive = false;
    try { if (ch) { ch.untrack(); supa.removeChannel(ch); } } catch (e) {}
    ch = null; role = null; code = null; oppPresent = false; oppReady = false; meReady = false;
    sel = { trackId: null, title: null, artist: null, art: null, difficulty: sel.difficulty || 'medium', demo: false };
  }

  // ===== WIRING =====
  if (openBtn) openBtn.addEventListener('click', open);
  $('mp-close').addEventListener('click', close);
  $('mp-create').addEventListener('click', function () { joinChannel(genCode(), 'host'); });
  $('mp-join').addEventListener('click', function () {
    var c = ($('mp-code-in').value || '').trim().toUpperCase();
    if (c.length !== 4) { banner('mp-lobby-msg', 'Enter the 4-character room code.'); return; }
    joinChannel(c, 'guest');
  });
  $('mp-code-in').addEventListener('input', function () { this.value = this.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4); });
  $('mp-ready').addEventListener('click', toggleReady);
  $('mp-leave-room').addEventListener('click', close);
  $('mp-leave-win').addEventListener('click', function () { close(); });
  $('mp-rematch').addEventListener('click', function () { if (ch) ch.send({ type: 'broadcast', event: 'rematch', payload: {} }); resetForRematch(); });

  // host: difficulty seg
  $('mp-diff').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b || role !== 'host') return;
    sel.difficulty = b.getAttribute('data-diff');
    [].forEach.call(this.children, function (x) { x.classList.toggle('active', x === b); });
    broadcastSong();
  });

  // host: open the inline track picker
  $('mp-pick').addEventListener('click', function () {
    if (role !== 'host') return;
    var p = $('mp-picker'); p.hidden = !p.hidden; if (!p.hidden) { renderPicker(''); $('mp-search').focus(); }
  });
  $('mp-search').addEventListener('input', function () { renderPicker(this.value); });
  function renderPicker(q) {
    var box = $('mp-results'); var RC = window.RhythmCatalog;
    var all = (RC && RC.allTracks) ? RC.allTracks() : [];
    q = (q || '').toLowerCase();
    var rows = all.filter(function (t) {
      if (!q) return true;
      return (t.title || '').toLowerCase().indexOf(q) >= 0 || (t.artist_name || t.artist_credit_name || '').toLowerCase().indexOf(q) >= 0;
    }).slice(0, 40);
    box.innerHTML = rows.map(function (t, i) {
      return '<div class="mp-result" data-i="' + i + '"><div><div class="r-t">' + esc(t.title || 'Untitled') + '</div><div class="r-a">' + esc(t.artist_credit_name || t.artist_name || '') + '</div></div></div>';
    }).join('') || '<div class="mp-result"><div class="r-a">No tracks found.</div></div>';
    [].forEach.call(box.querySelectorAll('.mp-result[data-i]'), function (el) {
      el.addEventListener('click', function () {
        var t = rows[+el.getAttribute('data-i')]; if (!t) return;
        sel.trackId = t.id; sel.title = t.title; sel.artist = t.artist_credit_name || t.artist_name; sel.art = t.artwork_url; sel.demo = false;
        $('mp-picker').hidden = true; paintSelection(); broadcastSong();
        meReady = false; oppReady = false; setReadyBtn(); refreshReadyEnabled();
        $('mp-readystate').textContent = 'Track locked. Hit READY.';
      });
    });
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }

  // Esc closes (matches #levels-screen pattern)
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && screen.classList.contains('active') && !matchLive) { e.stopImmediatePropagation(); close(); }
  }, true);
  screen.addEventListener('click', function (e) { if (e.target === screen && !matchLive) close(); });

  // public hook
  window.RhythmMP = { open: open, close: close, isLive: function () { return matchLive; } };
})();
```

> **Provider resolution caveat (see §4):** `resolveProvider` references `RhythmGame.__buffered` (a tiny new
> alias) so the module never has to import catalog internals. If you prefer NOT to add `__buffered`, replace
> the buffered branch with the simpler approach in §4 "Option B" which calls `RhythmCatalog.launchTrack(t)`
> directly and uses a pre-start delay instead of `startAt` (slightly looser sync; still fine for a versus bar).

---

### 3G — `index.html`: load the module + bump versions

**ANCHOR (unique, exists ~line 2992):**
```html
<script src="game.js?v=80"></script>
<script src="jukebox.js?v=80"></script>
<script src="catalog.js?v=80"></script>
```
**REPLACE WITH** (bump to v81 across the board per the cache-bust convention; add multiplayer.js LAST so
`RhythmGame` + `RhythmCatalog` already exist):
```html
<script src="game.js?v=81"></script>
<script src="jukebox.js?v=81"></script>
<script src="catalog.js?v=81"></script>
<script src="multiplayer.js?v=81"></script>
```
Also bump the CSS ref at line 14: `jukebox.css?v=80` → `jukebox.css?v=81`.

---

## 4) NEW PUBLIC HOOKS — and where they wire

| Hook (file) | Signature | Purpose | Consumed by |
|---|---|---|---|
| `RhythmGame.getLiveStats()` (game.js §3A) | `→ {score,combo,maxCombo,acc,progress,playing,grade}` | per-frame live read | multiplayer.js `startTick()` |
| `RhythmGame.onSongEnd(cb)` (game.js §3A) | `cb(reason, results)` fire-once | report final + cleanup | multiplayer.js `onLocalSongEnd` |
| `RhythmGame.startAt(prov,{atMs,difficulty})` (game.js §3A) | schedule synced launch | both clients start together | multiplayer.js `beginMatch` |
| `RhythmGame.mpProgress()` (game.js §3A) | alias of getLiveStats | misc reads | (optional) |
| `RhythmMP.open()/close()/isLive()` (multiplayer.js) | screen control | programmatic open | header icon / future menu |

**One more tiny game.js alias (recommended, low-risk)** so multiplayer.js can build a buffered provider
without touching catalog internals — add inside the same `Object.assign(window.RhythmGame, {...})` block in
§3A (it's a one-liner; `bufferedProvider` is already module-scope, used at line 3113):
```js
    __buffered: (url, meta) => bufferedProvider(url, meta),
```
**Option B (no `__buffered`):** if you'd rather not expose it, change `beginMatch` to: open nothing on the
provider, instead call `window.RhythmCatalog.launchTrack(t)` at the synced timestamp (resolve `t` from
`RhythmCatalog.allTracks()`), and drop `startAt` in favor of a plain `setTimeout(launch, atMs-Date.now())`.
Sync is then bounded by decode time only — acceptable, and zero catalog dependency. (`launchTrack` already
picks server-chart vs in-browser internally — lines 700-715.)

---

## 5) ASSETS — generation prompts

No raster assets are strictly required (the versus icon is inline SVG, panels are CSS). **Optional polish**
(only if the user wants art parity with Levels/Store cards):

1. **`assets/mp/versus-key.png`** — winner-screen hero (optional background behind `.mp-verdict`):
   > "Two crossed electric guitars forming an X, crimson #ff1f2e and ember #ff7a4a energy arcs between
   > them, dark warm charcoal #0a0706 background, chrome #dad7d2 metallic edge highlights, centered emblem,
   > transparent PNG, 1024x1024, high-contrast, no text, esports versus badge style, NO blue, NO purple."

2. **`assets/mp/win-burst.png`** — gold confetti/spark burst overlay for YOU WIN (optional):
   > "Radial burst of gold #e0a93f and chrome #dad7d2 sparks on transparent background, celebratory,
   > 1024x1024 PNG, warm tones only, no blue, no purple, centered, soft glow."

If used, drop them in a new `assets/mp/` folder and reference via the `.mp-verdict.win` rule's
`background-image`. Not needed for a functional ship.

---

## 6) OPPONENT PANEL — exact markup the module injects (reference)

multiplayer.js appends this into `#game` on match start (see `mountOppPanel`); styled by the `#mp-opp`
rules in §3D. Shown here so the integrator can eyeball it:
```html
<div id="mp-opp">
  <div class="mo-who"><span id="mo-name">OPPONENT</span><span class="mo-live" id="mo-live">LIVE</span></div>
  <div class="mo-score" id="mo-score">0</div>
  <div class="mo-row"><span id="mo-combo">0x</span><span class="mo-delta" id="mo-delta">—</span></div>
  <div class="mo-bar"><span id="mo-bar"></span></div>
</div>
```

---

## 7) LOVABLE BACKEND BRIEF (copy-paste) — only what truly needs the server

> **The core 1v1 (room codes, live opponent, winner) is 100% client-side via Supabase Realtime broadcast +
> presence and needs NO backend work** — the anon key already authorizes ephemeral broadcast/presence
> channels. The items below are **optional enhancements**; ship without them.

```
SUBJECT: Reactive Rhythm — Multiplayer (Realtime) backend notes

CONTEXT: /play now has 1v1 online multiplayer using Supabase Realtime BROADCAST + PRESENCE
channels (channel name pattern: rr-mp-<4CHAR-CODE>). The browser creates a supabase-js client
with the existing publishable anon key. Players sync score/combo over broadcast; no DB writes
for the core loop.

PLEASE CONFIRM / DO:

1) REALTIME ENABLED (required if not already):
   - In Supabase Dashboard → Project → Realtime, ensure Realtime is ON for the project.
   - We use BROADCAST + PRESENCE only (NOT postgres_changes), so NO table replication is needed.

2) REALTIME AUTHORIZATION (only if you've enabled the new "Realtime Authorization"/RLS-on-channels):
   - If channel RLS is OFF (default): nothing to do — anon broadcast/presence works.
   - If channel RLS is ON: add a permissive policy for our namespace so anon clients can
     read+write broadcast/presence on channels named like 'rr-mp-%'. Example policy on
     realtime.messages:
       CREATE POLICY "rr_mp_anon_broadcast" ON realtime.messages
         FOR SELECT USING ( realtime.topic() LIKE 'rr-mp-%' );
       CREATE POLICY "rr_mp_anon_write" ON realtime.messages
         FOR INSERT WITH CHECK ( realtime.topic() LIKE 'rr-mp-%' );
     (Adjust to your exact authorization setup; goal: anon can use rr-mp-* channels.)

3) (OPTIONAL) RANDOM MATCHMAKING — "Quick Match" without a code:
   - Add a tiny edge function GET /mp/quickmatch that returns an open room code or mints a new one
     (a Redis/KV or a 'mp_rooms(code, status, created_at)' table with a 60s TTL works). Client then
     joins channel rr-mp-<code> exactly as today. Return: { code, role:'host'|'guest' }.

4) (OPTIONAL) PERSIST MATCH RESULTS to the campaign leaderboard:
   - Add POST /mp/result { room, opponent_id, my_score, opp_score, won:boolean, track_id, difficulty }.
     Store in 'mp_matches' for a versus W/L record + a "Versus" leaderboard tab. Auth: Bearer user JWT
     (reuse the same auth as POST /plays). Purely additive — the game already shows the winner locally.

NOT NEEDED: no websocket server, no game-state authority server, no per-frame DB writes.
```

---

## 8) VERIFY OFFLINE (greps + structural checks)

Run from ROOT. (Page can't boot headless — CDN scripts block the parser — so verify structurally.)

```
# A) engine hooks landed in game.js
grep -n "getLiveStats\|onSongEnd\|RhythmGame.startAt\|_fireSongEnd" game.js
#   expect: 4 hook defs + _fireSongEnd wired into endGame() and the exit-btn handler

node --check game.js          # MUST pass after the §3A edits
node --check multiplayer.js   # MUST pass for the new file

# B) the #multiplayer screen + steps exist in index.html
grep -n 'id="multiplayer"\|mp-step-lobby\|mp-step-room\|mp-step-winner\|id="mp-open"\|id="mp-create"\|id="mp-join"\|id="mp-ready"' index.html

# C) CSS + script wiring
grep -n '.mp-screen\|#mp-opp' index.html          # CSS block present
grep -n 'multiplayer.js?v=81' index.html          # module loaded LAST
grep -n 'game.js?v=81\|catalog.js?v=81\|jukebox.css?v=81' index.html   # versions bumped

# D) collision sanity — confirm no existing id clashes with new ids
grep -n 'id="mp-' index.html | sort   # all mp-* ids should be unique (no dupes)
```

**Structural checks (manual read):**
- `#multiplayer` is a sibling of `#store-screen` (both direct children of `<body>`, NOT inside `#menu`),
  so its `classList.add('active')` overlay behaves like the other overlays (z-index 262 > the 261 group).
- multiplayer.js runs after game.js + catalog.js (script order in §3G) → `window.RhythmGame.getLiveStats`,
  `RhythmCatalog.allTracks` exist when its handlers fire. (All access is also guarded with `try/catch` and
  existence checks, so a missing dep degrades gracefully — the icon just won't connect.)

---

## 9) RISKS & COLLISIONS

- **Two supabase clients** (catalog.js's `supa` + multiplayer.js's own). supabase-js tolerates multiple
  clients; both use the same default `storageKey`, so they SHARE the auth session (intended — MP shows the
  signed-in name). No realtime conflict (different channels). Low risk.
- **Start-sync precision**: judgment is 100% local (each client times its own audio), so a small offset
  between the two songs only affects the *comparative* feel, not fairness. The 1200 ms lead-in + `startAt`
  delay scheduling keeps them within ~1 RTT + decode jitter. If the user wants tighter, add an NTP-style
  offset exchange (host echoes `Date.now()`, guest computes clock skew) — noted as a future tweak, not
  required for ship.
- **In-browser charting determinism**: both clients run `analyzeBeats` on the SAME `audio_url`, which is
  deterministic per input → identical charts. (Server-chart path is trivially identical.) Verified the
  branch logic in `launchTrack`/`resolveProvider` matches.
- **`screen.classList.remove('active')` during PLAYING**: `beginMatch` removes the MP overlay AFTER the
  synced delay; the engine's `showScreen('game')` (inside `play→beginPlay`) makes `#game` active. Both can
  briefly be active during the cross-fade — harmless (game-screen z-index covers; MP fades). If the
  integrator sees a flash, move the `screen.classList.remove('active')` to fire in the same frame as
  `play()` is invoked.
- **`__buffered` alias**: adds one line to game.js. If the team forbids new `__`-prefixed seams pre-launch,
  use Option B (§4) — zero engine surface beyond the 3 documented hooks. Either way these are dev-grade
  seams; list them in the "DEV HOOKS TO STRIP" section of CLAUDE.md if MP ships behind a flag.
- **Esc/back during a live match** is intentionally disabled (`!matchLive` guards) so a player can't
  accidentally nuke the room mid-song; they leave via in-game pause→EXIT, which fires `onSongEnd('exit')`
  → MP reports a final (current stats) and tears down cleanly.
- **No new dependency on jukebox.js / catalog.js source** — both stay byte-identical; MP only calls their
  public `window.*` API. Lowest possible collision footprint for a serial-merge codebase.
```
