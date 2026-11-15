-- Tags put on the wrong game: move a game's tags (rallies, touches, video and end mark) to another game on the same
-- game day. If that game has tags too, the two swap. p_flip_*: the teams are listed the other way round in the
-- other game, so 'a' and 'b' swap on those rallies (the browser works it out from who touched the ball).
-- Runs as the caller, so the tagging window still applies. All or nothing.
-- Run once in the SQL Editor after match_stats.sql and tag_window.sql (also in schema.sql for new projects). Safe to run again.
alter table public.games add column if not exists tags_end double precision;  -- from tags_end.sql

create or replace function public.move_game_tags(p_from bigint, p_to bigint, p_flip_from boolean default false, p_flip_to boolean default false)
returns void language plpgsql security invoker set search_path = public as $$
declare a games; b games;
begin
  select * into a from games where id = p_from;
  select * into b from games where id = p_to;
  if a.id is null or b.id is null then raise exception 'Game not found'; end if;
  if a.id = b.id then raise exception 'Pick a different game'; end if;
  if a.session_id <> b.session_id then raise exception 'Both games must be on the same game day'; end if;
  -- The SET expressions see each row as it was, so this moves both ways at once.
  update rallies set
    game_id = case when game_id = p_from then p_to else p_from end,
    serving = case when (game_id = p_from and p_flip_from) or (game_id = p_to and p_flip_to)
      then case serving when 'a' then 'b' else 'a' end else serving end,
    won_by = case when won_by is not null and ((game_id = p_from and p_flip_from) or (game_id = p_to and p_flip_to))
      then case won_by when 'a' then 'b' else 'a' end else won_by end,
    updated_at = now()
  where game_id in (p_from, p_to);
  -- The video and the end mark go with the tags (rally times point into that video).
  update games g set video_kind = o.video_kind, video_ref = o.video_ref, tags_end = o.tags_end
  from games o where (g.id = p_from and o.id = p_to) or (g.id = p_to and o.id = p_from);
end $$;
