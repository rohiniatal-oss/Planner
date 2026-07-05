# Full MECE Planner Review Run

Source of truth: `docs/codex_full_mece_planner_review_and_implementation_handover.md`.

Baseline for this restarted run: `e3c9dc3 Clarify Today row movement menu labels`.

Rule for this run: review outputs come before implementation. Imported prior fixes are treated as claims to verify, not proof of completion.

Restart note:
The review was explicitly restarted from the beginning after the user asked to "start from the beginning again." Stage 0 is the active review point. Later sections in this file from earlier passes are retained as historical notes until they are re-run in order.

## Stage 0 - Product And User Modes (Restarted)

Required output:

| User mode | User need | Primary surface | Current friction | Required improvement | Priority |
|---|---|---|---|---|---|
| New user | Turn the Planner on, understand setup, and avoid accidental data loss | Home, Setup & automation menu, onboarding popup | `refreshHome` has a trigger banner and `runSetupInterview` has backup-before-reset UI, but the live sheet may lag repo code until Apps Script is updated | Verify first-run Home state, trigger-off state, setup popup, and reset/backup path before declaring onboarding solved | P1 |
| Daily user | See what needs attention and start work without visiting source tabs | Home -> Today | `refreshHome` gives Decisions, capture, Today state, open applications, upcoming, and utility refresh; still needs live Home/Today consistency proof | Stage 8 must prove Home never says Not built when Today has a current usable plan | P1 |
| Low-energy day | Adjust the plan to a realistic day | Today | `bootstrapToday` now explains Focus, Available minutes, Energy, and build/refresh effects; low-energy/minimum-day cue needs rendered-sheet review | Stage 7 must test whether low capacity/low energy creates clear enough Today feedback without adding dashboard noise | P2 |
| Missed-days restart | Regain control after not using the Planner for a few days | Home, Today, Maintenance | `readMaintenanceHealth` can surface stale daily/weekly automation and Today can rebuild, but the product path is not named as a recovery mode | Decide after Stage 8/11 whether Home needs a compact "restart today" cue or whether existing maintenance/Today cues are enough | P2 |
| Application sprint | Move from opportunity to application plan to submission to response tracking | Home capture, Jobs, Decisions, Tasks, Today | Prior ledger says application planning exists, but final checklist requires proof from current `Code.gs` and scenarios | Re-run Jobs/Application workflow lineage before changing application logic | P1/P2 |
| Interview sprint | Track interview date, prep plan, outcome, and follow-up | Interviews, Tasks, Today, Home Upcoming | Prior ledger says prep is task-led; current code evidence must prove prep is not buried in notes | Re-run Interviews workflow lineage and Today prep-readiness checks | P1/P2 |
| Networking day | Capture people and conversations without forced outreach | People, Conversations, Tasks, Today | Product boundary looks right: discovery should not auto-create outreach; needs state-machine verification | Re-run People/Conversations state machine and no-task-spam checks | P1/P2 |
| Source-led search day | Run opportunity/people scans and capture findings | Tasks, capture popups, source tabs | Prior ledger says source-led result routing exists; needs current-code proof and no-spam verification | Re-run Opportunity scan and People source scan lineage | P1/P2 |
| Weekly review | Keep active search loops alive without manual remembering | Maintenance trigger, Home, Tasks, Decisions, Organisations | `weeklyReviewImpl` records a summary and refreshes Home/Today; need verify generated work is right-sized and visible | Stage 11 must verify heartbeat, summary, and active-empty org routing | P2 |
| Repair mode | Know what is broken, what is safe, and what might change data | Home Needs attention, Maintenance menu, row Notes | Maintenance labels are clearer, but the full refresh/repair/reset/snapshot inventory is not complete | Stage 3 must inventory all clearing/rebuilding functions before more safety edits | P1 |
| Long-running search | Stay usable after months of data | All tabs, Maintenance | Performance review has not been run against the final checklist scale assumptions | Stage 15 must review 500 tasks / 200 people / 150 orgs / 100 jobs / 50 interviews / 500 conversations | P2 |

Stage 0 evidence map from current code:

| Evidence area | Current code evidence | What it proves | What it does not prove |
|---|---|---|---|
| Canonical surfaces | `SHEET_TO_HEADER_KEY`, `CANONICAL_TAB_ORDER`, `ZONE_WORK_TABS`, `ZONE_DATA_TABS`, `ZONE_REF_TABS` | The workbook architecture is explicit in code: Home/Today/Decisions/Tasks first, source tabs next, Guide last | Does not prove rendered tabs are clear |
| Home user modes | `refreshHome`, `collectHomeAttentionItems`, `todayPlanCounts`, `collectOpenApplications`, `collectUpcomingItems` | Home is intended as command centre, not raw dashboard | Needs live visual/state test |
| Today user modes | `bootstrapToday`, `stagedTodaySelection`, `collectNeedsPlanningTasks`, end-of-day section | Today is intended as execution/capacity/recovery surface | Needs Stage 7 readiness/capacity edge tests |
| Setup and reset safety | `runSetupInterview`, `completeSetupFromPopup`, `resetPlannerDataForOnboarding`, backup copy path | New-user and redo-setup flows are designed with backup-before-clear | Needs Stage 3 destructive-action inventory and live popup test |
| Weekly/restart support | `readMaintenanceHealth`, `weeklyReviewImpl`, `dailyMaintenance`, Home maintenance messaging | The system has heartbeat and stale-maintenance signals | Does not yet create a named missed-days recovery experience |
| Guide-last | Final checklist source-of-truth rule plus existing `rewriteGuide` presence | Guide is recognized as documentation surface | Guide content may still lag; update only at Stage 14 |

Stage 0 questions:

| User mode | Trying to do | Likely mental state | Should show first | Should be hidden | System may infer | Must remain user judgement | Next safest action |
|---|---|---|---|---|---|---|---|
| New user | Start safely | Unsure, cautious about permissions/data | Setup status and one clear setup action | Source tabs, helper columns, maintenance internals | Whether trigger is missing; whether existing rows make reset risky | Whether to clear existing data; whether to save backup | Turn on Planner actions, then run setup |
| Daily user | Decide and work | Wants momentum, low tolerance for stale state | Critical warnings, pending decisions, Today state | Raw task/source metrics | Current Today state, open decisions, scheduled/waiting items | Whether to accept decisions or change plan | Open Today or resolve top decision |
| Low-energy day | Reduce plan | Tired, wants a realistic minimum | Today controls and capacity headline | Full backlog | Fit work to minutes/focus/energy | Whether to lower capacity or skip/defer work | Change minutes/energy, build/refresh Today |
| Missed-days restart | Recover control | Behind, anxious about stale planner | Compact health/restart cue | Detailed logs unless repair needed | Stale maintenance/weekly review, stale Today | Whether to repair now or just rebuild Today | Run required maintenance or rebuild Today |
| Application sprint | Get application out | Deadline-focused | Application plan/status and next task | Generic job metrics | Deadline priority, response check timing | Whether to apply, referral effort, final submission details | Use application plan / Today task |
| Interview sprint | Prepare and follow up | High stakes, time-sensitive | Interview date, prep tasks, Today readiness | Hidden prep tags | Prep timing and follow-up reminders | Prep depth, outcome, whether to continue/decline | Open Today prep or Interviews row |
| Networking day | Capture/contact appropriately | Social judgement, avoiding spam | Identified people/conversation next action | Automatic outreach suggestions | Known org/person links, follow-up dates | Whether to reach out and what to say | Capture person/conversation, then decide outreach |
| Source-led search day | Search broadly and capture finds | Exploratory | Source-led task and result capture | Outreach/application task spam | Save found orgs/jobs/people as records | Which leads are worth pursuing | Complete scan task and capture findings |
| Weekly review | Keep loops alive | Strategic, periodic | Summary and routed decisions/tasks | All raw stale data | Active empty orgs, stale keep-warm | Whether to pursue, pause, or ignore | Review generated decisions/tasks |
| Repair mode | Restore trust | Concerned about data safety | What is broken and safe action | Implementation names/logs | Invalid values, duplicates, orphan links | Whether to run repair/reset/restore | Run safe repair or snapshot before destructive action |
| Long-running search | Keep system fast and understandable | Maintenance-minded | Health summaries and calm source tabs | Excess helper noise | Stale state and performance hotspots | What to archive/retire | Maintenance, then source-tab cleanup |

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

## Selected Implementation Batch - Batch 5 UX/Copy

Implementation item: Today row movement menu labels are too context-dependent.

User story:
As a user using the Planner menu, when I want to move work within Today's plan, I need the menu action to say it moves a Today row, so that I do not have to infer the target from submenu context.

Current pain:
The menu labels say `Move selected row up` and `Move selected row down`, which are technically inside the Today submenu but still rely on context.

Target experience:
The labels say `Move selected Today row up` and `Move selected Today row down`.

Automation level:
L1/L4 visible execution control copy. No automation behaviour changes.

Implementation scope:
Change only the two labels in `buildMenu`.

Acceptance test:
1. The Today submenu labels include `Today row`.
2. The functions called remain `moveTodayRowUp` and `moveTodayRowDown`.
3. No schema, dropdown, onEdit, or Today selection logic changes.

Non-goals:
- Do not change row movement behaviour.
- Do not add new menu items.
- Do not update the Guide yet.

Next required stage before broader code:
Stage 2 data integrity, identity, and trust, unless the user chooses to implement the tiny P3 Today menu copy item as a scoped Batch 5 fix.
