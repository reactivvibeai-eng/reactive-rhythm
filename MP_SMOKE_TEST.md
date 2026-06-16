# Multiplayer — 2-device / 2-tab smoke test

> The shipped MP netcode is already validated over the **real Supabase transport** (automated 2-peer test,
> v174): a genuine second client subscribed to a real bracket channel — soft-presence, the `t-snapshot`
> host heartbeat, and `t-final` + score-sanitation all round-tripped (see CHANGELOG v174). What an
> automated single-page test *can't* cover is two **separate game instances** driving the full UI plus the
> reconnect / host-migration **handoff**. This is that manual test. ~10 min; no backend changes needed (MP
> runs peer-to-peer over Realtime — `MP_PUBLIC=false` only gates the future ranked/leaderboard path).

## Setup
- Run the game on **two (ideally three) clients**: separate devices on any network, or browser
  profiles/windows, or tabs (use one incognito + one normal so they get **distinct player ids** — the MP id
  is per-`localStorage`).
- Open the game (`/index.html`) on each. Add **`?dev=1`** on the host to show the dev bar (NPC bots). The
  console hooks (`RhythmMP.__tour`, `__mpDev`) are available regardless of `?dev=1`.
- Tip to tell them apart: run `localStorage.rr_name='Alice'` (then `'Bob'`, `'Cara'`) in each console before
  loading.

## A. Tournament happy path (core)
1. **A:** Main Menu → Multiplayer → Create Tournament → pick a track (REROLL / SEARCH).
2. **B (and C):** Multiplayer → the bracket appears in the list → Join. (Or A shares the `?mpjoin=<tid>`
   invite URL and B/C open it.)
3. Reach the **3-player minimum** with a 3rd client — or one host-side NPC: on A run `__mpDev.bots(1)`.
   **A: START.**
4. Expect on **every** client: the ROUND / VS / 3·2·1 cinematic → the song plays → scores settle → the
   bracket advances → champion reveal. ✅ if all clients land on the **same champion**.

## B. Forfeit guard (never rob a live player)
1. Start a round where **A vs B** are paired.
2. **B: close the tab (or drop B's network) mid-song.**
3. Expect: the host does **not** instantly forfeit B while B was streaming play; you'll see a brief
   "Waiting on Bob…" before it settles to A once B is truly gone for a few seconds. ✅ if a *live* B is
   never robbed (and a genuinely-gone B doesn't hang the round).

## C. Reconnection
1. Mid-bracket, **B: reload the tab (Ctrl-R).**
2. Expect: within a few seconds B re-surfaces Multiplayer and **rejoins the same bracket in place** (board
   restored from the host's snapshot), instead of being dumped at the menu. ✅

## D. Host migration
1. Need **three real clients** (A host + B + C) — a host-side NPC won't inherit, migration needs a real
   surviving peer. Mid-bracket, **A: close the tab** (the host leaves).
2. Expect: the bracket does **not** dissolve — the earliest-joined surviving human (B or C) shows
   "you are now running the bracket" (the others see "NAME is taking over…") and play continues to a
   champion. ✅

## Watch in the console (any client)
- `RhythmMP.__tour.snap()` — the host's heartbeat payload; `.v` (version) climbs while a round is live.
- `RhythmMP.__tour.state()` — the live bracket on that client; compare across clients — they should
  converge (same `round`, `settled`, `champ`).
- `RhythmMP.__tour.persisted()` — the reconnect pointer: set while in a real bracket, `null` once it ends.

## Notes / known limits
- Results are **peer-computed** (casual). Ranked / global leaderboard needs the server re-judge in
  `MP_SERVER_SCORING_BRIEF.md` (the `MP_PUBLIC=true` gate) — out of scope here.
- Migration is **best-effort**: a brief double-host window self-resolves (the junior host steps down when it
  sees the senior's snapshot). If *all* peers leave, the bracket still ends.
- The `__mpDev.run(n)` offline path uses a fake loopback channel (no real network) — good for FSM iteration,
  but this 2-client test is what exercises the real transport + the reconnect/migration handoff.
