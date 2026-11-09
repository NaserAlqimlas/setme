-- Game ended here: players sometimes play on after a game is over (they lost count). Tagged rallies after the
-- marked one still count for player stats, but not for the tagged score, so it can match the saved score.
-- Run once in the SQL Editor after match_stats.sql (also in match_stats.sql and schema.sql for new projects). Safe to run again.
alter table public.games add column if not exists tags_end double precision;  -- seq of the last rally that counts for the score
