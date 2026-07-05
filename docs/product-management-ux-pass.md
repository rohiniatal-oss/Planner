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
| Sectors | Search-space record | What broad/narrow markets am I exploring? | Maintain taxonomy and exploration state | Daily execution | Parent/sub-sector model is not self-explanatory | Category 5 examples/copy |
| Organisations | Target-universe record | Which orgs are mapped, active, dormant, or need review? | Maintain target status and classification | Become a CRM dashboard | Review cadence is mostly hidden in helper dates | Category 3/4 review-state surfacing |
| Jobs | Opportunity/application record | What is this opportunity's application state? | Track deadline, status, contacts, result | Own application task execution | Status/result/waiting model must stay intuitive | Category 3 journey retest |
| People | Relationship pipeline record | Who is this person and what relationship action exists? | Track relationship source/status and next action | Force outreach from discovery | Relationship status still needs careful UX review | Category 3 People journey retest |
| Conversations | Interaction history | What happened, with whom, and what follow-up did it create? | Log interaction/status/outcome | Replace People or Tasks | Manual log can feel like another operating surface | Category 3 People/Conversations retest |
| Interviews | Round/prep record | What interview is scheduled, what prep/outcome is needed? | Track date/status/outcome/follow-up | Store prep plan as extra columns | Prep must flow through Tasks, not hidden notes | Category 3 interview-prep retest |
| Guide | Operating manual | How do I use this safely? | Self-serve help | Hide UX problems | Defer until behavior settles | Guide-last |

## Pass 3A - Tab-by-Tab Product Lens

Grounded in current `HEADERS` / `MANUAL_COLUMNS` from `Code.gs`.

| Tab | Top 3 visible fields for the user | Manual inputs | Product risk | Category 0 judgement |
|---|---|---|---|---|
| Home | Needs attention, Pending Decisions, Today's plan | checkboxes/dropdowns only | Can become dashboardy or contradict Today | Keep compact; action copy must route to the next operating surface |
| Today | Task, estimated minutes, Status/Why | execution status and notes | Can become a backlog if non-ready work leaks in | Preserve executable-only boundary; review no-fit/option wording |
| Decisions | Suggested action, Decision, Result | Decision and context notes | Can look like a task list if Yes is vague | Keep action type truthful and Home cards plain |
| Tasks | Task, Status, Ready for Today | status, due/time, blocker/planning fields | Helper columns can feel like backend machinery | Needs visual/copy pass, but not a Home replacement |
| Sectors | Sector, Sub-sector, Status | Sector/Sub-sector/status/notes | Parent/child taxonomy can confuse users | Add examples/copy later; keep records calm |
| Organisations | Organisation, Sector/Sub-sector, Status | org name, classification, tier/status/notes | Status meaning and next review can be invisible | Review Active/Dormant/Next check flow in Category 3/4 |
| Jobs | Opportunity, Organisation, Application status | opportunity/org/status/deadline/result/notes | Application result vs status can feel like two states | Continue Jobs journey review before more UX changes |
| People | Name, Relationship source/status, Next action | name/org/role/source/status/follow-up/conversation/notes | Relationship status must not over-automate outreach | Review relationship lifecycle as product flow |
| Conversations | Date, Person, Interaction status/outcome | date/person/type/status/notes/outcome | Can duplicate People if its role is unclear | Keep as history plus outcome router |
| Interviews | Job, Interview date, Status/outcome | round/date/status/outcome/follow-up/notes | Prep can be buried if not task-led | Keep prep work in Tasks; retest prep tasks |
| Guide | Setup, daily routine, repair/troubleshooting | n/a | Can become a bandage for unclear UX | Update last after behavior settles |

## Pass 4 - UX Scorecard

| Surface | First impression | Cognitive load | Visual hierarchy | Scanability | Affordance | Feedback | Empty states | Recovery | Main UX fix |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| Home | 4 | 3 | 4 | 4 | 3 | 4 | 4 | 4 | Make Today action state-aware and keep warnings compact |
| Today | 4 | 3 | 4 | 4 | 4 | 4 | 3 | 4 | Retest over/under-capacity and Needs planning |
| Tasks | 3 | 2 | 3 | 3 | 3 | 3 | 3 | 4 | De-emphasise backend helper semantics later |
| Decisions | 3 | 3 | 3 | 3 | 3 | 3 | 3 | 3 | Keep Home cards plain and action-specific |
| Sectors | 3 | 3 | 3 | 3 | 3 | 3 | 3 | 3 | Explain sector/sub-sector relationship |
| Organisations | 3 | 2 | 3 | 3 | 3 | 3 | 3 | 3 | Clarify status and review loop |
| Jobs | 3 | 3 | 3 | 3 | 3 | 4 | 3 | 3 | Retest status/result/deadline flow |
| People | 3 | 2 | 3 | 3 | 3 | 3 | 3 | 3 | Retest relationship source/status lifecycle |
| Conversations | 3 | 3 | 3 | 3 | 3 | 3 | 3 | 3 | Clarify history vs action routing |
| Interviews | 3 | 3 | 3 | 3 | 3 | 4 | 3 | 3 | Retest prep/outcome flow |
| Guide | 3 | 3 | 3 | 3 | n/a | n/a | n/a | 3 | Rewrite after behavior settles |

## Pass 5 - Prioritised Issues

| Issue | Category | Severity | User impact | Proposed phase |
|---|---|---|---|---|
| Home Today action says Start working when Today is not built | Navigation / Trust | P1/P2 | User sees stale-looking Home and does not know how to build Today | Phase 1 |
| Setup and automation wording exposes trigger mechanics | Orientation / Trust | P2 | First-run recovery feels technical | Phase 1 |
| Home/Today visual retest pending | Trust | P1/P2 | Code may be correct but visible state may still feel wrong | Phase 1 |
| Legacy workflow/header labels remain | Documentation / Visual design | P3 | Confusion after behavior changes | Phase 5 |
| Snapshot/reset/repair distinction not fully productised | Recovery / Trust | P1 | User may not know what is safe or reversible | Phase 1/6 |
| Source tabs not yet reviewed through PM/UX lens | Orientation / Workflow | P1/P2 | Fixes could overfit Home/Today while tab flows remain confusing | Phase 1/3 |
| Header hints still expose backend wording | Orientation / Visual design | P2 | Source tabs feel like storage tables instead of calm records | Phase 1 |
| Jobs response columns read like duplicate states | Workflow / Trust | P2 | User may not know whether to edit Response received or Application result | Phase 1/3 |
| Maintenance menu exposes implementation terms | Navigation / Trust | P2 | User must translate legacy migration, commitment classes, and all columns into planner actions | Phase 1 |

## Pass 6 - Trust and Transparency

| Trust issue | Where | Current behaviour | Why it harms trust | Fix | User-facing copy |
|---|---|---|---|---|---|
| Home can contradict Today | Home / Today | Home reads Today summary and build state | A mismatch makes the planner feel stale | State-aware Home Today action; visual retest still needed | Open Today to build plan / Start working only when committed work exists |
| Broken source links can look executable | Tasks / Today / Home | Helper checks mark broken/terminal links as Needs planning | False-ready work wastes daily capacity | Keep Today exclusion and Home attention | Needs attention / source repair |
| Decisions can hide real action | Home / Decisions | Decision action type and router say what Yes does | Generic Yes creates anxiety | Keep action-specific cards and router | What Yes will do |
| Source tabs can look like backend tables | All data tabs | Header hints and hidden fields explain ownership | Users may edit helper state or avoid tabs entirely | Header guidance copy pass | Filled automatically / Prefer Home capture / work from Today |
| Repair/refresh/reset can blur together | Maintenance / setup | Some safe actions now labelled safe; reset has backup option | Users may fear losing data or skip repair | Category 6 data lifecycle pass | Refresh derived data (safe), backup before clear |
| Popups can fail silently | Capture / planning popups | Validation returns inline messages | Silent failure loses confidence | Keep popup validation; later live retest | Could not save / required field copy |

## Pass 7 - Continuous Product Metrics

| Product metric | Why it matters | How to observe in workbook | Improvement lever |
|---|---|---|---|
| Tabs needed for daily use | Daily user should not need source tabs to know what to do | Home/Today route completeness | Keep Home and Today as operating surfaces |
| Ambiguous visible labels | Ambiguity creates hesitation | Menu/header/cell copy scans | Category 0/5 copy passes |
| Ready vs blocked task count | Today should show executable work only | Tasks Ready for Today, Today Needs planning | Category 2 daily execution checks |
| Pending decisions with stale/missing source | Home must not ask impossible decisions | Decision helper backfill and Home queue | Category 1 trust checks |
| Open applications waiting | User should know what is waiting | Jobs response fields, Home open applications/upcoming | Category 4 Home cockpit checks |
| Upcoming interviews/conversations | Scheduled work should not be missed | Home Upcoming, Interviews, People conversation dates | Category 4 surfacing checks |
| Invalid dropdown / duplicate ID rows | Data health affects all routing | Repair/maintenance scans and Home attention | Category 1 trust/data safety |
| Manual fields per popup | Capture should ask only what matters now | Popup definitions and conditional sections | Category 3 workflow/capture review |
| Context switches per core journey | Too many tab hops break flow | Journey maps | Product-led acceptance tests |

Product review cadence:

| Cadence | Review focus | Owner surface |
|---|---|---|
| Daily | Home/Today trust, decisions, executable work, blocked recovery | Home / Today |
| Weekly | waiting applications, interviews, networking, active org review | Home / Tasks / source tabs |
| Monthly | source mix, dormant/active orgs, stale tags, large-sheet performance | Source tabs / Maintenance |
| After each feature | Journey regression and UX copy review | Product docs + code checks |

## Pass 8 - Implementation Readiness Gates

| Improvement | Target experience | Code/sheet changes | Guide changes | Acceptance tests | Non-goals |
|---|---|---|---|---|---|
| Home Today state | User knows whether to build/open/start Today | `refreshHome` copy/link logic | Later Guide wording if needed | no-plan, zero-commit, committed-work states | Do not make Home run scripts by hyperlink |
| Header hints | Every tab explains field ownership | `HEADER_GUIDANCE`, `userFacingHeaderHint` | Later column dictionary | guidance coverage, rendered-hint scan | Do not change schemas/visibility |
| Jobs response clarity | Submitted application response columns are understandable | Jobs header copy | Later application workflow section | Response received and result hints | Do not rename columns yet |
| Maintenance menu clarity | Safe maintenance actions are understandable | menu labels, toasts, menu wrapper | Later troubleshooting section | menu labels, parse, duplicate function check | Do not change priority rules |
| Data lifecycle | Snapshot/reset/repair/refresh/restore are distinct | Category 6 safety layer | Guide repair/recovery section | destructive guard, snapshot, status | Do not blur reset and refresh |
| Source-tab workflow clarity | Source tabs stay records, not daily surfaces | Category 3/5 by-tab review | Guide examples last | column-flow review per tab | Do not add dashboard columns without action |

Category 0 readiness rule:
No further code change should be accepted only because it is technically correct. It must identify user problem, target experience, acceptance tests, and non-goals first.

Visible-action readiness rule:
For every menu item, checkbox, link, row action, popup entry, and visible helper action, run the same product test:
1. Why would the user need to see this?
2. What decision, recovery path, or outcome does it support?
3. If it is removed from the surface, does anything important become impossible?
4. If it stays, is the label written in user outcome language?

If the action is not needed directly, remove it from the user surface or fold it into Repair all tabs / automation. If it is needed, keep it and rename it until a first-time user can infer what will happen.

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

## Current Improvement: Workbook Header Hints

User story:
As a user scanning any tab, I need the column hints to tell me what the field means and whether I should edit it, so that I can use source tabs as records without understanding backend mechanics.

Current pain:
Several column hints used system wording such as "system link", "auto/manual", "master task queue", or terse status lists. That makes the workbook feel like a backend table and increases the chance of editing helper fields or misunderstanding a workflow.

Target experience:
Every tab's header hints use user-facing language: filled automatically, updates from linked rows, this does not create tasks by itself, work from Today, and tasks handle the actual work.

Implementation:
Copy-only changes to `HEADER_GUIDANCE` and existing `userFacingHeaderHint()` overrides. No schemas, dropdowns, cascades, formulas, or hidden-column rules changed.

Acceptance tests:
1. Header guidance still has one entry for every header.
2. Apps Script parses successfully.
3. Duplicate function invariant remains clean.
4. Sectors, Organisations, People, Jobs, Conversations, Tasks, Interviews, Today, and Decisions have user-facing hints that explain role/ownership.

Non-goals:
- Do not rewrite the Guide yet.
- Do not change column order or visibility in this pass.
- Do not change workflow routing or task creation.

## Current Improvement: Jobs Response Column Clarity

User story:
As a user looking at a submitted application, I need to know whether "Response received" or "Application result" is the right field to touch, so that I can record waiting, rejection, or interview invite without guessing.

Current pain:
The copy made `Response received` sound purely automatic even though setting it to Yes opens the result path. `Application result` also did not say it belongs after submission.

Target experience:
`Response received` says that Yes records a result and Waiting keeps it as No. `Application result` says it is only for submitted applications.

Implementation:
Header guidance copy only; no dropdown, status, popup, or routing behavior changed.

Acceptance tests:
1. Jobs header hint for Response received explains Yes as the result-recording path.
2. Jobs header hint for Application result says it is used after Submitted.
3. Existing onEdit Jobs response/result routing remains unchanged.

Non-goals:
- Do not rename columns in this pass.
- Do not change the application response state machine.

## Current Improvement: Maintenance Menu Language

User story:
As a user opening Maintenance, I need the actions to say what they do in planner terms, so that I can repair or inspect the workbook without guessing whether an action is safe.

Current pain:
Labels like "Migrate legacy tab names" and "Recalculate commitment classes" expose implementation language. A user should not need to run old-tab-name migration directly; repair can do that internally. "Show all columns" is also less precise than the actual intent: reveal hidden helper columns for inspection.

Target experience:
Maintenance uses user concepts: repair all tabs, recalculate task priority, and show hidden columns. Old-tab-name cleanup is hidden inside Repair all tabs. The task-priority action confirms that Today and Home were refreshed.

Implementation:
Menu-label and toast changes, removal of the standalone legacy-tab cleanup menu item, plus a menu-only `recalculateTaskPriorityFromMenu()` wrapper so scheduled maintenance can continue recalculating quietly.

Acceptance tests:
1. The Maintenance menu does not expose legacy-tab migration as a standalone user action.
2. Recalculate task priority refreshes task helpers, Today, and Home, then shows a confirmation.
3. Daily maintenance and repair can still call `recalculateCommitmentClasses()` without extra user toasts.

Non-goals:
- Do not change priority rules.
- Do not change hidden-column lists.
- Do not change migration behavior; it still runs inside Repair all tabs.

## Current Improvement: Setup And Automation Language

User story:
As a new or returning user, I need setup controls to tell me what Planner capability they turn on, so that I do not have to understand Apps Script trigger mechanics to make the workbook respond.

Current pain:
The visible menu said "Triggers & setup", "Set up / verify triggers", and "Show trigger status". That is accurate to the implementation but not to the user's job. The Today submenu also offered "Show all Today columns" while calling the global hidden-column action for every tab.

Target experience:
The menu says "Setup & automation", "Turn on Planner actions", and "Check Planner setup status". Home first-run prompts use the same wording. Hidden-column inspection stays in Maintenance as a global action.

Implementation:
Copy/menu changes only, plus removal of the misleading Today submenu item. Trigger creation, deletion, repair, and scheduling logic are unchanged.

Acceptance tests:
1. No visible setup path says "Triggers & setup", "Set up / verify triggers", or "Show trigger status".
2. The setup status dialog describes edit actions/popups and daily/weekly automation without listing handler names.
3. The Today submenu does not expose a global hidden-column action.
4. Maintenance still exposes "Show hidden columns" for whole-workbook inspection.

Non-goals:
- Do not change Apps Script trigger mechanics.
- Do not remove the ability to inspect hidden columns.
- Do not rewrite the Guide beyond keeping the active menu path accurate.

## Current Improvement: Row Action Outcome Labels

User story:
As a user choosing a row action, I need the label to tell me whether the action creates a task, asks for a decision, opens planning, or links existing data, so that I do not have to remember the planner's internal routing.

Current pain:
Some labels used backend-ish or ambiguous language: "Queue market-map decision", "Queue sub-sector task", "Prep application", and "Link contact". Those were directionally true but not precise enough about the user-visible outcome.

Target experience:
Row actions use outcome language: create a people-search/job-scan/referral-search/sub-sector task, ask whether to market-map, start an application plan, and link an existing contact.

Implementation:
Menu-label changes only. The row-action functions, cascades, task/decision creation, and popup behavior are unchanged.

Acceptance tests:
1. Row action labels distinguish tasks from decisions and planning routes.
2. The existing-contact link action does not imply it can create a new Person.
3. No row-action function names, workflows, or routing behavior changed.

Non-goals:
- Do not change source-led workflow logic.
- Do not add new row actions.
- Do not move row actions out of the menu in this pass.

## Current Improvement: Home Automation Health Copy

User story:
As a user reading Home, I need automation-health warnings to name the Planner capability that needs attention, not the Apps Script function that failed.

Current pain:
`checkTriggerHealth()` recorded missing handler names such as `dailyMaintenance`, and Home could display the raw maintenance error with timestamp and internal label.

Target experience:
Home says the planner automation is incomplete and names user-facing capabilities: edit actions and popups, daily refresh, afternoon reminder, and weekly review.

Implementation:
Trigger-health messages now use user-facing labels, and Home formats stored maintenance errors before display. No automation schedule, trigger creation, or repair behavior changed.

Acceptance tests:
1. Missing automation health stores user-facing capability names.
2. Home maintenance issue text strips the internal timestamp/label.
3. The setup status dialog still shows the schedule timing for daily/weekly automation.

Non-goals:
- Do not add a new Home dashboard section.
- Do not change trigger schedules.
- Do not change repair behavior.
