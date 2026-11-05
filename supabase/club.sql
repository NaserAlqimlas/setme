-- Upgrade: player accounts, sign-ups, published teams, ending a game day, saved drafts, anchor players and the activity log.
-- Run once in the SQL Editor (safe to run again; also in schema.sql for new projects).
-- Until it runs, everything else keeps working: the pages that need it say so.

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
