# Full MECE Planner Review Run

Source of truth: `docs/codex_full_mece_planner_review_and_implementation_handover.md`.

Baseline for this restarted run: `e3c9dc3 Clarify Today row movement menu labels`.

Rule for this run: review outputs come before implementation. Imported prior fixes are treated as claims to verify, not proof of completion.

Restart note:
The review was explicitly restarted from the beginning after the user asked to "start from the beginning again." Stage 0 is the active review point. Later sections in this file from earlier passes are retained as historical notes until they are re-run in order.

Restart note 2:
The review was restarted from the beginning again after later Stage 6/7 work. Current baseline for this pass is `585cce1 Preserve person identity across capture`. Earlier review sections remain useful evidence, but each stage must be re-confirmed from current `Code.gs` before being treated as complete.

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

Stage 0 re-check from `585cce1`:

| User mode area | Current-code status | Stage 0 decision |
|---|---|---|
| New user | `refreshHome` renders trigger-off setup guidance; `runSetupInterview` / `completeSetupFromPopup` offer backup-before-reset when existing rows are present | Covered for now; destructive-action inventory still belongs to Stage 3 |
| Daily user | `refreshHome` renders Decisions, Capture update, Today state, Open applications, Upcoming, and maintenance status | Covered for code structure; Home/Today truth must be proven in Stage 8 |
| Low-energy day | `bootstrapToday` exposes Focus, Available minutes, Energy, and notes explaining that refresh re-fits work | Covered for code structure; capacity behaviour must be proven in Stage 7 |
| Missed-days restart | `readMaintenanceHealth`, Home attention items, Today rebuild, and maintenance menu actions exist, but there is no named recovery mode | Carry forward as the active Stage 0 product gap; decide placement in Stage 8 rather than adding Home noise now |
| Application sprint | Open applications, response checks, application workflows, and application capture paths exist in code | Needs Stage 4/6 lineage proof before changing application logic |
| Interview sprint | Interview scheduling/prep/follow-up workflows exist, including task-led prep workflows | Needs Stage 4/6/7 proof that prep is task-visible and Today-ready |
| Networking day | People and Conversations workflows exist; source-led people capture exists | Needs Stage 5/6 no-task-spam proof |
| Source-led search day | `Opportunity scan` and `People source scan` workflows exist; completion routes through pending decisions/capture | Needs Stage 6 proof that result capture is clean and not spammy |
| Weekly review | `weeklyReviewImpl` stores heartbeat/summary and refreshes planning surfaces | Needs Stage 11 observability proof |
| Repair mode | Home attention items and maintenance menu expose repair paths | Needs Stage 3 lifecycle inventory and Stage 11 audit proof |
| Long-running search | No Stage 0-only performance proof; helper scans and Home collections exist | Needs Stage 15 scale review |

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

## Issue: Maintenance menu labels used implementation language

Severity: P3

Stage: 1
Area: Surface roles and navigation
Tab/surface: The Planner menu / Maintenance
Column/function: `buildMenu`, `refreshAllDerivedData`, `recalculateTaskPriorityFromMenu`, `showAllColumns`

Evidence:
- Code evidence: `buildMenu` exposed `Refresh derived data (safe)`, `Recalculate task priority`, and `Show hidden columns`.
- User experience evidence: These are valid maintenance actions, but the labels describe internals instead of user outcomes.

Current behaviour:
The user could run the actions, but would need to infer what "derived data" means and why priority recalculation affects Today.

Expected behaviour:
Visible maintenance actions should describe the user-facing outcome.

User impact:
Repair mode becomes less mysterious and less likely to feel like a developer menu.

Workflow impact:
No workflow change.

Data/integrity impact:
None; labels only.

Automation boundary:
L1 surface clarity.

Fix implemented:
- `Refresh derived data (safe)` -> `Refresh planner links and display (safe)`
- `Recalculate task priority` -> `Re-rank Tasks for Today`
- `Show hidden columns` -> `Show hidden system columns`

Acceptance tests:
1. The Planner menu still calls the same functions.
2. No setup, repair, task-ranking, or hidden-column behaviour changes.
3. Labels explain user outcomes rather than implementation details.

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
| Duplicate open tasks detected | Tasks | `appendTodoOnceForWorkflow`, `openTodoExistsForTargetWorkflow`, `scanDuplicateOpenTasks` | Creation paths dedupe by object/workflow for generated work; repair/daily maintenance now flag pre-existing duplicate open linked tasks | Fixed in this pass | Keep non-destructive; do not auto-merge duplicates | Two open Tasks with same linked object/workflow get `[duplicate-open-task]` and Home attention |
| Duplicate pending decisions detected | Decisions | `findDecisionByKey`, `pendingDecisionExistsForTargetWorkflow`, `appendPendingDecision`, `scanDuplicatePendingDecisions` | Decision keys prevent many duplicate pending decisions; repair/daily maintenance now flag duplicate pending decision keys | Fixed in this pass | Keep non-destructive; do not auto-dismiss duplicate judgement | Two pending Decisions with same key get `[duplicate-pending-decision]` and Home attention |
| Formulas match script logic | Orgs, Tasks, Home summaries | Formula repair helpers and script-side count maps | `repairOrganisationsFormulas`, script count maps, helper backfills exist | Full formula parity needs Stage 4 table | Defer to column lineage | Compare formula outputs with script maps |
| Dropdown validations are current | All strict dropdown tabs | `dropdownIntegrityRules`, `scanInvalidDropdownValues`, `refreshAllDropdowns` | Repair/daily maintenance flag invalid values in row Notes; Home counts invalid dropdowns | Needs live repair proof; no scoped code gap confirmed here | Verify later; no code change now | Invalid legacy value gets `[invalid-value]` |
| Helper columns are in sync | Tasks, People, Jobs, Decisions, Home | `backfillTaskHelperColumns`, `syncPeopleHelperColumns`, `backfillDecisionHelperColumns`, `refreshHome` | Repair/daily maintenance refresh helpers | Needs current scenario proof; no scoped code gap confirmed here | Defer to Stage 4/7/9 scenario tests | Link/update rows and verify helper cells refresh |
| Home/Today states are truthful | Home, Today | `todayPlanCounts`, `getTodayPlanBuiltDate`, Today headline note fallback | Home can treat visible Today rows as built-but-unverified instead of falsely Not built | Requires rendered Stage 8 proof | Defer code changes until scenario reproduces a mismatch | Home no-plan/zero-commit/commit/unverified cases |
| Closed/cancelled source states do not keep active downstream work | Tasks, Decisions, source tabs | `taskLinkedSourceIsTerminal`, `deriveReadyForTodayFromRow`, source terminal cleanup paths | Terminal linked source makes task `Needs planning` and Home can flag source repair | Needs workflow-specific cleanup tests later | Defer to Stage 6/7 | Close/archive source and verify linked work leaves Today |

Stage 2 findings:

## Issue: Duplicate open Tasks and pending Decisions were only creation-guarded

Severity: P2

Stage: 2
Area: Data integrity, identity, and trust
Tab/surface: Tasks / Decisions / Home / Maintenance
Column/function: `appendTodoOnceForWorkflow`, `findDecisionByKey`, `scanDuplicateOpenTasks`, `scanDuplicatePendingDecisions`, `collectHomeAttentionItems`

Evidence:
- Code evidence: Before this pass, generated creation paths used dedupe checks, but there was no scanner for duplicates already present from imports, manual edits, or older bugs.
- User experience evidence: Duplicate executable work can appear in Today, and duplicate judgement can appear on Home, without a repair flag explaining why.

Current behaviour:
New generated items are usually deduped, but old/pre-existing duplicates were not systematically surfaced.

Expected behaviour:
The Planner should flag duplicate open linked Tasks and duplicate pending Decisions so the user can inspect and repair them.

User impact:
Reduces confusion where the same work or decision appears twice.

Workflow impact:
Today and Home become more trustworthy because duplicate work/judgement is visible as a repair issue.

Data/integrity impact:
No data is deleted or merged automatically.

Automation boundary:
L1/L2 trust surfacing. Detect and flag; do not choose the winning duplicate.

Fix implemented:
- Added `scanDuplicateOpenTasks(writeFlags)` for open linked Tasks sharing object type, object ID, and workflow.
- Added `scanDuplicatePendingDecisions(writeFlags)` for Pending Decisions sharing the same decision key.
- Added both scanners to Repair all tabs, daily maintenance, and Home attention counts.
- Added `[duplicate-open-task]` to task attention/planning summaries and Ready-for-Today derivation so duplicates are not treated as clean execution work.

Acceptance tests:
1. Two open linked Tasks with the same object/workflow get `[duplicate-open-task]`.
2. Closed/done duplicate historical Tasks are ignored.
3. Two Pending Decisions with the same key get `[duplicate-pending-decision]`.
4. Non-pending duplicate historical Decisions are ignored.
5. Home attention includes duplicate counts but does not auto-delete anything.

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

## Stage 3 - Data Lifecycle And Safety

Required output:

| Action/function | Type | Destructive? | Data affected | Backup before action? | Confirmation? | Restore path? | Fix |
|---|---|---:|---|---:|---:|---:|---|
| `runSetupInterview` -> `completeSetupFromPopup` -> `resetPlannerDataForOnboarding` | Reset through redo setup | Yes | Sectors, Organisations, Jobs, People, Conversations, Interviews, Tasks, Decisions bodies | Optional, default checked in popup | Yes, but current visible text was too generic | Manual recovery from backup copy only | Strengthen confirmation text, keep backup option, record reset audit |
| `createPlannerBackupCopy` | Snapshot primitive | No | Copies whole spreadsheet | N/A | N/A | The copy is the recovery artifact | Add user-facing `savePlannerSnapshot` menu action |
| `repairAllTabs` | Repair/migration | No planner data deletion; deletes obsolete `Dashboard` if present | Headers, dropdowns, helper columns, Today/Home generated surfaces, repair flags, obsolete legacy tabs; Guide is created only if missing | No | No | Not a restore path | Existing Guide content is preserved until Stage 14; fresh workbooks still get a Guide tab |
| `fullRefresh` / `refreshAllDerivedData` | Refresh | No planner data deletion; deletes obsolete `Dashboard` if present | Derived data, dropdowns, Home/Today helpers, obsolete legacy tabs | No | No | N/A | Current menu says safe; Dashboard is not a Planner data surface |
| `dailyMaintenance` / `weeklyReview` | Scheduled maintenance | No intended data deletion | Derived helpers, due tasks, review summaries, Home/Today | No | No | N/A | Defer deeper cadence/observability to Stage 11 |
| `migrateWorkbookSchema` and migration helpers | Migration | Potentially shape-changing, designed to preserve row data | Sectors, Organisations, Jobs, Conversations schema/data ranges | No | No | No automatic rollback | Defer migration-specific proof to Stage 15 unless a failing scenario appears |
| Trigger uninstall actions | Automation setup change | No planner data deletion | Installable triggers only | No | Menu action only | Reinstall through Setup & automation | User-facing enough for now; no data lifecycle fix |

Stage 3 lifecycle decision:

| Legacy surface | Current-code evidence | Decision |
|---|---|---|
| `Dashboard` tab | Not in `CANONICAL_TAB_ORDER`, not in `SHEET_TO_HEADER_KEY`, not referenced by any workflow; only appears in `hideLegacyUtilityTabs` cleanup | Delete as obsolete legacy surface during repair/refresh cleanup |

Stage 3 re-check from `a0d8017`:

| Lifecycle area | Current-code status | Stage 3 decision |
|---|---|---|
| Destructive reset | `completeSetupFromPopup` validates payload, confirms populated reset, optionally creates backup copy before `resetPlannerDataForOnboarding`, and records reset audit | Covered for current pass; live popup test remains Stage 13 |
| Data body clearing | `clearSheetBody` restores current headers and clears body content, notes, validations, and formatting across the sheet's full used width | Covered; no stale out-of-schema data should survive onboarding reset |
| Snapshot | `savePlannerSnapshot` copies the spreadsheet and records snapshot properties | Covered; restore remains intentionally manual via backup copy |
| Repair | `repairAllTabsImpl` rewrites schemas/helpers/generated Home/Today surfaces and now preserves an existing Guide | Covered; Guide content update deferred to Stage 14 |
| Refresh | `fullRefreshImpl` runs safe maintenance/display refresh and legacy cleanup | Covered; label now says `Refresh planner links and display (safe)` |
| Legacy tabs | `hideLegacyUtilityTabs` deletes obsolete `Dashboard` and empty spacer tabs, hides non-empty spacer tabs | Covered; Dashboard is not a Planner data surface |
| Migration | `migrateWorkbookSchema` and migration helpers are schema-preserving by intent | Defer performance/large workbook proof to Stage 15 |

## Stage 4 - Column Ownership And Field Lineage

Required output:

| Tab | Column | Role | Owner | Editable? | Source of value | Read by | Triggers logic? | Flows to | Failure mode | Fix |
|---|---|---|---|---:|---|---|---:|---|---|---|

Stage 4 schema/config scan:

| Check | Current evidence | Result |
|---|---|---|
| Controlled workbook columns | Current `HEADERS` list contains 119 columns across Today, Decisions, Tasks, Sectors, Organisations, Jobs, People, Interviews, Conversations | Baseline mapped from current `Code.gs` |
| Hidden/system columns | `hiddenColumnsFor` hides IDs and helper link columns on source/work tabs | Mostly aligned; Today `Actual min` remains hidden by design |
| Manual/editable columns | `MANUAL_COLUMNS` drives cream/manual styling | Confirmed gap: Today was omitted even though visible Today `Status` and `Why / notes` are user-editable |
| Dropdown-driven columns | `applySheetDropdowns` and `dropdownIntegrityRules` define strict/value-list fields | Deeper dropdown semantics continue in Stage 5 |
| Column bounds | HEADERS/COLS and config-bounds checks pass in verification | Clean |

Stage 4 lineage summary from current code:

| Tab | Identity/link columns | User-owned columns | System/helper columns | Logic-driving columns | Current Stage 4 status |
|---|---|---|---|---|---|
| Today | Linked Task ID hidden; Slot/Plan/Effort generated | Status and user notes; controls live above the table | Task text, estimate, reason/note metadata, hidden class/effort | Status, focus/minutes/energy, refresh/end-of-day controls | Fixed manual ownership for Status/Notes |
| Decisions | Decision ID/key/target/todo ID hidden | Decision and Notes | Created, action type, Review by, Linked to, Result | Decision, action type, target/workflow/key | No new Stage 4 fix beyond prior decision-helper work |
| Tasks | Task ID, linked object, parent/blocker IDs hidden | Status, due date, estimate, notes, plan category/pattern/step/blocker | Commitment class, source/audit fields, readiness, child progress, linked display | Status, due, estimate, parent/step/blocker, notes | Duplicate-open-task flag now affects readiness; broader Tasks flow continues in Stage 7 |
| Sectors | Sector/Sub-sector IDs hidden | Sector, Sub-sector, Status, Notes | None beyond hidden IDs | Sector/Sub-sector/Status | Prior sector identity fixes verified; no new Stage 4 edit |
| Organisations | Org/Sector/Sub-sector IDs and review dates hidden | Organisation, Sector/Sub-sector labels, Tier, Status, Notes | Counts, review cadence dates | Organisation, Sector/Sub-sector, Tier, Status | Full org review already carried forward; no new Stage 4 edit |
| Jobs | Job ID, Org ID, linked contact IDs hidden | Opportunity, Organisation, Deadline, Application status, Submitted date, Response, Result, Notes | People display, response-check date | Opportunity, Organisation, deadline/status/submitted/response/result | No new Stage 4 edit in this slice |
| People | Person ID and Org ID hidden | Name, Organisation, Role, Relationship source/status, follow-up date, reply, outreach date, conversation date, notes | Follow-up sent/count, last interaction, next action, linked jobs | Organisation, relationship status, reply, outreach/conversation dates | Fixed Outreach date ownership |
| Interviews | Round ID and Job ID hidden | Round, type, date, status, readiness, official outcome, response/follow-up date, notes | Job/org display | Round date/status/outcome/follow-up | No new Stage 4 edit in this slice |
| Conversations | Interaction ID and Person ID hidden | Date, Person, Type, Interaction status, Notes, Outcome | Organisation display | Person, date/status/outcome | No new Stage 4 edit in this slice |

## Stage 5 - State Machines And Dropdown Semantics

Required dropdown output:

| Dropdown | Used in | Values | Strict? | Drives code? | Missing values | Legacy values | Fix |
|---|---|---|---:|---:|---|---|---|

Stage 5 initial dropdown scan:

| State field | Values | Drives code? | Current issue |
|---|---|---:|---|
| Today Status | Planned, In progress, Blocked, Done, Deferred, Skipped; Option rows use Deferred, Done, Pull in | Yes | Dropdown allowed invalid values before this pass |
| Jobs Response received | Yes, No | Yes | Dropdown allowed invalid values before this pass |
| People Reply received | Yes, No | Yes | Dropdown allowed invalid values before this pass |
| People Follow-up sent? | Yes, No | Yes, for follow-up materialisation | Dropdown allowed invalid values before this pass |
| Jobs Application status / result | Status: Not started, In progress, Submitted, Closed; Result: Waiting, Interview invite, Rejected | Yes | Strict already |
| People Relationship status | Identified, To outreach, Outreach drafted, Outreach sent, Replied, Conversation scheduled, Conversation completed, Keep warm, Closed | Yes | Strict already |
| Conversations Interaction status / Outcome | Scheduled, Completed, Cancelled; outcomes include Useful/Neutral/Dead end/Referral/Opportunity/Follow-up/System log | Yes | Strict already |
| Interviews Status / Official outcome | To schedule, Scheduled, Completed, Cancelled, Reschedule; Waiting, Next round, Declined, Offer, Parked | Yes | Strict already; earlier Stage 5 work added To schedule/Scheduled handling |

## Issue: Workflow-driving dropdowns allowed invalid values

Severity: P2

Stage: 5
Area: State machines and dropdown semantics
Tab/surface: Today / Jobs / People
Column/function: `applyTodayRowStatusDropdowns`, `applySheetDropdowns`, `setDropdown`

Evidence:
- Code evidence: `setDropdown` defaults to `allowInvalid: true`.
- Code evidence: Today status, Jobs response received, People reply received, and People follow-up sent route workflow logic but were using default validation.

Current behaviour:
Users could type invalid state values into workflow-driving dropdown cells. Repair could flag them later, but the bad state was not blocked at entry.

Expected behaviour:
State fields that drive code should reject invalid values at the cell validation layer.

Fix implemented:
- Today status dropdowns now use `{ allowInvalid: false }` for both Commit and Option rows.
- Jobs `Response received` now uses strict Yes/No.
- People `Reply received` and `Follow-up sent?` now use strict Yes/No.

Acceptance tests:
1. Today commit rows reject values outside `TODAY_STATUS`.
2. Today option rows reject values outside `TODAY_STATUS_OPTION`.
3. Jobs response and People reply/follow-up fields reject values outside Yes/No.
4. Existing scanInvalidDropdownValues remains as repair/backstop for legacy values.

## Issue: Today visible editable cells were not in manual-column ownership config

Severity: P2/P3

Stage: 4
Area: Column ownership and field lineage
Tab/surface: Today
Column/function: `MANUAL_COLUMNS`, `colorCodeManualFields`, `onEditToday`, `splitTodayNotes`

Evidence:
- Code evidence: `onEditToday` treats Today `Status` as an interactive execution control; `splitTodayNotes` / `collectPreviousTodayState` preserve user-authored Today notes across refreshes.
- Code evidence: `MANUAL_COLUMNS` did not include `"Today's plan"`, so Today table body cells were not classified with the same manual/system ownership model as other tabs.

Current behaviour:
Today rows contain visible user-editable fields, but the ownership config treated the entire Today table as outside manual-column styling.

Expected behaviour:
Visible editable Today fields should be explicit in `MANUAL_COLUMNS`, while generated helper fields stay system-owned.

Fix implemented:
Added `"Today's plan": [COLS.TODAY.STATUS, COLS.TODAY.NOTES]` to `MANUAL_COLUMNS`.

Acceptance tests:
1. Today `Status` and `Why / notes` are recognized as manual/user-editable columns by `colorCodeManualFields`.
2. Hidden Today helper columns remain auto/system-owned.
3. No Today selection, status sync, or refresh logic changes.

## Issue: People Outreach date was editable but styled/configured as system-owned

Severity: P3

Stage: 4
Area: Column ownership and field lineage
Tab/surface: People
Column/function: `MANUAL_COLUMNS`, `onEditPeople`, `COLS.PEOPLE.OUTREACH_DATE`

Evidence:
- Code evidence: `onEditPeople` has a dedicated branch for `COLS.PEOPLE.OUTREACH_DATE`; editing it can move a person to `Outreach sent`, recalculate follow-up date, and update the open follow-up task due date.
- Code evidence: `MANUAL_COLUMNS.People` did not include `OUTREACH_DATE`, so the column looked system-owned.

Current behaviour:
The user could edit Outreach date and trigger workflow logic, but the visual ownership model did not identify it as user-editable.

Expected behaviour:
If a direct user edit drives outreach state, the column should be marked as manual.

Fix implemented:
Added `COLS.PEOPLE.OUTREACH_DATE` to `MANUAL_COLUMNS.People`.

Acceptance tests:
1. People `Outreach date` is styled as a manual/editable column.
2. Existing outreach-date cascade behaviour is unchanged.
3. Auto-only People helper columns remain system-styled.

## Issue: Repair all tabs rewrote existing Guide before Guide-last

Severity: P2

Stage: 3
Area: Data lifecycle and safety
Tab/surface: Guide / Maintenance
Column/function: `repairAllTabsImpl`, `rewriteGuide`

Evidence:
- Code evidence: `repairAllTabsImpl` called `rewriteGuide()` unconditionally.
- Product evidence: The final checklist says Guide is the manual after behaviour settles, and the user explicitly asked to do Guide last.

Current behaviour:
Running Repair all tabs overwrote the Guide content even while behaviour/copy was still under review.

Expected behaviour:
Repair should preserve existing Guide content until the Guide-last pass, while still creating a Guide on a fresh workbook if none exists.

Fix implemented:
`repairAllTabsImpl` now calls `rewriteGuide()` only when the Guide tab is missing.

Acceptance tests:
1. Existing Guide content is not rewritten by Repair all tabs.
2. A workbook without a Guide still gets a Guide tab when repaired.
3. Stage 14 remains the only planned Guide content rewrite phase.

Required classifications:

| Action type | User meaning in current code |
|---|---|
| Refresh | Recompute derived surfaces and helpers; source rows should remain intact |
| Repair | Fix workbook structure, headers, helper formulas, dropdowns, flags, and generated tabs; source rows should remain intact |
| Snapshot | Save a full spreadsheet backup copy |
| Reset | Clear planner data bodies before redo onboarding; requires explicit confirmation and should offer backup |
| Restore | Not implemented; recovery is manual from a saved spreadsheet copy |
| Migration | Change schema/layout safely while preserving existing row meaning |

Stage 3 findings:

## Issue: Redo-setup reset warning was not specific enough and had no reset audit

Severity: P1

Stage: 3
Area: Data lifecycle and safety
Tab/surface: Setup popup / Maintenance menu / document properties
Column/function: `buildSetupHtml`, `completeSetupFromPopup`, `resetPlannerDataForOnboarding`, `createPlannerBackupCopy`, `buildMenu`

Evidence:
- Code evidence: `clearSheetBody` clears each data tab body across the full used width, so the wipe itself is broad enough. The popup offered a default-checked backup option, but the client-side confirmation only said it would clear an existing row count and did not name affected tabs or recovery path.
- Code evidence: `completeSetupFromPopup` created a backup before reset when requested, but did not write a durable reset audit property.
- Product evidence: Stage 3 requires destructive actions to list affected data, confirm explicitly, offer snapshot, leave an audit note, and provide a recovery instruction.

Current behaviour:
Redo setup can safely create a backup and clear the correct data tabs, but the user-facing warning is too compressed for a destructive action and the reset leaves no durable audit record.

Expected behaviour:
Redo setup names the affected tabs, reminds the user that the backup copy is the recovery path, and records reset metadata after a successful clear. Users can also save a backup copy from Maintenance without starting a reset.

User impact:
The user has a clearer last chance before data deletion and a visible safety path before experimenting with setup/repair.

Workflow impact:
Snapshot, reset, and refresh are more clearly separated. Restore remains intentionally manual from a full spreadsheet copy.

Data/integrity impact:
Medium-high. The previous flow protected data with a default backup, but weak warning/audit made recovery less trustworthy.

Automation boundary:
L1/L2. Make destructive setup clearer and auditable; do not implement automatic restore.

Recommended fix:
- Code change: Add user-facing `savePlannerSnapshot()`.
- Code change: Add `recordPlannerResetAudit(details)` document-property audit.
- Code change: Strengthen the setup confirmation copy to name all affected data tabs and recovery from backup.
- Menu change: Add `Maintenance > Save backup copy`.
- Guide update: Guide-last.

Acceptance tests:
1. Maintenance menu has a non-destructive `Save backup copy` action.
2. Redo-setup confirmation names Sectors, Organisations, Jobs, People, Conversations, Interviews, Tasks, and Decisions.
3. Backup failure aborts before reset, preserving existing behaviour.
4. Successful reset records `lastPlannerResetAt`, cleared row count, entry point, and backup name/url when present.
5. No restore function is introduced.

Do not do:
- Do not implement automatic restore casually.
- Do not change onboarding capture semantics.
- Do not change the data model.

Result:
Implemented in current batch. `savePlannerSnapshot()` creates a full spreadsheet backup from Maintenance. Redo setup now shows a tab-specific destructive warning and records reset audit properties after a successful clear.

Verification:
- `git diff --check`
- Apps Script syntax check with bundled Node
- Duplicate top-level function check: 581 functions, 581 unique, 0 duplicates
- HEADERS/COLS schema check clean

## Stage 4 - Column Ownership And Field Lineage

Required output:

| Tab | Column | Role | Owner | Editable? | Source of value | Read by | Triggers logic? | Flows to | Failure mode | Fix |
|---|---|---|---|---:|---|---|---:|---|---|---|
| Jobs | Submitted date | Date / scheduling | User + application submission flows | Yes | Application popup, onboarding application capture, submit-application popup, direct edit | `fireJobStatusChanged`, `updateJobSubmittedDates`, response-check materialization, Home open applications | Yes | Next response check, response-check Tasks, Home application state | Column was hidden and auto-colored despite being a user-meaningful source fact | Unhide, manual-color, width, and direct-edit sync |

Stage 4 findings:

## Issue: Jobs Submitted date was hidden even though it is a user-owned source fact

Severity: P1

Stage: 4
Area: Column ownership and field lineage
Tab/surface: Jobs
Column/function: `COLS.JOBS.APPLIED_DATE`, `hiddenColumnsFor`, `MANUAL_COLUMNS`, `onEditJobs`, `updateJobSubmittedDates`

Evidence:
- Code evidence: `HEADERS.Jobs` labels column 7 as `Submitted date`, and multiple capture/submission paths write it as the actual application submission date.
- Code evidence: `hiddenColumnsFor('Jobs')` still hid `COLS.JOBS.APPLIED_DATE`, and `MANUAL_COLUMNS.Jobs` did not include it, so the sheet treated it as system-only.
- Code evidence: `updateJobSubmittedDates(jobId, submittedDate)` already recalculates `Next response check` and syncs open response-check task dates, but direct edits to column 7 did not call it.

Current behaviour:
The date that anchors application response tracking is captured and used by automation, but is not visible/editable on the Jobs source tab.

Expected behaviour:
`Submitted date` should be visible and manual-colored on Jobs. If the user corrects it, the planner should recompute `Next response check` and update the open response-check task.

User impact:
The Jobs tab becomes honest: a user can see and fix the date that drives response checks.

Workflow impact:
Application submitted -> response check timing remains consistent whether the date comes from popup, onboarding, task completion, or direct Jobs edit.

Data/integrity impact:
Medium-high. Hidden stale submitted dates can make response-check tasks wrong without a visible source-of-truth correction path.

Automation boundary:
L1/L2. Reveal and sync an existing source field; do not change application status semantics.

Recommended fix:
- Code change: Remove `COLS.JOBS.APPLIED_DATE` from hidden Jobs columns.
- Code change: Add it to Jobs manual columns and column widths.
- Code change: In `onEditJobs`, route direct submitted-date edits through `updateJobSubmittedDates`.
- Guide update: Guide-last.

Acceptance tests:
1. Jobs `Submitted date` is visible after layout repair.
2. Jobs `Submitted date` is manual-colored.
3. Directly editing `Submitted date` recomputes `Next response check`.
4. Open `Check application response` tasks move to the recomputed date.
5. No schema or status vocabulary changes.

Do not do:
- Do not rename the underlying `APPLIED_DATE` constant in this pass.
- Do not change application status options.
- Do not create response-check tasks for non-submitted jobs.

Result:
Implemented in current batch. Jobs `Submitted date` is visible/manual, and direct edits call `updateJobSubmittedDates()` or clear response-check timing when the date is cleared.

Verification:
- `git diff --check`
- Apps Script syntax check with bundled Node
- Duplicate top-level function check: 581 functions, 581 unique, 0 duplicates
- HEADERS/COLS schema check clean
- Stage 4 column config bounds check clean

## Stage 5 - State Machines And Dropdown Semantics

Required dropdown output:

| Dropdown | Used in | Values | Strict? | Drives code? | Missing values | Legacy values | Fix |
|---|---|---|---:|---:|---|---|---|
| People relationship status | People column 7 | Identified, To outreach, Outreach drafted, Outreach sent, Replied, Conversation scheduled, Conversation completed, Keep warm, Closed | Yes | Yes, `firePersonStageChanged` | None in this slice | Normalized by `normalizePersonStage` | Cleanup cancelled scheduled conversations |
| Conversations interaction status | Conversations column 7 | Scheduled, Completed, Cancelled | Yes | Yes, `routeInteractionStatusForPerson` | None in this slice | Migrated by interaction schema migration | Ensure Cancelled cleans the People scheduled date |
| Interview round status | Interviews column 8 | To schedule, Scheduled, Completed, Cancelled, Reschedule | Yes | Partially before this batch | `To schedule` and `Scheduled` direct edits lacked explicit transition handling | N/A | Add direct status handling for `To schedule` and `Scheduled` |

Required state-machine output:

| State field | State | Meaning | Active/terminal/temp | Valid next states | Downstream effects | Cleanup required |
|---|---|---|---|---|---|---|
| People.Relationship status | Conversation scheduled | Conversation exists on a specific date | Temp active | Conversation completed, Replied via cancellation, Keep warm, Closed | Creates/updates Conversation prep task and Home upcoming item | If cancelled, clear Conversation date and cancel prep |
| Conversations.Interaction status | Cancelled | Scheduled conversation did not happen | Terminal event log | N/A | Routes Person from Conversation scheduled back to Replied and creates reschedule task | Clear stale Person conversation date |
| Interviews.Status | To schedule | Round exists but no date is set | Temp active | Scheduled, Cancelled | Creates scheduling task; removes scheduled-date timing | Clear Interview date/Expected response and pause prep |
| Interviews.Status | Scheduled | Round has an Interview date | Active | Completed, Reschedule, Cancelled | Creates prep-planning task, expected response date, skips scheduling task | Requires Interview date; clear missing-date flag once scheduled |

Stage 5 findings:

## Issue: Cancelled conversations left stale scheduled dates on People

Severity: P2

Stage: 5
Area: State machines and dropdown semantics
Tab/surface: People / Conversations / Home Upcoming
Column/function: `routeInteractionStatusForPerson`, `routePersonConversationCancelled`, `COLS.PEOPLE.CONVERSATION_DATE`

Evidence:
- Code evidence: `routePersonConversationCancelled` moved a scheduled person back to `Replied` and cancelled `Conversation prep`, but did not clear `COLS.PEOPLE.CONVERSATION_DATE`.
- Code evidence: `collectUpcomingItems` correctly filters People upcoming items to `stage === 'Conversation scheduled'`, so Home was protected, but the source row still carried stale date state.

Current behaviour:
Cancelling a scheduled conversation changes the relationship status but leaves the old conversation date on the People row.

Expected behaviour:
The scheduled date belongs to the temporary `Conversation scheduled` state. Cancelling should clear that date and create/keep the reschedule task.

User impact:
The People row no longer looks like a conversation is still scheduled after cancellation.

Workflow impact:
Conversation cancellation cleanly returns the person to `Replied` with a reschedule task, without stale scheduling residue.

Data/integrity impact:
Medium. Home was not polluted, but source data was misleading.

Automation boundary:
L2 cleanup. Do not change the People/Conversations schema.

Recommended fix:
- Code change: Clear `COLS.PEOPLE.CONVERSATION_DATE` in `routePersonConversationCancelled` when the person was `Conversation scheduled`.

Acceptance tests:
1. Cancelling a scheduled conversation changes People status to `Replied`.
2. The People `Conversation date` is cleared.
3. Open `Conversation prep` is cancelled.
4. A `Reschedule conversation` task is created/reused.

## Issue: Interview status direct edits did not define To schedule/Scheduled transitions

Severity: P1

Stage: 5
Area: State machines and dropdown semantics
Tab/surface: Interviews / Tasks / Home Upcoming
Column/function: `onEditRounds`, `scheduleInterviewRound`, `pauseInterviewPrepForReschedule`

Evidence:
- Code evidence: `DROPDOWNS.ROUND_STATUS` includes `To schedule` and `Scheduled`, but `onEditRounds` only handled `Completed`, `Reschedule`, and `Cancelled` when the Status column changed.
- Code evidence: Date edits ran the scheduling cascade, but direct status edits could silently leave stale Interview date / Expected response / prep tasks.

Current behaviour:
Changing Status to `To schedule` did not clear old scheduling state. Changing Status to `Scheduled` did not validate or run the scheduling cascade.

Expected behaviour:
`To schedule` clears schedule-specific dates and creates/reuses a scheduling task. `Scheduled` either runs `scheduleInterviewRound` when an Interview date exists or flags `[missing-date]` and creates/reuses the scheduling task.

User impact:
Interview status now says what the row actually means; direct dropdown edits no longer create contradictory state.

Workflow impact:
Interview scheduling/prep tasks stay aligned with round status.

Data/integrity impact:
High. Interview date, expected response, prep work, and Home upcoming all depend on this state.

Automation boundary:
L2 state cleanup. Do not change interview outcome semantics or prep-plan structure.

Recommended fix:
- Code change: Add `To schedule` handling in `onEditRounds`.
- Code change: Add `Scheduled` handling in `onEditRounds`.
- Code change: Clear `[missing-date]` inside `scheduleInterviewRound`.

Acceptance tests:
1. Status `To schedule` clears Interview date and Expected response/follow-up date.
2. Status `To schedule` creates/reuses an Interview scheduling task and pauses prep.
3. Status `Scheduled` with a date runs `scheduleInterviewRound`.
4. Status `Scheduled` without a date adds `[missing-date]` and creates/reuses scheduling work.
5. Scheduling with a date clears `[missing-date]`.

Do not do:
- Do not change Interview official outcome values.
- Do not change prep-plan task schema.
- Do not make Home Upcoming show cancelled/rescheduled rounds.

Result:
Implemented in current batch.

Verification:
- `git diff --check`
- Apps Script syntax check with bundled Node
- Duplicate top-level function check: 581 functions, 581 unique, 0 duplicates
- HEADERS/COLS schema check clean
- Stage 5 column config bounds check clean

## Stage 6 - Cross-Tab Workflows

Required output:

| Workflow | Trigger | Source update | Decision? | Task? | Popup? | Today eligible? | Completion effect | Cleanup | Gap | Fix |
|---|---|---|---:|---:|---:|---:|---|---|---|---|
| Add/update person / People source scan | Home capture, onboarding, source-led scan result, referral/person capture | Writes or updates People row and optional Organisation link | No for identified people; outreach is later | No automatic outreach task for Identified people | Capture popup / source scan popup | Only later Tasks become eligible | Person can later flow to outreach/conversation workflows | Person ID must remain stable when org is added later | No-org person could fork into a second Person row when later captured with an org | Reuse and attach a single blank-org person in `writePersonRow` |

Stage 6 findings:

## Issue: Later organisation capture could fork an existing no-org Person into a second Person ID

Severity: P1

Stage: 6
Area: Cross-tab workflows
Workflow: Add/update person / People source scan / referral contact capture
Tab/surface: People / Conversations / Jobs / Tasks
Column/function: `writePersonRow`, `processPeopleOnboarding`, `processSourceLedPeopleCapture`, `findSingleBlankOrgPersonByExactName`, `attachOrgToPersonRow`

Evidence:
- Code evidence: `writePersonRow(name, org, role)` deduped only against a person with the same name and same organisation. If the same person was first captured without an organisation, then later captured with one, the function created a new Person row and new Person ID.
- Code evidence: `processConversationCapture` already had a special path to attach a blank-org person to an organisation, proving this was the intended workflow for at least one capture route.
- Product evidence: People can start as broad network leads with no org, then later become relevant to an Organisation or Job. That should update the same person record, not split the graph.

Current behaviour:
Some capture paths could preserve the no-org person, while the shared writer used by onboarding/source-led/referral paths could create a duplicate Person row.

Expected behaviour:
If exactly one no-org person with the same name exists, adding that person with an organisation should attach the existing row to the organisation and preserve the Person ID.

User impact:
The People tab remains one record per person instead of splitting contact history.

Workflow impact:
Conversations, linked Jobs contacts, People helper columns, and open Tasks continue pointing to the same Person ID.

Data/integrity impact:
High. Duplicate Person IDs fragment downstream links and make relationship history hard to trust.

Automation boundary:
L2 identity repair during capture. Do not merge ambiguous duplicate people automatically.

Recommended fix:
- Code change: Teach `writePersonRow` to reuse a single blank-org exact-name person when an organisation is supplied.
- Code change: Count/message that reuse correctly in onboarding and source-led people capture.
- Guide update: Guide-last.

Acceptance tests:
1. Existing no-org Person `Alex Lee` keeps the same Person ID when later captured as `Alex Lee` at an Organisation.
2. The People row gets Organisation and Org ID filled.
3. Existing Conversations/Tasks linked to that Person ID remain linked.
4. Source-led people capture counts that case as reused, not new.
5. Ambiguous multiple no-org people are not auto-merged.

Do not do:
- Do not fuzzy-merge people automatically.
- Do not create outreach tasks for source-led identified people.
- Do not change People/Conversations schema.

Result:
Implemented in current batch. `writePersonRow` now attaches a single blank-org exact-name person to the supplied Organisation and preserves the Person ID.

Verification:
- `git diff --check`
- Apps Script syntax check with bundled Node
- Duplicate top-level function check: 581 functions, 581 unique, 0 duplicates
- HEADERS/COLS schema check clean
- Stage 6 column config bounds check clean
