# Beta access backend + admin controls — paste to Lovable (one prompt; supersedes the backend-only one)

## Goal
Build the backend for the game's beta access gate **and an admin panel to manage it**. The game (live
at `/games/reactive-rhythm/`) already has the gate built — it's dormant until this exists, then it
activates automatically. **Match the game's contract exactly** or the gate won't work.

## ⚠️ Game contract (the deployed game already calls these — do NOT change the shapes)
- `GET  /game-catalog/beta/status`               → `{ "access": true|false }`  (user read from the JWT; no user → `access:false`)
- `POST /game-catalog/beta/redeem`  `{ "code" }`  → `{ "ok": true }` or `{ "ok": false, "error": "invalid"|"expired"|"used_up"|"login_required" }`

---
## PART A — Backend (Supabase)

### Migration — tables + RLS + atomic redeem
```sql
create table if not exists public.beta_codes (
  code text primary key, label text, max_uses integer not null default 1,
  used_count integer not null default 0, active boolean not null default true,
  expires_at timestamptz, created_at timestamptz not null default now(), created_by uuid);
create table if not exists public.beta_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  code text references public.beta_codes(code), redeemed_at timestamptz not null default now());

alter table public.beta_codes  enable row level security;
alter table public.beta_access enable row level security;

-- a player can read ONLY their own access row
create policy "beta_access_owner_read" on public.beta_access
  for select to authenticated using (auth.uid() = user_id);

-- ADMIN management — replace is_admin(...) with YOUR existing admin-role check
-- (the same one ProtectedAdminRoute / useAdminRole rely on):
create policy "beta_codes_admin_all"  on public.beta_codes  for all to authenticated
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
create policy "beta_access_admin_all" on public.beta_access for all to authenticated
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
-- normal clients still can't read beta_codes — only admins + the security-definer rpc / service role.

create or replace function public.redeem_beta_code(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_norm text := lower(trim(p_code)); v_bc public.beta_codes; v_claimed text;
begin
  if v_user is null then return jsonb_build_object('ok',false,'error','login_required'); end if;
  if exists (select 1 from public.beta_access where user_id=v_user) then return jsonb_build_object('ok',true); end if;
  select * into v_bc from public.beta_codes where code=v_norm;
  if v_bc.code is null or not v_bc.active then return jsonb_build_object('ok',false,'error','invalid'); end if;
  if v_bc.expires_at is not null and v_bc.expires_at<=now() then return jsonb_build_object('ok',false,'error','expired'); end if;
  update public.beta_codes set used_count=used_count+1 where code=v_norm and used_count<max_uses returning code into v_claimed;
  if v_claimed is null then return jsonb_build_object('ok',false,'error','used_up'); end if;
  insert into public.beta_access (user_id,code) values (v_user,v_norm) on conflict (user_id) do nothing;
  return jsonb_build_object('ok',true);
end; $$;
grant execute on function public.redeem_beta_code(text) to authenticated, anon;
```

### Two routes in `supabase/functions/game-catalog/index.ts` (reuse its corsHeaders + json(); sub-paths `beta/status`, `beta/redeem`)
```ts
function userClient(req){ const authz=req.headers.get("Authorization")??""; return createClient(SUPABASE_URL,ANON_KEY,{global:{headers:{Authorization:authz}}}); }
if (method==="GET" && path==="beta/status"){ const sb=userClient(req); const {data}=await sb.from("beta_access").select("user_id").limit(1); return json({access:Array.isArray(data)&&data.length>0}); }
if (method==="POST" && path==="beta/redeem"){ const body=await req.json().catch(()=>({})); const sb=userClient(req); const {data,error}=await sb.rpc("redeem_beta_code",{p_code:String(body?.code??"")}); if(error) return json({ok:false,error:"invalid"}); return json(data??{ok:false,error:"invalid"}); }
```

---
## PART B — Admin panel (React) — new page at `/admin/beta`
Match the existing admin pages: wrap in **`ProtectedAdminRoute`**, use **`useAdminRole`** + the supabase
client + shadcn UI, add the route in `App.tsx`, and link it from the admin nav/dashboard. Thanks to the
admin RLS policies above, the page can query `beta_codes` / `beta_access` directly.

**Overview cards:** total codes · total people in (`beta_access` count) · seats remaining (Σ of `max_uses − used_count` over active codes).

**Codes:**
- **Create code:** label, `max_uses` (`1` = unique per person, `N` = one shared code for N people), optional expiry.
- **Bulk-generate:** "Generate ___ codes" → N unique readable codes (e.g. `RIFT-7K2P`), each `max_uses=1`, one shared label (e.g. "Discord wave 2") → list them with a **Copy all** button.
- **Codes table:** code · label · used/max · active · expires · created. Row actions: **Copy**, **Revoke / Re-enable** (toggle `active`), **Delete**.

**Access (who's in):**
- **Redemptions table:** player (display_name/email via `profiles`) · code used · redeemed date. Row action: **Revoke access** (delete that `beta_access` row).
- **Grant manually:** enter a user's email → look up the user (profiles/users) → insert `beta_access` directly (comp specific people, no code needed).

**Security:** every admin read/write goes through the admin-role gate (the RLS above). Never expose `beta_codes` to non-admins.

---
## After it ships
The game's gate switches on automatically. **Test:** create a code in `/admin/beta` → open
`/games/reactive-rhythm/` while signed out (or with no redemption) → the gate appears → redeem the code
→ it unlocks. Revoke the code in the panel → it stops working. Flip everything off by deleting all
codes / revoking access.
