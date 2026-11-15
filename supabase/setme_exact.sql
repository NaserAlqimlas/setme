-- SetMe's exact numbers: SetMe (ratings from match stats) saves numbers like .14 instead of .25 steps. People still
-- rate in .25 steps (the Rate page only offers those); the database now accepts any number from 0 to 1, to 2 decimals.
-- Run once in the SQL Editor (also in schema.sql for new projects). Safe to run again.
do $$
declare c record;
begin
  for c in select conname from pg_constraint
    where conrelid = 'public.ratings'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%0.25%'
  loop
    execute format('alter table public.ratings drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.ratings drop constraint if exists ratings_range;
alter table public.ratings add constraint ratings_range check (
  (receiving is null or receiving between 0 and 1) and (hitting is null or hitting between 0 and 1) and
  (hustle is null or hustle between 0 and 1) and (serve is null or serve between 0 and 1) and
  (blocking is null or blocking between 0 and 1) and (setting_skill is null or setting_skill between 0 and 1) and
  (consistency is null or consistency between 0 and 1));
