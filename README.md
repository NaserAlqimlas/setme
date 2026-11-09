# SetMe

Invite-only site for a pickup volleyball group: people rate players, and organizers build balanced teams.
Live at **https://setme.club** (also https://setme.netlify.app).

How it fits together: [ARCHITECTURE.md](ARCHITECTURE.md).

## Who can do what

| Role | Can do |
|---|---|
| **player** | **Sign up** for game days (if their account is linked to a player), see published teams and scores on **Lineup**, and their own profile (**Me**). Can't rate |
| **rater** | Rate players on **Rate**; see their own ratings on **My ratings** |
| **organizer** | Everything a rater can, plus **Players** (gender, setter role, who's playing, paste the WhatsApp list) and **Teams** (combos, build, share). On Teams, has everything super has (Ratings from picker, team totals, skill sums, gaps and rating-based notes, combined or per rater via Show ratings from); never a single player's ratings. My ratings shows only their own |
| **super** | Everything, plus add and delete players, **All ratings** (every rater, combined values, rater leans, disagreements), choose whose ratings a build uses, and **Users** (invite, reset links, roles, remove) |

## What's in the app

- **Rate**: six buttons per skill (U, 0, .25, .5, .75, 1) for receiving, hitting, hustle, serve, blocking and consistency, plus **Setting** for players marked as setters. Every tap saves. A rating guide slides in from the side (up from the bottom on phones) and jumps to the skill you're rating. Filters for this session's players and for players you haven't rated. CSV template, import, and export of your own ratings (re-imports as is); super can import on behalf of another rater.
- **My ratings / All ratings**: sortable table (tap a column, or use Sort by on phones). Below it, **Rating history**: which rating changed, from what to what, and when. Raters and organizers see their own changes; super sees everyone's, with who made them. A chart shows how many ratings changed each day. Tap a player's name (or pick them in the Player box) to see just theirs, with a chart: their skills over time from one rater, or each rater's total over time.
- **Players**: paste the WhatsApp list to set who's playing (names after "Waitlist" are left out). Super adds a new player with a stand-in level (Beginner, Average, Strong) used until someone rates them.
- **Teams**: a **Setters** card to say who sets all game and who rotates tonight (main setters default to all game; also tappable on setter badges in Your own teams). A setter who sets all game adds their Setting rating to the team, while their hitting counts at 25% and receiving at 50%, and they don't count as weak passers. Combos for this build only (play together / keep apart, not saved), New players card for unrated players, number of teams, date, build. Each option can be copied as text or shared as a court-map image. **Your own teams**: paste teams you made (or upload a .txt/.csv) to see them laid out the same way, with Copy text and Share image; super and organizers also see each team's skill sums and totals. Super and organizers also see, for every set of teams, the gap between the strongest and weakest team, the skill weights behind the totals, and **Show ratings from** chips (Combined, then each rater): tap a rater to see every team's total and skill sums from their ratings alone. Your own teams use the raters picked under Ratings from, and re-check by themselves when that changes. Your own teams also get **Suggestions**, right under the team cards and based on whichever Show ratings from chip is selected (Combined or one rater): what's off (a team without a setter, weak passers bunched up, a keep-apart pair together) and up to three small swaps that balance them better, each with the gap before and after and what it fixes. Apply a swap, Undo it, or tap 🔓 to lock a player to their team. Combos count too (when Use combos is on): a together pair on different teams is flagged and swaps that reunite them come first, a together pair on one team is never split, and a keep-apart pair on one team is flagged.
- **Scores** (organizers, super): on Teams, **Save for scores** on any option (or Your own teams) saves it as that date's lineup. On Scores, enter each game: the next pairing is suggested from the rotation (1v2 and 3v4, then 1v4 and 2v3, then 1v3 and 2v4; with two teams, the same pair until time is up), and a game stopped before 25 is saved as it stood and scaled to a game to 25 in the numbers. **Change players** handles late arrivals, people leaving and moves between teams; each game keeps who actually played and the team numbers the ratings predicted at that moment. **Insights**: close games and blowouts, how often the stronger-rated team won, a chart of rated gap against actual margin, which team differences go with winning, and (after 30 games) suggested strength weights. Super also sees each player's results against what their ratings predicted.
- **Users** (super): create invite and password-reset links to send yourself (as a player, rater or organizer), change roles, remove people, and **link each account to its player** (done by the super, never by the person). **Backup** downloads every table as one JSON file. **Activity** lists role changes, links, removals, players added or deleted, imports for someone else, invite links and backups.
- **Sign up**: organizers open a game day with a number of spots. Linked accounts tap **I'm in** or **Drop out** while it's open; past the spots they go on the waitlist and move up when someone drops out. Organizers add or remove anyone, close it, and **Set as Playing list** in one tap. The WhatsApp paste still works.
- **Lineup** (players, raters): game days whose teams an organizer turned on with **Show to players** on Scores: the teams (court image to share) and the scores. No numbers.
- **Profiles**: tap a name (Players, Attendance, Sign up) or **Me**. Game days, record, best win streak, attendance dots and recent results. Organizers see anyone's; players and raters only their own. The super also sees the player's ratings (combined and per rater), how their teams did against their ratings, and match stats.
- **Rate, worth a fresh look**: players whose results keep disagreeing with their ratings, players fewer than two people have rated, and your ratings older than four months. It never says which way. **Anchor players** (super ticks them on Players) are rated first by new raters; until a rater shares 5 rated players with others, their ratings count half next to calibrated raters'.
- **All ratings, Coverage** (super): how many people rated each player, who has one rater or none, and how much of the group each rater covers.
- **Teams, extra switches**: **Mix up teammates** (on) steers away from pairs who were teammates on the last three game days, only choosing between splits that are about as balanced; each option says who's together again. **Spread women evenly** (on) splits women (gender F) so team counts are at most 1 apart, and flags it on your own teams when they aren't; off, gender is ignored. **Adjust for results** (off) shifts each player by how their teams have done against their ratings, once 15 games have scores. **Save draft** keeps any option (or your own teams) to compare later in **Drafts** (gap, issues, repeats, checked again with today's ratings) or open again. The court image numbers each team's serving order (setter first, then strong and weak players in turn), and a team of six stands in its starting rotation.
- **Scores, Attendance and Season**: Attendance shows game days attended, how often, runs in a row and the last ten game days per player, plus regulars who've stopped coming. Season picks a month, the last three months or the year and shares a recap image: never misses, best record, longest win streak, most wins, closest game, and kills, aces, blocks and digs from tagged games.

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

Don't know vs not answered: paste and run `supabase/rating_unknown.sql` (adds the `unknown` column). Until then, Rate works as before: a saved blank shows as U, and a player counts as rated after the first tap.

Scores: paste and run `supabase/scores.sql` (adds `sessions` and `games`). Until then Save for scores and the Scores page show an error; everything else works.

Match stats: paste and run `supabase/match_stats.sql` (adds `rallies`, `touches`, the `save_game_tags` function, the `player_stats` and `tagged_games` views, and video columns on `games`). Until then the Tag button on Scores says it needs the upgrade; everything else works.

Perfect digs: paste and run `supabase/dig_perfect.sql` after `match_stats.sql` (adds `dig_3` to `player_stats`). Safe to run again. Until then Dig → Perfect saves and shows in each game's tags, but totals on All ratings and Me leave those digs out.

Game ended here: paste and run `supabase/tags_end.sql` after `match_stats.sql` (adds `games.tags_end`). Safe to run again. Until then the Tag screen doesn't offer to mark where a game ended.

Tagging window: paste and run `supabase/tag_window.sql` after `match_stats.sql` (organizers can add or change a game's tags only up to 3 days after its game day; the super any time). Safe to run again. Until then the Tag button still closes after 3 days, but the database doesn't enforce it.

Club features: paste and run `supabase/club.sql` (player role and account links, anchor players, sign-ups, Show to players, End the day, drafts, the activity log, and tighter rating rules so players can't rate). Safe to run again. Until then the site works as before: the new tabs stay hidden, and Drafts, Anchor, Show to players, End the day, linking and Activity don't appear. Already ran it before End the day was added? Run it again: past game days are marked as ended the first time.

Rounds: paste and run `supabase/rounds.sql` after `scores.sql` and `club.sql` (adds `rounds`, a `round` column on `games`, the `start_round` and `undo_round` functions, and rounds on the Lineup page and player profiles). Ran it before profiles showed rounds? Run it again. Safe to run again. Until then a game day has one round, and saving new teams for a day with games replaces them, as before.

Remembered names: paste and run `supabase/aliases.sql` (adds `player_aliases`). Safe to run again. Until then, Match to… on Players works for the paste on screen but isn't remembered for the next one.

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

`npm test` runs them all (Node 22 or later, nothing to install). GitHub runs it on every push, and Netlify runs it
before every deploy: a failing test stops the deploy and the live site keeps the last good version. One at a time:

```
node tests/test_load.mjs           # every browser module loads (app.js, ui.mjs, pages/): imports, syntax
node tests/test_teams.mjs          # team builder on your real data (needs private/fixture.json; skipped without it)
node tests/test_unknowns.mjs       # unrated players: inferred skills, levels, spreading
node tests/test_raters.mjs         # rater leans with several raters
node tests/test_setters.mjs        # setters spread when short
node tests/test_apart.mjs          # keep-apart pairs
node tests/test_consistency.mjs    # consistency: no effect on strength, spread across teams
node tests/test_paste.mjs          # WhatsApp list matching
node tests/test_csv.mjs PATH.csv   # ratings CSV import
node tests/test_scores.mjs         # score margins, rotation, insights and weight fitting
node tests/test_club.mjs           # attendance, season awards, results-adjusted ratings, teammate variety, serving order, new raters
```

## Updating from vb_skill.md

```
python3 tools/make_seed.py ../vb_skill.md --rater "Nasser=YOUR EMAIL" --rater "Reem=REEM EMAIL"
node tests/test_teams.mjs
```

Writes `private/seed.sql` (players), `private/seed_ratings.sql` (each rater's ratings, matched by email) and `private/fixture.json` (for tests). Never commit `private/`: it holds ratings.
