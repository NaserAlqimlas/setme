-- Run once in Supabase: SQL Editor > New query > paste > Run.
-- Roles: rater (rates players), organizer (also manages players and the Playing list, builds teams),
-- super (everything, and the only role that can see ratings or manage users).

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  email text,
  display_name text,
  role text not null default 'rater' check (role in ('rater', 'organizer', 'super')),
  created_at timestamptz not null default now()
);

create table public.players (
  id bigint generated always as identity primary key,
  name text not null unique,
  gender text not null default 'U' check (gender in ('M', 'F', 'U')),
  setting text not null default 'N' check (setting in ('M', 'B', 'N')),
  -- Stand-in level until someone rates them; null counts as beginner.
  tier text check (tier in ('beginner', 'average', 'strong')),
  playing boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- null = unknown (U)
create table public.ratings (
  rater_id uuid not null references public.profiles on delete cascade,
  player_id bigint not null references public.players on delete cascade,
  receiving numeric(3,2) check (receiving in (0, .25, .5, .75, 1)),
  hitting   numeric(3,2) check (hitting   in (0, .25, .5, .75, 1)),
  hustle    numeric(3,2) check (hustle    in (0, .25, .5, .75, 1)),
  serve     numeric(3,2) check (serve     in (0, .25, .5, .75, 1)),
  blocking  numeric(3,2) check (blocking  in (0, .25, .5, .75, 1)),
  -- How well they set. Rated for setters only; counts only while they set all game.
  setting_skill numeric(3,2) check (setting_skill in (0, .25, .5, .75, 1)),
  -- How steady they are day to day. Not part of strength; the team builder spreads low ones out.
  consistency numeric(3,2) check (consistency in (0, .25, .5, .75, 1)),
  updated_at timestamptz not null default now(),
  primary key (rater_id, player_id)
);

-- Combos (play together / keep apart) aren't stored: they're set on the Teams page for each build.

-- Every new auth user gets a profile; the name comes from the invite.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger ratings_touch before update on public.ratings
  for each row execute function public.touch_updated_at();

-- Every rating change, one row per skill. Filled by a trigger, so taps, CSV imports and SQL edits all land here.
-- Taps by the same person on the same skill within 10 minutes merge into one row (tapping back to the start removes it).
-- No foreign keys: history outlives a removed player or rater.
create table public.rating_history (
  id bigint generated always as identity primary key,
  rater_id uuid not null,
  player_id bigint not null,
  skill text not null,
  old_value numeric(3,2),   -- null = U, or no rating yet
  new_value numeric(3,2),   -- null = U, or rating deleted
  changed_by uuid,          -- who made the change (super importing for someone else, null from the SQL editor)
  changed_at timestamptz not null default now()
);
create index rating_history_recent on public.rating_history (changed_at desc);

create function public.log_rating_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  oldj jsonb := case when tg_op = 'INSERT' then '{}' else to_jsonb(old) end;
  newj jsonb := case when tg_op = 'DELETE' then '{}' else to_jsonb(new) end;
  rid uuid := coalesce(newj->>'rater_id', oldj->>'rater_id')::uuid;
  pid bigint := coalesce(newj->>'player_id', oldj->>'player_id')::bigint;
  s text; o numeric; n numeric; prev public.rating_history;
begin
  foreach s in array array['receiving', 'hitting', 'hustle', 'serve', 'blocking', 'setting_skill', 'consistency'] loop
    o := (oldj->>s)::numeric; n := (newj->>s)::numeric;
    continue when o is not distinct from n;
    select * into prev from public.rating_history
      where rater_id = rid and player_id = pid and skill = s
        and changed_by is not distinct from auth.uid() and changed_at > now() - interval '10 minutes'
      order by changed_at desc limit 1;
    if not found then
      insert into public.rating_history (rater_id, player_id, skill, old_value, new_value, changed_by)
      values (rid, pid, s, o, n, auth.uid());
    elsif prev.old_value is not distinct from n then
      delete from public.rating_history where id = prev.id;
    else
      update public.rating_history set new_value = n, changed_at = now() where id = prev.id;
    end if;
  end loop;
  return null;
end $$;
create trigger ratings_history after insert or update or delete on public.ratings
  for each row execute function public.log_rating_change();

-- Role of the signed-in user (security definer so policies can read it without recursion).
create function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

alter table public.profiles enable row level security;
alter table public.players  enable row level security;
alter table public.ratings  enable row level security;
alter table public.rating_history enable row level security;

-- profiles: see yourself; super sees and edits everyone but can't create another super.
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.my_role() = 'super');
create policy profiles_super_update on public.profiles for update to authenticated
  using (public.my_role() = 'super')
  with check (role in ('rater', 'organizer') or id = auth.uid());

-- players: everyone signed in can read; organizers edit (playing, gender, setting); only super adds or deletes.
create policy players_read on public.players for select to authenticated using (true);
create policy players_update on public.players for update to authenticated
  using (public.my_role() in ('organizer', 'super'))
  with check (public.my_role() in ('organizer', 'super'));
create policy players_insert on public.players for insert to authenticated with check (public.my_role() = 'super');
create policy players_delete on public.players for delete to authenticated using (public.my_role() = 'super');

-- ratings: you read and write only your own; super reads all.
create policy ratings_read on public.ratings for select to authenticated
  using (rater_id = auth.uid() or public.my_role() = 'super');
create policy ratings_insert on public.ratings for insert to authenticated with check (rater_id = auth.uid());
create policy ratings_update on public.ratings for update to authenticated
  using (rater_id = auth.uid()) with check (rater_id = auth.uid());
create policy ratings_delete on public.ratings for delete to authenticated using (rater_id = auth.uid());
-- super can also import ratings on behalf of another rater (CSV import).
create policy ratings_super_write on public.ratings for all to authenticated
  using (public.my_role() = 'super') with check (public.my_role() = 'super');

-- rating_history: super reads everything, everyone else their own; only the trigger writes it.
create policy rating_history_read on public.rating_history for select to authenticated
  using (public.my_role() = 'super' or rater_id = auth.uid());

-- Scores: saved lineups per game day and each game's result (same as scores.sql).
create table public.sessions (
  id bigint generated always as identity primary key,
  played_on date not null unique,
  teams jsonb not null,     -- each team's players right now; late changes edit it
  raters uuid[],            -- what the lineup was built with (null = everyone's ratings), reused to predict each game
  all_game bigint[] not null default '{}',
  source text,              -- 'built', 'edited' or 'own'
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.games (
  id bigint generated always as identity primary key,
  session_id bigint not null references public.sessions on delete cascade,
  team_a smallint not null,
  team_b smallint not null,
  players_a bigint[] not null,  -- who was on each team for this game
  players_b bigint[] not null,
  score_a smallint not null check (score_a between 0 and 99),
  score_b smallint not null check (score_b between 0 and 99),
  predicted jsonb,              -- team numbers from the ratings when the game was saved
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index games_session on public.games (session_id, created_at);
create trigger sessions_touch before update on public.sessions
  for each row execute function public.touch_updated_at();
alter table public.sessions enable row level security;
alter table public.games enable row level security;
create policy sessions_organizers on public.sessions for all to authenticated
  using (public.my_role() in ('organizer', 'super')) with check (public.my_role() in ('organizer', 'super'));
create policy games_organizers on public.games for all to authenticated
  using (public.my_role() in ('organizer', 'super')) with check (public.my_role() in ('organizer', 'super'));

-- Match stats: tags entered while watching a game's video (same as match_stats.sql). The video is never uploaded.
create table public.game_stats (
  game_id bigint primary key references public.games on delete cascade,
  video jsonb,                              -- { kind: 'file', name } or { kind: 'youtube', id }
  rallies jsonb not null default '[]',      -- [{ t, serve: 'a'|'b', won: 'a'|'b'|null, touches: [{ p, a, g, t }] }]
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);
create trigger game_stats_touch before update on public.game_stats
  for each row execute function public.touch_updated_at();
alter table public.game_stats enable row level security;
create policy game_stats_organizers on public.game_stats for all to authenticated
  using (public.my_role() in ('organizer', 'super')) with check (public.my_role() in ('organizer', 'super'));
