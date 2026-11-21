-- Setters not setting: a setter can sit out setting for a game day (Teams, Setters card: Not setting). The teams saved
-- for the day remember who, so the Scores page predicts each game the same way the teams were built. Run once in the
-- SQL Editor after rounds.sql (also in schema.sql for new projects). Safe to run again. Before it runs, saving still
-- works; predictions then count those setters as setters.

alter table public.sessions add column if not exists no_set bigint[] not null default '{}';
alter table public.rounds add column if not exists no_set bigint[] not null default '{}';

-- start_round and undo_round carry no_set along with the rest of a round's lineup.
drop function if exists public.start_round(bigint, jsonb, uuid[], bigint[], text);
create or replace function public.start_round(p_session bigint, p_teams jsonb, p_raters uuid[], p_all_game bigint[], p_source text, p_no_set bigint[] default '{}')
returns int language plpgsql set search_path = public as $$
declare n int;
begin
  select coalesce(max(r.n), 0) + 1 into n from rounds r where r.session_id = p_session;
  insert into rounds (session_id, n, teams, raters, all_game, source, no_set)
    select s.id, n, s.teams, s.raters, s.all_game, s.source, s.no_set from sessions s where s.id = p_session;
  if not found then raise exception 'Game day not found'; end if;
  update sessions set teams = p_teams, raters = p_raters, all_game = coalesce(p_all_game, '{}'), source = p_source,
    no_set = coalesce(p_no_set, '{}') where id = p_session;
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
  update sessions set teams = r.teams, raters = r.raters, all_game = r.all_game, source = r.source, no_set = r.no_set where id = p_session;
  delete from rounds where id = r.id;
  return r.n;
end $$;
