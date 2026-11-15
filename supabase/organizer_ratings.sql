-- Organizers see All ratings: everyone's ratings and rating history, and raters' names (not their emails or roles).
-- Run once in the SQL Editor (also in schema.sql for new projects). Safe to run again.
-- Writing stays as it was: everyone changes only their own ratings; only the super writes for others (imports, SetMe).

drop policy if exists ratings_read on public.ratings;
create policy ratings_read on public.ratings for select to authenticated
  using (rater_id = auth.uid() or public.my_role() in ('organizer', 'super'));

drop policy if exists rating_history_read on public.rating_history;
create policy rating_history_read on public.rating_history for select to authenticated
  using (rater_id = auth.uid() or public.my_role() in ('organizer', 'super'));

-- Names for the rater picker and charts. Profiles stay private (they hold emails), so this hands out only names.
create or replace function public.rater_names()
returns table (id uuid, display_name text, setme boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.display_name, p.email = 'setme@setme.invalid'
  from public.profiles p
  where public.my_role() in ('organizer', 'super');
$$;
grant execute on function public.rater_names() to authenticated;
