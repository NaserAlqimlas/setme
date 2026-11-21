-- Late players: someone who wasn't there when a game started, and when they came in. Per game, a list of
-- { p: player id, side: 'a' | 'b', from: the first rally (seq) they played, or null while not there yet,
--   after: the player they came in after in the serving order }. Set on the tag screen; positions, serve
-- suggestions and the court layout follow it. Run once in the SQL Editor (also in schema.sql). Safe to run again.
alter table public.games add column if not exists joins jsonb not null default '[]';
