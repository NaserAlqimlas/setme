-- Front middle: a player who stayed front middle all game while the other five rotated round them (often the setter;
-- they may still take their turn to serve and run back). Per game and per team, since who sets can change during a
-- game day. Chosen on the tag screen or on Games (Positions); until someone chooses (middle_set), it's read from the
-- tags. Run once in the SQL Editor (also in schema.sql for new projects). Safe to run again.
alter table public.games add column if not exists middle_a bigint references public.players on delete set null;  -- null: nobody
alter table public.games add column if not exists middle_b bigint references public.players on delete set null;
alter table public.games add column if not exists middle_set boolean not null default false;  -- someone chose; before that, read from the tags
