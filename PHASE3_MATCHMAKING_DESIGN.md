# PHASE 3 — SITE-WIDE MATCHMAKING: implementation spec

> Owner-locked (2026-07-01 form): "Available for a match" toggle **top-right of the site Navbar, logged-in users
> only** → **first-available** pairing → **one player picks the song, the other accepts** → optional **BONUS-Sparks
> wager** (never cashable — decree) → rollout straight to everyone.
> Grounded in the Phase-0/2 recon (PHASE2_LIVESHOW_DESIGN.md seam findings) + the backend contract dispatched to
> Lovable 2026-07-02 (message umsg_01kwgpn422f12tbw8makby06en). Verify the backend report before building.

## Backend contract (Lovable workstream 4 — confirm shapes from its report)
- Table `rr_match_queue` {user_id PK, display_name, avatar_url, status 'waiting'|'matched', matched_room, role
  'host'|'guest', entered_at, last_seen}; RLS own-row only; realtime-published.
- `POST /match/queue {on:bool}` (authed) — upsert/delete own row; server-side pairer matches the two OLDEST waiting
  (45s freshness), mints `matched_room = 'qm########'`, assigns older=host / newer=guest.
- `GET /match/status` (authed) → `{status, matched_room, role}` | `{status:'idle'}`.
- Stale sweep server-side (2min). Client heartbeat = re-POST {on:true} every ~30s while toggled on.

## Design decision: matched pair lands in a normal MP ROOM (not a raw match channel)
The existing room flow already gives us everything the owner asked for: the HOST picks the song (owner: "one player
picks"), the guest sees the pick + READY (= "other accepts"), then the standard start/versus/settle machinery runs.
- HOST client: opens a room with the FORCED rid = matched_room (openRoom currently generates its own id — add an
  internal `openRoomWithId(rid, opts)` or an opts param; channels are unregistered strings so any rid works), priv:true
  (not listed in the browser — it's a private paired match), then advertises on the lobby so the guest's ?mproom
  auto-join handshake works (build60 room-ping path, multiplayer.js ~397-420).
- GUEST client: the existing `?mproom=<rid>` deep-link path (build102 groundwork: auto-opens MP at boot; onRoomMeta
  auto-joins even private rooms).

## Game-side work (multiplayer.js + catalog.js + index.html)
1. `RhythmMP.queueMatch(on)` public API + a `?mpqm=1` deep link: opens MP, POSTs /match/queue via a new
   RhythmCatalog.matchQueue(on) helper (api() with auth), then polls GET /match/status every 4s (or subscribes to the
   caller's own rr_match_queue row via realtime postgres_changes — own-row SELECT policy allows it; VERIFY realtime
   actually delivers before relying on it, else poll).
2. On `status:'matched'`: role==='host' → openRoomWithId(matched_room, {priv:true, qm:true}) + banner "Matched! Pick
   the song."; role==='guest' → the ?mproom join path with banner "Matched! <host> picks the song — READY up when
   you see it."
3. In-GAME toggle surface (independent of the site Navbar): a small "🎯 FIND ME A MATCH" toggle on the MP lobby step
   (mpx-step-lobby) wired to queueMatch — ships value even before the site toggle exists.
4. Timeout UX: no match in 90s → keep waiting quietly + show "still looking… (you can keep browsing)"; the queue row
   heartbeat keeps it alive. Toggle off → POST {on:false}.
5. WAGER (after Lovable ships /wager/* routes — workstream 3): flip catalog.js `bonusServerReady()` gating
   (`bonus_wager_server_pending` hard-refusal) to call the real endpoints; then a stake-handshake on the paired room:
   host proposes a Bonus-Sparks stake (existing RhythmWager UI patterns from the tournament STAKES row), guest
   confirms, both /wager/join(pot_id='pool_'+rid); settle inside showWinner via /wager/settle; refund on
   oppLeft/teardown via /wager/cancel. BONUS SPARKS ONLY — decree. Keep wagers OFF ranked recording changes.
6. recordMpResult already handles ranked W/L locally; server settle (Lovable workstream 2) now persists rounds — pass
   the round_id through as today (mpRoundStart fire-and-forget stays).

## Site-side work (Lovable, LAST pass once game-side ships)
- Navbar utility cluster (between SparkBalance and NotificationCenter, logged-in only): "⚔ Available for a match"
  toggle → same /match/queue API → on 'matched', deep-link the user to
  `/game/index.html?mproom=<matched_room>&skipIntro=1` (guest) — the HOST side needs `?mpqm=host&room=<rid>`? NO —
  simpler: the SITE toggle only queues; when matched, site pops a "MATCH FOUND — Jump in" CTA linking to
  `/game/index.html?mpqm=resume` and the game's queueMatch(status) pickup does the role routing (game asks
  /match/status at boot when ?mpqm present). One URL, no role leakage in links.
- URL guard: /game/ prefix, no //, no whitespace (same as notification CTA).

## Judge-mandated cautions (carry from Phase-2 reviews)
- Presence/roster: NEVER native Supabase presence; the queue is a server table precisely to avoid softPresence scale
  limits. Do not surface a public roster (RLS is own-row by design — no browsing who's available).
- Normal MP byte-identity: all new paths behind qm flags/params.
- No tokens in broadcasts. isTrusted-guard any auto-firing UI.
- Client-trusted scores: ranked/wagered results ride clamped server settle (workstream 2) — do not add new
  client-authoritative money paths; wager settle should ideally verify against mp_round_scores (note in Lovable pass).
- Adversarial diff review before every push (the C1/C2 process — it caught 15 real bugs across two increments).

## Sequencing
1. ✅ Backend (queue + settle + wager routes + live-match chip) — dispatched, verify report.
2. Game-side: openRoomWithId + queueMatch + ?mpqm + lobby toggle + matched hand-off (build agent, then adversarial
   review, then ship).
3. Game-side wager handshake on paired rooms (needs /wager/* shapes from the report).
4. Site Navbar toggle + MATCH FOUND CTA (Lovable, after 2 ships).
5. Owner 2-browser test: two accounts toggle on → paired → host picks → versus → verdict (+ wager round-trip).
