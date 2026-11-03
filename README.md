# SetMe

Invite-only site for a pickup volleyball group: people rate players, and organizers build balanced teams.
Live at **https://setme.club** (also https://setme.netlify.app).

How it fits together: [ARCHITECTURE.md](ARCHITECTURE.md).

## Who can do what

| Role | Can do |
|---|---|
| **rater** | Rate players on **Rate**; see their own ratings on **My ratings** |
| **organizer** | Everything a rater can, plus **Players** (gender, setter role, who's playing, paste the WhatsApp list) and **Teams** (combos, build, share). Never sees anyone's ratings, not even in lineups |
| **super** | Everything, plus add and delete players, **All ratings** (every rater, combined values, rater leans, disagreements), choose whose ratings a build uses, and **Users** (invite, reset links, roles, remove) |

## What's in the app

- **Rate**: six buttons per skill (U, 0, .25, .5, .75, 1) for receiving, hitting, hustle, serve, blocking and consistency, plus **Setting** for players marked as setters. Every tap saves. A rating guide slides in from the side (up from the bottom on phones) and jumps to the skill you're rating. Filters for this session's players and for players you haven't rated. CSV template, import, and export of your own ratings (re-imports as is); super can import on behalf of another rater.
- **My ratings / All ratings**: sortable table (tap a column, or use Sort by on phones). Below it, **Rating history**: which rating changed, from what to what, and when. Raters and organizers see their own changes; super sees everyone's, with who made them. A chart shows how many ratings changed each day. Tap a player's name (or pick them in the Player box) to see just theirs, with a chart: their skills over time from one rater, or each rater's total over time.
- **Players**: paste the WhatsApp list to set who's playing (names after "Waitlist" are left out). Super adds a new player with a stand-in level (Beginner, Average, Strong) used until someone rates them.
- **Teams**: a **Setters** card to say who sets all game and who rotates tonight (main setters default to all game; also tappable on setter badges in Your own teams). A setter who sets all game adds their Setting rating to the team, while their hitting counts at 25% and receiving at 50%, and they don't count as weak passers. Combos for this build only (play together / keep apart, not saved), New players card for unrated players, number of teams, date, build. Each option can be copied as text or shared as a court-map image. **Your own teams**: paste teams you made (or upload a .txt/.csv) to see them laid out the same way, with Copy text and Share image; super also sees each team's skill sums and totals. Super also sees, for every set of teams, the gap between the strongest and weakest team, the skill weights behind the totals, and **Show ratings from** chips (Combined, then each rater): tap a rater to see every team's total and skill sums from their ratings alone. Your own teams use the raters picked under Ratings from, and re-check by themselves when that changes. Your own teams also get **Suggestions**, right under the team cards and based on whichever Show ratings from chip is selected (Combined or one rater): what's off (a team without a setter, weak passers bunched up, a keep-apart pair together) and up to three small swaps that balance them better, each with the gap before and after and what it fixes. Apply a swap, Undo it, or tap 🔓 to lock a player to their team. Combos count too (when Use combos is on): a together pair on different teams is flagged and swaps that reunite them come first, a together pair on one team is never split, and a keep-apart pair on one team is flagged. Organizers see the swaps without numbers or rating-based notes.
- **Users** (super): create invite and password-reset links to send yourself, change roles, remove people.

## Setup from scratch

### 1. Supabase
1. Create a project.
2. **SQL Editor**: paste `supabase/schema.sql` and run it.
3. **Authentication > Sign In / Providers**: turn **off** "Allow new users to sign up". Invite links still work.
4. **Authentication > Users > Add user > Create new user**: your email and a password, tick **Auto Confirm**.
5. **SQL Editor**: make yourself super:
   ```sql
   update profiles set role = 'super' where email = 'YOUR EMAIL';
   ```
6. Optional, to import players and ratings from `vb_skill.md`: run `tools/make_seed.py` (see below), then run `private/seed.sql`, and `private/seed_ratings.sql` once each rater has an account.
7. **Project Settings > API Keys**: copy the **Project URL**, the **publishable** key and the **secret** key.

### 2. Site config
Put the Project URL and publishable key in `site/config.js`. Both are public by design.

### 3. GitHub + Netlify
1. Push this folder to a **private** GitHub repo. `private/` and `.env` are git-ignored.
2. Netlify: **Add new site > Import from GitHub**, pick the repo, leave the build command empty. `netlify.toml` sets the rest.
3. **Site configuration > Environment variables**:
   - `SUPABASE_URL`: the Project URL
   - `SUPABASE_SERVICE_ROLE_KEY`: the **secret** key. Never put it in `site/` or in the repo.
4. **Project configuration > General**: turn off the **Powered by Netlify badge** if you don't want it.
5. Custom domain (optional): **Domain management > Add a domain**. If DNS is on Cloudflare, add `CNAME @ setme.netlify.app` and `CNAME www setme.netlify.app`, both **DNS only** (grey cloud), then let Netlify provision HTTPS.
6. Back in Supabase, **Authentication > URL Configuration**: set **Site URL** to the site's address and add `https://YOUR-DOMAIN/**` under **Redirect URLs**.

### 4. Inviting people
Go to **Users**, enter a name and email, press **Create invite link**, and send the link yourself (WhatsApp is fine). No email is sent, so Supabase's free email limits don't apply. The link opens SetMe; they tap **Continue** and choose a password. Forgotten password: **Reset link** on their card. The Continue step exists because WhatsApp's link preview opens links on its own and would use up a one-time link.

## Upgrading an existing database

`schema.sql` is for new projects. A database set up before these features needs:

```sql
alter table public.players add column if not exists tier text check (tier in ('beginner', 'average', 'strong'));
alter table public.ratings add column if not exists consistency numeric(3,2) check (consistency in (0, .25, .5, .75, 1));
drop table if exists public.combos;  -- combos are no longer saved
```

Setting rating: paste and run `supabase/setting_skill.sql` (adds the column and logs Setting in rating history). Until then, Setting taps don't save; everything else works.

Rating history: paste and run `supabase/rating_history.sql` (safe to run again if you ran an earlier version). It records changes from then on; earlier changes weren't kept.

## Running it locally

```
# .env
SUPABASE_URL=https://YOUR-PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=sb_secret_...
```

Then:

```
npm install -g netlify-cli
netlify login
netlify link        # choose "current git remote origin", then the setme site
netlify dev         # http://localhost:8888
```

Local runs use the **real** database. Building teams only reads, but ticking players, rating and so on change live data.

## Tests

```
node tests/test_teams.mjs          # team builder on your real data (needs private/fixture.json)
node tests/test_unknowns.mjs       # unrated players: inferred skills, levels, spreading
node tests/test_raters.mjs         # rater leans with several raters
node tests/test_setters.mjs        # setters spread when short
node tests/test_apart.mjs          # keep-apart pairs
node tests/test_consistency.mjs    # consistency: no effect on strength, spread across teams
node tests/test_paste.mjs          # WhatsApp list matching
node tests/test_csv.mjs PATH.csv   # ratings CSV import
```

## Updating from vb_skill.md

```
python3 tools/make_seed.py ../vb_skill.md --rater "Nasser=YOUR EMAIL" --rater "Reem=REEM EMAIL"
node tests/test_teams.mjs
```

Writes `private/seed.sql` (players), `private/seed_ratings.sql` (each rater's ratings, matched by email) and `private/fixture.json` (for tests). Never commit `private/`: it holds ratings.
