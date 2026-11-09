# State machines

Every piece of SetMe that moves through states, where it lives, and whether its rules are written down as code
(**explicit**: one pure function, tested) or only spread through a page (**implicit**). Change an explicit one in
its function and its test; change an implicit one carefully, everywhere listed.

Most of the app's states come from one thing, the **game day**, so its rules live together in
`site/js/gameday.mjs` (tests: `tests/test_gameday.mjs`).

| # | Machine | States | Where | Kind |
|---|---|---|---|---|
| 1 | Sign-in gate | link → login → password → app | `gate()` in `site/js/app.js` | explicit |
| 2 | Game day | upcoming → today → past; ended ⇄ open | `dayPhase`, `dayState` in `gameday.mjs` | explicit |
| 3 | Tagging window | open → read-only (super: always open) | `tagWindow`, `tagButton` in `gameday.mjs`; `tag_open()` in `supabase/tag_window.sql` | explicit, mirrored in SQL |
| 4 | Rounds | round n (no games) ⇄ round n (games) → round n+1 | `dayState` (canStartRound, canGoBackRound); `start_round`, `undo_round` in `supabase/rounds.sql` | explicit |
| 5 | Save on Teams | no-date, new, saved, replace, new-round | `saveIntent` in `gameday.mjs`, used by `saveButton` in `pages/teams.mjs` | explicit |
| 6 | Saving tags | saved → unsaved → saving → saved / failed → saving … | `syncNext` in `gameday.mjs`, used by `tagView` in `pages/scores.mjs` | explicit |
| 7 | Sign-up place | out, in (place), waitlist (place) | `signupStatus` in `gameday.mjs`, used by `signupPage` in `pages/club.mjs` | explicit |
| 8 | A rally | none → open (in play) → won a / won b | `endsRally`, `score`, `nextServer`, `suggestAction` in `site/js/stats.mjs` | explicit (pure helpers) |
| 9 | Show to players | hidden ⇄ shown | `sessions.published`; toggle on Scores | implicit (one flag) |
| 10 | What Teams shows | nothing → built options / your own teams, kept on this device | `out.dataset.shows`, `teamsStore` in `pages/teams.mjs` | implicit |
| 11 | A built option | as built → swapped (undo stack, locks, checked) | `built`, `undos`, `locks`, `checked` in `teamsPage` | implicit |
| 12 | Tags not yet saved | none → kept on this device → cleared once saved | `setme-tags-<game>` in localStorage, `tagView` | implicit |
| 13 | Playing list undo | none → can undo → put back / dismissed | `playingUndo` in `pages/players.mjs` | implicit |
| 14 | SetMe's ratings | preview → saving → saved / try again | `matchStatsCard` in `pages/ratings.mjs` | implicit |
| 15 | Invite link | made → Continue → password set | `admin.mjs` (generate_link), `linkPage`, `user_metadata.password_set` | implicit |

## The game day (2, 3, 4)

```
date ahead ── upcoming ──(the day)── today ──(next day)── past ──(TAG_DAYS later)── tagging read only
                    \_____________ End the day ⇄ Reopen: ended (score entry gives way to standings)
```

| Allowed | When |
|---|---|
| Delete day | upcoming or today. Once the date has passed the day stays, for records and attendance. |
| Enter scores | not ended (fixing a saved score works any time) |
| Tag a game | until `TAG_DAYS` (3) after the day; the super any time; then View tags, read only |
| Start a round | not ended, and the round playing now has games |
| Back a round | round 2 or later, with no games in it yet |

`TAG_DAYS` and the `3` in `tag_open()` must match: the page decides what to show, the database decides what saves.

## Saving tags (6)

```
saved ──change──▶ unsaved ──(1.5 s)──▶ saving ──ok──▶ saved   (unsaved if changed meanwhile)
                                          └──error──▶ failed ──(10 s)──▶ saving …
```

The status line on the tag screen shows the state (`data-sync` on `.tag-status`). Changes stay on this device until
a save that carries them goes through, so closing the page in `unsaved` or `failed` loses nothing on that device.

## Adding or changing one

- Game-day rules go in `gameday.mjs`: a pure function of plain values (dates as `'YYYY-MM-DD'` text, the role), no
  DOM or Supabase, with cases in `tests/test_gameday.mjs`. Pages call it; they don't re-derive the rule.
- A rule the database also enforces (like the tagging window) names its SQL twin in a comment on both sides.
- Moving an implicit machine to explicit: write the function and test from what the page does today, swap the page
  over without changing what anyone sees, then update this table.
