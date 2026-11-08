-- Tagging window: organizers can add, change or delete a game's tags only up to 3 days after its game day; the super
-- any time. Everyone who could read tags still can. Run once in the SQL Editor after match_stats.sql (also in
-- schema.sql for new projects). Safe to run again. Keep the 3 in step with TAG_DAYS in site/js/pages/scores.mjs.

create or replace function public.tag_open(p_game bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select public.my_role() = 'super'
      or (public.my_role() = 'organizer' and exists (
            select 1 from public.games g join public.sessions s on s.id = g.session_id
            where g.id = p_game and s.played_on >= current_date - 3));
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
