# Codex implementation handover for the full Planner review system

## Purpose

This handover gives Codex explicit instructions for how to review, prioritise, implement, and verify improvements to **The Planner** workbook and Apps Script codebase.

This is not a strategy note. It is an operating manual.

Codex must use this handover to run a structured review and produce implementable fixes across product design, data integrity, workflow logic, automation, user experience, safety, observability, documentation, and regression testing.

Repository:

```text
rohiniatal-oss/Planner
```

Primary code file:

```text
Code.gs
```

Workbook surfaces:

```text
Home
Today
Tasks
Decisions
Sectors
Organisations
Jobs
People
Interviews
Conversations
Guide
```

Core architecture to preserve:

```text
Home = command centre and capture surface
Today = execution surface
Tasks = work source of truth
Decisions = judgement queue and audit trail
Source tabs = durable records
Guide = product manual
```

Source of truth rule:

```text
This handover is the final checklist and operating manual.
Other repo docs may contain useful working notes, but they are not controlling.
If a useful rule, finding, status, or plan appears elsewhere, migrate it here before using it as a review gate.
Do not treat chat history or older docs as authoritative unless the point is reconciled into this file.
```

Current repo baseline when this checklist was consolidated:

```text
Latest local main checked during consolidation: af5413c Clarify Today planning controls.
Live Google Sheet may still lag repo code until the bound Apps Script Code.gs is updated.
Guide updates remain deferred until behaviour and surface copy settle.
```

---

# 1. Required operating rules for Codex

## 1.1 Do not start with code

Codex must not immediately implement fixes.

Codex must first produce the required review outputs for each stage, classify issues, prioritise them, and only then implement scoped changes.

## 1.2 Treat this as a product system

Codex must review The Planner as:

```text
a job-hunt operating system
```

not as:

```text
a spreadsheet with helper scripts
```

Every fix must improve at least one of:

```text
clarity
trust
job-hunt navigation
daily execution
data integrity
workflow correctness
automation quality
recoverability
long-term usability
```

## 1.2A Product Excellence Review

Before treating a stage as complete, Codex must also run a Product Excellence Review.

This is not a bug review, code review, or narrow UX review. Codex must review The Planner as if it were the Head of Product for a world-class job-search operating system. Assume no current implementation is sacred. Challenge workflows, terminology, information architecture, tabs, menus, popups, columns, and whether the user should have to think about the concept at all.

The goal is not to preserve existing workflows. The goal is to make the Planner feel exceptional for someone managing a complex job search.

Required lenses:

| Lens | Question Codex must answer |
|---|---|
| 1. Right problem | Is this solving a real user problem, or an implementation problem? Could the feature disappear? |
| 2. Cognitive load | What does the user still have to remember, decide, or interpret unnecessarily? Where do they pause and wonder what to do next? |
| 3. Behaviour guidance | Does the Planner naturally encourage good job-search behaviour, or rely on discipline? |
| 4. Mental model | Could a new user explain Home, Today, Tasks, Decisions, and source tabs after five minutes without the Guide? |
| 5. Emotional quality | Where does the product reduce anxiety, create momentum, create guilt, or feel overwhelming? |
| 6. Subtraction | What can merge, disappear, become automatic, become a recommendation, or become one button? |
| 7. Intelligence | What should the system infer, recommend, explain, or adapt to instead of asking the user? |
| 8. Product scale | Will the experience still feel usable after 500 tasks, 200 people, 100 organisations, 50 interviews, and a year of history? |
| 9. Delight | Where does the product anticipate a need, save unexpected time, or feel clever? Where is delight missing? |
| 10. Best-in-class comparison | What would Notion, Linear, Motion, Superhuman, or Raycast remove, simplify, automate, surface, or rename? |

Codex must also include:

| Exercise | Required output |
|---|---|
| Product Reimagination | If rebuilding from scratch, what would the ideal product be? Which current assumptions would not survive? |
| Remove 30% | Which 30% adds the least value, feels like implementation artifact, or should merge/disappear/be automated? |
| Product Taste | Would this feel premium, calm, trustworthy, obvious, and worth opening every morning? Where does it still feel like a spreadsheet instead of a product? |
| Zero-Based Product Review | Compare the ideal job-search operating system against the current Planner and identify structural gaps, not just incremental fixes. |

Product Excellence findings must be separated into:

| Type | Meaning |
|---|---|
| Immediate safe fix | Improves the product model without schema or workflow risk. |
| Structural redesign candidate | Bigger change that may require user approval or staged migration. |
| Backlog taste improvement | Valuable, but not blocking current correctness or trust. |

## 1.3 Preserve the core boundaries

Codex must not violate these boundaries:

| Surface | Owns | Must not become |
|---|---|---|
| Home | Start here, decide, capture, see urgent state | raw data table or dense dashboard |
| Today | Do work now, capacity, recovery | backlog or capture surface |
| Tasks | Work source of truth | judgement queue |
| Decisions | Judgement queue and audit trail | second task table |
| Source tabs | Durable records | daily operating surfaces |
| Guide | Explanation after behaviour is stable | substitute for clear UI |

## 1.4 Use this automation rule

```text
Automate mechanics.
Route obvious work.
Ask for judgement.
Use popups for nuance.
Require confirmation for destructive actions.
Never silently make strategic or social decisions.
```

## 1.5 Do not create task spam

Codex must not create new automations that generate tasks before user intent is clear.

Examples:

```text
Do not create outreach tasks merely because a person was discovered.
Do not create application tasks merely because a job was discovered.
Do not create people/job scan tasks merely because an organisation exists.
Do not create duplicate interview-prep tasks.
Do not create tasks linked to broken source records.
```

## 1.6 Surface placement and ordering rule

Every visible item must pass the surface-placement test:

```text
What is the user trying to do at this moment?
Which surface owns that moment?
Is the item actionable there?
What would be lost if it lived one tab deeper?
Does this make Home/Today calmer or more dashboard-like?
```

Default placement:

| Surface | Show here when | Do not show here when | Ordering principle |
|---|---|---|---|
| Home | It needs cross-workbook attention, judgement, capture, setup/repair trust, or a next step into Today | It is raw backlog, source-table detail, helper state, or ordinary executable work | Critical warnings/setup -> pending judgement -> capture -> Today state -> open/waiting/scheduled items -> quiet utilities |
| Today | It is executable now, affects today's capacity/selection, or is recovery work that blocks execution | It is source recordkeeping, backlog browsing, or a judgement queue | Plan controls -> plan state -> committed work -> options/spare-capacity work -> needs-planning recovery -> end-of-day wrap-up |
| Tasks | It defines work existence, readiness, sequencing, blocking, due dates, or audit context | It is the user's daily landing page or source-record substitute | Task text/status/readiness before helper/audit detail |
| Decisions | It requires judgement and Yes/No has a real consequence | It is already executable work or passive reference data | Pending/overdue judgement first, then action/result/audit context |
| Source tabs | It is durable truth about a sector, organisation, job, person, interview, or conversation | It is only a daily action, transient reminder, or operating dashboard metric | Identity/link fields -> user-owned facts -> state/outcome -> derived helpers -> notes |
| Guide | It explains stable behaviour after the workflow is settled | It compensates for unclear UI or carries instructions needed for today's action | Start/setup -> daily routine -> capture -> tab roles -> recovery/troubleshooting |

## 1.7 Visible-action readiness rule

For every menu item, checkbox, link, row action, popup entry, and visible helper action, answer:

```text
Why would the user need to see this?
What decision, recovery path, or outcome does it support?
If it is removed from the surface, does anything important become impossible?
If it stays, is the label written in user outcome language?
```

If the action is not needed directly, remove it from the user surface or fold it into Repair/automation. If it is needed, keep it and rename it until a first-time user can infer what will happen.

---

# 2. Required end-to-end workflow

Codex must follow this sequence.

```text
Step 1: Run the 16-stage review.
Step 2: Produce all required review tables.
Step 3: Build a prioritised issue backlog.
Step 4: Group fixes into implementation batches.
Step 5: For each batch, write user stories and acceptance tests.
Step 6: Implement only the selected batch.
Step 7: Run or specify verification tests.
Step 8: Update Guide/header copy if behaviour changed.
Step 9: Report completed changes and remaining risks.
```

After every push, Codex must report completion by category:

| Category | Scope | Report after each push |
|---|---|---|
| 0. Product-led experience and navigation | user modes, surface roles, next-step clarity, cognitive load | advanced / unchanged / blocked, with exact commit |
| 1. Trust and data safety | broken links, duplicate IDs, invalid values, stale state, helper sync | advanced / unchanged / blocked, with tests |
| 2. Daily execution and recovery | Today, task readiness, blockers, capacity, end-of-day | advanced / unchanged / blocked, with user-facing effect |
| 3. Workflow and column-flow logic | tab/column lineage, direct edit vs popup parity, source -> task/decision flows | advanced / unchanged / blocked, with affected tabs |
| 4. Home cockpit and cross-tab surfacing | Home state, decisions, open apps, upcoming, warnings | advanced / unchanged / blocked, with Home impact |
| 5. Orientation, copy, labels, Guide-last | headers, menus, empty states, copy, Guide notes | advanced / unchanged / blocked, with copy location |
| 6. Data lifecycle and recovery | snapshot, reset, refresh, repair, restore, destructive actions | advanced / unchanged / blocked, with safety impact |

Current imported category tracker:

| Category | Current status from repo/docs baseline | Next proof needed |
|---|---|---|
| 0 | In progress. Surface placement/order, visible-action, and Product Excellence rules are now part of this final checklist. Several menu/header/Home/Today labels were already improved. | Complete Stage 0, Stage 1, and Product Excellence tables from current code, not memory. |
| 1 | Mostly done in prior implementation notes: invalid dropdown flags, duplicate-ID flags, source-link readiness, and maintenance surfacing exist in repo notes. | Verify against current Code.gs and live-sheet behaviour before marking complete. |
| 2 | In progress. Today control guidance, end-of-day batch flow, and readiness exclusions have prior fixes. | Run Stage 7 Today execution tests, especially capacity/options/locked-row edge cases. |
| 3 | In progress. Several source tabs were reviewed earlier, but final checklist requires full column lineage tables before more broad implementation. | Build column ownership/lineage table tab by tab from current Code.gs. |
| 4 | Pending/in progress. Home state, warnings, and decision cards have prior fixes; live visual retest remains open. | Run Stage 8 Home cockpit review and verify no Home/Today contradiction. |
| 5 | Pending/in progress. Header/menu copy has been improved, but Guide remains intentionally deferred. | Run Stage 12 copy backlog; update Guide only in Stage 14. |
| 6 | Pending. Backup-before-onboarding-reset exists in prior implementation notes, but full lifecycle inventory is not complete. | Run Stage 3 inventory of every clear/reset/repair/migration function. |

Imported implementation ledger to verify from current repo:

| Area | Prior implemented improvement | Final-checklist treatment |
|---|---|---|
| Decisions/Home | Missing-source pending Decisions are hidden from Home and can be auto-dismissed during helper backfill. | Verify in Stage 8 and Stage 9 before relying on it. |
| Home | Compact Needs attention strip covers source repair, blocked-task recovery, stale hidden Decisions, parent review, and maintenance health. | Verify in Stage 8 Home cockpit review. |
| Source-led scans | Source-led scan completion opens capture/results handling and supports a no-useful-results path. | Verify in Stage 6 cross-tab workflows and Stage 10 automation. |
| Weekly review | Weekly review summaries are written before Home refresh and surfaced in Home utility area. | Verify in Stage 11 observability. |
| Onboarding | First-run sector onboarding should complete after seed sectors while sub-sector exploration becomes Tasks. | Verify in Stage 0 user modes and Stage 6 sector workflow. |
| Home Upcoming | People follow-up tasks stay out of Home Upcoming; Home focuses on scheduled conversations, interviews, and application checks. | Preserve unless Stage 8 finds a stronger cockpit reason. |
| Repair/data trust | Repair/daily maintenance scan strict dropdowns and duplicate IDs, adding row Notes flags and Home counts. | Verify in Stage 2 data integrity. |
| Reset safety | Normal setup should add/update starting facts without clearing data. Destructive start-fresh belongs in Maintenance, creates a backup first, clears full data bodies, and leaves audit metadata. | Verify in Stage 3 data lifecycle. |
| Today | End-of-day reconcile uses one batch popup instead of one alert per unfinished task. | Verify in Stage 7 daily execution. |
| Home setup | Completed-onboarding action should say Setup options and reopen additive setup. It must not imply that reset is part of onboarding. | Verify in Stage 0/8. |
| Home Today state | Home uses Open Today to build plan / Open Today / Start working depending on Today state. | Verify in Stage 8; live visual retest still required. |
| Today controls | Today explains Focus, Available minutes, Energy, and build/refresh effects in the control area. | Verify in Stage 7 and visual scan. |
| Menus/copy | Setup, automation, capture, row actions, maintenance, one-off task, and Today build language were made more user-facing. | Verify in Stage 12 copy review. |
| Header hints | Workbook header hints use ownership language across source/work/decision surfaces. | Verify in Stage 4 column ownership and Stage 12 copy review. |

Do not mark any imported ledger item complete from this table alone. Each item still needs current-state evidence from `Code.gs`, rendered sheet behaviour where relevant, and the stage-specific acceptance tests.

---

# 3. Required deliverables before implementation

Codex must produce these deliverables before changing code.

```text
1. Stage-by-stage findings summary
2. User mode and journey table
3. Surface role and navigation table
4. Data integrity and trust table
5. Data lifecycle and safety table
6. Column ownership and lineage table
7. State-machine and dropdown table
8. Cross-tab workflow lineage table
9. Today execution review
10. Home cockpit review
11. Decisions vs Tasks separation review
12. Automation intelligence table
13. Observability and maintenance table
14. Copy and micro-UX backlog
15. Visual scan backlog
16. Guide update plan
17. Performance and reliability risk table
18. Prioritised implementation backlog
19. Acceptance test plan
```

If Codex cannot produce these, it must state what is missing and why.

---

# 4. Severity and prioritisation system

## 4.1 Severity

Use these severity levels.

| Severity | Definition | Examples |
|---|---|---|
| P0 | Data corruption, destructive failure, duplicate IDs, wrong cascade | reset without backup, duplicate IDs, source closed but tasks still active |
| P1 | Trust break or major workflow failure | Today shows broken work, Home contradicts Today, popup false success |
| P2 | UX friction, manual burden, incomplete workflow, weak automation | unclear dropdown, missing helper sync, stale decision |
| P3 | Polish, wording, layout, Guide/documentation | rename menu, improve empty state |

## 4.2 Priority formula

Rank issues using:

```text
Priority =
user harm
+ frequency
+ trust impact
+ risk reduction
+ cognitive load reduction
+ job-hunt navigation value
- implementation complexity
- regression risk
```

## 4.3 Fix ordering

Implement in this order unless the user says otherwise:

```text
1. Data corruption and destructive-action safety
2. Home/Today trust breaks
3. Broken-link / stale-state readiness issues
4. Duplicate tasks/decisions and wrong cascades
5. Daily execution friction
6. Core job-hunt journey friction
7. Automation improvements
8. UX copy and visual improvements
9. Guide and documentation updates
10. Performance and maintainability improvements
```

---

# 5. Required issue format

Every issue must use this exact structure.

```markdown
## Issue: [specific title]

Severity: P0 / P1 / P2 / P3

Stage:
Area:
Tab/surface:
Column/function:
Evidence:
- Sheet evidence:
- Code evidence:
- User experience evidence:

Current behaviour:
Expected behaviour:

User impact:
Workflow impact:
Data/integrity impact:
Automation boundary:

Recommended fix:
- Code change:
- Sheet/layout change:
- Dropdown/header/copy change:
- Repair/backfill:
- Guide update:

Acceptance tests:
1.
2.
3.

Do not do:
-
```

Bad issue title:

```text
Improve Home UX
```

Good issue title:

```text
Home says Today is not built while Today contains current Commit rows
```

---

# 6. Required user story format

Every implementation item must include a user story.

```markdown
User story:
As a user, when I [situation], I need the Planner to [help], so that I [outcome].

Current pain:
Target experience:
Automation level:
Implementation scope:
Acceptance test:
Non-goals:
```

Example:

```text
As a user, when I complete a People source scan, I need the Planner to ask what I found and save people as Identified, so that I can capture useful leads without creating outreach task spam.
```

---

# 7. Stage 0: Product and user modes

## 7.1 Purpose

Define who the Planner serves and what daily/product modes it must support.

## 7.2 Codex must review

```text
new user
daily user
low-energy day
missed-days restart
application sprint
interview sprint
networking day
source-led search day
weekly review
repair mode
long-running search after months of data
```

## 7.3 Required output

| User mode | User need | Primary surface | Current friction | Required improvement | Priority |
|---|---|---|---|---|---|

## 7.4 Questions Codex must answer

```text
What is the user trying to do?
What is their likely mental state?
What should the workbook show first?
What should be hidden?
What should the system infer?
What must remain a user judgement?
What is the next safest action?
```

## 7.5 Fix patterns

```text
Add Home guidance for missed-days restart.
Add low-energy/minimum-day cues on Today.
Add source-led discovery flow cues.
Add repair-mode warnings and actions.
Avoid forcing source-tab navigation for daily work.
```

---

# 8. Stage 1: Surface roles and navigation

## 8.1 Purpose

Ensure each surface owns the right job and users know where to go.

## 8.2 Required output

| Surface | Current role | Target role | User action here | Should not do | Current gap | Fix |
|---|---|---|---|---|---|---|

## 8.3 Codex must verify

```text
Home is not a raw data table.
Today is not a backlog.
Tasks owns work existence.
Decisions owns judgement.
Source tabs are records.
Guide explains stable behaviour.
Capture starts from Home where possible.
Daily execution starts from Today.
```

## 8.4 Red flags

```text
Daily user must visit multiple source tabs to know what to do.
Home contains too many raw metrics.
Today shows non-executable work.
Source tabs trigger hidden work without explanation.
Guide is being used to compensate for confusing UI.
```

## 8.5 Implementation examples

```text
Rename menu/sheet language to match user intent.
Move guidance from Guide into relevant empty states or headers.
Add Home “where to start” copy.
Clarify Today refresh/build wording.
```

---

# 9. Stage 2: Data integrity, identity, and trust

## 9.1 Purpose

Verify the workbook can be trusted.

## 9.2 Required output

| Risk | Affected tabs | Detection | Current protection | Gap | Fix | Test |
|---|---|---|---|---|---|---|

## 9.3 Codex must review

```text
IDs generated once
IDs never accidentally reassigned
visible labels match hidden IDs
renames update display/helper fields
deleted sources create orphan flags
duplicate IDs detected
duplicate open tasks detected
duplicate pending decisions detected
formulas match script logic
dropdown validations are current
helper columns are in sync
Home/Today states are truthful
```

## 9.4 Non-negotiable rules

```text
Broken source links must never be Ready for Today.
Home must never contradict Today.
System helper columns must be refreshed or flagged.
Invalid dropdown values must be repaired or blocked.
Closed/cancelled source states must not keep active downstream work.
```

## 9.5 Likely implementation functions

Codex should consider implementing or reviewing:

```javascript
detectOrphanedSourceLinks()
markBrokenLinkTasksNeedsPlanning()
repairMalformedSectorRows()
repairInvalidDropdownValues()
dedupeOpenTasks()
dedupePendingDecisions()
checkHomeTodayConsistency()
backfillHelperColumns()
```

---

# 10. Stage 3: Data lifecycle and safety

## 10.1 Purpose

Separate refresh, repair, reset, snapshot, restore, and migration.

## 10.2 Required output

| Action/function | Type | Destructive? | Data affected | Backup before action? | Confirmation? | Restore path? | Fix |
|---|---|---:|---|---:|---:|---:|---|

## 10.3 Required classifications

| Action type | User meaning |
|---|---|
| Refresh | Recompute derived surfaces, preserve data |
| Repair | Fix workbook structure/helpers, preserve data |
| Snapshot | Save a backup copy |
| Reset | Delete planner data, requires backup/confirmation |
| Restore | Bring back saved data |
| Migration | Change schema safely |

## 10.4 Codex must inventory

```text
all functions that clear data
all functions that wipe onboarding/source data
all functions that rebuild tabs
all functions that reset formulas/dropdowns
all functions that repair rows
all functions that migrate schema
all menu actions that call these functions
```

## 10.5 Non-negotiable destructive-action rule

No destructive action may run without:

```text
clear warning
affected tabs listed
explicit confirmation
snapshot option or requirement
audit note
recovery instruction
```

## 10.6 Implementation targets

Codex should plan:

```javascript
savePlannerSnapshot()
resetAllPlannerData()
refreshAllDerivedData()
showDataSafetyStatus()
confirmDestructiveAction()
```

Do not implement restore casually. If restore is added, it needs a separate migration-safe design.

---

# 11. Stage 4: Column ownership and field lineage

## 11.1 Purpose

Every column must be honest about where its value comes from and what it does.

## 11.2 Required output

| Tab | Column | Role | Owner | Editable? | Source of value | Read by | Triggers logic? | Flows to | Failure mode | Fix |
|---|---|---|---|---:|---|---|---:|---|---|---|

## 11.3 Allowed roles

```text
Identity
Linking
Display
Manual input
Status
Date / scheduling
Routing
Execution
Helper
Audit
Notes / context
Legacy compatibility
UI control
```

## 11.4 Codex must answer for every column

```text
Where does this value come from?
Who should edit it?
Is it popup-driven, direct-edit, formula, cascade, repair, or maintenance?
What code runs when it changes?
What downstream functions depend on it?
What happens if it is blank?
What happens if it is stale?
Does this column belong here?
Is the label clear?
```

## 11.5 Red flags

```text
System-derived column looks editable.
User-editable column has unclear consequence.
Dropdown drives logic but invalid values are allowed.
Notes field contains undocumented machine-readable tags.
Column is legacy but still used for fresh work.
Column duplicates another tab’s source-of-truth field.
```

---

# 12. Stage 5: State machines and dropdown semantics

## 12.1 Purpose

Dropdowns and statuses must have explicit meanings, valid transitions, and cleanup behaviour.

## 12.2 Required dropdown output

| Dropdown | Used in | Values | Strict? | Drives code? | Missing values | Legacy values | Fix |
|---|---|---|---:|---:|---|---|---|

## 12.3 Required state-machine output

| State field | State | Meaning | Active/terminal/temp | Valid next states | Downstream effects | Cleanup required |
|---|---|---|---|---|---|---|

## 12.4 Codex must review these state fields

```text
Tasks.Status
Tasks.Ready for Today
Decisions.Decision
Jobs.Application status
Jobs.Application result
People.Relationship status
Interviews.Status
Interviews.Official outcome
Organisations.Status
Sectors.Status
Conversations.Interaction status
Conversations.Outcome
```

## 12.5 Red flags

```text
Status value mixes intent and outcome.
Outcome value is actually a workflow state.
Terminal state leaves open tasks.
Status change silently does nothing.
Status change triggers too much.
Dropdown value has no code path.
Legacy value is still used for fresh rows.
```

---

# 13. Stage 6: Cross-tab workflows

## 13.1 Purpose

Trace complete flows across tabs from source event to completion and cleanup.

## 13.2 Required output

| Workflow | Trigger | Source update | Decision? | Task? | Popup? | Today eligible? | Completion effect | Cleanup | Gap | Fix |
|---|---|---|---:|---:|---:|---:|---|---|---|---|

## 13.3 Workflows Codex must trace

```text
Sector selection
Market mapping
Organisation classification
Org research
Org job scan
Opportunity scan
People sourcing
People source scan
Outreach
Send outreach
Contact follow-up
Reply and arrange conversation
Conversation prep
Reschedule conversation
Conversation debrief
Referral search
Application preparation
Application blocker
Submit application
Check application response
Offer decision
Interview scheduling
Plan interview prep
Interview prep
Day-before review
Thank-you and debrief
Interview follow-up
Task unblocker
Admin
```

## 13.4 Required flow format

For each workflow, Codex must document:

```text
Start event
→ source row update
→ decision created or skipped
→ task created or skipped
→ popup opened or skipped
→ Today eligibility
→ completion behaviour
→ source update
→ stale work cleanup
→ audit/result
```

## 13.5 Red flags

```text
Flow starts in wrong tab.
Task appears before user intent.
Decision is skipped even though judgement is needed.
Task is created when a Decision is needed.
Completion does not update source.
Stale tasks/decisions remain after completion.
Today pulls work before it is executable.
```

---

# 14. Stage 7: Today execution system

## 14.1 Purpose

Review daily execution, task readiness, capacity, and recovery.

## 14.2 Required output

| Today element | Current behaviour | Expected behaviour | Gap | Fix | Test |
|---|---|---|---|---|---|

## 14.3 Codex must review

```text
task selection
Ready for Today derivation
capacity logic
minimum day
recommended day
Options vs Commit
focus and energy
manual pull
locked rows
blocked/deferred/skipped/done/cancelled
parent-child readiness
end-of-day reconcile
Needs planning section
Today refresh behaviour
```

## 14.4 Today exclusion rules

Today must not show as executable:

```text
blocked tasks
parent/container tasks
waiting child tasks
broken-link tasks
unplanned multi-day tasks
terminal tasks
closed/cancelled source work
```

## 14.5 Tests required

```text
Broken-link task does not appear.
Parent task does not appear.
Waiting child does not appear.
Blocked task does not appear as executable.
Manual pull rejects non-ready task.
Locked row cannot preserve impossible work.
Overcapacity is visible.
Needs planning explains reason.
```

---

# 15. Stage 8: Home cockpit system

## 15.1 Purpose

Review whether Home answers what needs attention and where to go next.

## 15.2 Required output

| Home section | User question answered | Current behaviour | Gap | Better behaviour | Fix |
|---|---|---|---|---|---|

## 15.3 Codex must review

```text
critical warnings
pending decisions
Today state
Capture update
open applications
upcoming items
waiting/follow-up state
blocked/needs planning/broken-link counts
repair/reset/safety status
Guide/setup links
section order
empty states
```

## 15.4 Home rules

```text
Home should show the right things, not everything.
Home should not be a dense dashboard.
Home should not contradict Today.
Home should make next navigation obvious.
Home warnings must be compact and actionable.
```

## 15.5 Tests required

```text
Home shows Ready when Today has a current plan.
Home shows Stale when Today is old.
Home shows Not built only when no usable plan exists.
Home shows critical system warnings first.
Home decision card explains action and consequence.
```

---

# 16. Stage 9: Decisions vs Tasks separation

## 16.1 Purpose

Ensure judgement and work are properly separated.

## 16.2 Required output

| Trigger/output | Should be Decision? | Should be Task? | Should be Popup? | Current behaviour | Fix |
|---|---:|---:|---:|---|---|

## 16.3 Codex must verify

```text
Judgement goes to Decisions.
Executable work goes to Tasks.
Nuanced capture goes to popup.
Decision Yes clearly says what it will do.
Decision No resolves cleanly.
Popup decisions stay pending until popup success.
Accepting decision creates/reuses exactly one task or route.
Tasks have enough context to be done from Today.
```

## 16.4 Red flags

```text
Decision behaves like generic task.
Task requires judgement before it can be done.
Decision action type is misleading.
Decision creates duplicate task.
Popup failure marks decision Yes.
No/Auto-dismiss does not record reason.
```

---

# 17. Stage 10: Automation and workflow intelligence

## 17.1 Purpose

Review what the system should automate, suggest, route, ask, or never touch.

## 17.2 Required output

| Automation candidate | Current behaviour | Correct level | Risk | User override | Implement? |
|---|---|---|---|---|---|

## 17.3 Automation levels

| Level | Meaning |
|---|---|
| L0 | Do not automate |
| L1 | Silent helper |
| L2 | Flag/warning |
| L3 | Decision |
| L4 | Task |
| L5 | Popup |
| L6 | Explicit confirmation |

## 17.4 Codex must check

```text
manual burden
missed follow-ups
duplicate/stale work
source-led discovery defaults
application planning routing
interview prep routing
networking lifecycle
stale state cleanup
task-spam risk
```

## 17.5 Non-negotiables

```text
Do not silently decide to apply.
Do not silently decide to reach out.
Do not silently accept/reject/close meaningful opportunities.
Do not convert every suggestion into work.
Do not automate social or strategic judgement.
```

---

# 18. Stage 11: Observability, audit, and maintenance

## 18.1 Purpose

Make system health and automation outcomes visible.

## 18.2 Required output

| System signal | Where stored | Where surfaced | Current gap | Fix |
|---|---|---|---|---|

## 18.3 Codex must review

```text
trigger health
daily maintenance heartbeat
weekly review heartbeat
last Home refresh
last Today build
last repair result
last snapshot
last reset
last automation error
last maintenance error
auto-dismissed decisions
repair summaries
automation-created task notes
```

## 18.4 Required user-facing surfaces

```text
Home for critical health
Guide or maintenance section for detailed logs
toasts/alerts for immediate actions
notes/results for row-level automation
```

## 18.5 Red flags

```text
Failure only visible in Apps Script logs.
Repair changes are not reported.
Auto-dismissed decisions have no reason.
Snapshot/reset not audited.
Home warning has no action.
```

---

# 19. Stage 12: Copy and micro-UX

## 19.1 Purpose

Ensure wording uses user language and explains actions clearly.

## 19.2 Required output

| Surface | Current wording | Problem | Better wording | Implementation location |
|---|---|---|---|---|

## 19.3 Codex must review

```text
headers
dropdown labels
menus
toasts
alerts
popups
empty states
warnings
Guide text
task titles
decision cards
notes/help text
```

## 19.4 Copy rules

```text
Use user language, not backend language.
Prefer verbs that describe outcome.
Warnings must tell the user what to do.
Success messages must say what changed.
Empty states must guide.
Do not over-explain in dense cells.
```

## 19.5 Examples

```text
Populate Today → Build / refresh Today’s plan
Set up triggers → Turn on Planner actions
Add update → Capture update
Decision due date → Review by
Broken link → Repair linked source before this can appear on Today
```

---

# 20. Stage 13: Visual design, scanability, and interaction

## 20.1 Purpose

Review the actual sheet feel after logic/copy changes.

## 20.2 Required output

| Tab | Visual issue | User impact | Fix | Screenshot/live-sheet check needed? |
|---|---|---|---|---|

## 20.3 Codex must review

```text
tab order
section order
row heights
column widths
frozen rows/columns
hidden helper columns
manual vs system cell styling
colour consistency
conditional formats
orphan dropdowns
stale fills
important controls discoverability
Home/Today trustworthiness
```

## 20.4 Visual rules

```text
Important fields should be visually dominant.
Helper fields should be grey/hidden.
Manual fields should be obviously editable.
Warnings should be visible but not noisy.
Colour should not be the only signal.
Rows should be scannable in two seconds.
```

---

# 21. Stage 14: Guide and documentation

## 21.1 Purpose

Guide explains the finished system. It should not compensate for confusing UI.

## 21.2 Required output

| Guide section | Needs update? | Behaviour documented | Missing content | Fix |
|---|---:|---|---|---|

## 21.3 Required Guide order

```text
1. Start here
2. Daily routine
3. Capturing updates
4. How Today works
5. How Decisions and Tasks work
6. Source tabs and what each owns
7. Automation rules
8. Repair, reset, snapshot, and safety
9. Troubleshooting
10. Column/dropdown/tag dictionaries
```

## 21.4 Codex must update Guide when changing

```text
workflow behaviour
dropdown values
status meanings
Today logic
Home sections
automation
repair/reset/safety
tags
menus
popups
```

---

# 22. Stage 15: Performance, reliability, and Apps Script constraints

## 22.1 Purpose

Ensure the Planner remains fast and reliable as data grows.

## 22.2 Required output

| Function/path | Performance/reliability risk | User impact | Fix | Test |
|---|---|---|---|---|

## 22.3 Codex must review

```text
bulk reads/writes
getRange loops
full-sheet scans
Home/Today refresh frequency
formula recalculation
locks
trigger reliability
popup authorization
scheduled job overlap
schema migration risk
large-data behaviour
```

## 22.4 Required scale test assumptions

Review as if the workbook has:

```text
500 tasks
200 people
150 organisations
100 jobs
50 interviews
500 conversations
```

## 22.5 Red flags

```text
per-row getRange in loops
refreshHome called repeatedly inside cascades
populateToday called inside many row loops
structural formatting applied on every capture
ID generation without lock on mutating paths
trigger health not checked by maintenance
```

---

# 23. Stage 16: Implementation planning, gates, and tests

## 23.1 Purpose

Convert review into safe implementation.

## 23.2 Required implementation backlog

| Issue | Severity | Stage | User impact | Dependency | Batch | Acceptance tests |
|---|---|---|---|---|---|---|

## 23.3 Implementation gates

### Gate 1: Review complete

Required before coding:

```text
all stage tables completed
issues classified
user stories written for implementation candidates
acceptance tests drafted
```

### Gate 2: Batch scope selected

Codex must identify:

```text
Must fix now
Should fix next
Later
Do not change
```

### Gate 3: Regression risk check

Before coding, answer:

```text
Does this affect schema?
Does this affect dropdowns?
Does this affect onEdit routing?
Does this affect Today selection?
Does this affect Home summary?
Does this affect task completion?
Does this affect source-tab cascades?
Does this need migration/backfill?
Does this need Guide updates?
```

### Gate 4: Implementation report

After coding, report:

```text
files changed
functions changed
schema changed?
dropdowns changed?
repair/backfill added?
Guide updated?
tests run/specified
known remaining risks
```

## 23.4 Acceptance test library

Codex should reuse and expand these tests:

```text
First-use orientation
Daily-use Home/Today trust
Broken-link readiness
Application planning
Source-led people scan
Source-led opportunity scan
Interview prep
Cancelled interview cleanup
Rejected job cleanup
Closed person cleanup
Reset/snapshot safety
Guide documentation
Performance sanity
```

---

# 24. Recommended implementation batches

Codex should not attempt all fixes at once.

## Batch 1: Data safety and trust

```text
snapshot/reset review
Home/Today consistency
timezone warning
broken-link readiness blocking
malformed row repair
critical Home warnings
```

## Batch 2: Daily cockpit reliability

```text
Today Needs planning reasons
Today execution exclusions
Home queue health
Decision cards
end-of-day recovery
```

## Batch 3: State-machine and workflow cleanup

```text
job status/result cleanup
people relationship transitions
interview status/outcome cleanup
org active/dormant/archive behaviour
stale task/decision cleanup
```

## Batch 4: Automation intelligence

```text
source-led scan result routing
application planning popup-first flow
interview prep date sync
follow-up materialisation
decision auto-dismissal
```

## Batch 5: UX/copy/visual polish

```text
menu names
empty states
headers
dropdown labels
helper visibility
row scanability
```

## Batch 6: Guide and maintainability

```text
Guide rewrite
column dictionary
dropdown dictionary
tag dictionary
workflow dictionary
performance/lock review
```

---

# 25. Anti-patterns Codex must avoid

```text
Do not add a second Today engine.
Do not make Home a dense dashboard.
Do not make Today a backlog.
Do not make Decisions a task table.
Do not make source tabs daily operating surfaces.
Do not solve UX by adding many visible fields.
Do not add dropdown values without behaviour.
Do not create tasks before user intent.
Do not hide product logic in undocumented tags.
Do not run destructive reset without snapshot/confirmation.
Do not leave stale tasks/decisions after terminal state changes.
Do not add automation that cannot explain itself.
```

---

# 26. Definition of done

A change is done only when:

```text
the relevant stage review exists
issue format is complete
user story is written
product impact is clear
workflow impact is clear
automation level is justified
data integrity impact is checked
schema/dropdown impact is checked
repair/backfill is updated if needed
Home/Today impact is checked
Guide/header copy is updated if needed
acceptance tests are specified
regression risks are listed
no anti-pattern is introduced
```

Final standard:

```text
The Planner should reduce manual tracking, make the job hunt navigable, preserve judgement, and be honest about what it knows.
