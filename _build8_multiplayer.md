# _build8 — Multiplayer ROOM SYSTEM build-out (rooms · quick-match · spectate · rematch)

**Branch:** visual-overhaul · **current ?v=87** (integrator bumps once after applying — do NOT bump here)
**Scope of files touched:** `multiplayer.js` (primary), `index.html` (#multiplayer-screen markup + `.mpx-*` CSS, hub tile).
**No changes** to `game.js`, `catalog.js`, `jukebox.js`. Gameplay/scoring/timing **byte-identical** (this is pure
match-plumbing + UI; the engine seams already exist: `RhythmGame.getLiveStats / onSongEnd / startAt / __buffered`).

---

## 0. WHY THIS IS SAFE / THE CORE INSIGHT

The shipped engine already has a *complete* 1:1 match lifecycle:
`startMatchChannel(mid, role, opp)` → `enterSetup()` → song pick → ready check → `beginMatch()` → synced play →
`showWinner()` → REMATCH/back. **Rooms and Quick-Match are just two NEW WAYS TO ARRIVE at that same
`startMatchChannel()`.** We do **not** fork the match engine. We add:

1. A **rooms directory** broadcast on the existing `rr-lobby` channel (hosts announce open public rooms; everyone
   sees a live room list). A room is its own presence channel `rr-room-<id>` — a *waiting area* for exactly 2
   duelists (+ N spectators). When both seats are filled and the host starts, the room **hands its two players
   straight into a normal `rr-match-<id>`** (reusing every existing handshake/start/winner path).
2. A **Quick-Match queue**: a player flips a `lf:true` (looking-for-game) flag in their lobby presence; any other
   `lf` player auto-pairs via a deterministic, collision-free broadcast handshake → `startMatchChannel`.
3. **Spectate**: join a room's channel as `seat:'spec'`; receive the in-match `tick`/`final` broadcasts read-only.
4. Better UI: a lobby **action bar** (OPEN ROOM / QUICK-MATCH / BROWSE ROOMS), a **rooms step** with on-brand
   **room cards** (name, host, player count, PUBLIC/PRIVATE, JOIN/SPECTATE/CLOSE), and a room **waiting-room** panel
   reusing the existing setup step.

Everything degrades offline exactly as today: if `supa` is null, the lobby shows the sign-in banner and the new
buttons are inert (we guard every entry on `supa`).

---

## 1. ROOM / QUICK-MATCH PROTOCOL (the model)

All on the **existing** `rr-lobby` presence channel (no new global channel), plus per-room `rr-room-<id>`:

| Concern | Transport | Shape |
|---|---|---|
| Who's online + flags | `rr-lobby` **presence** (extend `myPresence`) | `{id,name,avatar,at,inMatch, lf:bool, room:<id|null>, hostRoom:<id|null>}` |
| Open-room directory | derived from lobby presence (any peer with `hostRoom` set is an open room) **+** a `room-meta` broadcast for name/privacy/count | `{rid,name,priv:bool,hostId,hostName,count,max:2}` |
| Quick-match pair | `rr-lobby` **broadcast** `qm-pair` | `{aId,bId,mid}` (deterministic proposer; see §5) |
| Room → seat join | `rr-room-<id>` **presence** | `{id,name,avatar,seat:'p1'|'p2'|'spec',at}` |
| Room start | `rr-room-<id>` **broadcast** `room-start` | `{mid, p1Id, p2Id}` → both call `startMatchChannel(mid, role, opp)` |
| Spectator feed | spectators re-subscribe to the room's `rr-match-<mid>` as read-only and render the existing `tick`/`final` | (reuses existing match broadcasts) |

**Key reuse:** once `room-start` fires, the two seated players run the *unchanged* match engine. Rooms are a lobby
*in front of* a match. This is exactly the lobby-vs-room split used by Nakama/Unity Lobby and the Supabase
realtime game samples (presence = who's here; broadcast = transient events; a "room" is just a named channel both
sides subscribe to).

> **Persistence is OPTIONAL.** The whole system works client-side via presence/broadcast — rooms live only while
> their host's tab is open (host leaves → room evaporates, members fall back to the lobby). A Lovable brief for
> durable/listable rooms is in §10, but **core must not depend on it.**

---

## 2. index.html — CSS (room cards, action bar, rooms step)

### PATCH 2A — append room-system CSS

**FILE:** `index.html`
**ANCHOR (unique, end of the MP CSS block — replace this single line):**
```
  html.rr-reduce-motion .mpx-challenge:hover { transform: none; }
```
**ACTION:** REPLACE that one line with itself **plus** the block below (keep the original line first):
```css
  html.rr-reduce-motion .mpx-challenge:hover { transform: none; }

  /* ===== ROOM SYSTEM (build8): lobby action bar · room cards · waiting room ===== */
  .mpx-actionbar { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 2px 0 14px; }
  .mpx-actionbar .mpx-act { display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
    padding: 12px 14px; border-radius: 13px; cursor: pointer; text-align: left;
    background: linear-gradient(180deg, rgba(218,215,210,0.06), rgba(218,215,210,0.02));
    border: 1px solid var(--line, rgba(218,215,210,0.16)); transition: transform .12s ease, border-color .12s ease, box-shadow .12s ease; }
  .mpx-actionbar .mpx-act:hover { transform: translateY(-1px); border-color: rgba(255,31,46,0.45); box-shadow: 0 8px 22px rgba(0,0,0,0.4); }
  .mpx-actionbar .mpx-act .a-t { font-family: 'Oxanium', sans-serif; font-weight: 800; font-size: 14px; letter-spacing: 0.04em; color: var(--ink, #f3eceb); }
  .mpx-actionbar .mpx-act .a-d { font-family: 'Chakra Petch', sans-serif; font-size: 10.5px; letter-spacing: 0.04em; color: #9c918e; text-transform: uppercase; }
  .mpx-actionbar .mpx-act.accent { background: linear-gradient(180deg, rgba(255,31,46,0.16), rgba(255,31,46,0.05)); border-color: rgba(255,31,46,0.4); }
  .mpx-actionbar .mpx-act.accent .a-t { color: #fff; }
  .mpx-actionbar .mpx-act.full { grid-column: 1 / -1; }
  .mpx-actionbar .mpx-act[aria-busy="true"] { opacity: .75; pointer-events: none; }
  .mpx-actionbar .mpx-act[aria-busy="true"] .a-d::after { content: ' …'; }

  .mpx-rooms-head { display: flex; align-items: center; justify-content: space-between; margin: 2px 2px 10px; }
  .mpx-rooms-head .rh-t { font-family: 'Oxanium', sans-serif; font-weight: 800; font-size: 16px; color: var(--ink, #f3eceb); }
  .mpx-rooms-head .rh-refresh { background: none; border: 1px solid var(--line, rgba(218,215,210,0.18)); color: #b9aeac;
    border-radius: 9px; padding: 6px 10px; cursor: pointer; font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.12em; }
  .mpx-rooms-head .rh-refresh:hover { border-color: var(--crimson); color: var(--chrome); }
  .mpx-roomlist { display: flex; flex-direction: column; gap: 9px; max-height: 340px; overflow-y: auto; text-align: left; }
  .mpx-roomcard { display: flex; align-items: center; gap: 12px; padding: 11px 13px; border-radius: 13px;
    background: linear-gradient(180deg, rgba(218,215,210,0.055), rgba(218,215,210,0.02));
    border: 1px solid var(--line, rgba(218,215,210,0.14)); transition: border-color .12s ease, box-shadow .12s ease; }
  .mpx-roomcard:hover { border-color: rgba(255,122,74,0.4); box-shadow: 0 6px 20px rgba(0,0,0,0.35); }
  .mpx-roomcard.full { opacity: 0.7; }
  .mpx-rc-spark { width: 38px; height: 38px; flex: 0 0 auto; border-radius: 10px; display: grid; place-items: center;
    background: linear-gradient(135deg, rgba(255,31,46,0.28), rgba(255,122,74,0.12)); color: #ffd9c2; font-size: 17px; }
  .mpx-rc-meta { display: flex; flex-direction: column; min-width: 0; flex: 1; }
  .mpx-rc-name { font-family: 'Oxanium', sans-serif; font-weight: 700; font-size: 15px; color: var(--ink, #f3eceb); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .mpx-rc-sub { font-family: 'Chakra Petch', sans-serif; font-size: 11px; color: #9c918e; display: flex; gap: 8px; align-items: center; }
  .mpx-rc-tag { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.14em; padding: 2px 7px; border-radius: 999px; }
  .mpx-rc-tag.pub { color: #8fe3b4; border: 1px solid rgba(47,210,122,0.4); }
  .mpx-rc-tag.priv { color: #ffb695; border: 1px solid rgba(255,122,74,0.4); }
  .mpx-rc-count { font-family: 'Oxanium', sans-serif; font-weight: 700; font-size: 12px; color: #c9a25a; }
  .mpx-rc-act { display: flex; gap: 6px; margin-left: auto; flex: 0 0 auto; }
  .mpx-rc-join { padding: 7px 14px; border-radius: 10px; cursor: pointer; font-family: 'Oxanium', sans-serif; font-weight: 800;
    font-size: 12px; color: #fff; background: linear-gradient(180deg, #ff2a38, #b3121f); border: 1px solid rgba(255,31,46,0.5); }
  .mpx-rc-join:hover { box-shadow: 0 8px 22px rgba(255,31,46,0.4); }
  .mpx-rc-join[disabled] { opacity: 0.5; cursor: default; background: rgba(218,215,210,0.08); color: #9c918e; border-color: var(--line, rgba(218,215,210,0.14)); box-shadow: none; }
  .mpx-rc-spec { padding: 7px 11px; border-radius: 10px; cursor: pointer; font-family: 'Oxanium', sans-serif; font-weight: 700;
    font-size: 11px; color: #cdbfae; background: transparent; border: 1px solid var(--line, rgba(218,215,210,0.2)); }
  .mpx-rc-spec:hover { border-color: var(--gold, #e0a93f); color: var(--gold, #e0a93f); }
  .mpx-rooms-empty { font-family: 'Chakra Petch', sans-serif; color: #8d8380; font-size: 13px; padding: 18px 8px; text-align: center; }

  /* room name / privacy mini-form (host opening a room) */
  .mpx-roomform { display: flex; flex-direction: column; gap: 10px; text-align: left; margin: 2px 0 8px; }
  .mpx-roomform input[type="text"] { width: 100%; box-sizing: border-box; padding: 11px 14px; border-radius: 11px;
    border: 1px solid var(--line, rgba(218,215,210,0.18)); background: rgba(10,7,6,0.6); color: var(--ink, #f3eceb);
    font-family: 'Chakra Petch', sans-serif; font-size: 14px; }
  .mpx-roomform input[type="text"]:focus { outline: none; border-color: var(--crimson); box-shadow: 0 0 0 3px rgba(255,31,46,0.16); }
  .mpx-privrow { display: flex; gap: 8px; }
  .mpx-privrow button { flex: 1; padding: 9px; border-radius: 10px; cursor: pointer; font-family: 'Oxanium', sans-serif;
    font-weight: 700; font-size: 12px; letter-spacing: 0.04em; color: #b9aeac; background: rgba(218,215,210,0.05);
    border: 1px solid var(--line, rgba(218,215,210,0.16)); }
  .mpx-privrow button.active { color: #0a0706; background: var(--chrome, #dad7d2); border-color: var(--chrome, #dad7d2); }

  /* spectator badge on the in-game opponent panel */
  #mp-opp.spectate { border-color: rgba(224,169,63,0.5); }
  #mp-opp .mo-spec { display: none; font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.18em; color: var(--gold, #e0a93f); }
  #mp-opp.spectate .mo-spec { display: inline; }
  html.rr-reduce-motion .mpx-actionbar .mpx-act:hover { transform: none; }
  @media (max-width: 760px) { .mpx-actionbar { grid-template-columns: 1fr; } }
```

---

## 3. index.html — MARKUP (lobby action bar + a ROOMS step)

### PATCH 3A — add the action bar at the TOP of the lobby step

**FILE:** `index.html`
**ANCHOR (unique — opening of the lobby step):**
```
      <!-- STEP: LOBBY (everyone currently online) -->
      <div class="mpx-step mpx-step-lobby">
        <p class="mp-sub">Everyone online is below. Challenge anyone to a live head-to-head on the same track.</p>
```
**ACTION:** REPLACE the `<p class="mp-sub">…` line above with the action bar **followed by** that same `<p>`:
```html
      <!-- STEP: LOBBY (everyone currently online) -->
      <div class="mpx-step mpx-step-lobby">
        <p class="mp-sub">Jump into a room, get auto-matched, or challenge anyone online — live head-to-head on the same track.</p>
        <div class="mpx-actionbar" id="mpx-actionbar">
          <button class="mpx-act accent" id="mpx-act-quick" type="button">
            <span class="a-t">⚡ Quick Match</span><span class="a-d">Auto-pair a random rival</span>
          </button>
          <button class="mpx-act" id="mpx-act-open" type="button">
            <span class="a-t">＋ Open a Room</span><span class="a-d">Host · public or private</span>
          </button>
          <button class="mpx-act full" id="mpx-act-browse" type="button">
            <span class="a-t">🜨 Browse Rooms <span id="mpx-act-browse-n"></span></span><span class="a-d">Join an open table or spectate</span>
          </button>
        </div>
```
*(Keep the rest of the lobby step — `.mpx-youbar`, roster, etc. — exactly as-is below this.)*

### PATCH 3B — insert the new ROOMS step (browser + open-room form + waiting room)

**FILE:** `index.html`
**ANCHOR (unique — the comment that begins the setup step):**
```
      <!-- STEP: MATCH-SETUP (lock song, ready check) -->
```
**ACTION:** INSERT the following block **immediately BEFORE** that comment line:
```html
      <!-- STEP: ROOMS (browse/open/wait) — build8 -->
      <div class="mpx-step mpx-step-rooms" hidden>
        <!-- mode A: room browser -->
        <div id="mpx-rooms-browse">
          <div class="mpx-rooms-head">
            <span class="rh-t">OPEN ROOMS</span>
            <button class="rh-refresh" id="mpx-rooms-refresh" type="button">↻ REFRESH</button>
          </div>
          <div class="mpx-roomlist" id="mpx-roomlist"></div>
          <p class="mpx-rooms-empty" id="mpx-rooms-empty" hidden>No open rooms right now. Open one and others can join live.</p>
          <button class="ghost-btn" id="mpx-rooms-back" style="margin-top:14px;">BACK TO LOBBY</button>
        </div>
        <!-- mode B: open-a-room form -->
        <div id="mpx-rooms-create" hidden>
          <div class="mpx-rooms-head"><span class="rh-t">OPEN A ROOM</span></div>
          <div class="mpx-roomform">
            <input type="text" id="mpx-room-name" maxlength="28" placeholder="Room name (e.g. Friday Shred)" autocomplete="off" spellcheck="false" />
            <div class="mpx-privrow" id="mpx-room-priv">
              <button data-priv="public" class="active" type="button">PUBLIC</button>
              <button data-priv="private" type="button">PRIVATE (invite only)</button>
            </div>
          </div>
          <div class="mpx-readyrow" style="margin-top:6px;">
            <button class="ghost-btn primary" id="mpx-room-create-go" style="min-width:220px;">OPEN ROOM</button>
            <div class="mpx-readystate" id="mpx-room-create-msg">Public rooms appear in everyone's browser.</div>
          </div>
          <button class="ghost-btn" id="mpx-room-create-cancel" style="margin-top:14px;">CANCEL</button>
        </div>
        <div class="mpx-banner" id="mpx-rooms-msg" hidden></div>
      </div>

      <!-- STEP: MATCH-SETUP (lock song, ready check) -->
```

### PATCH 3C — show the room context inside the existing setup step (host badge + close)

**FILE:** `index.html`
**ANCHOR (unique — the vsbar that opens the setup step):**
```
      <div class="mpx-step mpx-step-setup" hidden>
        <div class="mpx-vsbar">
```
**ACTION:** INSERT a room-context strip + spectator note **immediately AFTER** the `<div class="mpx-step mpx-step-setup" hidden>` line (before `<div class="mpx-vsbar">`):
```html
      <div class="mpx-step mpx-step-setup" hidden>
        <div class="mpx-roomctx" id="mpx-roomctx" hidden style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 2px 12px;padding:8px 12px;border-radius:11px;background:rgba(255,122,74,0.08);border:1px solid rgba(255,122,74,0.3);">
          <span style="font-family:'Chakra Petch',sans-serif;font-size:12px;color:#ffb695;"><b id="mpx-roomctx-name">Room</b> <span id="mpx-roomctx-priv" style="font-family:'JetBrains Mono',monospace;font-size:9px;letter-spacing:.14em;opacity:.8;"></span></span>
          <span id="mpx-roomctx-spec" style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:.12em;color:#c9a25a;"></span>
          <button class="rh-refresh" id="mpx-room-close" type="button" style="margin-left:auto;">CLOSE ROOM</button>
        </div>
```
*(The `#mpx-room-close` button is shown only to the host by JS; non-hosts see “LEAVE ROOM” text swapped in. Setup’s existing `#mpx-leave-setup` still routes back to lobby.)*

### PATCH 3D — re-enable the Multiplayer hub tile (drop the SOON badge)

**FILE:** `index.html`
**ANCHOR (unique — inside the `mh-multiplayer` tile):**
```
        <button class="mh-tile" id="mh-multiplayer" type="button">
          <span class="mh-soon">SOON</span>
```
**ACTION:** REPLACE those two lines with (remove the SOON badge so the now-real feature is reachable without a “coming soon” signal):
```html
        <button class="mh-tile" id="mh-multiplayer" type="button">
```
> Leave the rest of the tile (icon + “Multiplayer / Head to head”) untouched. If the user wants to keep it gated,
> skip 3D — the lobby still works; the badge is purely cosmetic.

---

## 4. multiplayer.js — STEP SWITCHER + PRESENCE SHAPE

### PATCH 4A — register the new `rooms` step

**FILE:** `multiplayer.js`
**ANCHOR (unique — the step list):**
```
    ['lobby', 'setup', 'go', 'winner'].forEach(function (s) {
      var el = screen.querySelector('.mpx-step-' + s); if (el) el.hidden = (s !== name);
    });
```
**ACTION:** REPLACE the array literal `['lobby', 'setup', 'go', 'winner']` with `['lobby', 'rooms', 'setup', 'go', 'winner']`:
```js
    ['lobby', 'rooms', 'setup', 'go', 'winner'].forEach(function (s) {
      var el = screen.querySelector('.mpx-step-' + s); if (el) el.hidden = (s !== name);
    });
```

### PATCH 4B — extend presence with room/quick-match flags

**FILE:** `multiplayer.js`
**ANCHOR (unique — the presence builder):**
```
  function myPresence(inMatch) { return { id: ME.id, name: ME.name, avatar: ME.avatar, at: JOINED_AT, inMatch: !!inMatch }; }
```
**ACTION:** REPLACE that line with (adds `lf` / `room` / `hostRoom`, fed from module state):
```js
  function myPresence(inMatch) {
    return { id: ME.id, name: ME.name, avatar: ME.avatar, at: JOINED_AT, inMatch: !!inMatch,
      lf: !!QM.looking, room: (room.id || null), hostRoom: (room.id && room.isHost ? room.id : null) };
  }
  function reannounce() { try { if (lobbyCh) lobbyCh.track(myPresence(matchLive || !!matchCh)); } catch (e) {} }
```

### PATCH 4C — new module state (rooms + quick-match)

**FILE:** `multiplayer.js`
**ANCHOR (unique — end of the `// ---- state ----` block):**
```
  var activeNow = false;          // is #multiplayer-screen currently .active
```
**ACTION:** INSERT after that line:
```js
  // ---- build8: rooms + quick-match state ----
  var room = { id: null, name: null, priv: false, isHost: false, ch: null, seat: null,
               members: {}, p1: null, p2: null };   // current room (host or joined/spectating)
  var roomsDir = {};              // rid -> {rid,name,priv,hostId,hostName,count,max,at} (browser directory)
  var QM = { looking: false, t: 0 };   // quick-match: am I in the queue?
  var spectating = false;         // joined a match purely as a watcher
```

---

## 5. multiplayer.js — LOBBY CHANNEL: room directory + quick-match handshake

The lobby channel is created in `joinLobby()`. We add three broadcast listeners and a directory rebuild on sync.

### PATCH 5A — listen for room-meta + quick-match pairing on the lobby channel

**FILE:** `multiplayer.js`
**ANCHOR (unique — the existing challenge listeners inside `joinLobby`):**
```
    lobbyCh.on('broadcast', { event: 'challenge' }, function (m) { onChallenge(m.payload); });
    lobbyCh.on('broadcast', { event: 'challenge-ans' }, function (m) { onChallengeAns(m.payload); });
```
**ACTION:** INSERT after those two lines:
```js
    // build8: open-room directory advertisements (host → everyone) + close notices
    lobbyCh.on('broadcast', { event: 'room-meta' }, function (m) { onRoomMeta(m.payload); });
    lobbyCh.on('broadcast', { event: 'room-gone' }, function (m) { var p = m.payload; if (p && p.rid) { delete roomsDir[p.rid]; renderRooms(); updateBrowseCount(); } });
    lobbyCh.on('broadcast', { event: 'room-ping' }, function () { if (room.id && room.isHost) advertiseRoom(); });   // late-joiner asks; hosts re-announce
    // build8: quick-match pairing broadcast (deterministic proposer avoids double-pair)
    lobbyCh.on('broadcast', { event: 'qm-pair' }, function (m) { onQuickPair(m.payload); });
```

### PATCH 5B — rebuild the room directory on every lobby sync; run the quick-match scan

**FILE:** `multiplayer.js`
**ANCHOR (unique — the end of `onLobbySync`, just before `renderRoster(hostId)`):**
```
    amHost = (hostId === ME.id);
    var hb = $('mpx-you-host'); if (hb) hb.hidden = !amHost;
    renderRoster(hostId);
  }
```
**ACTION:** REPLACE that closing region with (adds directory reconcile + quick-match attempt + browse-count refresh):
```js
    amHost = (hostId === ME.id);
    var hb = $('mpx-you-host'); if (hb) hb.hidden = !amHost;
    renderRoster(hostId);
    reconcileRoomsFromPresence();   // build8: drop rooms whose host vanished; learn new hosts
    updateBrowseCount();
    if (QM.looking) tryQuickPair();  // build8: someone new might be queued
  }
```

---

## 6. multiplayer.js — ROOMS: open / advertise / browse / join / spectate / close

### PATCH 6A — the whole rooms + quick-match block

**FILE:** `multiplayer.js`
**ANCHOR (unique — the comment that opens the track-picker section):**
```
  // ===================== TRACK PICKER (host) =====================
```
**ACTION:** INSERT the following block **immediately BEFORE** that comment:
```js
  // ===================== BUILD8: QUICK-MATCH =====================
  function toggleQuickMatch() {
    if (!supa || !lobbyCh) { banner('mpx-lobby-msg', 'Sign in to play online — quick-match needs a connection.'); return; }
    QM.looking = !QM.looking; QM.t = Date.now();
    paintQuickBtn(); reannounce();
    banner('mpx-lobby-msg', QM.looking ? 'Looking for a match — pairing you with the next available rival…' : '');
    if (QM.looking) tryQuickPair();
  }
  function paintQuickBtn() {
    var b = $('mpx-act-quick'); if (!b) return;
    b.setAttribute('aria-busy', QM.looking ? 'true' : 'false');
    var t = b.querySelector('.a-t'), d = b.querySelector('.a-d');
    if (t) t.textContent = QM.looking ? '⚡ Searching…' : '⚡ Quick Match';
    if (d) d.textContent = QM.looking ? 'Tap to cancel' : 'Auto-pair a random rival';
  }
  // Deterministic proposer: of the two queued ids, the lexicographically-smaller one emits the pair.
  // Both sides receive qm-pair and route into the SAME match channel — no race, no double match.
  function tryQuickPair() {
    if (!QM.looking || matchCh || matchLive) return;
    var cands = Object.keys(lobby).filter(function (id) {
      var p = lobby[id]; return id !== ME.id && p && p.lf && !p.inMatch && !p.room;
    });
    if (!cands.length) return;
    cands.sort();
    var opp = cands[0];
    if (ME.id < opp) {   // I propose
      var mid = newMatchId();
      lobbyCh.send({ type: 'broadcast', event: 'qm-pair', payload: { aId: ME.id, bId: opp, mid: mid } });
      QM.looking = false; paintQuickBtn(); reannounce();
      startMatchChannel(mid, 'host', lobby[opp]);   // proposer = host
    }
    // else: wait — the smaller id will propose and I'll catch it in onQuickPair
  }
  function onQuickPair(p) {
    if (!p || p.bId !== ME.id || !QM.looking) return;
    QM.looking = false; paintQuickBtn(); reannounce();
    startMatchChannel(p.mid, 'guest', lobby[p.aId]);  // I'm the callee = guest
  }

  // ===================== BUILD8: ROOMS =====================
  function newRoomId() { return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }
  function gotoRooms(mode) {   // mode: 'browse' | 'create'
    step('rooms');
    var br = $('mpx-rooms-browse'), cr = $('mpx-rooms-create');
    if (br) br.hidden = (mode === 'create');
    if (cr) cr.hidden = (mode !== 'create');
    banner('mpx-rooms-msg', '');
    if (mode === 'create') { var nm = $('mpx-room-name'); if (nm) { nm.value = ''; setTimeout(function () { nm.focus(); }, 30); } }
    else { try { if (lobbyCh) lobbyCh.send({ type: 'broadcast', event: 'room-ping', payload: { from: ME.id } }); } catch (e) {} renderRooms(); }
  }

  // ---- host: open / advertise / close ----
  function openRoom() {
    if (!supa || !lobbyCh) { banner('mpx-rooms-msg', 'Sign in to play online — rooms need a connection.'); return; }
    var nm = ($('mpx-room-name') && $('mpx-room-name').value || '').trim().slice(0, 28) || (ME.name + "'s Room");
    var priv = !!(screen.querySelector('#mpx-room-priv button.active') && screen.querySelector('#mpx-room-priv button.active').getAttribute('data-priv') === 'private');
    room = { id: newRoomId(), name: nm, priv: priv, isHost: true, ch: null, seat: 'p1', members: {}, p1: ME.id, p2: null };
    joinRoomChannel(room.id, 'p1');
    reannounce();
    enterRoomWaiting();
    advertiseRoom();
  }
  function advertiseRoom() {
    if (!lobbyCh || !room.id || !room.isHost) return;
    var count = 1 + (room.p2 ? 1 : 0);
    lobbyCh.send({ type: 'broadcast', event: 'room-meta', payload: {
      rid: room.id, name: room.name, priv: room.priv, hostId: ME.id, hostName: ME.name, count: count, max: 2, at: Date.now() } });
  }
  function closeRoom(silent) {
    if (room.id && room.isHost && lobbyCh) { try { lobbyCh.send({ type: 'broadcast', event: 'room-gone', payload: { rid: room.id } }); } catch (e) {} }
    leaveRoomChannel();
    room = { id: null, name: null, priv: false, isHost: false, ch: null, seat: null, members: {}, p1: null, p2: null };
    spectating = false; reannounce();
    if (!silent) { step('lobby'); banner('mpx-lobby-msg', ''); onLobbySync(); }
  }

  // ---- room presence channel (the waiting area; 2 seats + spectators) ----
  function joinRoomChannel(rid, seat) {
    leaveRoomChannel();
    room.id = rid; room.seat = seat;
    var ch = supa.channel('rr-room-' + rid, { config: { presence: { key: ME.id }, broadcast: { self: false } } });
    room.ch = ch;
    ch.on('presence', { event: 'sync' }, onRoomSync);
    ch.on('presence', { event: 'leave' }, onRoomSync);
    ch.on('broadcast', { event: 'room-start' }, function (m) { onRoomStart(m.payload); });
    ch.subscribe(function (status) {
      if (status === 'SUBSCRIBED') { ch.track({ id: ME.id, name: ME.name, avatar: ME.avatar, seat: seat, at: Date.now() }); }
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { banner('mpx-rooms-msg', 'Could not reach that room. Back out and retry.'); }
    });
  }
  function leaveRoomChannel() { try { if (room.ch) { room.ch.untrack(); supa.removeChannel(room.ch); } } catch (e) {} room.ch = null; }
  function onRoomSync() {
    if (!room.ch) return;
    var st = room.ch.presenceState();
    room.members = {};
    Object.keys(st).forEach(function (k) { var m = st[k] && st[k][0]; if (m && m.id) room.members[m.id] = m; });
    // seat assignment is host-authoritative: host = p1; first non-spec joiner = p2.
    if (room.isHost) {
      var others = Object.keys(room.members).filter(function (id) { return id !== ME.id && room.members[id].seat !== 'spec'; });
      var p2 = others[0] || null;
      if (p2 !== room.p2) { room.p2 = p2; advertiseRoom(); }
    }
    paintRoomWaiting();
  }
  // host launches: tells both seats to spin up the SAME match channel; spectators get the mid too.
  function startRoomMatch() {
    if (!room.isHost || !room.p2) return;
    var mid = 'm' + room.id.slice(1) + Date.now().toString(36).slice(-3);
    room.ch.send({ type: 'broadcast', event: 'room-start', payload: { mid: mid, p1Id: room.p1, p2Id: room.p2 } });
    onRoomStart({ mid: mid, p1Id: room.p1, p2Id: room.p2 });
  }
  function onRoomStart(p) {
    if (!p || !p.mid) return;
    var oppId = (ME.id === p.p1Id) ? p.p2Id : p.p1Id;
    var oppMetaLocal = room.members[oppId] || lobby[oppId] || null;
    if (room.seat === 'spec' || (ME.id !== p.p1Id && ME.id !== p.p2Id)) { spectateMatch(p.mid, room.members[p.p1Id], room.members[p.p2Id]); return; }
    var role = (ME.id === p.p1Id) ? 'host' : 'guest';
    var keepRoom = room.id;   // remember so winner→rematch can re-home into the room later if desired
    startMatchChannel(p.mid, role, oppMetaLocal);
    try { if (room.ch) { /* keep room channel alive so the lobby card stays; host re-advertises post-match */ } } catch (e) {}
  }

  // ---- guest: join a listed room (as duelist or spectator) ----
  function joinRoom(rid, asSpec) {
    if (!supa || !lobbyCh) return;
    var meta = roomsDir[rid]; if (!meta) { banner('mpx-rooms-msg', 'That room just closed.'); return; }
    if (!asSpec && meta.count >= meta.max) { banner('mpx-rooms-msg', 'Room is full — spectate instead.'); return; }
    room = { id: rid, name: meta.name, priv: meta.priv, isHost: false, ch: null, seat: asSpec ? 'spec' : 'p2', members: {}, p1: meta.hostId, p2: asSpec ? null : ME.id };
    spectating = !!asSpec;
    joinRoomChannel(rid, room.seat);
    reannounce();
    enterRoomWaiting();
  }

  // ---- waiting-room view (reuses the setup step shell) ----
  function enterRoomWaiting() {
    enterSetup();   // reuse the existing setup UI (track pick disabled for non-host as usual)
    var ctx = $('mpx-roomctx'); if (ctx) ctx.hidden = false;
    var nmEl = $('mpx-roomctx-name'); if (nmEl) nmEl.textContent = room.name || 'Room';
    var pv = $('mpx-roomctx-priv'); if (pv) pv.textContent = room.priv ? '· PRIVATE' : '· PUBLIC';
    var closeBtn = $('mpx-room-close');
    if (closeBtn) closeBtn.textContent = room.isHost ? 'CLOSE ROOM' : 'LEAVE ROOM';
    // host picks the track (already gated by matchRole in enterSetup); in a room, p1/host drives.
    paintRoomWaiting();
  }
  function paintRoomWaiting() {
    var specCount = Object.keys(room.members).filter(function (id) { return room.members[id].seat === 'spec'; }).length;
    var sc = $('mpx-roomctx-spec'); if (sc) sc.textContent = specCount ? (specCount + ' watching') : '';
    // mirror opponent presence into the setup vsbar dot
    var opp = room.isHost ? (room.p2 && room.members[room.p2]) : (room.members[room.p1]);
    var dot = $('mpx-dot-opp');
    if (dot) {
      if (opp) { dot.setAttribute('data-state', 'here'); dot.textContent = (opp.name || 'OPPONENT').slice(0, 12); }
      else { dot.setAttribute('data-state', 'waiting'); dot.textContent = spectating ? 'WATCHING' : 'WAITING…'; }
    }
  }

  // ---- room directory (browser) ----
  function onRoomMeta(p) {
    if (!p || !p.rid || p.priv) return;   // private rooms are not listed (invite/qm only)
    if (p.hostId === ME.id) return;
    roomsDir[p.rid] = p; roomsDir[p.rid].at = Date.now();
    renderRooms(); updateBrowseCount();
  }
  function reconcileRoomsFromPresence() {
    // a room is only real if its host is still present in the lobby; prune stale cards.
    Object.keys(roomsDir).forEach(function (rid) {
      var hid = roomsDir[rid].hostId;
      if (!lobby[hid] || lobby[hid].hostRoom !== rid) {
        if (Date.now() - (roomsDir[rid].at || 0) > 4000) delete roomsDir[rid];   // grace for meta lag
      }
    });
  }
  function openRoomCount() { return Object.keys(roomsDir).length; }
  function updateBrowseCount() {
    var n = openRoomCount();
    var el = $('mpx-act-browse-n'); if (el) el.textContent = n ? ('(' + n + ')') : '';
  }
  function renderRooms() {
    var host = $('mpx-roomlist'); if (!host) return;
    var ids = Object.keys(roomsDir);
    var empty = $('mpx-rooms-empty'); if (empty) empty.hidden = ids.length !== 0;
    host.innerHTML = ids.map(function (rid) {
      var r = roomsDir[rid], full = (r.count || 1) >= (r.max || 2);
      return '<div class="mpx-roomcard' + (full ? ' full' : '') + '">' +
        '<span class="mpx-rc-spark">🎸</span>' +
        '<span class="mpx-rc-meta"><span class="mpx-rc-name">' + esc(r.name || 'Room') + '</span>' +
        '<span class="mpx-rc-sub"><span class="mpx-rc-tag pub">PUBLIC</span> host ' + esc((r.hostName || 'host')) + ' · <span class="mpx-rc-count">' + (r.count || 1) + '/' + (r.max || 2) + '</span></span></span>' +
        '<span class="mpx-rc-act">' +
          '<button class="mpx-rc-join" data-join="' + esc(rid) + '"' + (full ? ' disabled' : '') + '>' + (full ? 'FULL' : 'JOIN') + '</button>' +
          '<button class="mpx-rc-spec" data-spec="' + esc(rid) + '">WATCH</button>' +
        '</span></div>';
    }).join('');
    [].forEach.call(host.querySelectorAll('[data-join]'), function (b) { b.addEventListener('click', function () { joinRoom(b.getAttribute('data-join'), false); }); });
    [].forEach.call(host.querySelectorAll('[data-spec]'), function (b) { b.addEventListener('click', function () { joinRoom(b.getAttribute('data-spec'), true); }); });
  }

  // ===================== BUILD8: SPECTATE =====================
  function spectateMatch(mid, p1meta, p2meta) {
    spectating = true; matchLive = true; finishedLocal = true;   // finishedLocal=true → never wait on "my" result
    oppMeta = p1meta || p2meta || null;
    step('go'); var gn = $('mpx-go-num'); if (gn) gn.textContent = 'SPECTATING';
    var watchCh = supa.channel('rr-match-' + mid, { config: { presence: { key: ME.id }, broadcast: { self: false } } });
    matchCh = watchCh;
    var who = { a: p1meta, b: p2meta };
    watchCh.on('broadcast', { event: 'tick' }, function (m) { lastOppTick = m.payload; });
    watchCh.on('broadcast', { event: 'final' }, function (m) { oppFinal = m.payload; myFinal = myFinal || { score: 0 }; showWinner(); });
    watchCh.subscribe(function (status) {
      if (status === 'SUBSCRIBED') {
        // mount a read-only panel over whatever screen is up; spectators don't run the engine.
        screen.classList.add('active'); activeNow = true;
        mountOppPanel();
        var panel = $('mp-opp'); if (panel) panel.classList.add('spectate');
        var sp = panel && panel.querySelector('.mo-spec'); if (!sp && panel) { var s = document.createElement('div'); s.className = 'mo-spec'; s.textContent = 'SPECTATING'; panel.insertBefore(s, panel.firstChild); }
        startSpectatorTick();
      }
    });
  }
  function startSpectatorTick() {
    stopTick();
    function frame() { oppRaf = requestAnimationFrame(frame); if (oppPanel && oppPanel.parentNode) renderOpp(null); }
    oppRaf = requestAnimationFrame(frame);
  }
```

> **Why `mountOppPanel` works for spectators:** it appends `#mp-opp` to `#game`; spectators stay on the MP screen
> with the panel floating, fed purely by the room's `tick` broadcast. No engine launch, no audio, no scoring — read
> only. The existing `renderOpp()` already paints score/combo/progress from `lastOppTick`.

---

## 7. multiplayer.js — WIRE THE NEW CONTROLS

### PATCH 7A — bind the lobby action bar + rooms/room-form/quick-match buttons

**FILE:** `multiplayer.js`
**ANCHOR (unique — the existing wiring block start):**
```
  // ===================== WIRING =====================
  function wire(id, ev, fn) { var el = $(id); if (el) el.addEventListener(ev, fn); }
  wire('mpx-leave-setup', 'click', backToLobby);
```
**ACTION:** INSERT after the `wire('mpx-leave-setup', 'click', backToLobby);` line:
```js
  // build8: lobby action bar
  wire('mpx-act-quick', 'click', toggleQuickMatch);
  wire('mpx-act-open', 'click', function () { gotoRooms('create'); });
  wire('mpx-act-browse', 'click', function () { gotoRooms('browse'); });
  // build8: rooms step
  wire('mpx-rooms-refresh', 'click', function () { try { if (lobbyCh) lobbyCh.send({ type: 'broadcast', event: 'room-ping', payload: { from: ME.id } }); } catch (e) {} renderRooms(); });
  wire('mpx-rooms-back', 'click', function () { step('lobby'); onLobbySync(); });
  wire('mpx-room-create-go', 'click', openRoom);
  wire('mpx-room-create-cancel', 'click', function () { step('lobby'); onLobbySync(); });
  wire('mpx-room-priv', 'click', function (e) { var b = e.target.closest('button'); if (!b) return; [].forEach.call(this.children, function (x) { x.classList.toggle('active', x === b); }); });
  // build8: room context (inside setup) — host closes / guest leaves
  wire('mpx-room-close', 'click', function () { if (room.isHost) closeRoom(); else { leaveRoomChannel(); room = { id: null, name: null, priv: false, isHost: false, ch: null, seat: null, members: {}, p1: null, p2: null }; spectating = false; reannounce(); backToLobby(); } });
```

### PATCH 7B — host READY in a room launches the room match (not the lobby maybeStart)

The cleanest hook: when a room host is set up and both seats are filled, the existing READY check should fire
`startRoomMatch()` instead of `maybeStart()`. `maybeStart()` is host-only and gated on `meReady && oppReady`. In a
room, the host READY + a present p2 is sufficient (the guest also taps READY → same broadcast). We branch inside
`maybeStart`.

**FILE:** `multiplayer.js`
**ANCHOR (unique — the whole `maybeStart` body):**
```
  function maybeStart() {
    if (meReady && oppReady && sel.trackId && matchRole === 'host') {
      var atMs = Date.now() + 1300;          // lead-in so both schedule together
      matchCh.send({ type: 'broadcast', event: 'start', payload: { atMs: atMs, sel: sel } });
      beginMatch(atMs, sel);
    }
  }
```
**ACTION:** REPLACE that whole function with (room path delegates to the room channel start; non-room path unchanged).
**The decisive guard is `!matchCh`:** in the room *waiting area* there is no match channel yet → the room path fires;
after the room hands off, `matchCh` is set → the normal `matchCh` start path runs. (No separate guard patch needed.)
```js
  function maybeStart() {
    // build8: in the ROOM WAITING AREA (no match channel yet), the host's start rides the ROOM
    // channel via room-start; both seated players then open the same rr-match-<mid>. Once that
    // match channel exists (matchCh set) — including quick-match, challenge, and the room handoff —
    // we take the original synchronized-start path below.
    if (room.id && room.isHost && !matchCh && meReady && oppReady && sel.trackId) { startRoomMatch(); return; }
    if (meReady && oppReady && sel.trackId && matchRole === 'host' && matchCh) {
      var atMs = Date.now() + 1300;          // lead-in so both schedule together
      matchCh.send({ type: 'broadcast', event: 'start', payload: { atMs: atMs, sel: sel } });
      beginMatch(atMs, sel);
    }
  }
```

> **Important seam:** when a room match starts, `startRoomMatch()` → `onRoomStart()` → `startMatchChannel(mid,…)`.
> `startMatchChannel` calls `teardownMatch()` first (safe), then re-`enterSetup()`. The two seated players are
> *already READY in the room*; PATCH 7C re-arms READY on the fresh match channel automatically, so play starts
> without a second ready-tap. Because `matchCh` is now set, this re-armed `maybeStart()` takes the **lower
> `matchCh` branch** (synchronized start) — it does NOT re-enter `startRoomMatch()` (the `!matchCh` guard blocks it).

### PATCH 7C — auto-arm READY when a room hands off to its match channel

So players don't tap READY twice (once in the room, once in the match), carry the room-ready intent across the
handoff. `enterSetup()` runs both for rooms *and* the post-handoff match. We pre-arm when entering setup from a
room start.

**FILE:** `multiplayer.js`
**ANCHOR (unique — inside `onRoomStart`, the line that opens the match):**
```
    var role = (ME.id === p.p1Id) ? 'host' : 'guest';
    var keepRoom = room.id;   // remember so winner→rematch can re-home into the room later if desired
    startMatchChannel(p.mid, role, oppMetaLocal);
```
**ACTION:** REPLACE those three lines with (mark a one-shot “came from room, auto-ready + auto-pick-carry”):
```js
    var role = (ME.id === p.p1Id) ? 'host' : 'guest';
    _fromRoom = { sel: (sel.trackId ? Object.assign({}, sel) : null) };   // carry host's locked track
    startMatchChannel(p.mid, role, oppMetaLocal);
```
Then add the `_fromRoom` declaration and consume it. **ANCHOR (unique — the state insert from PATCH 4C):**
```
  var spectating = false;         // joined a match purely as a watcher
```
**ACTION:** INSERT after it:
```js
  var _fromRoom = null;           // build8: one-shot carry across room→match handoff
```
And consume it at the end of `enterSetup()`. **ANCHOR (unique — the last line of `enterSetup`):**
```
    banner('mpx-setup-msg', '');
    paintSelection(); refreshReadyEnabled();
  }
```
**ACTION:** REPLACE that closing region with:
```js
    banner('mpx-setup-msg', '');
    // build8: room→match handoff — restore the host's locked track + auto-arm READY so play starts
    // without a second ready-tap (both already readied in the room).
    if (_fromRoom) {
      if (_fromRoom.sel) { sel = _fromRoom.sel; paintSelection(); }
      var fr = _fromRoom; _fromRoom = null;
      setTimeout(function () {
        try {
          if (matchRole === 'host' && sel.trackId) broadcastSong();
          if (sel.trackId && oppPresent) { meReady = true; setReadyBtn();
            if (matchCh) matchCh.send({ type: 'broadcast', event: 'ready', payload: { ready: true, id: ME.id } });
            maybeStart();
          }
        } catch (e) {}
      }, 350);   // let opponent presence land on the new channel
    }
    paintSelection(); refreshReadyEnabled();
  }
```

> Note: in the *post-handoff* match, `room.isHost` is still true but the match is now driven by `matchCh`. The
> PATCH 7B branch `if (room.id && room.isHost …) startRoomMatch()` would mis-fire. Guard it — see PATCH 7D.

### PATCH 7D — (folded into 7B) no action

The `!matchCh` guard is already baked into the `maybeStart()` replacement in PATCH 7B, so there is **no separate
edit here**. Kept as a numbered step only so the §11 test references line up. Verify in testing that a room handoff
and a subsequent REMATCH never re-enter `startRoomMatch()` (test 6).

---

## 8. multiplayer.js — TEARDOWN / RETURN PATHS (rooms must clean up too)

### PATCH 8A — leaving the MP screen / lobby also drops the room

**FILE:** `multiplayer.js`
**ANCHOR (unique — `leaveAll`):**
```
  function leaveAll() {
    teardownMatch();
    try { if (lobbyCh) { lobbyCh.untrack(); supa.removeChannel(lobbyCh); } } catch (e) {}
    lobbyCh = null; lobby = {};
```
**ACTION:** REPLACE that head of `leaveAll` with (close any open/joined room first):
```js
  function leaveAll() {
    try { closeRoom(true); } catch (e) {}    // build8: host closes / guest leaves room cleanly
    QM.looking = false;                       // build8: drop quick-match queue
    teardownMatch();
    try { if (lobbyCh) { lobbyCh.untrack(); supa.removeChannel(lobbyCh); } } catch (e) {}
    lobbyCh = null; lobby = {};
```

### PATCH 8B — `backToLobby` clears quick-match + repaints the action bar

**FILE:** `multiplayer.js`
**ANCHOR (unique — `backToLobby`):**
```
  function backToLobby() { teardownMatch(); step('lobby'); banner('mpx-lobby-msg', ''); onLobbySync(); }
```
**ACTION:** REPLACE with:
```js
  function backToLobby() {
    teardownMatch();
    QM.looking = false; paintQuickBtn();   // build8
    step('lobby'); banner('mpx-lobby-msg', ''); onLobbySync();
  }
```

### PATCH 8C — beforeunload + #mp-back drop the room channel too

**FILE:** `multiplayer.js`
**ANCHOR (unique — the beforeunload cleanup):**
```
  window.addEventListener('beforeunload', function () { try { if (matchCh) matchCh.untrack(); if (lobbyCh) lobbyCh.untrack(); } catch (e) {} });
```
**ACTION:** REPLACE with (untrack the room channel as well, and tell the lobby the room is gone if I host it):
```js
  window.addEventListener('beforeunload', function () { try {
    if (room.id && room.isHost && lobbyCh) lobbyCh.send({ type: 'broadcast', event: 'room-gone', payload: { rid: room.id } });
    if (room.ch) room.ch.untrack(); if (matchCh) matchCh.untrack(); if (lobbyCh) lobbyCh.untrack();
  } catch (e) {} });
```

### PATCH 8D — `onActivated` resets the new UI (action bar + step) on (re)entry

**FILE:** `multiplayer.js`
**ANCHOR (unique — `onActivated`):**
```
  function onActivated() {
    paintYou();
    if (!matchLive && (!matchCh)) step('lobby');   // don't reset a returning winner overlay
    banner('mpx-lobby-msg', '');
    joinLobby();
  }
```
**ACTION:** REPLACE with:
```js
  function onActivated() {
    paintYou();
    if (!matchLive && (!matchCh)) step('lobby');   // don't reset a returning winner overlay
    banner('mpx-lobby-msg', '');
    paintQuickBtn(); updateBrowseCount();           // build8
    joinLobby();
  }
```

---

## 9. multiplayer.js — REMATCH from a room / quick-match (already works; one guard)

`resetForRematch()` (existing) returns both players to the setup step on the SAME match channel. For room/quick
matches the match channel persists, so REMATCH already works unchanged. The only nicety: a rematch should NOT try
to re-enter the room path. Since `matchCh` is still set during a rematch, PATCH 7D's `!matchCh` guard already makes
`maybeStart()` take the normal match path. **No extra patch needed** — just verify in testing (see §11, test 6).

---

## 10. OPTIONAL Lovable brief — persisted / cross-session room list (NOT required for core)

Core rooms work purely client-side (presence + broadcast); a host’s room exists only while their tab is open. If
the user later wants rooms that survive a host refresh, appear instantly on cold load, or carry a max>2 spectator
roster cap server-side, hand Lovable this:

> **Reactive Rhythm — persisted MP rooms (optional).**
> Add a lightweight `mp_rooms` table + 3 edge routes under the existing `game-catalog` function (anon read OK,
> writes require the same anon key the game already uses):
> - `POST /mp/rooms` `{name,priv,host_id,host_name}` → `{rid}` (creates a row, `status:'open'`, `expires_at = now()+15m`).
> - `GET /mp/rooms` → `[{rid,name,priv:false,host_name,count,max,created_at}]` (public + non-expired only; the
>   game already filters private locally).
> - `POST /mp/rooms/:rid/close` `{host_id}` → marks `status:'closed'`.
> Heartbeat: the client re-`POST`s `/mp/rooms/:rid/touch` every 30s to push `expires_at`; rows past `expires_at`
> are filtered out server-side (a cron/`now()` filter). Realtime presence stays the source of truth for *live*
> player counts — this table is only the **discovery list** so rooms appear without a host broadcast. The client
> should treat all three as best-effort: on any non-200, fall back to the presence/broadcast directory (§5–6).
> No schema migration is mandatory for launch; this is a polish/scale item.

---

## 11. INTEGRATOR VERIFY CHECKLIST (apply serially, then preview-test)

1. `node --check multiplayer.js` after applying (no syntax errors). Bump `?v` once across the four tags + jukebox.css.
2. **Two preview tabs** (Claude_Preview `rhythm-rift`; `location.href + '?cb=' + Date.now()`; never `location.replace`).
   Sign in (or guest) in both; open Multiplayer in both → each sees the other in the roster (regression: existing
   challenge flow still works end-to-end).
3. **Open a room (tab A):** action bar → OPEN A ROOM → name + PUBLIC → OPEN ROOM. Tab A lands in the room waiting
   area (setup step with the room-context strip). **Tab B:** BROWSE ROOMS → the card appears (host name, 1/2,
   PUBLIC) → JOIN → both in the room; host’s dot shows the guest, `1/2`→`2/2` on the card.
4. **Start from the room:** host picks a track + READY; guest READY → both hand off into a normal match (combo/score
   climb only on the real machine; in preview confirm `step('go')` then engine takes over with no console errors).
   `window.__rrDebug.state()` should read `playing` in both.
5. **Quick-Match:** in two tabs hit ⚡ Quick Match within a few seconds → exactly one match channel forms (the
   lexicographically-smaller id proposes), both enter setup. Cancel works (tap again → flag clears, no pairing).
6. **REMATCH** from a room/QM winner → both return to setup on the same channel, can re-ready and replay.
7. **Spectate:** with a room match live (tabs A+B), a third tab C → BROWSE → WATCH on that room → C sees the floating
   `#mp-opp` panel with SPECTATING + a live score bar fed by broadcast (no audio, no engine in C). When the match
   ends, C’s winner card shows both finals.
8. **Graceful close:** host closes room / leaves tab → card vanishes from B/C within ~4s (presence prune + room-gone).
9. **Offline:** load with no network / no `supa` → lobby shows the sign-in banner; the three action-bar buttons are
   inert (guarded on `supa`/`lobbyCh`); rest of the game unaffected.
10. `preview_console_logs` level error = clean at the end.

---

## 12. EVERY ANCHOR USED (for the integrator’s grep)

**index.html**
- CSS append: `html.rr-reduce-motion .mpx-challenge:hover { transform: none; }`
- lobby `<p class="mp-sub">` line beginning `Everyone online is below. Challenge anyone…`
- `<!-- STEP: MATCH-SETUP (lock song, ready check) -->`
- `<div class="mpx-step mpx-step-setup" hidden>` + next line `<div class="mpx-vsbar">`
- `<button class="mh-tile" id="mh-multiplayer" type="button">` + `<span class="mh-soon">SOON</span>`

**multiplayer.js**
- `['lobby', 'setup', 'go', 'winner'].forEach(function (s) {` (step switcher)
- `function myPresence(inMatch) { return { id: ME.id, … inMatch: !!inMatch }; }`
- `var activeNow = false;          // is #multiplayer-screen currently .active`
- `lobbyCh.on('broadcast', { event: 'challenge-ans' }, function (m) { onChallengeAns(m.payload); });`
- `amHost = (hostId === ME.id);` … `renderRoster(hostId);` (end of `onLobbySync`)
- `// ===================== TRACK PICKER (host) =====================`
- `// ===================== WIRING =====================` + `wire('mpx-leave-setup', 'click', backToLobby);`
- `function maybeStart() { … }` (full body)
- `var spectating = false;         // joined a match purely as a watcher`
- `banner('mpx-setup-msg', ''); paintSelection(); refreshReadyEnabled(); }` (end of `enterSetup`)
- `function leaveAll() { teardownMatch(); …`
- `function backToLobby() { teardownMatch(); step('lobby'); …`
- `window.addEventListener('beforeunload', function () { … });`
- `function onActivated() { paintYou(); …`

---

## 13. ASSET / SELF-HEAL NOTES
- **No new image assets required.** Room cards use a 🎸 glyph in `.mpx-rc-spark` and 🜨/⚡/＋ glyphs in the action bar
  (pure text, on-brand crimson/ember/gold via CSS). If the user prefers iconography over emoji, swap the glyph spans
  for inline SVGs later — not load-bearing.
- **Degrade-offline is built in:** every new entry point (`toggleQuickMatch`, `openRoom`, `joinRoom`, `gotoRooms`)
  guards on `supa`/`lobbyCh` and shows the existing banner; the game core is untouched when realtime is absent.
- **reduceMotion/fxLite-safe:** the only transitions are tiny hover lifts on `.mpx-act`/`.mpx-roomcard`, and an
  `html.rr-reduce-motion .mpx-actionbar .mpx-act:hover { transform: none; }` rule is included.
- **No `?v` bump in this doc** — integrator bumps the four script tags + `jukebox.css` once after applying.
