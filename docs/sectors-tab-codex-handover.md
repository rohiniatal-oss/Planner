# The Planner — Sectors tab Codex handover spec

## Purpose

This spec replaces the narrow "make the current 3-column Sectors tab safer" brief with a broader but still controlled implementation plan.

The Sectors tab should become the taxonomy and coverage layer for the planner. It should remain easy for the user: the user supplies minimal facts, and the planner derives the rest.

Current live workbook state, verified before this handover: the Sectors tab has only three columns and no data rows:

```text
Sub-sector ID | Sector | Sub-sector
```

The existing Claude handover correctly identifies several data-integrity fixes, including fuzzy matching, real IDs for sector-only rows, rename propagation, orphan detection, and a lifecycle field. Keep those correctness fixes, but implement them inside the stronger model below.

---

## 1. Product model

### 1.1 Sectors is not a daily execution surface

Sectors should not tell the user what to do today. Today does that through Tasks.

Sectors should answer:

```text
What search areas exist?
Which sub-sectors are real hunting grounds?
Which branches are only classification labels versus actively mapped?
How many organisations are linked to each branch?
Which branches should be expanded, maintained, archived, or ignored?
```

### 1.2 Sector and sub-sector have different roles

```text
Sector = container / navigation level
Sub-sector = actionable planning object / hunting ground
Organisation = mapped target inside a sub-sector
```

Examples:

```text
AI                    -> sector
AI governance          -> sub-sector
Anthropic              -> organisation
```

Most metrics should live at sub-sector level, not sector level.

### 1.3 User gives minimum facts

The user should normally provide only:

```text
Sector
Sub-sector, optional
Priority, optional
Notes, optional
```

The user should not manually maintain:

```text
Organisation count
Coverage
Expansion decision state
Last reviewed
Task IDs
Decision IDs
```

These should be system-derived.

---

## 2. Data sources

Sectors can be populated from four entry points. All four must call the same canonical sector-branch upsert function.

```text
1. Onboarding
2. Home updates
3. Organisation classification
4. Direct Sectors tab entry
```

### 2.1 Onboarding

Onboarding is a first-class Sectors input.

If the user gives only a sector:

```text
Input: Sector = AI, Sub-sector = blank
```

Create or reuse a sector-only row:

```text
ID = SEC-001
Sector = AI
Sub-sector = blank
Status = Active
Priority = Watch
Notes includes [created-via-onboarding]
```

Then create a Stage-1 task:

```text
List 2–4 sub-sectors worth exploring for AI
```

If the user gives sector plus sub-sector:

```text
Input: Sector = AI, Sub-sector = AI governance
```

Create or reuse a sub-sector row:

```text
ID = SUB-001
Sector = AI
Sub-sector = AI governance
Status = Not started
Priority = Watch unless user chose Target
Org count = formula/system-derived
Coverage target = 10
Expansion decision = Pending
Notes includes [created-via-onboarding]
```

Then create an Expansion decision:

```text
Expand AI governance?
```

### 2.2 Home updates

Home update flows should use the same upsert as onboarding.

Relevant Home update types:

```text
Explore sectors
Find organisations
Add/update organisation
Add/update job
Add/update person
```

### 2.3 Organisation updates

Organisation is the taxonomy anchor for bottom-up entry.

If the user updates an Organisation with sector/sub-sector:

```text
Organisation = Anthropic
Sector = AI
Sub-sector = AI safety
```

The system should:

```text
1. Create or reuse the sector/sub-sector branch.
2. Link the Organisation to the Sub-sector ID.
3. Update Organisation display fields for Sector/Sub-sector.
4. If the sub-sector is newly created, create an Expansion decision.
5. Add traceability note on Sectors: [created-via-org-link] if applicable.
```

### 2.4 Job updates

Jobs should not directly write Sectors by default.

A Job belongs to an Organisation. The Job update should create or link the Organisation. If the Organisation has missing taxonomy, create a Classification decision or Home prompt.

Default path:

```text
Job -> Organisation -> optional Organisation classification -> Sectors
```

Do not do this by default:

```text
Job -> Sectors
```

If a job capture form explicitly includes Sector/Sub-sector, apply that taxonomy to the Organisation, not directly to the Job.

### 2.5 Person updates

People should almost never write Sectors directly.

A Person belongs to an Organisation. Their taxonomy is inherited through the Organisation.

Default path:

```text
Person -> Organisation -> optional Organisation classification -> Sectors
```

A person-based classification prompt should be lower priority than a job- or organisation-based prompt because a person alone is a weaker signal.

---

## 3. Anti-loop contract

This is mandatory. The system must support bottom-up entry without circular automation.

### 3.1 Source-of-truth rules

```text
1. Sectors owns taxonomy branches.
2. Organisations are the only source objects that directly link to Sectors.
3. Jobs inherit taxonomy through Organisation.
4. People inherit taxonomy through Organisation.
5. Jobs and People may create classification prompts for Organisation, but must not mutate Sectors directly.
6. Sectors may refresh Organisation display text on rename, but must not fire Organisation active/job/people cascades.
7. All branch creation must go through one canonical upsert function.
8. Every system-created decision must have a deterministic key.
```

### 3.2 IDs drive logic; text is display

Use IDs for links and text only for display.

```text
Sectors.ID = canonical SEC/SUB ID
Organisations.Sub-sector ID = canonical link
Organisations.Sector/Sub-sector = display copy
Jobs.Org ID = canonical Organisation link
People.Org ID = canonical Organisation link
```

### 3.3 Rename propagation must not cascade

When a Sectors row is renamed, update linked Organisation display text only.

Allowed:

```text
Sectors rename
-> update Organisations.Sector
-> update Organisations.Sub-sector
```

Not allowed:

```text
Sectors rename
-> trigger Organisation status cascade
-> create Decisions/Tasks
-> create new Sectors row
```

---

## 4. Schema changes

### 4.1 Replace current Sectors headers

Current:

```text
Sub-sector ID | Sector | Sub-sector
```

Target:

```text
Sector ID | Sector | Sub-sector | Status | Priority | Org count | Coverage target | Expansion decision | Last reviewed | Notes
```

Column naming notes:

- `Sector ID` is intentionally generic. It can contain either `SEC-###` or `SUB-###`.
- Sector-only rows use `SEC-###`.
- Sub-sector rows use `SUB-###`.
- Do not use raw sector names as linked object IDs going forward.

### 4.2 Visible versus backend columns

Default visible columns:

```text
Sector
Sub-sector
Status
Priority
Org count
Coverage target
Expansion decision
Last reviewed
Notes
```

Hide by default:

```text
Sector ID
```

No separate stored Coverage column is required. Display coverage as:

```text
Org count / Coverage target
```

This can be visualised later, but do not add a redundant stored field now.

### 4.3 Dropdowns

Status values:

```text
Active
Not started
Mapping
Mapped
Maintaining
Archived
```

Recommended use:

```text
Active = sector-only container exists and is usable
Not started = sub-sector exists but has not been expanded
Mapping = market map is underway
Mapped = useful organisation coverage exists
Maintaining = mapped branch is kept warm and periodically reviewed
Archived = branch is inactive and should not generate work
```

Priority values:

```text
Target
Watch
Archive
```

Recommended use:

```text
Target = planner can actively pull mapping/review work
Watch = keep classification and occasional review, but do not aggressively build
Archive = user wants it out of active planning
```

Expansion decision values:

```text
Not asked
Pending
Accepted
Declined
Auto-dismissed
```

---

## 5. Canonical functions to add or refactor

### 5.1 upsertSectorBranch

Create one canonical path for sector/sub-sector creation.

Suggested signature:

```js
function upsertSectorBranch(opts) {
  // opts = {
  //   sector: string,
  //   subsector: string | '',
  //   source: 'onboarding' | 'home_update' | 'organisation_link' | 'manual_sheet_entry' | 'repair_backfill',
  //   sourceObjectType: 'Organisation' | 'Job' | 'Person' | 'Sector' | 'None',
  //   sourceObjectId: string,
  //   priority: 'Target' | 'Watch' | 'Archive' | '',
  //   notes: string,
  //   createExpansionDecision: boolean
  // }
  // returns { id, row, sector, subsector, created, isSectorOnly }
}
```

Responsibilities:

```text
1. Normalize sector/sub-sector input.
2. Fuzzy-match existing sector-only or sub-sector rows.
3. Create SEC or SUB IDs as needed.
4. Set defaults for Status, Priority, Coverage target, Expansion decision.
5. Add source trace notes.
6. Create Expansion decision when appropriate.
7. Return a stable object for callers to link against.
```

### 5.2 findOrCreateSectorOnly

Refactor into or delegate to `upsertSectorBranch`.

Must assign a real `SEC-###` ID on creation.

Must fuzzy-match existing sector-only rows using the same `similarity()` threshold pattern used elsewhere in the codebase. Use 0.85 threshold.

### 5.3 findOrCreateSubsector

Refactor into or delegate to `upsertSectorBranch`.

Must assign a `SUB-###` ID.

Must fuzzy-match both Sector and Sub-sector, not just exact-normalized text.

### 5.4 fireSectorOnlyTask

Change signature so it receives the real SEC ID.

Current pattern to avoid:

```js
appendTodoOnceForWorkflow(taskText, 'Sector', sector, ...)
```

Target pattern:

```js
appendTodoOnceForWorkflow(taskText, 'Sector', sectorId, ...)
```

### 5.5 applyOrgTaxonomyLink

This should call `upsertSectorBranch` when taxonomy is supplied.

If a sub-sector is created from Organisation classification, link Organisation using the returned SUB ID.

If only Sector is supplied, link or create SEC row, but Organisation should only get a Sub-sector ID if a real sub-sector exists.

### 5.6 createClassificationDecisionForOrg

Add a distinct decision type for missing Organisation taxonomy.

Trigger examples:

```text
Job created Organisation with no taxonomy
Person created Organisation with no taxonomy
Organisation exists but has no Sector/Sub-sector
```

Decision question:

```text
Classify this organisation?
```

Yes should open or route to classification capture, not create a vague task unless popup routing is not yet implemented.

Decision key:

```text
CLASSIFY_ORG:<ORG_ID>
```

### 5.7 createExpansionDecisionForSubsector

This replaces or renames the existing sub-sector market-map decision.

Decision question:

```text
Expand this sub-sector?
```

Decision key:

```text
EXPAND_SUBSECTOR:<SUB_ID>
```

Yes should:

```text
1. Set Sectors.Expansion decision = Accepted
2. Set Sectors.Status = Mapping
3. Set Sectors.Priority = Target unless already explicitly set
4. Create Task = Market map <Sector> — <Sub-sector>
```

No should:

```text
1. Set Sectors.Expansion decision = Declined
2. Leave Sectors row intact for classification
3. Create no task
```

---

## 6. Flow rules

### 6.1 Onboarding flow

Sector-only:

```text
Onboarding -> upsertSectorBranch(sector only) -> SEC row -> Stage-1 sector-selection task
```

Sector plus sub-sector:

```text
Onboarding -> upsertSectorBranch(sector + sub-sector) -> SUB row -> Expansion decision -> optional Market-map task if accepted
```

### 6.2 Home Explore sectors flow

Same as onboarding, but source note should be:

```text
[created-via-home-update]
```

### 6.3 Home Add/update organisation flow

```text
Organisation capture -> create/find Organisation -> taxonomy supplied? -> upsertSectorBranch -> link Organisation -> maybe Expansion decision
```

### 6.4 Home Add/update job flow

```text
Job capture -> create/find Organisation -> create/update Job -> if Organisation missing taxonomy, create CLASSIFY_ORG decision
```

Only if taxonomy fields are explicitly present in the Job form should it apply taxonomy to the Organisation.

### 6.5 Home Add/update person flow

```text
Person capture -> create/find Organisation -> create/update Person -> optional low-priority CLASSIFY_ORG decision if Organisation missing taxonomy
```

### 6.6 Direct Sectors entry

Manual Sector/Sub-sector edits should call the same upsert logic or equivalent internal branch logic.

Do not allow manual direct entry to bypass:

```text
fuzzy matching
real IDs
status defaults
expansion decision creation
```

### 6.7 Repair backfill

Repair routines may create missing taxonomy rows only through `upsertSectorBranch` and should tag:

```text
[created-via-repair]
```

---

## 7. Derived fields

### 7.1 Org count

Org count should be derived from Organisations, not typed by the user.

Preferred initial implementation:

```text
COUNTIF(Organisations!Sub-sector ID, this Sector ID)
```

If formulas are brittle due to hidden columns or rewritten headers, script-update the count after:

```text
Organisation capture
Organisation taxonomy edit
Repair all tabs
Weekly review
```

### 7.2 Coverage target

Default:

```text
10
```

Editable by user.

Do not ask for it during onboarding unless already present in an advanced flow.

### 7.3 Last reviewed

System-maintained.

Update when:

```text
Market-map task completed
Review task completed
Weekly review confirms branch still active
```

### 7.4 Status automation

Rules:

```text
Sector-only row created -> Active
Sub-sector row created -> Not started
Expansion accepted -> Mapping
Market-map completed and Org count >= Coverage target -> Mapped
Market-map completed and Org count < Coverage target -> Mapping, add [coverage] note
Periodic review after Mapped -> Maintaining
Archived manually -> Archived, dismiss/skip linked work
```

---

## 8. Decision integration

### 8.1 Decision types

Implement or simulate two decision types:

```text
CLASSIFY_ORG:<ORG_ID>
EXPAND_SUBSECTOR:<SUB_ID>
```

### 8.2 Home rendering

Home will own active decision review. The Decisions tab remains the source-of-truth queue and audit trail.

Sectors should only store the current expansion state for the relevant branch.

### 8.3 Duplicate prevention

Before creating any decision, check for an existing open decision with the same key.

Do not create repeated expansion prompts when:

```text
Organisation classification re-saves the same sub-sector
Repair backfill touches the row
Sector rename propagates display text
Weekly review runs
```

---

## 9. Integrity and hygiene

### 9.1 Checklist completion trap

Amend `checkAutoCompletion` so matched tasks resolve when all are terminal, not only Done.

Use existing helper:

```js
isTerminalTodoStatus(status)
```

Target logic:

```js
return matched.every(function (row) {
  return isTerminalTodoStatus(String(row[COLS.TODO.STATUS - 1]));
});
```

### 9.2 Fuzzy matching

Add fuzzy matching for both sector-only and sub-sector lookup.

Threshold:

```text
0.85
```

Silent merge is preferred over UI prompt because creation can occur inside popup flows and repair flows.

### 9.3 Rename propagation

When an existing ID row is renamed in Sectors:

```text
Update linked Organisations display fields.
Do not fire Organisation cascades.
Do not create new Sectors rows.
```

### 9.4 Orphan detection

Weekly review should detect Organisations linked to missing Sector IDs and flag:

```text
[orphaned-sector] Linked Sector/Sub-sector no longer exists
```

Optional: also flag open Tasks and Pending Decisions with missing Sector IDs.

### 9.5 Archived behavior

When Sectors.Status changes to Archived:

```text
1. Auto-dismiss open Expansion decisions for that Sector ID.
2. Skip/cancel open Sector-linked Tasks.
3. Do not delete Organisations.
4. Keep Organisation display taxonomy as historical/classification data unless user reclassifies.
```

---

## 10. Explicitly not doing in this build

Do not build:

```text
Tree UI
Nested visual hierarchy
Theme level below sub-sector
Semantic task/sector wording detector
Fixed dropdown of allowed sector names
Automatic taxonomy inference from job title text
Direct Person -> Sectors mutation
Direct Job -> Sectors mutation by default
```

The goal is a robust table plus clean flows, not a complex taxonomy product.

---

## 11. Build order

1. Verify current `checkAutoCompletion` and patch terminal-status handling.
2. Expand Sectors schema and constants.
3. Add dropdowns, rich-text headers, widths, hidden columns, manual/auto shading.
4. Implement or refactor `upsertSectorBranch`.
5. Add real `SEC-###` IDs for sector-only rows and update `fireSectorOnlyTask` callers.
6. Add fuzzy matching for sector/sub-sector lookup.
7. Refactor onboarding and Home sector capture to use `upsertSectorBranch`.
8. Refactor `applyOrgTaxonomyLink` to use `upsertSectorBranch`.
9. Add Classification and Expansion decision helpers with deterministic keys.
10. Add Org count and Coverage target defaults.
11. Add status automation for Expansion accepted, Market-map completion, and Archived.
12. Add rename propagation to Organisations.
13. Add orphan detection in weekly review.
14. Run repairAllTabs on a test workbook.
15. Test top-down and bottom-up flows.

Important sequencing dependency: complete real `SEC-###` IDs before implementing the Tasks tab's planned "Linked to" resolver. Otherwise the resolver will need to special-case old raw sector-name object IDs.

---

## 12. Acceptance tests

### 12.1 Onboarding sector only

Input:

```text
Sector = AI
Sub-sector = blank
```

Expected:

```text
SEC row created
Status = Active
Priority = Watch
Stage-1 task created with objId = SEC-###, not raw sector name
No Expansion decision yet
```

### 12.2 Onboarding sector plus sub-sector

Input:

```text
Sector = AI
Sub-sector = AI governance
```

Expected:

```text
SUB row created
Status = Not started
Expansion decision = Pending
Decision key = EXPAND_SUBSECTOR:SUB-###
No Market-map task until decision accepted
```

### 12.3 Organisation bottom-up classification

Input:

```text
Organisation = Anthropic
Sector = AI
Sub-sector = AI safety
```

Expected:

```text
Organisation created or updated
SUB row created or reused
Organisation.Sub-sector ID = SUB-###
Org count increments
Expansion decision created only if this is a new branch or not previously decided
No duplicate decisions on repeated save
```

### 12.4 Job does not directly mutate Sectors

Input:

```text
Job = Senior Policy Manager
Organisation = Anthropic
No taxonomy fields
```

Expected:

```text
Job created
Organisation created or linked
No Sectors row created directly from Job
If Organisation lacks taxonomy, CLASSIFY_ORG decision may be created
```

### 12.5 Person does not directly mutate Sectors

Input:

```text
Person = Sarah
Organisation = Anthropic
No taxonomy fields
```

Expected:

```text
Person created
Organisation created or linked
No Sectors row created directly from Person
Classification prompt optional and lower priority
```

### 12.6 Expansion decision accepted

Action:

```text
Accept EXPAND_SUBSECTOR:SUB-###
```

Expected:

```text
Sectors.Expansion decision = Accepted
Sectors.Status = Mapping
Sectors.Priority = Target unless already set
Market-map task created and linked to SUB-###
```

### 12.7 Expansion decision declined

Action:

```text
Decline EXPAND_SUBSECTOR:SUB-###
```

Expected:

```text
Sectors.Expansion decision = Declined
No Market-map task created
Row remains usable for Organisation classification
```

### 12.8 Rename propagation

Action:

```text
Rename Sub-sector AI safety -> Frontier AI safety
```

Expected:

```text
Linked Organisations display new Sub-sector text
Organisation cascades do not fire
No new Sectors row created
No duplicate Expansion decision created
```

### 12.9 Archived status

Action:

```text
Set Sectors.Status = Archived
```

Expected:

```text
Open Sector-linked decisions auto-dismissed
Open Sector-linked tasks skipped/cancelled
Organisations are not deleted
Today does not pull archived branch work
```

### 12.10 Orphan detection

Action:

```text
Delete a Sectors row manually, then run weeklyReview
```

Expected:

```text
Linked Organisations receive [orphaned-sector] note
No attempt to recreate deleted branch unless repair routine explicitly does so
```

---

## 13. Implementation notes

- Keep the user-facing capture forms light. Do not ask for derived fields.
- Keep Sectors freeform; do not constrain Sector names to a fixed enum.
- Use deterministic decision keys for every prompt.
- Prefer trace notes over hidden magic when rows are created indirectly.
- Avoid direct writes from Jobs or People to Sectors; route through Organisation classification.
- Do not overbuild UI. A strong table with derived counts, lifecycle, and decision state is enough.

---

## 14. Summary

The design principle is:

```text
User gives intent and basic taxonomy.
The planner derives coverage, decisions, tasks, and review state.
```

The flow should be:

```text
Onboarding / Home / Organisation classification
-> Sectors taxonomy branch
-> Expansion or Classification decision
-> Tasks
-> Today
-> Completion updates Sectors
```

This supports both top-down exploration and bottom-up discovery without loops.
