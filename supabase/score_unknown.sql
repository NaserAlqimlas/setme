-- Incomplete games: only part of a game was filmed and nobody knows the final score. Such a game is saved with both
-- scores empty (null) so it can still be tagged; results, records, standings and rating adjustments leave it out,
-- and it shows as Incomplete. Either both scores are set or neither is.
-- Run once in the SQL Editor (also in schema.sql for new projects). Safe to run again.
alter table public.games alter column score_a drop not null;
alter table public.games alter column score_b drop not null;
alter table public.games drop constraint if exists games_score_both;
alter table public.games add constraint games_score_both check ((score_a is null) = (score_b is null));
