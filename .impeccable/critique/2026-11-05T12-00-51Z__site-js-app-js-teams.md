---
target: teams
total_score: 25
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:/Users/nasser/Documents/dev/setme/site/js/app.js#teams"
timestamp: 2026-11-05T12-00-51Z
slug: site-js-app-js-teams
---
Method: dual-agent (A: design review, live CDP as organizer, desktop/phone × light/dark · B: detector, static + 6 live states)

## Design Health Score: 25/40 (Acceptable)
| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 3 | "Differs from saved" warning only at top of page; Save looks identical whether saved, new or replacing |
| 2 | Match System / Real World | 3 | Gap and "17 pairs again" have no scale |
| 3 | User Control and Freedom | 3 | Check teams in Your own teams wipes built options and swaps without asking |
| 4 | Consistency and Standards | 2 | Yellow Build and blue Save compete; Undo in two places; "null" heading on pasted teams |
| 5 | Error Prevention | 2 | Replace guarded only by native confirm(); saved teams can be re-saved; uneven teams save in one tap |
| 6 | Recognition Rather Than Recall | 3 | Comparing options needs remembering rosters |
| 7 | Flexibility and Efficiency | 2 | Options, swaps and combos lost on reload; no side-by-side compare |
| 8 | Aesthetic and Minimalist Design | 2 | Seven layers between tabs and Team 1; phone tabs wrap to five lines |
| 9 | Error Recovery | 3 | Try again, plain upgrade messages, amber change line |
| 10 | Help and Documentation | 2 | Nothing says what a good gap is or how suggestions are ranked |

## Design Specificity Verdict
Specific to SetMe: display type, team colour bars, ball-yellow build, verdict words, volleyball copy. Generic: four identical fold cards and a tall option header.
Detector: overused-font (Inter, brand), border-accent-on-rounded ×4 (team identity), nested-cards ×8 on .seg (false positive), straggler on .saved-line at 390px (cosmetic), dark-glow static only (false positive). No contrast, touch or overflow findings in any state.

## Priority Issues
1. [P1] Saved teams can't be seen or reopened on Teams; Build teams dominates after a save. Show the saved lineup first with "Edit these teams"; demote Build to "Build new options". (/clarify, /layout)
2. [P1] Replacing a saved lineup is too easy: Save reads the same when saved or replacing; warning off-screen; native confirm. "Saved ✓" disabled when matching; "Replace Thursday's teams" when differing; in-page confirm naming games entered. (/harden)
3. [P1] Check teams in Your own teams silently replaces built options; pasted heading shows "null" (card.title on <details> reflects the attribute). Separate container or confirm; store title in a property. (/harden)
4. [P2] Option header buries the teams, worst on phone. Drop duplicate h3; fold numbers controls and weights; shorten teammates line; scrolling tabs on phone. (/distill)
5. [P2] Focus lost to body after swap/Undo/Apply; fresh role=status nodes may not announce. Persistent live region; focus Undo after swap. (/audit)

## Persona Red Flags
- Organizer handed the phone: previous holder's options, swaps, combos gone; sees "saved" but not which teams; no "saved by/at".
- Casey: one-tap replace from sticky bar; differs warning off-screen; long single-column scroll between teams.
- Sam: focus lost on re-render; locks undiscoverable on touch; picking state by border style and tint.
- Alex: no side-by-side compare; nothing persists on reload; suggestion order unexplained.

## Minor Observations
- Not-better swap hints still ranked and highlighted; Suggestion #1 after a swap is the Undo.
- Team 4 gold only overridden in light mode (dark measures fine).
- Setter vocabulary differs between fold, badges and cards.
- More holds only two items.
- Scores empty state still says "Save for scores".
- Uneven own teams save with no warning.
- Touch tablets/landscape: seg buttons and chips 36px (adapt check).

## Questions to Consider
- With a lineup saved for the day, should Teams open on it rather than on "build from scratch"?
- Organizers see per-rater team sums and per-swap gap changes; does that fit "only the super sees individual ratings"?
- If every option reads "Very even", should tabs lead with teammate variety instead?
