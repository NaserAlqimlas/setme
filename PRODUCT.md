# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary: the super and the organizers.** The super (the site owner) runs the group: rates every player, invites accounts, links accounts to players by hand, and runs database upgrades, mostly on a laptop. Organizers run game day on a phone at the hall or on a laptop beforehand: they turn who's coming into the playing list, build balanced teams, enter scores and share results. Game day is shared: several people split it, for example one builds teams and another enters scores.

**Raters.** Trusted members who rate each player on six skills, privately, in occasional batches.

**Secondary: players.** Most of the group, several of them not technical, on phones only. They say they're coming, see published teams and scores, and see their own attendance and record. They never rate. On their own profile they see their own average rating, per skill and overall, and each day it changed, never who rated them, and their own match stats from tagged games (totals and game by game). A What to work on card names one strength and up to two things to work on, from their stats next to the club average and from their ratings.

## Product Purpose

SetMe turns an invite-only volleyball group's weekly list into balanced teams, records the games, and shows players the results. It exists so game days are close and fair without an organizer balancing teams by gut feel in the hall.

Success: games decided by a few points rather than blowouts, a small gap between team totals before play, teammates who change from week to week, and little organizer time between the final list and the first serve.

## Positioning

Teams are balanced from several raters' private, per-skill ratings, combined with each rater's lean taken out, and steered away from last weeks' teammates. Results feed back as a check on the ratings. The people rated see only their own average (once at least two people have rated a skill), never who rated them or anyone else's.

## Operating Context

- The group coordinates in a WhatsApp group. The WhatsApp list of who's coming takes priority: many members won't sign up in SetMe. Sign up in SetMe runs alongside it, and organizers paste or reconcile the WhatsApp list into the playing list.
- A game day has about 24 players in 4 teams of 6, mixed genders, a handful of setters. Games go to 25 or stop when time runs out.
- Several organizers share a game day, on phones in a loud hall and on laptops beforehand.
- Teams reach players as a shared image in WhatsApp and, once published, on the Lineup page.

## Capabilities and Constraints

- Pages: Rate, Sign up, Players, Teams, Scores (Games, Insights, Attendance, Season), All ratings / My ratings, Users, Lineup, Me (player profile).
- Roles: player, rater, organizer, super. Only the super sees individual and combined ratings; the database enforces it. A player's own averages come from the my-rating function, which returns numbers only.
- Static ES-module site on Netlify with no build step; Supabase (Postgres with row-level security, auth); Netlify Functions for team building, invites and the rating queue.
- Database changes ship as SQL files the super runs by hand. They must be safe to run again, and the site must keep working before they run.
- Accounts are linked to players by hand by the super; some members can't do it themselves.
- English interface; player names are mostly Arabic names written in Latin script.
- Open: whether the playing list should belong to a date rather than carry over between game days.

## Brand Commitments

Name: SetMe. Existing assets: the ball mark in `site/icon.svg` and the inline symbol in `site/index.html`.

## Evidence on Hand

- Real ratings, game days, games and sign-ups live in the production Supabase project. Read access from this environment is not granted.
- Research plan for game day: `docs/research-plan-game-day.md`. No findings yet.
- Game-day service blueprint: `docs/blueprint-game-day.html`.
- No user testimonials, usage statistics or usability results exist; none may be invented.

## Product Principles

1. Ratings are private. Players see results (attendance, wins, scores), their own average rating and their own match stats, never who rated them, any one rater's numbers, or anyone else's.
2. WhatsApp comes first. SetMe follows the group's list rather than asking everyone to change habits.
3. Game day is fast for whoever is holding the phone, and safe to hand between organizers mid-day.
4. Every upgrade is optional until it's run; the site keeps working as it is.
5. Write for members who aren't technical: plain words, one obvious action, no jargon.

## Accessibility & Inclusion

- Several members aren't technical; player screens must work without help.
- Phone use in a loud, busy hall: large tap targets, one-handed use, readable in light and dark.
