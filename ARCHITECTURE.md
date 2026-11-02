# Architecture

SetMe is a static single-page site on Netlify, two Netlify Functions, and a Supabase project (Postgres + Auth).
There is no build step and no framework: the browser loads plain ES modules.

```
 Browser (site/)                       Netlify Functions                    Supabase
 ───────────────                       ─────────────────                    ────────
 app.js ── supabase-js (publishable) ───────────────────────────────────▶  Auth, Postgres (RLS)
   │                                                                          ▲
   ├── POST /.netlify/functions/build-teams ──▶ build-teams.mjs ── secret ───┤
   │        (bearer token)                       teams.mjs                    │
   └── POST /.netlify/functions/admin ───────▶ admin.mjs ──────── secret ────┘
```

- **Reads and writes the browser is allowed to make** (rating, editing players, reading profiles) go straight to Supabase with the publishable key. Row Level Security decides what each user can see.
- **Anything that needs everyone's ratings or admin powers** goes through a function, which checks the caller's role and then uses the secret key.

## The privacy rule

Only the super can see ratings. Everything else follows from that:

- **RLS**: a rater or organizer can only read their own rows in `ratings`. The super can read all.
- **Building teams happens on the server.** `build-teams` loads every rating with the secret key, builds the teams, and, for anyone but the super, strips the result down to names and setter roles. Organizers never get numbers, not even team totals.
- **The New players check** (`build-teams` with `check: true`) only says who has no ratings, never values.
- **Your own teams** (`build-teams` with `teams`) goes through the same stripping, so organizers checking their own teams see lineups, not numbers.
- The secret key only exists in Netlify's environment variables (and a git-ignored `.env` for local runs).

## Files

```
site/
  index.html            shell: header, nav, #app, loads vendor/supabase.js and js/app.js
  config.js             Supabase URL + publishable key (public)
  style.css             all styles; light and dark theme from CSS variables
  vendor/supabase.js    supabase-js 2.45.4 UMD build, self-hosted
  js/app.js             every page, routing, auth flow, UI helpers
  js/teams.mjs          rating maths and the team builder (shared with the server)
  js/paste.mjs          matching a pasted WhatsApp list to players
  js/csv.mjs            ratings CSV import and template
  js/courtimg.mjs       draws the court-map PNG for sharing
netlify/
  lib/supabase.mjs      server helpers: REST/admin calls with the secret key, caller(req) -> {id, role}
  functions/build-teams.mjs
  functions/admin.mjs
supabase/schema.sql     tables, triggers, RLS policies
tools/make_seed.py      vb_skill.md -> private/ seed SQL + test fixture
tests/                  node scripts, no framework
```

## Data model

| Table | Columns | Notes |
|---|---|---|
| `profiles` | id (auth user), email, display_name, role | Created by a trigger when an auth user is created. Role is rater, organizer or super. |
| `players` | name, gender (M/F/U), setting (M main / B backup / N), playing, active, tier | `tier` is the stand-in level (beginner, average, strong) for players nobody has rated. |
| `ratings` | rater_id, player_id, receiving, hitting, hustle, serve, blocking, consistency | One row per rater per player. Values are 0, .25, .5, .75, 1, or null for U. |
| `rating_history` | rater_id, player_id, skill, old_value, new_value, changed_by, changed_at | Written only by the `ratings_history` trigger, one row per changed skill. Taps on the same skill by the same person within 10 minutes merge into one row. Super reads all rows; everyone else reads their own (rater_id = them). No foreign keys, so it outlives removed players and raters. |

Combos (play together / keep apart) are **not stored**. The Teams page keeps them in memory and sends them with each build.

`my_role()` is a security-definer function the policies use to look up the caller's role without recursion.

## Auth and invites

- Email + password only; public sign-up is off.
- The super creates links on the Users page. `admin.mjs` calls Supabase's `generate_link` and returns
  `https://SITE/?token_hash=…&type=invite|recovery` instead of Supabase's one-time verify URL.
- The site shows a **Continue** page for those links and only calls `verifyOtp` when the person taps it. Link previews (WhatsApp) open URLs automatically and would otherwise use up the token.
- After verifying, the person sets a password; `user_metadata.password_set` marks that done.
- supabase-js runs with an in-page lock instead of `navigator.locks`, which hung in some browsers.

## Pages (app.js)

`PAGES` lists each page with the roles that see it. `render()` picks the page from the URL hash.

| Page | Roles | Talks to |
|---|---|---|
| Rate | all | `ratings` (own rows, upsert per tap), `players` |
| My ratings / All ratings | all; super sees everything | `ratings`, `rating_history` (own rows; super all); super also runs `combineRatings` in the browser |
| Players | organizer, super | `players` (update; super insert/delete) |
| Teams | organizer, super | `build-teams` function |
| Users | super | `profiles`, `admin` function |

UI helpers at the top of app.js: `h()` builds elements, `seg()` is the pick-one button row, `toggle()` the switch, `stacked()` turns tables into cards on phones, `toast()`.

## Team building (teams.mjs)

Shared by the server and the super's All ratings page.

### 1. Combining ratings: `combineRatings(players, ratings)`

1. **Rater leans.** For each skill, every rating is treated as *player's level + rater's lean*. Both are fitted together (alternating averages, 50 rounds) from players rated by 2+ people, and the leans are centred so the average rater has none. A rater needs 5 shared ratings in a skill before their lean is used.
2. **Combine.** Each rating has its rater's lean taken out, then ratings are averaged per player per skill.
3. **Fill gaps.**
   - A skill nobody rated, for a player who has other skills rated: assume they sit as far above or below the group as on the skills we know.
   - Consistency nobody rated: the group's average (being good doesn't make someone steady).
   - A player nobody rated at all: their `tier` (group's lower quartile, average, or upper quartile per skill), Beginner if none. These are flagged `guess`.
4. **Disagreements.** Players whose raters' totals (after leans) are 1 or more apart.

Returns `combined` (per-player skills, guess), `offsets` (leans), `raters` (shared counts, how far off each rater typically is), `disagreements`.

### 2. Strength

`weightedTotal` = receiving × 1.5 + hitting × 1.25 + serve × 1 + hustle × .75 + blocking × .5. Consistency is **not** part of strength.

### 3. Building: `buildTeams({ players, skills, combos, apart, numTeams, … })`

- **Units.** Together-combos are merged (union-find) into units that always move as one. A keep-apart pair inside one unit is an error.
- **Features.** Each unit carries summed numbers: 5 weighted skills, main setters, backups, women, weak passers (receiving ≤ .25), unrated players, inconsistent players (consistency ≤ .25), and one field per keep-apart pair.
- **Cost** (lower is better):

  | Rule | Penalty |
  |---|---|
  | Team weighted total away from the average | 4 × squared difference |
  | Each skill uneven across teams | squared difference |
  | Strongest − weakest team over .25 | 50 per extra .25 |
  | Team without exactly one main setter | 100, plus 100 per extra main setter |
  | Team with no main setter and no backup | 40 |
  | Team with 2+ backups | 5 |
  | Women more than 1 apart between teams | 100 per extra |
  | Weak passers, unrated players, inconsistent players bunched | 20 per extra beyond 1, plus a small squared term |
  | Keep-apart pair on the same team | 100 |

- **Search.** Random restarts (up to 3,000, 7-second budget on the server), each improved by swapping equal-size units between teams and swapping a combo for the same number of single players, until no swap helps. Seeded random (mulberry32); with the time limit, results can differ slightly between runs.
- **Options.** The best distinct lineups, up to 3, each at least 4 player moves away from the others.
- **Warnings.** Time limit hit, keep-apart pairs that couldn't be honoured, unrated players and their stand-in level.

### build-teams.mjs

1. Check the caller is organizer or super.
2. Load active players and all ratings with the secret key. If the super passed `raters`, keep only those raters' ratings.
3. `combineRatings`, then `buildTeams` with the combos from the request (`useCombos` off sends none).
   With `teams: [[playerId, ...], ...]` (Your own teams) it skips building and runs `describeTeam` on each team as given, any active players, so the result looks like one built option. It also returns `problems` (`teamProblems`) and up to three `suggestions` (`suggestSwaps`: every one-for-one swap, then pairs of the 40 best, scored with the same `makeScorer` cost as `buildTeams`; `locked` players and together pairs already on one team stay put; split together pairs add 1e6 each, so reuniting them outranks any balance gain, like combos being a hard rule in `buildTeams`). Super can pass `suggestRater` to get problems and suggestions from one rater's ratings alone (the Show ratings from chip). Organizers get suggestions without `gap` and without the weak-passer / inconsistent-player notes.
4. Super: each option also gets `byRater`, every picked rater's weighted team totals and skill sums from their ratings alone (`guessed` counts players they haven't rated).
5. Non-super callers: drop scores, sums, totals and `byRater`; players reduced to `{ name, setting }`.

## Sharing (courtimg.mjs)

Draws a 1080-wide PNG on a canvas: Team 1 v Team 2 on court 1, Team 3 v Team 4 on court 2, an odd team as "next up". Setters marked S, backups B. The image is rendered as soon as teams appear so a tap can open the phone's share sheet straight away (iOS drops the share if the tap has to wait). Falls back to copying the image, then to a download.

## Styling

`style.css` defines colours as variables on `:root` with a dark-mode set under `prefers-color-scheme`. Phones get their own rules under `max-width: 640px` (and 899px for the rating guide, which becomes a bottom sheet). On desktop the rating guide is a fixed drawer and `body.guide-open` pads the page so everything slides left.

## Deployment

- Netlify publishes `site/` and bundles `netlify/functions/` with esbuild (`netlify.toml`).
- Netlify's secret scanning is told that `SUPABASE_URL` and `site/config.js` are public, because the publishable key and URL are meant to be in the page.
- Pushing to `master` deploys.
