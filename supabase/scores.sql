-- Scores: saved lineups per game day and each game's result. Run once in the SQL Editor (also in schema.sql for new projects).
-- Organizers and super read and write both. Nothing here holds a player's ratings: predicted numbers are team totals.

-- One per game day. teams = each team's players right now ([[player id, ...], ...]); late changes edit it.
-- raters / all_game: what the lineup was built with, reused to predict each game.
create table if not exists public.sessions (
  id bigint generated always as identity primary key,
  played_on date not null unique,
  teams jsonb not null,
  raters uuid[],            -- null = everyone's ratings
  all_game bigint[] not null default '{}',
  source text,              -- 'built', 'edited' or 'own'
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One per game. players_a / players_b: who was on each team for this game (so late changes are kept per game).
-- predicted: { a: {...}, b: {...} } team numbers from the ratings when the game was saved (weighted, sums, size, women, setters, unrated).
create table if not exists public.games (
  id bigint generated always as identity primary key,
  session_id bigint not null references public.sessions on delete cascade,
  team_a smallint not null,
  team_b smallint not null,
  players_a bigint[] not null,
  players_b bigint[] not null,
  score_a smallint not null check (score_a between 0 and 99),
  score_b smallint not null check (score_b between 0 and 99),
  predicted jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists games_session on public.games (session_id, created_at);

drop trigger if exists sessions_touch on public.sessions;
create trigger sessions_touch before update on public.sessions
  for each row execute function public.touch_updated_at();

alter table public.sessions enable row level security;
alter table public.games enable row level security;

drop policy if exists sessions_organizers on public.sessions;
create policy sessions_organizers on public.sessions for all to authenticated
  using (public.my_role() in ('organizer', 'super')) with check (public.my_role() in ('organizer', 'super'));
drop policy if exists games_organizers on public.games;
create policy games_organizers on public.games for all to authenticated
  using (public.my_role() in ('organizer', 'super')) with check (public.my_role() in ('organizer', 'super'));
