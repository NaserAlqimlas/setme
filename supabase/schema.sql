-- Run once in Supabase: SQL Editor > New query > paste > Run.
-- Roles: player (signs up for game days, sees published teams; added by the club section at the end),
-- rater (rates players), organizer (also manages players and the Playing list, builds teams),
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
  -- Skills the rater marked U (don't know). A blank skill not listed here hasn't been answered yet.
  unknown text[] not null default '{}',
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
alter table public.games add column if not exists tags_end double precision;  -- seq of the last rally that counts for the score; later ones were played on after the game ended

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
-- Tagging window (also supabase/tag_window.sql): organizers edit tags up to 3 days after the game day, super any time.
create or replace function public.tag_open(p_game bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select public.my_role() = 'super'
      or (public.my_role() = 'organizer' and exists (
            select 1 from public.games g join public.sessions s on s.id = g.session_id
            where g.id = p_game and s.played_on >= current_date - 3));
$$;

drop policy if exists rallies_organizers on public.rallies;
drop policy if exists rallies_read on public.rallies;
drop policy if exists rallies_write on public.rallies;
create policy rallies_read on public.rallies for select to authenticated
  using (public.my_role() in ('organizer', 'super'));
create policy rallies_write on public.rallies for all to authenticated
  using (public.tag_open(game_id)) with check (public.tag_open(game_id));

drop policy if exists touches_organizers on public.touches;
drop policy if exists touches_read on public.touches;
drop policy if exists touches_write on public.touches;
create policy touches_read on public.touches for select to authenticated
  using (public.my_role() in ('organizer', 'super'));
create policy touches_write on public.touches for all to authenticated
  using (exists (select 1 from public.rallies r where r.id = rally_id and public.tag_open(r.game_id)))
  with check (exists (select 1 from public.rallies r where r.id = rally_id and public.tag_open(r.game_id)));

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
    count(*) filter (where action = 'dig' and grade = 2)::int as dig_2,
    count(*) filter (where action = 'dig' and grade = 3)::int as dig_3
  from public.touches group by player_id
)
select coalesce(p.player_id, c.player_id) as player_id, coalesce(p.games, 0) as games,
  coalesce(c.serve_0, 0) as serve_0, coalesce(c.serve_1, 0) as serve_1, coalesce(c.serve_2, 0) as serve_2, coalesce(c.serve_3, 0) as serve_3, coalesce(c.pass_0, 0) as pass_0, coalesce(c.pass_1, 0) as pass_1, coalesce(c.pass_2, 0) as pass_2, coalesce(c.pass_3, 0) as pass_3, coalesce(c.set_0, 0) as set_0, coalesce(c.set_1, 0) as set_1, coalesce(c.set_2, 0) as set_2, coalesce(c.set_3, 0) as set_3, coalesce(c.attack_0, 0) as attack_0, coalesce(c.attack_1, 0) as attack_1, coalesce(c.attack_2, 0) as attack_2, coalesce(c.attack_3, 0) as attack_3, coalesce(c.block_0, 0) as block_0, coalesce(c.block_1, 0) as block_1, coalesce(c.block_3, 0) as block_3, coalesce(c.dig_0, 0) as dig_0, coalesce(c.dig_1, 0) as dig_1, coalesce(c.dig_2, 0) as dig_2, coalesce(c.dig_3, 0) as dig_3
from played p full join counts c on c.player_id = p.player_id;

-- How many games have tags (at least one finished rally).
create or replace view public.tagged_games with (security_invoker = true) as
  select count(distinct game_id)::int as games from public.rallies where won_by is not null;

-- Club: player accounts, sign-ups, published teams, drafts, anchor players, activity log (same as club.sql).
-- ---------- player accounts ----------
-- A new role, player: can't rate; signs up for game days, sees published teams and their own profile.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('player', 'rater', 'organizer', 'super'));
-- Which player an account is (set by the super on Users). One account per player.
alter table public.profiles add column if not exists player_id bigint unique references public.players on delete set null;

-- The signed-in user's player (security definer so policies can read it without recursion).
create or replace function public.my_player() returns bigint
language sql stable security definer set search_path = public as $$
  select player_id from public.profiles where id = auth.uid()
$$;

-- Super can now give the player role too (still never super).
drop policy if exists profiles_super_update on public.profiles;
create policy profiles_super_update on public.profiles for update to authenticated
  using (public.my_role() = 'super')
  with check (role in ('player', 'rater', 'organizer') or id = auth.uid());

-- Players don't rate: their own rating rows are refused (super's imports still work through ratings_super_write).
drop policy if exists ratings_insert on public.ratings;
create policy ratings_insert on public.ratings for insert to authenticated
  with check (rater_id = auth.uid() and public.my_role() <> 'player');
drop policy if exists ratings_update on public.ratings;
create policy ratings_update on public.ratings for update to authenticated
  using (rater_id = auth.uid()) with check (rater_id = auth.uid() and public.my_role() <> 'player');

-- ---------- anchor players ----------
-- Well-known players every rater rates first, so a new rater's lean is known quickly.
alter table public.players add column if not exists anchor boolean not null default false;

-- ---------- sign-ups ----------
-- One per game day. cap = spots; sign-ups past it are the waitlist, in the order they signed up.
create table if not exists public.events (
  id bigint generated always as identity primary key,
  played_on date not null unique,
  cap smallint not null default 24 check (cap between 2 and 200),
  open boolean not null default true,      -- players can sign up or drop out while open
  note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create table if not exists public.signups (
  event_id bigint not null references public.events on delete cascade,
  player_id bigint not null references public.players on delete cascade,
  added_by uuid default auth.uid(),        -- the player themself, or an organizer adding them
  created_at timestamptz not null default now(),
  primary key (event_id, player_id)
);
create index if not exists signups_order on public.signups (event_id, created_at);
alter table public.events enable row level security;
alter table public.signups enable row level security;
-- Everyone signed in sees game days and who's in.
drop policy if exists events_read on public.events;
create policy events_read on public.events for select to authenticated using (true);
drop policy if exists events_organizers on public.events;
create policy events_organizers on public.events for all to authenticated
  using (public.my_role() in ('organizer', 'super')) with check (public.my_role() in ('organizer', 'super'));
drop policy if exists signups_read on public.signups;
create policy signups_read on public.signups for select to authenticated using (true);
-- Organizers add or remove anyone; everyone else only their own linked player, while sign-ups are open.
drop policy if exists signups_insert on public.signups;
create policy signups_insert on public.signups for insert to authenticated with check (
  public.my_role() in ('organizer', 'super')
  or (player_id = public.my_player() and exists (select 1 from public.events e where e.id = event_id and e.open)));
drop policy if exists signups_delete on public.signups;
create policy signups_delete on public.signups for delete to authenticated using (
  public.my_role() in ('organizer', 'super')
  or (player_id = public.my_player() and exists (select 1 from public.events e where e.id = event_id and e.open)));

-- ---------- published teams ----------
-- Organizers choose when a game day's teams (and scores) show on the Lineup page. Off until they turn it on.
alter table public.sessions add column if not exists published boolean not null default false;
-- An organizer ends the game day once the last game is played (Scores page). Reopening is allowed.
-- The first time this runs, game days before today count as ended; running it again changes nothing.
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sessions' and column_name = 'ended') then
    alter table public.sessions add column ended boolean not null default false;
    update public.sessions set ended = true where played_on < current_date;
  end if;
end $$;

-- Published game days, newest first: each team's players by name, and the games' scores. Nothing from ratings.
-- Security definer because players can't read sessions; it only returns what's published.
-- Dropped first: an earlier version had no "ended" column, and a return type can't be changed in place.
drop function if exists public.published_lineups(int);
create function public.published_lineups(p_limit int default 5)
returns table (played_on date, teams jsonb, games jsonb, ended boolean)
language sql stable security definer set search_path = public as $$
  select s.played_on,
    (select coalesce(jsonb_agg(
        (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'setting', p.setting) order by x.ord), '[]'::jsonb)
         from jsonb_array_elements_text(t.team) with ordinality as x(pid, ord) join public.players p on p.id = x.pid::bigint)
       order by t.ord), '[]'::jsonb)
     from jsonb_array_elements(s.teams) with ordinality as t(team, ord)),
    coalesce((select jsonb_agg(jsonb_build_object('team_a', g.team_a, 'team_b', g.team_b, 'score_a', g.score_a, 'score_b', g.score_b) order by g.created_at)
      from public.games g where g.session_id = s.id), '[]'::jsonb),
    s.ended
  from public.sessions s
  where s.published and auth.uid() is not null
  order by s.played_on desc
  limit least(greatest(p_limit, 1), 20)
$$;

-- One player's game days and games, for their profile: the player themself, organizers and super only.
-- team = which team (1, 2, …) they're on in the saved lineup, null if they only played a game that day.
create or replace function public.player_games(p_player bigint)
returns table (session_id bigint, played_on date, team int, games jsonb)
language sql stable security definer set search_path = public as $$
  select s.id, s.played_on,
    -- Their team on a day the organizers haven't published yet stays hidden from the player.
    case when s.published or public.my_role() in ('organizer', 'super') then
      (select t.ord::int from jsonb_array_elements(s.teams) with ordinality as t(team, ord) where t.team @> to_jsonb(p_player) limit 1) end,
    coalesce((select jsonb_agg(jsonb_build_object('session_id', g.session_id, 'team_a', g.team_a, 'team_b', g.team_b, 'players_a', g.players_a,
        'players_b', g.players_b, 'score_a', g.score_a, 'score_b', g.score_b, 'created_at', g.created_at) order by g.created_at)
      from public.games g where g.session_id = s.id and p_player = any(g.players_a || g.players_b)), '[]'::jsonb)
  from public.sessions s
  where (public.my_role() in ('organizer', 'super') or p_player = public.my_player())
    and (exists (select 1 from jsonb_array_elements(s.teams) t where t @> to_jsonb(p_player))
      or exists (select 1 from public.games g where g.session_id = s.id and p_player = any(g.players_a || g.players_b)))
  order by s.played_on
$$;

-- ---------- saved drafts ----------
-- Lineups organizers keep to compare or come back to. teams = player ids per team; the rest is what they were built with.
create table if not exists public.drafts (
  id bigint generated always as identity primary key,
  name text not null,
  played_on date,
  teams jsonb not null,
  raters uuid[],
  all_game bigint[] not null default '{}',
  combos jsonb not null default '[]',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
alter table public.drafts enable row level security;
drop policy if exists drafts_organizers on public.drafts;
create policy drafts_organizers on public.drafts for all to authenticated
  using (public.my_role() in ('organizer', 'super')) with check (public.my_role() in ('organizer', 'super'));

-- ---------- activity log ----------
-- Who did what: roles, removals, players added or deleted, game days deleted, imports for someone else, links made.
-- Written by triggers (and by the admin function); only the super reads it. No foreign keys, so it outlives what it names.
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid default auth.uid(),
  action text not null,
  detail jsonb not null default '{}'
);
create index if not exists audit_recent on public.audit_log (at desc);
alter table public.audit_log enable row level security;
drop policy if exists audit_read on public.audit_log;
create policy audit_read on public.audit_log for select to authenticated using (public.my_role() = 'super');
-- The super's own notes from the browser (e.g. a CSV import for another rater). actor is always the caller.
drop policy if exists audit_super_insert on public.audit_log;
create policy audit_super_insert on public.audit_log for insert to authenticated
  with check (public.my_role() = 'super' and actor = auth.uid());

create or replace function public.audit_profiles() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    -- Removing an account goes through the admin function, which logs it with who did it.
    if auth.uid() is null then return null; end if;
    insert into audit_log (action, detail) values ('user removed', jsonb_build_object('name', old.display_name, 'email', old.email, 'role', old.role));
  end if;
  if old.role is distinct from new.role then
    insert into audit_log (action, detail) values ('role changed', jsonb_build_object('name', new.display_name, 'from', old.role, 'to', new.role));
  end if;
  if old.player_id is distinct from new.player_id then
    insert into audit_log (action, detail) values ('account linked', jsonb_build_object('name', new.display_name,
      'player', (select name from players where id = new.player_id), 'was', (select name from players where id = old.player_id)));
  end if;
  return null;
end $$;
drop trigger if exists profiles_audit on public.profiles;
create trigger profiles_audit after update or delete on public.profiles
  for each row execute function public.audit_profiles();

create or replace function public.audit_players() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into audit_log (action, detail) values ('player added', jsonb_build_object('name', new.name, 'tier', new.tier));
  elsif tg_op = 'DELETE' then
    insert into audit_log (action, detail) values ('player deleted', jsonb_build_object('name', old.name));
  elsif old.name is distinct from new.name then
    insert into audit_log (action, detail) values ('player renamed', jsonb_build_object('from', old.name, 'to', new.name));
  elsif old.anchor is distinct from new.anchor then
    insert into audit_log (action, detail) values (case when new.anchor then 'anchor added' else 'anchor removed' end, jsonb_build_object('name', new.name));
  end if;
  return null;
end $$;
drop trigger if exists players_audit on public.players;
create trigger players_audit after insert or update or delete on public.players
  for each row execute function public.audit_players();

create or replace function public.audit_sessions() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log (action, detail) values ('game day deleted', jsonb_build_object('played_on', old.played_on));
  return null;
end $$;
drop trigger if exists sessions_audit on public.sessions;
create trigger sessions_audit after delete on public.sessions
  for each row execute function public.audit_sessions();

-- ---------- rounds ----------
-- A game day can reshuffle its teams partway through; see rounds.sql. Replaces published_lineups above.
create table if not exists public.rounds (
  id bigint generated always as identity primary key,
  session_id bigint not null references public.sessions on delete cascade,
  n smallint not null check (n >= 1),
  teams jsonb not null,     -- each team's players at the end of that round ([[player id, ...], ...])
  raters uuid[],
  all_game bigint[] not null default '{}',
  source text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (session_id, n)
);

alter table public.games add column if not exists round smallint not null default 1;

alter table public.rounds enable row level security;
drop policy if exists rounds_organizers on public.rounds;
create policy rounds_organizers on public.rounds for all to authenticated
  using (public.my_role() in ('organizer', 'super')) with check (public.my_role() in ('organizer', 'super'));

-- A teams array ([[id, ...], ...]) with each player's id, name and setter role, in order. Used by published_lineups.
create or replace function public.lineup_names(p_teams jsonb)
returns jsonb language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(
      (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'setting', p.setting) order by x.ord), '[]'::jsonb)
       from jsonb_array_elements_text(t.team) with ordinality as x(pid, ord) join public.players p on p.id = x.pid::bigint)
     order by t.ord), '[]'::jsonb)
  from jsonb_array_elements(p_teams) with ordinality as t(team, ord)
$$;

-- Published game days for the Lineup page, now with each game's round and the earlier rounds' teams
-- (rounds: [{ n, teams: [[{ id, name, setting }, ...], ...] }, ...], [] with one round). Nothing from ratings.
-- Security definer because players can't read sessions; it only returns what's published.
-- Dropped first because the return type changes.
drop function if exists public.published_lineups(int);
create function public.published_lineups(p_limit int default 5)
returns table (played_on date, teams jsonb, games jsonb, ended boolean, rounds jsonb)
language sql stable security definer set search_path = public as $$
  select s.played_on,
    public.lineup_names(s.teams),
    coalesce((select jsonb_agg(jsonb_build_object('team_a', g.team_a, 'team_b', g.team_b, 'score_a', g.score_a, 'score_b', g.score_b, 'round', g.round) order by g.created_at)
      from public.games g where g.session_id = s.id), '[]'::jsonb),
    s.ended,
    coalesce((select jsonb_agg(jsonb_build_object('n', r.n, 'teams', public.lineup_names(r.teams)) order by r.n)
      from public.rounds r where r.session_id = s.id), '[]'::jsonb)
  from public.sessions s
  where s.published and auth.uid() is not null
  order by s.played_on desc
  limit least(greatest(p_limit, 1), 20)
$$;

-- Start the next round: the round just played goes into rounds, the new teams onto the session. One transaction.
-- Runs as the caller, so the organizer policies above apply. Returns the new round's number.
create or replace function public.start_round(p_session bigint, p_teams jsonb, p_raters uuid[], p_all_game bigint[], p_source text)
returns int language plpgsql set search_path = public as $$
declare n int;
begin
  select coalesce(max(r.n), 0) + 1 into n from rounds r where r.session_id = p_session;
  insert into rounds (session_id, n, teams, raters, all_game, source)
    select s.id, n, s.teams, s.raters, s.all_game, s.source from sessions s where s.id = p_session;
  if not found then raise exception 'Game day not found'; end if;
  update sessions set teams = p_teams, raters = p_raters, all_game = coalesce(p_all_game, '{}'), source = p_source where id = p_session;
  return n + 1;
end $$;

-- Undo starting a round that has no games yet: the previous round's teams come back.
create or replace function public.undo_round(p_session bigint)
returns int language plpgsql set search_path = public as $$
declare r rounds;
begin
  select * into r from rounds where session_id = p_session order by n desc limit 1;
  if r.id is null then raise exception 'This game day has only one round'; end if;
  if exists (select 1 from games g where g.session_id = p_session and g.round = r.n + 1) then
    raise exception 'Round % already has games. Delete them first.', r.n + 1;
  end if;
  update sessions set teams = r.teams, raters = r.raters, all_game = r.all_game, source = r.source where id = p_session;
  delete from rounds where id = r.id;
  return r.n;
end $$;

-- ---------- remembered names ----------
-- Pasted names matched by hand on Players; see aliases.sql.
create table if not exists public.player_aliases (
  alias text primary key,   -- the pasted name in compact form: lowercase letters, digits and '+', nothing else
  player_id bigint not null references public.players on delete cascade,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

alter table public.player_aliases enable row level security;
drop policy if exists player_aliases_organizers on public.player_aliases;
create policy player_aliases_organizers on public.player_aliases for all to authenticated
  using (public.my_role() in ('organizer', 'super')) with check (public.my_role() in ('organizer', 'super'));

-- One player's game days and games, for their profile, now with rounds: each game's round, and (on published days,
-- or for organizers) every round's teams so the profile can name the team they were on in each round:
-- rounds: [{ n, all_game, teams: [[{ id, name, setting }, ...], ...] }, ...], oldest first, the last being the
-- round playing now. Same access as before: the player themself, organizers and super. Dropped first because the
-- return type changes.
drop function if exists public.player_games(bigint);
create function public.player_games(p_player bigint)
returns table (session_id bigint, played_on date, team int, games jsonb, rounds jsonb)
language sql stable security definer set search_path = public as $$
  select s.id, s.played_on,
    -- Their team on a day the organizers haven't published yet stays hidden from the player.
    case when s.published or public.my_role() in ('organizer', 'super') then
      (select t.ord::int from jsonb_array_elements(s.teams) with ordinality as t(team, ord) where t.team @> to_jsonb(p_player) limit 1) end,
    coalesce((select jsonb_agg(jsonb_build_object('session_id', g.session_id, 'team_a', g.team_a, 'team_b', g.team_b, 'players_a', g.players_a,
        'players_b', g.players_b, 'score_a', g.score_a, 'score_b', g.score_b, 'created_at', g.created_at, 'round', g.round) order by g.created_at)
      from public.games g where g.session_id = s.id and p_player = any(g.players_a || g.players_b)), '[]'::jsonb),
    case when s.published or public.my_role() in ('organizer', 'super') then
      coalesce((select jsonb_agg(jsonb_build_object('n', r.n, 'all_game', r.all_game, 'teams', public.lineup_names(r.teams)) order by r.n)
        from public.rounds r where r.session_id = s.id), '[]'::jsonb)
      || jsonb_build_array(jsonb_build_object('n', (select count(*) + 1 from public.rounds r where r.session_id = s.id),
        'all_game', s.all_game, 'teams', public.lineup_names(s.teams))) end
  from public.sessions s
  where (public.my_role() in ('organizer', 'super') or p_player = public.my_player())
    and (exists (select 1 from jsonb_array_elements(s.teams) t where t @> to_jsonb(p_player))
      or exists (select 1 from public.games g where g.session_id = s.id and p_player = any(g.players_a || g.players_b))
      or exists (select 1 from public.rounds r, jsonb_array_elements(r.teams) t where r.session_id = s.id and t @> to_jsonb(p_player)))
  order by s.played_on
$$;
