-- Team captains: the organizers pick a captain for each team (Teams or Scores), and the team is named after them
-- ("Sara's Team") everywhere: Scores, Games, Lineup, profiles, emails and shared images. No captain picked: named
-- after its setter as before. Run once in the SQL Editor after rounds.sql and nosetters.sql (also in schema.sql for
-- new projects). Safe to run again. Before it runs, everything works as before and picking a captain says to run it.
--
-- captains: one entry per team, in team order: the captain's player id, or null. On the game day (the round playing
-- now) and on each earlier round.
alter table public.sessions add column if not exists captains jsonb;
alter table public.rounds add column if not exists captains jsonb;

-- A lineup with each player's id, name and setter role, and captain: true on each team's captain.
create or replace function public.lineup_names(p_teams jsonb, p_captains jsonb)
returns jsonb language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(
      (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'setting', p.setting)
          || case when jsonb_typeof(p_captains) = 'array' and p_captains->>(t.ord::int - 1) = p.id::text then '{"captain": true}'::jsonb else '{}'::jsonb end
          order by x.ord), '[]'::jsonb)
       from jsonb_array_elements_text(t.team) with ordinality as x(pid, ord) join public.players p on p.id = x.pid::bigint)
     order by t.ord), '[]'::jsonb)
  from jsonb_array_elements(p_teams) with ordinality as t(team, ord)
$$;

-- Same as rounds.sql, with the captains marked.
create or replace function public.published_lineups(p_limit int default 5)
returns table (played_on date, teams jsonb, games jsonb, ended boolean, rounds jsonb)
language sql stable security definer set search_path = public as $$
  select s.played_on,
    public.lineup_names(s.teams, s.captains),
    coalesce((select jsonb_agg(jsonb_build_object('team_a', g.team_a, 'team_b', g.team_b, 'score_a', g.score_a, 'score_b', g.score_b, 'round', g.round) order by g.created_at)
      from public.games g where g.session_id = s.id), '[]'::jsonb),
    s.ended,
    coalesce((select jsonb_agg(jsonb_build_object('n', r.n, 'teams', public.lineup_names(r.teams, r.captains)) order by r.n)
      from public.rounds r where r.session_id = s.id), '[]'::jsonb)
  from public.sessions s
  where s.published and auth.uid() is not null
  order by s.played_on desc
  limit least(greatest(p_limit, 1), 20)
$$;

create or replace function public.player_games(p_player bigint)
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
      coalesce((select jsonb_agg(jsonb_build_object('n', r.n, 'all_game', r.all_game, 'teams', public.lineup_names(r.teams, r.captains)) order by r.n)
        from public.rounds r where r.session_id = s.id), '[]'::jsonb)
      || jsonb_build_array(jsonb_build_object('n', (select count(*) + 1 from public.rounds r where r.session_id = s.id),
        'all_game', s.all_game, 'teams', public.lineup_names(s.teams, s.captains))) end
  from public.sessions s
  where (public.my_role() in ('organizer', 'super') or p_player = public.my_player())
    and (exists (select 1 from jsonb_array_elements(s.teams) t where t @> to_jsonb(p_player))
      or exists (select 1 from public.games g where g.session_id = s.id and p_player = any(g.players_a || g.players_b))
      or exists (select 1 from public.rounds r, jsonb_array_elements(r.teams) t where r.session_id = s.id and t @> to_jsonb(p_player)))
  order by s.played_on
$$;

-- start_round and undo_round (as nosetters.sql) carry the captains with the rest of a round's lineup. A new round
-- starts with none; the client saves the new round's captains straight after.
create or replace function public.start_round(p_session bigint, p_teams jsonb, p_raters uuid[], p_all_game bigint[], p_source text, p_no_set bigint[] default '{}')
returns int language plpgsql set search_path = public as $$
declare n int;
begin
  select coalesce(max(r.n), 0) + 1 into n from rounds r where r.session_id = p_session;
  insert into rounds (session_id, n, teams, raters, all_game, source, no_set, captains)
    select s.id, n, s.teams, s.raters, s.all_game, s.source, s.no_set, s.captains from sessions s where s.id = p_session;
  if not found then raise exception 'Game day not found'; end if;
  update sessions set teams = p_teams, raters = p_raters, all_game = coalesce(p_all_game, '{}'), source = p_source,
    no_set = coalesce(p_no_set, '{}'), captains = null where id = p_session;
  return n + 1;
end $$;

create or replace function public.undo_round(p_session bigint)
returns int language plpgsql set search_path = public as $$
declare r rounds;
begin
  select * into r from rounds where session_id = p_session order by n desc limit 1;
  if r.id is null then raise exception 'This game day has only one round'; end if;
  if exists (select 1 from games g where g.session_id = p_session and g.round = r.n + 1) then
    raise exception 'Round % already has games. Delete them first.', r.n + 1;
  end if;
  update sessions set teams = r.teams, raters = r.raters, all_game = r.all_game, source = r.source, no_set = r.no_set,
    captains = r.captains where id = p_session;
  delete from rounds where id = r.id;
  return r.n;
end $$;

notify pgrst, 'reload schema';
