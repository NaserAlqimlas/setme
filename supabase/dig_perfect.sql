-- Dig → Perfect: digs get a 3 grade (right to the setter), like pass and set. Adds dig_3 to player_stats.
-- Run once in the SQL Editor after match_stats.sql (also in match_stats.sql and schema.sql for new projects). Safe to run again.
-- Until then, Perfect digs save and show in each game's tags, but the totals on All ratings and Me leave them out.
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
