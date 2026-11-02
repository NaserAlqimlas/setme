-- Upgrade for a database set up before rating history. Safe to run again (e.g. to pick up the newer read policy) in the SQL Editor (already in schema.sql for new projects).

-- Every rating change, one row per skill. Filled by a trigger, so taps, CSV imports and SQL edits all land here.
-- Taps by the same person on the same skill within 10 minutes merge into one row (tapping back to the start removes it).
-- No foreign keys: history outlives a removed player or rater.
create table if not exists public.rating_history (
  id bigint generated always as identity primary key,
  rater_id uuid not null,
  player_id bigint not null,
  skill text not null,
  old_value numeric(3,2),   -- null = U, or no rating yet
  new_value numeric(3,2),   -- null = U, or rating deleted
  changed_by uuid,          -- who made the change (super importing for someone else, null from the SQL editor)
  changed_at timestamptz not null default now()
);
create index if not exists rating_history_recent on public.rating_history (changed_at desc);

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
drop trigger if exists ratings_history on public.ratings;
create trigger ratings_history after insert or update or delete on public.ratings
  for each row execute function public.log_rating_change();

alter table public.rating_history enable row level security;
-- Super reads everything, everyone else their own; only the trigger writes it.
drop policy if exists rating_history_read on public.rating_history;
create policy rating_history_read on public.rating_history for select to authenticated
  using (public.my_role() = 'super' or rater_id = auth.uid());
