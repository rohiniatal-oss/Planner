# Product Management and UX Pass

Source: `codex_product_management_ux_improvement_system_plan.md`.

North-star question:
Does this make the job hunt easier to understand, decide, execute, and recover from?

## Pass 1 - User Modes

| User mode | User need | Current support | Gap | Product fix |
|---|---|---|---|---|
| New user setting up | Know what to turn on and what setup changes | Home setup card, trigger banner, onboarding popup | Setup/automation wording can still feel technical | Use product language: setup, edit actions, daily/weekly automation |
| Daily user deciding what to do | Start from Home, then Today | Home shows decisions, Today state, capture, apps, upcoming | Home must not point to execution before Today exists | State-aware Today action on Home |
| Capturing job/person/interview | Fast guided capture | Home Capture update and menu popups | Capture route must stay obvious without tab knowledge | Keep Home/menu labels intent-shaped |
| Complex application | Plan effort before tasks | Application plan popup and tasks | Keep referral/application subtasks from becoming spam | Continue workflow review in Category 3 |
| Interview burst | See date, prep, outcome | Interviews + prep tasks + Home Upcoming | Prep state should be visible through tasks, not extra status columns | Keep prep as routed work |
| Networking | Capture people without forced outreach | People/source scan flow | Follow-up work belongs in Tasks/Today, not Home clutter | Keep Home Upcoming to scheduled/waiting items |
| Waiting for responses | Know what is waiting and stale | Jobs response checks, Home open apps/upcoming | Home labels must not contradict Today or Jobs | Category 4 retest |
| Repairing messy data | See what is broken and recovery path | Home Needs attention, repair flags | Recovery copy must point to the right surface | Keep contextual Home action hints |
| Returning after missed days | Regain control without backlog wall | Maintenance summary, Today rebuild | Needs live retest after PM copy changes | Category 0/4 visual retest |
| Low-energy day | Do a realistic minimum day | Today capacity and options | Home should funnel to Today, not source tabs | Preserve Home -> Today boundary |

## Pass 2 - Core Journeys

| Journey | User goal | Current path | Friction | Target experience | Priority |
|---|---|---|---|---|---|
| First day / setup | Start safely | Home -> setup popup -> tasks | "Triggers" and "reset" concepts can feel unsafe | User sees setup/edit actions/daily automation, with backup before clear | P1 |
| Daily 10-minute review | Decide and work | Home -> Decisions/Today | Home can look stale if Today state copy is wrong | Home tells whether to open/build Today or start work | P1 |
| Capture a job | Add opportunity | Home Capture update -> popup | Direct tab path remains possible but less guided | Popup-first normal path, tabs as records | P2 |
| Decide whether to apply | Preserve judgement | Job/app status -> Decision/popup/tasks | Needs continued Category 3 review | Decision says what Yes does | P1/P2 |
| Plan application | Create right work | application planning popup -> tasks | Avoid task spam and hidden referrals | Create tasks only after user classifies effort | P1 |
| Waiting response | Track waiting | Jobs result/check loops -> Home | Response state must stay legible | Open applications and Upcoming agree | P1/P2 |
| Interview prep | Build prep plan | Interview -> prep plan task -> popup | Legacy labels still exist | Tasks carry prep work; Guide/header later | P2/P3 |
| Source-led people scan | Discover contacts | Task -> result popup -> People | Must not create outreach automatically | Identified only unless user chooses outreach later | P1 |
| Repair broken data | Recover trust | Home warning -> Maintenance/Tasks | Warning without precise next action is bad | Home says repair vs task recovery path | P1 |

## Pass 3 - Surface Roles

| Surface | Product role | Primary user question | Main action | Should not do | Current UX gap | Fix |
|---|---|---|---|---|---|---|
| Home | Command centre | What needs attention and where do I start? | Decide, capture, open/build Today | Dense dashboard, raw tables | Today action must be state-aware | In progress |
| Today | Execution surface | What can I actually do now? | Do, block, defer, finish | Backlog/capture surface | Needs visual retest | Pending |
| Tasks | Work source of truth | Why is work ready/blocked/waiting? | Inspect/repair/sequence | Daily default | Helper fields are powerful but backend-ish | Category 3/5 |
| Decisions | Judgement queue | What happens if Yes/No? | Decide or audit | Task list | Must keep action type truthful | Retest |
| Source tabs | Records | What is true about this object? | Inspect/repair records | Daily navigation | Headers/copy need final pass | Category 5 |
| Guide | Operating manual | How do I use this safely? | Self-serve help | Hide UX problems | Defer until behavior settles | Guide-last |

## Pass 4 - UX Scorecard

| Surface | First impression | Cognitive load | Visual hierarchy | Scanability | Affordance | Feedback | Empty states | Recovery | Main UX fix |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| Home | 4 | 3 | 4 | 4 | 3 | 4 | 4 | 4 | Make Today action state-aware and keep warnings compact |
| Today | 4 | 3 | 4 | 4 | 4 | 4 | 3 | 4 | Retest over/under-capacity and Needs planning |
| Tasks | 3 | 2 | 3 | 3 | 3 | 3 | 3 | 4 | De-emphasise backend helper semantics later |
| Decisions | 3 | 3 | 3 | 3 | 3 | 3 | 3 | 3 | Keep Home cards plain and action-specific |
| Source tabs | 3 | 2 | 3 | 3 | 3 | 3 | 3 | 3 | Header/column copy pass later |

## Pass 5 - Prioritised Issues

| Issue | Category | Severity | User impact | Proposed phase |
|---|---|---|---|---|
| Home Today action says Start working when Today is not built | Navigation / Trust | P1/P2 | User sees stale-looking Home and does not know how to build Today | Phase 1 |
| Setup and automation wording exposes trigger mechanics | Orientation / Trust | P2 | First-run recovery feels technical | Phase 1 |
| Home/Today visual retest pending | Trust | P1/P2 | Code may be correct but visible state may still feel wrong | Phase 1 |
| Legacy workflow/header labels remain | Documentation / Visual design | P3 | Confusion after behavior changes | Phase 5 |
| Snapshot/reset/repair distinction not fully productised | Recovery / Trust | P1 | User may not know what is safe or reversible | Phase 1/6 |

## Current Improvement: Home Today State

User story:
As a daily user, when Home says Today's plan is not built, I need Home to send me to the correct next action, so that I do not think the planner is stale or that I should start working without a plan.

Current pain:
Home could show "Not built yet" and still label the link "Start working", with a Guide nudge that does not solve the immediate operating problem.

Target experience:
If Today is not built, Home says "Open Today to build plan" and the helper line says to tick "Build / refresh Today's plan" on Today. If Today is built but has no committed tasks, Home says "Open Today" and explains options or available minutes. "Start working" appears only when committed work exists.

Implementation:
Only Home copy/link text changes inside `refreshHome`; no schema, cascade, or Today selection change.

Acceptance tests:
1. With no Today plan built, Home shows "Not built yet" and the action "Open Today to build plan".
2. With Today built and zero committed tasks, Home shows "Open Today" and references options/available minutes.
3. With Today built and committed tasks, Home shows "Start working".
4. Home does not add a new dashboard section or extra metrics.

Non-goals:
- Do not make Home run Apps Script from a hyperlink.
- Do not add people follow-up task lists to Home.
- Do not redesign Today in this change.
