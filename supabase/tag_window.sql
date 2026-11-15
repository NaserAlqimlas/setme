-- Who can tag: only the super adds, changes or deletes a game's tags (organizers could, up to 3 days after the game
-- day, until video.sql changed it). Organizers and the super read them. Run once in the SQL Editor after
-- match_stats.sql (also in schema.sql for new projects). Safe to run again.

create or replace function public.tag_open(p_game bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select public.my_role() = 'super';
$$;

drop policy if exists rallies_organizers on public.rallies;
drop policy if exists rallies_read on public.rallies;
drop policy if exists rallies_write on public.rallies;
create policy rallies_read on public.rallies for select to authenticated
  using (public.my_role() in ('organizer', 'super'));
create policy rallies_write on public.rallies for all to authenticated
  using (public.tag_open(game_id)) with check (public.tag_open(game_id));

drop policy if exists touches_organizers on public.touches;
drop policy if exists touches_read on public.touches;
drop policy if exists touches_write on public.touches;
create policy touches_read on public.touches for select to authenticated
  using (public.my_role() in ('organizer', 'super'));
create policy touches_write on public.touches for all to authenticated
  using (exists (select 1 from public.rallies r where r.id = rally_id and public.tag_open(r.game_id)))
  with check (exists (select 1 from public.rallies r where r.id = rally_id and public.tag_open(r.game_id)));
