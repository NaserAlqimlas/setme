-- Remembered names: when an organizer matches a pasted name SetMe didn't recognize ("Abood") to a player
-- (Abdullah) on the Players page, it's kept here so the next paste matches it for everyone.
-- Run once in the SQL Editor (safe to run again; also at the end of schema.sql for new projects).
-- Before this runs, Match to… still works for the paste on screen; it just isn't remembered.

create table if not exists public.player_aliases (
  alias text primary key,   -- the pasted name in compact form: lowercase letters, digits and '+', nothing else
  player_id bigint not null references public.players on delete cascade,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

alter table public.player_aliases enable row level security;
drop policy if exists player_aliases_organizers on public.player_aliases;
create policy player_aliases_organizers on public.player_aliases for all to authenticated
  using (public.my_role() in ('organizer', 'super')) with check (public.my_role() in ('organizer', 'super'));
