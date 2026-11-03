-- Match stats: tags entered while watching a game's video. Run once in the SQL Editor (also in schema.sql for new projects).
-- One row per tagged game. The video itself is never uploaded: it plays from the tagger's device or YouTube.
-- Organizers and super read and write tags (they watch the same video). Per-player totals are only shown to the super.

create table if not exists public.game_stats (
  game_id bigint primary key references public.games on delete cascade,
  video jsonb,                              -- { kind: 'file', name } or { kind: 'youtube', id }
  rallies jsonb not null default '[]',      -- [{ t, serve: 'a'|'b', won: 'a'|'b'|null, touches: [{ p, a, g, t }] }]
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);

drop trigger if exists game_stats_touch on public.game_stats;
create trigger game_stats_touch before update on public.game_stats
  for each row execute function public.touch_updated_at();

alter table public.game_stats enable row level security;
drop policy if exists game_stats_organizers on public.game_stats;
create policy game_stats_organizers on public.game_stats for all to authenticated
  using (public.my_role() in ('organizer', 'super')) with check (public.my_role() in ('organizer', 'super'));
