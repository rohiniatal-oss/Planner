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

## Stage 1 - Surface Roles And Navigation (Restarted)

Required output:

| Surface | Current role | Target role | User action here | Should not do | Current gap | Fix |
|---|---|---|---|---|---|---|
| Home | Command centre and capture surface. `refreshHome` renders setup/trust, attention, Decisions, capture, Today state, open applications, upcoming, then utility refresh. | Start here, decide, capture, see urgent state. | Start/redo setup, resolve decisions, capture update, open/build Today, inspect warnings. | Raw data table, dense dashboard, ordinary task list. | Home role is right in code, but still needs rendered Home/Today consistency proof. | Stage 8 Home cockpit review; no new Home sections until then. |
| Today | Execution surface. `bootstrapToday` renders controls, build/refresh, committed/options table, Needs planning, Progress, End of day. | Do work now, adjust capacity, recover blocked/planning work. | Change focus/minutes/energy, build/refresh, update status, wrap up. | Backlog, source record, capture surface. | Role is right in code; needs Stage 7 task-readiness/capacity tests and visual scan. | Stage 7 Today execution review. |
| Tasks | Work source of truth. `HEADERS['To-do']` includes status, due/time, readiness, blockers, parent/child, links. | Own task existence, readiness, sequencing, blocking, and audit context. | Inspect/repair/sequencing; source for Today selection. | Judgement queue, daily cockpit, source-record replacement. | Helper fields are numerous; visual weight and column ownership need later review. | Stage 4 column lineage + Stage 7 Tasks/Today. |
| Decisions | Judgement queue and audit. `HEADERS['Pending decisions']` includes Decision, action type, Review by, Linked to, Result. | Own judgement and decision audit. | Decide Yes/No, understand consequence, audit result. | Second task table. | Need verify action type router and popup-pending behaviour in Stage 9. | Stage 9 Decisions vs Tasks separation. |
| Sectors | Source tab for search-space taxonomy. Hidden Sector/Sub-sector IDs; visible Sector/Sub-sector/Status/Notes. | Durable broad/narrow search universe records. | Maintain taxonomy and exploration state. | Daily execution surface. | Parent/sub-sector model still needs full column lineage and examples later. | Stage 4 Sectors lineage + Stage 6 sector workflows. |
| Organisations | Source tab for target universe. Hidden IDs/review dates; visible org/classification/status/counts/notes. | Durable organisation classification/status/review record. | Maintain org identity, sector/sub-sector, tier/status, review state. | CRM dashboard or daily queue. | Review cadence may be hidden to users; Active/Dormant semantics need later verification. | Stage 4/5/6 Organisations review. |
| Jobs | Source tab for opportunities/applications. Visible Opportunity, Organisation, Deadline, Application status/result, contacts, notes. | Durable opportunity/application state. | Capture opportunity and application facts. | Own application task execution. | Status/result/response navigation needs later verification. | Stage 4/5/6 Jobs review. |
| People | Source tab for relationship records. Visible person identity, relationship source/status, next action helpers, linked jobs. | Durable relationship record, not outreach automation. | Track person context and relationship stage. | Force outreach from discovery. | People/Conversations flow must prove no outreach task spam. | Stage 4/5/6 People review. |
| Conversations | Source/history tab for interactions. Visible date/person/type/status/notes/outcome. | Interaction history plus outcome router. | Log what happened and any follow-up outcome. | Replace People or Tasks. | Outcome routing clarity needs later review. | Stage 4/5/6 Conversations review. |
| Interviews | Source tab for interview rounds. Visible job/org display, round/date/status/readiness/outcome/follow-up/notes. | Round/prep/outcome record, with prep work routed through Tasks. | Track interview schedule/status/outcome. | Store prep plan only as hidden notes. | Must verify prep plan flows to Tasks, not buried notes. | Stage 4/6 Interviews review. |
| Guide | Product manual. `rewriteGuide` exists and Repair currently rewrites Guide. | Explain stable behaviour after surfaces settle. | Self-serve help after UI is stable. | Substitute for clear UI. | Guide content may lag changed behaviour; user explicitly wants Guide last. | Stage 14 only after behaviour/code settles. |

Stage 1 evidence map from current code:

| Verification item | Evidence checked | Result | Remaining proof needed |
|---|---|---|---|
| Home is not a raw data table | `refreshHome` sections: setup, attention, Decisions, capture, Today, open applications, upcoming, refresh utility | Pass in code structure | Rendered Home visual scan in Stage 8/13 |
| Today is not a backlog | `bootstrapToday` control rows and commit/options/needs-planning/progress/EOD sections; `stagedTodaySelection` owns selection | Pass in code structure | Stage 7 tests for blocked/parent/broken-link exclusions |
| Tasks owns work existence | `HEADERS['To-do']`, `HEADER_GUIDANCE['To-do']`, hidden helper columns | Pass in schema intent | Stage 4 column ownership and Stage 7 readiness |
| Decisions owns judgement | `HEADERS['Pending decisions']` includes Decision/action type/review/result fields | Pass in schema intent | Stage 9 router and popup-pending verification |
| Source tabs are records | `SHEET_TO_HEADER_KEY`, `HEADER_GUIDANCE`, `hiddenColumnsFor`, `CANONICAL_TAB_ORDER` | Pass in architecture | Stage 4 column lineage by tab |
| Guide explains stable behaviour | Guide is last in `CANONICAL_TAB_ORDER`; final checklist defers Guide | Pass as target rule | Stage 14 after behaviour settles |
| Capture starts from Home where possible | Home has `Capture update`; header hints say "Prefer Home > Capture update"; menu still offers Capture update escape hatch | Pass | Verify popup parity in Stage 6 |
| Daily execution starts from Today | Home links to Today; menu and Today checkbox say Build / refresh Today's plan | Pass | Verify Home/Today state consistency in Stage 8 |

Stage 1 findings:

## Issue: Home/Today navigation still needs rendered consistency proof

Severity: P1/P2

Stage: 1
Area: Surface roles and navigation
Tab/surface: Home / Today
Column/function: `refreshHome`, `todayPlanCounts`, `bootstrapToday`, `populateTodayImpl`

Evidence:
- Sheet evidence: Not live-tested in this restarted pass.
- Code evidence: `refreshHome` uses `todayPlanCounts()` to decide whether Home says "Open Today to build plan", "Open Today", or "Start working"; `todayPlanCounts()` can mark a visible plan as `unverified` when build-date evidence is missing.
- User experience evidence: Earlier user screenshots showed trust breaks when Home and Today appeared to disagree, so rendered-state proof matters.

Current behaviour:
Code is designed to keep Home state aligned with Today, including an unverified fallback.

Expected behaviour:
Home should never tell the user "Not built yet" when Today visibly has a current usable plan, and should never say "Start working" before committed work exists.

User impact:
If Home and Today disagree, the Planner feels stale even if the underlying tasks are correct.

Workflow impact:
Daily user may stop trusting Home as the command centre.

Data/integrity impact:
No direct data corruption, but high trust impact.

Automation boundary:
L1/L2 surfacing. Home reads and warns; it should not silently mutate the plan except through explicit refresh actions.

Recommended fix:
- Code change: None until Stage 8 reproduces a failing state.
- Sheet/layout change: Live visual/state test required.
- Dropdown/header/copy change: None yet.
- Repair/backfill: None yet.
- Guide update: Guide-last only if final behaviour changes.

Acceptance tests:
1. With no Today build, Home says `Open Today to build plan`.
2. With Today built and zero committed tasks, Home says `Open Today`, not `Start working`.
3. With Today built and committed rows, Home says `Start working`.
4. If Today has visible rows but missing build-date evidence, Home flags the state as unverified rather than pretending it is cleanly current.

Do not do:
- Do not add a dashboard block to Home.
- Do not make a Home hyperlink run Apps Script.
- Do not patch Home copy before the Stage 8 scenario proves the exact issue.

## Issue: Guide can be regenerated before the Guide-last phase

Severity: P2/P3

Stage: 1
Area: Surface roles and navigation
Tab/surface: Guide / Maintenance
Column/function: `repairAllTabsImpl`, `rewriteGuide`

Evidence:
- Sheet evidence: Not live-tested in this pass.
- Code evidence: `repairAllTabsImpl` calls `rewriteGuide()`.
- User experience evidence: The user explicitly asked to update Guide last, after behaviour settles.

Current behaviour:
Repair all tabs currently rewrites the Guide as part of a broad repair run.

Expected behaviour:
Guide content should be considered final only in Stage 14 after behaviour and surface copy settle. Repair may still need to ensure the tab exists, but content changes should not become the source of truth for unfinished behaviour.

User impact:
Guide can appear more authoritative than the currently reviewed behaviour.

Workflow impact:
Users may follow stale or premature instructions.

Data/integrity impact:
None.

Automation boundary:
L1 documentation/repair helper.

Recommended fix:
- Code change: Do not change now; evaluate in Stage 14 or Stage 3 repair inventory whether Repair should preserve Guide content until Guide-last.
- Sheet/layout change: None yet.
- Dropdown/header/copy change: None yet.
- Repair/backfill: None.
- Guide update: Stage 14 only.

Acceptance tests:
1. Guide update work is not treated as complete before Stage 14.
2. Repair behaviour is reviewed in Stage 3 before changing `rewriteGuide` calls.
3. The final Guide reflects the settled Home/Today/Tasks/Decisions/source-tab behaviour.

Do not do:
- Do not rewrite Guide content now.
- Do not use Guide copy to compensate for unclear UI.

Already verified after restart:

| Prior issue | Current evidence | Status |
|---|---|---|
| Today row movement menu labels were too context-dependent | `buildMenu` now uses `Move selected Today row up` and `Move selected Today row down`, calling the same `moveTodayRowUp` / `moveTodayRowDown` functions | Fixed in `e3c9dc3`; no further action unless live menu differs |

## Stage 2 - Data Integrity, Identity, And Trust

Required output:

| Risk | Affected tabs | Detection | Current protection | Gap | Fix | Test |
|---|---|---|---|---|---|---|
| IDs generated once | Source tabs, Tasks, Decisions | `nextId`, onEdit/capture row creation, schema IDs | ID columns exist and most mutating paths create IDs when anchor fields appear | Needs deeper lock/path audit later; no new confirmed Stage 2 bug in this slice | Defer broad concurrency to reliability stage unless a live failure appears | Duplicate function/schema checks plus mutating-path review |
| IDs accidentally reassigned | Sectors, Orgs, Jobs, People | Sector branch helpers, onEdit guards, hidden ID columns | Sector rename/link logic preserves IDs; Org blank-name guard prevents losing linked org names | Sector-only duplicate `SEC-*` IDs are not currently detected | Add sector-only duplicate `SEC-*` detection to `scanDuplicateIdValues` | Two sector-only rows with same SEC are flagged; child rows sharing parent SEC are not |
| Visible labels match hidden IDs | Orgs, Jobs, People, Interviews, Tasks, Decisions | rename propagation, helper sync, `writeLinkedTo`, linked display helpers | Multiple sync helpers exist: `propagateOrganisationRename`, `syncSectorLinkedLabels`, `refreshLinkedContactsDisplay`, `syncPeopleHelperColumns` | Full column-by-column proof belongs to Stage 4 | Defer to Stage 4 lineage tables | Rename scenario tests by tab |
| Deleted sources create orphan flags | Jobs, People, Tasks, Decisions, Orgs, Sectors, Interviews, Conversations | `checkOrgOrphans`, `detectSectorOrphans`, `syncJobsPeopleHealthFlags`, interview/conversation health flags | Orphan notes are appended and Home can count broken/source-repair needs | Need live repair run proof; no scoped code gap confirmed here | Verify in Stage 2/13 with scenarios after code sync | Delete/clear source rows and run repair/daily maintenance |
| Duplicate IDs detected | Core tabs | `scanDuplicateIdValues`, `syncJobsPeopleHealthFlags`, interview health flags | Generic scanner covers Org/Job/Person/Interaction/Round/Task/Decision and Sub-sector IDs | Sector-only parent `SEC-*` duplicates are missed because Sector ID is intentionally shared with child rows | Add custom sector-only duplicate detection | Repair/daily maintenance flags duplicate sector-only IDs |
| Duplicate open tasks detected | Tasks | `appendTodoOnceForWorkflow`, `openTodoExistsForTargetWorkflow` | Creation paths dedupe by object/workflow for generated work | No full scanner for pre-existing duplicate manual tasks in this slice | Defer to Tasks/Today Stage 7 unless evidence shows live duplicates | Generated cascade creates/reuses one open task |
| Duplicate pending decisions detected | Decisions | `findDecisionByKey`, `pendingDecisionExistsForTargetWorkflow`, `appendPendingDecision` | Decision keys prevent many duplicate pending decisions | Need Stage 9 proof for every decision route | Defer to Decisions stage | Re-trigger each decision route and verify one pending item |
| Formulas match script logic | Orgs, Tasks, Home summaries | Formula repair helpers and script-side count maps | `repairOrganisationsFormulas`, script count maps, helper backfills exist | Full formula parity needs Stage 4 table | Defer to column lineage | Compare formula outputs with script maps |
| Dropdown validations are current | All strict dropdown tabs | `dropdownIntegrityRules`, `scanInvalidDropdownValues`, `refreshAllDropdowns` | Repair/daily maintenance flag invalid values in row Notes; Home counts invalid dropdowns | Needs live repair proof; no scoped code gap confirmed here | Verify later; no code change now | Invalid legacy value gets `[invalid-value]` |
| Helper columns are in sync | Tasks, People, Jobs, Decisions, Home | `backfillTaskHelperColumns`, `syncPeopleHelperColumns`, `backfillDecisionHelperColumns`, `refreshHome` | Repair/daily maintenance refresh helpers | Needs current scenario proof; no scoped code gap confirmed here | Defer to Stage 4/7/9 scenario tests | Link/update rows and verify helper cells refresh |
| Home/Today states are truthful | Home, Today | `todayPlanCounts`, `getTodayPlanBuiltDate`, Today headline note fallback | Home can treat visible Today rows as built-but-unverified instead of falsely Not built | Requires rendered Stage 8 proof | Defer code changes until scenario reproduces a mismatch | Home no-plan/zero-commit/commit/unverified cases |
| Closed/cancelled source states do not keep active downstream work | Tasks, Decisions, source tabs | `taskLinkedSourceIsTerminal`, `deriveReadyForTodayFromRow`, source terminal cleanup paths | Terminal linked source makes task `Needs planning` and Home can flag source repair | Needs workflow-specific cleanup tests later | Defer to Stage 6/7 | Close/archive source and verify linked work leaves Today |

Stage 2 findings:

## Issue: Duplicate broad Sector IDs on sector-only rows are not detected

Severity: P1

Stage: 2
Area: Data integrity, identity, and trust
Tab/surface: Sectors / Organisations / Tasks / Decisions
Column/function: `scanDuplicateIdValues`, `duplicateIdIntegrityRules`, `buildSectorBranchIndexes`

Evidence:
- Sheet evidence: Not live-tested in this pass.
- Code evidence: `duplicateIdIntegrityRules()` scans `Sectors` only by `COLS.SECTORS.SUBSECTOR_ID`. `buildSectorBranchIndexes()` stores `branch.id` in `byId`, so duplicate sector-only `SEC-*` IDs can overwrite each other in the index.
- User experience evidence: Sector links can appear to point at the wrong broad sector if two broad sector rows share the same `SEC-*` ID.

Current behaviour:
Duplicate `SUB-*` IDs are flagged, but duplicate broad-sector `SEC-*` IDs across two sector-only parent rows are not. The code cannot simply scan all Sector IDs because valid sub-sector child rows intentionally reuse the parent `SEC-*` in the Sector ID column.

Expected behaviour:
Repair/daily maintenance should flag duplicate `SEC-*` IDs only when the duplicate appears on multiple sector-only rows. Child rows sharing the parent Sector ID should remain valid.

User impact:
Sector taxonomy can become untrustworthy: Organisations, Tasks, and Decisions linked through a Sector ID may resolve to the wrong broad sector.

Workflow impact:
Market mapping and organisation classification can drift under duplicate broad-sector IDs.

Data/integrity impact:
High. This is an identity collision in a source-of-truth tab.

Automation boundary:
L2 repair flag. Do not auto-merge or reassign Sector IDs without a separate migration design.

Recommended fix:
- Code change: Extend `scanDuplicateIdValues(writeFlags)` with a custom Sectors pass that flags duplicate `SEC-*` IDs only for sector-only rows.
- Sheet/layout change: None.
- Dropdown/header/copy change: None.
- Repair/backfill: Existing repair/daily maintenance will call the scanner and write flags.
- Guide update: Guide-last; maybe later explain Sector/Sub-sector IDs.

Acceptance tests:
1. Two sector-only rows with the same `SEC-*` ID both get `[duplicate-sector-id]`.
2. A sector-only row and its child sub-sector rows sharing the same `SEC-*` ID are not flagged.
3. Existing duplicate `SUB-*` detection still works.
4. Home Needs attention still counts duplicate-ID rows through `scanDuplicateIdValues(false)`.

Do not do:
- Do not auto-reassign duplicate Sector IDs.
- Do not flag valid child rows that share the parent Sector ID.
- Do not change the Sector/Sub-sector schema.

## Initial Implementation Backlog

| Issue | Severity | Stage | User impact | Dependency | Batch | Acceptance tests | Status |
|---|---|---|---|---|---|---|---|
| Duplicate broad Sector IDs on sector-only rows are not detected | P1 | 2 | Sector links can resolve to the wrong broad sector | None | Batch 1 data safety and trust | Duplicate sector-only SEC rows flagged; child rows not falsely flagged | Fixed in current batch |
| Home/Today navigation still needs rendered consistency proof | P1/P2 | 1/8/13 | Trust depends on rendered Home matching Today | Live sheet or Apps Script sync | Batch 2 | Home ready/not-built/stale states verified | Open |
| Missed-days restart lacks a named recovery mode | P2 | 0/8/11 | Returning user may not know next safe action | Home cockpit + observability review | Batch 2 or 5, depending on finding | Home stale-state scenario has one clear next action | Open |
| Guide can be regenerated before the Guide-last phase | P2/P3 | 1/3/14 | Guide may look authoritative before behaviour settles | Repair inventory and Guide-last stage | Batch 6 or Stage 3 repair decision | Repair/Guide behaviour reviewed before content change | Open |
| Today row movement menu labels are too context-dependent | P3 | 1/12 | Minor menu ambiguity | None | Batch 5 UX/copy | Menu labels change only; functions unchanged | Fixed in `e3c9dc3` |

## Completed Implementation Batch - Batch 5 UX/Copy

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

Result:
Implemented in `e3c9dc3`. Current `buildMenu` labels are `Move selected Today row up` and `Move selected Today row down`; function targets are unchanged.

## Selected Implementation Batch - Batch 1 Data Safety And Trust

Implementation item: Duplicate broad Sector IDs on sector-only rows are not detected.

User story:
As a user maintaining sectors and sub-sectors, when two broad sector rows accidentally share the same Sector ID, I need the Planner to flag that identity collision without flagging valid child sub-sector rows, so that linked organisations/tasks/decisions do not silently resolve to the wrong broad sector.

Current pain:
The duplicate-ID scanner checks Sub-sector IDs on the Sectors tab, but not duplicate broad-sector IDs between two sector-only parent rows. A broad-sector duplicate can overwrite the ID index used by sector lookups.

Target experience:
Repair/daily maintenance/Home attention detect duplicate broad-sector `SEC-*` IDs only when they appear on multiple sector-only rows. Valid child rows sharing their parent `SEC-*` stay clean.

Automation level:
L2 repair flag. The Planner warns and routes to repair; it does not auto-merge or reassign sector IDs.

Implementation scope:
Extend `scanDuplicateIdValues(writeFlags)` with a Sectors-specific sector-only duplicate pass.

Acceptance test:
1. Two sector-only rows with the same `SEC-*` ID both get `[duplicate-sector-id]`.
2. A sector-only row and child sub-sector rows sharing that `SEC-*` ID are not flagged.
3. Existing duplicate `SUB-*` detection still works.
4. Home duplicate-ID count includes the new sector-only duplicate rows.

Non-goals:
- Do not change the Sectors schema.
- Do not auto-reassign IDs.
- Do not flag valid parent-child Sector ID sharing.

Result:
Implemented in current batch. `scanDuplicateIdValues(writeFlags)` now includes a Sectors-specific sector-only duplicate pass, using `[duplicate-sector-id]` on duplicate broad `SEC-*` rows while leaving valid child sub-sector rows unflagged.

Verification:
- `git diff --check`
- Apps Script syntax check with bundled Node
- Duplicate top-level function check: 579 functions, 579 unique, 0 duplicates
- HEADERS/COLS schema check clean

Next required stage before broader code:
Stage 2 data integrity, identity, and trust. Do not implement broader fixes until Stage 2 review outputs exist.
