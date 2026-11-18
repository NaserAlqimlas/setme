-- Highlight suggestions and bloopers. The video worker scores how loud it gets after each rally (players reacting);
-- SetMe suggests loud kills, aces and stuff blocks as highlights and loud errors as bloopers. Kept bloopers get
-- their own reel. Run once in the SQL Editor after highlights.sql (also in schema.sql for new projects). Safe to run again.

-- A highlight or a blooper. Reels are one kind each.
alter table public.highlights add column if not exists kind text not null default 'highlight';
alter table public.highlights drop constraint if exists highlights_kind_check;
alter table public.highlights add constraint highlights_kind_check check (kind in ('highlight', 'blooper'));
alter table public.highlight_reels add column if not exists kind text not null default 'highlight';
alter table public.highlight_reels drop constraint if exists highlight_reels_kind_check;
alter table public.highlight_reels add constraint highlight_reels_kind_check check (kind in ('highlight', 'blooper'));

-- Suggestions the super dismissed (✕), so they don't come back. Matched by the rally's end time in the video.
-- With the kept ones (highlights), they also show how good the suggestions are.
create table if not exists public.highlight_dismissed (
  id uuid primary key default gen_random_uuid(),
  game_id bigint not null references public.games on delete cascade,
  t real not null,                   -- the rally's end, seconds into the video
  kind text not null check (kind in ('highlight', 'blooper')),
  lift real,                         -- how loud it was (dB over the sound around it)
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists highlight_dismissed_game on public.highlight_dismissed (game_id);
alter table public.highlight_dismissed enable row level security;
drop policy if exists highlight_dismissed_super on public.highlight_dismissed;
create policy highlight_dismissed_super on public.highlight_dismissed for all to authenticated
  using (public.my_role() = 'super') with check (public.my_role() = 'super');

-- Which suggestion a kept highlight came from (null when marked by hand), and how loud it was.
alter table public.highlights add column if not exists suggested boolean not null default false;
alter table public.highlights add column if not exists lift real;
