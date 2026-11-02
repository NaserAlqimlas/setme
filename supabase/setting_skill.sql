-- Upgrade: the Setting rating. Run once in the SQL Editor (already in schema.sql for new projects).

-- How well they set. Rated for setters only; counts only while they set all game.
alter table public.ratings add column if not exists setting_skill numeric(3,2)
  check (setting_skill in (0, .25, .5, .75, 1));

-- Rating history: log Setting changes too (same function as rating_history.sql, with setting_skill added).
create or replace function public.log_rating_change() returns trigger
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
