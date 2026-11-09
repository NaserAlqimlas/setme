-- Match stats: tags entered while watching a game's video. Run once in the SQL Editor (also in schema.sql for new projects).
-- The video itself is never uploaded: it plays from the tagger's device or YouTube; games only remember which one.
-- Organizers and super read and write tags (they watch the same video). Per-player totals are only shown to the super.

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
