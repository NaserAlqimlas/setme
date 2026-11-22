-- Club emails: when a game's video is ready to watch and when a game is fully tagged, everyone who can watch it
-- (organizers, the super, and players and raters once the game day is published) gets an email, unless they turned that email
-- off in Settings. Run once in the SQL Editor (also in schema.sql for new projects). Safe to run again.

-- Each person's choices. No row: every email on.
create table if not exists public.email_prefs (
  user_id uuid primary key references public.profiles on delete cascade,
  videos boolean not null default true,   -- a game's video is ready to watch
  tags boolean not null default true,     -- a game is fully tagged: its stats are up
  updated_at timestamptz not null default now()
);
alter table public.email_prefs enable row level security;
drop policy if exists email_prefs_own on public.email_prefs;
create policy email_prefs_own on public.email_prefs for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- When the "fully tagged" email went out for a game, so it goes once.
alter table public.games add column if not exists tagged_emailed_at timestamptz;
