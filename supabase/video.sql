-- Game videos: the super uploads a game's video, a worker makes a copy to watch and finds the rally times, and
-- organizers and the players in that game can watch it. Run once in the SQL Editor after match_stats.sql and
-- tag_window.sql (also in schema.sql for new projects). Safe to run again.
--
-- The video files are in Cloudflare R2, not here (see netlify/lib/r2.mjs): the original until 7 days after it's
-- analysed, the 720p viewing copy for good. This table says where they are and how the analysis went.
-- Only the Netlify functions write it (with the secret key); organizers and the super read it for the status.
-- Players never read it: the video function checks they played in the game and hands them a link that expires.
--
-- Also: tagging is the super's alone from now on (it was organizers up to 3 days after the game day). Organizers
-- still see the tags.

create table if not exists public.video_jobs (
  id uuid primary key default gen_random_uuid(),
  game_id bigint references public.games on delete set null,   -- null once the game is deleted; clean-up removes the files
  uploaded_by uuid default auth.uid(),
  file_name text not null,
  size_bytes bigint not null,
  original_key text,                 -- R2 key of the upload; null once deleted
  upload_id text,                    -- R2 multipart upload, while uploading
  viewing_key text,                  -- R2 key of the 720p copy, once made
  status text not null default 'uploading'
    check (status in ('uploading', 'queued', 'processing', 'done', 'failed', 'cancelled')),
  progress real,                     -- 0 to 1 while processing
  result jsonb,                      -- { version, video, duration, rallies: [{ start, end, confidence }] }, as game.rallies.json
  error text,                        -- for people: what went wrong and what to try
  attempts smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  original_deleted_at timestamptz
);
create index if not exists video_jobs_game on public.video_jobs (game_id, created_at desc);
create index if not exists video_jobs_status on public.video_jobs (status, updated_at);

drop trigger if exists video_jobs_touch on public.video_jobs;
create trigger video_jobs_touch before update on public.video_jobs
  for each row execute function public.touch_updated_at();

alter table public.video_jobs enable row level security;
drop policy if exists video_jobs_read on public.video_jobs;
create policy video_jobs_read on public.video_jobs for select to authenticated
  using (public.my_role() in ('organizer', 'super'));

-- A game's video can now be an upload: video_ref is then the video_jobs id.
alter table public.games drop constraint if exists games_video_kind_check;
alter table public.games add constraint games_video_kind_check check (video_kind in ('file', 'youtube', 'upload'));

-- Tagging: the super only. Organizers keep reading tags (rallies_read / touches_read in tag_window.sql).
create or replace function public.tag_open(p_game bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select public.my_role() = 'super';
$$;
