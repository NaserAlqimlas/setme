## Research objective

Learn how game day runs today and where SetMe fits in it, to settle four design decisions:

1. How organizers merge the WhatsApp list, which takes priority, with sign-ups made in SetMe. This decides how the paste and Set as Playing list combine instead of overwriting each other [blueprint-game-day.html, "Two sources overwrite the playing list"].
2. How several organizers split a game day and hand it over, and on which devices. This decides whether the paste box, the build and the scores sit on one page.
3. Whether the playing list should belong to a date [blueprint-game-day.html, "Last week's playing list"].
4. Whether members who aren't technical can sign in, sign up, drop out, find their team and find their record without help.

## Method

| Question | Method | Why this method |
|---|---|---|
| 1, 4 (scale) | Database review: four read-only queries | Sign-ups record who made them, so the share made by players themselves is already in the data |
| 1, 2, 3 | Watching one game day from the WhatsApp list to the last game, then a short interview with each organizer | What organizers do in the hall differs from what they'd say they do; switches between WhatsApp and SetMe only show when watched |
| 4 | Moderated usability test on the player's own phone | Sign-in, sign-up and Lineup are short, concrete tasks; five people catch most problems on screens this size |

A survey is ruled out: with about 26 members the numbers can't show a pattern, and the database already answers "how many".

## Participants

**Organizers.** Everyone who ran a game day in the last two months. Watch one, interview all.

**Players.** Five members with a linked account, picked by the people the group helps most with technology. At least two who have asked an organizer for help with SetMe or WhatsApp before. At least one who signs up only through WhatsApp today. Exclude organizers and raters.

## Timeline

| When | What |
|---|---|
| Before the next game day | Run the database queries; ask organizers and players to take part |
| Next game day | Watch the organizer; interview organizers that evening or the next day |
| Before or after the following game day | Five player sessions, 15 minutes each, in person |
| Within a week of the last session | Write the findings |

## Discussion guide / Protocol

### Database review

Run in the Supabase SQL editor after `club.sql` has been run again. Each query only reads.

```sql
-- Accounts by role, and how many are linked to a player
select role, count(*) as accounts, count(player_id) as linked
from profiles group by role order by role;

-- Active players who have no linked account
select count(*) as unlinked_players from players pl
where pl.active and not exists (select 1 from profiles p where p.player_id = pl.id);

-- Sign-ups per game day: made by the player themself, or added by someone else
select e.played_on, count(*) as signups,
  count(*) filter (where p.id is not null and s.added_by = p.id) as by_player,
  count(*) filter (where p.id is null or s.added_by is distinct from p.id) as by_someone_else
from events e join signups s on s.event_id = e.id
left join profiles p on p.player_id = s.player_id
group by e.played_on order by e.played_on desc;

-- Recent game days: published, ended, games entered
select s.played_on, s.published, s.ended,
  (select count(*) from games g where g.session_id = s.id) as games
from sessions s order by s.played_on desc limit 10;
```

### Watching game day

Sit or stand where you can see the organizer's phone. Don't help or suggest. Note the time at each line.

- When the WhatsApp list is final, and how the organizer knows it is
- Each switch between WhatsApp and SetMe, and what they were looking for
- How the playing list gets set: Set as Playing list, the paste, switches on Players, or several
- Late arrivals and drop-outs: when they happen and how they're handled
- Whether the Teams date is checked or changed
- Build to Save for scores: options compared, swaps made
- How players learn their team: the shared image, Lineup, or being told
- Scores: entered after each game or later, and by whom
- Whether Show to players and End the day are used
- Anything typed twice, any error message, anything left for "later"

### Organizer interview (20 minutes)

**Opening.** "I'm looking at how game day runs so SetMe can take less of your time. It's about the app, not about how you run things."

**The last game day**
- Walk me through the last game day, from when you first looked at the WhatsApp list.
  - Probe: What did you do in WhatsApp, and what in SetMe?
  - Probe: Where did it take longest?
- Think about a game day where the list changed at the last minute. What happened?
  - Probe: How did you find out? What did you change in SetMe?

**Sign-ups**
- When someone says they're coming, where does that happen?
  - Probe: When did you last add someone to Sign up yourself? Who, and what made you do it?
- Who in the group do you end up helping with SetMe?

**Sharing and finishing**
- After the teams were set last time, how did players find out which team they were on?
- What do you do after the last game?

**Closing.** "Is there anything about game day I should have asked about but didn't?"

### Player usability test (15 minutes, their own phone)

**Opening.** "I'm testing the app, not you; anything confusing is the app's fault. This has nothing to do with ratings or which team you're put on, and nothing you do here is saved as a real sign-up. Please say out loud what you're thinking as you go. I won't help, but you can stop at any time."

Set up beforehand: an open test game day a week out, and a published past game day the participant played in. Delete the test game day after each session.

| Task | Scenario, read aloud | Done when | Stop at |
|---|---|---|---|
| Sign in | "You've opened the link from the WhatsApp group. Get into SetMe." | Sees their own pages | 3 minutes |
| Sign up | "There's a game next week and you want to play. Let the organizers know through SetMe." | I'm in or Join the waitlist tapped | 2 minutes |
| Drop out | "Something came up and you can't make it. Take yourself off." | Their name is gone from the list | 2 minutes |
| Team | "Teams from [past date] are out. Which team were you on, and who else was on it?" | Says the team and two teammates | 2 minutes |
| Record | "How many game days have you come to?" | Reads it from Me | 2 minutes |

After the tasks: "What was the hardest part?" and "When you want to play, where do you say so today?"

Rate each problem on its own: cosmetic, minor, major, or catastrophic (stops the task).

## Logistics

- Notes by hand or in a notes app, using codes (O1, P1 to P5), not names. No recordings.
- Verbal consent at the start of each session, using the opening lines above.
- The super sees everyone's ratings, so someone else runs the player sessions where possible. Nobody mentions ratings in any session.
- A thank-you in person. No other incentive.
- Notes deleted once the findings are written.

## Deliverables

`docs/findings-game-day.md`: one finding per decision above, each with who and how many, and the change it leads to on Sign up, Players, Teams or Scores.
