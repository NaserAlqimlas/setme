-- Private notes on players: organizers and the super each keep their own notes on any player, on the Rate page.
-- A note is only ever seen by the person who wrote it: not other organizers, not the super, not the player.
-- Run once in the SQL Editor (also in schema.sql for new projects). Safe to run again. Before it runs, the Rate page
-- simply has no notes.
create table if not exists public.rating_notes (
  author_id uuid not null default auth.uid() references auth.users on delete cascade,
  player_id bigint not null references public.players on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  updated_at timestamptz not null default now(),
  primary key (author_id, player_id)
);
alter table public.rating_notes enable row level security;
-- Your own notes only, and only while you're an organizer or the super.
drop policy if exists rating_notes_own on public.rating_notes;
create policy rating_notes_own on public.rating_notes for all to authenticated
  using (author_id = auth.uid() and public.my_role() in ('organizer', 'super'))
  with check (author_id = auth.uid() and public.my_role() in ('organizer', 'super'));
drop trigger if exists rating_notes_touch on public.rating_notes;
create trigger rating_notes_touch before update on public.rating_notes
  for each row execute function public.touch_updated_at();
