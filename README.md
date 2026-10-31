# Volleyball Teams

Invite-only site where people rate players, and organizers build balanced teams.

| Role | Can do |
|---|---|
| **rater** | Rate players (sees only their own ratings) |
| **organizer** | Rate, plus manage players, combos and the Playing list, and build teams (sees lineups, never ratings) |
| **super** | Everything, plus see all ratings, invite and remove people, set roles |

Ratings never reach an organizer's browser: teams are built on the server (`netlify/functions/build-teams.mjs`), and organizers get back names and setter marks only.

## Layout

```
site/                  the website (static, no build step)
  config.js            your Supabase URL and public key   <- edit this
  js/app.js            pages
  js/teams.mjs         rating combining + team builder (also used by the server)
  vendor/supabase.js   supabase-js 2.45.4, self-hosted
netlify/functions/     build-teams (organizers), admin (super: invite/reset/remove)
supabase/schema.sql    tables + security rules
tools/make_seed.py     imports vb_skill.md
tests/test_teams.mjs   checks the team builder against your real data
private/               generated seed files (git-ignored: contains ratings)
```

## Setup

### 1. Supabase
1. Create a project.
2. **SQL Editor**: paste `supabase/schema.sql` and run it.
3. **Authentication > Sign In / Providers**: turn **off** "Allow new users to sign up". Invites still work.
4. **Authentication > Users > Add user > Create new user**: your email and a password, tick **Auto Confirm**.
5. **SQL Editor**: make yourself super:
   ```sql
   update profiles set role = 'super' where email = 'YOUR EMAIL';
   ```
6. **SQL Editor**: paste and run `private/seed.sql` (players, gender, setting roles, playing list, combos).
7. **SQL Editor**: run `private/seed_ratings.sql` to import the ratings from `vb_skill.md`. Your ratings import now. Reem's import only after she has an account and you've replaced `REEM_EMAIL` with her email, so it's fine to run it again later.
8. **Project Settings > API**: copy the **Project URL**, the **anon / publishable** key and the **service_role / secret** key.

### 2. Site config
Put the Project URL and anon/publishable key in `site/config.js`. Both are public by design.

### 3. GitHub + Netlify
1. Push this folder to a **private** GitHub repo. `private/` is git-ignored.
2. Netlify: **Add new site > Import from GitHub**, then pick the repo. Leave the build command empty; `netlify.toml` sets everything else.
3. **Site configuration > Environment variables**:
   - `SUPABASE_URL`: the Project URL
   - `SUPABASE_SERVICE_ROLE_KEY`: the service_role / secret key (**never** put this in `site/`)
4. Deploy. Copy the site URL (e.g. `https://vb-teams.netlify.app`).
5. Back in Supabase, **Authentication > URL Configuration**: set **Site URL** to that address and add it under **Redirect URLs**.

### 4. Inviting people
Sign in, go to **Users**, enter a name and email, and press **Create invite link**. Send the link yourself (e.g. on WhatsApp). No email is sent, which avoids Supabase's free email limits. They open it, choose a password, and from then on sign in with email + password. A forgotten password works the same way: press **Reset link** on their row.

## How teams are built

- **Combining raters:** each rater is first adjusted for how generously they rate compared to the others on the same players (per skill, once they've rated 5+ shared players). Then all ratings are averaged. U is skipped; a skill nobody has rated counts as the group average.
- **Weights:** receiving 1.5, hitting 1.25, serve 1, hustle .75, blocking .5.
- **Rules:** one main setter (M) per team, at most one backup (B), women spread evenly, weak passers (receiving ≤ .25) spread, combos kept together, weighted totals within .25.
- **Search:** up to 3,000 random starts improved by swaps (about half a second), and up to 3 distinct options returned.

The super's **All ratings** page shows each rater's ratings, the combined values, each rater's adjustment, and players the raters disagree on by a point or more.

## Updating from vb_skill.md

```
python3 tools/make_seed.py ../vb_skill.md --rater "Nasser=YOUR EMAIL" --rater "Reem=REEM EMAIL"
node tests/test_teams.mjs
```
