---
target: "site/js/app.js#players"
total_score: 21
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:/Users/nasser/Documents/dev/setme/site/js/app.js#players"
timestamp: 2026-11-05T12-19-00Z
slug: site-js-app-js-players
---
# Critique: Players (site/js/app.js#players), 21/40
Method: dual-agent (live design review over CDP at 1200 and 390, light and dark, super and org; detector across 3 live states)

Scores: status 2, real world 3, control 2, consistency 2, error prevention 2, recognition 2, flexibility 2, minimal 2, recovery 2, help 2.

- P1 Paste preview never names who gets dropped: Set playing list (3) unticks 21 others with one tap, no confirm, no undo. Fix: show added and removed names before the button; Undo after.
- P1 Unknown names are a dead end for organizers (only the super can add). Fix: Match to... picker on each unknown chip; skip heading lines; read +1 as a guest.
- P2 No way to see who is playing: count only, 26 alphabetical cards. Fix: compact playing list or Playing filter at top.
- P2 Heavy cards (~9 controls each, ~8 phone screens); the name is an always-live input that can save blank. Fix: read-only name with edit; denser rows.
- P3 Add player above the main task for the super; loose Anchor note; setter rule buried under the grid; Playing badge contrast 4.0:1; placeholder contrast 3.4:1 in dark.
Working: paste parser handles numbering, emoji, nicknames and a Waitlist section; nothing changes until confirm; dark mode solid.
