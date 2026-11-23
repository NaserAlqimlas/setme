-- A game's starting rotation and its late players and substitutions, as tables instead of JSON on games
-- (replaces games.rotation from rotation.sql and games.joins from late_players.sql: their data is copied here and
-- the columns dropped). Each row points at a real player, so the database keeps them consistent.
-- Run once in the SQL Editor after match_stats.sql and tag_window.sql (also in schema.sql for new projects).
-- Safe to run again.

-- Who stood in each spot as the game began, per team. One player per spot, each player once.
create table if not exists public.game_rotation (
  game_id bigint not null references public.games on delete cascade,
  side text not null check (side in ('a', 'b')),
  position smallint not null check (position between 1 and 6),
  player_id bigint not null references public.players on delete cascade,
  primary key (game_id, side, position),
  unique (game_id, side, player_id)
);

-- Someone who wasn't on court when the game began. from_seq: the first rally they played (null: not here yet);
-- after_player: who they came in after in the serving order; replaces: for a substitution, who went off (they take
-- that player's spot from from_seq on).
create table if not exists public.game_joins (
  game_id bigint not null references public.games on delete cascade,
  side text not null check (side in ('a', 'b')),
  player_id bigint not null references public.players on delete cascade,
  from_seq double precision,
  after_player bigint references public.players on delete set null,
  replaces bigint references public.players on delete set null,
  primary key (game_id, player_id),
  check (replaces is null or replaces <> player_id)
);

-- Read like the tags (organizers and the super; the Games page reads them through the server); written by whoever
-- may tag the game (tag_open: the super).
alter table public.game_rotation enable row level security;
alter table public.game_joins enable row level security;
drop policy if exists game_rotation_read on public.game_rotation;
drop policy if exists game_rotation_write on public.game_rotation;
create policy game_rotation_read on public.game_rotation for select to authenticated using (public.my_role() in ('organizer', 'super'));
create policy game_rotation_write on public.game_rotation for all to authenticated using (public.tag_open(game_id)) with check (public.tag_open(game_id));
drop policy if exists game_joins_read on public.game_joins;
drop policy if exists game_joins_write on public.game_joins;
create policy game_joins_read on public.game_joins for select to authenticated using (public.my_role() in ('organizer', 'super'));
create policy game_joins_write on public.game_joins for all to authenticated using (public.tag_open(game_id)) with check (public.tag_open(game_id));

-- Replace a team's starting rotation in one go (p_players: in position 1, 2, … 6), or clear it (null).
create or replace function public.set_game_rotation(p_game bigint, p_side text, p_players bigint[])
returns void language plpgsql security invoker set search_path = public as $$
begin
  if p_players is not null and (cardinality(p_players) <> 6 or (select count(distinct x) from unnest(p_players) x) <> 6) then
    raise exception 'A rotation is six different players';
  end if;
  delete from game_rotation where game_id = p_game and side = p_side;
  if p_players is not null then
    insert into game_rotation (game_id, side, position, player_id)
      select p_game, p_side, t.ord, t.pid from unnest(p_players) with ordinality as t(pid, ord);
  end if;
end $$;

-- Replace a game's late players and substitutions in one go: [{ p, side, from, after, for }] (the tag screen's list).
create or replace function public.set_game_joins(p_game bigint, p_joins jsonb)
returns void language plpgsql security invoker set search_path = public as $$
begin
  delete from game_joins where game_id = p_game;
  insert into game_joins (game_id, side, player_id, from_seq, after_player, replaces)
    select p_game, x.side, x.p, x."from", x.after, x."for"
    from jsonb_to_recordset(coalesce(p_joins, '[]')) as x(p bigint, side text, "from" double precision, after bigint, "for" bigint);
end $$;

-- Copy what was kept as JSON, then drop the JSON columns. Ids of players since deleted are left out.
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'games' and column_name = 'rotation') then
    insert into public.game_rotation (game_id, side, position, player_id)
      select g.id, s.side, t.ord, t.pid::bigint
      from public.games g cross join (values ('a'), ('b')) as s(side)
      cross join lateral jsonb_array_elements_text(case when jsonb_typeof(g.rotation -> s.side) = 'array' then g.rotation -> s.side else '[]' end) with ordinality as t(pid, ord)
      where t.ord <= 6 and exists (select 1 from public.players p where p.id = t.pid::bigint)
      on conflict do nothing;
    alter table public.games drop column rotation;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'games' and column_name = 'joins') then
    insert into public.game_joins (game_id, side, player_id, from_seq, after_player, replaces)
      select g.id, j ->> 'side', (j ->> 'p')::bigint, (j ->> 'from')::double precision,
        (select p.id from public.players p where p.id = (j ->> 'after')::bigint),
        (select p.id from public.players p where p.id = (j ->> 'for')::bigint)
      from public.games g cross join lateral jsonb_array_elements(case when jsonb_typeof(g.joins) = 'array' then g.joins else '[]' end) as j
      where j ->> 'side' in ('a', 'b') and exists (select 1 from public.players p where p.id = (j ->> 'p')::bigint)
      on conflict do nothing;
    alter table public.games drop column joins;
  end if;
end $$;

notify pgrst, 'reload schema';
