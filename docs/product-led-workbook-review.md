# Product-led workbook review

Current code baseline: `91200c0` (`Hide stale source decisions from Home`).

Scope: full workbook review using the product-led, exhaustive, and cohesive manuals. Guide changes are intentionally deferred until workbook behavior settles.

Implemented after this review began:
- Missing-source pending Decisions are hidden from Home and auto-dismissed during decision helper backfill.
- Home now has a compact Needs attention strip for source repair, blocked-task recovery, stale hidden Decisions, parent review, and maintenance health.
- Source-led scan completion opens a capture popup, and now has a direct "Nothing useful found" completion path.
- Weekly review summaries are written before Home refresh and surfaced in the Home utility area; stale weekly review also appears in Needs attention.

## Pass 1 - User Journey Review

| Journey | User goal | Current path | Friction | Confusion | Missing guidance | Better target path | Priority |
|---|---|---|---|---|---|---|---|
| First day / onboarding | Create initial search universe | Home setup card -> setup popup -> source rows/tasks | Medium | Onboarding can keep showing next checklist work after useful seed rows exist | What "complete" means vs generated next tasks | Complete onboarding after seed facts; route next exploration as Tasks/Decisions | P2 |
| Daily use | Know what to do now | Home -> Today -> mark work | Low/medium | Home has plan, decisions, apps, upcoming, but critical warnings are not clearly first-class | Why something needs repair | Home warning strip + Today needs-planning details | P1 |
| Weekly review | Keep stale search alive | time trigger -> org review decisions/tasks -> Home summary | Low | Review output is now visible in Home utility area | Details remain in Tasks/Decisions/source tabs | Keep | Keep |
| Source-led opportunity discovery | Run flexible scans and capture findings | Task -> Done -> result popup | Low | Completion is now direct, with no-results path | None major | Keep | Keep |
| Source-led people discovery | Capture people without outreach spam | Task -> Done -> result popup | Low | Good anti-spam model | "Identified means no outreach yet" in Guide later | Keep | Keep |
| Targeted sector/org mapping | Grow target universe | Sectors/Orgs -> Decisions -> Tasks | Medium | Parent/sub-sector model is clearer now but still hard from sheet alone | Examples | Keep source rows clear; Guide later | P3 |
| Job capture and triage | Store opportunity and decide intent | Home popup or Jobs row -> Decision/app status | Low/medium | Direct Jobs edit vs popup parity remains cognitively heavy | Which columns are required | Popup-first for normal capture; direct row repair only | P2 |
| Application planning | Break application into executable work | In progress -> Home Decision -> popup -> Tasks | Low | Strong current model | What completion updates | Keep | Keep |
| Submission/response | Submit then track waiting/rejection/invite | Submit task popup -> response check -> result popup | Low | Waiting is understandable now | None major | Keep | Keep |
| Networking | Store person, decide outreach, track follow-up | People/Conversations/Tasks | Medium | Relationship status and conversation history split is logical but still dense | Next action meaning | People helper fields + Home follow-up surfacing | P2 |
| Interview prep | Schedule, plan prep, debrief, outcome | Interviews -> Plan prep task -> popup -> prep tasks | Low/medium | Stronger after prep model; legacy prep workflows still visible | Legacy vs current prep | Mark legacy workflows in docs/headers later | P3 |
| Blocked-work recovery | Recover blocked/stale tasks | Tasks row actions + Today needs planning | Medium | Recovery exists but not visible on Home as a critical warning | What to do first | Home warning strip; Today needs-planning remains detailed | P1 |
| Repair/data-health | Fix broken links/invalid rows | Maintenance/Repair menu + notes flags | Medium/high | Repair states are in notes and Home summary count, not top-level warnings | Which repair to run | Home "Needs attention" line with action | P1 |
| Month-six search | Stay sane at scale | Maintenance + helper columns | Medium | Notes tags can accumulate; performance may degrade with full scans | What is stale vs historical | Safe repair summaries, eventual Guide dictionary | P2 |

## Pass 2 - Tab Purpose and Target State

| Tab | Purpose | User should do here | User should not do here | Target state | Main current issue | Recommended fix |
|---|---|---|---|---|---|---|
| Home | Command centre | Decide, capture, orient, start Today | Inspect raw data | Critical warnings, decisions, Today, capture, snapshot | Warnings are partly buried in sublines/bottom maintenance | Add compact needs-attention strip |
| Today | Execution surface | Do ready work, block/defer/complete | Capture source data | Only executable work plus needs-planning section | Good after terminal-source guard; still needs live UX checks | Keep; later EOD polish |
| Tasks | Work source of truth | Inspect/repair/sequence/block work | Act as daily surface | Ready state honest and visual | Stronger now; notes tags still hidden logic | Document tags later; keep helper colors |
| Decisions | Judgement/audit | Review queue and audit outcomes | Become task table | Action type truthful; stale decisions not on Home | Orphaned source decisions can still appear on Home before repair | Filter/auto-dismiss missing-source decisions |
| Sectors | Strategic universe | Define sector/sub-sector rows | Track work execution | Parent/child clear, retired safe | Needs visual examples, mostly docs | Guide later |
| Organisations | Target universe | Classify, set tier/status | Manually manage every cascade | Status controls suggestions, counts automatic | Active/Dormant review output not prominent | Home review summary later |
| Jobs | Opportunity/application record | Track opportunity/status/deadline/result | Store interview prep detail | Application status/result clean | Looks good structurally | Keep scanning |
| People | Relationship pipeline | Track person/source/status/next action | Store full history | Identified does not imply outreach | Helper outputs useful but Home does not surface follow-up health | Later Home snapshot |
| Interviews | Round tracker/prep router | Track date/status/outcome | Execute prep in sheet columns | Plan prep -> tasks; debrief/outcome | Legacy workflows still visible in dropdown | Docs/header later |
| Conversations | Interaction history | Log interactions/outcomes | Replace People status | Feeds helper fields/follow-ups | Orphaned person links are flagged, not surfaced | Later Home/repair visibility |
| Guide | Manual | Learn routine/recovery | Carry live state | Column/dropdown/tag dictionary | Deferred by user | Do last |

## Pass 3 - UX Scorecard

| Tab | First impression | Load | Visual hierarchy | Scanability | Affordance | Feedback | Empty states | Recovery | Main UX fix |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| Home | 4 | 3 | 4 | 4 | 4 | 3 | 4 | 3 | Needs-attention strip |
| Today | 4 | 3 | 4 | 4 | 4 | 4 | 4 | 4 | Later EOD batch choices |
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
| Decisions | Target type/ID | Linking | Script | No | Yes/type | decisions/cascades | Home/router | Yes | Home/source | Missing source can show stale Home card | Fix now |
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
| People.Relationship status | People | Identified -> Closed | Yes | Yes | Mostly | "Replied" needs Home follow-up surfacing | Later |
| Interviews.Status | Interviews | To schedule/Scheduled/Completed/Cancelled/Reschedule | Yes | Yes | Yes | Reschedule is temp | Keep, ensure cleanup |
| Interviews.Official outcome | Interviews | Waiting/Next round/Declined/Offer/Parked | Yes | Yes | Yes | None | Keep |
| Tasks.Ready for Today | Tasks helper | Ready/Waiting/Blocked/Parent/Needs planning/Done | Script | Yes | Yes | Terminal source/missing source handling needed for decisions too | Fix decisions |
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
| Hide stale terminal/missing-source Decisions from Home | Medium | L2 safe warning/repair | Home should not ask on dead links | Low | Decisions audit remains | Yes |
| Home critical warning strip | Medium | L2 surface issue | Reduces anxiety and repair hunting | Low | Menu repair | Next |
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
| Missing source with pending decision | health flags notes | Can still show on Home | Gap | should auto-dismiss or hide | none | P1 |
| Maintenance stale/error | properties | bottom Home note | Too low on Home | none | bottom note | P2 |
| Invalid dropdown values | strict dropdowns/repair | mostly strict | Need full invalid scan later | repair tabs | notes | P2 |
| Duplicate IDs | health flags | notes only | not top-level | repair/manual | notes | P2 |

## Pass 9 - Home and Today Cockpit Review

| Surface | Element | Purpose | Current behavior | Gap | Better behavior | Fix |
|---|---|---|---|---|---|---|
| Home | Setup banner | Trigger health | prominent if missing | Good | Keep | Keep |
| Home | Pending decisions | Judgement | top 3 cards | Missing-source decisions can still show | Exclude/auto-dismiss broken-link decisions | Fix now |
| Home | Today plan | execution readiness | reflects Today and warns unverified date | Good | Keep | Retest |
| Home | Capture update | capture | primary capture dropdown | Good | Keep | Keep |
| Home | Open applications | waiting/application state | compact list | Good | Keep | Keep |
| Home | Upcoming | scheduled/waiting | compact list | Good | Keep | Keep |
| Home | System health | recovery | maintenance warning at bottom, broken count in subline | Not first-class | needs-attention strip near top | Next |
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
| Missing-source pending Decisions can still appear on Home | P1 | Must fix now | Home should not ask user to decide on an orphaned source | none |
| Home critical warnings are not first-class | P1/P2 | Should fix next | Product cockpit should surface broken/stale/maintenance before work | warning summary helper |
| Source-led scan no-results path | P2 | Done | Better UX, not integrity | source result popup |
| Weekly review summary not visible enough | P2 | Done | Reduces "what happened?" anxiety | Home warning/snapshot |
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
