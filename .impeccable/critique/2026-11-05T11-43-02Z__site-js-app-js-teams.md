---
target: teams
total_score: 26
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:/Users/nasser/Documents/dev/setme/site/js/app.js#teams"
timestamp: 2026-11-05T11-43-02Z
slug: site-js-app-js-teams
---
Method: dual-agent (A: design review, live CDP as organizer, desktop/phone × light/dark · B: detector, live CDP 5 states + static scan)

## Design Health Score: 26/40 (Acceptable)

| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 3 | "Teams are saved" line doesn't say which option was saved or whether the screen changed since |
| 2 | Match System / Real World | 2 | "Gap .11", "Total 13.79", Rcv/Hus/Blk, "stand-in level": spreadsheet language |
| 3 | User Control and Freedom | 2 | Undo in Suggestions below all cards; worse swaps apply instantly |
| 4 | Consistency and Standards | 3 | Two yellow primaries (Build, Check); Save same size as ghost actions |
| 5 | Error Prevention | 2 | Swap offered on "not better" hints; replacing a saved day only via native confirm() |
| 6 | Recognition Rather Than Recall | 3 | Fold summaries good; edited options not marked on tabs |
| 7 | Flexibility and Efficiency | 3 | Ranked hints, locks, drafts, arrow-key tabs; no side-by-side option compare |
| 8 | Aesthetic and Minimalist Design | 2 | 24 lock icons once checked, long repeat lines, ~3,100px phone page |
| 9 | Error Recovery | 3 | Plain messages; upgrade errors name SQL files |
| 10 | Help and Documentation | 3 | Good inline hints; "Gap" never explained in place |

## Design Specificity Verdict
Mostly authored: fold summaries with live state, "Save as Thursday's teams", ball-yellow build, setter badges, repeat-teammate lines, ranked swap hints. Generic in the numbers (bare decimals, 6-column skill strip) and the auto-fill grid that orphans Team 4 at 1200px.
Detector (5 live states + static): no contrast/tiny-text/touch/overflow findings; earlier Team 4 and avatar contrast failures resolved. Remaining: overused-font Inter (accurate, brand call); border-accent-on-rounded ×4 on team cards (team identity, keep); nested-cards ×8 on .seg (false positive); straggler ×2 on phone hint text (cosmetic, text-wrap: pretty); dark-glow static only (false positive). Review also found unstyled plain links (browser blue). A claim that the toast lacks role=status was wrong and dropped.

## Priority Issues
1. [P1] No link between "saved" and the option on screen. Fix: Saved badge on matching tab/option; "Changed since saving · Save again"; mark edited tabs. (/harden, /clarify)
2. [P1] Worse swaps apply silently; Undo far from the change. Fix: post-swap strip under tabs with gap change, new problems, Undo, best fix; "Swap anyway" on not-better hints. (/layout, /harden)
3. [P2] Balance verdict unreadable: lead with "Very even / Close / Uneven", leading zeros, fixed decimals. (/clarify, /typeset)
4. [P2] Save and Share image buried among ghost buttons; phone bottom bar with big Save + Share, rest under More. (/layout, /adapt)
5. [P2] 4-team grid orphans Team 4; 36px player rows; 24 lock icons. Columns by team count, 44px rows, locks only when locked/focused or behind a switch. (/layout)

## Persona Red Flags
- Organizer handed the phone: can't tell saved vs on-screen, edited vs saved, whose combos; rebuild confirm doesn't mention the saved day.
- Casey: ~3,100px page, Suggestions at bottom, cross-screen two-tap swaps on 36px rows.
- Sam: swap state by colour/dashed border only, no spoken "picked" or busy text, "↔" read oddly.
- Alex: tab-flipping to compare; no apply-best shortcut; combos lost on reload.

## Minor Observations
- Plain links use browser default blue.
- "Show ratings from" vs "Ratings from" look and read alike.
- Setters summary and two hint lines wrap awkwardly on phones.
- Upgrade errors name supabase/scores.sql.
- "Team 1 · 5 players" beside 6 chips in Your own teams.

## Questions to Consider
- Should Save and Share image be one act?
- Do three options earn their place on a shared phone?
- Should organizers see 6 skill sums by default, or one verdict word?
