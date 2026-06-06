# Beta-gate backend — paste to Lovable (it deploys via its Supabase integration)

Add the beta access-gate backend. **The game-side gate is already live and calls these two
endpoints on the existing `game-catalog` edge function** — match this contract exactly:

- `GET  /game-catalog/beta/status`              → `{ "access": true | false }`
- `POST /game-catalog/beta/redeem` `{ "code" }` → `{ "ok": true }` or `{ "ok": false, "error": "invalid" | "expired" | "used_up" | "login_required" }`

Auth: the user is read from the forwarded Supabase JWT (`Authorization: Bearer …`, which the game
sends). No logged-in user → `access:false` / `login_required`.

---

## 1) Migration — tables + RLS + atomic redeem
```sql
create table if not exists public.beta_codes (
  code        text primary key,             -- stored lowercased + trimmed
  label       text,
  max_uses    integer not null default 1,
  used_count  integer not null default 0,
  active      boolean not null default true,
  expires_at  timestamptz,
  created_at  timestamptz not null default now()
);

create table if not exists public.beta_access (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  code        text references public.beta_codes(code),
  redeemed_at timestamptz not null default now()
);

alter table public.beta_codes  enable row level security;   -- NO policies → clients can't read codes
alter table public.beta_access enable row level security;
create policy "beta_access_owner_read" on public.beta_access
  for select to authenticated using (auth.uid() = user_id);

-- Atomic redemption: runs as the caller, claims one use safely under concurrency.
create or replace function public.redeem_beta_code(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_norm text := lower(trim(p_code));
  v_bc   public.beta_codes;
  v_claimed text;
begin
  if v_user is null then return jsonb_build_object('ok', false, 'error', 'login_required'); end if;
  if exists (select 1 from public.beta_access where user_id = v_user)
     then return jsonb_build_object('ok', true); end if;                 -- idempotent
  select * into v_bc from public.beta_codes where code = v_norm;
  if v_bc.code is null or not v_bc.active
     then return jsonb_build_object('ok', false, 'error', 'invalid'); end if;
  if v_bc.expires_at is not null and v_bc.expires_at <= now()
     then return jsonb_build_object('ok', false, 'error', 'expired'); end if;
  update public.beta_codes set used_count = used_count + 1
     where code = v_norm and used_count < max_uses
   returning code into v_claimed;                                        -- atomic claim
  if v_claimed is null then return jsonb_build_object('ok', false, 'error', 'used_up'); end if;
  insert into public.beta_access (user_id, code) values (v_user, v_norm)
     on conflict (user_id) do nothing;
  return jsonb_build_object('ok', true);
end; $$;

grant execute on function public.redeem_beta_code(text) to authenticated, anon;
```

## 2) Two routes in `supabase/functions/game-catalog/index.ts`
Wire these into the function's existing path-routing, reusing its `corsHeaders` + `json()` helpers.
(The sub-paths the game hits are `beta/status` and `beta/redeem`.)
```ts
// A user-scoped client forwards the caller's JWT so auth.uid() + RLS apply.
function userClient(req: Request) {
  const authz = req.headers.get("Authorization") ?? "";
  return createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authz } } });
}

// GET /game-catalog/beta/status
if (method === "GET" && path === "beta/status") {
  const sb = userClient(req);
  const { data } = await sb.from("beta_access").select("user_id").limit(1);   // RLS → only own row
  return json({ access: Array.isArray(data) && data.length > 0 });
}

// POST /game-catalog/beta/redeem   body: { code }
if (method === "POST" && path === "beta/redeem") {
  const body = await req.json().catch(() => ({}));
  const sb = userClient(req);
  const { data, error } = await sb.rpc("redeem_beta_code", { p_code: String(body?.code ?? "") });
  if (error) return json({ ok: false, error: "invalid" });
  return json(data ?? { ok: false, error: "invalid" });
}
```

## 3) Create some beta codes
```sql
-- one shared code for ~50 testers:
insert into public.beta_codes (code, label, max_uses) values ('rift-7k2p', 'discord wave 1', 50);
-- or unique single-use codes (revocable, per-tester):
insert into public.beta_codes (code, label, max_uses)
  values ('vibe-aa11', 'tester: alex', 1), ('vibe-bb22', 'tester: sam', 1);
```
(Codes are matched case-insensitively. Revoke with `update beta_codes set active=false where code='…';`)

## Security (already designed in)
- `beta_codes` is **not** client-readable (RLS on, no select policy) — only the `security definer`
  rpc / service role touch it.
- `redeem_beta_code` is **atomic** (`update … where used_count < max_uses returning`) — safe under
  concurrent redemptions; no overselling a code.
- All validation is server-side; the client only ever sends a code string.

## After deploy
The gate already shipped on the game **auto-activates** the moment `/beta/status` starts responding —
no further game change needed. Test: load `/games/reactive-rhythm/` while signed out or without a
redemption → the code gate appears; redeem a valid code → it unlocks and remembers you.
