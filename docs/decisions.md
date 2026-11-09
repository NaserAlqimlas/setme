## 2026-11-05 · Players see results, never ability numbers
- Decided by: the designer
- Why: Ratings are a tool for balancing teams, not feedback; seeing them would make the group compare people.
- Rejected: Showing players their own ratings on Me.
- Rests on: Profile page shows ratings to the super only; ratings row-level security in supabase/schema.sql.

## 2026-11-05 · Success is close games, balanced builds and an organizer who needs few minutes
- Decided by: Claude (default)
- Why: These are the outcomes the app exists for and they're already measurable in Scores and Teams.
- Rejected: Usage counts (visits, time on site), which reward keeping people in the app.
- Rests on: CLOSE = 3 and BLOWOUT = 10 in site/js/scores.mjs; gap and "Teammates again" on the Teams page.

## 2026-11-05 · Rate and Players stay separate pages, joined by links
- Decided by: Claude (default, recommended to the designer)
- Why: Different people do different jobs on them: a long private rating pass versus fast shared roster changes on game day. A collapsed rating section per player costs a tap per player and hides progress.
- Rejected: One page with a collapsible rating section on each player.
- Rests on: Conversation of 2026-11-05.

## 2026-11-05 · The next artifact is the game-day journey
- Decided by: Claude (default)
- Why: Where the WhatsApp paste belongs is a question about the order of game-day steps, which only the journey answers.
- Rejected: Moving the paste box to Teams before mapping the flow.
- Rests on: Conversation of 2026-11-05.

## 2026-11-05 · Game day is mapped as two frontstage lanes, players and organizer, with WhatsApp as an unconnected support
- Decided by: Claude (default)
- Why: The two run in parallel all week and meet only through the playing list and publishing; one lane would hide which actor owns each step.
- Rejected: A single organizer timeline, which leaves out what players do and see.
- Rests on: site/js/app.js (signupPage, playersPage, saveLineup, gamesView, lineupPage); netlify/functions/build-teams.mjs.

## 2026-11-05 · Show to players stays off by default
- Decided by: Claude (default), built in PR #3 and not overturned
- Why: Organizers choose when teams reach players; a hidden draft is never shown by accident.
- Rejected: Publishing on Save for scores.
- Rests on: sessions.published default false in supabase/club.sql.

## 2026-11-05 · Game-day research uses data, one observed game day, organizer interviews and five player tests
- Decided by: Claude (default)
- Why: The group is about 26 people; the database already counts sign-ups by who made them, and organizer and player behavior only shows when watched.
- Rejected: A survey, which can't show a pattern at this size.
- Rests on: docs/research-plan-game-day.md; signups.added_by in supabase/club.sql.

## 2026-11-05 · Someone other than the super runs the player sessions
- Decided by: Claude (default)
- Why: The super sees everyone's ratings; players may hold back criticism with them in the room.
- Rejected: The super running every session.
- Rests on: Ratings visibility in docs/context-setme.md.

## 2026-11-05 · The WhatsApp list stays first; Sign up runs alongside it
- Decided by: the designer
- Why: Many members won't sign up in SetMe.
- Rejected: Replacing the WhatsApp list with Sign up.
- Rests on: Answer during /impeccable init, 2026-11-05.

## 2026-11-05 · Organizers and the super are the primary users; members who aren't technical come second
- Decided by: the designer
- Why: Organizers (phone and laptop) and the super do the work; several organizers share a game day.
- Rejected: Players as the primary audience; a single organizer on a phone.
- Rests on: Answer during /impeccable init, 2026-11-05.

## 2026-11-08 · Players see their own average rating and how it changed
- Decided by: the designer
- Why: Players want to know where they stand and whether they're improving.
- Rejected: Overall only (too little to act on); month-by-month or last-month-only change (the designer chose every change, grouped by day); no minimum or three raters before showing (the designer chose two).
- Rests on: Answers on 2026-11-08. Reverses "Players never see ratings" (PRODUCT.md principle 1, 2026-11-05). Raters are told on the Rate page.

## 2026-11-08 · Players see their own match stats
- Decided by: the designer
- Why: Players want to see what they did in tagged games, not just the organizers.
- Rejected: Nothing offered instead; asked for directly.
- Rests on: Request on 2026-11-08. Their own numbers only (aces, pass average, kills, attack efficiency, blocks, digs, and game by game), through the my-stats function; never anyone else's touches or names.

## 2026-11-08 · Tagging closes 3 days after a game day, except for the super
- Decided by: the designer
- Why: Tags should be entered while the game is fresh; late edits change stats players already see.
- Rejected: Nothing offered instead; asked for directly.
- After that, organizers can still view a game's tags read-only (View tags).
- Rests on: TAG_DAYS and tagClosed in site/js/pages/scores.mjs; tag_open and the rallies/touches write policies in supabase/tag_window.sql.

## 2026-11-09 · Game-day rules live in one pure module
- Decided by: Claude (asked to find the app's implicit state machines and make the best call)
- Why: The game day drives most of the app's states (delete, scores, rounds, tagging window, what Save does), and its rules were re-derived inline on Teams and Scores. One tested place keeps them consistent for organizers, easy to change for developers, and findable for agents (docs/state-machines.md).
- Rejected: A state-machine library (new dependency, no build step here); rewriting the Teams page's built/own/undo state (large, risky, and it already works); moving rules into the database only (the page still needs them to decide what to show).
- Rests on: site/js/gameday.mjs, tests/test_gameday.mjs, docs/state-machines.md; tag_open() in supabase/tag_window.sql mirrors TAG_DAYS.
