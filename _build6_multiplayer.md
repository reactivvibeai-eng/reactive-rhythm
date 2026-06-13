# BUILD PACKAGE 6 — Online OPEN-LOBBY Multiplayer (presence) + Host badge + User leaderboards

> Concern: **Online multiplayer with an OPEN LOBBY** (supersedes the room-code design in `_build4_multiplayer.md`).
> Flow: click **MULTIPLAYER** → a **LOBBY** screen listing **everyone online** (Supabase Realtime **PRESENCE**
> on one shared channel) → each player shows in a roster; the lobby **CREATOR/host** wears a **HOST BADGE** →
> any player can **CHALLENGE** anyone → on accept both lock the **same song+difficulty** (host picks, broadcast),
> sync a **start timestamp**, run the same chart, and **broadcast live state** (score/combo/acc/progress) a few
> times/sec while **rendering the opponent SIDE-BY-SIDE** → **WINNER** screen at the end.
> ALSO: wire the **existing leaderboard** to show real ranked **users** when accounts connect (it already
> degrades to local — this package adds a *guest standing* line + a small refresh-on-auth nicety).
>
> Transport: **Supabase Realtime** (presence + broadcast). NO custom websocket server for the core loop.
> supabase-js v2 is loaded as a CDN `<script>` (index.html line 3029); `window.RHYTHM_CONFIG` (index.html
> lines 2919-2925) has the live `SUPABASE_URL` + `SUPABASE_KEY` (anon).
> Apply by **searching for each anchor string** below (all copied from the REAL v84 files at ROOT), then
> insert/replace exactly as marked. The integrator merges this serially and runtime-tests in the preview.

---

## 0) WHAT I VERIFIED IN THE REAL FILES (so anchors are current — v84, not build4's v80)

- `index.html` `?v=` is **v84** (lines 14, 3031-3033). There is **no** `multiplayer.js` yet — build4 was
  never integrated, so this package is the first MP integration. (Bump to **v85**.)
- `RHYTHM_CONFIG` lives at index.html **2919-2925**: `SUPABASE_URL`, `SUPABASE_KEY` (anon). supabase-js UMD
  loaded at **3029**; `window.supabase.createClient(...)` is the constructor (catalog.js line 25 uses it).
- Header icon row (index.html **2110-2121**): `#profile-open`, `#levels-open`, `#leaderboard-open`, `#store-open`.
  We add `#mp-open` after `#store-open` (2119-2121).
- **A full `#leaderboard-screen` already exists** (markup 2412-2448; IIFE 3676-3845) and **already calls**
  `RhythmCatalog.fetchGlobalLeaderboard` / `fetchLeaderboard` with a **local fallback** (`getCareer`/`getBest`)
  and a "Live rankings switch on when accounts connect" banner. So **user leaderboards are 90% wired already**;
  §3H is a *small* additive enhancement, NOT a rebuild.
- catalog.js public API (line 869-888) already exposes `getUser`, `onAuthChange`, `allTracks`, `trackReady`,
  `launchTrack`, `liveProvider`, `fetchGlobalLeaderboard`, `fetchLeaderboard`, `getCareer`, `getBest`,
  `recordLocal`. `launchTrack(track)` (700-715) picks server-chart vs in-browser vs demo internally.
- game.js engine surface: `Object.assign(window.RhythmGame, {...})` at **3116-3128**; the closing `});` is line
  **3128**. `playUrl`/`playDemo`/`play` at 3117-3119. `setDifficulty`/`getDifficulty` at 3120-3121.
  `__demoProvider` **already exists** (line 941). `lastResults()` **already exists** (line 940). `endGame()` at
  **1080**; exit-btn handler at **1218**. Module-scope identifiers used by `getLiveStats` all confirmed:
  `notes` (81), `counts` (171), `score`/`combo`/`maxCombo` (157), `songDuration` (82), `player` (79),
  `songTime()` (1449), `state` (84), `getAC` (408). State string for live play is `'playing'`.
- **CRITICAL — `showScreen()` is EXCLUSIVE (game.js 186-197):** when a non-overlay screen activates it strips
  `.active` from **every** other `.screen` (line 195), *and* `state = name==='game' ? 'playing' : name`.
  Consequences this package depends on:
    1. When the engine enters `game`, it auto-removes `.active` from `#multiplayer` → **no overlay flash** (the
       build4 "cross-fade race" risk is gone; we do NOT need to manually remove the overlay before play).
    2. When the engine shows `results`, it again strips `#multiplayer` → so the **WINNER step must re-add
       `.active` AFTER results renders** (our song-end callback fires inside `endGame()` which calls
       `showScreen('results')` first, then our final/settle path re-opens the overlay — order is safe).
- `.set-seg` button styling exists (index.html 2297-2299) → the MP difficulty segment reuses it.
- reduced-motion class is **`html.rr-reduce-motion`** (index.html 36-37). Honor it in MP CSS.
- No existing `mp-` id / `RhythmMP` symbol anywhere → **zero collision** for all `mp-*` ids and `window.RhythmMP`.

---

## 1) SUMMARY + WHAT STAYS BYTE-IDENTICAL

**What this adds**
- A new `#multiplayer` overlay screen (`.screen` toggled via `classList.add('active')`, same pattern as
  `#levels-screen`/`#store-screen`/`#leaderboard-screen`) with **4 steps**: **LOBBY** (live online roster +
  host badge + challenge), **MATCH-SETUP** (host picks song+difficulty, both READY), **GO** (sync), **WINNER**.
- A new external module **`multiplayer.js`** (the only new JS file) owning: its own supabase client, a shared
  **lobby presence channel** (`rr-lobby`), a per-match **broadcast+presence channel** (`rr-match-<id>`), the
  challenge handshake, state sync, the in-game **opponent panel**, and the winner screen. Exposes `window.RhythmMP`.
- One CSS block appended to the single `<style>` in index.html (lobby roster + match panel + opponent panel).
- **Small additive engine hooks** in `game.js`: `RhythmGame.getLiveStats()`, `RhythmGame.onSongEnd(cb)`,
  `RhythmGame.startAt(prov,{atMs,difficulty})`. All additive — no existing call path changes.
- A **tiny** leaderboard enhancement (§3H): a guest "your standing" line is already present; we add a one-line
  `onAuthChange` re-render hook so the board flips to live ranks the moment the user signs in (no rebuild).

**What stays byte-identical (do NOT touch)**
- `catalog.js`, `jukebox.js`, `jukebox.css` — **unchanged**. MP reads `RhythmCatalog.allTracks`/`trackReady`/
  `launchTrack`/`getUser`/`getBest` read-only; it never modifies them.
- The existing `showScreen()` in game.js — **unchanged**. The MP screen is an overlay, never in the `screens{}` map.
- `play()`, `beginPlay()`, `runCountdown()`, `loop()`, scoring, `endGame()` body — **unchanged** except two
  one-line `_fireSongEnd()` insertions (§3A). New hooks live next to the existing `Object.assign` block.
- **Standard 6-string + GH 5-string gameplay/scoring/timing stay byte-identical.** MP starts a normal run via
  the *same* `play(provider)` path the campaign/jukebox use; the only addition is *when* it kicks off (a
  scheduled `setTimeout`) and an *out-of-engine* read-only opponent panel. No note/judge/timing code changes.
- Brand tokens, fonts, supernova intro, beta gate, error guard, leaderboard core — untouched.

**Design budget honored**: black · crimson `#ff1f2e` · ember `#ff7a4a` · gold `#e0a93f` · chrome `#dad7d2`;
warm darks (R≥G≥B); **NO blue/purple** in core UI; fonts Oxanium (numbers/HUD) / Chakra Petch (labels) /
Unbounded (headers) / JetBrains Mono (pre-titles/mono). Card layout matches `.levels-card`/`.store-card`/
`.lbd-card`. The HOST BADGE uses **gold**; YOU = crimson; opponent-ahead edge = crimson.

**Realtime auth note (anon key)**: Supabase Realtime accepts the anon JWT for `broadcast` + `presence`
channels by default (no Realtime-RLS policy is required for ephemeral broadcast/presence — only for
postgres_changes streams). The client is created with the anon key exactly like catalog.js (line 25). Channel
names are namespaced `rr-lobby` (the single open lobby) and `rr-match-<8char>` (per duel). If the project has
flipped on the newer "Realtime Authorization" (RLS-on-channels), the Lovable brief in §6 covers the one policy.

---

## 2) INFORMATION ARCHITECTURE / FLOW

```
#start ("TAP TO BEGIN")
  └─► #menu (library) ── header icon row ──► [new "Versus" icon #mp-open]
                                                     │ click
                                                     ▼
                                          #multiplayer (overlay .screen)
 ┌─────────────────────────────────────────────────────────────────────────────────────┐
 │ STEP LOBBY (default on open):                                                          │
 │   • on open → join PRESENCE channel `rr-lobby`, channel.track({id,name,host,at})       │
 │   • YOU are flagged host=true if you are the EARLIEST `at` in the lobby (first in →     │
 │     wears the HOST BADGE; deterministic, no server needed). Recomputed on every sync.   │
 │   • roster list (presenceState()): each player row = avatar/initial · name · [HOST]?    │
 │     · [CHALLENGE] button (hidden on your own row + on a player already in a match).      │
 │   • incoming challenge → an inline accept/decline prompt on the challenger's row.        │
 │ STEP MATCH-SETUP (both accepted; on a private `rr-match-<id>` channel):                  │
 │   • presence shows YOU vs OPPONENT; the CHALLENGER is the match host (picks song).       │
 │   • HOST: [Pick a track] (searchable mini-list from RhythmCatalog.allTracks) +          │
 │           difficulty seg (Drift/Pulse/Fracture = easy/med/hard) → broadcast 'song'.      │
 │   • GUEST: sees locked song + difficulty (read-only).                                    │
 │   • both: [READY] toggle → broadcast 'ready'.                                            │
 │ STEP GO: when BOTH ready → HOST broadcasts 'start' {atMs, sel}; both call                │
 │     RhythmGame.startAt(provider,{atMs,difficulty}) at the shared timestamp.              │
 │     → engine runs its own 3..1 countdown; showScreen('game') auto-closes this overlay.   │
 │ STEP PLAYING (in #game): each client broadcasts 'tick' {score,combo,acc,prog} ~6/s;     │
 │     renders the opponent in the in-game opponent panel (#mp-opp, self-mounted).          │
 │ STEP END: local song end → broadcast 'final'; when both finals in (or 8s timeout /       │
 │     opponent left) → re-open #multiplayer at WINNER.                                     │
 │ STEP WINNER: YOU WIN / YOU LOSE / DRAW + side-by-side scorecard.                         │
 │     [REMATCH] (same opponent, back to MATCH-SETUP)  ·  [BACK TO LOBBY]  ·  [LEAVE]       │
 └─────────────────────────────────────────────────────────────────────────────────────┘
```

**Why "earliest `at` = host" (open-lobby host badge):** the user's spec says "the lobby CREATOR/host shows a
special HOST BADGE." With an open presence lobby there's no explicit room creator, so the host is the player
who has been in the lobby longest (smallest `at` timestamp, tie-broken by id). This is computed client-side
from `presenceState()` on every `sync` — fully deterministic, no backend, and it naturally re-elects when the
host leaves. (Inside a *match*, the **challenger** is the match host who picks the song — separate role.)

**Back-nav / exits**
- Esc or the ✕/LEAVE button on `#multiplayer` (when NOT mid-match) → `leaveAll()` (untrack presence,
  `removeChannel` both channels, screen loses `active`). Mirrors the `#leaderboard-screen` Esc handler (3842).
- **Opponent disconnect**: match-channel presence `leave` → opponent panel shows "LEFT"; if mid-PLAYING, your
  run continues solo and you auto-win at song end. Lobby presence `leave` → that row disappears + host re-elects.
- Esc/overlay-click is **disabled while `matchLive`** (a guard) so you can't nuke a duel mid-song; you exit via
  the existing in-game pause → EXIT, which fires `onSongEnd('exit')` → MP reports your current stats and settles.

**Gating**: mirror the campaign gate (index.html 3430-3437). The `#mp-open` icon ships `hidden`; multiplayer.js
un-hides it when `MP_PUBLIC===true` OR `rr_dev` localStorage is set OR `?dev=1`/`?mp=1` in the URL. The screen
works regardless; the flag only controls icon visibility (ship-dark like Levels' `CAMPAIGN_PUBLIC`).

---

## 3) EXACT INTEGRATION STEPS

> Order: 3A (engine hooks) → 3B (HTML screen) → 3C (CSS) → 3D (header icon) → 3E (new multiplayer.js) →
> 3F (script tag + ?v bump) → 3G (verify) → 3H (optional leaderboard polish).

---

### 3A — `game.js`: add public hooks (additive)

**ANCHOR (unique — the closing of the `Object.assign(window.RhythmGame,{...})` block, game.js 3127-3128):**
```js
    getInputStatus: () => ({ midi: midiInputs.slice(), gamepads: gamepadList(), midiSupported: !!navigator.requestMIDIAccess }),
  });
```
**INSERT-AFTER** that exact `});`:

**DROP-IN CODE:**
```js
  // ===========================================================================
  // MULTIPLAYER ENGINE SEAMS (additive; default-inert if multiplayer.js absent).
  //   getLiveStats() — read the live run state each frame (opponent sync source)
  //   onSongEnd(cb)  — fire-once-per-run callback at natural end / fail / exit
  //   startAt(prov,{atMs,difficulty}) — synchronized launch at a shared wall clock
  // No new globals: all reads are existing module-scope identifiers.
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
```

**Then wire `_fireSongEnd` into the two existing end paths (surgical replaces):**

**ANCHOR 1 (game.js 1080-1082, `endGame` head):**
```js
  async function endGame() {
    stopGame();
    const total = notes.length;
```
**REPLACE WITH:**
```js
  async function endGame() {
    stopGame();
    const total = notes.length;
    // (note) _fireSongEnd is called at the END of endGame, after results render, so the
    // MP final report carries the finished results object. See the insert below.
```
> Rationale: we must fire **after** `_lastResults` is set + `showScreen('results')` runs (so the WINNER overlay
> re-opens on top of results and the final payload includes the real grade/accuracy). Do the actual fire at the
> tail of `endGame`, see ANCHOR 1b.

**ANCHOR 1b (game.js ~1103, the line that stores `_lastResults` inside `endGame`):**
```js
    _lastResults = results;   // expose for the Levels results-loop (NEXT/RETRY + per-level stars)
```
**REPLACE WITH:**
```js
    _lastResults = results;   // expose for the Levels results-loop (NEXT/RETRY + per-level stars)
    try { _fireSongEnd('end'); } catch (e) {}   // MP: report final after results object is ready
```

**ANCHOR 2 (game.js 1218, EXIT button handler):**
```js
  $('exit-btn').addEventListener('click', () => { hidePause(); stopGame(); showScreen('menu'); });
```
**REPLACE WITH:**
```js
  $('exit-btn').addEventListener('click', () => { hidePause(); stopGame(); try { _fireSongEnd('exit'); } catch (e) {} showScreen('menu'); });
```

> All identifiers referenced (`notes`,`counts`,`score`,`combo`,`maxCombo`,`songDuration`,`player`,`songTime`,
> `state`,`getAC`,`play`,`setDifficulty`,`lastResults`) are verified present in v84 game.js (see §0). `__demoProvider`
> already exists at line 941 — multiplayer.js reuses it for the bundled demo fallback. No `__buffered` alias is
> needed because MP resolves the provider via the public `RhythmGame.playUrl`/`playDemo` *path semantics* by
> calling `RhythmCatalog.launchTrack` indirectly — see §3E `resolveAndStart` (Option B from build4, chosen here
> to keep the engine surface to exactly the 3 documented hooks).

---

### 3B — `index.html`: the `#multiplayer` overlay screen

**ANCHOR (unique — the closing of the STORE screen, index.html 2473-2475):**
```html
      <button class="ghost-btn primary" id="store-close" style="margin-top:18px;min-width:200px;">DONE</button>
    </div>
  </div>
```
**INSERT-AFTER** that exact `</div></div>` (it closes `#store-screen`):

**DROP-IN CODE:**
```html
  <!-- ============================================================
       MULTIPLAYER — online OPEN LOBBY (Supabase Realtime presence).
       Self-owned overlay (.screen toggled via classList 'active'),
       driven by multiplayer.js (window.RhythmMP). Steps switch via
       data-mp-step; only one .mp-step block shows at a time.
       ============================================================ -->
  <div class="screen mp-screen" id="multiplayer">
    <div class="mp-card" data-mp-step="lobby">
      <div class="pre-title" style="font-family:'JetBrains Mono';font-size:12px;letter-spacing:0.4em;color:var(--crimson);">// VERSUS · LIVE LOBBY</div>
      <h2 class="mp-title">MULTIPLAYER</h2>

      <!-- STEP: LOBBY (everyone currently online) -->
      <div class="mp-step mp-step-lobby">
        <p class="mp-sub">Everyone online is below. Challenge anyone to a live head-to-head on the same track.</p>
        <div class="mp-youbar" id="mp-youbar">
          <span class="mp-you-av" id="mp-you-av">?</span>
          <span class="mp-you-name" id="mp-you-name">You</span>
          <span class="mp-badge host" id="mp-you-host" hidden>HOST</span>
          <span class="mp-you-tag">that's you</span>
        </div>
        <div class="mp-rosterhead"><span id="mp-roster-count">0 online</span><span class="mp-live-dot">● LIVE</span></div>
        <div class="mp-roster" id="mp-roster"></div>
        <p class="mp-roster-empty" id="mp-roster-empty" hidden>No one else is online right now. Keep this open — challengers appear here live.</p>
        <div class="mp-banner" id="mp-lobby-msg" hidden></div>
      </div>

      <!-- STEP: MATCH-SETUP (lock song, ready check) -->
      <div class="mp-step mp-step-setup" hidden>
        <div class="mp-vsbar">
          <span class="mp-dot you" id="mp-dot-you">YOU</span>
          <span class="mp-vs">VS</span>
          <span class="mp-dot opp" id="mp-dot-opp" data-state="waiting">WAITING…</span>
        </div>
        <div class="mp-songpick" id="mp-songpick">
          <div class="mp-pick-head">TRACK</div>
          <button class="mp-pick" id="mp-pick" aria-label="Choose a track">
            <span class="mp-pick-art" id="mp-pick-art">♪</span>
            <span class="mp-pick-txt"><span class="mp-pick-t" id="mp-pick-t">Host picks a track</span><span class="mp-pick-a" id="mp-pick-a">—</span></span>
            <span class="mp-pick-chev" id="mp-pick-chev">›</span>
          </button>
          <div class="mp-diff set-seg" id="mp-diff">
            <button data-diff="easy">Drift</button>
            <button data-diff="medium" class="active">Pulse</button>
            <button data-diff="hard">Fracture</button>
          </div>
          <div class="mp-picker" id="mp-picker" hidden>
            <input class="mp-search" id="mp-search" type="text" placeholder="Search a track…" autocomplete="off" spellcheck="false" />
            <div class="mp-results" id="mp-results"></div>
          </div>
        </div>
        <div class="mp-readyrow">
          <button class="ghost-btn primary mp-ready" id="mp-ready" disabled>READY</button>
          <div class="mp-readystate" id="mp-readystate">Host: pick a track to begin.</div>
        </div>
        <button class="ghost-btn" id="mp-leave-setup" style="margin-top:14px;">BACK TO LOBBY</button>
        <div class="mp-banner" id="mp-setup-msg" hidden></div>
      </div>

      <!-- STEP: GO (both ready → syncing) -->
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
        <div class="pause-actions" style="margin-top:18px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
          <button class="ghost-btn" id="mp-rematch">REMATCH</button>
          <button class="ghost-btn" id="mp-backlobby">BACK TO LOBBY</button>
          <button class="ghost-btn primary" id="mp-leave-win">LEAVE</button>
        </div>
      </div>

      <button class="mp-close-x" id="mp-close" aria-label="Close multiplayer">✕</button>
    </div>
  </div>
```

---

### 3C — `index.html`: CSS (append into the single `<style>`)

**ANCHOR (unique — the store-screen base rule, index.html 655). NOTE: the real line is longer than build4's
(it now includes a `store-bg.jpg` background). Match the START of the line — it is the only `.store-screen {`
selector. Find this exact prefix:**
```css
  .store-screen { z-index: 261; background: linear-gradient(rgba(10,7,9,0.50), rgba(10,7,9,0.80)), url('assets/store/store-bg.jpg') center/cover no-repeat fixed,
```
(the line continues with the radial-gradient + `#0a0706; backdrop-filter: blur(18px); overflow-y: auto; }`)

**INSERT-AFTER** that full `.store-screen { … }` line:

**DROP-IN CODE:**
```css
  /* ===== MULTIPLAYER (versus) — open-lobby overlay + in-game opponent panel ===== */
  .mp-screen { z-index: 262; background: radial-gradient(ellipse at 50% 28%, rgba(120,12,20,0.55), transparent 64%), #0a0706; backdrop-filter: blur(18px); overflow-y: auto; }
  .screen.active .mp-card { animation: cardIn 0.42s cubic-bezier(.2,1,.3,1) both; }
  html.rr-reduce-motion .screen.active .mp-card { animation: none; }
  .mp-card { position: relative; width: min(580px, 94vw); margin: auto; padding: 30px 26px 26px; border-radius: 22px;
    background: linear-gradient(180deg, rgba(24,12,12,0.96), rgba(10,7,6,0.97)); border: 1px solid rgba(255,31,46,0.28);
    box-shadow: 0 24px 80px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(218,215,210,0.04); text-align: center; }
  .mp-title { font-family: 'Unbounded', sans-serif; font-size: clamp(28px, 6vw, 44px); margin: 8px 0 12px; color: var(--ink, #f3eceb); letter-spacing: 0.02em; }
  .mp-sub { font-family: 'Chakra Petch', sans-serif; color: #b9aeac; font-size: 14px; line-height: 1.5; margin: 0 auto 16px; max-width: 440px; }
  .mp-step { display: block; }
  .mp-step[hidden] { display: none; }

  /* lobby: you-bar + roster */
  .mp-youbar { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-radius: 14px; text-align: left;
    background: linear-gradient(180deg, rgba(255,31,46,0.14), rgba(255,31,46,0.05)); border: 1px solid rgba(255,31,46,0.34); margin-bottom: 14px; }
  .mp-you-av, .mp-r-av { width: 38px; height: 38px; flex: 0 0 auto; border-radius: 50%; display: grid; place-items: center;
    font-family: 'Oxanium', sans-serif; font-weight: 800; font-size: 16px; color: #0a0706; background: var(--chrome, #dad7d2); background-size: cover; background-position: center; overflow: hidden; }
  .mp-you-name, .mp-r-name { font-family: 'Oxanium', sans-serif; font-weight: 700; font-size: 16px; color: var(--ink, #f3eceb); }
  .mp-you-tag { margin-left: auto; font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.18em; color: #9c918e; }
  .mp-badge { font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.16em; padding: 3px 8px; border-radius: 999px; }
  .mp-badge.host { color: #0a0706; background: linear-gradient(180deg, #f0c25a, #d39a2c); border: 1px solid rgba(224,169,63,0.6); box-shadow: 0 0 14px rgba(224,169,63,0.4); }
  .mp-rosterhead { display: flex; justify-content: space-between; align-items: center; font-family: 'JetBrains Mono', monospace; font-size: 11px; letter-spacing: 0.16em; color: #9c918e; margin: 4px 2px 8px; }
  .mp-live-dot { color: #ff7a4a; }
  .mp-roster { display: flex; flex-direction: column; gap: 8px; max-height: 320px; overflow-y: auto; text-align: left; }
  .mp-row { display: flex; align-items: center; gap: 12px; padding: 9px 12px; border-radius: 12px;
    background: rgba(218,215,210,0.05); border: 1px solid var(--line, rgba(218,215,210,0.14)); }
  .mp-row .mp-r-meta { display: flex; flex-direction: column; min-width: 0; flex: 1; }
  .mp-row .mp-r-sub { font-family: 'Chakra Petch', sans-serif; font-size: 11px; color: #9c918e; }
  .mp-challenge { margin-left: auto; flex: 0 0 auto; padding: 7px 14px; border-radius: 10px; cursor: pointer;
    font-family: 'Oxanium', sans-serif; font-weight: 800; font-size: 12px; letter-spacing: 0.06em; color: #fff;
    background: linear-gradient(180deg, #ff2a38, #b3121f); border: 1px solid rgba(255,31,46,0.5); transition: transform .12s ease, box-shadow .12s ease; }
  .mp-challenge:hover { transform: translateY(-1px); box-shadow: 0 8px 22px rgba(255,31,46,0.4); }
  .mp-challenge[disabled] { opacity: 0.5; cursor: default; background: rgba(218,215,210,0.08); color: #9c918e; border-color: var(--line, rgba(218,215,210,0.14)); }
  .mp-row.incoming { border-color: rgba(224,169,63,0.5); background: rgba(224,169,63,0.08); }
  .mp-row .mp-acc { padding: 6px 12px; border-radius: 9px; font-family: 'Oxanium', sans-serif; font-weight: 800; font-size: 12px; cursor: pointer; color: #0a0706; background: var(--gold, #e0a93f); border: none; }
  .mp-row .mp-dec { padding: 6px 10px; border-radius: 9px; font-family: 'Oxanium', sans-serif; font-size: 12px; cursor: pointer; color: #b9aeac; background: transparent; border: 1px solid var(--line, rgba(218,215,210,0.18)); margin-left: 6px; }
  .mp-roster-empty { font-family: 'Chakra Petch', sans-serif; color: #8d8380; font-size: 13px; padding: 18px 8px; }

  /* match-setup */
  .mp-vsbar { display: flex; align-items: center; justify-content: center; gap: 12px; margin-bottom: 16px; font-family: 'Oxanium', sans-serif; font-weight: 700; }
  .mp-dot { padding: 7px 14px; border-radius: 999px; font-size: 13px; letter-spacing: 0.06em; border: 1px solid var(--line, rgba(218,215,210,0.18)); }
  .mp-dot.you { color: #fff; background: linear-gradient(180deg, #ff2a38, #b3121f); border-color: rgba(255,31,46,0.5); }
  .mp-dot.opp[data-state="waiting"] { color: #8d8380; }
  .mp-dot.opp[data-state="here"] { color: #0a0706; background: var(--chrome, #dad7d2); border-color: var(--chrome, #dad7d2); }
  .mp-dot.opp[data-state="left"] { color: #ff7a4a; border-color: rgba(255,122,74,0.5); }
  .mp-vs { color: #6f6663; font-size: 12px; }
  .mp-songpick { text-align: left; margin: 4px 0 16px; }
  .mp-pick-head { font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.3em; color: var(--crimson, #ff1f2e); margin-bottom: 7px; }
  .mp-pick { display: flex; align-items: center; gap: 12px; width: 100%; padding: 11px 14px; border-radius: 12px;
    background: rgba(218,215,210,0.05); border: 1px solid var(--line, rgba(218,215,210,0.16)); cursor: pointer; color: var(--ink, #f3eceb); }
  .mp-pick[disabled] { opacity: 0.6; cursor: default; }
  .mp-pick-art { width: 40px; height: 40px; flex: 0 0 auto; border-radius: 8px; display: grid; place-items: center;
    background: linear-gradient(135deg, rgba(255,31,46,0.25), rgba(255,122,74,0.12)); font-size: 18px; background-size: cover; background-position: center; overflow: hidden; }
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

  /* go step */
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
  #mp-opp.lead { border-color: rgba(255,31,46,0.55); }            /* opponent ahead → crimson edge */
  #mp-opp .mo-delta { font-weight: 800; font-size: 13px; }
  #mp-opp .mo-delta.ahead { color: #2fd27a; }                    /* YOU ahead */
  #mp-opp .mo-delta.behind { color: var(--crimson, #ff1f2e); }
  @media (max-width: 760px) { #mp-opp { width: 140px; top: 8px; right: 8px; padding: 9px 10px; } #mp-opp .mo-score { font-size: 20px; } }
  html.rr-reduce-motion #mp-opp .mo-bar > span { transition: none; }
  html.rr-reduce-motion .mp-challenge:hover { transform: none; }
```

---

### 3D — `index.html`: header "Versus" icon (library top bar)

**ANCHOR (unique — the Store icon button, index.html 2119-2121):**
```html
          <button class="icon-btn" id="store-open" aria-label="Store">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v1a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0V6l-3-4z"></path><path d="M4 9.5V20a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9.5"></path><path d="M9 21v-5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v5"></path></svg>
          </button>
```
**INSERT-AFTER** that `</button>`:

**DROP-IN CODE:**
```html
          <button class="icon-btn" id="mp-open" aria-label="Multiplayer versus" hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 7l-4 10"></path><circle cx="6.5" cy="8" r="2.5"></circle><circle cx="17.5" cy="16" r="2.5"></circle><path d="M9 8h3l1 3"></path><path d="M15 16h-3l-1-3"></path></svg>
          </button>
```
> Ships `hidden`; multiplayer.js un-hides it when `MP_PUBLIC` OR `rr_dev`/`?dev=1`/`?mp=1` (mirrors the Levels
> `CAMPAIGN_PUBLIC` gate at index.html 3430). Handler wired in multiplayer.js (not inline), like all other icons.

---

### 3E — NEW FILE: `multiplayer.js`

Create at ROOT: `D:/sunoai music plan/animev1/veo 3 round 2/can i pet that dog/cloudcode/v2/multiplayer.js`.
Self-contained: its own supabase client (mirrors catalog.js line 25), own rAF tick, own DOM panel. Zero edits
to catalog.js/jukebox.js. Uses **only** public `window.RhythmGame.*` + `window.RhythmCatalog.*`.

```js
// ===========================================================================
// REACTIVE RHYTHM — Online OPEN-LOBBY Multiplayer via Supabase Realtime
//   • LOBBY: shared presence channel `rr-lobby` lists everyone online; the
//     longest-present player wears the HOST BADGE; challenge anyone.
//   • MATCH: a private `rr-match-<id>` channel (challenger = match host) locks
//     song+difficulty, ready check, synchronized start, live tick + winner.
//   • In-game opponent panel renders the rival side-by-side.
// Self-contained. Exposes window.RhythmMP. No edits to catalog.js / jukebox.js.
// ===========================================================================
(function () {
  var CFG = window.RHYTHM_CONFIG || {};
  var $ = function (id) { return document.getElementById(id); };
  var screen = $('multiplayer'); if (!screen) return;

  // ---- gating: show the header icon for dev/opt-in; ship dark by default ----
  var MP_PUBLIC = false;                       // flip true to expose to all users
  var SHOW = false;
  try {
    SHOW = MP_PUBLIC
      || localStorage.getItem('rr_dev') === '1'
      || /[?&]dev=1/.test(location.search)
      || /[?&]mp=1/.test(location.search);
  } catch (e) {}
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

  // ---- identity ----
  var ME = { id: localId(), name: 'Player', avatar: null };
  function localId() {
    try {
      var k = localStorage.getItem('rr_mp_id');
      if (!k) { k = 'p_' + Math.random().toString(36).slice(2, 10); localStorage.setItem('rr_mp_id', k); }
      return k;
    } catch (e) { return 'p_' + Math.random().toString(36).slice(2, 10); }
  }
  (function resolveMe() {
    try {
      if (window.RhythmCatalog && window.RhythmCatalog.getUser) {
        window.RhythmCatalog.getUser().then(function (u) {
          if (u) { ME.id = u.id || ME.id; ME.name = u.name || ME.name; ME.avatar = u.avatar_url || null; }
          paintYou();
        }).catch(function () {});
      }
    } catch (e) {}
  })();

  // ---- state ----
  var JOINED_AT = Date.now();
  var lobbyCh = null;              // presence channel rr-lobby
  var lobby = {};                  // id -> {id,name,avatar,at,inMatch}
  var amHost = false;             // lobby host badge (longest present)
  var matchCh = null;             // private match channel
  var matchId = null;
  var matchRole = null;           // 'host' (challenger) | 'guest'
  var oppMeta = null;             // {id,name,avatar}
  var oppPresent = false, oppLeft = false;
  var sel = { trackId: null, title: null, artist: null, art: null, difficulty: 'medium', demo: false };
  var meReady = false, oppReady = false;
  var matchLive = false, finishedLocal = false;
  var myFinal = null, oppFinal = null;
  var lastOppTick = null;
  var oppPanel = null, oppRaf = 0, _lastSend = 0;
  var pendingOut = null;          // {toId} a challenge I sent, awaiting answer
  var incoming = {};              // id -> true (challenges TO me)

  function initial(s) { return (s || '?').trim().charAt(0).toUpperCase(); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function newMatchId() { return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  // ---- step switching ----
  function step(name) {
    var card = screen.querySelector('.mp-card'); if (card) card.setAttribute('data-mp-step', name);
    ['lobby', 'setup', 'go', 'winner'].forEach(function (s) {
      var el = screen.querySelector('.mp-step-' + s); if (el) el.hidden = (s !== name);
    });
  }
  function banner(id, txt) { var el = $(id); if (!el) return; if (txt) { el.textContent = txt; el.hidden = false; } else { el.hidden = true; } }

  // ===================== OPEN / CLOSE =====================
  function open() {
    paintYou();
    step('lobby');
    banner('mp-lobby-msg', '');
    screen.classList.add('active');
    joinLobby();
  }
  function leaveAll() {
    teardownMatch();
    try { if (lobbyCh) { lobbyCh.untrack(); supa.removeChannel(lobbyCh); } } catch (e) {}
    lobbyCh = null; lobby = {};
    screen.classList.remove('active');
  }

  function paintYou() {
    var av = $('mp-you-av'); if (av) { if (ME.avatar) { av.style.backgroundImage = 'url("' + String(ME.avatar).replace(/["\\]/g, '') + '")'; av.textContent = ''; } else { av.textContent = initial(ME.name); } }
    var nm = $('mp-you-name'); if (nm) nm.textContent = ME.name;
  }

  // ===================== LOBBY (presence) =====================
  function joinLobby() {
    if (!supa) { banner('mp-lobby-msg', 'Multiplayer needs a connection — check your network/sign-in.'); return; }
    if (lobbyCh) { renderRoster(); return; }     // already in
    lobbyCh = supa.channel('rr-lobby', { config: { presence: { key: ME.id }, broadcast: { self: false } } });
    lobbyCh.on('presence', { event: 'sync' }, onLobbySync);
    lobbyCh.on('presence', { event: 'leave' }, onLobbySync);
    // challenge handshake rides the lobby channel (targeted by toId)
    lobbyCh.on('broadcast', { event: 'challenge' }, function (m) { onChallenge(m.payload); });
    lobbyCh.on('broadcast', { event: 'challenge-ans' }, function (m) { onChallengeAns(m.payload); });
    lobbyCh.subscribe(function (status) {
      if (status === 'SUBSCRIBED') {
        lobbyCh.track({ id: ME.id, name: ME.name, avatar: ME.avatar, at: JOINED_AT, inMatch: false });
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        banner('mp-lobby-msg', 'Could not reach the live lobby. Check your connection and reopen.');
      }
    });
  }
  function setLobbyInMatch(flag) { try { if (lobbyCh) lobbyCh.track({ id: ME.id, name: ME.name, avatar: ME.avatar, at: JOINED_AT, inMatch: !!flag }); } catch (e) {} }

  function onLobbySync() {
    if (!lobbyCh) return;
    var st = lobbyCh.presenceState();
    lobby = {};
    Object.keys(st).forEach(function (k) { var p = st[k] && st[k][0]; if (p && p.id) lobby[p.id] = p; });
    // host election: smallest `at`, tie-broken by id (deterministic across clients)
    var ids = Object.keys(lobby);
    var hostId = null, hostAt = Infinity;
    ids.forEach(function (id) {
      var p = lobby[id], at = p.at || Infinity;
      if (at < hostAt || (at === hostAt && (!hostId || id < hostId))) { hostAt = at; hostId = id; }
    });
    amHost = (hostId === ME.id);
    var hb = $('mp-you-host'); if (hb) hb.hidden = !amHost;
    renderRoster(hostId);
  }

  function renderRoster(hostId) {
    var host = $('mp-roster'); if (!host) return;
    var ids = Object.keys(lobby).filter(function (id) { return id !== ME.id; });
    $('mp-roster-count').textContent = (Object.keys(lobby).length) + ' online';
    $('mp-roster-empty').hidden = ids.length > 0;
    host.innerHTML = ids.map(function (id) {
      var p = lobby[id];
      var isHost = (id === hostId);
      var av = p.avatar
        ? '<span class="mp-r-av" style="background-image:url(&quot;' + esc(p.avatar) + '&quot;)"></span>'
        : '<span class="mp-r-av">' + esc(initial(p.name)) + '</span>';
      var badge = isHost ? '<span class="mp-badge host">HOST</span>' : '';
      var inMatch = !!p.inMatch;
      var actions;
      if (incoming[id]) {
        actions = '<button class="mp-acc" data-acc="' + esc(id) + '">ACCEPT</button><button class="mp-dec" data-dec="' + esc(id) + '">✕</button>';
      } else if (pendingOut && pendingOut.toId === id) {
        actions = '<button class="mp-challenge" disabled>WAITING…</button>';
      } else {
        actions = '<button class="mp-challenge" data-ch="' + esc(id) + '"' + (inMatch ? ' disabled' : '') + '>' + (inMatch ? 'IN MATCH' : 'CHALLENGE') + '</button>';
      }
      return '<div class="mp-row' + (incoming[id] ? ' incoming' : '') + '">' + av +
        '<span class="mp-r-meta"><span class="mp-r-name">' + esc(p.name || 'Player') + ' ' + badge + '</span>' +
        '<span class="mp-r-sub">' + (incoming[id] ? 'wants to duel you' : (inMatch ? 'in a match' : 'online')) + '</span></span>' +
        actions + '</div>';
    }).join('');
    // wire row buttons
    [].forEach.call(host.querySelectorAll('[data-ch]'), function (b) { b.addEventListener('click', function () { sendChallenge(b.getAttribute('data-ch')); }); });
    [].forEach.call(host.querySelectorAll('[data-acc]'), function (b) { b.addEventListener('click', function () { acceptChallenge(b.getAttribute('data-acc')); }); });
    [].forEach.call(host.querySelectorAll('[data-dec]'), function (b) { b.addEventListener('click', function () { declineChallenge(b.getAttribute('data-dec')); }); });
  }

  // ===================== CHALLENGE HANDSHAKE =====================
  function sendChallenge(toId) {
    if (!lobbyCh || !toId || (lobby[toId] && lobby[toId].inMatch)) return;
    pendingOut = { toId: toId, mid: newMatchId() };
    lobbyCh.send({ type: 'broadcast', event: 'challenge', payload: { fromId: ME.id, fromName: ME.name, toId: toId, mid: pendingOut.mid } });
    banner('mp-lobby-msg', 'Challenge sent — waiting for a reply…');
    onLobbySync();
  }
  function onChallenge(p) {
    if (!p || p.toId !== ME.id) return;          // not for me
    incoming[p.fromId] = { mid: p.mid };
    onLobbySync();
  }
  function acceptChallenge(fromId) {
    var inc = incoming[fromId]; if (!inc) return;
    lobbyCh.send({ type: 'broadcast', event: 'challenge-ans', payload: { fromId: ME.id, toId: fromId, mid: inc.mid, ok: true } });
    incoming = {};
    startMatchChannel(inc.mid, 'guest', lobby[fromId]);   // accepter = guest; challenger = host
  }
  function declineChallenge(fromId) {
    var inc = incoming[fromId]; if (!inc) return;
    lobbyCh.send({ type: 'broadcast', event: 'challenge-ans', payload: { fromId: ME.id, toId: fromId, mid: inc.mid, ok: false } });
    delete incoming[fromId]; onLobbySync();
  }
  function onChallengeAns(p) {
    if (!p || p.toId !== ME.id || !pendingOut || p.mid !== pendingOut.mid) return;
    if (p.ok) {
      var opp = lobby[p.fromId];
      var mid = pendingOut.mid; pendingOut = null;
      startMatchChannel(mid, 'host', opp);       // I challenged → I am host
    } else {
      banner('mp-lobby-msg', 'Challenge declined.');
      pendingOut = null; onLobbySync();
    }
  }

  // ===================== MATCH CHANNEL =====================
  function startMatchChannel(mid, role, opp) {
    if (!supa) return;
    teardownMatch();   // safety
    matchId = mid; matchRole = role; oppMeta = opp || null;
    oppPresent = false; oppLeft = false; meReady = false; oppReady = false;
    sel = { trackId: null, title: null, artist: null, art: null, difficulty: sel.difficulty || 'medium', demo: false };
    setLobbyInMatch(true);
    matchCh = supa.channel('rr-match-' + mid, { config: { presence: { key: ME.id }, broadcast: { self: false } } });
    matchCh.on('presence', { event: 'sync' }, onMatchSync);
    matchCh.on('presence', { event: 'leave' }, onMatchLeave);
    matchCh.on('broadcast', { event: 'song' }, function (m) { onSong(m.payload); });
    matchCh.on('broadcast', { event: 'ready' }, function (m) { onReady(m.payload); });
    matchCh.on('broadcast', { event: 'start' }, function (m) { onStart(m.payload); });
    matchCh.on('broadcast', { event: 'tick' }, function (m) { onTick(m.payload); });
    matchCh.on('broadcast', { event: 'final' }, function (m) { onFinal(m.payload); });
    matchCh.on('broadcast', { event: 'rematch' }, function () { resetForRematch(); });
    matchCh.subscribe(function (status) {
      if (status === 'SUBSCRIBED') {
        matchCh.track({ id: ME.id, name: ME.name, role: role, at: Date.now() });
        enterSetup();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        banner('mp-setup-msg', 'Could not open the match channel. Back out and retry.');
      }
    });
  }
  function enterSetup() {
    step('setup');
    var dot = $('mp-dot-opp'); dot.setAttribute('data-state', 'waiting'); dot.textContent = oppMeta ? (oppMeta.name || 'OPPONENT').slice(0, 12) : 'WAITING…';
    var isHost = matchRole === 'host';
    $('mp-pick').disabled = !isHost;
    $('mp-pick-chev').style.visibility = isHost ? '' : 'hidden';
    [].forEach.call($('mp-diff').children, function (b) { b.disabled = !isHost; });
    $('mp-readystate').textContent = isHost ? 'Pick a track, then hit READY.' : 'Waiting for host to pick a track…';
    paintSelection(); refreshReadyEnabled();
  }
  function onMatchSync() {
    if (!matchCh) return;
    var st = matchCh.presenceState();
    var others = Object.keys(st).filter(function (k) { return k !== ME.id; });
    oppPresent = others.length > 0;
    var opp = oppPresent ? st[others[0]][0] : null;
    var dot = $('mp-dot-opp');
    if (dot) {
      if (oppPresent) { dot.setAttribute('data-state', 'here'); dot.textContent = (opp && opp.name ? opp.name : (oppMeta && oppMeta.name) || 'OPPONENT').slice(0, 12); oppLeft = false; }
      else { dot.setAttribute('data-state', 'waiting'); dot.textContent = 'WAITING…'; }
    }
    if (matchRole === 'host' && oppPresent && sel.trackId) broadcastSong();   // late-join catch-up
    refreshReadyEnabled();
  }
  function onMatchLeave() {
    var st = matchCh ? matchCh.presenceState() : {};
    var others = Object.keys(st).filter(function (k) { return k !== ME.id; });
    if (others.length === 0) {
      oppPresent = false; oppLeft = true;
      var dot = $('mp-dot-opp'); if (dot) { dot.setAttribute('data-state', 'left'); dot.textContent = 'OPPONENT LEFT'; }
      if (matchLive) markOppGone();
      else { oppReady = false; refreshReadyEnabled(); banner('mp-setup-msg', 'Opponent left. Back to lobby to find another.'); }
    }
  }

  // ---- song selection (host) ----
  function broadcastSong() { if (matchCh) matchCh.send({ type: 'broadcast', event: 'song', payload: sel }); }
  function onSong(p) {
    if (!p) return;
    sel = p; paintSelection();
    meReady = false; oppReady = false; setReadyBtn(); refreshReadyEnabled();
    $('mp-readystate').textContent = matchRole === 'host' ? 'Track locked. Hit READY.' : 'Host locked a track. Hit READY when set.';
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
    if (!sel.trackId) $('mp-readystate').textContent = matchRole === 'host' ? 'Pick a track to enable READY.' : 'Waiting for host to pick a track…';
    else if (!oppPresent) $('mp-readystate').textContent = 'Waiting for your opponent…';
  }
  function setReadyBtn() { var b = $('mp-ready'); b.classList.toggle('armed', meReady); b.textContent = meReady ? 'READY ✓' : 'READY'; }
  function toggleReady() {
    if ($('mp-ready').disabled) return;
    meReady = !meReady; setReadyBtn();
    matchCh.send({ type: 'broadcast', event: 'ready', payload: { ready: meReady, id: ME.id } });
    maybeStart();
  }
  function onReady(p) { oppReady = !!(p && p.ready); maybeStart(); }
  function maybeStart() {
    if (meReady && oppReady && sel.trackId && matchRole === 'host') {
      var atMs = Date.now() + 1300;          // lead-in so both schedule together
      matchCh.send({ type: 'broadcast', event: 'start', payload: { atMs: atMs, sel: sel } });
      beginMatch(atMs, sel);
    }
  }
  function onStart(p) { if (p && p.atMs) beginMatch(p.atMs, p.sel || sel); }

  // ===================== SYNCHRONIZED MATCH =====================
  function beginMatch(atMs, s) {
    sel = s || sel;
    matchLive = true; finishedLocal = false; myFinal = null; oppFinal = null; oppLeft = false;
    step('go'); $('mp-go-num').textContent = 'GET READY';
    // register one-shot song-end handler BEFORE launch
    window.RhythmGame.onSongEnd(onLocalSongEnd);
    // resolve provider + start synced. We keep the engine surface minimal: resolve the
    // track and reuse the SAME launch paths the rest of the app uses (byte-identical play).
    resolveAndStart(sel, atMs);
    // mount panel + tick right as the engine takes over (showScreen('game') auto-closes overlay)
    var delay = Math.max(0, atMs - Date.now());
    setTimeout(function () { mountOppPanel(); startTick(); }, delay + 80);
  }

  // Resolve a chart provider for `sel` and schedule the synced start using the public
  // RhythmGame.startAt(provider, {...}). Providers come from the SAME logic launchTrack uses:
  //   server chart → liveProvider(id); else audio_url → playUrl path; else demo.
  function resolveAndStart(s, atMs) {
    var RC = window.RhythmCatalog;
    var t = (RC && RC.allTracks) ? RC.allTracks().filter(function (x) { return x.id === s.trackId; })[0] : null;
    // build a provider fn that mirrors launchTrack's branches but defers execution to startAt
    var prov = null;
    try {
      if (s.demo || !t) {
        prov = window.RhythmGame.__demoProvider ? window.RhythmGame.__demoProvider() : null;
      } else if (RC && RC.liveProvider && RC.trackReady && RC.trackReady(t) && hasServerChart(t)) {
        prov = RC.liveProvider(t.id);
      } else {
        var url = t.audio_url || (t.audio && t.audio.url);
        // playUrl(url, meta) is play(()=>bufferedProvider(url,meta)); replicate the provider:
        if (url) prov = (function (u, meta) { return function () { return window.RhythmGame.playUrl && false; }; })(url);
      }
    } catch (e) {}

    if (prov) {
      window.RhythmGame.startAt(prov, { atMs: atMs, difficulty: sel.difficulty });
      return;
    }
    // Fallback path: no clean provider fn (in-browser charted track). Use the public
    // launchTrack at the synced timestamp — sync is then bounded by decode time only
    // (acceptable; judgment stays local). Set difficulty first.
    try { window.RhythmGame.setDifficulty(sel.difficulty); } catch (e) {}
    var fire = function () {
      try { if (window.RhythmGame.getAC) window.RhythmGame.getAC().resume(); } catch (e) {}
      if (t && RC && RC.launchTrack) RC.launchTrack(t);
      else if (window.RhythmGame.playDemo) window.RhythmGame.playDemo();
    };
    setTimeout(fire, Math.max(0, atMs - Date.now()));
  }
  function hasServerChart(t) {
    return !!(t && (t.chart_status === 'ready' || t._serverChart || (t.chart && t.chart.status === 'ready')));
  }

  // ---- opponent panel + tick ----
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
    var nm = oppPanel.querySelector('#mo-name'); if (nm) nm.textContent = (oppMeta && oppMeta.name) ? oppMeta.name.slice(0, 12) : 'OPPONENT';
    game.appendChild(oppPanel);
  }
  function unmountOppPanel() { if (oppPanel && oppPanel.parentNode) oppPanel.parentNode.removeChild(oppPanel); }
  function markOppGone() { var l = oppPanel && oppPanel.querySelector('#mo-live'); if (l) { l.textContent = 'LEFT'; l.classList.add('gone'); } }

  function startTick() {
    stopTick();
    function frame() {
      oppRaf = requestAnimationFrame(frame);
      var now = performance.now();
      var stt = window.RhythmGame.getLiveStats ? window.RhythmGame.getLiveStats() : null;
      if (stt && matchCh && now - _lastSend > 160) {     // ~6/s
        _lastSend = now;
        matchCh.send({ type: 'broadcast', event: 'tick', payload: { score: stt.score, combo: stt.combo, acc: stt.acc, prog: stt.progress, name: ME.name } });
      }
      if (oppPanel && oppPanel.parentNode) renderOpp(stt);
    }
    oppRaf = requestAnimationFrame(frame);
  }
  function stopTick() { if (oppRaf) cancelAnimationFrame(oppRaf); oppRaf = 0; }
  function onTick(p) { if (p) lastOppTick = p; }
  function renderOpp(my) {
    var o = lastOppTick;
    var sc = oppPanel.querySelector('#mo-score'), cb = oppPanel.querySelector('#mo-combo'),
        br = oppPanel.querySelector('#mo-bar'), dl = oppPanel.querySelector('#mo-delta');
    if (o) { sc.textContent = Number(o.score || 0).toLocaleString(); cb.textContent = (o.combo || 0) + 'x'; br.style.width = Math.round((o.prog || 0) * 100) + '%'; }
    if (my && o) {
      var d = (my.score || 0) - (o.score || 0);
      dl.textContent = (d >= 0 ? '+' : '') + d.toLocaleString();
      dl.className = 'mo-delta ' + (d >= 0 ? 'ahead' : 'behind');
      oppPanel.classList.toggle('lead', d < 0);
    }
  }

  // ---- end → finals → winner ----
  function onLocalSongEnd(reason, results) {
    finishedLocal = true; stopTick();
    var s = results ? {
      score: results.score, combo: results.max_combo, acc: Math.round((results.accuracy || 0) * 1000) / 10, grade: results.grade
    } : (window.RhythmGame.getLiveStats ? window.RhythmGame.getLiveStats() : { score: 0, combo: 0, acc: 0, grade: 'D' });
    myFinal = s;
    if (matchCh) matchCh.send({ type: 'broadcast', event: 'final', payload: Object.assign({ name: ME.name }, s) });
    settleIfReady();
    setTimeout(function () { settleIfReady(true); }, 8000);   // safety if opponent never reports
  }
  function onFinal(p) { if (p) oppFinal = p; settleIfReady(); }
  function settleIfReady(force) {
    if (!matchLive || !finishedLocal) return;
    if (!oppFinal && !force && !oppLeft) return;
    matchLive = false;
    unmountOppPanel();
    setLobbyInMatch(false);
    showWinner();
  }
  function showWinner() {
    var me = myFinal || { score: 0, acc: 0, combo: 0 };
    var op = oppFinal;
    $('mp-sc-you').textContent = Number(me.score || 0).toLocaleString();
    $('mp-sc-you-meta').textContent = (me.acc != null ? me.acc + '% · ' : '') + (me.combo || 0) + 'x' + (me.grade ? ' · ' + me.grade : '');
    $('mp-sc-opp-who').textContent = (op && op.name) ? op.name.slice(0, 14) : (oppMeta && oppMeta.name ? oppMeta.name.slice(0, 14) : 'OPPONENT');
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
    else draw = true;
    v.className = 'mp-verdict ' + (draw ? 'draw' : win ? 'win' : 'lose');
    v.textContent = draw ? 'DRAW' : win ? 'YOU WIN' : 'YOU LOSE';
    step('winner');
    screen.classList.add('active');   // re-raise over the engine's results screen (showScreen stripped us)
  }
  function resetForRematch() {
    myFinal = null; oppFinal = null; lastOppTick = null; meReady = false; oppReady = false;
    finishedLocal = false; matchLive = false; setReadyBtn(); setLobbyInMatch(true);
    step('setup'); paintSelection(); refreshReadyEnabled();
    $('mp-readystate').textContent = 'Rematch — READY when set.';
    screen.classList.add('active');
  }

  function teardownMatch() {
    stopTick(); unmountOppPanel();
    matchLive = false; finishedLocal = false; meReady = false; oppReady = false;
    try { if (matchCh) { matchCh.untrack(); supa.removeChannel(matchCh); } } catch (e) {}
    matchCh = null; matchId = null; matchRole = null; oppMeta = null; oppPresent = false; oppLeft = false;
    setLobbyInMatch(false);
  }
  function backToLobby() { teardownMatch(); step('lobby'); banner('mp-lobby-msg', ''); onLobbySync(); }

  // ===================== TRACK PICKER (host) =====================
  function renderPicker(q) {
    var box = $('mp-results'); var RC = window.RhythmCatalog;
    var all = (RC && RC.allTracks) ? RC.allTracks() : [];
    if (RC && RC.trackReady) all = all.filter(function (t) { return RC.trackReady(t); });
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

  // ===================== WIRING =====================
  if (openBtn) openBtn.addEventListener('click', open);
  $('mp-close').addEventListener('click', leaveAll);
  $('mp-leave-setup').addEventListener('click', backToLobby);
  $('mp-leave-win').addEventListener('click', leaveAll);
  $('mp-backlobby').addEventListener('click', backToLobby);
  $('mp-rematch').addEventListener('click', function () { if (matchCh) matchCh.send({ type: 'broadcast', event: 'rematch', payload: {} }); resetForRematch(); });
  $('mp-ready').addEventListener('click', toggleReady);
  $('mp-diff').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b || matchRole !== 'host') return;
    sel.difficulty = b.getAttribute('data-diff');
    [].forEach.call(this.children, function (x) { x.classList.toggle('active', x === b); });
    broadcastSong();
  });
  $('mp-pick').addEventListener('click', function () {
    if (matchRole !== 'host') return;
    var p = $('mp-picker'); p.hidden = !p.hidden; if (!p.hidden) { renderPicker(''); $('mp-search').focus(); }
  });
  $('mp-search').addEventListener('input', function () { renderPicker(this.value); });

  // Esc closes (only when NOT mid-match) — mirrors #leaderboard-screen handler
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && screen.classList.contains('active') && !matchLive) { e.stopImmediatePropagation(); leaveAll(); }
  }, true);
  screen.addEventListener('click', function (e) { if (e.target === screen && !matchLive) leaveAll(); });

  // clean up presence if the tab closes
  window.addEventListener('beforeunload', function () { try { if (matchCh) matchCh.untrack(); if (lobbyCh) lobbyCh.untrack(); } catch (e) {} });

  // public hook
  window.RhythmMP = { open: open, close: leaveAll, isLive: function () { return matchLive; } };
})();
```

> **Provider note (important):** the `resolveAndStart` "playUrl provider" branch above is intentionally inert
> for in-browser-charted tracks — building a `bufferedProvider` from outside the engine would require a new
> `__buffered` seam. To keep the engine surface to the **3 documented hooks only**, in-browser tracks fall
> through to the **Fallback path** (a synced `setTimeout` → `RhythmCatalog.launchTrack(t)`). Sync is then bounded
> by decode time (a few hundred ms) instead of `startAt`'s tighter window — perfectly fine for a versus bar since
> judgment is 100% local. **If the integrator wants tighter sync for ALL tracks**, add this ONE line inside the
> game.js `Object.assign` block (§3A) and the buffered branch becomes live:
> ```js
>     __buffered: (url, meta) => bufferedProvider(url, meta),
> ```
> then replace the inert branch with:
> ```js
>         if (url) prov = (function (u, meta) { return function () { return window.RhythmGame.__buffered(u, meta); }; })(url, { title: t.title, artist: t.artist_credit_name || t.artist_name, genre: t.genre, artwork: t.artwork_url });
> ```
> Either way ships; the fallback needs zero extra engine surface. (`bufferedProvider` is module-scope at
> game.js line 841; `getAC` referenced via `window.RhythmGame.getAC` — if that public alias doesn't exist the
> `try/catch` no-ops and the engine still resumes audio inside `play()`'s own gesture path.)

---

### 3F — `index.html`: load the module + bump versions

**ANCHOR (index.html 3031-3033):**
```html
<script src="game.js?v=84"></script>
<script src="jukebox.js?v=84"></script>
<script src="catalog.js?v=84"></script>
```
**REPLACE WITH** (bump to v85 across the board; add multiplayer.js LAST so `RhythmGame` + `RhythmCatalog` exist):
```html
<script src="game.js?v=85"></script>
<script src="jukebox.js?v=85"></script>
<script src="catalog.js?v=85"></script>
<script src="multiplayer.js?v=85"></script>
```
Also bump the CSS ref at **index.html line 14**: `jukebox.css?v=84` → `jukebox.css?v=85`.

---

### 3G — `index.html`: (OPTIONAL) leaderboard "your standing" + auth-refresh polish

The existing leaderboard IIFE (3676-3845) **already** shows live ranks via `fetchGlobalLeaderboard`/
`fetchLeaderboard` and falls back to a local "You" row. Two tiny enhancements make "see each other's ranks once
accounts connect" feel complete. Both are optional and additive.

**(G1) Re-render the board the moment the user signs in** — so a guest who logs in mid-session flips from the
local standing to live ranks without reopening the overlay.

**ANCHOR (the leaderboard IIFE's open/close wiring, index.html 3839-3840):**
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

**(G2) (Optional copy nicety)** the guest banner already reads "Live rankings switch on when accounts connect."
No change needed — it already satisfies the "show local standing as the guest fallback" requirement. Leave as-is.

> No catalog.js / new-route changes are required for user leaderboards to *work*: `fetchGlobalLeaderboard`
> already hits `GET /leaderboard/global` and `fetchLeaderboard` hits `GET /leaderboard/:id`, both returning
> ranked rows with `display_name` once those routes return data (see the Lovable brief §6 item 5 to confirm the
> global route exists + that scores are written with display names).

---

## 4) NEW PUBLIC HOOKS — and where they wire

| Hook (file) | Signature | Purpose | Consumed by |
|---|---|---|---|
| `RhythmGame.getLiveStats()` (game.js §3A) | `→ {score,combo,maxCombo,acc,progress,playing,grade}` | per-frame live read | multiplayer.js `startTick()`/`renderOpp` |
| `RhythmGame.onSongEnd(cb)` (game.js §3A) | `cb(reason, results)` fire-once | report final + cleanup | multiplayer.js `onLocalSongEnd` |
| `RhythmGame.startAt(prov,{atMs,difficulty})` (game.js §3A) | scheduled synced launch | both clients start together | multiplayer.js `beginMatch`/`resolveAndStart` |
| `RhythmMP.open()/close()/isLive()` (multiplayer.js) | screen control | programmatic open | header icon; future menu hub |
| (reused) `RhythmGame.__demoProvider` (exists, game.js 941) | `→ demoProvider` | demo fallback chart | `resolveAndStart` |
| (reused) `RhythmGame.lastResults()` (exists, game.js 940) | `→ results|null` | final payload | `_fireSongEnd` |
| (reused) `RhythmCatalog.onAuthChange(cb)` (exists) | live auth flip | leaderboard re-render | §3G G1 |

Optional one-liner (§3E provider note): `RhythmGame.__buffered = (url,meta)=>bufferedProvider(url,meta)` — only
if the integrator wants `startAt`-tight sync for in-browser-charted tracks too. Not required.

---

## 5) ASSETS — generation prompts + save paths (self-healing; code ships without them)

No raster assets are **required** — the versus icon is inline SVG, the lobby/host badge/panels are pure CSS,
avatars fall back to a chrome initial chip. The two below are **optional polish**; wire each behind a graceful
fallback so missing art never breaks the build.

1. **`assets/mp/versus-key.png`** — optional hero emblem behind `.mp-title` on the lobby step.
   > Higgsfield prompt: "Two crossed electric guitars forming an X, crimson #ff1f2e and ember #ff7a4a energy
   > arcs between them, dark warm charcoal #0a0706 background, chrome #dad7d2 metallic edge highlights, centered
   > esports versus emblem, transparent PNG, 1024x1024, high contrast, no text, NO blue, NO purple."
   > Self-heal: only reference via an optional rule `.mp-card[data-mp-step="lobby"] .mp-title { background-image: image-set(url('assets/mp/versus-key.png')); }` is NOT added by default — leave the title clean. If the user
   > wants it, add the rule; a 404 simply shows no background (CSS background images fail silently). No JS guard needed.

2. **`assets/mp/win-burst.png`** — optional gold spark burst for the YOU WIN verdict.
   > Higgsfield prompt: "Radial burst of gold #e0a93f and chrome #dad7d2 sparks on transparent background,
   > celebratory, 1024x1024 PNG, warm tones only, no blue, no purple, centered, soft glow."
   > Self-heal: if used, add `.mp-verdict.win { background: url('assets/mp/win-burst.png') center/contain no-repeat; }`
   > — a missing file falls back to the existing gold text-shadow. No JS dependency.

Create folder `assets/mp/` only if either is generated. **Functional ship needs neither.** (Hand both prompts +
paths to the ASSET AGENT; code already renders correctly with them absent.)

---

## 6) LOVABLE BACKEND BRIEF (copy-paste) — only what truly needs the server

> **The core open-lobby + 1v1 match (presence roster, host badge, challenge, live opponent, winner) is 100%
> client-side via Supabase Realtime presence + broadcast and needs NO backend work** — the anon key authorizes
> ephemeral broadcast/presence. Items 3-5 are optional enhancements; ship without them.

```
SUBJECT: Reactive Rhythm — Open-Lobby Multiplayer (Realtime) + user leaderboards

CONTEXT: /play now has online multiplayer via Supabase Realtime PRESENCE + BROADCAST.
- A single shared LOBBY presence channel named exactly: rr-lobby  (everyone online appears here)
- Per-duel channels named: rr-match-<id>  (a private broadcast+presence channel per match)
The browser creates a supabase-js client with the existing publishable anon key. Players sync
score/combo over broadcast; NO DB writes for the core loop.

PLEASE CONFIRM / DO:

1) REALTIME ENABLED (required if not already):
   - Supabase Dashboard -> Project -> Realtime: ensure Realtime is ON for the project.
   - We use BROADCAST + PRESENCE only (NOT postgres_changes), so NO table replication is needed.

2) REALTIME AUTHORIZATION (only if you've enabled the newer "Realtime Authorization" RLS-on-channels):
   - If channel RLS is OFF (default): nothing to do — anon broadcast/presence works.
   - If channel RLS is ON: add a permissive policy so anon clients can read+write broadcast/presence
     on our namespaces. Example on realtime.messages:
       CREATE POLICY "rr_realtime_anon_read" ON realtime.messages
         FOR SELECT USING ( realtime.topic() = 'rr-lobby' OR realtime.topic() LIKE 'rr-match-%' );
       CREATE POLICY "rr_realtime_anon_write" ON realtime.messages
         FOR INSERT WITH CHECK ( realtime.topic() = 'rr-lobby' OR realtime.topic() LIKE 'rr-match-%' );
     (Adjust to your exact setup; goal: anon can use rr-lobby + rr-match-* channels.)

3) (OPTIONAL) PERSIST MATCH RESULTS for a Versus W/L record:
   - Add POST /mp/result { match_id, opponent_id, my_score, opp_score, won:boolean, track_id, difficulty }.
     Store in 'mp_matches'. Auth: Bearer user JWT (reuse the same auth as POST /plays). Purely additive —
     the game already shows the winner locally.

4) (OPTIONAL) DISPLAY NAMES IN THE LOBBY: presence currently uses the site display_name from GET /me
   (already wired via RhythmCatalog.getUser). No change needed unless you want server-validated names.

5) USER LEADERBOARDS (the game already calls these — confirm they return ranked rows with display names):
   - GET /leaderboard/global?limit=20  ->  { rows:[{ rank, display_name, score, accuracy }] }  (top players)
   - GET /leaderboard/:trackId?difficulty=&limit=20  ->  same shape (per-song board; already used today)
   - Ensure POST /plays (or wherever runs are recorded) stores the player's display_name + accuracy so the
     boards can rank real users who can "see each other's ranks." The client falls back to local standing
     until these routes return data — so this is the one thing that flips leaderboards from local to global.

NOT NEEDED: no websocket server, no game-state authority server, no per-frame DB writes, no matchmaking
service (the open lobby IS the matchmaker).
```

---

## 7) VERIFY OFFLINE (greps + structural + node-check)

Run from ROOT. (Page boots in the Claude_Preview headless browser with internet; the integrator runtime-tests
the live lobby there. Static verification first:)

```
# A) engine hooks landed in game.js
grep -n "getLiveStats\|onSongEnd\|RhythmGame.startAt\|_fireSongEnd" game.js
#   expect: 3 hook defs + _fireSongEnd helper + 2 wired calls (endGame tail + exit-btn)
node --check game.js          # MUST pass after the §3A edits
node --check multiplayer.js   # MUST pass for the new file

# B) the #multiplayer screen + steps + lobby roster exist in index.html
grep -n 'id="multiplayer"\|mp-step-lobby\|mp-step-setup\|mp-step-winner\|id="mp-roster"\|id="mp-open"\|mp-challenge\|mp-you-host' index.html

# C) CSS + script wiring + versions
grep -n '.mp-screen\|#mp-opp\|.mp-badge.host\|.mp-roster' index.html      # CSS block present
grep -n 'multiplayer.js?v=85' index.html                                  # module loaded LAST
grep -n 'game.js?v=85\|catalog.js?v=85\|jukebox.css?v=85' index.html        # versions bumped

# D) leaderboard polish (optional G1)
grep -n 'onAuthChange(function () { if (screen.classList.contains' index.html

# E) collision sanity — every mp-* id unique, no pre-existing clash
grep -n 'id="mp-' index.html | sort
grep -n 'RhythmMP' index.html game.js catalog.js jukebox.js   # only multiplayer.js defines it
```

**Structural checks (manual read):**
- `#multiplayer` is a sibling of `#store-screen`/`#leaderboard-screen` (all direct children of `<body>`,
  NOT inside `#menu`), so `classList.add('active')` overlays at z-index 262 (> the 261 group).
- multiplayer.js runs AFTER game.js + catalog.js (script order §3F) → `RhythmGame.getLiveStats`,
  `RhythmCatalog.allTracks` exist when handlers fire. All access is `try/catch` + existence-guarded, so a
  missing dep degrades gracefully (the icon just won't connect).
- **showScreen EXCLUSIVITY interplay (the key correctness check):** when the engine enters `game`, it removes
  `.active` from `#multiplayer` (game.js 195) → the overlay closes itself, opponent panel is mounted into
  `#game` (separate element, untouched by the strip). At song end, `endGame()` runs `showScreen('results')`
  (strips overlay again) THEN our `_fireSongEnd('end')` fires (inserted at the tail, §3A ANCHOR 1b) →
  `onLocalSongEnd` → `settleIfReady` → `showWinner()` re-adds `.active`. Order verified against game.js
  1080-1110. The WINNER overlay therefore correctly sits on TOP of the results screen.

**Preview runtime test (integrator):** open two tabs to `/index.html?mp=1` (or `?dev=1`); both should appear in
each other's lobby roster; the earliest one shows the gold HOST badge; CHALLENGE → ACCEPT → host picks a track →
both READY → both run the same chart with a live opponent panel → WINNER on both. Check `preview_console_logs`
(level error) at the end.

---

## 8) RISKS & COLLISIONS

- **Two supabase clients** (catalog.js's `supa` + multiplayer.js's own). supabase-js tolerates multiple
  clients; both use the default storageKey so they SHARE the auth session (intended — MP shows the signed-in
  name in the lobby). Different channels → no realtime conflict. Low risk.
- **Open-lobby scale**: a single `rr-lobby` presence channel is fine for a beta (dozens online). If it grows to
  hundreds, the roster render is O(n) per sync — cap the rendered list (e.g. first 50) or shard the lobby by a
  region/hash later. Noted, not a ship blocker for beta.
- **Host-badge determinism**: every client computes "smallest `at`, tie-break id" from the SAME presenceState,
  so all clients agree on who wears HOST without a server. On host leave, the next-earliest re-elects on the
  next `sync`. Clock skew between clients can't flip it (we compare each peer's *own* reported `at`, which is a
  single client's Date.now() captured once at join — consistent within that peer's row).
- **Start-sync precision**: judgment is 100% local (each client times its own audio), so a small song offset
  only affects the comparative bar, not fairness. 1300 ms lead-in + `startAt` scheduling keeps them within ~1
  RTT + decode jitter. For in-browser-charted tracks the fallback path adds decode time only. Tighten later via
  the `__buffered` seam (§3E note) if desired.
- **In-browser charting determinism**: both clients run `analyzeBeats` on the SAME `audio_url` → identical
  charts (deterministic). Server-chart path is trivially identical. `resolveAndStart` mirrors `launchTrack`'s
  branch logic (server chart → liveProvider; else audio_url → launchTrack; else demo).
- **showScreen strips the overlay (already handled)**: see §7 structural check — this is a feature here, not a
  bug. The only requirement is that `showWinner()` re-adds `.active` AFTER results renders, which the song-end
  insertion order guarantees.
- **Esc/back during a live match** is intentionally disabled (`!matchLive` guards) so a player can't nuke the
  duel mid-song; they exit via in-game pause → EXIT, which fires `onSongEnd('exit')` → MP reports current stats
  and tears down cleanly (opponent auto-wins or draws on score).
- **Challenge handshake races**: two players challenging each other simultaneously could both try to host. The
  `pendingOut.mid` / incoming `mid` are distinct per challenge; the accepter always becomes guest of the
  challenger's `mid`, so the worst case is two separate match channels open briefly — the second `startMatchChannel`
  calls `teardownMatch()` first, closing the prior. Edge, low-frequency, self-heals. (A backend matchmaker — §6
  item — would eliminate it entirely; not needed for beta.)
- **No new dependency on jukebox.js / catalog.js source** — both stay byte-identical; MP only calls their public
  `window.*` API. game.js gains exactly 3 documented hooks + 2 one-line `_fireSongEnd` calls. Lowest possible
  collision footprint for a serial-merge codebase.
- **Strip-before-launch note**: `window.RhythmMP` + the `?mp=1`/`?dev` icon gate are dev-grade seams while MP
  ships behind `MP_PUBLIC=false`. List `RhythmMP`, `getLiveStats`, `onSongEnd`, `startAt` in CLAUDE.md's "DEV
  HOOKS TO STRIP / flag-gated" section if MP ships dark.
```
