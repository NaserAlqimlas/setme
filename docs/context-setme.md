# SetMe

## Users

**The super (one person).** Runs the group and the site. Rates every player, sees everyone's ratings, invites accounts, links accounts to players by hand, runs SQL upgrades. Works on desktop for setup and on a phone at the gym.

**Organizers.** Run game day, several of them sharing it: one may build teams while another enters scores. Turn the WhatsApp list into the playing list, build and adjust teams, enter scores game by game, publish teams to players, end the day. On a phone at the hall, or on a laptop beforehand.

**Raters.** Trusted members who rate each player on six skills, privately. Rate in occasional batches of about 26 players, not every game day. See only their own ratings.

**Players.** Most of the group. Several are not technical. On phones only. Say they're coming to a game day, see the published teams and scores, and see their own attendance and record. They never rate. On their own profile they see their own average rating, per skill and overall, and each day it changed, never who rated them.

The group coordinates in WhatsApp, and the WhatsApp list of who's coming takes priority: many members won't sign up in SetMe. Sign up runs alongside it. A game day has about 24 players in 4 teams of 6, with mixed genders and a handful of setters. Games go to 25, or stop when time runs out.

## Product

An invite-only web app for one volleyball group: a static site on Netlify with a Supabase database. There's no revenue, no public sign-up and no app-store app.

| Page | For | Job |
|---|---|---|
| Rate | Raters, organizers, super | Rate each player 0 to 1 per skill, or U for "don't know" |
| Sign up | Everyone with a linked account | Join a game day or its waitlist; organizers open days and turn sign-ups into the playing list |
| Players | Organizers, super | Roster: playing list, setter role, gender, anchor players, paste from WhatsApp |
| Teams | Organizers, super | Combos, setters, build balanced options, swap, save drafts, Save for scores |
| Scores | Organizers, super | Enter games, publish to players, end the day, insights, attendance, season recap |
| All ratings / My ratings | Super / raters | Every rating with rater leans; a rater's own history |
| Users | Super | Invites, roles, linking accounts to players, backup, activity log |
| Lineup | Players and raters | Published teams and scores |
| Me | Linked accounts | Own attendance, record and game days |

## Constraints

- One developer, who is also the super. No build step; plain ES modules.
- Database changes ship as SQL files the super runs by hand in the Supabase SQL editor. They must be safe to run again, and the site must keep working before they're run.
- Accounts are linked to players by hand. The super does it for members who can't.
- Phone-first for everyone except the super's setup work. Interfaces have to survive one-handed use in a loud hall with interruptions.
- English interface. Player names are mostly Arabic, written in Latin script.

## Ethical stance

- Ratings are private. A rater sees only their own, and only the super sees individual and combined ratings. The database enforces this, not just the pages.
- Players see one number about their ability: their own average rating (per skill and overall, once at least two people have rated a skill) and each day it changed. Never who rated them, any one rater's numbers, team totals, rank, or anyone else's. They also see results: attendance, wins and losses, scores.
- Teams and scores reach players only when an organizer publishes them.
- No notifications, streaks, leaderboards of individuals by rating, or engagement metrics.
- Data collected: name, email, gender (used only to spread women evenly), ratings, sign-ups, scores, and optional match-stat tags.
- Nothing from the anti-pattern catalog. Removing an account, leaving a waitlist and clearing a list are each one action with a confirmation where the step can't be undone.

## Success

| Outcome | Measure | Where it comes from |
|---|---|---|
| Games are close | Share of games decided by 3 points or fewer, and by 10 or more | Scores, Insights |
| Teams are balanced before play | Gap between highest and lowest team total | Teams page, per option |
| Teammates vary | Pairs who were teammates on the last three game days | Teams page, "Teammates again" |
| Game day runs itself | Minutes from pasting the list to Save for scores | Not measured; organizer's estimate |
| Players manage without help | Sign-ups made by the player, not added by an organizer | Sign-ups (`added_by`) |
| Ratings stay current | Players rated by fewer than two raters; ratings older than four months | Rate, All ratings |

## Open questions

- Should the playing list belong to a date, so it can't carry over from last week?

## Artifacts

- **Game-day journey**, from the WhatsApp list to End the day. It answers where pasting the list belongs and what the organizer does on which page, in what order, on a phone. It's the next piece of work.
- **Evaluation of the player screens** (Sign up, Lineup, Me) for the members who aren't technical. Players use the app without anyone watching; they're the users with the least help.
- **State inventory for game day**: a list not set yet, a waitlist, no published teams, an ended day. Empty and in-between states are where non-technical members get stuck.
