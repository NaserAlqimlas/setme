-- Upgrade: tell "don't know" (U) apart from "not answered yet". Run once in the SQL Editor (already in schema.sql for new projects).
-- Safe to run again.

-- Skills the rater marked U. A blank skill that isn't listed here hasn't been answered yet.
-- Both still count as unknown for totals and team building; this only changes what the Rate page shows and counts.
-- Blanks saved before this upgrade show as not answered, so raters may see a few skills to finish.
alter table public.ratings add column if not exists unknown text[] not null default '{}';
