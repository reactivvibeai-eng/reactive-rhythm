# MP_GUEST_CONTRACT_v1 — what multiplayer promises a signed-out player

> Fable 5 design ruling · 2026-07-10 · binding for the guest-join fix.
> Ground truth: owner two-account test + headless repro. A signed-out deep-link joiner lands in a
> phantom room with a ghost `Opponent — WAITING` forever; a signed-out host shows `····` as their
> room code forever. Constraints honored throughout: **no backend change, never weaken auth, no
> scoring/economy code, `!spectating`-gated chrome, softPresence-only transport.**

---

## §1 THE RULING

**Guests are full citizens of the realtime room fabric. Sign-in buys three things and only three
things: identity, ranking, and the typeable room code. Nothing about a guest's safety — knowing
whether a room is real, alive, or dead — may ever depend on an endpoint a guest cannot call.**

This is option (a), with one honest asterisk (the typeable code), and it is not aspirational — it
is what the code already almost is:

- Guests are first-class by construction: `ME = { id: localId(), … signedIn: false }`
  (multiplayer.js:44), the sign-in note is explicitly "informational, never blocking"
  (multiplayer.js:7232–7238), and every "Sign in to play online" banner is actually gated on
  `!supa || !lobbyCh` — connection, not identity (multiplayer.js:707, 2785, 3738, 3747, 5645).
  A guest can host, join, ready, and play a full match over public `rr-*` channels with the anon
  key. There is no sign-in gate on `gotoRooms('create')` or `_joinByCode` — and there should not be.
- The only genuinely auth-bound artifacts are REST: `POST /room-announce` (code minting,
  host-locked — multiplayer.js:4220–4232) and `GET /room-status` (liveness preflight —
  catalog.js:3245, `{auth:true}`). Both have free substitutes: the invite **link** is the
  always-works share path (the code at multiplayer.js:4242 already says so), and **realtime
  evidence** (heartbeats, meta, snapshots, `room-gone`) is a strictly better liveness oracle than
  a REST poll, available to everyone.
- Precedent already set: signed-out results don't reach the server ladder (catalog.js:2408),
  presence roster hides for guests (multiplayer.js:2857). Auth buys *standing*, not *access*.

**What we give up, stated plainly:**

1. A signed-out host never gets a typeable room code. They share by link only. Acceptable: the
   room UI is already link-first (multiplayer.js:4353 — "Copy the invite link and send it"), the
   code is the secondary path, and minting stays host-locked server-side (we never weaken auth).
2. Guests never get the `/room-status` fast-kill (server confirming `alive:false` in ~5s). They
   ride the realtime evidence deadline instead — slower to declare death, never wrong about it.
3. Guest runs stay unranked and guest identity is per-browser. Already the law.

Why not (b) or (c): this beta's funnel is empty; every sign-in wall placed before the first
"I played my friend" moment costs the exact players we're trying to earn. The incident was never
"guests shouldn't be in rooms" — guests in rooms work end-to-end over realtime. The incident is
that we let a guest's *safety verdict* ride on two authed REST calls and swallowed the 401s
(`.catch(function(){})` at multiplayer.js:4133; `r.ok ? … : null` at multiplayer.js:4230). Fix
the verdict, not the citizenship.

---

## §2 THE JOIN STATE MACHINE

Clock facts, read from the code — the machine is built from these, not invented:

| Constant | Value | Where |
|---|---|---|
| `_pendJoin` tick | 2.5 s | multiplayer.js:4147 |
| `directAt` | 4 ticks = **10 s** | multiplayer.js:4091 |
| `maxTries` | 18 ticks = **45 s** | multiplayer.js:4092 |
| `/room-status` preflight | tick 2 = 5 s (signed-in only) | multiplayer.js:4119 |
| softPresence heartbeat | 10 s, **instant hello-back to a newcomer** | multiplayer.js:325, :310 |
| host room-state snapshot beat | 4 s (normal rooms) | multiplayer.js:447–455 |
| presence expiry sweep | 75 s | multiplayer.js:328 |
| `room-gone` broadcast on host close | event-driven, anon-readable | multiplayer.js:3821 → :719 |

**The load-bearing redefinition.** Today `_pendJoin`'s tick treats `room.id` as "converged"
(multiplayer.js:4097) — but after the tick-4 direct join, `room.id` is *self-asserted*
(`joinRoomDirect` synthesizes the room from the rid alone, multiplayer.js:4029–4041). The watchdog
declares victory over its own hallucination at t≈12.5 s, clears itself, and the 45 s fail card
(gated on `!room.id`, multiplayer.js:4139) becomes unreachable. **Convergence for a direct join is
HOST EVIDENCE, not `room.id`.**

**HOST EVIDENCE** (any one suffices; all are guest-callable, all realtime):
- `onRoomMeta` heal for this rid (multiplayer.js:4396–4406 — sets `room.p1`), or
- the host's presence heartbeat: `room.p1 && room.members[room.p1]` — the exact predicate the
  v417 eject guard already uses (multiplayer.js:4125), or
- a versioned room-state snapshot consumed (`onRoomState`, `p.v > 0`, multiplayer.js:457–461), or
- a song broadcast / live match channel (`matchCh`).

A live host produces evidence in seconds even when tabbed away: the hello-back at
multiplayer.js:310 is event-driven (fires on receiving the guest's first heartbeat, no timer
clamp), the snapshot beats every 4 s, and the guest re-pings every 2.5 s. 45 s of silence is not
"slow host." It is "no host."

### The states

Every state names its honest UI and the deadline that forces it out. **No state is
terminal-without-exit.** All joiner chrome below is player-path; spectator deep-links
(`asSpec`) keep their existing surfaces — nothing new renders when `spectating` is true.

1. **resolving** (join-by-code only). `_roomResolve` in flight (anon endpoint,
   multiplayer.js:4233–4237). UI: input busy, "Finding room…". Deadline: the fetch settles →
   `joining` on a rid, or inline "Code not found or expired." (exists, correct, keep —
   multiplayer.js:4263–4277).
2. **joining** (meta fast-path). t = 0 → 10 s. Banner label ("Joining the room you were
   invited to…"). Roster: **no opponent row at all** — you are not in a room yet. Deadline:
   `onRoomMeta` → `joined` (happy path, byte-identical today), else tick 4 → `joining-direct`.
3. **joining-direct** (in the channel on a synthesized room, awaiting proof of life).
   t = 10 s → 45 s. UI: the setup shell may open (unchanged), but the opponent cell renders the
   join state — `CONFIRMING…` with the elapsed escalation line, **never** `WAITING…` — and the
   wait line reads "Confirming the host is here…" through the existing `paintWaitStatus`
   escalation funnel (multiplayer.js:1007–1030). Exits:
   - HOST EVIDENCE → `joined`.
   - `room-gone` for this rid → `room-dead` **immediately** (today multiplayer.js:719 only prunes
     the room browser — the pending joiner must also consume it).
   - `/room-status` says `alive:false` (signed-in only) → `room-dead` (existing v417 eject,
     multiplayer.js:4125–4131, keep).
   - t = 45 s with zero evidence → `host-never-came`.
4. **joined-waiting** (host evidence landed; match not started). The **only** state where
   `WAITING…` opponent chrome may render — and for a guest it never does for the host: with
   `room.p1` known and present, `paintRoomWaiting` shows the host's name (multiplayer.js:4331–4336).
   `WAITING…` is thereafter reserved for a **host** awaiting a challenger — a person who was
   promised, by a person who exists. Deadline within this state: the 75 s presence sweep
   (multiplayer.js:328) — if the host's heartbeat lapses pre-match, that is `host-left`
   (existing opponent-left copy family, multiplayer.js:990), not silence.
5. **host-never-came.** Auto-eject: `_clearPendJoin()` + `leaveGuestRoom()`
   (multiplayer.js:3799–3806) + fail card (§5, card B). Exits: TRY AGAIN (re-`_pendJoin`, a fresh
   45 s cycle) or BACK TO LOBBY. Fires telemetry `mp_join_failed {path:'direct', reason:'no_host'}`
   — and note: today's `mp_join_converged {path:'direct'}` (multiplayer.js:4097) counts phantom
   rooms as successes; after this fix it only fires on evidence, so the metric stops lying too.
6. **room-dead** (positively confirmed: `room-gone`, or authed `alive:false`). Fail card (§5,
   card A — exists at multiplayer.js:4129, keep). No TRY AGAIN — it is truly dead. Exit: BACK TO
   LOBBY.
7. **joined.** Converged. `mp_join_converged {path:'meta'|'direct'}` with honest semantics.

**The ghost-row law, restated as one sentence:** `Opponent — WAITING` may render only while a
liveness clock is running against a room whose host has produced evidence; the moment the clock
expires or the evidence lapses, the row must become a verdict.

---

## §3 THE PLACEHOLDER LAW

**Every placeholder must declare, at the point it is written: (1) what success replaces it with,
(2) what failure replaces it with, and (3) the deadline that forces the choice.** A placeholder
with no failure render and no deadline is not a placeholder — it is a lie with good posture.
`'····'` (multiplayer.js:4246, :4318) breaks the law twice: `_roomAnnounce` fail-softs every
failure to `null` (multiplayer.js:4229–4231), so the "meanwhile" render is the forever render for
any signed-out host, older server, or dropped request.

Applied concretely — the code slot becomes tri-state, painted by one renderer
(`_paintShareCode` grows the two missing states; `enterRoomWaiting:4318` delegates to it):

- **Signed-out host:** never render `····`. The truth is known *synchronously* (`ME.signedIn`,
  multiplayer.js:44) — there is nothing to wait for. The code row renders the sign-in affordance
  (§5, card C copy) with the invite-link button styled as the primary action. No fetch is made.
- **Signed-in host, code in flight:** `····` is legal here and only here — `_announceMyRoom`
  (multiplayer.js:4249–4256) has one promise outstanding. Deadline: the promise settles. On
  `{code}` → the code. On `null` (server older/down/errored) → the failure render:
  `LINK ONLY` in the code slot plus the §5 card-C-prime line — the host learns the link still
  works and the room loses nothing.
- **Any state, guest or spectator:** the row stays hidden (existing `room.isHost` gate,
  multiplayer.js:4316–4322 — spectate byte-identity already holds; keep it).

---

## §4 THE HOST-LIVENESS DEADLINE

**45 seconds, total, from `_pendJoin` t0 — the existing `maxTries` envelope — and the clock must
survive the direct join.** After the tick-4 direct join, that is 35 more seconds of
evidence-waiting. No new number is invented; the fix is that the number finally *applies*.

Why 45 s and not shorter: the direct join exists precisely to tolerate a late or backgrounded
host (the v416 design note, multiplayer.js:4020–4023), and 45 s is already burned into the
adjacent systems — the battle-call ring shows up to 45 s (multiplayer.js:3373), the existing fail
card copy says "didn't respond for 45s" (multiplayer.js:4142). One envelope, one story.

Why 45 s and not longer: a live host betrays itself in under 5 s (event-driven hello-back :310,
4 s snapshot :454, 2.5 s re-ping :4147) — every additional second past ~10 is charity toward a
host who is not coming. A rhythm-game player's patience is spent in beats, not minutes; 45 s is
already the outer wall. Anyone arguing for 60 s is optimizing for the ghost.

What fires at the deadline: eject (`leaveGuestRoom`, multiplayer.js:3799 — the same clean path
mod-kick uses), card B below, telemetry `mp_join_failed`. Where they land: the MP lobby, with
TRY AGAIN armed — because the one real host this protects (tabbed away, ~1/min clamped timers,
multiplayer.js:323–324) will likely have beaten by the retry.

---

## §5 COPY

Voice check applied: direct, confident, never cute, never blames the player. Oxanium heads,
Chakra Petch bodies. No new chrome for spectators.

**A — room-dead (server-confirmed or `room-gone`)** *(exists at multiplayer.js:4129 — keep verbatim)*
- Head: `THAT ROOM IS CLOSED`
- Body: `The host closed the room before you got in.`
- Buttons: `BACK TO LOBBY` (primary)

**B — host-never-came (45 s, zero evidence)**
- Head: `NO HOST IN THIS ROOM`
- Body: `You made it in, but the host never showed. The invite may be stale — ask them for a fresh link, or try again in case they're just slow.`
- Buttons: `TRY AGAIN` (primary) · `BACK TO LOBBY`

**C — code-unavailable, signed-out host** *(inline in the code row, not a card)*
- Line: `ROOM CODES NEED SIGN-IN — YOUR INVITE LINK WORKS RIGHT NOW.`
- Buttons: `COPY INVITE LINK` (primary) · `SIGN IN`

**C′ — code fetch failed, signed-in host** *(inline; the `····` deadline render)*
- Slot: `LINK ONLY`
- Line: `Couldn't get a room code — the invite link still works.`

**Joining-direct wait line** *(through the existing escalation funnel, :1007–1030)*
- `Confirming the host is here…` → +20 s: `· still waiting — they may have stepped away` →
  the 45 s deadline resolves it to card A or B. (The 60 s "resend the invite link" escalation
  never applies here — the deadline lands first, as it should.)

---

## §6 WHAT NOT TO DO

1. **Don't raise the timeout.** The bug is not that 45 s is too short; it's that no clock reaches
   the phantom room at all (`_clearPendJoin` at :4097 kills it at t≈12.5 s). A 90 s version of a
   dead watchdog is still dead.
2. **Don't just hide the ghost row.** An empty roster is the same lie in a quieter voice. The row
   must state the phase (`CONFIRMING…`) and then become a verdict. Silence is what we're fixing.
3. **Don't require sign-in for rooms.** It would "fix" the phantom by amputating the funnel. The
   realtime fabric never needed auth; walling it punishes every invitee for a REST dependency the
   join path should not have had.
4. **Don't make `/room-status` or `/room-announce` anon-readable.** Forbidden (no backend change,
   never weaken auth) — and it would re-teach the client the exact habit that caused this: gating
   safety on REST reachability. The realtime evidence path must be the backbone regardless.
5. **Don't interpret the 401 as `alive:false`.** An authed endpoint refusing a guest says nothing
   about the room. Treating refusal as death would nuke every join for a signed-in player with an
   expired session. Unknown is unknown; only evidence and deadlines convert it.
6. **Don't gate `joinRoomDirect` on having meta.** Tolerating a late host is the entire point of
   v416 (:4020–4023) — demanding meta first re-strands the owner-playtest case it fixed. Join
   optimistically; just stop calling the optimism "converged."
7. **Don't ship the fix without fixing the telemetry.** `mp_join_converged {path:'direct'}`
   currently counts ghosts as wins (:4094–4097). If the metric keeps lying, the dashboard will
   report this incident as a regression.

---

## §7 THE PATTERN THIS INCIDENT NAMES

This codebase's failure mode is **optimistic local state plus fail-soft error handling, with no
deadline between them**. `joinRoomDirect` writes `room.id` as a hypothesis; four lines later the
watchdog reads it as a fact (:4097), the fail card trusts it as a fact (:4139), and telemetry
reports it as a fact — while every channel that could have contradicted it was wired to
`.catch(function(){})` (:4133) or `r.ok ? … : null` (:4230), so contradiction was physically
unable to reach the UI. The rule going forward, for every MP write: **state you synthesized is a
hypothesis with a timer** — it must name the evidence that confirms it, the deadline that expires
it, and the render for each; and an empty `catch` is legal only where some *other* running clock
owns the verdict. Corollary for auth: any code path a guest can reach may use an authed endpoint
as an accelerator, never as the sole source of a safety verdict — because for a guest, that
endpoint does not exist.
