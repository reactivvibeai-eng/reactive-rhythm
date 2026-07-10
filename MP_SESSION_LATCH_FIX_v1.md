# MP_SESSION_LATCH_FIX_v1 — `ME.signedIn` is write-once-true

> Staged 2026-07-10. **Do not apply while an audit is reading `multiplayer.js`** (line citations and
> adversarial refutations go stale). Apply immediately after `wejkxyadu` lands.
> Source: audit `wgj2jrp92` — 9 defects confirmed by adversarial verifiers whose default was "not a bug."

## The defect

`multiplayer.js:44` declares `var ME = { …, signedIn: false }`. Line **56** is the **only** assignment to
`true`. **There is no assignment to `false` anywhere in the file.** `resolveMe()` can only ever set it true;
its reject branch (`:60`) merely repaints; the re-resolve at `:648` fires *only while the flag is already
false*. And `catalog.js getUser()` (`:104–119`) deliberately never demotes a locally-present Supabase session
when the backend rejects it ("it must NEVER demote a valid local session to logged out").

So: **once a player boots signed-in, `ME.signedIn` stays true for the entire session** — even after the
underlying session is destroyed (signed out in another tab; access token expired with a dead refresh token).

This is the same disease as the phantom room: *a stale local hypothesis, a swallowed error, and no clock.*

## What the player suffers

**1. The ONLINE NOW roster silently vanishes.** (`multiplayer.js:2857`, `:2862`, `:7236`)
- `_onlineFetch`'s `!ME.signedIn` guard passes (flag stuck true) → `presenceOnline()` runs → `GET /presence/online`
  (`catalog.js:3229`, `auth:true`) **401s** → `api()` throws (`catalog.js:~610`).
- The throw lands in `.catch(…)` at `:2862–2864`, which sets `box.hidden = true` "quietly, never a nag."
- `refreshSigninNote` (`:7236`) computes `show = !!supa && !ME.signedIn` → **false**, so the "Sign in to play
  online" nudge is *hidden*.
- Net: no roster, no error, no sign-in prompt. The one honesty signal is keyed on the stale flag; the one error
  signal is swallowed.

**2. Battle-call offers a retry that can never succeed.** (`multiplayer.js:2913`, `:2932–2948`)
- `battleCall` gates only on `ME.signedIn` → opens a fresh private room (`:2922`) → `POST /challenge`
  (`catalog.js:3233`, `auth:true`) **401s**.
- The `.catch` branches on **403** (`:2938`) and **409** (`:2941`) but has **no 401 branch** → falls to the
  generic `else` (`:2945`): *"Couldn't send the battle call — try again."* and tears the room back down.
- "Try again" implies transient. The auth failure is permanent until re-login. Every retry re-opens a room,
  re-fires, re-401s, re-tears-down. Forever.
- **`qmFail` already has the 401 branch** (`:3601`). The challenge catch never got it.

## The fix (three parts, ~30 lines)

### 1. Make the flag reflect reality
`ME.signedIn` must be able to go false. The cheapest correct trigger: when an authed MP probe 401s, the token
is dead — demote and repaint.

```js
// multiplayer.js — new helper near resolveMe()
// A 401 from an authed endpoint is proof the token is dead. ME.signedIn was write-once-true, so a session that
// died mid-play left every honesty signal keyed on a lie. (Do NOT infer anything about the ROOM from a 401 —
// see MP_GUEST_CONTRACT_v1 §6.5. This says something about US, not about a room.)
function _demoteOn401(err) {
  if (!/\b401\b|unauthorized/i.test(String(err && err.message || err))) return false;
  if (!ME.signedIn) return false;
  ME.id = localId(); ME.name = 'Player'; ME.avatar = null; ME.signedIn = false;
  try { paintYou(); refreshSigninNote(); reannounce(); } catch (e) {}
  return true;
}
```
Call it from every authed-endpoint `.catch` on a guest-reachable path.

### 2. Stop swallowing the signal — `_onlineFetch`
`:2862` — on a demoted 401, show the sign-in note instead of hiding the box in silence.

### 3. Give battle-call its missing 401 branch
`:2945` — mirror `qmFail` (`:3601`): `Sign in on ReactivVibe to battle-call players.` and **remove the retry
affordance**. Never offer an action that cannot work.

## Verification (headless, no human needed)
Use the two-peer harness (`rr-verify` :8790 / `rr-verify-b` :8791 — see
`reactive-rhythm-mp-headless-2peer-harness`).

1. **Positive control first.** Sign in via `window.__rrSupa.auth.signInWithPassword`, confirm `RhythmMP` shows
   the roster and the sign-in note is hidden.
2. Kill the session out from under the running page: `await window.__rrSupa.auth.signOut()` **without reloading**.
3. Force an `_onlineFetch` tick (it polls every 45s, `:2851`).
4. **Assert:** the sign-in note is now *visible*, and the ONLINE NOW box is not merely hidden-in-silence.
5. Click CHALLENGE on a roster row → assert the banner names the session, and that no TRY AGAIN is offered.
6. **Regression:** a genuinely signed-out guest must still be able to create a room, get an invite link, and be
   joined — the guest room path has no auth gate and must not acquire one (`MP_GUEST_CONTRACT_v1` §1).

## Constraints
- Never weaken auth. `/presence/online`, `/challenge`, `/room-status`, `/room-announce` stay authed.
- Never treat a 401 as information about a *room* (`MP_GUEST_CONTRACT_v1` §6.5) — only about *our own token*.
- `!spectating`-gate any new chrome (spectate byte-identity).
- Ceiling-safe: no scoring code.
