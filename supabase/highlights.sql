-- Highlights: the super marks stretches of a game's uploaded video, and SetMe plays them back to back as a reel for
-- the game or the whole game day. The reel can also be made into one video file to download (the video worker cuts
-- and joins the clips). Run once in the SQL Editor after video.sql (also in schema.sql for new projects). Safe to run again.
--
-- Organizers and the super read both tables; the super marks highlights. Players never read them directly: the
-- highlights function checks they played that game day and hands them the clips and links that expire.

create table if not exists public.highlights (
  id uuid primary key default gen_random_uuid(),
  game_id bigint not null references public.games on delete cascade,
  start_t real not null check (start_t >= 0),     -- seconds into the game's viewing copy
  end_t real not null,
  label text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  check (end_t > start_t)
);
create index if not exists highlights_game on public.highlights (game_id, start_t);

alter table public.highlights enable row level security;
drop policy if exists highlights_read on public.highlights;
create policy highlights_read on public.highlights for select to authenticated
  using (public.my_role() in ('organizer', 'super'));
drop policy if exists highlights_write on public.highlights;
create policy highlights_write on public.highlights for all to authenticated
  using (public.my_role() = 'super') with check (public.my_role() = 'super');

-- A reel made into a video file. One per game day (game_id null) or game; making it again replaces the file.
-- Written only by the Netlify functions (secret key).
create table if not exists public.highlight_reels (
  id uuid primary key default gen_random_uuid(),
  session_id bigint not null references public.sessions on delete cascade,
  game_id bigint references public.games on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'processing', 'done', 'failed')),
  progress real,
  clips jsonb not null,               -- [{ id, game, start, end }] as they were when it was made
  file_key text,                      -- R2 key of the finished file
  error text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists highlight_reels_day on public.highlight_reels (session_id, game_id, created_at desc);
drop trigger if exists highlight_reels_touch on public.highlight_reels;
create trigger highlight_reels_touch before update on public.highlight_reels
  for each row execute function public.touch_updated_at();
alter table public.highlight_reels enable row level security;
drop policy if exists highlight_reels_read on public.highlight_reels;
create policy highlight_reels_read on public.highlight_reels for select to authenticated
  using (public.my_role() in ('organizer', 'super'));
