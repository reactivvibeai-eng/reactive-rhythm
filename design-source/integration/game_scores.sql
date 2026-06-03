-- =============================================================================
-- RHYTHM RIFT — database migration
-- Run in Supabase SQL editor (project ref: bxiejoktoknybpraxebm)
-- =============================================================================

-- 1) CHART COLUMNS on radio_tracks ------------------------------------------
alter table public.radio_tracks
  add column if not exists chart_v1          jsonb,
  add column if not exists chart_analyzed_at timestamptz,
  add column if not exists chart_status      text default 'none'
    check (chart_status in ('none','pending','ready','failed')),
  add column if not exists duration_seconds  numeric;

-- fast filter for "playable" tracks + the catalog list query
create index if not exists idx_radio_tracks_chart_ready
  on public.radio_tracks (chart_status)
  where chart_status = 'ready';

create index if not exists idx_radio_tracks_genre
  on public.radio_tracks (genre);

-- =============================================================================
-- 2) GAME_SCORES — keep EVERY play (history + analytics + "recently played").
--    Personal best / leaderboards are computed with DISTINCT ON, not by
--    overwriting rows. Best score is per (track_id, user_id, difficulty).
-- =============================================================================
create table if not exists public.game_scores (
  id            uuid primary key default gen_random_uuid(),
  track_id      uuid not null references public.radio_tracks(id) on delete cascade,
  user_id       uuid not null references auth.users(id)          on delete cascade,
  difficulty    text not null check (difficulty in ('easy','normal','hard')),

  score         integer not null check (score >= 0),
  accuracy      numeric(5,2) not null check (accuracy >= 0 and accuracy <= 100),
  max_combo     integer not null default 0,
  grade         text    not null check (grade in ('S','A','B','C','D')),
  full_combo    boolean not null default false,

  -- judgment breakdown (for replays / stats / anti-cheat sanity checks)
  perfect_count integer not null default 0,
  great_count   integer not null default 0,
  good_count    integer not null default 0,
  miss_count    integer not null default 0,
  notes_total   integer not null default 0,

  chart_version integer not null default 1,
  client_meta   jsonb,            -- optional: { device, mods, app_version }
  played_at     timestamptz not null default now()
);

-- leaderboard read path: top scores within a track + difficulty
create index if not exists idx_scores_leaderboard
  on public.game_scores (track_id, difficulty, score desc, accuracy desc, max_combo desc);

-- a user's own history / "recently played"
create index if not exists idx_scores_user
  on public.game_scores (user_id, played_at desc);

-- =============================================================================
-- 3) ROW LEVEL SECURITY
-- =============================================================================
alter table public.game_scores enable row level security;

-- anyone signed in can read scores (leaderboards are public)
create policy "scores readable by all authed"
  on public.game_scores for select
  to authenticated
  using (true);

-- a user may only insert rows for themselves
create policy "users insert own scores"
  on public.game_scores for insert
  to authenticated
  with check (auth.uid() = user_id);

-- no updates/deletes from clients (scores are immutable; moderation via service role)

-- =============================================================================
-- 4) LEADERBOARD VIEW — one best row per user per (track, difficulty),
--    then ranked. Query this with .eq('track_id', …).eq('difficulty', …).
-- =============================================================================
create or replace view public.v_track_leaderboard as
select
  b.track_id,
  b.difficulty,
  b.user_id,
  p.display_name,
  p.artist_name,
  p.avatar_url,
  b.score,
  b.accuracy,
  b.max_combo,
  b.grade,
  b.full_combo,
  b.played_at,
  rank() over (
    partition by b.track_id, b.difficulty
    order by b.score desc, b.accuracy desc, b.max_combo desc, b.played_at asc
  ) as rank
from (
  -- best single play per user/track/difficulty
  select distinct on (s.track_id, s.difficulty, s.user_id) s.*
  from public.game_scores s
  order by s.track_id, s.difficulty, s.user_id,
           s.score desc, s.accuracy desc, s.max_combo desc, s.played_at asc
) b
left join public.profiles p on p.user_id = b.user_id;

-- Example reads -------------------------------------------------------------
-- Top 20 on a track (normal):
--   select * from v_track_leaderboard
--   where track_id = $1 and difficulty = 'normal'
--   order by rank limit 20;
--
-- A player's personal best on a track:
--   select * from v_track_leaderboard
--   where track_id = $1 and difficulty = 'normal' and user_id = auth.uid();
