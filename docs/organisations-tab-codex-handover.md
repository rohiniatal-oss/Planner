# The Planner Organisations tab Codex handover spec

## Purpose

This spec covers only Organisations-tab integrity and usability polish. It is intentionally narrower than the Sectors taxonomy work.

Organisations is already one of the best-shaped tabs in the planner. Current v7.6 design is directionally right:

```text
Organisations owns target institutions.
Sectors owns taxonomy.
People and Jobs inherit taxonomy through Organisation.
Decisions own judgment.
Tasks and Today own execution.
```

Do not turn this into a broader CRM or coverage product. The goal is to make the existing Organisations graph more reliable, auditable, and easier to scan.

---

## 1. Current live model

Current Organisations schema in `Code.gs` v7.6:

```text
Org ID
Organisation
Sector
Sub-sector
Sub-sector ID
Tier
Status
Known people (count)
Open opportunities (count)
Last checked
Next check date
Notes
```

This schema should remain unchanged for this build. Do not add preview columns, relationship-strength fields, owner fields, custom fields, or coverage fields in this pass.

### Column ownership

| Column | Owner | Rule |
| --- | --- | --- |
| Org ID | System | Stable key. Hidden by default. |
| Organisation | User/system | Primary row anchor. Fuzzy dedup applies. |
| Sector | User/system display | Display copy from Sectors taxonomy where available. |
| Sub-sector | User/system display | Display copy from Sectors taxonomy where available. |
| Sub-sector ID | System | Logic link to Sectors. Text fields are display only. |
| Tier | User | Human judgment. Do not infer automatically. |
| Status | User/system | Lifecycle state of this organisation. |
| Known people count | Formula | Derived from People by Org ID. Do not script-write snapshots. |
| Open opportunities count | Formula | Derived from Jobs by Org ID. Do not script-write snapshots. |
| Last checked | System | Updated by completion / review flows. |
| Next check date | System | Primarily for Dormant organisations. |
| Notes | User/system | Source, rationale, trace flags, and review flags. |

---

## 2. Status contract

Keep existing Organisation status values:

```text
Mapped
Active
Dormant
Archived
```

Do not rename these on Organisations. The status naming collision identified in the Sectors work belongs on Sectors, not here.

Status semantics:

| Status | Meaning | System behavior |
| --- | --- | --- |
| Mapped | Known/classified, not actively pursuing | No automatic Tasks or Decisions unless another workflow creates them. |
| Active | Deliberately pursuing now | Creates Pending Decisions for People sourcing and Org job scan. |
| Dormant | Paused but may be reviewed later | Sets next check date, skips open Organisation Tasks, auto-dismisses pending Organisation Decisions. |
| Archived | Out of scope | Cancels open Organisation Tasks and auto-dismisses pending Organisation Decisions. |

Important rule:

```text
Creating an Organisation must not flood the queue.
```

New Organisations should default to `Mapped`, not `Active`, unless the user explicitly chooses Active.

---

## 3. Workflows in and out

### 3.1 Inputs into Organisations

| Entry point | Expected behavior |
| --- | --- |
| Home Add/update organisation | Create/update Organisation; apply Sector/Sub-sector if provided; default Mapped unless status explicitly supplied. |
| Home Find organisations | Create mapped Organisations found from exploration; link to Sector/Sub-sector if supplied. |
| Jobs | Create or reuse name-only Organisation stub if missing; default Mapped; do not mutate Sectors directly. |
| People | Create or reuse name-only Organisation stub if missing; default Mapped; do not mutate Sectors directly. |
| Conversations | Create or reuse Organisation only if needed for context; default Mapped. |
| Direct Organisations entry | Same behavior as Home where possible; do not bypass dedup, formulas, or taxonomy-link logic. |

### 3.2 Outputs from Organisations

| Trigger | Expected output |
| --- | --- |
| Organisation marked Active | Pending Decisions for People sourcing and Org job scan. No direct Tasks. |
| Organisation marked Dormant | Set next check date; skip open Organisation Tasks; auto-dismiss pending Organisation Decisions. |
| Organisation marked Archived | Cancel open Organisation Tasks; auto-dismiss pending Organisation Decisions. |
| People sourcing Task completed | Pending Decision to add/update people found. |
| Org job scan Task completed | Pending Decision to add/update jobs found. |
| Org research Task completed | Pending Decision to update notes/tier/status. |
| Sectors row renamed | Update Organisation Sector/Sub-sector display copies only. Do not fire Organisation cascades. |

---

## 4. Ship-now fixes

### 4.1 Add trace note for silent fuzzy stub matches

Current risk:

`createNameOnlyOrg` fuzzy-matches typed organisation names from Jobs/People/Home capture against existing Organisations. When it finds a match, `inheritOrgFields` writes the existing canonical name back into the source row.

This is good for deduplication, but risky when the existing canonical name is wrong.

Example:

```text
Existing Organisation: Anthr0pic
User types on Job row: Anthropic
System matches to existing row and rewrites Job Organisation to Anthr0pic
```

Required fix:

When `createNameOnlyOrg` returns an existing fuzzy match where the typed text differs from the stored Organisation name, append trace flags to the matched Organisation row:

```text
[matched-typed-as] "Anthropic"
[review-name] Possible canonical-name typo
```

Rules:

```text
1. Stay silent. Do not add a popup on the stub path.
2. Preserve the existing dedup behavior.
3. Leave an auditable trace on the Organisation row.
4. Deduplicate the trace flag by category so repeated captures do not spam Notes.
```

Implementation hint:

Extend `createNameOnlyOrg(orgName, opts)` so the existing-match branch can compare `orgName` to the matched row name and call `appendNoteFlag` on the Organisations row.

### 4.2 Remember declined duplicate prompts by Org ID

Current risk:

`checkOrgDuplicate` can repeatedly prompt for the same similar pair after the user already declined the merge.

Required fix:

When the user declines a duplicate merge, write an ID-based memory flag to the edited row:

```text
[reviewed-similar-org: ORG-004]
```

Before prompting, check whether this row already has the same `reviewed-similar-org` flag. If yes, skip the prompt.

Rules:

```text
1. Use Organisation ID, not Organisation name, because names can change.
2. Do not suppress prompts for a different similar Organisation ID.
3. Do not alter the existing prompt behavior when there is no prior reviewed flag.
```

### 4.3 Add Organisation orphan detection across linked objects

Current risk:

Manual row deletion does not fire `onEdit`, so linked objects can keep pointing to missing Organisation IDs.

Required fix:

Add or extend one weekly/integrity review function to scan Organisation references and flag broken links.

Scan at minimum:

```text
People.Org ID
Jobs.Org ID
Tasks where objType = Organisation
Decisions where targetType = Organisation
```

Flag with:

```text
[orphaned-org] Linked Organisation no longer exists
```

Target notes columns:

```text
People -> People.Notes
Jobs -> Jobs.Notes
Tasks -> Tasks.Notes
Decisions -> Decisions.Notes
```

Rules:

```text
1. Do not recreate deleted Organisations automatically.
2. Do not delete or relink child rows automatically.
3. Use one shared integrity function if the Sectors orphan sweep already exists.
4. Keep this as a flagging/reporting pass, not a destructive repair pass.
```

### 4.4 Document formula dependency near applyOrgRowFormulas

Current formulas are acceptable and should stay formula-only:

```text
Known people count = COUNTIF(People!D:D, this Org ID)
Open opportunities count = COUNTIFS(Jobs!D:D, this Org ID, Jobs!E:E, "<>Closed", Jobs!E:E, "<>Parked")
```

Required fix:

Add a short code comment near `applyOrgRowFormulas`:

```text
These formulas intentionally hardcode People/Jobs column letters. They are safe only under the project convention that new columns are appended, never inserted before existing Org ID / Status columns.
```

Do not replace these with script-written snapshots.

### 4.5 Add Tier colour coding

Current issue:

Status is visually coded; Tier is not. Once Tier is used as a tiebreaker for Organisation-linked pipeline work, it should be easy to audit.

Required fix:

Add conditional formatting for Organisations.Tier using the same pattern as `STATUS_COLOR_MAP`.

Suggested colors:

```text
A -> #CEEAD6
B -> #FEF7CD
C -> #F1F3F4
```

Rules:

```text
1. Keep it small: three values only.
2. Do not infer Tier.
3. Do not make Tier a new generic priority system.
```

### 4.6 Add health flag for Active organisations with zero activity

Current gap:

An Organisation marked Active means the user has chosen to pursue it, but it can still sit with no known people and no open opportunities.

Required fix:

During the existing queue hygiene / weekly review pass, flag Active Organisations where:

```text
Status = Active
Known people count = 0
Open opportunities count = 0
```

Flag on Organisation Notes:

```text
[active-empty] Active but no people or open opportunities yet
```

Rules:

```text
1. Clear the flag once either count becomes non-zero or status is no longer Active.
2. Do not apply this to Mapped Organisations. Mapped is inert by design.
3. Do not create Tasks automatically from this flag.
```

---

## 5. Explicit deferrals

Do not implement these in this pass:

```text
People preview column
Open opportunities preview column
Relationship graph visualisation
Per-organisation custom fields
Editable previews
Auto-computed Tier
Additional Organisation statuses
Renaming Organisation statuses
Script-written count snapshots
CLASSIFY_ORG decision type
Organisation coverage model
```

### 5.1 People/jobs preview columns are deferred

The idea is useful but not approved for this build:

```text
Known people preview = Sarah Ahmed, John Doe
Open opportunities preview = Senior Policy Manager, Strategy Lead
```

Reason for deferral:

```text
1. Adds schema surface.
2. Makes Organisations visually heavier.
3. Current counts plus Tasks Linked-to navigation may be enough.
4. We should only add previews if the user actually feels the need while using the tab.
```

If approved later, previews must be read-only formulas and must not become editable source data.

---

## 6. Build order

1. Add fuzzy stub-match trace and name-review flag.
2. Add declined duplicate memory using Organisation ID.
3. Add Organisation orphan detection for People, Jobs, Tasks, and Decisions.
4. Add comment near `applyOrgRowFormulas` documenting formula column-letter dependency.
5. Add Tier colour coding.
6. Add `active-empty` health flag and clearing logic.
7. Stop. Do not add preview columns or new schema.

---

## 7. Acceptance tests

### 7.1 Silent fuzzy stub match leaves trace

Setup:

```text
Organisations row exists: ORG-001 = Anthr0pic
User enters Job organisation = Anthropic
```

Expected:

```text
Job links to ORG-001
Job Organisation display may normalize to Anthr0pic under current behavior
Organisation Notes include [matched-typed-as] "Anthropic"
Organisation Notes include [review-name] Possible canonical-name typo
No popup appears
No duplicate Organisation is created
```

### 7.2 Declined duplicate prompt does not repeat for same pair

Setup:

```text
Existing Organisation: ORG-004 = OpenAI
User creates similar Organisation row: Open AI
User declines merge prompt
```

Expected:

```text
Edited row Notes include [reviewed-similar-org: ORG-004]
Editing the same Organisation name again does not prompt for ORG-004
A different similar Organisation ID can still prompt
```

### 7.3 Orphaned Organisation references are flagged

Setup:

```text
Delete Organisation ORG-002 manually
People / Jobs / Tasks / Decisions still reference ORG-002
Run integrity review
```

Expected:

```text
People Notes include [orphaned-org] Linked Organisation no longer exists
Jobs Notes include [orphaned-org] Linked Organisation no longer exists
Tasks Notes include [orphaned-org] Linked Organisation no longer exists
Decisions Notes include [orphaned-org] Linked Organisation no longer exists
No deleted Organisation is recreated automatically
No linked rows are deleted automatically
```

### 7.4 Formula counts remain formula-only

Setup:

```text
Run repairAllTabs or repairOrganisationsFormulas
```

Expected:

```text
Known people count remains a COUNTIF formula
Open opportunities count remains a COUNTIFS formula
No script-written static count replaces either formula
Comment exists near applyOrgRowFormulas documenting append-only dependency
```

### 7.5 Tier colour coding applies

Setup:

```text
Set Tier = A, B, C on different Organisation rows
Run formatting repair
```

Expected:

```text
A/B/C cells receive distinct conditional formatting
Status colour rules remain unchanged
No new Tier values are introduced
```

### 7.6 Active-empty health flag appears and clears

Setup:

```text
Organisation status = Active
Known people count = 0
Open opportunities count = 0
Run queue hygiene / weekly review
```

Expected:

```text
Organisation Notes include [active-empty] Active but no people or open opportunities yet
```

Clearing test:

```text
Add a linked Person or open Job, or change Status away from Active
Run review again
```

Expected:

```text
[active-empty] flag is cleared
```

---

## 8. Summary

This build should leave Organisations with the same schema but better integrity:

```text
No silent fuzzy-match surprises without trace.
No repeated duplicate prompts after a user declines once.
No broken Organisation links hidden in Jobs, People, Tasks, or Decisions.
Counts stay formula-derived.
Tier becomes visually auditable.
Active-but-empty organisations are surfaced without automatically creating work.
```

Keep the product boundary intact:

```text
Organisations = target institution source of truth.
Sectors = taxonomy.
People and Jobs = linked source tabs.
Decisions = judgment.
Tasks and Today = execution.
```