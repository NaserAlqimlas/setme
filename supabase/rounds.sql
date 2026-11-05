-- Rounds: a game day can reshuffle its teams partway through. Run once in the SQL Editor (safe to run again;
-- also at the end of schema.sql for new projects).
--
-- sessions.teams stays the teams playing now (the current round), so everything that reads it keeps working.
-- Starting a new round copies the round just played into rounds (n = 1, 2, …) and puts the new teams on the
-- session. The current round's number is one more than the highest n here. Each game remembers its round.
-- Before this runs, a game day has one round and saving new teams replaces it, as before.

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
