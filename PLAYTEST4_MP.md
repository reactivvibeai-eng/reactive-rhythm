# Multiplayer playtest-4 (group, on live ?v=437) — issue tracker

Full MP eval by the owner + a group. Confirmed WORKING: calling the submitter in from the live panel
(started the match ✓), challenging into a room ✓, tournament mode mostly ✓. The failures below are being
root-caused (2 read-only Opus investigations) then fixed in careful batches; MP fixes go to PREVIEW for a
2-account test before publish. See [[reactive-rhythm-mp-showroom-seat-cluster]] + the multiplayer-spec memory.

## 🔴 P0 — broken
1. **Website auto-match strands a player.** Auto-match ON → call comes in → one player enters the match, the
   OTHER lands on the game start menu and never joins; never initiates. → battle-call/matchmaking path
   (Lovable `pair_rr_match_queue` must broadcast the live_match_invite with role + SAME room to BOTH; game
   must join it). Flagged to Lovable; game-side hardening after root-cause.
2. **Normal challenge plays the DEFAULT song**, not the picked one. Song-sync drop on the in-game CHALLENGE
   path (guest doesn't get host `sel.trackId` before beginMatch, or resolveAndStart falls back to demo).
3. **Local co-op (2 controllers) — P2 half blank.** One side plays; the other has no guitar + no way to play.
   (Local 2-controller was historically DEFERRED — P2 render likely incomplete, not just regressed.) couch.js.
4. **Tournament final round: no winner, empty round.** Bracket should declare champion at 1-left; instead
   advances to a round with no opponent. Off-by-one / missing terminal condition.
5. **Combat/damage didn't fire** (no lightning bolt crossing on damage) + **no way to toggle combat INSIDE a
   room** (only settable at room-create today). Need in-room host combat toggle + verify the damage send/render.

## 🟠 P1 — confusing / redesign
6. **Spectating an open/in-progress room.** No way to discover or join a normal room's live match as a WATCHER
   (esp. tournaments). Need "⚡ LIVE — WATCH" on rooms with a live match → spectateMatch().
7. **Take-the-seat / accept UX is confusing.** The "someone wants to challenge you / call in the artist"
   interface doesn't make sense. Want: first joiner clicks one clear **"⚔ ACCEPT THE CHALLENGE"** → becomes p2;
   host sees "X joined — ⚔ START VERSUS". Strip the artist-call language for the general case.
8. **Spectator view looks broken** (owner screenshot: two static-looking decks, not the real match). It's a
   SYNTHETIC reconstruction (engine not running). FIX DIRECTION (owner: fix properly or remove): render TWO
   REAL mirror-decks fed by both players' broadcast state streams (reuse the VS rival-deck mirror), or fall
   back to a live scoreboard + one featured real-stream deck. Feasibility being assessed.

## 🟡 P2 — polish
9. **MP "Play Now" button** — top-left tag overlaps other info; nudge it right. (index.html CSS)
10. **Show the current song** (top-center) in matches + tournaments — no "now playing" today.
11. **Odd high-note SFX.** = the build129 PERFECT accent (short bright ~2100→1400Hz tick) I added; too piercing
    → tone down/warm it. Owner offered to make SFX in Suno — collect prompts for hit-chug/miss/damage-zap/PERFECT.

## Sequencing
- Investigations running: MP cluster (1,2,4,5,6,7,8,9,10) + local co-op (3). Battle-call auto-match (1) = Lovable.
- Fixes batch by file (multiplayer.js is single-writer). Each MP change → preview + owner 2-account test.
- Owner Suno SFX: send exact prompts after the audio audit.
