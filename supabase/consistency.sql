-- Consistency from tags: the same counts as player_stats, one row per player per game day they played a tagged game.
-- SetMe rates consistency from how much a player's game score moves from one game day to the next.
-- Run once in the SQL Editor after match_stats.sql and dig_perfect.sql (also in schema.sql for new projects). Safe to run again.
create or replace view public.player_day_stats with (security_invoker = true) as
with played as (
  select p.player_id, g.session_id, count(*)::int as games
  from public.games g
  cross join lateral unnest(g.players_a || g.players_b) as p(player_id)
  where exists (select 1 from public.rallies r where r.game_id = g.id and r.won_by is not null)
  group by p.player_id, g.session_id
), counts as (
  select t.player_id, g.session_id,
    count(*) filter (where t.action = 'serve' and t.grade = 0)::int as serve_0,
    count(*) filter (where t.action = 'serve' and t.grade = 1)::int as serve_1,
    count(*) filter (where t.action = 'serve' and t.grade = 2)::int as serve_2,
    count(*) filter (where t.action = 'serve' and t.grade = 3)::int as serve_3,
    count(*) filter (where t.action = 'pass' and t.grade = 0)::int as pass_0,
    count(*) filter (where t.action = 'pass' and t.grade = 1)::int as pass_1,
    count(*) filter (where t.action = 'pass' and t.grade = 2)::int as pass_2,
    count(*) filter (where t.action = 'pass' and t.grade = 3)::int as pass_3,
    count(*) filter (where t.action = 'set' and t.grade = 0)::int as set_0,
    count(*) filter (where t.action = 'set' and t.grade = 1)::int as set_1,
    count(*) filter (where t.action = 'set' and t.grade = 2)::int as set_2,
    count(*) filter (where t.action = 'set' and t.grade = 3)::int as set_3,
    count(*) filter (where t.action = 'attack' and t.grade = 0)::int as attack_0,
    count(*) filter (where t.action = 'attack' and t.grade = 1)::int as attack_1,
    count(*) filter (where t.action = 'attack' and t.grade = 2)::int as attack_2,
    count(*) filter (where t.action = 'attack' and t.grade = 3)::int as attack_3,
    count(*) filter (where t.action = 'block' and t.grade = 0)::int as block_0,
    count(*) filter (where t.action = 'block' and t.grade = 1)::int as block_1,
    count(*) filter (where t.action = 'block' and t.grade = 3)::int as block_3,
    count(*) filter (where t.action = 'dig' and t.grade = 0)::int as dig_0,
    count(*) filter (where t.action = 'dig' and t.grade = 1)::int as dig_1,
    count(*) filter (where t.action = 'dig' and t.grade = 2)::int as dig_2,
    count(*) filter (where t.action = 'dig' and t.grade = 3)::int as dig_3
  from public.touches t join public.rallies r on r.id = t.rally_id join public.games g on g.id = r.game_id
  group by t.player_id, g.session_id
)
select p.player_id, p.session_id, p.games,
  coalesce(c.serve_0, 0) as serve_0, coalesce(c.serve_1, 0) as serve_1, coalesce(c.serve_2, 0) as serve_2, coalesce(c.serve_3, 0) as serve_3, coalesce(c.pass_0, 0) as pass_0, coalesce(c.pass_1, 0) as pass_1, coalesce(c.pass_2, 0) as pass_2, coalesce(c.pass_3, 0) as pass_3, coalesce(c.set_0, 0) as set_0, coalesce(c.set_1, 0) as set_1, coalesce(c.set_2, 0) as set_2, coalesce(c.set_3, 0) as set_3, coalesce(c.attack_0, 0) as attack_0, coalesce(c.attack_1, 0) as attack_1, coalesce(c.attack_2, 0) as attack_2, coalesce(c.attack_3, 0) as attack_3, coalesce(c.block_0, 0) as block_0, coalesce(c.block_1, 0) as block_1, coalesce(c.block_3, 0) as block_3, coalesce(c.dig_0, 0) as dig_0, coalesce(c.dig_1, 0) as dig_1, coalesce(c.dig_2, 0) as dig_2, coalesce(c.dig_3, 0) as dig_3
from played p left join counts c on c.player_id = p.player_id and c.session_id = p.session_id;
