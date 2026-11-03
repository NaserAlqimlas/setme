-- Run once in Supabase: SQL Editor > New query > paste > Run.
-- Roles: rater (rates players), organizer (also manages players and the Playing list, builds teams),
-- super (everything, and the only role that can see ratings or manage users).

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  email text,
  display_name text,
  role text not null default 'rater' check (role in ('rater', 'organizer', 'super')),
  created_at timestamptz not null default now()
);

create table public.players (
  id bigint generated always as identity primary key,
  name text not null unique,
  gender text not null default 'U' check (gender in ('M', 'F', 'U')),
  setting text not null default 'N' check (setting in ('M', 'B', 'N')),
  -- Stand-in level until someone rates them; null counts as beginner.
  tier text check (tier in ('beginner', 'average', 'strong')),
  playing boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- null = unknown (U)
create table public.ratings (
  rater_id uuid not null references public.profiles on delete cascade,
  player_id bigint not null references public.players on delete cascade,
  receiving numeric(3,2) check (receiving in (0, .25, .5, .75, 1)),
  hitting   numeric(3,2) check (hitting   in (0, .25, .5, .75, 1)),
  hustle    numeric(3,2) check (hustle    in (0, .25, .5, .75, 1)),
  serve     numeric(3,2) check (serve     in (0, .25, .5, .75, 1)),
  blocking  numeric(3,2) check (blocking  in (0, .25, .5, .75, 1)),
  -- How well they set. Rated for setters only; counts only while they set all game.
  setting_skill numeric(3,2) check (setting_skill in (0, .25, .5, .75, 1)),
  -- How steady they are day to day. Not part of strength; the team builder spreads low ones out.
  consistency numeric(3,2) check (consistency in (0, .25, .5, .75, 1)),
  updated_at timestamptz not null default now(),
  primary key (rater_id, player_id)
);

-- Combos (play together / keep apart) aren't stored: they're set on the Teams page for each build.

-- Every new auth user gets a profile; the name comes from the invite.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger ratings_touch before update on public.ratings
  for each row execute function public.touch_updated_at();

-- Every rating change, one row per skill. Filled by a trigger, so taps, CSV imports and SQL edits all land here.
-- Taps by the same person on the same skill within 10 minutes merge into one row (tapping back to the start removes it).
-- No foreign keys: history outlives a removed player or rater.
create table public.rating_history (
  id bigint generated always as identity primary key,
  rater_id uuid not null,
  player_id bigint not null,
  skill text not null,
  old_value numeric(3,2),   -- null = U, or no rating yet
  new_value numeric(3,2),   -- null = U, or rating deleted
  changed_by uuid,          -- who made the change (super importing for someone else, null from the SQL editor)
  changed_at timestamptz not null default now()
);
create index rating_history_recent on public.rating_history (changed_at desc);

create function public.log_rating_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  oldj jsonb := case when tg_op = 'INSERT' then '{}' else to_jsonb(old) end;
  newj jsonb := case when tg_op = 'DELETE' then '{}' else to_jsonb(new) end;
  rid uuid := coalesce(newj->>'rater_id', oldj->>'rater_id')::uuid;
  pid bigint := coalesce(newj->>'player_id', oldj->>'player_id')::bigint;
  s text; o numeric; n numeric; prev public.rating_history;
begin
  foreach s in array array['receiving', 'hitting', 'hustle', 'serve', 'blocking', 'setting_skill', 'consistency'] loop
    o := (oldj->>s)::numeric; n := (newj->>s)::numeric;
    continue when o is not distinct from n;
    select * into prev from public.rating_history
      where rater_id = rid and player_id = pid and skill = s
        and changed_by is not distinct from auth.uid() and changed_at > now() - interval '10 minutes'
      order by changed_at desc limit 1;
    if not found then
      insert into public.rating_history (rater_id, player_id, skill, old_value, new_value, changed_by)
      values (rid, pid, s, o, n, auth.uid());
    elsif prev.old_value is not distinct from n then
      delete from public.rating_history where id = prev.id;
    else
      update public.rating_history set new_value = n, changed_at = now() where id = prev.id;
    end if;
  end loop;
  return null;
end $$;
create trigger ratings_history after insert or update or delete on public.ratings
  for each row execute function public.log_rating_change();

-- Role of the signed-in user (security definer so policies can read it without recursion).
create function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

alter table public.profiles enable row level security;
alter table public.players  enable row level security;
alter table public.ratings  enable row level security;
alter table public.rating_history enable row level security;

-- profiles: see yourself; super sees and edits everyone but can't create another super.
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.my_role() = 'super');
create policy profiles_super_update on public.profiles for update to authenticated
  using (public.my_role() = 'super')
  with check (role in ('rater', 'organizer') or id = auth.uid());

-- players: everyone signed in can read; organizers edit (playing, gender, setting); only super adds or deletes.
create policy players_read on public.players for select to authenticated using (true);
create policy players_update on public.players for update to authenticated
  using (public.my_role() in ('organizer', 'super'))
  with check (public.my_role() in ('organizer', 'super'));
create policy players_insert on public.players for insert to authenticated with check (public.my_role() = 'super');
create policy players_delete on public.players for delete to authenticated using (public.my_role() = 'super');

-- ratings: you read and write only your own; super reads all.
create policy ratings_read on public.ratings for select to authenticated
  using (rater_id = auth.uid() or public.my_role() = 'super');
create policy ratings_insert on public.ratings for insert to authenticated with check (rater_id = auth.uid());
create policy ratings_update on public.ratings for update to authenticated
  using (rater_id = auth.uid()) with check (rater_id = auth.uid());
create policy ratings_delete on public.ratings for delete to authenticated using (rater_id = auth.uid());
-- super can also import ratings on behalf of another rater (CSV import).
create policy ratings_super_write on public.ratings for all to authenticated
  using (public.my_role() = 'super') with check (public.my_role() = 'super');

-- rating_history: super reads everything, everyone else their own; only the trigger writes it.
create policy rating_history_read on public.rating_history for select to authenticated
  using (public.my_role() = 'super' or rater_id = auth.uid());

-- Scores: saved lineups per game day and each game's result (same as scores.sql).
create table public.sessions (
  id bigint generated always as identity primary key,
  played_on date not null unique,
  teams jsonb not null,     -- each team's players right now; late changes edit it
  raters uuid[],            -- what the lineup was built with (null = everyone's ratings), reused to predict each game
  all_game bigint[] not null default '{}',
  source text,              -- 'built', 'edited' or 'own'
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.games (
  id bigint generated always as identity primary key,
  session_id bigint not null references public.sessions on delete cascade,
  team_a smallint not null,
  team_b smallint not null,
  players_a bigint[] not null,  -- who was on each team for this game
  players_b bigint[] not null,
  score_a smallint not null check (score_a between 0 and 99),
  score_b smallint not null check (score_b between 0 and 99),
  predicted jsonb,              -- team numbers from the ratings when the game was saved
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index games_session on public.games (session_id, created_at);
create trigger sessions_touch before update on public.sessions
  for each row execute function public.touch_updated_at();
alter table public.sessions enable row level security;
alter table public.games enable row level security;
create policy sessions_organizers on public.sessions for all to authenticated
  using (public.my_role() in ('organizer', 'super')) with check (public.my_role() in ('organizer', 'super'));
create policy games_organizers on public.games for all to authenticated
  using (public.my_role() in ('organizer', 'super')) with check (public.my_role() in ('organizer', 'super'));

-- Match stats: tags entered while watching a game's video (same as match_stats.sql). The video is never uploaded.
alter table public.games add column if not exists video_kind text check (video_kind in ('file', 'youtube'));
alter table public.games add column if not exists video_ref text;  -- file name, or YouTube video id

-- One per rally. id is made in the browser, so a save that's sent twice doesn't add the rally twice.
create table if not exists public.rallies (
  id uuid primary key,
  game_id bigint not null references public.games on delete cascade,
  seq double precision not null,      -- order within the game
  video_t real,                       -- seconds into the video (null when tagged live)
  serving text not null check (serving in ('a', 'b')),   -- games.team_a's side is 'a'
  won_by text check (won_by in ('a', 'b')),              -- null while the rally is in play
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);
create index if not exists rallies_game on public.rallies (game_id, seq);

-- One per touch: who did what, and how well (0 worst to 3 best; see ACTIONS in site/js/stats.mjs).
create table if not exists public.touches (
  rally_id uuid not null references public.rallies on delete cascade,
  seq smallint not null,
  player_id bigint not null references public.players on delete cascade,
  action text not null check (action in ('serve', 'pass', 'set', 'attack', 'block', 'dig')),
  grade smallint not null check (grade between 0 and 3),
  video_t real,
  primary key (rally_id, seq)
);
create index if not exists touches_player on public.touches (player_id, action);

alter table public.rallies enable row level security;
alter table public.touches enable row level security;
drop policy if exists rallies_organizers on public.rallies;
create policy rallies_organizers on public.rallies for all to authenticated
  using (public.my_role() in ('organizer', 'super')) with check (public.my_role() in ('organizer', 'super'));
drop policy if exists touches_organizers on public.touches;
create policy touches_organizers on public.touches for all to authenticated
  using (public.my_role() in ('organizer', 'super')) with check (public.my_role() in ('organizer', 'super'));

-- Save a game's tags in one go: the rallies that changed (each with all its touches) and the ids of deleted ones.
-- Runs as the caller, so the policies above still apply. All or nothing.
-- p_rallies: [{ id, seq, t, serve, won, touches: [{ p, a, g, t }] }]
create or replace function public.save_game_tags(p_game bigint, p_rallies jsonb, p_deleted uuid[] default '{}')
returns void language plpgsql security invoker set search_path = public as $$
declare r jsonb; rid uuid;
begin
  delete from rallies where game_id = p_game and id = any(p_deleted);
  for r in select * from jsonb_array_elements(p_rallies) loop
    rid := (r->>'id')::uuid;
    if exists (select 1 from rallies where id = rid and game_id <> p_game) then
      raise exception 'Rally % belongs to another game', rid;
    end if;
    insert into rallies (id, game_id, seq, video_t, serving, won_by)
    values (rid, p_game, (r->>'seq')::double precision, (r->>'t')::real, r->>'serve', r->>'won')
    on conflict (id) do update set seq = excluded.seq, video_t = excluded.video_t, serving = excluded.serving,
      won_by = excluded.won_by, updated_at = now();
    delete from touches where rally_id = rid;
    insert into touches (rally_id, seq, player_id, action, grade, video_t)
    select rid, (x.ord - 1)::smallint, (x.t->>'p')::bigint, x.t->>'a', (x.t->>'g')::smallint, (x.t->>'t')::real
    from jsonb_array_elements(r->'touches') with ordinality as x(t, ord);
  end loop;
end $$;

-- One row per player across tagged games: games played (a game counts once it has a finished rally) and how many
-- of each action at each grade, as <action>_<grade> (serve_3 = aces). One row per player keeps it well under the API's row limit.
create or replace view public.player_stats with (security_invoker = true) as
with played as (
  select p.player_id, count(*)::int as games
  from public.games g
  cross join lateral unnest(g.players_a || g.players_b) as p(player_id)
  where exists (select 1 from public.rallies r where r.game_id = g.id and r.won_by is not null)
  group by p.player_id
), counts as (
  select player_id,
    count(*) filter (where action = 'serve' and grade = 0)::int as serve_0,
    count(*) filter (where action = 'serve' and grade = 1)::int as serve_1,
    count(*) filter (where action = 'serve' and grade = 2)::int as serve_2,
    count(*) filter (where action = 'serve' and grade = 3)::int as serve_3,
    count(*) filter (where action = 'pass' and grade = 0)::int as pass_0,
    count(*) filter (where action = 'pass' and grade = 1)::int as pass_1,
    count(*) filter (where action = 'pass' and grade = 2)::int as pass_2,
    count(*) filter (where action = 'pass' and grade = 3)::int as pass_3,
    count(*) filter (where action = 'set' and grade = 0)::int as set_0,
    count(*) filter (where action = 'set' and grade = 1)::int as set_1,
    count(*) filter (where action = 'set' and grade = 2)::int as set_2,
    count(*) filter (where action = 'set' and grade = 3)::int as set_3,
    count(*) filter (where action = 'attack' and grade = 0)::int as attack_0,
    count(*) filter (where action = 'attack' and grade = 1)::int as attack_1,
    count(*) filter (where action = 'attack' and grade = 2)::int as attack_2,
    count(*) filter (where action = 'attack' and grade = 3)::int as attack_3,
    count(*) filter (where action = 'block' and grade = 0)::int as block_0,
    count(*) filter (where action = 'block' and grade = 1)::int as block_1,
    count(*) filter (where action = 'block' and grade = 3)::int as block_3,
    count(*) filter (where action = 'dig' and grade = 0)::int as dig_0,
    count(*) filter (where action = 'dig' and grade = 1)::int as dig_1,
    count(*) filter (where action = 'dig' and grade = 2)::int as dig_2
  from public.touches group by player_id
)
select coalesce(p.player_id, c.player_id) as player_id, coalesce(p.games, 0) as games,
  coalesce(c.serve_0, 0) as serve_0, coalesce(c.serve_1, 0) as serve_1, coalesce(c.serve_2, 0) as serve_2, coalesce(c.serve_3, 0) as serve_3, coalesce(c.pass_0, 0) as pass_0, coalesce(c.pass_1, 0) as pass_1, coalesce(c.pass_2, 0) as pass_2, coalesce(c.pass_3, 0) as pass_3, coalesce(c.set_0, 0) as set_0, coalesce(c.set_1, 0) as set_1, coalesce(c.set_2, 0) as set_2, coalesce(c.set_3, 0) as set_3, coalesce(c.attack_0, 0) as attack_0, coalesce(c.attack_1, 0) as attack_1, coalesce(c.attack_2, 0) as attack_2, coalesce(c.attack_3, 0) as attack_3, coalesce(c.block_0, 0) as block_0, coalesce(c.block_1, 0) as block_1, coalesce(c.block_3, 0) as block_3, coalesce(c.dig_0, 0) as dig_0, coalesce(c.dig_1, 0) as dig_1, coalesce(c.dig_2, 0) as dig_2
from played p full join counts c on c.player_id = p.player_id;

-- How many games have tags (at least one finished rally).
create or replace view public.tagged_games with (security_invoker = true) as
  select count(distinct game_id)::int as games from public.rallies where won_by is not null;
