-- Plus ones: players who aren't core members of the club. Same players as everyone else (rated, on teams, in stats);
-- the Players page lists core members and plus ones apart, and can say who brought each plus one.
-- Run once in the SQL Editor (also in schema.sql for new projects). Safe to run again. Everyone starts as core.
alter table public.players add column if not exists plus_one boolean not null default false;
alter table public.players add column if not exists brought_by bigint references public.players on delete set null;
alter table public.players drop constraint if exists players_brought_by_self;
alter table public.players add constraint players_brought_by_self check (brought_by is null or brought_by <> id);
