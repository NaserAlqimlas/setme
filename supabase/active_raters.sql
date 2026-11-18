-- Only ratings by people who rate now show up: raters, organizers and the super. Move a rater to player and their
-- rating rows stay (move them back and everything returns), but nobody sees them and they don't count anywhere.
-- The site's functions leave them out too (activeRaters in netlify/lib/supabase.mjs).
-- Run once in the SQL Editor (also in schema.sql for new projects). Safe to run again.
create or replace function public.rates_now(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = uid and role in ('rater', 'organizer', 'super'))
$$;
grant execute on function public.rates_now(uuid) to authenticated;

drop policy if exists ratings_read on public.ratings;
create policy ratings_read on public.ratings for select to authenticated
  using (public.rates_now(rater_id) and (rater_id = auth.uid() or public.my_role() in ('organizer', 'super')));

-- The super's write rule covered reading too ("for all"), which would show everything; now it's writing only.
drop policy if exists ratings_super_write on public.ratings;
drop policy if exists ratings_super_insert on public.ratings;
drop policy if exists ratings_super_update on public.ratings;
drop policy if exists ratings_super_delete on public.ratings;
create policy ratings_super_insert on public.ratings for insert to authenticated with check (public.my_role() = 'super');
create policy ratings_super_update on public.ratings for update to authenticated
  using (public.my_role() = 'super') with check (public.my_role() = 'super');
create policy ratings_super_delete on public.ratings for delete to authenticated using (public.my_role() = 'super');

drop policy if exists rating_history_read on public.rating_history;
create policy rating_history_read on public.rating_history for select to authenticated
  using (public.rates_now(rater_id) and (rater_id = auth.uid() or public.my_role() in ('organizer', 'super')));
