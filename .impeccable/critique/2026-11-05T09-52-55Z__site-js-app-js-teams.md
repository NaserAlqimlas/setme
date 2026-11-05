---
target: teams
total_score: 22
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:/Users/nasser/Documents/dev/setme/site/js/app.js#teams"
timestamp: 2026-11-05T09-52-55Z
slug: site-js-app-js-teams
---
Method: dual-agent (A: design review · B: detector, live CDP scans desktop/phone × light/dark, before/after build)

## Design Health Score
| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 2 | Results scroll under the sticky header (no scroll-margin); toasts last 1.8s |
| 2 | Match with the real world | 3 | "Combos", "Hus", weights footer are insider jargon |
| 3 | User control and freedom | 2 | Rebuilding silently discards swaps; undo only per swap |
| 4 | Consistency and standards | 2 | Two rater pickers behave differently; locks only after a swap |
| 5 | Error prevention | 2 | Date defaults to today, far from Save; Teams count fixed at 4 |
| 6 | Recognition rather than recall | 2 | Comparing three options from memory across ~4,000px on phone |
| 7 | Flexibility and efficiency | 3 | Strong swap hints/replace/drafts; no jump to build bar |
| 8 | Aesthetic and minimalist design | 2 | Actions, chips, instruction and skill rows repeated per option |
| 9 | Error recovery | 2 | Bare server messages in a short toast |
| 10 | Help and documentation | 2 | Switch explanations only in title tooltips |
| Total | | 22/40 | Acceptable |

## Design Specificity Verdict
Team cards, setter badges, totals, "Teammates again" and swap hints are volleyball-specific; the surrounding stack of settings cards is generic and ordered by data, not game day. Detector: Team 4 heading 2.7:1 (#c99400 on white, light only); avatar initials 3.4–4.2:1 on yellow-green/green hues (42 instances, aria-hidden, redundant with names); border-accent-on-rounded ×12 on team cards (team identity, judgement call); nested-cards ×8 and static dark-glow are false positives; overused-font Inter noted.

## Priority Issues
- [P1] Page order backwards for game day: Build teams ~2,400px down on phone. Fix: summary bar (playing, teams, setters, combos) + Build teams on top; fold Combos/Setters; options disclosure. /impeccable layout, distill
- [P1] Results land half-hidden (scrollIntoView app.js:713, :803 without scroll-margin); three expanded options, no recommendation. Fix: scroll-margin-top; option switcher; open on most even. /impeccable layout
- [P1] Saved state and date invisible; toast not aria-live (index.html:28); unsafe handover between organizers. Fix: persistent "Saved for <day>" line, date in header in words, date-named save button, live region. /impeccable harden, clarify
- [P2] Switch help hover-only (app.js:731); rebuild discards swaps without confirm. Fix: inline hints; confirm when swaps exist. /impeccable clarify
- [P2] Per-option repetition; Team 4 heading 2.7:1 light. Fix: actions once, page-level rater view, skill rows behind "Show numbers", darker Team 4 in light UI only. /impeccable distill, quieter

## Persona Red Flags
Organizer at the hall: no saved state, no link from "24 playing" to fix the list, stale Date, three options no recommendation, unclear which button players see.
Casey: Build teams far down; 32px 45%-opacity locks; Replace select truncated; no working indicator on swap.
Sam: toast not announced; swap ranks visual only; emoji locks; focus stays on button after build.
Alex: no jump to build bar; switch defaults not kept; combos reset on reload; no option comparison.

## Minor Observations
Empty playing list builds and fails with a server message; Teams count ignores headcount; ISO date; disabled Select all; subtitle leads with combos; no spinner on Building; swap hints often a dead end.

## Questions to Consider
Open on "24 playing tonight, matches WhatsApp?"; one best option plus "Show another"; skill sums hidden by default on a shared phone; shared image as the main output.
