# BETA_GATE_BRIEF.md — backend for the gated beta (hand to the Lovable agent)

## Goal
Lock `reactivvibe.com/play` behind **access codes** so only invited people can play during the beta.
The game is a static front end and already reads the shared Supabase session (same-origin at `/play`).
Build the backend below; the game-side gate screen is built against this exact contract.

## What to build (Supabase — extend the existing `game-catalog` edge function, or add a `beta-gate` one)

### Table: `beta_codes`
| column | type | notes |
|---|---|---|
| `code` | text, unique (case-insensitive) | the access code, e.g. `RIFT-7K2P` |
| `label` | text, null | who it's for, e.g. "discord wave 1" |
| `max_uses` | int, default 1 | 1 = unique per person; a large number = shared code |
| `used_count` | int, default 0 | |
| `active` | bool, default true | kill switch / revoke |
| `expires_at` | timestamptz, null | optional expiry |
| `created_at` | timestamptz, default now() | |

### Table: `beta_access` (who's in)
| column | type | notes |
|---|---|---|
| `user_id` | uuid → auth.users | the redeeming account (preferred path) |
| `code` | text → beta_codes.code | which code they used |
| `redeemed_at` | timestamptz, default now() | |
| unique (`user_id`) | | one redemption per user |

### Endpoints
**`POST /beta/redeem`** — body `{ "code": "..." }`, `Authorization: Bearer <supabase session token>`.
- Server-side: trim + lowercase the code; check it `exists && active && (expires_at is null || > now()) && used_count < max_uses`.
- On success: upsert `beta_access` (user_id from the JWT), `used_count++` (atomic), return `{ "ok": true }`.
- On failure: `{ "ok": false, "error": "invalid" | "expired" | "used_up" | "login_required" }`.

**`GET /beta/status`** — `Authorization: Bearer <token>`. Returns `{ "access": true|false }` for the
current user (so the game skips the gate for someone who already redeemed).

## Security (important)
- **Validate + increment `used_count` server-side only** — never trust the client.
- RLS: `beta_codes` NOT client-readable (the edge function uses the service role to validate);
  `beta_access` readable only by its owner.
- Make the increment atomic (a Postgres function / `update ... where used_count < max_uses returning`).

## Decisions for you (either is supported by the schema above)
1. **Shared vs. per-person codes** — one code with a big `max_uses`, or unique codes with `max_uses=1`
   (revocable + per-tester tracking). Mix freely.
2. **Require a ReactivVibe login to redeem?** Account-tied (above) is robust + revocable. If you want
   *no-login* device redemption instead, say so and I'll spec a signed-token variant.

## Game side (what I build against this — already planned, ~half a day)
On `/play` load: `GET /beta/status` → `access:true` ⇒ straight into the game; else show a branded
**"Enter your beta code"** gate. Submit ⇒ `POST /beta/redeem` ⇒ on `ok` unlock + remember; on error
show the message; on `login_required` prompt the ReactivVibe sign-in. Degrades gracefully (gate
bypassed) if the endpoints aren't live yet, so dev/testing is never blocked.

API base today: `https://bxiejoktoknybpraxebm.supabase.co/functions/v1/game-catalog`
(put the beta endpoints there as `/beta/redeem` + `/beta/status`, or a sibling function — tell me the
final paths and I'll wire the gate to them).
