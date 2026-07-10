# MP 2-ACCOUNT TEST — the gate on the HELD multiplayer stack

**Written 2026-07-10 · against `9807eae` (build164, `?v=463`) · supersedes `MP_SMOKE_TEST.md` for the
room/match path** (that doc is v174-era, covers *tournaments*, and its `localStorage.rr_name` tip is
stale — that key does not exist).

---

## 0. WHY THIS EXISTS

Eight commits of multiplayer work have been sitting **HELD** — written, adversarially reviewed,
node-clean, and **never run by two humans**:

| commit | what it fixed |
|---|---|
| `37c9846` build145 | re-emit the outgoing challenge broadcast |
| `3ad7918` | **`bc:user` `setAuth` + retry-till-SUBSCRIBED**; room→match ready re-broadcast; start re-emits |
| `57db3dc` build154 | MP client reliability + legibility |
| `bac65af` build155 | 6 confirmed review bugs + 2 found |
| `e706422` build156 | MP legibility |
| `37c8695` build159 | MP hardening |
| `f9b9e54` build160 | MP reliability |
| `76fd75c` build161a | room-state snapshot · mid-run forfeit guard · room-start watchdog · call-rail accept · **join-by-code** · `in_match` flag |

`3ad7918` is the one that matters most: it is the diagnosed root cause of **"sometimes connects /
won't start."** Two bugs — `bc:user:<uuid>` subscribed without a JWT (so it silently never received),
and the room→match handoff never re-broadcast the room stage. Both are fixed. **Neither has been
observed working.**

**MP cannot be proven headless.** A rAF-throttled browser with one client cannot exercise a
two-peer handoff. This test is the only evidence that exists.

### What is live right now (verified by probe, not assumption)

- **Production `reactivvibeai.com/game` is `?v=451`.** Local HEAD is `?v=463`.
- Prod `multiplayer.js` contains **zero** of `_joinByCode`, `setAuth`, `_roomResubActive`.
  The HELD stack is genuinely not deployed. The hold is real.
- Prod `game.js` contains **zero** of `_chartShapeModified`. ⚠️ **This means the `?open=1`
  leaderboard-integrity hole is still exploitable on the live site today.** Publishing closes it.

---

## 1. SETUP (≈3 min)

A frozen copy of build164 is already being served, isolated from the hub work in progress:

```
http://127.0.0.1:8789
```

> Served from a detached git worktree at `9807eae` (`.claude/worktrees/mp-test`) by `serve_mp.py`,
> with `Cache-Control: no-store`. It will **not** shift under you while the build165 agent edits the
> main directory. If it's not up: `cd .claude/worktrees/mp-test && python serve_mp.py`

**Two Chrome profiles** (not two tabs — MP identity is per-`localStorage`, and tabs share it):

1. Chrome → profile avatar (top-right) → **Add** → name it `MP-A`.
2. Repeat for `MP-B`. (A normal window + an Incognito window also works, but Incognito loses state on close.)
3. Open `http://127.0.0.1:8789` in each.

Both clients talk to the **real production Supabase Realtime**, so the netcode is genuinely
exercised — only physical network latency is unrealistic.

**Heads-up so you don't chase a ghost:** signed-out players are *all* named `Player`. `ME.name`
defaults to `'Player'` (multiplayer.js:44) and only `getUser()` overrides it. So in Tier 1 **both
sides read "Player (guest)"** — confusing, but not a bug in the code under test. Tell them apart by
window position. (It *is* a real cosmetic defect worth fixing later; `multiplayer.js` is frozen, so
not today.)

---

## 2. TIER 1 — GUEST ROOM FLOW (no sign-in, covers most of the HELD stack)

Room create/join is **not** auth-gated (`_joinByCode`, multiplayer.js:4263, has no `signedIn`
check). Do all of these signed out.

| # | Test | Steps | PASS looks like | Guards |
|---|---|---|---|---|
| **T1** | **Join by code** | **A:** Multiplayer → create a room. Read the invite code. **B:** Multiplayer → paste code → Join. | B is in A's room within ~5s; both see 2 players. | build161a |
| **T2** | **Both ready → START** ⭐ | Both click **READY**. | Countdown → song plays on both. | `3ad7918` — **the historical "won't start" failure. If anything fails, expect it here.** |
| **T3** | **Full match → verdict** | Play (or let it run) to the end. | Both land on the **same winner**; each score matches what that player's HUD showed. | build160 |
| **T4** | **Rematch** | Click rematch. | A clean new round. No double countdown, no leftover timers, no stale scores. | build155 teardown |
| **T5** | **Mid-run forfeit guard** | Mid-song, **B closes the tab.** | A does **not** instantly win. Brief "waiting", then it settles. A *live* opponent must never be robbed. | build154/155 |
| **T6** | **Reconnect** | Mid-match, **B presses Ctrl-R.** | B re-enters the same room/match — not dumped to the menu. | `3ad7918` retry-till-SUBSCRIBED |
| **T7** | **Room-start watchdog** | A creates a room, B joins, **A closes the tab before starting.** | B gets a clear banner and a way out. **Not a hang.** | build161a |

---

## 3. TIER 2 — SIGNED IN (battle-call, roster, `in_match`)

These *are* auth-gated — `bc:user:<uuid>` is keyed on a real authenticated UUID
(multiplayer.js:3122), so a guest cannot exercise them at all.

The game exposes its Supabase client as `window.__rrSupa`, so **you can sign in on localhost** — no
publish needed. In each profile's DevTools console (F12), signing in as a *different* account each time:

```js
await window.__rrSupa.auth.signInWithPassword({ email: 'you@example.com', password: '…' });
location.reload();
```

Verify it took:

```js
(await window.__rrSupa.auth.getUser()).data.user.id   // → a real uuid, not null
```

> **I have not entered and will not handle your credentials — type them yourself.**
>
> **If your accounts are Google-OAuth-only** there is no password to type. Then either (a) give one
> test account a password, or (b) add `http://127.0.0.1:8789` to Supabase → Auth → URL Configuration
> → Redirect URLs. (b) is a change to your **production auth settings**; I won't make it without you
> saying so. Say the word and I'll drive it through Lovable.

| # | Test | Steps | PASS looks like | Guards |
|---|---|---|---|---|
| **T8** | **ONLINE NOW roster** | Both signed in, both at the MP lobby. | Each sees the other in the roster, by real name. | build161a |
| **T9** | **`in_match` flag** | A and B start a match. Sign in on a 3rd profile (or just watch the roster). | Players in a match are marked "in a match", not "available". | build161a |
| **T10** | **Battle-call** ⭐ | **A:** click B in the roster → call. **B:** accept the ring. | Both land in a room together. **The ring must arrive within ~1s.** | `3ad7918` + build145 |

> **T10 is the sharpest test in this document.** The ring has two delivery paths: an instant
> `bc:user:<id>` broadcast, and a ~30s `notifications` poll as fallback. Pre-fix, the broadcast
> channel subscribed without a JWT and silently never delivered — so the call still *arrived*, just
> 30 seconds later, via the fallback. **A call that works but takes ~30s is a FAIL, not a pass.**
> That is precisely the bug `setAuth` closes. Time it.

---

## 4. IF SOMETHING FAILS

Don't describe it — capture it. In the failing profile's console:

```js
copy(JSON.stringify({
  v: document.querySelector('script[src*="game.js"]')?.src,
  live: window.RhythmMP?.isLive?.(),
  show: window.RhythmMP?.__show?.state?.() ?? null,
  tour: window.RhythmMP?.__tour?.state?.() ?? null,
  signedIn: !!(await window.__rrSupa?.auth?.getUser())?.data?.user?.id,
  errs: JSON.parse(localStorage.getItem('rr_errlog') || '[]').slice(-5)
}, null, 2))
```

That copies a report to your clipboard — paste it to me. Also note **which test number**, **which
side** (A or B), and whether the console shows errors (F12 → Console → filter: Errors).

---

## 5. WHAT THIS TEST DOES *NOT* COVER — say so honestly

- **The show-room / site live-panel seat cluster.** Hosting MP from the site's GO-LIVE panel needs
  `reactivvibeai.com` itself; localhost has no live panel. Still unproven.
- **Real two-device network conditions.** Both clients sit on one machine. Realtime still round-trips
  Supabase, so the protocol is exercised; packet loss and mobile radios are not.
- **Spectate byte-identity.** Needs a 3rd client. (Reminder: `showWinner()` on a watcher always
  computes a loss — that is *decreed*, not a bug.)
- **Tournaments / brackets / host migration.** See `MP_SMOKE_TEST.md` §A–D; needs 3 clients.

---

## 6. AFTER IT PASSES

1. `multiplayer.js` **unfreezes**. C4 (best-of-3 series framing) becomes buildable.
2. Publish → the HELD stack goes live, **and the `?open=1` integrity hole closes**.
3. The MP telemetry funnel starts filling for the first time (it is empty today because no emitting
   build has ever been published).

If it fails: the failure is **attributable** — every test above names the commit it guards. That was
the entire point of freezing the file.
