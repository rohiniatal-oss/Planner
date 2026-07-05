# Full MECE Planner Review Run

Source of truth: `docs/codex_full_mece_planner_review_and_implementation_handover.md`.

Baseline for this run: `af5413c Clarify Today planning controls`.

Rule for this run: review outputs come before implementation. Imported prior fixes are treated as claims to verify, not proof of completion.

## Stage 0 - Product And User Modes

Required output:

| User mode | User need | Primary surface | Current friction | Required improvement | Priority |
|---|---|---|---|---|---|
| New user | Turn the Planner on, understand what setup changes, avoid accidental data loss | Home, Setup & automation menu, onboarding popup | Home has setup banner and Redo setup copy, but live-sheet retest is still required after repo sync | Verify first-run Home state and reset/backup path; keep setup language non-technical | P1 |
| Daily user | Know what needs attention and where to start | Home -> Today | Home section order is correct in `refreshHome`: setup/attention, Decisions, capture, Today, open applications, upcoming, utility refresh | Run Stage 8 Home cockpit test to prove Home does not contradict Today | P1 |
| Low-energy day | Adjust plan without understanding the engine | Today | `bootstrapToday` now shows Focus, Available minutes, Energy, and build/refresh helper notes | Verify rendered Today controls and whether low-energy wording is enough | P2 |
| Missed-days restart | Regain control without a backlog wall | Home, Today, Maintenance | Home can surface maintenance stale/weekly stale and Today can rebuild, but there is no dedicated "missed days" recovery framing yet | Decide whether Home warning plus Today rebuild is sufficient or needs a compact recovery cue | P2 |
| Application sprint | Capture jobs, plan application effort, submit, track response | Home capture, Jobs, Decisions, Tasks, Today | Prior ledger says application planning and response flows improved, but final checklist requires re-verification | Run Jobs/Application workflow lineage before more edits | P1/P2 |
| Interview sprint | Track round date, prep work, outcome, follow-up | Interviews, Tasks, Today, Home Upcoming | Prior ledger says prep is task-led; needs verification against current code and live surface | Run Interviews workflow lineage and Today prep readiness checks | P1/P2 |
| Networking day | Capture people and conversations without forced outreach | People, Conversations, Tasks, Today | Boundary is right in principle: discovered people stay Identified; follow-up work stays Tasks/Today, not Home Upcoming | Verify People/Conversations state machine and no task spam | P1/P2 |
| Source-led search day | Run opportunity/people scans and capture what was found | Tasks, popup capture, source tabs | Prior ledger says scan result routing exists; needs current-code verification | Run cross-tab workflow lineage for Opportunity scan and People source scan | P1/P2 |
| Weekly review | Keep active orgs/search loops alive | Maintenance trigger, Home, Tasks, Decisions, Orgs | Prior ledger says weekly summary appears on Home utility area | Verify weekly review heartbeat, generated tasks/decisions, and Home surfacing | P2 |
| Repair mode | Understand what is broken and what is safe to run | Home Needs attention, Maintenance menu, row Notes | Maintenance actions are clearer, but full data lifecycle inventory is still pending | Run Stage 3 destructive/refresh/repair inventory before more safety edits | P1 |
| Long-running search | Keep workbook usable after months of rows | All tabs, Maintenance | Full performance and stale-state review not complete | Run Stage 15 scale review after functional stages | P2 |

Stage 0 findings:

## Issue: Missed-days restart lacks a named recovery mode

Severity: P2

Stage: 0
Area: Product/user modes
Tab/surface: Home / Today / Maintenance
Column/function: `refreshHome`, `bootstrapToday`, `readMaintenanceHealth`

Evidence:
- Sheet evidence: Not live-tested in this pass.
- Code evidence: `refreshHome` can show stale maintenance/weekly review messages and Today links; `bootstrapToday` lets the user rebuild Today.
- User experience evidence: A returning user sees warnings and rebuild controls, but not a single "here is how to restart after missed days" product cue.

Current behaviour:
The pieces exist separately: Home warning, Today rebuild, Maintenance action.

Expected behaviour:
Returning after missed days should feel like a recovery path, not a set of unrelated warnings.

User impact:
The user may feel behind or unsure whether to repair, rebuild Today, or inspect source tabs.

Workflow impact:
Daily restart can become a source-tab hunt.

Data/integrity impact:
None directly.

Automation boundary:
L2 warning/navigation. Do not auto-reset or auto-close work.

Recommended fix:
- Code change: To be decided after Stage 8 Home cockpit review.
- Sheet/layout change: Possibly a compact Home action hint when maintenance is stale and Today is stale.
- Dropdown/header/copy change: Use recovery language only if it does not add dashboard noise.
- Repair/backfill: None yet.
- Guide update: Guide-last, document missed-days routine later.

Acceptance tests:
1. With stale maintenance and stale Today, Home gives one clear next action.
2. The action does not hide critical repair warnings.
3. The action routes to Today/Maintenance, not source tabs.

Do not do:
- Do not add a large missed-days dashboard.
- Do not auto-complete, reset, or defer work.

## Stage 1 - Surface Roles And Navigation

Required output:

| Surface | Current role | Target role | User action here | Should not do | Current gap | Fix |
|---|---|---|---|---|---|---|
| Home | Command centre and capture surface. `refreshHome` renders setup/trust, attention, Decisions, capture, Today state, open applications, upcoming, refresh utility. | Same: start here, decide, capture, see urgent state. | Start setup, decide, capture update, open Today, inspect critical warnings. | Raw dashboard or dense source table. | Needs live visual retest and Home/Today consistency proof. | Stage 8 Home cockpit review before new Home edits. |
| Today | Execution surface. `bootstrapToday` renders plan controls, build/refresh, committed/options table, Needs planning, Progress, End of day. | Same: do work now, adjust capacity, recover blocked work. | Change focus/minutes/energy, build/refresh plan, update task status, wrap up. | Backlog or capture surface. | Menu row movement labels are generic; visual retest still needed. | P3 copy fix can be batched after issue/user story. |
| Tasks | Work source of truth with task, status, readiness, blockers, priority, links. | Same: own task existence/readiness and planning detail. | Inspect/repair/sequencing, not daily default execution. | Judgement queue or Home replacement. | Helper fields may feel backend-heavy; no visual-weight review yet. | Stage 7/12 Tasks pass. |
| Decisions | Judgement queue and audit. Home shows active top queue; Decisions stores full context/result. | Same: judgement/audit, not work execution. | Decide Yes/No, audit result. | Task table. | Need verify every action type is truthful and popup decisions stay pending until success. | Stage 9 Decisions vs Tasks pass. |
| Sectors | Durable search-space records. | Broad/narrow search universe records. | Maintain taxonomy and exploration status. | Daily operating surface. | Parent/sub-sector examples and lineage still need final checklist review. | Stage 4 column lineage and Stage 6 sector workflows. |
| Organisations | Durable target-universe records. | Org classification/status/review record. | Maintain org identity, sector, status, review state. | CRM dashboard or daily queue. | Review cadence may be hidden; Active/Dormant behaviour needs re-verification. | Stage 4/5/6 org review. |
| Jobs | Durable opportunity/application record. | Application state/source of truth. | Capture opportunity, application status/result, linked people. | Own application execution tasks. | Status/result/response model needs re-verification against final checklist. | Stage 4/5/6 Jobs pass. |
| People | Durable relationship record. | Person identity, source, relationship status, next action helpers. | Track relationship state and context. | Force outreach from discovery. | People/Conversations combined flow needs final checklist verification. | Stage 4/5/6 People pass. |
| Conversations | Interaction history and outcome router. | Log scheduled/completed/cancelled interactions and route follow-up. | Record what happened and outcome. | Replace People or Tasks. | Manual log could feel like operating surface if outcomes unclear. | Stage 4/5/6 Conversations pass. |
| Interviews | Round/prep/outcome record. | Track interview schedule, prep routing, outcome/follow-up. | Maintain round status and outcome. | Store hidden prep plan instead of task-led prep. | Prep plan must be verified as tasks, not buried notes. | Stage 4/6 Interviews pass. |
| Guide | Product manual. | Explain stable behaviour last. | Self-serve help after UI is stable. | Substitute for clear UI. | Current `rewriteGuide` may lag behaviour; user asked Guide last. | Stage 14 after behaviour settles. |

Stage 1 findings:

## Issue: Today row movement menu labels are too context-dependent

Severity: P3

Stage: 1
Area: Surface roles and navigation
Tab/surface: Today menu
Column/function: `buildMenu`

Evidence:
- Sheet evidence: Not live-tested in menu.
- Code evidence: `buildMenu` labels are `Move selected row up` and `Move selected row down` inside the Today submenu.
- User experience evidence: The actions only work meaningfully for Today rows, but the label relies on submenu context.

Current behaviour:
The Today submenu uses generic row movement labels.

Expected behaviour:
Visible actions should name the surface or outcome when detached from the sheet context.

User impact:
Minor ambiguity.

Workflow impact:
None on data flow.

Data/integrity impact:
None.

Automation boundary:
L1/L4 visible execution control.

Recommended fix:
- Code change: Rename to `Move selected Today row up` and `Move selected Today row down`.
- Sheet/layout change: None.
- Dropdown/header/copy change: Menu copy only.
- Repair/backfill: None.
- Guide update: Not needed until Guide-last, if at all.

Acceptance tests:
1. The Today submenu names the selected Today row in movement actions.
2. The functions called remain `moveTodayRowUp` and `moveTodayRowDown`.
3. No schema, dropdown, onEdit, or Today selection logic changes.

Do not do:
- Do not change row movement behaviour.
- Do not add more menu actions.

## Initial Implementation Backlog

| Issue | Severity | Stage | User impact | Dependency | Batch | Acceptance tests |
|---|---|---|---|---|---|---|
| Today row movement menu labels are too context-dependent | P3 | 1/12 | Minor menu ambiguity | None | Batch 5 UX/copy | Menu labels change only; functions unchanged |
| Missed-days restart lacks a named recovery mode | P2 | 0/8/11 | Returning user may not know next safe action | Home cockpit + observability review | Batch 2 or 5, depending on finding | Home stale-state scenario has one clear next action |
| Home/Today live visual retest still pending | P1/P2 | 1/8/13 | Trust depends on rendered state matching code | Live sheet or Apps Script sync | Batch 2 | Home ready/not-built/stale states verified |

Next required stage before broader code:
Stage 2 data integrity, identity, and trust, unless the user chooses to implement the tiny P3 Today menu copy item as a scoped Batch 5 fix.
