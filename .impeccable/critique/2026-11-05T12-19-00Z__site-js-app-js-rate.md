---
target: "site/js/app.js#rate"
total_score: 26
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:/Users/nasser/Documents/dev/setme/site/js/app.js#rate"
timestamp: 2026-11-05T12-19-00Z
slug: site-js-app-js-rate
---
# Critique: Rate (site/js/app.js#rate), 26/40
Method: dual-agent (live design review over CDP at 1200 and 390, light and dark, rater, new rater and super; detector across 4 live states)

Scores: status 2, real world 3, control 3, consistency 3, error prevention 2, recognition 2, flexibility 3, minimal 2, recovery 3, help 3.

- P1 One tap counts a player as rated (byPlayer.has), and Not rated yet then hides half-done players. Fix: count a player when all skills are answered; show 4/7 on the card.
- P1 Unanswered rows show U already pressed, same as a deliberate don't know. Fix: nothing pressed until answered (needs a way to tell blank from U).
- P2 Finding who is left on a phone: ~21 screens, Worth a fresh look names are not tappable, legend scrolls away. Fix: tappable names, sticky next-unrated with progress, maybe one-player-at-a-time on phones.
- P2 Guide sheet takes 48vh on phones; Saved toast fires on every tap (~180 per batch) over it. Fix: shorter sheet; quiet tick on the row instead of toast.
- P3 Weighted unexplained; super told only the site owner sees ratings; .5 average/consistent blurs with Consistency skill; Worth a look vs Worth a fresh look; Playing badge 4.0:1.
Working: rating guide jumps to the tapped skill with concrete volleyball rubric; anchors first for new raters; failed saves roll back.
