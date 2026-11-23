-- Starting rotation: who stood where when a game began, set by hand on the tag screen, so the court layout, serve
-- suggestions and positions work from the first rally instead of after a few servers. Per game:
-- { "a": [player in position 1, in 2, … in 6], "b": [...] }; a team left out isn't set. Run once in the SQL Editor
-- (also in schema.sql for new projects). Safe to run again.
alter table public.games add column if not exists rotation jsonb;
