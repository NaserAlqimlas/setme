-- Run once in Supabase: SQL Editor > New query > paste > Run.
-- Roles: rater (rates players), organizer (also manages players, combos, the Playing list, builds teams),
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
  updated_at timestamptz not null default now(),
  primary key (rater_id, player_id)
);

create table public.combos (
  id bigint generated always as identity primary key,
  player_a bigint not null references public.players on delete cascade,
  player_b bigint not null references public.players on delete cascade,
  check (player_a <> player_b),
  unique (player_a, player_b)
);

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

-- Role of the signed-in user (security definer so policies can read it without recursion).
create function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

alter table public.profiles enable row level security;
alter table public.players  enable row level security;
alter table public.ratings  enable row level security;
alter table public.combos   enable row level security;

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

-- combos: organizers and super only.
create policy combos_all on public.combos for all to authenticated
  using (public.my_role() in ('organizer', 'super'))
  with check (public.my_role() in ('organizer', 'super'));
