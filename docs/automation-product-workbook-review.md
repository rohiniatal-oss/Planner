# Automation and product review - workbook-wide pass

Baseline: current `main` after `62b685e` (`Keep people follow-ups out of Home Upcoming`).

Scope: apply the automation/workflow and product/UX review plans across the workbook. Guide edits remain deferred until the workbook behavior is settled.

Product architecture to preserve:

| Surface | Product role | Boundary |
|---|---|---|
| Home | Command centre | Shows health, judgement, Today state, capture, open applications, scheduled/waiting items. Not a dense dashboard. |
| Today | Execution surface | Shows executable work and needs-planning recovery. Not a backlog or capture surface. |
| Decisions | Judgement queue and audit | Holds choices; Yes/No must match the real action. Not a task list. |
| Tasks | Work source of truth | Owns task existence, status, readiness, blocking, sequencing. Not the daily default surface. |
| Source tabs | Records | Store truth about sectors, organisations, jobs, people, interviews, conversations. Not daily operating surfaces. |

Recent product decision:

| Decision | Reason | Consequence |
|---|---|---|
| Keep People follow-up tasks out of Home Upcoming | Follow-ups are executable work, and putting them on Home can crowd out scheduled conversations, interviews, and application checks. | Today/Tasks own relationship follow-up execution; Home Upcoming stays focused on scheduled or waiting items. |

## Pass 1 - Automation Inventory

| Automation | Trigger | Source tab | Function/path | Output | User-visible? | Level | Risk |
|---|---|---|---|---|---|---|---|
| ID creation | Row creation/capture | all source tabs/Tasks/Decisions | `nextId`, write helpers | Stable IDs | Mostly hidden | L1 | Race if off-lock; mitigated by locked paths. |
| Trigger health | Home refresh/onOpen/repair | Home | `triggerExists`, `checkTriggerHealth`, `refreshHome` | Banner/toast/warning | Yes | L2 | Missing trigger makes popups/dropdowns feel broken. |
| Home attention strip | Home refresh | Home/Tasks/Decisions/maintenance | `collectHomeAttentionItems` | Needs-attention warning | Yes | L2 | Must stay compact; avoid dashboard creep. |
| Today plan build | checkbox/menu/maintenance | Tasks -> Today | `bootstrapToday`, `populateTodayImpl` | Commit/options/needs-planning rows | Yes | L1/L4 surfacing | Wrong readiness breaks trust. |
| Today completion | Today status dropdown | Today/Tasks/source tabs | `onEditToday` -> `completeTodo` | Task status and source cascades | Yes | L4/L5 | Popup-required tasks must not silently complete. |
| Task completion routing | Task status Done | Tasks/source tabs | `completeTodoRow`, `routeTodoCompletion` | Source updates, tasks, decisions, popups | Yes | L4/L5 | Missing handler leaves dead workflows. |
| Decision routing | Decision Yes/No | Decisions/Home | `resolveDecisionAction` | Task, popup, source update, dismissal | Yes | L3/L5 | Generic action labels can mislead. |
| Capture update | Home dropdown/menu | Source tabs | `runCapturePopup`, `completeCaptureFromPopup` | Source rows and follow-up routing | Yes | L5 | Popup must ask only relevant fields. |
| Application planning | Job In progress decision | Jobs/Decisions/Tasks | `runApplicationPlanPopup`, `completeApplicationPlanFromPopup` | Component tasks | Yes | L5 -> L4 | Can create task spam if intent not explicit. |
| Application submission | Submit task completion | Tasks/Jobs | `runSubmitApplicationPopup`, submission handlers | Submitted date/response check | Yes | L5 | Must not use vague applied-date semantics. |
| Application result | Response task or decision | Jobs/Tasks/Decisions | `runApplicationResultPopup`, `handleJobOutcome` | Waiting/rejected/interview invite routing | Yes | L5/L4 | Rejected must clean stale work. |
| Interview prep planning | Scheduled interview / Plan prep task | Interviews/Tasks | `ensureInterviewPrepPlanningTask`, `runInterviewPrepPlanPopup` | Prep parent/child tasks | Yes | L5 -> L4 | Duplicate legacy prep models can confuse. |
| Interview outcome | Official outcome / follow-up decision | Interviews/Jobs/Tasks | `handleInterviewOfficialOutcome`, outcome popup | Next round/declined/offer/parked routing | Yes | L3/L5 | High consequence; no silent closure except explicit outcome. |
| People stage routing | People status edit/popup | People/Tasks/Conversations | `movePersonStage`, `firePersonStageChanged` | Outreach/follow-up/conversation tasks | Yes | L3/L4 | Do not automate outreach from discovery. |
| Conversation outcome routing | Conversations outcome edit | Conversations/People/Tasks/Decisions | `onEditInteractions` | Follow-up tasks/decisions | Yes | L4/L3 | Useful outcome no-op should remain understandable. |
| Source-led scan capture | Opportunity/People source scan completion | Tasks/source tabs | `runSourceScanResultPopup`, `completeSourceScanResultFromPopup` | Captured rows or no-results completion | Yes | L5 | Must avoid outreach/application task spam. |
| Weekly review | Time trigger/menu | Orgs/People/Tasks/Decisions/Home | `weeklyReviewImpl` | Review tasks/decisions/Home summary | Yes | L2/L3/L4 | Summary must be visible and not noisy. |
| Daily maintenance | Time trigger/menu | all tabs | `dailyMaintenance` | helper sync, due tasks, health flags, Today/Home refresh | Yes | L1/L2/L4 | Silent failures make workbook stale. |
| Repair all tabs | Menu | all tabs | `repairAllTabsImpl` | schemas/dropdowns/helpers/Guide/Home/Today | Yes | L1/L2 | Guide rewrite deferred conceptually, but current repair still calls it. |

## Pass 2 - Automation Level Review

| Automation | Current level | Correct level | Why | Risk if wrong | Change needed |
|---|---|---|---|---|---|
| Source row IDs and helper fields | L1 | L1 | Mechanical facts. | User should not manage IDs/helpers. | Keep. |
| Broken source task readiness | L2/L1 | L2 + Today exclusion | Broken work is not executable. | False-ready Today task. | Mostly done; retest. |
| Invalid dropdown values | L2 | L2 | Old/imported values are stale-state problems. | Hidden invalid state can break cascades. | Implemented: repair/maintenance scan flags row Notes; Home counts invalid values. |
| Duplicate IDs | Notes-only L2 | L2 with Home surfacing | IDs are integrity backbone. | Wrong links, duplicate cascades. | Add/verify top-level count in Home attention later. |
| People discovery | L1 capture | L1 only | Discovery is not intent to contact. | Outreach spam. | Keep no-outreach rule. |
| Apply decision | L3/L5 | L3 then L5 | Strategic judgement before task creation. | App tasks before intent. | Keep application planning popup. |
| Interview prep | L5 then L4 | L5 then L4 | Prep depth needs details; tasks are work. | Too many/too shallow prep tasks. | Keep; clean legacy labels later. |
| Offer handling | L5/L3 | L6-ish confirmation/popup | High consequence. | Silent acceptance/rejection impossible. | Keep explicit popup/decision. |
| End-of-day unfinished work | Modal per task | L5 batch popup | Needs context and recovery choices. | Popup gauntlet, missed blocker capture. | Later UX pass. |

## Pass 3 - Workflow Lineage Summary

| Workflow | Start event | Decision? | Task? | Popup? | Today eligibility | Completion effect | Cleanup/audit | Gap |
|---|---|---:|---:|---:|---|---|---|---|
| Sector selection | Onboarding/not-sure/manual | Sometimes | Yes | No | Yes if ready | Creates sector/sub-sector exploration | Sector notes/tasks | Mostly good; Guide examples later. |
| Market mapping | Sector/sub-sector decision | Yes | Yes | Capture orgs on completion | Yes | Captures organisations found | Decision notes | Good. |
| Organisation classification | Org missing/needs classification | Sometimes | Yes | Org capture possible | Yes | Links org to sector/subsector | Org notes | Good after sector/org model. |
| Org research | Weekly/row action | Maybe | Yes | Capture/update org | Yes | Updates org knowledge | Org review state | Home summary now better. |
| Job board scan | Org/menu/source-led | Maybe | Yes | Capture jobs | Yes | Captures jobs found | Decision/result | Legacy/org-specific path okay. |
| Org job scan | Active org/row action | Yes | Yes | Capture jobs | Yes | Captures jobs at org | Decision/result | Good, avoid auto-task from mere org existence. |
| Opportunity scan | Manual/source-led | Optional audit | Yes | Result popup | Yes | Captures job/org or no results | Popup result | Good after no-results path. |
| People sourcing | Active org | Yes | Yes | Capture people | Yes | Captures people for org | Decision/result | Good, no outreach spam. |
| People source scan | Manual/source-led | Optional audit | Yes | Result popup | Yes | Captures Identified people or no results | Popup result | Good. |
| Outreach | Person To outreach | No | Yes | No | Yes | Draft completed creates Send outreach | Person/Task notes | Good; judgement remains in status change. |
| Send outreach | Outreach drafted | No | Yes | No | Yes | Marks outreach sent, sets follow-up date | Interaction log | Good. |
| Contact follow-up | Due outreach/keep-warm | No | Yes | No | Yes when due | Records follow-up sent or next state | Interaction log | Completion behavior should remain clear in Guide. |
| Reply and arrange conversation | Person Replied | No | Yes | Maybe conversation capture | Yes | Schedules/records next relationship step | Decisions dismissed | Good. |
| Conversation prep | Conversation scheduled | No | Yes | No | Yes before date | Prep done | Task audit | Reschedule due sync already addressed earlier. |
| Conversation debrief | Legacy/debrief route | No | Rare/legacy | No | Yes if created | Debrief/follow-up | Conversation log | Legacy workflow still visible. |
| Referral search | Application plan choice | Decision/popup | Yes | Result popup | Yes | Links/adds person or closes referral search | Job contacts/People | Good; no forced referral if none found. |
| Application preparation | Application plan popup | Yes before popup | Yes | Planning popup first | Children ready | Parent/children complete to submit | Job notes | Good. |
| Application blocker | App plan blocker | No | Yes | No | Yes | Unblocks app plan | Task notes | Good. |
| Submit application | Application plan complete | No | Yes | Submission popup | Yes | Sets submitted date and response check | Job fields | Good. |
| Check application response | Submitted + check date | Maybe | Yes | Result popup | Yes when due | Waiting/rejected/interview invite | Job/result audit | Good. |
| Offer decision | Offer outcome | Yes | Yes/popup | Offer popup | Yes if task | Records offer path | Job/decision | Keep high-friction explicitness. |
| Interview scheduling | Interview invite/round | No | Yes | Interview capture | Yes | Schedules interview | Round notes | Good. |
| Plan interview prep | Scheduled interview | No | Yes | Prep plan popup | Yes | Creates prep tasks | Round/task notes | Good. |
| Interview prep | Prep plan popup | No | Yes | No | Ready child tasks only | Prep task completion | Task notes | Legacy workflow labels later. |
| Day-before review | Scheduled interview | No | Yes | No | Yes near date | Final check | Task notes | Good. |
| Thank-you and debrief | Completed conversation/interview | No | Yes | No | Yes | Logs/debriefs | Interaction/round | Good. |
| Interview follow-up | Expected response due | Yes after completion | Yes | Outcome popup/decision | Yes when due | Waiting/next/declined/offer/parked | Decision/result | Good after expected-response fix. |
| Task unblocker | Blocked task row action | No | Yes | Blocker capture later | Yes | Unblocks parent task | Task notes | Good; blocker capture UX can improve. |
| Admin | Manual/not sure | No | Yes | Maybe | Yes if ready | No special route | Task notes | Keep minimal. |

## Pass 4 - Manual Burden and Missing Automation

| Manual burden | Where | Why it is burden | Safer automation | Level | Priority |
|---|---|---|---|---|---|
| Old/imported invalid dropdown values | Data tabs | User cannot see why cascades fail or silently normalize. | Implemented: repair/maintenance scan flags invalid values in row Notes; Home counts invalid values. | L2 | Done |
| Redo onboarding can destroy data | Setup popup | User may want to save existing planner state before reseeding. | Implemented: checked backup-copy option before clearing; backup failure aborts reset. | L5 | Done |
| Duplicate IDs | Hidden ID columns | Links can silently point to wrong row. | Repair scan counts/flags duplicate IDs and Home attention surfaces it. | L2 | P1/P2 |
| End-of-day unfinished work | Today | One modal per unfinished task is heavy. | Batch popup with carry/block/defer choices. | L5 | P2 |
| Notes tag meanings | Tasks/source tabs | Tags drive logic but are not self-serve. | Guide tag dictionary later. | Documentation | P2 Guide-last |
| Legacy interview prep workflows | Tasks dropdown | New model uses generic `Interview prep` parent/children; legacy labels can confuse. | Header/Guide clarify legacy, or retire from fresh creation if safe. | P3 | P3 |

## Pass 5 - Over-Automation and Task-Spam Review

| Automation | Overreach risk | Why risky | Safer treatment | Change needed |
|---|---|---|---|---|
| People follow-up on Home | Medium | Turns Home into a relationship task list. | Keep follow-up execution in Today/Tasks; Home shows scheduled conversations only. | Done by reverting Home Upcoming follow-ups. |
| Active org creates work | Medium | Mere Active state could spam scans. | Active queues Decisions; Tasks only after Yes. | Keep. |
| Person discovery creates outreach | High | Social judgement. | Save as Identified only. | Keep. |
| Job discovery creates application work | High | Strategic judgement. | Capture job; application work after In progress/application plan. | Keep. |
| Interview prep | Medium | Many prep tasks can flood Today. | Parent/child readiness and capacity gating. | Keep; retest Today child readiness. |

## Pass 6 - Stale Work Cleanup Review

| Source event | Open work that may become stale | Current cleanup | Missing cleanup | Fix/Test |
|---|---|---|---|---|
| Job Closed/Rejected | App prep, submit, response checks, interview work | Job closure cleanup exists; response result routes close/reject | Retest end-to-end | Test rejected job cancels response checks and app work. |
| Interview Cancelled | Scheduling/prep/debrief/follow-up | Interview cleanup paths exist | Retest current implementation | Test cancelled interview removes from Upcoming and cancels prep/follow-up. |
| Person Closed | Outreach/follow-up/conversation prep | `closePerson` and row action exist | Verify all relationship decisions dismissed | Test closed person excludes open relationship work. |
| Org Dormant/Archived | Org-level suggestions | Dormant/Archived park org-level suggestions | Child job/person work intentionally preserved | Keep data-safe behavior. |
| Sector Retired | Market mapping/sector tasks/decisions | Terminal source blocks tasks from Today | Retest sector decisions/tasks auto-hidden | Test retired sector excludes linked work from Today/Home. |

## Pass 7 - Home/Today Surfacing

| Automation/output | Where user should see it | Current surfacing | Gap | Better surfacing |
|---|---|---|---|---|
| Missing trigger | Home | Prominent banner | Good | Keep. |
| Broken/terminal source work | Home/Today/Tasks | Home attention + Today Needs planning | Good | Retest. |
| Invalid dropdown values | Source row Notes + Home attention | Repair/maintenance scan + Home count | Good | Keep. |
| Duplicate IDs | Home attention + source notes | Notes/backstop only | Not top-level enough | Add count later. |
| Weekly review output | Home utility | Summary visible | Good | Keep compact. |
| People follow-up work | Today/Tasks | Due tasks materialize; not Home Upcoming | Correct boundary | Keep out of Home. |
| Scheduled conversations | Home Upcoming | Visible | Good | Keep. |
| End-of-day blockers | Today/EOD popup | Modal gauntlet | Too much friction | Batch popup later. |

## Prioritized Issues

| Issue | Category | Severity | User impact | Proposed phase |
|---|---|---|---|---|
| Invalid dropdown values are not fully scanned during repair/maintenance | Trust/Recovery | Done | Imported/stale states can break cascades without a clear row-level repair signal. | Phase 1 |
| Redo onboarding lacks a save-before-clear path | Trust/Recovery | Done | Existing data could be wiped before the user had a fallback copy. | Phase 1 |
| Duplicate IDs are not top-level enough | Trust/Recovery | P1/P2 | Hidden duplicate IDs can break links and make actions hit the wrong source row. | Phase 1 |
| End-of-day unfinished workflow is too modal-heavy | Execution/Recovery | P2 | Heavy days become a popup gauntlet. | Phase 2 |
| Legacy interview prep labels remain in dropdowns | Orientation/Workflow | P3 | Users may see two prep models. | Phase 4/5 |
| Guide/tag dictionary missing | Documentation | P2 | User cannot self-serve automation tags. | Guide-last |

## Issue: Invalid dropdown values are not fully scanned during repair/maintenance

Severity: P2

User story:
As a user, when old data, pasted rows, or imported rows contain a stale status/dropdown value, I need the Planner to flag the exact row, so that I can repair it before it silently breaks routing.

Evidence:
- Sheet location: Sectors, Organisations, Jobs, People, Conversations, Interviews, Tasks, Decisions state/dropdown columns.
- Code location: `applySheetDropdowns`, `refreshAllDropdowns`, `onEditJobs`, `onEditPeople`.
- Current user experience: Direct edits to some columns flag invalid values, but repair/maintenance mostly reapplies validations and does not scan every strict dropdown value.

Automation type:
- Current level: Partial L2.
- Correct level: L2 warning/repair flag.

Workflow impact:
Invalid status values can stop expected cascades or make helper fields misleading.

Data/integrity impact:
Low corruption risk, medium trust risk.

Expected behaviour:
Repair/maintenance scans strict dropdown columns. Rows with stale values get `[invalid-value]` in Notes. Valid rows have stale invalid flags cleared. Home can count invalid dropdown values without mutating data.

Recommended fix:
- Code change: add dropdown integrity rules and scan helper. Implemented in `dropdownIntegrityRules` and `scanInvalidDropdownValues`.
- Sheet/layout change: none.
- Dropdown/header/Guide change: Guide later.
- Repair/backfill: scan is called from repair and daily maintenance; Home uses read-only count.

Acceptance tests:
1. Put an invalid Jobs Application status in an existing row; run repair; Jobs Notes gets `[invalid-value]`.
2. Correct the value; run repair; `[invalid-value]` clears.
3. Home refresh does not write notes; it only counts invalid dropdown values.

Do not do:
- Do not silently map unknown values to defaults.
- Do not add new Home sections.
