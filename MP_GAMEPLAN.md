# Multiplayer / Tournament — Game Plan & Roadmap
*Compiled 2026-06-14 from a research+code-trace workflow (netcode · brackets/lobby · competitive-rhythm-MP · full code trace → synthesis). Raw study archived in the session workflow output.*

---

## Root cause of "the round never starts" (FOUND + FIXED in v167)
The **first-run How-To overlay** (`#howto-screen`, z-260, opaque) auto-shows via `tryShowHowto` (game.js), whose skip-list checked `#start / #ryo-intro / #game / #loading` — **not `#multiplayer-screen`**. So a first-run tester in a tournament got the How-To popped *on top of the whole round*: the cinematic countdown (z-60, nested in the card) sat hidden behind it, and `#game` never activated because the only thing that strips the How-To — `showScreen('game')` — is deferred ~5.2s and may never run if the track fails to resolve. Reproduced exactly: `activeScreens:[menu, howto-screen]`, countdown hidden, no `#game`.

Two silent secondary failures compounded it: (a) provider resolution swallowed errors in a bare `catch{}` and the fallback launch had no error path → a failed track "launched" per the banner but nothing played; (b) `play()` runs on a deferred timer outside the START gesture, so Chrome's autoplay gate can keep the AudioContext suspended, and `play()`'s catch did `showScreen('menu')` — ejecting the player out of the tournament entirely.

## Shipped in v167 (the P0 cluster — verified)
- **P0-A** game.js: added `#multiplayer-screen.active, #results.active` to the `tryShowHowto` skip-list → the How-To can never occlude a live round. *(verified: `howto_active:false` during a live round.)*
- **P0-B** multiplayer.js: `closeTransientOverlays()` at the top of `onTourRound` + `beginMatch` closes How-To/store/levels/profile/settings/leaderboard before raising the round.
- **P0-C** multiplayer.js: round-start **fails LOUD + recovers** — `console.error` on provider/fallback failure, plus a **watchdog** (~2.8s past the synced start) that calls `abortRound()` (tears down veil + vs-mode, banners *"Could not start the track — back to the bracket"*, returns to the room) instead of hanging. *(verified: a 404 track now recovers cleanly instead of a dead screen.)*
- **P0-D** multiplayer.js + game.js: resume the AudioContext **on the START gesture** (not the deferred timer); `play()`'s catch no longer `showScreen('menu')` when `RhythmMP.isLive()` (the watchdog recovers instead). Also made `startTour`'s silent no-op guards **loud** (banner: "Pick a track first" / "Need at least N players").

## Target architecture (the "to-standard" plan)
1. **One bracket FSM** — a single `tourTransition(toPhase,payload)` is the only mutator of `tour.state/round`; phases: open → locked → countdown → live → settling → results/advance → champion → done. Every transition validates the current phase.
2. **Screen/overlay ownership** — route *all* screen + overlay activation through one `showScreen`-style exclusivity manager; when `RhythmMP.isLive()`, `showScreen('results')` must not strip `#multiplayer-screen` (deletes the fragile `setTimeout(0)` re-raise hacks); auto-popping overlays must check `isLive()`; promote the cinematic veil out of the card so it can never be occluded.
3. **Lead-in via an engine `onSongStart` seam** — mount the vs HUD + tear down the veil off the real song-start event, not a blind `setTimeout(atMs+80)`; keep the watchdog. (Optional later: clock-offset handshake so 3·2·1·GO lands within a frame across machines.)
4. **Host authority now, server arbitration later** — host stays clock+referee; make referee state snapshot-driven so host-failover is reachable. **Before any public leaderboard:** server-baked/host-broadcast charts so all clients chart identically + an Edge Function that re-judges a submitted input replay and bounds-checks scores. Keep `MP_PUBLIC=false` until then.
5. **State-over-events** — a `t-snapshot` the host rebroadcasts every ~3–5s and on transition `{state,round,alive,pairs,settled,sel,env,atMs,version}`; clients idempotently apply the latest version → self-heals dropped events + enables reconnection. Key the `t-round` dedup on a unique token (`tid:n:atMs`), not `(state,round)`.
6. **Forfeit as a state machine that never punishes a live player** — a fast `t-playing` heartbeat (fires once `getLiveStats().playing`); never start/extend the forfeit timer against a provably-live player; a TENTATIVE forfeit is overturnable by a late legit final; show a visible "waiting on PLAYER (Ns)".
7. **Reconnection** — persist minimal tour state to sessionStorage; resubscribe + pull the host snapshot; 20–30s host-side reconnect grace.
8. **Deterministic, fair charts** — prefer server-baked charts (or broadcast the host's beat array) so "same song" is actually the same chart; calibration as a fairness gate.
9. **Teardown/timer hygiene** — one `resetAllMpTimers()` at every entry point; drive verdict→champion off acks/atMs, not blind setTimeouts.

## Solo test harness (how you test)
- Keep `fakeTourChannel` + `devSoloTour` but make it **deterministic** (one seedable PRNG: `__mpDev.seed(n)` through the seeding shuffle, track roll, and bot scores).
- **Bots that play the real song per difficulty tier** — ramp the ghost score along actual song progress with tier accuracy/miss-rate; bank the final at real song-end (already correct).
- **Fault-injection** on `__mpDev`: `dropBot`, `stallFinal`, `dupRound`, `hostLeave`, `lateFinal` — exercise the forfeit/dedup/settle/resync paths every run.
- **Fail-loud** watchdog in the harness AND production (shipped in P0-C) so a failed start can never masquerade as a "stuck bracket."
- Strip `__mpDev`/`fakeTourChannel` before launch; add a real (non-dev) 2-client smoke test.

## Roadmap
### NOW (test this)
Tournaments no longer hang — the How-To can't occlude the round, and any failed track recovers with a visible message. **Test:** Multiplayer → Tournament → add NPCs (dev bar) → set difficulty → AUTO-RUN off → START → you should get the ROUND/VS/3·2·1 countdown then the split-screen duel (or a clear "couldn't start the track" message, never a dead screen).

### NEXT
P1: engine `onSongStart` seam (kill the deferred-mount race), MP-aware `showScreen` (delete the re-raise hacks), `t-round` dedup token + double-fire guard, single `resetAllMpTimers()`. P2: forfeit state machine + `t-playing` heartbeat, `t-snapshot` host heartbeat, reconnect path. P3: deterministic + fault-injecting harness; bots that play the real song per tier.

### LATER (before public)
Server-authoritative scoring (server-baked/host-broadcast charts + Edge-Function re-judge + bounds checks) — the real blocker for `MP_PUBLIC=true`. Then the genre-leveling features: a single animated **live leaderboard** for 5–10p rounds (cheaper + more tense than 10 ghost decks; reserve split-screen for 1v1 + the final), host-selectable **win condition** (Score/Accuracy/Combo), **tag co-op** (shared health, pass the song), an unscored **Jam/Party** room, **async ghost** challenges (race a friend's PB — beats cold-start matchmaking), spectator view, vote-on-next-song, one-tap rematch, host migration.
