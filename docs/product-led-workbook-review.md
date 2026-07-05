# Product-led workbook review

Current implementation pass through: current workbook-wide product-led batch after `62b685e` (`Keep people follow-ups out of Home Upcoming`).

Scope: full workbook review using the product-led, exhaustive, and cohesive manuals. Guide changes are intentionally deferred until workbook behavior settles.

Source playbooks incorporated:
- `product_led_codex_planner_review_playbook.md`
- `exhaustive_codex_worksheet_review_and_improvement_playbook.md`
- `codex_planner_cohesive_review_and_implementation_manual.md`
- The Home operating-cockpit guidance and the automation/workflow improvement plans shared in this review batch.

## Product-Led Operating Standard

The controlling lens for this pass is the product-led playbook: The Planner should feel like a competent job-search operating partner, not a spreadsheet the user has to manage.

Review weighting:

| Lens | Weight | Meaning for this pass |
|---|---:|---|
| Product experience, cognitive design, usability, clarity, navigation | 40% | Does the workbook reduce thinking, remembering, anxiety, context switching, and ambiguity? |
| Workflow and job-hunt logic | 30% | Do workflows match the natural order of a real job hunt? |
| Engineering, automation, intelligence, data integrity | 20% | Does the system automate mechanics, preserve judgement, and avoid lying? |
| Performance, migration, testing, maintenance | 10% | Will this remain stable and usable after months of use? |

Before every change, ask:
- Does this reduce thinking, remembering, anxiety, context switching, or repetitive work?
- Does this preserve user agency, transparency, trust, and recovery?
- Does this scale to months of job-search use?
- Would the user actually want to open this every day?

Product principle:
Minimise thinking, not just clicks. Fewer clicks only help if there are also fewer ambiguities, hidden rules, and ways to get lost.

Required product-led deliverables for each major tab/workflow pass:
- Product purpose statement.
- User journey map.
- Current friction map.
- Tab and column clarity review.
- Workflow logic review.
- Automation boundary review using the L1-L6 ladder.
- Data integrity and trust review.
- UX issue backlog using P0-P3 product severity.
- Implementation plan and acceptance tests.
- Guide/documentation update notes, deferred until the Guide-last phase.

Product-led scoring rubric:

| Dimension | Question |
|---|---|
| Clarity | Does the user understand what this is? |
| Cognitive load | Does it reduce thinking? |
| Navigation | Does it help the user know where to go next? |
| Workflow fit | Does it match the natural job-hunt flow? |
| Trust | Does it explain itself and avoid contradictions? |
| Control | Can the user override and recover? |
| Automation quality | Does it automate mechanics without overreach? |
| Scalability | Does it stay usable after months? |
| Visual hierarchy | Are important things obvious? |
| Delight | Does it reduce anxiety? |

## MECE Review Categories

| Category | Scope | Status |
|---|---|---|
| 0. Product-led experience and navigation | Job-hunt operating partner lens, cognitive load, first impression, navigation, clarity, delight, product severity scoring | In progress |
| 1. Trust and data safety | Repair surfacing, invalid values, duplicate IDs, source-link trust, destructive-action guardrails | Mostly done |
| 2. Daily execution and recovery | Today readiness, task completion, blockers, deferrals, end-of-day wrap-up | In progress |
| 3. Workflow and column-flow logic | Tab-by-tab field ownership, direct edit vs popup parity, source -> Decision -> Task -> Today -> source updates | In progress |
| 4. Home cockpit and cross-tab surfacing | Home as operating cockpit, not dashboard; cross-tab status accuracy and compact attention | Pending |
| 5. Orientation, copy, labels, Guide-last | Header hints, legacy labels, tag dictionary, Guide refresh after behavior settles | Pending |
| 6. Data lifecycle and recovery | Snapshot, reset, refresh, repair, restore, destructive-action inventory, audit and recovery status | Pending |

## Category 0 - Product-Led Experience And Navigation

This category is run across every tab and workflow before treating code-level fixes as sufficient.

North-star question:
Does this make the job hunt easier to understand, continue, and trust?

| Review area | Question | Evidence to inspect | Output |
|---|---|---|---|
| First impression | Does a new user understand the tab in 10 seconds? | rendered tab, header guidance, visible columns, empty state | tab risk + fix |
| Cognitive load | How many visible choices, fields, hidden consequences, and remembered rules exist? | tab columns, popups, status/dropdown options, row actions | friction map |
| Navigation | Does the user know where to start and where to go next? | Home, Today, row actions, links, empty states | next-step clarity gap |
| Workflow fit | Does the sequence match the natural job-hunt order? | source -> Decision -> Task -> Today -> source flows | workflow issue |
| Trust and control | Does the planner explain itself, avoid contradictions, and allow recovery? | Home warnings, Today reasons, helper columns, repair/reset paths | trust issue |
| Automation boundary | Is each action correctly L1-L6: helper, warning, decision, task, popup, or confirmation? | cascades, decisions, popups, destructive actions | automation correction |
| Visual hierarchy | Are the important fields and warnings visually obvious? | colors, hidden columns, helper styling, frozen columns | UX/layout issue |
| Delight and anxiety reduction | Does the surface make progress feel clearer and safer? | feedback copy, empty states, success messages | wording/flow fix |

Category 0 acceptance standard:
- Every major workbook pass must include a product-purpose statement and user journey map.
- Every implementation batch must state which product-led category problem it reduces.
- A technically correct change is not complete if it makes the workbook harder to understand or more anxiety-inducing.
- Home must remain an operating cockpit, not a dashboard.
- Today must remain an execution surface, not a backlog.
- Source tabs must remain records, not daily operating surfaces.

Category 0 current workbook scan:

| Surface | Product purpose | 10-second user question | Main Category 0 risk | Current fix / next action |
|---|---|---|---|---|
| Home | Start, decide, capture, trust system health | What needs my attention and where do I start? | Tiny action labels can imply hidden destructive behavior; Home can drift toward dashboard creep | Rename Home reset action to Redo setup with safety note; keep Home compact |
| Today | Execute today's realistic work | What can I do now? | Capacity and recovery must stay understandable under stress | Batch end-of-day done; retest over/under-capacity messaging |
| Tasks | Work source of truth | Why is this work ready, blocked, waiting, or planned? | Helper/status columns can feel like backend machinery | Keep Ready for Today visual; document tags later |
| Decisions | Judgement and audit | What judgement is needed and what will Yes/No do? | Decisions can look like generic tasks if action text is vague | Router and Home cards improved; keep checking stale/missing sources |
| Sectors | Strategic universe | What markets am I exploring? | Parent/sub-sector model needs examples | Guide examples later; keep malformed rows repairable |
| Organisations | Target universe | Which organisations are active and why? | Active/Dormant meaning and review state can be invisible | Home/weekly summary partly improved; continue org review visibility later |
| Jobs | Opportunity/application record | What is the application state and next step? | Direct sheet edits can feel equivalent to popup workflows when they are not | Continue Category 3 Jobs column-flow scan |
| People | Relationship pipeline | Who is this and what should happen next? | Identified vs outreach intent can be over-automated | Keep Identified inert; follow-ups stay in Tasks/Today |
| Interviews | Round and prep router | What round is next and what prep/outcome work exists? | Legacy prep labels can confuse the current task-based prep model | Defer label/Guide cleanup until behavior stabilizes |
| Conversations | Interaction history | What happened, with whom, and what follow-up exists? | System logs and outcomes can look equal-weight | Keep as history; improve outcome clarity later |
| Guide | Operating manual | How do I use this safely? | Needs to lag behavior changes until stable | Guide-last by user request |

Category 0 issue queue:

| Issue | Severity | Product impact | Category link | Status |
|---|---|---|---|---|
| Home completed-onboarding action says Reset | P1/P2 | A vague label beside a checkbox makes a destructive-adjacent path feel unsafe and unclear | 0 + 6 | Fixed: Home now says Redo setup and notes backup behavior |
| Full workbook first-impression map missing from plan | P2 | Review could drift back into technical fixes without proving user comprehension | 0 | Fixed in this doc |
| Home Needs attention action is too generic | P1/P2 | Blocked/parent task recovery could incorrectly point users to Repair all tabs | 0 + 4 | Fixed: Home now picks an action hint based on the attention types |
| Maintenance menu says Full refresh | P1/P2 | Users cannot tell whether refresh is safe or reset-like | 0 + 6 | Fixed: menu says Refresh derived data (safe), and success toast says source rows were not cleared |
| Home/Today live visual retest still pending | P1/P2 | Current code may be correct but user trust depends on visible state | 0 + 4 | Pending |
| Legacy/intermediate labels still visible | P3 | Users may see old workflow language after behavior changed | 0 + 5 | Guide/header pass later |

Implemented after this review began:
- Missing-source pending Decisions are hidden from Home and auto-dismissed during decision helper backfill.
- Home now has a compact Needs attention strip for source repair, blocked-task recovery, stale hidden Decisions, parent review, and maintenance health.
- Source-led scan completion opens a capture popup, and now has a direct "Nothing useful found" completion path.
- Weekly review summaries are written before Home refresh and surfaced in the Home utility area; stale weekly review also appears in Needs attention.
- First-run sector onboarding is already corrected in code: setup is marked complete after seed sectors, while sub-sector exploration is routed as Tasks.
- Product decision: People follow-up tasks stay in Today/Tasks; Home Upcoming stays focused on scheduled conversations, interviews, and application checks.
- Repair and daily maintenance now scan strict dropdown columns, flag invalid values in row Notes, and Home counts invalid dropdown values as repair-needed.
- Redo onboarding now offers a checked backup-copy option before clearing existing data, and the reset clears full data bodies plus retired header cells instead of only current schema columns.
- Repair and daily maintenance now scan duplicate IDs across core ID columns; Home counts duplicate-ID rows as repair-needed.
- End-of-day reconcile now uses one batch wrap-up popup for unfinished Today work instead of one blocking alert per task.
- Home's completed-onboarding action now says "Redo setup" instead of "Reset" and explains the backup-before-clear behavior in a note.
- Home Needs attention now gives a contextual action hint: Today/Tasks for blocked or parent-task recovery, Maintenance for repair/health items.
- Maintenance now exposes the non-destructive refresh as "Refresh derived data (safe)" and confirms that source rows were not cleared.

## Pass 1 - User Journey Review

| Journey | User goal | Current path | Friction | Confusion | Missing guidance | Better target path | Priority |
|---|---|---|---|---|---|---|---|
| First day / onboarding | Create initial search universe | Home setup card -> setup popup -> source rows/tasks | Low | Seed setup completes; next exploration is task work; redo setup can back up before clearing | Guide should explain setup vs generated tasks later | Keep | Keep |
| Daily use | Know what to do now | Home -> Today -> mark work | Low/medium | Home has plan, decisions, apps, upcoming, but critical warnings are not clearly first-class | Why something needs repair | Home warning strip + Today needs-planning details | P1 |
| Weekly review | Keep stale search alive | time trigger -> org review decisions/tasks -> Home summary | Low | Review output is now visible in Home utility area | Details remain in Tasks/Decisions/source tabs | Keep | Keep |
| Source-led opportunity discovery | Run flexible scans and capture findings | Task -> Done -> result popup | Low | Completion is now direct, with no-results path | None major | Keep | Keep |
| Source-led people discovery | Capture people without outreach spam | Task -> Done -> result popup | Low | Good anti-spam model | "Identified means no outreach yet" in Guide later | Keep | Keep |
| Targeted sector/org mapping | Grow target universe | Sectors/Orgs -> Decisions -> Tasks | Medium | Parent/sub-sector model is clearer now but still hard from sheet alone | Examples | Keep source rows clear; Guide later | P3 |
| Job capture and triage | Store opportunity and decide intent | Home popup or Jobs row -> Decision/app status | Low/medium | Direct Jobs edit vs popup parity remains cognitively heavy | Which columns are required | Popup-first for normal capture; direct row repair only | P2 |
| Application planning | Break application into executable work | In progress -> Home Decision -> popup -> Tasks | Low | Strong current model | What completion updates | Keep | Keep |
| Submission/response | Submit then track waiting/rejection/invite | Submit task popup -> response check -> result popup | Low | Waiting is understandable now | None major | Keep | Keep |
| Networking | Store person, decide outreach, track follow-up | People/Conversations/Tasks | Medium | Relationship status and conversation history split is logical but still dense | Next action meaning | Keep follow-up execution in Today/Tasks; Home shows scheduled conversations only | P2 |
| Interview prep | Schedule, plan prep, debrief, outcome | Interviews -> Plan prep task -> popup -> prep tasks | Low/medium | Stronger after prep model; legacy prep workflows still visible | Legacy vs current prep | Mark legacy workflows in docs/headers later | P3 |
| Blocked-work recovery | Recover blocked/stale tasks | Tasks row actions + Today needs planning | Medium | Recovery exists but not visible on Home as a critical warning | What to do first | Home warning strip; Today needs-planning remains detailed | P1 |
| Repair/data-health | Fix broken links/invalid rows | Maintenance/Repair menu + notes flags | Medium/high | Repair states are in notes and Home summary count, not top-level warnings | Which repair to run | Home "Needs attention" line with action | P1 |
| Month-six search | Stay sane at scale | Maintenance + helper columns | Medium | Notes tags can accumulate; performance may degrade with full scans | What is stale vs historical | Safe repair summaries, eventual Guide dictionary | P2 |

## Pass 2 - Tab Purpose and Target State

| Tab | Purpose | User should do here | User should not do here | Target state | Main current issue | Recommended fix |
|---|---|---|---|---|---|---|
| Home | Command centre | Decide, capture, orient, start Today | Inspect raw data | Critical warnings, decisions, Today, capture, snapshot | Main trust loops now visible; keep live-testing layout | Keep compact, avoid dashboard creep |
| Today | Execution surface | Do ready work, block/defer/complete | Capture source data | Only executable work plus needs-planning section | Good after terminal-source guard; EOD is now batch-based | Keep; live retest |
| Tasks | Work source of truth | Inspect/repair/sequence/block work | Act as daily surface | Ready state honest and visual | Stronger now; notes tags still hidden logic | Document tags later; keep helper colors |
| Decisions | Judgement/audit | Review queue and audit outcomes | Become task table | Action type truthful; stale decisions not on Home | Stale decisions are hidden/auto-dismissed; keep audit readable | Keep |
| Sectors | Strategic universe | Define sector/sub-sector rows | Track work execution | Parent/child clear, retired safe | Needs visual examples, mostly docs | Guide later |
| Organisations | Target universe | Classify, set tier/status | Manually manage every cascade | Status controls suggestions, counts automatic | Active/Dormant review output not prominent | Home review summary later |
| Jobs | Opportunity/application record | Track opportunity/status/deadline/result | Store interview prep detail | Application status/result clean | Looks good structurally | Keep scanning |
| People | Relationship pipeline | Track person/source/status/next action | Store full history | Identified does not imply outreach | Helper outputs useful; relationship follow-up work belongs in Today/Tasks, not Home Upcoming | Keep |
| Interviews | Round tracker/prep router | Track date/status/outcome | Execute prep in sheet columns | Plan prep -> tasks; debrief/outcome | Legacy workflows still visible in dropdown | Docs/header later |
| Conversations | Interaction history | Log interactions/outcomes | Replace People status | Feeds helper fields/follow-ups | Orphaned person links are flagged, not surfaced | Later Home/repair visibility |
| Guide | Manual | Learn routine/recovery | Carry live state | Column/dropdown/tag dictionary | Deferred by user | Do last |

## Pass 3 - UX Scorecard

| Tab | First impression | Load | Visual hierarchy | Scanability | Affordance | Feedback | Empty states | Recovery | Main UX fix |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| Home | 4 | 3 | 4 | 4 | 4 | 4 | 4 | 4 | Live visual retest after deploy |
| Today | 4 | 3 | 4 | 4 | 4 | 4 | 4 | 4 | Live retest batch EOD wrap-up |
| Tasks | 3 | 2 | 3 | 3 | 3 | 3 | n/a | 4 | De-emphasize helpers further later |
| Decisions | 3 | 3 | 3 | 3 | 3 | 4 | n/a | 3 | Missing-source decisions cleanup |
| Sectors | 3 | 3 | 3 | 3 | 3 | 3 | n/a | 3 | Examples/docs |
| Organisations | 3 | 3 | 3 | 3 | 3 | 3 | n/a | 3 | Review-state visibility |
| Jobs | 4 | 3 | 3 | 4 | 3 | 4 | n/a | 4 | Continue column scan |
| People | 3 | 3 | 3 | 3 | 3 | 3 | n/a | 3 | Next-action surfacing |
| Interviews | 4 | 3 | 3 | 4 | 3 | 4 | n/a | 4 | Mark legacy prep later |
| Conversations | 3 | 3 | 3 | 3 | 3 | 3 | n/a | 3 | Orphan visibility |

## Pass 4 - Column Ownership and Data Lineage

Representative risks from current schema:

| Tab | Column | Role | Owner | Editable? | Dropdown? | Written by | Read by | Triggers logic? | Flows to | Failure mode | Recommendation |
|---|---|---|---|---:|---|---|---|---:|---|---|---|
| Tasks | Ready for Today | Helper | Script | No | Yes | `syncTaskPlanningHelpers` | Today pool/Home | Yes | Today/Home | If stale, Today lies | Keep script-derived; block terminal/missing links |
| Tasks | Notes | Notes/context | Mixed | Yes | No | User + scripts | readiness/health | Yes | Today/Home | Hidden tags become invisible logic | Guide tag dictionary later |
| Decisions | Target type/ID | Linking | Script | No | Yes/type | decisions/cascades | Home/router | Yes | Home/source | Missing/terminal source decisions can become stale | Hidden on Home and auto-dismissed during helper backfill |
| Decisions | Decision action type | Routing | Script | Power-user | Yes | inference/router | Home/router | Yes | popups/tasks/source | Label must match Yes behavior | Keep router truthful |
| Jobs | Application status | Status | User/popup/script | Yes | Yes | Jobs edit/popup/tasks | app cascades | Yes | Tasks/Decisions/Today | Wrong status creates/cleans work | Keep strict |
| Interviews | Status | Status | User/popup/script | Yes | Yes | date/outcome/edit | prep/outcome cleanup | Yes | Tasks/Decisions | Cancelled/Completed cleanup risk | Stronger after latest patches |
| People | Relationship status | Status | User/popup/script | Yes | Yes | stage machine | tasks/conversations | Yes | Tasks/Home later | Social intent can be over-automated | Keep Identified inert |
| Organisations | Status | Status | User/popup/script | Yes | Yes | org edit/live evidence | decisions/tasks/review | Yes | Home/Tasks | Active/Dormant not visible enough | Home summary later |

## Pass 5 - Dropdown and State Machine Review

| Dropdown/state | Used in | Values | Strict? | Drives code? | MECE? | Missing/legacy | Action |
|---|---|---|---:|---:|---:|---|---|
| Jobs.Application status | Jobs | Not started/In progress/Submitted/Closed | Yes | Yes | Yes | None | Keep |
| Jobs.Application result | Jobs | Waiting/Interview invite/Rejected | Yes | Yes | Yes for application responses | Offer/Parked moved to Interviews/Offer flow | Keep |
| People.Relationship status | People | Identified -> Closed | Yes | Yes | Mostly | Scheduled conversations show on Home; follow-up tasks stay in Today/Tasks | Keep |
| Interviews.Status | Interviews | To schedule/Scheduled/Completed/Cancelled/Reschedule | Yes | Yes | Yes | Reschedule is temp | Keep, ensure cleanup |
| Interviews.Official outcome | Interviews | Waiting/Next round/Declined/Offer/Parked | Yes | Yes | Yes | None | Keep |
| Tasks.Ready for Today | Tasks helper | Ready/Waiting/Blocked/Parent/Needs planning/Done | Script | Yes | Yes | Terminal source/missing source handling verified for Tasks and pending Decisions | Keep |
| Decisions.Decision action type | Decisions/Home | Create task/Open popup/Update source/Capture data/Dismiss only | Yes | Yes | Yes if router covers all | Missing route falls Pending | Keep |

## Pass 6 - Workflow Lineage Review

| Workflow | Starts from | Decision? | Task? | Today eligible? | Completion effect | Cleanup | Audit/result | Gap | Fix |
|---|---|---:|---:|---:|---|---|---|---|---|
| Application planning | Job In progress | Yes | After popup | Yes, children | Creates component tasks | Dismisses decision | Result/notes | Good | Keep |
| Submit application | App plan task | No | Yes | Yes | Popup records submitted date, creates response check | Skips prep tasks | Job fields | Good | Keep |
| Check application response | Submitted job/materialize | Maybe after task | Yes | Yes when due | Opens result decision/popup | Rejected closes job | Decision result | Good | Keep |
| Interview scheduling | Interview invite/round | No | Yes | Yes | User sets date | Scheduled skips scheduling task | Notes | Good | Keep |
| Plan interview prep | Scheduled interview | No | Yes | Yes | Popup creates prep tasks | Retires changed prep | Notes | Good | Keep |
| Interview follow-up | Completed/waiting interview | Yes | Yes | Yes | Decision records outcome | Outcome cleans work | Decision result | Good | Keep |
| People source scan | Manual/source-led | Optional audit decision/result popup | Yes | Yes | Capture people Identified or close with no results | No outreach spam | Decision/result note | Good | Keep |
| Opportunity scan | Manual/source-led | Optional audit decision/result popup | Yes | Yes | Capture jobs/orgs or close with no results | No spam | Decision/result note | Good | Keep |
| Org Active | Org status Active | Yes | After Yes | Yes | Queues people/job scan decisions | Dormant/Archived clean | Decisions | Good but Home summary weak | Later |
| Market mapping | Sub-sector decision | Yes | Yes | Yes | Capture organisations found | Sector retired skips tasks | Decision/notes | Good | Keep |

## Pass 7 - Automation Boundary Review

| Automation candidate | Burden | Proposed level | Why | Risk if wrong | Override | Implement now? |
|---|---|---|---|---|---|---|
| Hide stale terminal/missing-source Decisions from Home | Medium | L2 safe warning/repair | Home should not ask on dead links | Low | Decisions audit remains | Done |
| Home critical warning strip | Medium | L2 surface issue | Reduces anxiety and repair hunting | Low | Menu repair | Done |
| Source scan result popup | Medium | L5 popup | Requires capture details | Medium | No-results button/cancel popup | Done |
| People outreach from Identified | Medium | L3 decision | Social judgement | High | Manual status/Decision | Do not automate silently |
| Offer decision | Medium | L5 popup | High consequence | High | Still deciding path | Keep |
| Guide dictionaries | Low/medium | Documentation | Self-serve | Low | n/a | Last |

## Pass 8 - Integrity, Repair, and Trust Review

| Integrity risk | Detection | Current protection | Gap | Repair behavior | User warning | Priority |
|---|---|---|---|---|---|---|
| Home/Today mismatch | `todayPlanCounts` | visible-row fallback + warning | Needs live visual test | Refresh Today | Home subline | P1 fixed/retest |
| Broken task source | notes + health sync | Ready = Needs planning | Good | repair flags | Home count/Today needs planning | P1 fixed/retest |
| Terminal source with open task | source terminal check | Ready = Needs planning | Good after latest | source cleanup | Today needs planning | P1 fixed/retest |
| Terminal source with pending decision | terminal filter + backfill | Hidden/auto-dismissed | Good after latest | backfill decisions | Not shown on Home | P1 fixed/retest |
| Missing source with pending decision | health flags notes | Hidden from Home and auto-dismissed by helper backfill | Good | decision helper backfill | Home excludes it | Done |
| Maintenance stale/error | properties | Home attention strip + utility note | Good | none | Home attention strip | Done |
| Invalid dropdown values | strict dropdowns/repair | scan flags invalid values during repair/maintenance | Good | repair tabs/daily maintenance | Home attention + row notes | Done |
| Destructive onboarding reset | setup popup | optional backup copy + full body clear | Good | setup reset | popup confirmation and backup checkbox | Done |
| Duplicate IDs | repair/maintenance duplicate scan | row notes + Home count | Good | repair/manual | Home attention + row notes | Done |
| End-of-day unfinished work | Today wrap-up popup | one batch action table | Good | Today end-of-day checkbox | modal summary | Done |
| Full data lifecycle | reset/repair/refresh/menu actions | backup copy exists for onboarding reset only | Missing productised snapshot/restore/refresh distinction | data safety pass | Home/status/menu eventually | P1 Category 6 |

## Pass 11 - Data Lifecycle And Recovery

Core distinction for this pass:

| Concept | Meaning | User promise |
|---|---|---|
| Refresh derived data | Recompute helpers, Home, Today, counts, warnings, readiness, and summaries | Source records are preserved |
| Repair data/tabs | Reapply structure, headers, dropdowns, formulas, helper fields, and row-level repair flags | Data is not intentionally cleared |
| Reset all planner data | Clear planner records and start over | Destructive, protected, and recoverable via snapshot copy |
| Save planner snapshot | Create a timestamped full workbook backup | User has a fallback before risky actions |
| Restore from snapshot | Replace data bodies from a chosen backup | Phase 2; requires schema/version checks before build |

Required questions for every function or menu action in this category:
- Can it clear, delete, overwrite, migrate, or rebuild user data?
- Is it refreshing derived surfaces, repairing malformed state, resetting source records, taking a snapshot, or restoring data?
- Which tabs and rows are affected?
- Does the user see a clear warning before destructive work?
- Is a snapshot offered or required before destructive work?
- Is the action logged through document properties or Home/menu status?
- Can the user recover, and is the recovery path understandable?

Product rule:
No destructive action may run without a clear warning, explicit confirmation, snapshot option, audit note, and recovery instruction. Refresh and repair must stay clearly separate from reset.

| Action/function | Type | Destructive? | Data affected | Backup before action? | Confirmation? | Restore path? | Risk | Fix |
|---|---|---:|---|---:|---:|---:|---|---|
| `refreshHome` / Home checkbox | Refresh derived surface | No | Home only | n/a | No | n/a | Low | Keep non-destructive |
| `populateToday` | Refresh derived surface | No | Today plan rows | n/a | No | n/a | Low | Keep non-destructive |
| `dailyMaintenance` | Repair/refresh derived data | No | helpers, flags, due tasks, Home/Today | n/a | No | n/a | Medium if stale | Keep; status surfaced |
| `repairAllTabs` | Repair/schema refresh | Mostly no | headers, formulas, dropdowns, helpers, Today/Home/Guide | n/a | Menu action | n/a | Medium if misunderstood | Clarify as repair, not reset |
| `refreshAllDerivedData` / `fullRefresh` | Refresh/repair wrapper | No | derived surfaces and formatting | n/a | Menu action | n/a | Low | Menu now says Refresh derived data (safe); `fullRefresh` retained as compatibility wrapper |
| `completeSetupFromPopup` / redo onboarding | Destructive reset + capture | Yes | Sectors, Organisations, Jobs, People, Conversations, Interviews, Tasks, Decisions | Yes, checked backup copy option | Yes | Manual via backup copy | High | Partial done; Category 6 needs productised snapshot/status |
| Dedicated snapshot function | Snapshot | No | whole workbook copy | n/a | Menu action | Backup is output | Low | Add `savePlannerSnapshot` |
| Dedicated reset all planner data | Destructive reset | Yes | user data tabs and Today rows | Should require/recommend snapshot | Two-step | Manual via snapshot | High | Add only through shared safety layer |
| Restore from snapshot | Restore | Yes | data bodies restored from selected backup | n/a | Two-step | Snapshot source | High/complex | Phase 2, plan before build |

## Pass 9 - Home and Today Cockpit Review

| Surface | Element | Purpose | Current behavior | Gap | Better behavior | Fix |
|---|---|---|---|---|---|---|
| Home | Setup banner | Trigger health | prominent if missing | Good | Keep | Keep |
| Home | Pending decisions | Judgement | top 3 cards | Stale source decisions filtered | Exclude/auto-dismiss broken-link decisions | Done |
| Home | Today plan | execution readiness | reflects Today and warns unverified date | Good | Keep | Retest |
| Home | Capture update | capture | primary capture dropdown | Good | Keep | Keep |
| Home | Open applications | waiting/application state | compact list | Good | Keep | Keep |
| Home | Upcoming | scheduled/waiting | compact list | Good | Keep | Keep |
| Home | System health | recovery | Needs attention strip plus contextual action hint | Good | keep compact | Done |
| Today | Commit list | executable work | ready tasks only | Good after terminal guard | Keep | Retest |
| Today | Needs planning | recovery | reasons/actions | Good | Add missing-decision repair not relevant | Keep |
| Today | Options | spare capacity | options/pull in | Good | Keep | Keep |

## Pass 10 - Engineering, Migration, Performance, Testing

| Area | Current risk | Impact | Fix | Regression test |
|---|---|---|---|---|
| Full-sheet scans | helper sync and repair scan many tabs | slower at scale | cache maps where high-frequency | large-sheet smoke later |
| Notes tags | many tags drive logic | hidden coupling | Guide dictionary last | tag table |
| Repair all tabs | rewrites Guide | conflicts with Guide-last preference only if run now | Defer Guide content changes; keep behavior | Repair smoke |
| Locking | most critical paths locked now | lower race risk | continue menu action audit later | duplicate ID check |
| Apps Script validation | no native tests | regressions possible | keep parse/schema/dropdown checks | each commit |

## Prioritized Issue Backlog

| Issue | Severity | Scope bucket | Reason | Dependency |
|---|---|---|---|---|
| Missing-source pending Decisions can still appear on Home | P1 | Done | Home should not ask user to decide on an orphaned source | none |
| Home critical warnings are not first-class | P1/P2 | Done | Product cockpit should surface broken/stale/maintenance before work | warning summary helper |
| Source-led scan no-results path | P2 | Done | Better UX, not integrity | source result popup |
| Weekly review summary not visible enough | P2 | Done | Reduces "what happened?" anxiety | Home warning/snapshot |
| End-of-day unfinished workflow is too modal-heavy | P2 | Done | Heavy days should not become a popup gauntlet | batch Today wrap-up popup |
| Missing data lifecycle and recovery pass | P1 | Category 6 | Reset/repair/refresh/snapshot/restore are not productised as distinct user concepts | data safety layer |
| Notes/tag logic undocumented | P2 | Guide last | User cannot self-serve repair | Guide dictionary |
| Legacy interview prep workflows still visible | P3 | Guide/header later | May confuse but current routing works | Guide/header pass |

## Implementation Gate for Next Batch

Will the must-fix-now change affect schema? No.
Dropdowns? No.
onEdit routing? No.
Today selection? No.
Home summary? Yes, by hiding broken Decisions.
Source cascades? No.
Migration? No.
Repair/backfill? Yes, decision helper backfill should auto-dismiss missing-source Decisions.
Guide? Deferred.
