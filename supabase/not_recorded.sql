-- Not recorded: a game nobody filmed, so it can't be tagged. The super marks it on Games, and it leaves the To tag
-- list. Run once in the SQL Editor (also in schema.sql for new projects). Safe to run again.
alter table public.games add column if not exists not_recorded boolean not null default false;
