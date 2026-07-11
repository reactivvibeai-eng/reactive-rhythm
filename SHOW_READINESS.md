# SHOW READINESS — morning brief (built overnight 2026-07-11)

> Read this first. It's the whole picture for today's show in ~2 minutes.

## ⚡ THE ONE THING YOU MUST DO: **RESUME LOVABLE, THEN PUBLISH**

Everything below is **committed and pushed — but NOT live until you Publish.** That includes the
entire held stack (builds 152→179): the reconnect system, the challenge/attach fixes, telemetry
fixes, and tonight's hardening.

**Do it in this order:**
1. **Open Lovable and resume its agent queue** (it's paused — you paused it before bed). Two messages
   are waiting: the **build179 game-sync** and an **F1 edge-function redeploy + confirm**. Let them run.
2. Confirm Lovable says `public/game/` is at **`cb27d3b`** (build179, `?v=478`) and the redeploy is done.
3. **Publish.**

> If you Publish *without* resuming the queue first, you'll ship **build178** (`5775f80`) — the last
> completed sync. That's still fully show-safe (the review passed it too), just missing build179's
> host-heartbeat + the four P2 polish fixes. Resuming first gets you build179.

## ✅ What's ready (multiplayer — the show's centerpiece)

The full "call someone into a live 1v1" path is proven and hardened:

- **Attach:** auto-battle-call + People→Challenge + "Play in Reactive Rhythm" host panel + browse
  rooms all converge two players into one room. The site (Lovable **F1**) now registers the room in
  `rr_active_rooms` the instant a challenge/match is minted, and the **game now heartbeats it every
  ~30s** so a slow-to-accept opponent's join never fails with the host sitting right there.
- **Reconnect (your #1 ask):** if someone drops/reloads, they **auto-rejoin** the room; the other
  player's **seat is held** (no dead "room closed" card). A genuine quit now surfaces "OPPONENT LEFT"
  in ~30s instead of a 95s stall.
- **Verified:** two real peers converge → seat → host picks → both ready → **LIVE 1v1** → results;
  challenge deliver+accept; reload auto-rejoin. Console clean, scoring ceiling intact.
- **Adversarial show-readiness review of the night's changes returned GO — no P0/P1 bugs.**

## 🎬 Demo script (do it this way for a clean show)

1. **Publish first** (see above), then load reactivvibeai.com/game on both machines, **signed in**.
2. To pull someone in: use **Challenge** (People list) or the host panel — the invitee gets a ring,
   they **Accept**, both land in the room, host picks a track, both **Ready**, it goes LIVE.
3. **Share a room link with the "Copy Battle Link" button** — not the browser address bar. (The
   address bar carries a host flag that can make a second person accidentally host the same room.)
4. If you're demoing reconnect: just **reload** a tab — it rejoins itself and the other seat is held.
5. Avoid on-stage: force-closing the host tab mid-room (use LEAVE/CLOSE), and letting a challenge
   sit un-accepted for >12s then accepting after you've already opened another room.

## 🔌 Backend status (Lovable's side)

- **F1 (room registration):** landed in the repo; the routes are confirmed **deployed** on prod
  (probed live). My request to **redeploy game-catalog** (to guarantee the `rr_active_rooms` seed
  shipped atomically) is **queued behind the paused Lovable queue** — it runs when you resume it
  (step 1 above). If the demo ever shows a "room didn't answer," a redeploy of that edge function is
  the fix.
- **Telemetry:** the `/events` + `/clientlog` insert bugs are fixed (we can see user errors again).
- **Notifications flow through `public.notifications`** (healthy, thousands of rows).

## 🔒 Safety

- **Anonymous Supabase auth is OFF** (confirmed — a probe returns 422). It was enabled briefly last
  night only to self-test with two real sessions, then reverted. Leave it off.

## 📋 Still open / not blocking the show

- One documented P2 (not a show-blocker): sharing the **raw address-bar URL** (vs Copy Battle Link)
  can make the recipient a duplicate host. Mitigation = use the button. A proper fix needs careful
  design (it shares a signature with the legit caller path) — deferred, not a 2am-before-a-show change.
- Deeper roadmap items (Levels content, GH-controller depth) are untouched and separate from the show.

— Handoff by the overnight agent. Questions? The full detail is in `CHANGELOG.md` (build179 entry).
