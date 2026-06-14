# Multiplayer — Server-Authoritative Scoring (backend brief for Lovable)

> **Status:** Multiplayer is fully built and works end-to-end on the client (open lobby, public/private
> rooms, 1v1, 5–10-player single-elimination tournament, correct `softPresence` broadcast-heartbeat
> roster). It is **gated OFF for the public beta** (`MP_PUBLIC = false` in `index.html`, hub tile shows
> "opens soon"; `?dev=1` still opens it). This brief is the backend work required to flip it on for
> **ranked / competitive** play. Until then MP ships as dev-only.

## The problem (why it's held)

Match results are **unsigned peer broadcast**. Each client computes its own score in the engine and
broadcasts a `t-final` / `final` message over the shared Supabase Realtime channel; the host (or the
peers) accept the first payload's score **verbatim** and advance the bracket on it. Relevant client
code (`multiplayer.js`): `1154` (tournament `t-final` send), `1159–1187` (`onTourFinal` / `trySettlePair`
trust the raw payload score), `577–578` (1v1 `onFinal` / `settleIfReady`).

Consequences:
- A modified client can broadcast any score → win any match / tournament.
- No server record of who actually won; the bracket is decided entirely client-side.
- Fine for **casual / for-fun** play; **unacceptable** for leaderboards, prizes, or anything ranked.

## Goal

A **server-authoritative** path so the backend — not a peer — decides each match/round result, using the
score the engine already submits to the server for solo plays. The client keeps driving the UX; the
server is the source of truth for **who advances** and **final standings**.

## What already exists to build on

- The solo engine already submits authenticated results to the catalog backend on every run
  (`RhythmCatalog.onSubmitResult` → the game-catalog Supabase functions, e.g. `POST /plays`, `/score`),
  including `score`, `accuracy`, `notes_total`, `notes_hit`, `max_combo`, `grade`, a per-attempt
  `play_token`, and the authenticated user. **This is the trustworthy score channel.** MP should reuse it
  rather than invent a second, unsigned one.
- Each MP match already has a shared room/tournament id and a per-round track id (`tour.sel` / the room's
  selected track) and a known roster of authenticated user ids (via `softPresence`).

## Proposed design (server owns the result)

Add a small set of Supabase functions (or extend `game-catalog`). Suggested shape:

### 1. `POST /mp/round` — open a scored round
Host (or matchmaker) calls this when a round/match starts.
```
req:  { roomId, roundId, trackId, difficulty, playerIds:[uuid,...], mode:'1v1'|'tournament' }
res:  { roundId, playToken }   // a round-scoped token the server ties submissions to
```
Server records the round, its players, and the expected `trackId`/`difficulty`.

### 2. Reuse the existing solo submission, tagged with the round
When a player finishes, the **engine's normal authenticated result submission** carries the MP context:
```
POST /score (existing) + { roundId, roomId }
```
The server validates the result the same way it validates a solo score (auth user, play_token, the
documented `score ≤ notes_total * 1500` ceiling, `notes_total` matching the server's chart for that
`trackId` if server-charted, plausible accuracy/combo), and stores it **against the round** for that user.

> Note: the client score model has one open question to settle here — hold-note **sustain** payout can
> push a legitimate score slightly over `notes_total * 1500` (the head scores up to 1500 AND the sustain
> adds on top while the hold counts as one note). Decide the canonical rule: either fold sustain into the
> head's 1500 budget on the client, or have `notes_total` include sustain weight, so the server ceiling
> check matches the client. (This is also a standalone fix flagged in the solo audit.)

### 3. `GET /mp/round/:roundId/result` — the authoritative outcome
Any client polls/subscribes for the settled result.
```
res:  { roundId, settled:bool, scores:{ [uuid]: {score,accuracy,grade} }, winnerId }
```
Server decides `winnerId` from the **server-stored** scores (highest valid score; tie-break by accuracy
then combo), once all players have submitted **or** a timeout elapses (forfeit absent players).

### 4. (Tournament) the server advances the bracket
The host still *drives* round transitions in the UI, but `winnerId` for each pair comes from
`/mp/round/.../result`, not from a peer's broadcast. The bracket structure can stay client-rendered;
only **who advances** must come from the server.

## Client changes (game side — small, done when you greenlight)

- Replace "trust the peer's `t-final` score" with "submit my result tagged with `roundId`, then read the
  authoritative `winnerId` from the server." Keep the broadcast for **liveness/UX** (showing opponents'
  progress) but never for the binding result.
- Call `/mp/round` at round start; gate bracket advancement on `/mp/round/.../result`.
- Flip `MP_PUBLIC = true` (index.html) once the above is live and tested.

## Also worth deciding (separate from scoring, surfaced by the audit)

- **Host migration:** today if the room/tournament host drops, the whole bracket dissolves
  (`multiplayer.js:935–940, 709–715`). For 5–10-player events, elect a new referee (mirror the lobby's
  smallest-id host election at `multiplayer.js:256`). A server-authoritative result model makes this
  easier (the server, not the host, holds the truth).
- **Round 2+ track:** `hostNextTrack` currently picks a **new random** catalog track each tournament
  round (`multiplayer.js:1079–1085, 1188–1200`); only round 1 honors the host's pick. Decide whether the
  host should pick per round (carry `tour.sel`/a host playlist forward) or random-per-round is intended.
- **Timing-fragile handoffs:** the invite-link join waits a blind 5s and room→match auto-arms READY after
  350ms (`multiplayer.js:238, 378–390`). Replace fixed delays with state-driven retries gated on the
  `oppPresent` flag so slow networks don't stall a match at WAITING.

## Acceptance criteria

- A modified client cannot win a match it didn't actually score highest in (server rejects/ignores the
  spoofed peer score; `winnerId` comes only from server-stored, validated submissions).
- `score ≤ notes_total * 1500` (post-sustain-decision) holds server-side; mismatched `notes_total` for a
  server-charted track is rejected.
- A disconnecting player forfeits cleanly (timeout) without hanging the round.
- Casual/unranked rooms can still run **without** this path (keep the current peer flow behind a
  `ranked:false` flag) so casual play isn't blocked by the backend dependency.

---
*Client reference points: `multiplayer.js` lines cited above; the solo submission path is
`RhythmCatalog.onSubmitResult` → game-catalog functions. The MP UI + softPresence layer are complete and
correct — this brief is purely the trust/validation backend.*
