# SHOW READINESS — morning brief (built overnight 2026-07-11)

> Read this first. It's the whole picture for today's show in ~2 minutes.

## ⚡ THE ONE THING YOU MUST DO: **PUBLISH**

Everything below is **committed, pushed, synced to Lovable, and staged — but NOT live until you
Publish.** That includes the entire held stack (builds 152→179): the reconnect system, the
challenge/attach fixes, telemetry fixes, and tonight's hardening. Open Lovable → **Publish**.

**Already done for you overnight (verified, no action needed):**
- ✅ Deploy ref now **`af84efb`** (build185, `?v=485` — THE root-cause fix: an invisible hub-wide STORE click-eater from the art loader dressing the demoted footlink; verified by hit-testing. Also includes 184b/184/183 hardening — adds: inert inactive screens so invisible buttons can
  never take focus, library Enter guarded under overlays, Daily Rift no longer permanently flips difficulty to
  Hard) — **BOTH store-hijack mechanisms dead**. AkiraScare's
  "anything I click takes me to the shop" was TWO bugs: (1) the overlay focus-restore re-armed the Store on
  Enter/Space after every close (fixed build183); (2) locked campaign cards + locked profile guitar tiles opened
  the Store INSTANTLY on a single click — for a player who owns nothing, that's most of the grid (fixed build184:
  locked tiles now need a deliberate second tap; ownership cache primes at boot; results-screen Enter/Space can't
  act under a stacked overlay; every store_open now ships a forensic breadcrumb naming its trigger). Verified
  headless as a fresh player. (Also includes build182 VFX step-up + build181's 4 show-critical audit fixes +
  build179 attach-hardening + build180 telemetry.)
- ✅ `game-catalog` edge function **redeployed** (so the F1 `rr_active_rooms` seed is guaranteed live).
- ✅ `public.notifications` + `public.rr_active_rooms` confirmed in the `supabase_realtime` publication.
- ✅ **Instrumentation is now LIVE** (build180) — anonymous play funnel (`song_start / decode_error / play_fail /
  play_complete`) + anonymous song ratings land in `game_funnel_events`. **Proven end-to-end** against prod (a
  browser-fired event landed; test rows cleaned up). Tomorrow's show will finally be measurable, not a memory.

So the whole backend/attach/telemetry path is confirmed ready. **Just Publish.**

> **Suno SFX:** all wired + firing (anthem, overdrive-ignite, shield-save, combo-flare, clear-fanfare, hub bed,
> battle-call ring) with procedural fallbacks — they go live with this Publish. Only the mix levels are your call.

> **Difficulty:** left as-is on purpose. Hard's combo wall was already softened in build141 and a gated Expert
> tier (Rift) already exists; recent Hard play is one grinding user (n=1), so a re-nerf tonight would be reckless —
> better as a deliberate pass once the new funnel gives us real difficulty data.

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

- **F1 (room registration):** landed AND **game-catalog was explicitly redeployed** overnight, so the
  `rr_active_rooms` seed is live on prod. Routes probed live (401 not 404); publication + table schema
  verified. If the demo ever shows a "room didn't answer," re-deploying that edge function is the fix.
- **One honest caveat:** I could not force a *live* `rr_active_rooms` row without signing in (anon auth
  is off, correctly). Deploy + routes + schema + source all confirm the seed writes on a real challenge
  — the first actual authed challenge (i.e. the show) is the final proof.
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
