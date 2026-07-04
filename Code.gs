/**
 * The Planner — Code.gs (v7.3)
 * =============================
 * Career-search planning system on a single Google Sheet.
 *
 * v7.3 removes the dead, orphaned "v6.8.2 Today rewrite" block that had
 * been appended to the bottom of the v7.2 file. That block defined a
 * second, parallel Today engine (populateTodayPlan / bootstrapTodayPlanTab
 * / buildTodayPlanForNewDayV682 / onEditTodayPlan / the Accept-Modify-
 * Rebuild banner) which:
 *   - was never wired into any live path (onEdit routes Today edits to
 *     onEditToday; the menu, dailyMaintenance, onboarding, decisions and
 *     repairAllTabs all call populateToday / bootstrapToday), and
 *   - would have thrown on the first call anyway, because it depended on
 *     helpers/constants that exist nowhere in the file (plannerTimeZoneV68,
 *     TODAY_UPDATE_TYPES_V68, TODAY_PRIORITY_TYPES_V68,
 *     collectTodayCandidatesV68, pendingDecisionCountV67,
 *     setTodayUpdateGuidanceV68), and assumed a different Today row layout
 *     than the one bootstrapToday actually builds.
 * Removing it makes the v7.2 promise below true again.
 *
 * v7.2 is a full consolidation of the v6.5 → v6.9.3 layered patch history.
 * Every function below has exactly ONE definition. Nothing in this file
 * relies on Apps Script's "last definition wins" behavior — that pattern
 * was the source of most bugs in the prior version and has been removed.
 *
 * THERE IS EXACTLY ONE Today engine: bootstrapToday (layout) +
 * populateToday (staged priority waterfall) + onEditToday (interaction).
 * If you add Today behavior, edit those — never append a second copy.
 *
 * v7.3 also hardens runtime robustness:
 *   - Concurrency: every mutating path runs behind withDocumentLock().
 *   - Performance: getOrgById/getJobRowById/getPersonRowById/getRoundById
 *     do a single bulk getValues() instead of per-field reads.
 *   - Triggers: all trigger wiring flows through ONE idempotent,
 *     check-before-create engine (ensureTriggersInstalled). A dedicated
 *     "Triggers & setup" menu (setUpTriggers + showTriggerStatus) lets you
 *     attach and verify wiring explicitly; repairAllTabs/fullRefresh force
 *     a trigger check on every run; and onOpen reports — rather than
 *     blindly nags about — the installable edit trigger's status. Simple
 *     onOpen/onEdit cannot create installable triggers (platform rule), so
 *     first-time setup is a single menu click, never silent auto-wiring.
 *
 * ARCHITECTURE
 * ------------
 *   Home       = the daily entry point: onboarding status, up to 3 Pending
 *                Decisions (inline, actionable), the Add/update capture
 *                dropdown, a Today's-plan summary, an Upcoming feed, and a
 *                demoted utility refresh control. No raw task table here.
 *   Today      = purely the execution surface: priority/focus, available
 *                minutes, energy, capacity fit, and the Commit/Options
 *                task table. No data capture and no Pending Decisions.
 *   Decisions  = the suggestion queue. States: Pending / Yes / No /
 *                Auto-dismissed. No "Later". Yes promotes to a Task.
 *   Tasks      = sole owner of task existence, status, linked object,
 *                and workflow. Completion always routes through the
 *                same canonical engine regardless of which tab it was
 *                triggered from (Today or Tasks).
 *   Sectors / Organisations / Jobs / People / Conversations / Interviews
 *              = source-of-truth database tabs. Editable directly, but
 *                routine daily capture should happen via Home's
 *                Add/update popups, not by navigating to these tabs.
 *
 * OPERATING RHYTHM
 * ----------------
 *   Welcome → Resolve → Capture → Plan → Execute → Monitor.
 *
 * FLOW
 * ----
 *   Add/update popup → writes real source tab → cascades create
 *   Decisions (only where judgment is genuinely needed — creating or
 *   classifying an Organisation never floods job/people-search tasks
 *   on its own) → Yes on a Decision creates a Task → Today pulls
 *   Tasks through a staged, explicit priority waterfall → completing
 *   a Task on Today or Tasks routes through one canonical handler →
 *   source tabs and downstream cascades update from there.
 *
 * ONBOARDING
 * ----------
 *   "Set up / redo onboarding" is destructive-then-rebuild: it wipes
 *   existing planner data (Sectors/Organisations/Jobs/People/
 *   Conversations/Interviews/Tasks/Decisions bodies) before writing
 *   anything, then captures starting facts entirely through popups —
 *   the user never has to manually navigate to a backend tab. Sector
 *   onboarding is 3 explicit stages:
 *     1. Sector-only row      → direct Task: "List 2-4 sub-sectors"
 *     2. Sub-sector row       → Decision: "Build an org list here?"
 *     3. Yes on that Decision → Task: "Market map: <sub-sector>"
 *                                (No → no market-map Task is created)
 *   This same 3-stage model applies identically whether the sub-sector
 *   was typed directly on the Sectors tab or captured via a popup.
 *
 * INSTALL
 * -------
 *   1. Back up the sheet (File → Make a copy).
 *   2. Paste this entire file as Code.gs (replacing everything else).
 *   3. Run `repairAllTabs` from the Apps Script function dropdown.
 *   4. Run `installEditTrigger` once for reliable Home/Today popups.
 *   5. Run `installTimeTriggers` if this is a fresh install.
 *   6. Reload the sheet.
 */

// =============================================================
// SCHEMA — single source of truth for column layout
// =============================================================

var COLS = {
  SECTORS: { ID: 1, SECTOR: 2, SUBSECTOR: 3, STATUS: 4, NOTES: 5 },

  ORGS: {
    ID: 1, NAME: 2, SECTOR: 3, SUBSECTOR: 4, SUBSECTOR_ID: 5,
    TIER: 6, STATUS: 7,
    KNOWN_PEOPLE: 8, OPEN_OPPS: 9,
    LAST_CHECKED: 10, NEXT_CHECK: 11, NOTES: 12
  },

  PEOPLE: {
    ID: 1, NAME: 2, ORG: 3, ORG_ID: 4,
    ROLE: 5, REL_TYPE: 6, STAGE: 7,
    FOLLOW_UP_DATE: 8, REPLY_RECEIVED: 9,
    FOLLOW_UP_SENT: 10, OUTREACH_DATE: 11,
    CONVERSATION_DATE: 12, NOTES: 13,
    FOLLOW_UPS_SENT_COUNT: 14
  },

  JOBS: {
    ID: 1, OPPORTUNITY: 2, ORG: 3, ORG_ID: 4,
    STATUS: 5, DEADLINE: 6, APPLIED_DATE: 7,
    CONTACTS_IDS: 8, CONTACTS_DISPLAY: 9,
    REVIEW_DATE: 10, RESPONSE: 11, OUTCOME: 12, NOTES: 13
  },

  INTERACTIONS: {
    ID: 1, DATE: 2, PERSON_ID: 3, PERSON: 4, ORG: 5,
    TYPE: 6, NOTES: 7, OUTCOME: 8
  },

  TODO: {
    ID: 1, TASK: 2, OBJ_TYPE: 3, OBJ_ID: 4, ORG: 5,
    WORKFLOW: 6, STATUS: 7, DUE_DATE: 8, TIME_EST: 9,
    NOTES: 10, PARENT_ID: 11, CREATED: 12, COMPLETED: 13,
    COMMITMENT_CLASS: 14, SOURCE: 15, LAST_EDITED: 16,
    CLASS_CALC_AT: 17, EFFORT_TYPE: 18,
    // v7.6 — appended, never inserted mid-schema (would shift every
    // trailing index file-wide for a purely cosmetic win).
    PRIORITY_RANK: 19, LINKED_TO: 20, ON_TODAY: 21, HAS_SUBTASKS: 22
  },

  ROUNDS: {
    ID: 1, JOB_ID: 2, JOB_DISPLAY: 3, ORG_DISPLAY: 4,
    ROUND: 5, ROUND_TYPE: 6, INTERVIEW_DATE: 7,
    STATUS: 8, DOMAIN_READINESS: 9,
    OFFICIAL_OUTCOME: 10, EXPECTED_RESPONSE: 11, NOTES: 12
  },

  DECISIONS: {
    ID: 1, CREATED: 2, KEY: 3, TRIGGER: 4, TASK: 5,
    TARGET_TYPE: 6, TARGET_ID: 7, WORKFLOW: 8, NOTES: 9,
    DECISION: 10, DECIDED_AT: 11, TODO_ID: 12
  },

  TODAY: {
    SLOT: 1, TASK: 2, TODO_ID: 3, EST_MIN: 4,
    CLASS: 5, EFFORT: 6, STATUS: 7, ACTUAL_MIN: 8, NOTES: 9
  }
};

var HEADERS = {
  Sectors: ['Sector ID', 'Sector', 'Sub-sector', 'Status', 'Notes'],
  Organisations: [
    'Org ID', 'Organisation', 'Sector', 'Sub-sector', 'Sub-sector ID',
    'Tier', 'Status', 'Known people (count)', 'Open opportunities (count)',
    'Last checked', 'Next check date', 'Notes'
  ],
  People: [
    'Person ID', 'Name', 'Organisation', 'Org ID',
    'Role', 'Relationship type', 'Stage',
    'Follow-up date', 'Reply received',
    'Follow-up sent?', 'Outreach date', 'Conversation date',
    'Notes', 'Follow-ups sent count'
  ],
  Jobs: [
    'Job ID', 'Opportunity', 'Organisation', 'Org ID',
    'Status', 'Deadline', 'Applied date',
    'Linked contacts (IDs)', 'Linked contacts (display)',
    'Review date', 'Response received', 'Outcome', 'Notes'
  ],
  Interactions: [
    'Interaction ID', 'Date', 'Person ID', 'Person', 'Organisation',
    'Type', 'Key notes', 'Outcome'
  ],
  'To-do': [
    'Task ID', 'Task', 'Linked object type', 'Linked object ID', 'Org',
    'Workflow type', 'Status', 'Due date', 'Time estimate',
    'Notes', 'Parent To-do ID', 'Created', 'Completed',
    'Commitment class', 'Source', 'Last edited', 'Class calculated at', 'Effort type',
    'Priority rank', 'Linked to', 'On Today right now', 'Has sub-tasks'
  ],
  'Interview rounds': [
    'Round ID', 'Linked Job ID', 'Job (display)', 'Org (display)',
    'Round', 'Round type', 'Interview date',
    'Status', 'Domain readiness',
    'Official outcome', 'Expected response date', 'Notes'
  ],
  'Pending decisions': [
    'Decision ID', 'Created', 'Decision key', 'Trigger', 'Suggested task',
    'Target type', 'Target ID', 'Suggested workflow', 'Notes',
    'Decision', 'Decided at', 'Resulting To-do ID'
  ],
  "Today's plan": [
    'Slot', 'Task', 'Linked Task ID', 'Estimated min',
    'Plan', 'Effort', 'Status', 'Actual min', 'Why / notes'
  ]
};

// Canonical (visible) tab name -> the HEADERS/legacy key used to look up
// its column layout. Kept as an explicit map (not string matching) so
// the mapping is visible in one place.
var SHEET_TO_HEADER_KEY = {
  'Home': null,
  'Today': "Today's plan",
  'Decisions': 'Pending decisions',
  'Tasks': 'To-do',
  'Sectors': 'Sectors',
  'Organisations': 'Organisations',
  'Jobs': 'Jobs',
  'People': 'People',
  'Conversations': 'Interactions',
  'Interviews': 'Interview rounds',
  'Guide': null,
  'Dashboard': null
};

// v7.1: legacy tab names from the pre-consolidation (v6.x) workbook.
// migrateLegacyTabs() renames these to canonical names (in place, so all
// existing data is preserved) whenever a canonical tab is missing but a
// legacy-named one is found. Purely additive — never touches a tab if
// the canonical name already exists.
var LEGACY_TAB_NAMES = {
  'Tasks': ['To-do', 'ToDo', 'Todo', 'To Do'],
  'Today': ["Today's plan", "Today's Plan", 'Todays plan', 'Today Plan'],
  'Conversations': ['Interactions'],
  'Interviews': ['Interview rounds', 'Interview Rounds'],
  'Decisions': ['Pending decisions', 'Pending Decisions', 'Suggestions']
};

var CANONICAL_TAB_ORDER = ['Home', 'Today', 'Decisions', 'Tasks', 'Sectors', 'Organisations', 'Jobs', 'People', 'Conversations', 'Interviews', 'Guide'];
var ZONE_WORK_TABS = ['Home', 'Today', 'Decisions', 'Tasks'];
var ZONE_DATA_TABS = ['Sectors', 'Organisations', 'Jobs', 'People', 'Conversations'];
var ZONE_REF_TABS = ['Interviews', 'Guide'];
var ZONE_WORK_COLOR = '#1B474D';
var ZONE_DATA_COLOR = '#964219';
var ZONE_REF_COLOR = '#7A7974';
var HEADER_COLOR = '#1B474D';
var MANUAL_COLOR = '#FFF8DC';
var AUTO_COLOR = '#F1F3F4';
var SCRIPT_VERSION = 'v7.7.4';

var DROPDOWNS = {
  SECTOR_STATUS: ['Open', 'Retired'],

  ORG_TIER: ['A', 'B', 'C'],
  ORG_STATUS: ['Mapped', 'Active', 'Dormant', 'Archived'],

  PERSON_STAGE: ['Identified', 'Outreach sent', 'Engaged', 'Conversation scheduled', 'Conversation completed', 'Nurture', 'Closed'],
  PERSON_REL_TYPE: ['Alumni', 'Warm intro', 'Cold', 'Recruiter', 'Other'],
  YES_NO: ['Yes', 'No'],

  JOB_STATUS: ['Want to apply', 'Applied', 'Interviewing', 'Offer', 'Parked', 'Closed'],

  INTERACTION_TYPE: ['Intro call', 'Coffee', 'LinkedIn message', 'Email', 'Phone', 'Interview', 'Referral', 'Auto-log', 'Other'],
  INTERACTION_OUTCOME: ['Useful', 'Neutral', 'Dead end', 'Referral given', 'Opportunity created', 'Follow-up needed', 'System log'],

  TODO_OBJ_TYPE: ['Sector', 'Organisation', 'Person', 'Job', 'Interview round', 'None'],
  TODO_WORKFLOW: [
    'Sector selection', 'Market mapping', 'Org research',
    'Job board scan', 'Org job scan', 'People sourcing',
    'Outreach', 'Send outreach', 'Contact follow-up',
    'Reply and arrange conversation', 'Conversation prep',
    'Reschedule conversation', 'Conversation debrief', 'Referral search',
    'Application preparation', 'Submit application',
    'Check application response', 'Offer decision',
    'Interview scheduling', 'Interview prep (Domain scoping)',
    'Interview prep (Study)', 'Interview prep (Fit case)',
    'Day-before review', 'Thank-you and debrief',
    'Interview follow-up', 'Admin'
  ],
  TODO_STATUS: ['Not started', 'In progress', 'Done', 'Skipped', 'Cancelled'],
  // v7.6.1: 'Custom…' removed per the handover spec (§8) — never made
  // functional, and parseTimeEst silently treated it as 30 min, which
  // was misleading. Consistent with minimizing daily choices elsewhere.
  TODO_TIME: ['15 min', '30 min', '45 min', '60 min', '90 min', '120 min', 'Multi-day'],
  TODO_COMMITMENT_CLASS: ['Fixed', 'Blocking', 'Keep-alive', 'Active pursuit', 'Pipeline-building', 'Backlog'],
  TODO_SOURCE: ['Auto-triggered', 'Manually added', 'Onboarding', 'Decision', 'Manual pull'],

  ROUND_TYPE: ['Recruiter', 'Hiring manager', 'Panel', 'Case', 'Technical', 'Culture fit', 'Final', 'Other'],
  ROUND_STATUS: ['To schedule', 'Scheduled', 'Completed', 'Cancelled', 'Reschedule'],
  DOMAIN_READINESS: ['Strong', 'Refresh needed', 'Weak or new'],
  OFFICIAL_OUTCOME: ['Waiting', 'Next round', 'Rejected', 'Offer', 'Parked'],

  TODAY_STATUS: ['Planned', 'In progress', 'Done', 'Deferred', 'Skipped'],
  // v7.4: Option rows get a smaller status list — 'Pull in' promotes the
  // row into Commit on the spot instead of waiting for the next refresh.
  TODAY_STATUS_OPTION: ['Deferred', 'Pull in'],
  TODAY_ENERGY: ['Low', 'Normal', 'High'],
  TODAY_PRIORITY: ['Default', 'Applications', 'Networking', 'Interviews', 'Pipeline building', 'Admin / light day'],
  TODAY_UPDATE_TYPES: [
    'No updates', 'Explore sectors', 'Find organisations',
    'Add/update organisation', 'Add/update job', 'Application update',
    'Add/update person', 'Add/update conversation', 'Add/update interview',
    'Task completed / blocked'
  ],

  // Pending decisions — no "Later". Auto-dismissed is system-only.
  DECISION: ['Pending', 'Yes', 'No', 'Auto-dismissed']
};

var REPLY_DAYS_BY_ROUND_TYPE = {
  'Recruiter': 7, 'Hiring manager': 5, 'Case': 7, 'Technical': 7,
  'Panel': 7, 'Final': 10, 'Culture fit': 5, 'Other': 7
};

// =============================================================
// UTILITY — sheets, dates, IDs, styling, string matching
// =============================================================

function plannerTimeZone() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (ss && ss.getSpreadsheetTimeZone) return ss.getSpreadsheetTimeZone();
  } catch (err) { Logger.log('plannerTimeZone: ' + err); }
  return Session.getScriptTimeZone();
}

function getSheet(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss ? ss.getSheetByName(name) : null;
}

// v7.3.1: Serialises every mutating path behind a single document lock so
// two overlapping edits (or an edit landing while dailyMaintenance runs)
// can't double-create tasks or collide on nextId() / appendRow(). Runs fn
// while holding the lock and always releases it, even on error.
//
// IMPORTANT (v7.3.1 fix): if the lock can't be acquired within the
// timeout, fn is STILL RUN (unguarded) rather than silently skipped. In a
// single-user planner, lock contention is rare, but a user clicking
// "Populate Today" and getting NOTHING (no plan, no date update, no error)
// is far worse than a once-in-a-blue-moon race. Correctness of the visible
// action wins; the lock is best-effort protection, not a gate that can
// swallow a user's explicit command. The earlier "skip on miss" behavior
// was why Today's date/plan sometimes didn't refresh.
//
// Nesting is safe: a re-entrancy guard short-circuits nested calls so the
// inner fn runs directly without a second acquire/release.
var _PLANNER_LOCK_HELD = false;
function withDocumentLock(fn, opts) {
  opts = opts || {};
  var timeoutMs = opts.timeoutMs || 20000;
  var label = opts.label || 'operation';
  if (_PLANNER_LOCK_HELD) return fn();   // already inside a locked section
  var lock = LockService.getDocumentLock();
  var got = false;
  try {
    try { got = lock.tryLock(timeoutMs); }
    catch (lockErr) { Logger.log('withDocumentLock acquire (' + label + '): ' + lockErr); got = false; }
    if (!got) {
      // Could not get the lock — run anyway rather than drop the action.
      Logger.log('withDocumentLock: lock unavailable for ' + label + ' after ' + timeoutMs + 'ms — running unguarded so the action still completes.');
      return fn();
    }
    _PLANNER_LOCK_HELD = true;
    return fn();
  } finally {
    if (got) {
      _PLANNER_LOCK_HELD = false;
      try { lock.releaseLock(); } catch (err) { Logger.log('withDocumentLock release (' + label + '): ' + err); }
    }
  }
}

function today() {
  var parts = Utilities.formatDate(new Date(), plannerTimeZone(), 'yyyy-MM-dd').split('-');
  return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
}

function addDays(date, days) { var d = new Date(date); d.setDate(d.getDate() + days); return d; }
function daysBetween(a, b) { return Math.floor((new Date(b) - new Date(a)) / 86400000); }

function formatDateHuman(dateValue) {
  if (!dateValue) return '';
  var d = new Date(dateValue);
  if (isNaN(d.getTime())) return '';
  return Utilities.formatDate(d, plannerTimeZone(), 'yyyy-MM-dd');
}

function parseDateOr(value, fallback) {
  if (!value) return fallback || today();
  var d = new Date(value);
  return isNaN(d.getTime()) ? (fallback || today()) : d;
}

function levenshtein(a, b) {
  a = String(a || ''); b = String(b || '');
  var m = a.length, n = b.length, dp = [];
  for (var i = 0; i <= m; i++) {
    dp[i] = [i];
    for (var j = 1; j <= n; j++) {
      dp[i][j] = i === 0 ? j : j === 0 ? i
        : Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[m][n];
}

function similarity(a, b) {
  a = String(a || ''); b = String(b || '');
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  try {
    var longer = a.length > b.length ? a : b;
    var shorter = a.length > b.length ? b : a;
    var dist = levenshtein(longer.toLowerCase(), shorter.toLowerCase());
    return (longer.length - dist) / longer.length;
  } catch (err) { Logger.log('similarity: ' + err); return 0; }
}

function normalizeKeyPart(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function nextId(sheet, col, prefix) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return prefix + '-001';
  var ids = sheet.getRange(2, col, lastRow - 1, 1).getValues()
    .map(function (r) { return r[0]; })
    .filter(function (v) { return String(v).indexOf(prefix + '-') === 0; });
  if (!ids.length) return prefix + '-001';
  var max = ids.reduce(function (acc, id) {
    var n = parseInt(String(id).replace(prefix + '-', ''), 10);
    return isNaN(n) ? acc : Math.max(acc, n);
  }, 0);
  return prefix + '-' + String(max + 1).padStart(3, '0');
}

function styleHeader(sheet, numCols) {
  sheet.getRange(1, 1, 1, numCols).setBackground(HEADER_COLOR).setFontColor('#FFFFFF').setFontWeight('bold');
}

function setDropdown(range, values) {
  range.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(values, true).setAllowInvalid(true).build());
}

function normalizeTier(value) {
  var v = String(value || '').trim().toUpperCase();
  return (DROPDOWNS.ORG_TIER.indexOf(v) !== -1) ? v : 'B';
}

function normalizeJobStatus(value) {
  var v = String(value || '').trim();
  var legacyMap = {
    'Found': 'Want to apply', 'Worth exploring': 'Want to apply',
    'Referral needed': 'Want to apply', 'Apply now': 'Want to apply',
    'To pursue': 'Want to apply', 'Application ready': 'Want to apply'
  };
  return legacyMap[v] || (DROPDOWNS.JOB_STATUS.indexOf(v) !== -1 ? v : v);
}

function normalizePersonStage(value) {
  var v = String(value || '').trim();
  var legacyMap = {
    'Outreach ready': 'Identified', 'Pending reply': 'Outreach sent',
    'No reply': 'Nurture', 'Conversation to reschedule': 'Conversation scheduled',
    'Relationship active': 'Engaged', 'Qualified': 'Identified',
    'Opportunity lead': 'Engaged'
  };
  return legacyMap[v] || v;
}

// Appends a marker to a Notes cell. A marker of the same bracketed
// category (e.g. "[flags]") replaces any prior one instead of stacking,
// so Notes cells don't become flag graveyards.
function appendNoteFlag(sheet, row, notesCol, flag) {
  var cell = sheet.getRange(row, notesCol);
  var existing = String(cell.getValue() || '');
  var categoryMatch = flag.match(/^(\[[^\]]+\])/);
  if (categoryMatch) {
    var category = categoryMatch[1];
    var escaped = category.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var cleaned = existing.replace(new RegExp(escaped + '[^|]*(\\|\\s*)?', 'g'), '').trim();
    cleaned = cleaned.replace(/\|\s*$/, '').replace(/^\s*\|\s*/, '').trim();
    cell.setValue(cleaned ? cleaned + ' | ' + flag : flag);
  } else if (existing.indexOf(flag) === -1) {
    cell.setValue(existing ? existing + ' | ' + flag : flag);
  }
}

// v7.1: strips a bracketed-category marker (e.g. "[pending-org]") from a
// Notes cell entirely, without adding a replacement. Used when a deferred
// cascade fires and the flag that requested deferral is no longer true.
function clearNoteFlag(sheet, row, notesCol, category) {
  var cell = sheet.getRange(row, notesCol);
  var existing = String(cell.getValue() || '');
  if (existing.indexOf(category) === -1) return;
  var escaped = category.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  var cleaned = existing.replace(new RegExp(escaped + '[^|]*(\\|\\s*)?', 'g'), '').trim();
  cleaned = cleaned.replace(/\|\s*$/, '').replace(/^\s*\|\s*/, '').trim();
  cell.setValue(cleaned);
}

// =============================================================
// ENTITY LOOKUP / CREATE — Organisations, People, Jobs, Rounds
// =============================================================

function findOrgByNameFuzzy(name, threshold) {
  threshold = threshold || 0.85;
  var sheet = getSheet('Organisations');
  if (!sheet || sheet.getLastRow() < 2 || !name) return null;
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS.Organisations.length).getValues();
  var target = normalizeKeyPart(name);
  var best = null, bestScore = 0;
  for (var i = 0; i < data.length; i++) {
    var candidate = normalizeKeyPart(data[i][COLS.ORGS.NAME - 1]);
    if (!candidate) continue;
    var score = candidate === target ? 1 : similarity(target, candidate);
    if (score > bestScore) { bestScore = score; best = { row: i + 2, data: data[i], score: score }; }
  }
  return bestScore >= threshold ? best : null;
}

// v7.3: single bulk getValues() over the needed columns instead of one
// getRange().getValue() per field. Matters as Organisations grows into
// the hundreds — turns ~7 Sheets round-trips per lookup into 1.
function getOrgById(orgId) {
  var sheet = getSheet('Organisations');
  if (!sheet || sheet.getLastRow() < 2 || !orgId) return null;
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, COLS.ORGS.STATUS).getValues();
  var target = String(orgId);
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][COLS.ORGS.ID - 1]) === target) {
      var row = data[i];
      return {
        row: i + 2, id: orgId,
        name: row[COLS.ORGS.NAME - 1],
        sector: row[COLS.ORGS.SECTOR - 1],
        subsector: row[COLS.ORGS.SUBSECTOR - 1],
        subsectorId: row[COLS.ORGS.SUBSECTOR_ID - 1],
        tier: row[COLS.ORGS.TIER - 1],
        status: row[COLS.ORGS.STATUS - 1]
      };
    }
  }
  return null;
}

// These formulas intentionally hardcode People/Jobs column letters (D and
// E). They are safe only under the project convention that new columns
// are appended, never inserted before existing Org ID / Status columns.
function applyOrgRowFormulas(sheet, row) {
  sheet.getRange(row, COLS.ORGS.KNOWN_PEOPLE).setFormula('=COUNTIF(People!D:D,A' + row + ')');
  sheet.getRange(row, COLS.ORGS.OPEN_OPPS).setFormula(
    '=COUNTIFS(Jobs!D:D,A' + row + ',Jobs!E:E,"<>Closed",Jobs!E:E,"<>Parked")');
}

// Creates a name-only Organisation row (no cascade fired) — used when a
// Job or Person references an org that doesn't exist yet. Per spec: this
// never fires job-search or people-search cascades on its own unless the
// caller explicitly passes status Active. Status defaults to Mapped,
// which is inert.
//
// v7.1: honors an explicitly-requested Dormant/Archived status too (not
// just Active) — previously only Active was ever passed through by
// callers; Mapped was hardcoded elsewhere. See processOrgOnboarding /
// processCapturePayload for where the user's choice now flows through.
function createNameOnlyOrg(orgName, opts) {
  opts = opts || {};
  if (!orgName) return null;
  var existing = findOrgByNameFuzzy(orgName, 0.85);
  if (existing) {
    var canonicalName = existing.data[COLS.ORGS.NAME - 1];
    // v7.6.3 §4.1: the fuzzy match is silent by design (no popup on the
    // stub path), but if the typed text doesn't match the stored name
    // verbatim, leave an auditable trace on the matched row instead of
    // rewriting it without a trace — a wrong canonical name (typo) would
    // otherwise silently absorb every future correctly-typed mention.
    if (String(orgName).trim() !== String(canonicalName).trim()) {
      var orgSheetForTrace = getSheet('Organisations');
      if (orgSheetForTrace) {
        appendNoteFlag(orgSheetForTrace, existing.row, COLS.ORGS.NOTES, '[matched-typed-as] "' + orgName + '"');
        appendNoteFlag(orgSheetForTrace, existing.row, COLS.ORGS.NOTES, '[review-name] Possible canonical-name typo');
      }
    }
    return { id: existing.data[COLS.ORGS.ID - 1], row: existing.row, name: canonicalName, existing: true };
  }
  var sheet = getSheet('Organisations');
  if (!sheet) return null;
  var id = nextId(sheet, COLS.ORGS.ID, 'ORG');
  var status = (DROPDOWNS.ORG_STATUS.indexOf(opts.status) !== -1) ? opts.status : 'Mapped';
  var row = new Array(HEADERS.Organisations.length).fill('');
  row[COLS.ORGS.ID - 1] = id;
  row[COLS.ORGS.NAME - 1] = orgName;
  row[COLS.ORGS.TIER - 1] = normalizeTier(opts.tier || 'B');
  row[COLS.ORGS.STATUS - 1] = status;
  row[COLS.ORGS.LAST_CHECKED - 1] = today();
  if (status === 'Dormant') row[COLS.ORGS.NEXT_CHECK - 1] = addDays(today(), 42);
  row[COLS.ORGS.NOTES - 1] = opts.stub ? '[stub] name-only org created from a linked Job/Person' : '';
  sheet.appendRow(row);
  var newRow = sheet.getLastRow();
  applyOrgRowFormulas(sheet, newRow);
  if (status === 'Active') fireOrgActiveCascade(id, orgName);
  return { id: id, row: newRow, name: orgName, existing: false };
}

function applyOrganisationStatusFromCapture(org, status, tier) {
  if (!org || !org.row) return;
  var sheet = getSheet('Organisations');
  if (!sheet) return;
  var normalized = (status && DROPDOWNS.ORG_STATUS.indexOf(status) !== -1) ? status : 'Mapped';
  if (tier) sheet.getRange(org.row, COLS.ORGS.TIER).setValue(normalizeTier(tier));
  sheet.getRange(org.row, COLS.ORGS.STATUS).setValue(normalized);
  if (normalized === 'Active') {
    fireOrgActiveCascade(org.id, org.name);
  } else if (normalized === 'Dormant') {
    sheet.getRange(org.row, COLS.ORGS.NEXT_CHECK).setValue(addDays(today(), 42));
    autoDismissPendingForTarget('Organisation', org.id, 'Organisation marked Dormant');
    setOpenTodosForTarget('Organisation', org.id, 'Skipped', 'Organisation parked/dormant');
  } else if (normalized === 'Archived') {
    autoDismissPendingForTarget('Organisation', org.id, 'Organisation archived');
    setOpenTodosForTarget('Organisation', org.id, 'Cancelled', 'Organisation archived');
  }
}

function inheritOrgFields(sheet, editedRow, nameCol, orgIdCol) {
  var orgName = sheet.getRange(editedRow, nameCol).getValue();
  if (!orgName) return;
  var org = createNameOnlyOrg(String(orgName).trim(), { status: 'Mapped', stub: true });
  if (!org) return;
  sheet.getRange(editedRow, nameCol).setValue(org.name);
  sheet.getRange(editedRow, orgIdCol).setValue(org.id);
}

function checkOrgDuplicate(sheet, editedRow) {
  var newName = sheet.getRange(editedRow, COLS.ORGS.NAME).getValue();
  if (!newName) return;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  // v7.6.3 §4.2: read Org ID alongside Name so a declined merge can be
  // remembered by ID (names can change later, IDs don't).
  var data = sheet.getRange(2, COLS.ORGS.ID, lastRow - 1, COLS.ORGS.NAME - COLS.ORGS.ID + 1).getValues();
  var editedNotes = String(sheet.getRange(editedRow, COLS.ORGS.NOTES).getValue() || '');
  for (var i = 0; i < data.length; i++) {
    var rowNum = i + 2;
    var candidateId = data[i][0];
    var candidateName = data[i][COLS.ORGS.NAME - COLS.ORGS.ID];
    if (rowNum === editedRow || !candidateName) continue;
    if (similarity(newName, String(candidateName)) >= 0.85) {
      var reviewFlag = '[reviewed-similar-org: ' + candidateId + ']';
      if (editedNotes.indexOf(reviewFlag) !== -1) continue; // already declined this specific pair — don't re-prompt
      var ui = SpreadsheetApp.getUi();
      var resp = ui.alert('Possible duplicate organisation',
        '"' + newName + '" looks similar to "' + candidateName + '" (row ' + rowNum + '). Merge into existing?',
        ui.ButtonSet.YES_NO);
      if (resp === ui.Button.YES) {
        sheet.getRange(editedRow, COLS.ORGS.NAME).setValue(candidateName);
      } else {
        appendNoteFlag(sheet, editedRow, COLS.ORGS.NOTES, reviewFlag);
      }
      break;
    }
  }
}

function findPersonByNameOrg(name, org) {
  var sheet = getSheet('People');
  if (!sheet || sheet.getLastRow() < 2 || !name) return null;
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS.People.length).getValues();
  var n = normalizeKeyPart(name), o = normalizeKeyPart(org);
  var best = null, bestScore = 0;
  for (var i = 0; i < data.length; i++) {
    var sameOrg = !o || normalizeKeyPart(data[i][COLS.PEOPLE.ORG - 1]) === o || normalizeKeyPart(data[i][COLS.PEOPLE.ORG_ID - 1]) === o;
    if (!sameOrg) continue;
    var score = similarity(n, normalizeKeyPart(data[i][COLS.PEOPLE.NAME - 1]));
    if (score > bestScore) { bestScore = score; best = { row: i + 2, data: data[i], score: score }; }
  }
  return bestScore >= 0.85 ? best : null;
}

function findPeopleByNameOrgScoped(name, orgId, orgName) {
  var sheet = getSheet('People');
  if (!sheet || sheet.getLastRow() < 2 || !name) return [];
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS.People.length).getValues();
  var n = normalizeKeyPart(name), orgKey = normalizeKeyPart(orgName), idKey = String(orgId || '');
  var matches = [];
  for (var i = 0; i < data.length; i++) {
    var sameOrg = idKey ? String(data[i][COLS.PEOPLE.ORG_ID - 1]) === idKey : (orgKey && normalizeKeyPart(data[i][COLS.PEOPLE.ORG - 1]) === orgKey);
    if (!sameOrg) continue;
    if (similarity(n, normalizeKeyPart(data[i][COLS.PEOPLE.NAME - 1])) >= 0.85) matches.push({ row: i + 2, data: data[i] });
  }
  return matches;
}

// v7.3: single bulk read (see getOrgById).
function getPersonRowById(personId) {
  var sheet = getSheet('People');
  if (!sheet || sheet.getLastRow() < 2 || !personId) return null;
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, COLS.PEOPLE.STAGE).getValues();
  var target = String(personId);
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][COLS.PEOPLE.ID - 1]) === target) {
      var row = data[i];
      return {
        row: i + 2, id: personId,
        name: row[COLS.PEOPLE.NAME - 1],
        org: row[COLS.PEOPLE.ORG - 1],
        orgId: row[COLS.PEOPLE.ORG_ID - 1],
        stage: row[COLS.PEOPLE.STAGE - 1]
      };
    }
  }
  return null;
}

function checkPeopleDuplicate(sheet, editedRow) {
  var newName = sheet.getRange(editedRow, COLS.PEOPLE.NAME).getValue();
  var newOrg = sheet.getRange(editedRow, COLS.PEOPLE.ORG).getValue();
  var newOrgId = sheet.getRange(editedRow, COLS.PEOPLE.ORG_ID).getValue();
  if (!newName) return;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  var data = sheet.getRange(2, 1, lastRow - 1, HEADERS.People.length).getValues();
  for (var i = 0; i < data.length; i++) {
    var existingRow = i + 2;
    if (existingRow === editedRow) continue;
    var existingName = String(data[i][COLS.PEOPLE.NAME - 1]);
    if (!existingName || similarity(newName, existingName) < 0.85) continue;
    var existingOrg = String(data[i][COLS.PEOPLE.ORG - 1]);
    var existingOrgId = String(data[i][COLS.PEOPLE.ORG_ID - 1] || '');
    if (newOrgId && existingOrgId && String(newOrgId) !== existingOrgId) continue;
    if (!newOrgId && newOrg && existingOrg && normalizeKeyPart(newOrg) !== normalizeKeyPart(existingOrg)) continue;
    var ui = SpreadsheetApp.getUi();
    var resp = ui.alert('Possible duplicate person',
      '"' + existingName + '" at "' + existingOrg + '" already exists (row ' + existingRow + ').', ui.ButtonSet.OK);
    break;
  }
}

function findJobByTitleOrg(title, org) {
  var sheet = getSheet('Jobs');
  if (!sheet || sheet.getLastRow() < 2 || !title) return null;
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS.Jobs.length).getValues();
  var t = normalizeKeyPart(title), o = normalizeKeyPart(org);
  var best = null, bestScore = 0;
  for (var i = 0; i < data.length; i++) {
    var sameOrg = !o || normalizeKeyPart(data[i][COLS.JOBS.ORG - 1]) === o || normalizeKeyPart(data[i][COLS.JOBS.ORG_ID - 1]) === o;
    if (!sameOrg) continue;
    var score = similarity(t, normalizeKeyPart(data[i][COLS.JOBS.OPPORTUNITY - 1]));
    if (score > bestScore) { bestScore = score; best = { row: i + 2, data: data[i], score: score }; }
  }
  return bestScore >= 0.85 ? best : null;
}

// v7.3: single bulk read (see getOrgById).
function getJobRowById(jobId) {
  var sheet = getSheet('Jobs');
  if (!sheet || sheet.getLastRow() < 2 || !jobId) return null;
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, COLS.JOBS.NOTES).getValues();
  var target = String(jobId);
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][COLS.JOBS.ID - 1]) === target) {
      var row = data[i];
      return {
        row: i + 2, id: jobId,
        title: row[COLS.JOBS.OPPORTUNITY - 1],
        org: row[COLS.JOBS.ORG - 1],
        orgId: row[COLS.JOBS.ORG_ID - 1],
        status: row[COLS.JOBS.STATUS - 1],
        deadline: row[COLS.JOBS.DEADLINE - 1],
        appliedDate: row[COLS.JOBS.APPLIED_DATE - 1],
        response: row[COLS.JOBS.RESPONSE - 1],
        outcome: row[COLS.JOBS.OUTCOME - 1]
      };
    }
  }
  return null;
}

function checkJobDuplicate(sheet, editedRow) {
  var newTitle = sheet.getRange(editedRow, COLS.JOBS.OPPORTUNITY).getValue();
  var newOrg = sheet.getRange(editedRow, COLS.JOBS.ORG).getValue();
  var newOrgId = sheet.getRange(editedRow, COLS.JOBS.ORG_ID).getValue();
  if (!newTitle) return;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  var data = sheet.getRange(2, 1, lastRow - 1, HEADERS.Jobs.length).getValues();
  for (var i = 0; i < data.length; i++) {
    var existingRow = i + 2;
    if (existingRow === editedRow) continue;
    var existingTitle = String(data[i][COLS.JOBS.OPPORTUNITY - 1]);
    if (!existingTitle || similarity(newTitle, existingTitle) < 0.85) continue;
    var existingOrg = String(data[i][COLS.JOBS.ORG - 1]);
    var existingOrgId = String(data[i][COLS.JOBS.ORG_ID - 1] || '');
    if (newOrgId && existingOrgId && String(newOrgId) !== existingOrgId) continue;
    if (!newOrgId && newOrg && existingOrg && normalizeKeyPart(existingOrg) !== normalizeKeyPart(newOrg)) continue;
    SpreadsheetApp.getUi().alert('Possible duplicate job',
      '"' + existingTitle + '" at "' + existingOrg + '" already exists (row ' + existingRow + ').', SpreadsheetApp.getUi().ButtonSet.OK);
    break;
  }
}

// v7.3: single bulk read (see getOrgById).
function getRoundById(roundId) {
  var sheet = getSheet('Interviews');
  if (!sheet || sheet.getLastRow() < 2 || !roundId) return null;
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS['Interview rounds'].length).getValues();
  var target = String(roundId);
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][COLS.ROUNDS.ID - 1]) === target) {
      var row = data[i];
      return {
        row: i + 2, id: roundId,
        jobId: row[COLS.ROUNDS.JOB_ID - 1],
        job: row[COLS.ROUNDS.JOB_DISPLAY - 1],
        org: row[COLS.ROUNDS.ORG_DISPLAY - 1],
        round: row[COLS.ROUNDS.ROUND - 1],
        roundType: row[COLS.ROUNDS.ROUND_TYPE - 1],
        interviewDate: row[COLS.ROUNDS.INTERVIEW_DATE - 1],
        status: row[COLS.ROUNDS.STATUS - 1],
        domainReadiness: row[COLS.ROUNDS.DOMAIN_READINESS - 1],
        officialOutcome: row[COLS.ROUNDS.OFFICIAL_OUTCOME - 1],
        expectedResponse: row[COLS.ROUNDS.EXPECTED_RESPONSE - 1],
        notes: row[COLS.ROUNDS.NOTES - 1]
      };
    }
  }
  return null;
}

function findRoundByJobRound(jobId, roundNum) {
  var sheet = getSheet('Interviews');
  if (!sheet || sheet.getLastRow() < 2 || !jobId || !roundNum) return null;
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS['Interview rounds'].length).getValues();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][COLS.ROUNDS.JOB_ID - 1]) === String(jobId) &&
        String(data[i][COLS.ROUNDS.ROUND - 1]) === String(roundNum)) {
      return { id: String(data[i][COLS.ROUNDS.ID - 1] || ''), row: i + 2, created: false, roundNum: roundNum };
    }
  }
  return null;
}

function jobHasRounds(jobId) {
  var sheet = getSheet('Interviews');
  if (!sheet || sheet.getLastRow() < 2 || !jobId) return false;
  var ids = sheet.getRange(2, COLS.ROUNDS.JOB_ID, sheet.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(jobId)) return true;
  return false;
}

function nextRoundNumberForJob(jobId) {
  var sheet = getSheet('Interviews');
  if (!sheet || sheet.getLastRow() < 2 || !jobId) return 1;
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, COLS.ROUNDS.ROUND).getValues();
  var maxRound = 0;
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][COLS.ROUNDS.JOB_ID - 1]) !== String(jobId)) continue;
    var round = parseInt(data[i][COLS.ROUNDS.ROUND - 1], 10);
    if (!isNaN(round)) maxRound = Math.max(maxRound, round);
  }
  return maxRound + 1;
}

// =============================================================
// PENDING DECISIONS — the suggestion queue
// States: Pending / Yes / No / Auto-dismissed. No "Later".
// =============================================================

function ensureDecisionsTab() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = getSheet('Decisions');
  if (!sheet) sheet = ss.insertSheet('Decisions', Math.min(3, ss.getSheets().length));
  if (sheet.getLastRow() < 1) sheet.appendRow(HEADERS['Pending decisions']);
  sheet.getRange(1, 1, 1, HEADERS['Pending decisions'].length).setValues([HEADERS['Pending decisions']]);
  styleHeader(sheet, HEADERS['Pending decisions'].length);
  setDropdown(sheet.getRange(2, COLS.DECISIONS.DECISION, Math.max(1, sheet.getMaxRows() - 1), 1), DROPDOWNS.DECISION);
  return sheet;
}

function findDecisionByKey(key) {
  var sheet = ensureDecisionsTab();
  if (!sheet || sheet.getLastRow() < 2 || !key) return null;
  var keys = sheet.getRange(2, COLS.DECISIONS.KEY, sheet.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < keys.length; i++) {
    if (String(keys[i][0]) === String(key)) return { row: i + 2 };
  }
  return null;
}

function findPendingDecisionByKey(key) {
  var sheet = ensureDecisionsTab();
  if (!sheet || sheet.getLastRow() < 2 || !key) return null;
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS['Pending decisions'].length).getValues();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][COLS.DECISIONS.KEY - 1]) === String(key) &&
        String(data[i][COLS.DECISIONS.DECISION - 1]) === 'Pending') {
      return { row: i + 2, data: data[i] };
    }
  }
  return null;
}

function getDecisionRowById(decisionId) {
  var sheet = ensureDecisionsTab();
  if (!sheet || sheet.getLastRow() < 2 || !decisionId) return null;
  var ids = sheet.getRange(2, COLS.DECISIONS.ID, sheet.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(decisionId)) return { sheet: sheet, row: i + 2 };
  }
  return null;
}

// Creates a Pending decision. Deduplicated only against an already-pending
// row for the same key; historical Yes/No/Auto-dismissed rows are audit
// history and must not permanently block a legitimate future suggestion.
function appendPendingDecision(key, trigger, task, targetType, targetId, workflow, notes) {
  var sheet = ensureDecisionsTab();
  if (!key || !sheet) return '';
  var existing = findPendingDecisionByKey(key);
  if (existing) {
    sheet.getRange(existing.row, COLS.DECISIONS.TRIGGER).setValue(trigger || '');
    sheet.getRange(existing.row, COLS.DECISIONS.TASK).setValue(task || '');
    sheet.getRange(existing.row, COLS.DECISIONS.TARGET_TYPE).setValue(targetType || 'None');
    sheet.getRange(existing.row, COLS.DECISIONS.TARGET_ID).setValue(targetId || '');
    sheet.getRange(existing.row, COLS.DECISIONS.WORKFLOW).setValue(workflow || 'Admin');
    sheet.getRange(existing.row, COLS.DECISIONS.NOTES).setValue(notes || '');
    return String(existing.data[COLS.DECISIONS.ID - 1] || '');
  }
  var id = nextId(sheet, COLS.DECISIONS.ID, 'DEC');
  var row = new Array(HEADERS['Pending decisions'].length).fill('');
  row[COLS.DECISIONS.ID - 1] = id;
  row[COLS.DECISIONS.CREATED - 1] = today();
  row[COLS.DECISIONS.KEY - 1] = key;
  row[COLS.DECISIONS.TRIGGER - 1] = trigger;
  row[COLS.DECISIONS.TASK - 1] = task;
  row[COLS.DECISIONS.TARGET_TYPE - 1] = targetType || 'None';
  row[COLS.DECISIONS.TARGET_ID - 1] = targetId || '';
  row[COLS.DECISIONS.WORKFLOW - 1] = workflow || 'Admin';
  row[COLS.DECISIONS.NOTES - 1] = notes || '';
  row[COLS.DECISIONS.DECISION - 1] = 'Pending';
  sheet.appendRow(row);
  return id;
}

function defaultTimeForWorkflow(workflow) {
  switch (String(workflow || '')) {
    case 'Market mapping': return '45 min';
    case 'Application preparation': return '60 min';
    case 'People sourcing':
    case 'Org job scan':
    case 'Referral search':
    case 'Conversation prep': return '30 min';
    case 'Offer decision': return '30 min';
    case 'Contact follow-up':
    case 'Reply and arrange conversation':
    case 'Submit application':
    case 'Interview follow-up':
    case 'Check application response':
    case 'Admin': return '15 min';
    default: return '30 min';
  }
}

function resolveOrgForTarget(targetType, targetId) {
  if (targetType === 'Organisation') { var o = getOrgById(targetId); return o ? o.name : ''; }
  if (targetType === 'Job') { var j = getJobRowById(targetId); return j ? j.org : ''; }
  if (targetType === 'Person') { var p = getPersonRowById(targetId); return p ? p.org : ''; }
  return '';
}

// Yes on a Decision → create the Task. Source='Decision' so it's visible
// in Tasks/Today as having originated from a reviewed suggestion.
function acceptPendingDecision(sheet, row) {
  var task = sheet.getRange(row, COLS.DECISIONS.TASK).getValue();
  var targetType = sheet.getRange(row, COLS.DECISIONS.TARGET_TYPE).getValue();
  var targetId = sheet.getRange(row, COLS.DECISIONS.TARGET_ID).getValue();
  var workflow = sheet.getRange(row, COLS.DECISIONS.WORKFLOW).getValue();
  var notes = sheet.getRange(row, COLS.DECISIONS.NOTES).getValue();
  var existingTodoId = String(sheet.getRange(row, COLS.DECISIONS.TODO_ID).getValue() || '');
  if (existingTodoId) {
    sheet.getRange(row, COLS.DECISIONS.DECIDED_AT).setValue(today());
    return { ok: true, todoId: existingTodoId, reused: true };
  }
  var org = resolveOrgForTarget(targetType, targetId);
  var todoId = appendTodoWithSource(task, targetType, targetId, org, workflow, 'Not started', '', defaultTimeForWorkflow(workflow), notes, 'Decision');
  if (!todoId) todoId = findOpenTodoByTaskTarget(task, targetId, workflow);
  if (todoId) {
    sheet.getRange(row, COLS.DECISIONS.TODO_ID).setValue(todoId);
  } else {
    sheet.getRange(row, COLS.DECISIONS.DECISION).setValue('Pending');
    appendNoteFlag(sheet, row, COLS.DECISIONS.NOTES, '[yes-failed] Task was not created or found');
    return { ok: false, todoId: '', reason: 'Task was not created or found' };
  }
  sheet.getRange(row, COLS.DECISIONS.DECIDED_AT).setValue(today());
  return { ok: true, todoId: todoId, reused: false };
}

// Shared by onEditDecisions and handleDecisionAction: writes the chosen
// action onto the Decisions row, runs the accept flow on Yes (which may
// revert the row back to Pending on failure — see acceptPendingDecision),
// and stamps Decided at for No/Auto-dismissed. Returns the accept result
// (or null for No/Auto-dismissed) so callers can toast appropriately.
function resolveDecision(decisionsSheet, row, action) {
  decisionsSheet.getRange(row, COLS.DECISIONS.DECISION).setValue(action);
  var accepted = null;
  if (action === 'Yes') accepted = acceptPendingDecision(decisionsSheet, row);
  if (action === 'No' || action === 'Auto-dismissed') decisionsSheet.getRange(row, COLS.DECISIONS.DECIDED_AT).setValue(today());
  return accepted;
}

function toastForDecisionOutcome(action, accepted) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (action !== 'Yes') { ss.toast('Decision dismissed.', 'The Planner', 3); return; }
  if (accepted && accepted.ok) {
    ss.toast(accepted.reused ? 'Already linked to an existing task.' : 'Decision promoted to a Task.', 'The Planner', 3);
  } else {
    ss.toast('Decision could not create a Task. It was kept Pending with a note.', 'The Planner', 6);
  }
}

function onEditDecisions(sheet, row, col, newVal, e) {
  if (row <= 1 || col !== COLS.DECISIONS.DECISION) return;
  var decision = String(newVal || '');
  if (DROPDOWNS.DECISION.indexOf(decision) === -1) return;
  // The cell already holds the new value by the time onEdit fires, so the
  // "already resolved" check other paths use (compare current vs Pending)
  // can't apply here — check the previous value instead. A no-op re-edit
  // (e.g. Yes -> Yes) still routes through resolveDecision, which is safe:
  // acceptPendingDecision's own existingTodoId guard makes re-accepting
  // idempotent rather than creating a second Task.
  var wasAlreadyResolved = e && e.oldValue && ['Yes', 'No', 'Auto-dismissed'].indexOf(String(e.oldValue)) !== -1;
  var accepted = resolveDecision(sheet, row, decision);
  renderTodayDecisionCards();
  refreshHome();
  if (decision === 'Yes' && accepted && accepted.ok) populateToday();
  if (!wasAlreadyResolved) toastForDecisionOutcome(decision, accepted);
}

// System-only: when the underlying source state changes in a way that
// makes a pending suggestion moot (e.g. the org got archived), the
// suggestion is auto-dismissed rather than left dangling.
function autoDismissPendingForTarget(targetType, targetId, reason) {
  var sheet = ensureDecisionsTab();
  if (!sheet || sheet.getLastRow() < 2 || !targetId) return 0;
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS['Pending decisions'].length).getValues();
  var count = 0;
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][COLS.DECISIONS.TARGET_TYPE - 1]) !== String(targetType)) continue;
    if (String(data[i][COLS.DECISIONS.TARGET_ID - 1]) !== String(targetId)) continue;
    if (String(data[i][COLS.DECISIONS.DECISION - 1]) !== 'Pending') continue;
    var r = i + 2;
    sheet.getRange(r, COLS.DECISIONS.DECISION).setValue('Auto-dismissed');
    sheet.getRange(r, COLS.DECISIONS.DECIDED_AT).setValue(today());
    appendNoteFlag(sheet, r, COLS.DECISIONS.NOTES, '[auto-dismissed] ' + (reason || 'Underlying state changed'));
    count++;
  }
  return count;
}

function dismissDecisionByKey(key, reason) {
  var found = findPendingDecisionByKey(key);
  if (!found) return false;
  var sheet = ensureDecisionsTab();
  sheet.getRange(found.row, COLS.DECISIONS.DECISION).setValue('No');
  sheet.getRange(found.row, COLS.DECISIONS.DECIDED_AT).setValue(today());
  if (reason) appendNoteFlag(sheet, found.row, COLS.DECISIONS.NOTES, '[no] ' + reason);
  return true;
}

function pendingDecisionCount() {
  var sheet = getSheet('Decisions');
  if (!sheet || sheet.getLastRow() < 2) return 0;
  var decisions = sheet.getRange(2, COLS.DECISIONS.DECISION, sheet.getLastRow() - 1, 1).getValues();
  var count = 0;
  decisions.forEach(function (d) { if (String(d[0]) === 'Pending') count++; });
  return count;
}

// Up to `limit` (default 3) pending decisions, oldest-created first.
function firstPendingDecisions(limit) {
  limit = limit || 3;
  var sheet = ensureDecisionsTab();
  if (!sheet || sheet.getLastRow() < 2) return [];
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS['Pending decisions'].length).getValues();
  var out = [];
  for (var i = 0; i < data.length && out.length < limit; i++) {
    if (String(data[i][COLS.DECISIONS.DECISION - 1]) === 'Pending') out.push({ row: i + 2, data: data[i] });
  }
  return out;
}

// =============================================================
// COMMITMENT CLASS & EFFORT TYPE — classification for Today's waterfall
// =============================================================

function resolveDaysToLinkedDate(workflow, objId, objType, dueDate) {
  var targetDate = null;
  if (objType === 'Interview round' && objId) {
    var round = getRoundById(objId);
    if (round) {
      var roundsSheet = getSheet('Interviews');
      var iDate = roundsSheet.getRange(round.row, COLS.ROUNDS.INTERVIEW_DATE).getValue();
      if (iDate) targetDate = new Date(iDate);
    }
  } else if (objType === 'Job' && objId) {
    var job = getJobRowById(objId);
    if (job && job.deadline) targetDate = new Date(job.deadline);
  }
  if (!targetDate && dueDate) targetDate = new Date(dueDate);
  if (!targetDate || isNaN(targetDate.getTime())) return null;
  return daysBetween(today(), targetDate);
}

// v7.6 §3: the workflows whose commitment class is date-conditional in
// assignCommitmentClass below (Fixed/Blocking above a day threshold) —
// used by runQueueHygiene to flag a task that has no usable date at all
// (neither its own Due date nor a linked Job deadline/Interview date).
var DATE_CONDITIONAL_WORKFLOWS = [
  'Interview scheduling', 'Submit application',
  'Interview prep (Domain scoping)', 'Interview prep (Study)', 'Interview prep (Fit case)',
  'Application preparation'
];

function assignCommitmentClass(workflow, dueDate, objId, objType) {
  if (!workflow) return 'Backlog';
  var daysToLinked = null;
  try { daysToLinked = resolveDaysToLinkedDate(workflow, objId, objType, dueDate); }
  catch (err) { Logger.log('assignCommitmentClass: ' + err); }

  switch (workflow) {
    case 'Day-before review': return 'Fixed';
    case 'Interview scheduling': return (daysToLinked !== null && daysToLinked <= 2) ? 'Fixed' : 'Active pursuit';
    case 'Submit application': return (daysToLinked !== null && daysToLinked <= 3) ? 'Fixed' : 'Blocking';
    case 'Interview prep (Domain scoping)':
    case 'Interview prep (Study)':
    case 'Interview prep (Fit case)':
    case 'Application preparation':
      return (daysToLinked !== null && daysToLinked <= 7) ? 'Blocking' : 'Active pursuit';
    case 'Contact follow-up':
    case 'Reply and arrange conversation':
    case 'Thank-you and debrief':
    case 'Reschedule conversation':
    case 'Interview follow-up':
    case 'Check application response':
      return 'Keep-alive';
    case 'Referral search':
    case 'Outreach':
    case 'Send outreach':
    case 'Conversation prep':
    case 'Conversation debrief':
    case 'Offer decision':
      return 'Active pursuit';
    case 'Sector selection':
    case 'Market mapping':
    case 'Org research':
    case 'People sourcing':
    case 'Org job scan':
    case 'Job board scan':
      return 'Pipeline-building';
    case 'Admin': return 'Backlog';
    default: return 'Backlog';
  }
}

function deriveEffortType(workflow) {
  var deep = ['Application preparation', 'Interview prep (Domain scoping)', 'Interview prep (Study)', 'Interview prep (Fit case)', 'Market mapping', 'Sector selection', 'Org research'];
  var medium = ['People sourcing', 'Org job scan', 'Job board scan', 'Referral search', 'Day-before review', 'Conversation prep'];
  var shallow = ['Contact follow-up', 'Reply and arrange conversation', 'Reschedule conversation', 'Thank-you and debrief', 'Send outreach', 'Submit application', 'Interview scheduling', 'Interview follow-up', 'Conversation debrief', 'Outreach', 'Check application response', 'Offer decision'];
  if (deep.indexOf(workflow) !== -1) return 'Deep';
  if (medium.indexOf(workflow) !== -1) return 'Medium';
  if (shallow.indexOf(workflow) !== -1) return 'Shallow';
  if (workflow === 'Admin') return 'Variable';
  return '';
}

function recalculateCommitmentClasses() {
  var sheet = getSheet('Tasks');
  if (!sheet || sheet.getLastRow() < 2) return;
  var todayDate = today();
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, COLS.TODO.CLASS_CALC_AT).getValues();
  for (var i = 0; i < data.length; i++) {
    var r = i + 2, row = data[i];
    var status = String(row[COLS.TODO.STATUS - 1]);
    if (status === 'Done' || status === 'Skipped' || status === 'Cancelled') continue;
    var classCalcAt = row[COLS.TODO.CLASS_CALC_AT - 1];
    if (classCalcAt) {
      var calcDate = new Date(classCalcAt); calcDate.setHours(0, 0, 0, 0);
      if (calcDate.getTime() === todayDate.getTime()) continue;
    }
    var newClass = assignCommitmentClass(String(row[COLS.TODO.WORKFLOW - 1]), row[COLS.TODO.DUE_DATE - 1], String(row[COLS.TODO.OBJ_ID - 1]), String(row[COLS.TODO.OBJ_TYPE - 1]));
    if (newClass !== String(row[COLS.TODO.COMMITMENT_CLASS - 1])) sheet.getRange(r, COLS.TODO.COMMITMENT_CLASS).setValue(newClass);
    sheet.getRange(r, COLS.TODO.CLASS_CALC_AT).setValue(todayDate);
  }
}

function recalcTodosLinkedToObject(linkedObjId) {
  if (!linkedObjId) return;
  var sheet = getSheet('Tasks');
  if (!sheet || sheet.getLastRow() < 2) return;
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, COLS.TODO.CLASS_CALC_AT).getValues();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][COLS.TODO.OBJ_ID - 1]) !== linkedObjId) continue;
    var status = String(data[i][COLS.TODO.STATUS - 1]);
    if (status === 'Done' || status === 'Skipped' || status === 'Cancelled') continue;
    var newClass = assignCommitmentClass(String(data[i][COLS.TODO.WORKFLOW - 1]), data[i][COLS.TODO.DUE_DATE - 1], linkedObjId, String(data[i][COLS.TODO.OBJ_TYPE - 1]));
    sheet.getRange(i + 2, COLS.TODO.COMMITMENT_CLASS).setValue(newClass);
    sheet.getRange(i + 2, COLS.TODO.CLASS_CALC_AT).setValue(today());
  }
}

function syncTaskHealthFlags(sheet, row, rowData, daysSinceEdit) {
  var todoId = String(rowData[COLS.TODO.ID - 1] || '');
  var timeEst = String(rowData[COLS.TODO.TIME_EST - 1] || '');
  var workflow = String(rowData[COLS.TODO.WORKFLOW - 1] || '');
  var objType = String(rowData[COLS.TODO.OBJ_TYPE - 1] || '');
  var objId = String(rowData[COLS.TODO.OBJ_ID - 1] || '');
  var dueDate = rowData[COLS.TODO.DUE_DATE - 1];
  var isParent = hasSubtasks(todoId);

  // Mechanical health flags are recomputed every hygiene pass. Sticky
  // manual/review flags ([blocked], [flags], [review]) are intentionally
  // not cleared here.
  if (timeEst === 'Multi-day' && daysSinceEdit !== null && daysSinceEdit >= MULTIDAY_NEEDS_BREAKDOWN_DAYS && !isParent) {
    appendNoteFlag(sheet, row, COLS.TODO.NOTES, '[needs breakdown] \u26a0 Multi-day \u2014 break this down into sub-tasks');
  } else {
    clearNoteFlag(sheet, row, COLS.TODO.NOTES, '[needs breakdown]');
  }
  if (!timeEst) appendNoteFlag(sheet, row, COLS.TODO.NOTES, '[no-estimate] \u26a0 Missing time estimate');
  else clearNoteFlag(sheet, row, COLS.TODO.NOTES, '[no-estimate]');

  if (workflow !== 'Admin' && (objType === 'None' || !objType)) appendNoteFlag(sheet, row, COLS.TODO.NOTES, '[no-link] \u26a0 Missing linked object for ' + workflow);
  else clearNoteFlag(sheet, row, COLS.TODO.NOTES, '[no-link]');

  if (DATE_CONDITIONAL_WORKFLOWS.indexOf(workflow) !== -1 && resolveDaysToLinkedDate(workflow, objId, objType, dueDate) === null) {
    appendNoteFlag(sheet, row, COLS.TODO.NOTES, '[no-date] \u26a0 No due date for a date-sensitive workflow');
  } else {
    clearNoteFlag(sheet, row, COLS.TODO.NOTES, '[no-date]');
  }

  if (isParent) appendNoteFlag(sheet, row, COLS.TODO.NOTES, '[parent-still-open] \u26a0 Already broken down into sub-tasks \u2014 should be Skipped');
  else clearNoteFlag(sheet, row, COLS.TODO.NOTES, '[parent-still-open]');
}

function runQueueHygiene() {
  var sheet = getSheet('Tasks');
  if (!sheet || sheet.getLastRow() < 2) return;
  var todayDate = today();
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, COLS.TODO.CLASS_CALC_AT).getValues();
  for (var i = 0; i < data.length; i++) {
    var r = i + 2, row = data[i];
    var status = String(row[COLS.TODO.STATUS - 1]);
    var commitClass = String(row[COLS.TODO.COMMITMENT_CLASS - 1]);
    var source = String(row[COLS.TODO.SOURCE - 1]);
    var ref = row[COLS.TODO.LAST_EDITED - 1] || row[COLS.TODO.CREATED - 1];
    if (status === 'Done' || status === 'Skipped' || status === 'Cancelled') continue;
    var daysSinceEdit = ref ? daysBetween(new Date(ref), todayDate) : null;

    if ((commitClass === 'Fixed' || commitClass === 'Blocking') && status === 'Not started' && daysSinceEdit !== null && daysSinceEdit > 3) {
      appendNoteFlag(sheet, r, COLS.TODO.NOTES, '[flags] \u26a0 HOT — needs attention');
    }
    if (commitClass === 'Keep-alive' && status === 'Not started' && daysSinceEdit !== null && daysSinceEdit >= 3) {
      sheet.getRange(r, COLS.TODO.COMMITMENT_CLASS).setValue('Blocking');
      appendNoteFlag(sheet, r, COLS.TODO.NOTES, '[upgraded] Keep-alive → Blocking after 3 days');
    }
    if (commitClass === 'Active pursuit' && daysSinceEdit !== null && daysSinceEdit >= 10) {
      appendNoteFlag(sheet, r, COLS.TODO.NOTES, '[review] \u26a0 Stale — confirm or park');
    }
    if (commitClass === 'Pipeline-building' && daysSinceEdit !== null && daysSinceEdit >= 21) {
      if (source === 'Auto-triggered' || source === 'Onboarding' || source === 'Decision') {
        sheet.getRange(r, COLS.TODO.STATUS).setValue('Skipped');
        sheet.getRange(r, COLS.TODO.COMMITMENT_CLASS).setValue('Backlog');
        appendNoteFlag(sheet, r, COLS.TODO.NOTES, '[auto-skipped ' + formatDateHuman(todayDate) + ']');
      } else {
        appendNoteFlag(sheet, r, COLS.TODO.NOTES, '[review] \u26a0 Stale');
      }
    }
    syncTaskHealthFlags(sheet, r, row, daysSinceEdit);
  }
}

// =============================================================
// TASK CREATION & DEDUP
// =============================================================

// v7.6 §7.3: fuzzy text match (same similarity() + 0.85 threshold already
// used for Org/Person/Job dedup elsewhere) instead of exact-text — this
// is the only defense ad-hoc/manual task creation has (no object or
// workflow to key on by design), and exact-text was brittle to minor
// rewording. appendTodoOnceForWorkflow's (objType, objId, workflow) key
// is unrelated and unchanged.
// v7.6.2: linked/cascade tasks dedupe by object/workflow/open status plus
// exact task text. Fuzzy matching is reserved for unlinked manual/Admin
// rows where there is no object/workflow identity to trust.
function isTodoDuplicate(sheet, task, objId, statusToCreate, workflow) {
  if (!task) return false;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;
  if (statusToCreate !== 'Not started' && statusToCreate !== 'In progress') return false;
  var linked = !!objId || (workflow && workflow !== 'Admin');
  var data = sheet.getRange(2, 1, lastRow - 1, COLS.TODO.STATUS).getValues();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][COLS.TODO.OBJ_ID - 1]) !== String(objId || '')) continue;
    if (workflow && String(data[i][COLS.TODO.WORKFLOW - 1]) !== String(workflow)) continue;
    var st = String(data[i][COLS.TODO.STATUS - 1]);
    if (st !== 'Not started' && st !== 'In progress') continue;
    var existingTask = String(data[i][COLS.TODO.TASK - 1]);
    if (linked) {
      if (existingTask === String(task)) return true;
    } else if (similarity(existingTask, String(task)) >= 0.85) {
      return true;
    }
  }
  return false;
}

function openTodoExistsForTargetWorkflow(objType, objId, workflow) {
  var sheet = getSheet('Tasks');
  if (!sheet || sheet.getLastRow() < 2 || !objId) return false;
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS['To-do'].length).getValues();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][COLS.TODO.OBJ_TYPE - 1]) !== String(objType)) continue;
    if (String(data[i][COLS.TODO.OBJ_ID - 1]) !== String(objId)) continue;
    if (String(data[i][COLS.TODO.WORKFLOW - 1]) !== String(workflow)) continue;
    var st = String(data[i][COLS.TODO.STATUS - 1]);
    if (st === 'Not started' || st === 'In progress') return true;
  }
  return false;
}

// Kept in step with isTodoDuplicate's fuzzy match (same threshold + now
// the same workflow requirement) — this finds the specific task that
// caused appendTodoWithSource's dedup rejection, so acceptPendingDecision
// can still link a Decision to it. An exact-only match here would miss
// anything isTodoDuplicate itself would have flagged, reintroducing the
// "accepted but unlinked" gap. Without the workflow check, a busy Job/Org
// with several open tasks against it could link the Decision to the
// wrong one — see v7.6.1.
function findOpenTodoByTaskTarget(task, objId, workflow) {
  var sheet = getSheet('Tasks');
  if (!sheet || sheet.getLastRow() < 2 || !task) return '';
  var linked = !!objId || (workflow && workflow !== 'Admin');
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS['To-do'].length).getValues();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][COLS.TODO.OBJ_ID - 1]) !== String(objId || '')) continue;
    if (workflow && String(data[i][COLS.TODO.WORKFLOW - 1]) !== String(workflow)) continue;
    var st = String(data[i][COLS.TODO.STATUS - 1]);
    if (st !== 'Not started' && st !== 'In progress') continue;
    var existingTask = String(data[i][COLS.TODO.TASK - 1]);
    if ((linked && existingTask === String(task)) || (!linked && similarity(existingTask, String(task)) >= 0.85)) {
      return String(data[i][COLS.TODO.ID - 1] || '');
    }
  }
  return '';
}

function appendTodo(task, objType, objId, org, workflow, status, dueDate, timeEst, notes) {
  return appendTodoWithSource(task, objType, objId, org, workflow, status, dueDate, timeEst, notes, 'Auto-triggered');
}

// v7.6.1: opts.skipDuplicateCheck lets a caller bypass the dedup check
// entirely — needed by completeBreakdownFromPopup, where every sub-task
// under one Multi-day parent shares the same objType/objId/workflow by
// design, so duplicate-prevention doesn't apply (the whole point is
// intentionally creating several distinct rows in one action); without
// this, two genuinely different sub-tasks with merely similar wording
// could get silently dropped.
function appendTodoWithSource(task, objType, objId, org, workflow, status, dueDate, timeEst, notes, source, opts) {
  opts = opts || {};
  var sheet = getSheet('Tasks');
  if (!sheet || !task) return '';
  if (!opts.skipDuplicateCheck && isTodoDuplicate(sheet, task, objId || '', status || 'Not started', workflow)) return '';
  var id = nextId(sheet, COLS.TODO.ID, 'TODO');
  var row = new Array(HEADERS['To-do'].length).fill('');
  row[COLS.TODO.ID - 1] = id;
  row[COLS.TODO.TASK - 1] = task;
  row[COLS.TODO.OBJ_TYPE - 1] = objType || 'None';
  row[COLS.TODO.OBJ_ID - 1] = objId || '';
  row[COLS.TODO.ORG - 1] = org || '';
  row[COLS.TODO.WORKFLOW - 1] = workflow || 'Admin';
  row[COLS.TODO.STATUS - 1] = status || 'Not started';
  row[COLS.TODO.DUE_DATE - 1] = dueDate || '';
  row[COLS.TODO.TIME_EST - 1] = timeEst || defaultTimeForWorkflow(workflow || 'Admin');
  row[COLS.TODO.NOTES - 1] = notes || '';
  row[COLS.TODO.CREATED - 1] = today();
  row[COLS.TODO.COMMITMENT_CLASS - 1] = assignCommitmentClass(workflow || 'Admin', dueDate || '', objId || '', objType || 'None');
  row[COLS.TODO.SOURCE - 1] = source || 'Auto-triggered';
  row[COLS.TODO.LAST_EDITED - 1] = today();
  row[COLS.TODO.CLASS_CALC_AT - 1] = today();
  row[COLS.TODO.EFFORT_TYPE - 1] = deriveEffortType(workflow || 'Admin');
  sheet.appendRow(row);
  applyTaskHelperColumns(sheet, sheet.getLastRow());
  return id;
}

// =============================================================
// TASKS HELPER COLUMNS (v7.6) — Priority rank, Linked to, On Today
// right now, Has sub-tasks. Priority rank / On Today / Has sub-tasks are
// live spreadsheet formulas (self-maintaining — they can never drift
// from Commitment class / Today's contents / Parent To-do ID, no
// refresh call needed). Linked to is script-written since it needs a
// cross-sheet name lookup + HYPERLINK, so it's refreshed on task
// creation and again by backfillTaskHelperColumns() (wired into
// repairAllTabs/dailyMaintenance) to catch a renamed source object.
// =============================================================

function priorityRankFormula(row) {
  return '=SWITCH($N' + row + ',"Fixed",1,"Blocking",2,"Keep-alive",3,"Active pursuit",4,"Pipeline-building",5,"Backlog",6,99)';
}

function onTodayFormula(row) {
  return '=IF(COUNTIF(Today!$C$' + TODAY_TABLE_FIRST_ROW + ':$C$' + TODAY_TABLE_LAST_ROW + ',$A' + row + ')>0,"Yes","No")';
}

function hasSubtasksFormula(row) {
  return '=IF(COUNTIF($K$2:$K,$A' + row + ')>0,"Yes","No")';
}

// objType/objId -> source-tab display name + row, for the "Linked to"
// HYPERLINK. Sector IDs may be SEC-* sector-only branches or SUB-* sub-
// sector branches; legacy raw-name links are repaired by repairSectorTaskLinks.
var LINKED_TO_MAP = {
  'Job': { sheet: 'Jobs', idCol: 1, nameCol: 2 },
  'Person': { sheet: 'People', idCol: 1, nameCol: 2 },
  'Organisation': { sheet: 'Organisations', idCol: 1, nameCol: 2 },
  'Interview round': { sheet: 'Interviews', idCol: 1, nameCol: 3 },
  'Sector': { sheet: 'Sectors', idCol: 1, nameCol: 3 }
};

function resolveLinkedTo(objType, objId) {
  if (!objId || !objType || objType === 'None') return { text: '', sheetName: '', row: 0 };
  var spec = LINKED_TO_MAP[objType];
  if (!spec) return { text: '', sheetName: '', row: 0 };
  var sheet = getSheet(spec.sheet);
  if (sheet && sheet.getLastRow() > 1) {
    var ids = sheet.getRange(2, spec.idCol, sheet.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === String(objId)) {
        var row = i + 2;
        var name = String(sheet.getRange(row, spec.nameCol).getValue() || '');
        if (objType === 'Sector' && String(objId).indexOf('SEC-') === 0) name = String(sheet.getRange(row, COLS.SECTORS.SECTOR).getValue() || '');
        return { text: name || spec.sheet, sheetName: spec.sheet, row: row };
      }
    }
  }
  if (objType === 'Sector') return { text: String(objId), sheetName: '', row: 0 }; // sector-only stage — no row to link to
  return { text: '', sheetName: '', row: 0 };
}

function writeLinkedTo(sheet, row, objType, objId) {
  var cell = sheet.getRange(row, COLS.TODO.LINKED_TO);
  var linked = resolveLinkedTo(objType, objId);
  if (!linked.text) { cell.setValue(''); return; }
  if (!linked.row) { cell.setValue(linked.text); return; }
  var targetSheet = getSheet(linked.sheetName);
  if (!targetSheet) { cell.setValue(linked.text); return; }
  cell.setFormula('=HYPERLINK("#gid=' + targetSheet.getSheetId() + '&range=A' + linked.row + '","' + linked.text.replace(/"/g, '""') + '")');
}

function applyTaskHelperColumns(sheet, row) {
  if (!sheet.getRange(row, COLS.TODO.ID).getValue()) return;
  sheet.getRange(row, COLS.TODO.PRIORITY_RANK).setFormula(priorityRankFormula(row));
  sheet.getRange(row, COLS.TODO.ON_TODAY).setFormula(onTodayFormula(row));
  sheet.getRange(row, COLS.TODO.HAS_SUBTASKS).setFormula(hasSubtasksFormula(row));
  writeLinkedTo(sheet, row,
    String(sheet.getRange(row, COLS.TODO.OBJ_TYPE).getValue() || ''),
    String(sheet.getRange(row, COLS.TODO.OBJ_ID).getValue() || ''));
}

// Recomputes all four helper columns for every existing Tasks row —
// needed for rows created before this deploy (no formulas yet) and to
// catch a renamed linked object (Linked to is the only one of the four
// that isn't a self-maintaining formula). Wired into repairAllTabs and
// dailyMaintenance.
function backfillTaskHelperColumns() {
  var sheet = getSheet('Tasks');
  if (!sheet || sheet.getLastRow() < 2) return;
  for (var r = 2; r <= sheet.getLastRow(); r++) {
    applyTaskHelperColumns(sheet, r);
  }
}

// v7.6 §2.7/§2.8: one native basic filter (Apps Script can only manage a
// single per-sheet basic filter, not multiple named Filter Views — this
// is the honest substitute for "grouped views", not a lesser version of
// one) and a frozen header row. Idempotent — checks before creating.
function setupTasksTabExtras() {
  var sheet = getSheet('Tasks');
  if (!sheet) return;
  sheet.setFrozenRows(1);
  if (!sheet.getFilter()) {
    var lastRow = Math.max(sheet.getMaxRows(), 2);
    var lastCol = HEADERS['To-do'].length;
    sheet.getRange(1, 1, lastRow, lastCol).createFilter();
  }
}

// Creates a Task for (objType, objId, workflow) only if one isn't
// already open — used by cascades that must never duplicate their
// follow-up task if the triggering event somehow fires twice.
function appendTodoOnceForWorkflow(task, objType, objId, org, workflow, status, dueDate, timeEst, notes, source) {
  if (openTodoExistsForTargetWorkflow(objType, objId, workflow)) return '';
  return appendTodoWithSource(task, objType, objId, org, workflow, status || 'Not started', dueDate || '', timeEst || defaultTimeForWorkflow(workflow), notes || '', source || 'Auto-triggered');
}

// Cancels/skips every open Task linked to a target — used when the
// underlying object moves to a terminal state (Closed, Archived, etc.)
// so stale tasks don't linger. workflowAllowList, if given, restricts
// which workflows get touched.
function setOpenTodosForTarget(objType, objId, status, reason, workflowAllowList) {
  var sheet = getSheet('Tasks');
  if (!sheet || sheet.getLastRow() < 2 || !objId) return 0;
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS['To-do'].length).getValues();
  var count = 0;
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][COLS.TODO.OBJ_TYPE - 1]) !== String(objType)) continue;
    if (String(data[i][COLS.TODO.OBJ_ID - 1]) !== String(objId)) continue;
    if (workflowAllowList && workflowAllowList.indexOf(String(data[i][COLS.TODO.WORKFLOW - 1])) === -1) continue;
    var st = String(data[i][COLS.TODO.STATUS - 1]);
    if (st !== 'Not started' && st !== 'In progress') continue;
    var r = i + 2;
    sheet.getRange(r, COLS.TODO.STATUS).setValue(status);
    sheet.getRange(r, COLS.TODO.COMPLETED).setValue(today());
    appendNoteFlag(sheet, r, COLS.TODO.NOTES, '[' + String(status).toLowerCase() + '] ' + (reason || 'Underlying state changed'));
    count++;
  }
  return count;
}

// =============================================================
// CANONICAL TASK COMPLETION ENGINE
// Every completion — from Today or from Tasks — routes through here.
// =============================================================

function canonicalTodoStatus(status) {
  var v = String(status || '').trim();
  return v === 'Planned' ? 'Not started' : v;
}

function isTerminalTodoStatus(status) {
  return ['Done', 'Skipped', 'Cancelled'].indexOf(String(status || '')) !== -1;
}

function getTodoById(todoId) {
  var sheet = getSheet('Tasks');
  if (!sheet || sheet.getLastRow() < 2 || !todoId) return null;
  var ids = sheet.getRange(2, COLS.TODO.ID, sheet.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(todoId)) return getTodoByRow(sheet, i + 2);
  }
  return null;
}

function getTodoByRow(sheet, row) {
  return {
    sheet: sheet, row: row,
    id: String(sheet.getRange(row, COLS.TODO.ID).getValue() || ''),
    task: String(sheet.getRange(row, COLS.TODO.TASK).getValue() || ''),
    objType: String(sheet.getRange(row, COLS.TODO.OBJ_TYPE).getValue() || 'None'),
    objId: String(sheet.getRange(row, COLS.TODO.OBJ_ID).getValue() || ''),
    org: String(sheet.getRange(row, COLS.TODO.ORG).getValue() || ''),
    workflow: String(sheet.getRange(row, COLS.TODO.WORKFLOW).getValue() || 'Admin'),
    status: String(sheet.getRange(row, COLS.TODO.STATUS).getValue() || ''),
    dueDate: sheet.getRange(row, COLS.TODO.DUE_DATE).getValue(),
    completed: sheet.getRange(row, COLS.TODO.COMPLETED).getValue(),
    notes: String(sheet.getRange(row, COLS.TODO.NOTES).getValue() || '')
  };
}

// Public entry point: complete a Task by ID from anywhere (Today,
// Tasks, or a cascade). Idempotent — completing an already-Done task
// again does not re-fire its downstream cascade.
function completeTodo(todoId, status, options) {
  var todo = getTodoById(todoId);
  if (!todo) return false;
  return completeTodoRow(todo.sheet, todo.row, status, options || {});
}

function completeTodoRow(sheet, row, status, options) {
  options = options || {};
  var target = canonicalTodoStatus(status);
  if (target === 'Deferred') return true; // handled by Today directly (due-date push), not a terminal state
  if (DROPDOWNS.TODO_STATUS.indexOf(target) === -1) return false;
  var before = getTodoByRow(sheet, row);
  var alreadyTerminal = isTerminalTodoStatus(before.status) && !!before.completed;

  sheet.getRange(row, COLS.TODO.STATUS).setValue(target);
  sheet.getRange(row, COLS.TODO.LAST_EDITED).setValue(today());

  if (target === 'Not started' || target === 'In progress') {
    sheet.getRange(row, COLS.TODO.COMPLETED).setValue('');
    syncTodayRowForTodo(row, target);
    return true;
  }

  if (isTerminalTodoStatus(target)) {
    if (!sheet.getRange(row, COLS.TODO.COMPLETED).getValue()) sheet.getRange(row, COLS.TODO.COMPLETED).setValue(today());
    if (target === 'Done' && !alreadyTerminal) routeTodoCompletion(getTodoByRow(sheet, row), options);
    // v7.6.1: a Multi-day parent retired via completeBreakdownFromPopup
    // (source: 'breakdown') is a structural rollup, not abandoned work —
    // the skip cascade would otherwise flag the linked source object
    // (e.g. "Prep/submit skipped — Park or Close?") as if it were.
    if (target === 'Skipped' && !alreadyTerminal && options.source !== 'breakdown') handleSkipCascade(sheet, row);
    if (target === 'Cancelled' && !alreadyTerminal) handleCancelCascade(sheet, row);
    syncTodayRowForTodo(row, target);
    if (EDIT_BATCH_CONTEXT && EDIT_BATCH_CONTEXT.deferTaskRefresh) {
      EDIT_BATCH_CONTEXT.needsDecisionRender = true;
      EDIT_BATCH_CONTEXT.needsHomeRefresh = true;
    } else {
      renderTodayDecisionCards();
      refreshHome();
    }
    return true;
  }
  return true;
}

// Dispatches a completed Task to the handler for its linked object
// type. This is the ONLY place that decides what happens next after a
// Task is marked Done — Today and Tasks both call completeTodo, which
// always ends up here.
function routeTodoCompletion(todo, options) {
  if (!todo) return;
  if (todo.objType === 'Job') return handleJobTodoCompletion(todo, options || {});
  if (todo.objType === 'Person') return handlePersonTodoCompletion(todo, options || {});
  if (todo.objType === 'Interview round') return handleInterviewTodoCompletion(todo, options || {});
  if (todo.objType === 'Organisation') return handleOrganisationTodoCompletion(todo, options || {});
  if (todo.objType === 'Sector') return handleSectorTodoCompletion(todo, options || {});
}

function handleJobTodoCompletion(todo, options) {
  var job = getJobRowById(todo.objId);
  if (!job) return;
  if (todo.workflow === 'Application preparation') {
    appendTodoOnceForWorkflow('Submit application: ' + job.title + ' at ' + job.org, 'Job', todo.objId, job.org, 'Submit application', 'Not started', job.deadline, '15 min', 'Application prep completed.', 'Auto-triggered');
  } else if (todo.workflow === 'Submit application') {
    setJobStatus(todo.objId, 'Applied', { source: 'todo-completion', realDate: today() });
  } else if (todo.workflow === 'Check application response' || todo.workflow === 'Interview follow-up') {
    createJobResponseOutcomeDecision(todo.objId, 'Response check completed: ' + job.title);
  } else if (todo.workflow === 'Referral search') {
    appendPendingDecision('REFERRAL_SEARCH_DONE:' + todo.id, 'Referral search completed: ' + job.title,
      'Add/update people found at ' + job.org, 'Organisation', job.orgId, 'People sourcing', todo.notes || '');
  } else if (todo.workflow === 'Offer decision') {
    appendPendingDecision('OFFER_DECISION_DONE:' + todo.id, 'Offer decision needs an outcome: ' + job.title,
      'Record offer decision for ' + job.title + ' at ' + job.org, 'Job', todo.objId, 'Admin', '');
  }
}

function handlePersonTodoCompletion(todo, options) {
  var person = getPersonRowById(todo.objId);
  if (!person) return;
  if (todo.workflow === 'Outreach') {
    appendTodoOnceForWorkflow('Send outreach to ' + person.name + (person.org ? ' at ' + person.org : ''), 'Person', todo.objId, person.org, 'Send outreach', 'Not started', '', '15 min', 'Draft prepared.', 'Auto-triggered');
  } else if (todo.workflow === 'Send outreach') {
    movePersonStage(todo.objId, 'Outreach sent', { source: 'todo-completion', realDate: today() });
  } else if (todo.workflow === 'Contact follow-up') {
    setPersonFollowUpSent(todo.objId);
    appendInteraction(todo.objId, person.name, person.org, today(), 'Auto-log', 'Follow-up sent', 'System log');
  } else if (todo.workflow === 'Reply and arrange conversation') {
    appendPendingDecision('PERSON_REPLY_OUTCOME:' + todo.id, 'Reply handled: ' + person.name,
      'Record conversation outcome / next step for ' + person.name, 'Person', todo.objId, 'Admin',
      'Choose: scheduled / next action / nurture / closed.');
  } else if (todo.workflow === 'Conversation prep') {
    appendInteraction(todo.objId, person.name, person.org, today(), 'Auto-log', 'Conversation prep completed', 'System log');
  } else if (todo.workflow === 'Thank-you and debrief' || todo.workflow === 'Conversation debrief') {
    movePersonStage(todo.objId, 'Conversation completed', { source: 'todo-completion', realDate: today() });
  }
}

function handleInterviewTodoCompletion(todo, options) {
  var round = getRoundById(todo.objId);
  if (!round) return;
  var sheet = getSheet('Interviews');
  if (todo.workflow === 'Interview scheduling') {
    appendNoteFlag(sheet, round.row, COLS.ROUNDS.NOTES, '[schedule-action] Scheduling task completed on ' + formatDateHuman(today()) + '. Add Interview date if it is now known.');
  } else if (/Interview prep|Day-before review/.test(todo.workflow)) {
    appendNoteFlag(sheet, round.row, COLS.ROUNDS.NOTES, '[prep-completed] ' + todo.workflow + ' on ' + formatDateHuman(today()));
  } else if (todo.workflow === 'Interview follow-up') {
    appendInteraction('', '', round.org, today(), 'Auto-log', 'Interview follow-up sent: ' + round.job, 'System log');
    sheet.getRange(round.row, COLS.ROUNDS.EXPECTED_RESPONSE).setValue(addDays(today(), 7));
  } else if (todo.workflow === 'Thank-you and debrief') {
    ensureInterviewDebriefTemplate(sheet, round.row);
    appendInteraction('', '', round.org, today(), 'Auto-log', 'Interview thank-you/debrief completed: round ' + round.round + ' - ' + round.job, 'System log');
    appendPendingDecision('INTERVIEW_OUTCOME:' + round.id, 'Interview debrief completed: ' + round.job,
      'Record official outcome for round ' + round.round + ' - ' + round.job, 'Interview round', round.id,
      'Interview follow-up', 'Choose: waiting / next round / rejected / offer / parked.');
  } else {
    sheet.getRange(round.row, COLS.ROUNDS.STATUS).setValue('Completed');
    if (!sheet.getRange(round.row, COLS.ROUNDS.OFFICIAL_OUTCOME).getValue()) sheet.getRange(round.row, COLS.ROUNDS.OFFICIAL_OUTCOME).setValue('Waiting');
    createInterviewDebriefTask(round.id);
    appendInteraction('', '', round.org, today(), 'Auto-log', 'Interview completed: round ' + round.round + ' - ' + round.job, 'System log');
    appendPendingDecision('INTERVIEW_OUTCOME:' + round.id, 'Interview completed: ' + round.job,
      'Record interview outcome for round ' + round.round + ' - ' + round.job, 'Interview round', round.id,
      'Interview follow-up', 'Choose: waiting / next round / rejected / offer / parked.');
  }
}

function handleOrganisationTodoCompletion(todo, options) {
  var org = getOrgById(todo.objId);
  if (!org) return;
  var sheet = getSheet('Organisations');
  sheet.getRange(org.row, COLS.ORGS.LAST_CHECKED).setValue(today());
  if (todo.workflow === 'People sourcing' || todo.workflow === 'Referral search') {
    appendPendingDecision('ORG_PEOPLE_FOUND:' + todo.id, 'People sourcing completed: ' + org.name,
      'Add/update people found at ' + org.name, 'Organisation', todo.objId, 'People sourcing', todo.notes || '');
  } else if (todo.workflow === 'Org job scan' || todo.workflow === 'Job board scan') {
    appendPendingDecision('ORG_JOBS_FOUND:' + todo.id, 'Job scan completed: ' + org.name,
      'Add/update jobs found at ' + org.name, 'Organisation', todo.objId, 'Org job scan', todo.notes || '');
  } else if (todo.workflow === 'Org research') {
    appendPendingDecision('ORG_RESEARCH_DONE:' + todo.id, 'Organisation research completed: ' + org.name,
      'Update notes/tier/status for ' + org.name, 'Organisation', todo.objId, 'Org research', todo.notes || '');
  }
}

// Sector completion — see the agreed 3-stage model in fireSubsectorAddedDecision:
//   Sector-only Task done      -> nothing further here (the Sub-sector edit
//                                  itself is what triggers stage 2).
//   Market-mapping Task done   -> prompt to capture the organisations found.
function handleSectorTodoCompletion(todo, options) {
  if (todo.workflow === 'Market mapping') {
    appendPendingDecision('MARKET_MAP_DONE:' + todo.id, 'Market mapping completed',
      'Add/update organisations found from market map', 'Sector', todo.objId, 'Market mapping', todo.notes || '');
  }
}

// =============================================================
// SKIP CASCADE — flags the linked object when a Task is Skipped rather
// than completed, so the "why didn't this happen" question surfaces.
// =============================================================

function handleSkipCascade(todoSheet, row) {
  var workflow = String(todoSheet.getRange(row, COLS.TODO.WORKFLOW).getValue());
  var objType = String(todoSheet.getRange(row, COLS.TODO.OBJ_TYPE).getValue());
  var objId = String(todoSheet.getRange(row, COLS.TODO.OBJ_ID).getValue());
  switch (workflow) {
    case 'Org research':
      var org = getSheet('Organisations');
      if (org) flagLinkedRow(org, COLS.ORGS.ID, objId, COLS.ORGS.NOTES, '\u26a0 Research skipped — decide activation');
      break;
    case 'Application preparation':
    case 'Submit application':
      var jobs = getSheet('Jobs');
      if (jobs) flagLinkedRow(jobs, COLS.JOBS.ID, objId, COLS.JOBS.NOTES, '\u26a0 Prep/submit skipped — Park or Close?');
      break;
    case 'Outreach':
    case 'Send outreach':
      var people = getSheet('People');
      if (people) flagLinkedRow(people, COLS.PEOPLE.ID, objId, COLS.PEOPLE.NOTES, '\u26a0 Outreach skipped — Identified or Closed?');
      break;
    case 'Interview scheduling':
      var rounds = getSheet('Interviews');
      if (rounds) flagLinkedRow(rounds, COLS.ROUNDS.ID, objId, COLS.ROUNDS.NOTES, '\u26a0 Scheduling skipped — cancel round?');
      break;
  }
}

// v7.4 §3.2: a manual single-row Cancel is the identical trigger
// condition as manual Skip (system-driven bulk cancellation, e.g.
// setOpenTodosForTarget when a Job closes, never goes through
// completeTodoRow at all) — so it deserves the same cascade, unless the
// linked source object is already terminal and would make the flag
// redundant noise.
function isSourceObjectTerminal(objType, objId) {
  if (objType === 'Job') { var j = getJobRowById(objId); return j && ['Closed', 'Parked'].indexOf(String(j.status)) !== -1; }
  if (objType === 'Organisation') { var o = getOrgById(objId); return o && ['Archived', 'Dormant'].indexOf(String(o.status)) !== -1; }
  if (objType === 'Person') { var p = getPersonRowById(objId); return p && String(p.stage) === 'Closed'; }
  return false;
}

function handleCancelCascade(todoSheet, row) {
  var objType = String(todoSheet.getRange(row, COLS.TODO.OBJ_TYPE).getValue());
  var objId = String(todoSheet.getRange(row, COLS.TODO.OBJ_ID).getValue());
  if (!objId || isSourceObjectTerminal(objType, objId)) return; // parent already answers this — don't add noise
  switch (String(todoSheet.getRange(row, COLS.TODO.WORKFLOW).getValue())) {
    case 'Org research':
      var org = getSheet('Organisations'); if (org) flagLinkedRow(org, COLS.ORGS.ID, objId, COLS.ORGS.NOTES, '⚠ Task cancelled — decide activation'); break;
    case 'Application preparation': case 'Submit application':
      var jobs = getSheet('Jobs'); if (jobs) flagLinkedRow(jobs, COLS.JOBS.ID, objId, COLS.JOBS.NOTES, '⚠ Task cancelled — Park or Close?'); break;
    case 'Outreach': case 'Send outreach':
      var people = getSheet('People'); if (people) flagLinkedRow(people, COLS.PEOPLE.ID, objId, COLS.PEOPLE.NOTES, '⚠ Task cancelled — Identified or Closed?'); break;
    case 'Interview scheduling':
      var rounds = getSheet('Interviews'); if (rounds) flagLinkedRow(rounds, COLS.ROUNDS.ID, objId, COLS.ROUNDS.NOTES, '⚠ Task cancelled — cancel round?'); break;
  }
}

function flagLinkedRow(sheet, idCol, objId, notesCol, flag) {
  if (!objId || sheet.getLastRow() < 2) return;
  var ids = sheet.getRange(2, idCol, sheet.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(objId)) { appendNoteFlag(sheet, i + 2, notesCol, flag); return; }
  }
}

// =============================================================
// JOBS — status routing
// Statuses: Want to apply / Applied / Interviewing / Offer / Parked / Closed
// =============================================================

function setJobStatus(jobId, status, opts) {
  opts = opts || { source: 'cascade' };
  var sheet = getSheet('Jobs');
  if (!sheet || sheet.getLastRow() < 2) return;
  var normalized = normalizeJobStatus(status);
  var ids = sheet.getRange(2, COLS.JOBS.ID, sheet.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(jobId)) {
      var row = i + 2;
      var old = sheet.getRange(row, COLS.JOBS.STATUS).getValue();
      if (normalizeJobStatus(old) === normalized) return;
      sheet.getRange(row, COLS.JOBS.STATUS).setValue(normalized);
      fireJobStatusChanged(jobId, old, normalized, opts);
      return;
    }
  }
}

function getJobStatusById(jobId) { var j = getJobRowById(jobId); return j ? String(j.status) : ''; }
function getJobInfo(jobId) { var j = getJobRowById(jobId); return j ? { title: j.title, org: j.org, deadline: j.deadline } : null; }

// The single place Job status transitions are handled — called from
// onEditJobs (manual edit), setJobStatus (programmatic), and onboarding
// capture. Never called twice for the same transition.
function createJobResponseOutcomeDecision(jobId, reason) {
  var job = getJobRowById(jobId);
  if (!job) return '';
  var status = normalizeJobStatus(job.status);
  if (['Applied', 'Interviewing', 'Offer'].indexOf(status) === -1) return '';
  return appendPendingDecision('JOB_RESPONSE_OUTCOME:' + jobId, reason || 'Job response received: ' + job.title,
    'Record response outcome for ' + job.title + ' at ' + job.org, 'Job', jobId, 'Admin',
    'Choose the real outcome on Jobs: no response yet / interview / rejected / offer / parked.');
}

function fireJobStatusChanged(jobId, oldStatus, newStatus, opts) {
  opts = opts || {};
  var job = getJobRowById(jobId);
  if (!job) return;
  newStatus = normalizeJobStatus(newStatus);
  var sheet = getSheet('Jobs');

  if (newStatus === 'Want to apply') {
    appendTodoOnceForWorkflow('Prep application: ' + job.title + ' at ' + job.org, 'Job', jobId, job.org, 'Application preparation',
      'Not started', job.deadline, '60 min', job.deadline ? 'Deadline: ' + formatDateHuman(job.deadline) : '', 'Auto-triggered');
    // Finding people is a suggestion, not automatic — per spec, ask.
    appendPendingDecision('JOB_WANT:' + jobId + ':Referral search', 'Job saved: ' + job.title + ' at ' + job.org,
      'Find people at: ' + job.org, 'Organisation', job.orgId, 'Referral search',
      'Suggested because people at the organisation may help with this job.');
    return;
  }
  if (newStatus === 'Applied') {
    var applied = opts.realDate ? parseDateOr(opts.realDate) : (job.appliedDate ? parseDateOr(job.appliedDate) : today());
    var review = addDays(applied, 12);
    sheet.getRange(job.row, COLS.JOBS.APPLIED_DATE).setValue(applied);
    sheet.getRange(job.row, COLS.JOBS.REVIEW_DATE).setValue(review);
    sheet.getRange(job.row, COLS.JOBS.RESPONSE).setValue('');
    autoDismissPendingForTarget('Job', jobId, 'Job marked Applied');
    setOpenTodosForTarget('Job', jobId, 'Skipped', 'Job already applied', ['Application preparation', 'Submit application']);
    appendTodoOnceForWorkflow('Check response from ' + job.org + ' for ' + job.title, 'Job', jobId, job.org,
      'Check application response', 'Not started', review, '15 min', 'Applied on ' + formatDateHuman(applied), 'Auto-triggered');
    return;
  }
  if (newStatus === 'Interviewing') {
    autoDismissPendingForTarget('Job', jobId, 'Job is interviewing');
    setOpenTodosForTarget('Job', jobId, 'Skipped', 'Job moved to interview stage', ['Check application response', 'Interview follow-up']);
    if (!jobHasRounds(jobId) || opts.forceRound) createInterviewRoundForJob(jobId, opts);
    showInterviewsTab();
    return;
  }
  if (newStatus === 'Offer') {
    autoDismissPendingForTarget('Job', jobId, 'Offer received');
    setOpenTodosForTarget('Job', jobId, 'Skipped', 'Offer received', ['Check application response', 'Interview follow-up']);
    appendTodoOnceForWorkflow('Decide on offer: ' + job.title + ' at ' + job.org, 'Job', jobId, job.org,
      'Offer decision', 'Not started', opts.realDate || '', '30 min', 'Offer decision/review.', 'Auto-triggered');
    return;
  }
  if (newStatus === 'Parked') {
    autoDismissPendingForTarget('Job', jobId, 'Job parked');
    setOpenTodosForTarget('Job', jobId, 'Skipped', 'Job parked — keep the record, stop active work on it');
    return;
  }
  if (newStatus === 'Closed') {
    autoDismissPendingForTarget('Job', jobId, 'Job closed');
    setOpenTodosForTarget('Job', jobId, 'Cancelled', 'Job closed');
  }
}

function createInterviewRoundForJob(jobId, opts) {
  opts = opts || {};
  var job = getJobRowById(jobId);
  if (!job) return { id: '', row: 0, created: false, roundNum: '' };
  var details = opts.roundDetails || {};
  var sheet = getSheet('Interviews');
  var roundNum = parseInt(details.roundNum || nextRoundNumberForJob(jobId), 10) || nextRoundNumberForJob(jobId);
  var existing = findRoundByJobRound(jobId, roundNum);
  if (existing) return existing;
  var id = nextId(sheet, COLS.ROUNDS.ID, 'RND');
  var roundType = details.roundType || 'Other';
  if (DROPDOWNS.ROUND_TYPE.indexOf(roundType) === -1) roundType = 'Other';
  var date = details.interviewDate || '';
  var domain = details.domainReadiness || '';
  var row = new Array(HEADERS['Interview rounds'].length).fill('');
  row[COLS.ROUNDS.ID - 1] = id;
  row[COLS.ROUNDS.JOB_ID - 1] = jobId;
  row[COLS.ROUNDS.JOB_DISPLAY - 1] = job.title;
  row[COLS.ROUNDS.ORG_DISPLAY - 1] = job.org;
  row[COLS.ROUNDS.ROUND - 1] = roundNum;
  row[COLS.ROUNDS.ROUND_TYPE - 1] = roundType;
  row[COLS.ROUNDS.INTERVIEW_DATE - 1] = date;
  row[COLS.ROUNDS.STATUS - 1] = date ? 'Scheduled' : 'To schedule';
  row[COLS.ROUNDS.DOMAIN_READINESS - 1] = domain;
  if (date) row[COLS.ROUNDS.EXPECTED_RESPONSE - 1] = addDays(new Date(date), REPLY_DAYS_BY_ROUND_TYPE[roundType] || 7);
  row[COLS.ROUNDS.NOTES - 1] = details.notes || '';
  sheet.appendRow(row);
  var newRow = sheet.getLastRow();
  if (!date) {
    appendTodoOnceForWorkflow('Schedule interview: ' + job.title + ' at ' + job.org, 'Interview round', id, job.org, 'Interview scheduling', 'Not started', '', '15 min', 'Set Interview date on the Interviews row when known.', 'Auto-triggered');
  } else {
    scheduleInterviewRound(id, date);
    if (domain) createInterviewPrepTasks(id);
    else appendTodoOnceForWorkflow('Set domain readiness for: ' + job.title + ' at ' + job.org, 'Interview round', id, job.org, 'Interview prep (Domain scoping)', 'Not started', date, '15 min', 'Set Domain readiness on Interviews to unlock prep tasks.', 'Auto-triggered');
  }
  appendInteraction('', '', job.org, today(), 'Auto-log', 'Interview round created: ' + job.title + ' (Round ' + roundNum + ')', 'System log');
  return { id: id, row: newRow, created: true, roundNum: roundNum };
}

// =============================================================
// PEOPLE — stage routing
// Stages: Identified / Outreach sent / Engaged / Conversation scheduled /
//         Conversation completed / Nurture / Closed
// =============================================================

function movePersonStage(personId, stage, opts) {
  opts = opts || { source: 'cascade' };
  var person = getPersonRowById(personId);
  if (!person) return;
  var sheet = getSheet('People');
  var normalized = normalizePersonStage(stage);
  var old = sheet.getRange(person.row, COLS.PEOPLE.STAGE).getValue();
  if (normalizePersonStage(old) === normalized) return;
  sheet.getRange(person.row, COLS.PEOPLE.STAGE).setValue(normalized);
  firePersonStageChanged(personId, old, normalized, opts);
}

function getPersonStage(personId) { var p = getPersonRowById(personId); return p ? String(p.stage) : ''; }

function setPersonFollowUpSent(personId) {
  var person = getPersonRowById(personId);
  if (!person) return;
  var sheet = getSheet('People');
  sheet.getRange(person.row, COLS.PEOPLE.FOLLOW_UP_SENT).setValue('Yes');
  sheet.getRange(person.row, COLS.PEOPLE.FOLLOW_UP_DATE).setValue(addDays(today(), 7));
  var cnt = parseInt(sheet.getRange(person.row, COLS.PEOPLE.FOLLOW_UPS_SENT_COUNT).getValue(), 10) || 0;
  sheet.getRange(person.row, COLS.PEOPLE.FOLLOW_UPS_SENT_COUNT).setValue(cnt + 1);
}

// The single place Person stage transitions are handled.
//
// FIX (confirmed): "Identified" now creates a direct Draft-outreach Task,
// not a Decision. The person answering the onboarding/capture question
// "have you already reached out?" with No has already told us the next
// action unambiguously — there's nothing left to ask.
function firePersonStageChanged(personId, oldStage, newStage, opts) {
  opts = opts || {};
  var person = getPersonRowById(personId);
  if (!person) return;
  var sheet = getSheet('People');
  newStage = normalizePersonStage(newStage);

  if (newStage === 'Identified') {
    appendTodoOnceForWorkflow('Draft outreach to ' + person.name + (person.org ? ' at ' + person.org : ''),
      'Person', personId, person.org, 'Outreach', 'Not started', '', '20 min',
      'When the draft is ready, tick this Task Done — it will create the send-outreach follow-up.', 'Auto-triggered');
    return;
  }
  if (newStage === 'Outreach sent') {
    var outreachDate = opts.realDate ? parseDateOr(opts.realDate) : (sheet.getRange(person.row, COLS.PEOPLE.OUTREACH_DATE).getValue() || today());
    var follow = addDays(outreachDate, 6);
    sheet.getRange(person.row, COLS.PEOPLE.OUTREACH_DATE).setValue(outreachDate);
    sheet.getRange(person.row, COLS.PEOPLE.FOLLOW_UP_DATE).setValue(follow);
    sheet.getRange(person.row, COLS.PEOPLE.REPLY_RECEIVED).setValue('');
    sheet.getRange(person.row, COLS.PEOPLE.FOLLOW_UP_SENT).setValue('No');
    appendInteraction(personId, person.name, person.org, outreachDate, 'Auto-log', 'Outreach sent', 'System log');
    if (follow <= today()) appendTodoOnceForWorkflow('Follow up with ' + person.name + (person.org ? ' at ' + person.org : ''), 'Person', personId, person.org, 'Contact follow-up', 'Not started', follow, '15 min', 'Outreach follow-up due.', 'Auto-triggered');
    return;
  }
  if (newStage === 'Engaged') {
    appendTodoOnceForWorkflow('Reply and arrange conversation with ' + person.name + (person.org ? ' at ' + person.org : ''), 'Person', personId, person.org, 'Reply and arrange conversation', 'Not started', '', '15 min', '', 'Auto-triggered');
    return;
  }
  if (newStage === 'Conversation scheduled') {
    var convDate = opts.realDate ? parseDateOr(opts.realDate) : sheet.getRange(person.row, COLS.PEOPLE.CONVERSATION_DATE).getValue();
    if (convDate) sheet.getRange(person.row, COLS.PEOPLE.CONVERSATION_DATE).setValue(convDate);
    appendTodoOnceForWorkflow('Prep conversation with ' + person.name + (person.org ? ' at ' + person.org : ''), 'Person', personId, person.org, 'Conversation prep', 'Not started', convDate ? addDays(new Date(convDate), -1) : '', '30 min', conversationPrepNotes(), 'Auto-triggered');
    return;
  }
  if (newStage === 'Conversation completed') {
    var doneDate = opts.realDate ? parseDateOr(opts.realDate) : today();
    sheet.getRange(person.row, COLS.PEOPLE.CONVERSATION_DATE).setValue(doneDate);
    appendInteraction(personId, person.name, person.org, doneDate, 'Auto-log', 'Conversation completed', 'System log');
    appendTodoOnceForWorkflow('Debrief / thank-you for ' + person.name + (person.org ? ' at ' + person.org : ''), 'Person', personId, person.org, 'Thank-you and debrief', 'Not started', '', '20 min', conversationDebriefNotes(), 'Auto-triggered');
    return;
  }
  if (newStage === 'Nurture') {
    sheet.getRange(person.row, COLS.PEOPLE.FOLLOW_UP_DATE).setValue(addDays(today(), 42));
    return;
  }
  if (newStage === 'Closed') {
    autoDismissPendingForTarget('Person', personId, 'Person closed');
    setOpenTodosForTarget('Person', personId, 'Cancelled', 'Person closed');
  }
}

// =============================================================
// ORGANISATIONS & SECTORS — taxonomy + the corrected 3-stage sector model
//
// AGREED MODEL (identical whether triggered by direct sheet edit or by
// an onboarding/capture popup — both paths call the exact same two
// functions below, so there is only one place this logic can drift):
//
//   1. Sector-only row (Sub-sector blank)
//        -> direct Task: "List 2-4 sub-sectors worth exploring"
//   2. Sub-sector row added
//        -> Decision: "Build an organisation list in this sub-sector?"
//   3. Yes on that Decision
//        -> Task: "Market map: <sector> — <sub-sector>"
//   4. No on that Decision
//        -> no market-map Task is created. Nothing further happens.
//
// Organisation creation/classification NEVER auto-floods job-search or
// people-search work — Active only creates two Pending Decisions
// (find people / scan jobs), never direct Tasks. Default Status on
// creation is Mapped, which is fully inert.
// =============================================================

function sectorSourceFlag(source) {
  var map = {
    onboarding: '[created-via-onboarding]',
    home_update: '[created-via-home-update]',
    organisation_link: '[created-via-org-link]',
    manual_sheet_entry: '[created-via-manual-entry]',
    repair_backfill: '[created-via-repair]'
  };
  return map[source] || '';
}

function normalizeSectorStatus(value) {
  return String(value || '') === 'Retired' ? 'Retired' : 'Open';
}

function sectorBranchFromRow(rowNumber, row) {
  return {
    row: rowNumber,
    id: String(row[COLS.SECTORS.ID - 1] || ''),
    sector: String(row[COLS.SECTORS.SECTOR - 1] || ''),
    subsector: String(row[COLS.SECTORS.SUBSECTOR - 1] || ''),
    status: normalizeSectorStatus(row[COLS.SECTORS.STATUS - 1]),
    created: false,
    isSectorOnly: !String(row[COLS.SECTORS.SUBSECTOR - 1] || '')
  };
}

function findSectorBranch(sector, subsector) {
  var sheet = getSheet('Sectors');
  if (!sheet || sheet.getLastRow() < 2 || !sector) return null;
  var wantSector = normalizeKeyPart(sector);
  var wantSub = normalizeKeyPart(subsector);
  var wantSectorOnly = !wantSub;
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS.Sectors.length).getValues();
  var best = null, bestScore = 0;
  for (var i = 0; i < data.length; i++) {
    var rowSector = normalizeKeyPart(data[i][COLS.SECTORS.SECTOR - 1]);
    var rowSub = normalizeKeyPart(data[i][COLS.SECTORS.SUBSECTOR - 1]);
    if (!rowSector) continue;
    if (wantSectorOnly && rowSub) continue;
    if (!wantSectorOnly && !rowSub) continue;
    var sectorScore = rowSector === wantSector ? 1 : similarity(wantSector, rowSector);
    var subScore = wantSectorOnly ? 1 : (rowSub === wantSub ? 1 : similarity(wantSub, rowSub));
    var score = Math.min(sectorScore, subScore);
    if (score > bestScore) {
      bestScore = score;
      best = sectorBranchFromRow(i + 2, data[i]);
    }
  }
  return bestScore >= 0.85 ? best : null;
}

function getSectorBranchById(sectorId) {
  var sheet = getSheet('Sectors');
  if (!sheet || sheet.getLastRow() < 2 || !sectorId) return null;
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS.Sectors.length).getValues();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][COLS.SECTORS.ID - 1]) === String(sectorId)) return sectorBranchFromRow(i + 2, data[i]);
  }
  return null;
}

function ensureSectorBranchId(sheet, branch) {
  if (!sheet || !branch) return branch;
  var expectedPrefix = branch.isSectorOnly ? 'SEC' : 'SUB';
  if (String(branch.id || '').indexOf(expectedPrefix + '-') === 0) return branch;
  var id = nextId(sheet, COLS.SECTORS.ID, expectedPrefix);
  sheet.getRange(branch.row, COLS.SECTORS.ID).setValue(id);
  branch.id = id;
  return branch;
}

function upsertSectorBranch(opts) {
  opts = opts || {};
  var sector = String(opts.sector || '').trim().replace(/\s+/g, ' ');
  var subsector = String(opts.subsector || '').trim().replace(/\s+/g, ' ');
  if (!sector) return null;
  var sheet = getSheet('Sectors');
  if (!sheet) return null;
  var isSectorOnly = !subsector;
  var branch = findSectorBranch(sector, subsector);
  var created = false;
  if (!branch) {
    var id = nextId(sheet, COLS.SECTORS.ID, isSectorOnly ? 'SEC' : 'SUB');
    var rowValues = new Array(HEADERS.Sectors.length).fill('');
    rowValues[COLS.SECTORS.ID - 1] = id;
    rowValues[COLS.SECTORS.SECTOR - 1] = sector;
    rowValues[COLS.SECTORS.SUBSECTOR - 1] = subsector;
    rowValues[COLS.SECTORS.STATUS - 1] = 'Open';
    rowValues[COLS.SECTORS.NOTES - 1] = '';
    if (opts.preferredRow && opts.preferredRow > 1) {
      sheet.getRange(opts.preferredRow, 1, 1, HEADERS.Sectors.length).setValues([rowValues]);
      branch = sectorBranchFromRow(opts.preferredRow, rowValues);
    } else {
      sheet.appendRow(rowValues);
      branch = sectorBranchFromRow(sheet.getLastRow(), rowValues);
    }
    created = true;
  }
  branch = ensureSectorBranchId(sheet, branch);
  if (!sheet.getRange(branch.row, COLS.SECTORS.STATUS).getValue()) sheet.getRange(branch.row, COLS.SECTORS.STATUS).setValue('Open');
  if (!branch.sector) sheet.getRange(branch.row, COLS.SECTORS.SECTOR).setValue(sector);
  if (!branch.isSectorOnly && !branch.subsector) sheet.getRange(branch.row, COLS.SECTORS.SUBSECTOR).setValue(subsector);
  var sourceFlag = sectorSourceFlag(opts.source);
  if (sourceFlag) appendNoteFlag(sheet, branch.row, COLS.SECTORS.NOTES, sourceFlag);
  if (opts.notes) appendNoteFlag(sheet, branch.row, COLS.SECTORS.NOTES, opts.notes);
  branch.created = created;
  branch.isSectorOnly = isSectorOnly;
  if (!isSectorOnly && opts.createExpansionDecision !== false) fireSubsectorAddedDecision(branch.sector || sector, branch.subsector || subsector, branch.id);
  return branch;
}

function applyOrgTaxonomyLink(orgRow, sector, subsector) {
  var sheet = getSheet('Organisations');
  if (!sheet || !orgRow) return null;
  if (sector && !subsector) {
    var sectorOnly = upsertSectorBranch({ sector: sector, source: 'organisation_link', sourceObjectType: 'Organisation', createExpansionDecision: false });
    if (sectorOnly) sheet.getRange(orgRow, COLS.ORGS.SECTOR).setValue(sectorOnly.sector);
    sheet.getRange(orgRow, COLS.ORGS.SUBSECTOR).setValue('');
    // v7.7.1: sector-only branches now carry a real SEC-* id (see
    // upsertSectorBranch) — store it here too so detectSectorOrphans and
    // propagateSectorRenameToOrganisations also cover sector-only links,
    // not just sub-sector links.
    sheet.getRange(orgRow, COLS.ORGS.SUBSECTOR_ID).setValue(sectorOnly ? sectorOnly.id : '');
    return sectorOnly;
  }
  if (!sector && subsector) {
    appendNoteFlag(sheet, orgRow, COLS.ORGS.NOTES, '[taxonomy] Add Sector before Sub-sector can be linked');
    return null;
  }
  if (!sector || !subsector) return null;
  var sub = upsertSectorBranch({ sector: sector, subsector: subsector, source: 'organisation_link', sourceObjectType: 'Organisation', createExpansionDecision: true });
  if (!sub) return null;
  sheet.getRange(orgRow, COLS.ORGS.SECTOR).setValue(sub.sector);
  sheet.getRange(orgRow, COLS.ORGS.SUBSECTOR).setValue(sub.subsector);
  sheet.getRange(orgRow, COLS.ORGS.SUBSECTOR_ID).setValue(sub.id);
  return sub;
}

function repairOrgTaxonomyLinks() {
  var sheet = getSheet('Organisations');
  if (!sheet || sheet.getLastRow() < 2) return;
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS.Organisations.length).getValues();
  for (var i = 0; i < data.length; i++) {
    var row = i + 2;
    var sector = data[i][COLS.ORGS.SECTOR - 1];
    var sub = data[i][COLS.ORGS.SUBSECTOR - 1];
    var subId = data[i][COLS.ORGS.SUBSECTOR_ID - 1];
    if (sector && sub && !subId) applyOrgTaxonomyLink(row, sector, sub);
  }
}

// v7.1: manual sheet entry now defers the job/person cascade until the
// row has an Organisation, instead of firing immediately with blank org
// context. See onEditJobs / onEditPeople below. Organisation creation
// itself is unaffected — an Organisation row never needed a second
// anchor field.
function onEditOrgs(sheet, row, col, newVal, e) {
  if (col === COLS.ORGS.NAME && newVal) {
    checkOrgDuplicate(sheet, row);
    var idCell = sheet.getRange(row, COLS.ORGS.ID);
    if (!idCell.getValue()) idCell.setValue(nextId(sheet, COLS.ORGS.ID, 'ORG'));
    if (!sheet.getRange(row, COLS.ORGS.TIER).getValue()) sheet.getRange(row, COLS.ORGS.TIER).setValue('B');
    // Default is Mapped — never Active — so creation alone never floods
    // the queue. Active is only ever set explicitly.
    if (!sheet.getRange(row, COLS.ORGS.STATUS).getValue()) sheet.getRange(row, COLS.ORGS.STATUS).setValue('Mapped');
    sheet.getRange(row, COLS.ORGS.LAST_CHECKED).setValue(today());
    applyOrgRowFormulas(sheet, row);
    var sector = sheet.getRange(row, COLS.ORGS.SECTOR).getValue();
    var sub = sheet.getRange(row, COLS.ORGS.SUBSECTOR).getValue();
    if (sector || sub) applyOrgTaxonomyLink(row, sector, sub);
    return;
  }
  if (col === COLS.ORGS.SECTOR || col === COLS.ORGS.SUBSECTOR) {
    applyOrgTaxonomyLink(row, sheet.getRange(row, COLS.ORGS.SECTOR).getValue(), sheet.getRange(row, COLS.ORGS.SUBSECTOR).getValue());
    return;
  }
  if (col === COLS.ORGS.TIER) {
    sheet.getRange(row, COLS.ORGS.TIER).setValue(normalizeTier(newVal));
    return;
  }
  if (col === COLS.ORGS.STATUS) {
    var orgId = sheet.getRange(row, COLS.ORGS.ID).getValue();
    var orgName = sheet.getRange(row, COLS.ORGS.NAME).getValue();
    if (String(newVal) === 'Active') fireOrgActiveCascade(orgId, orgName);
    if (String(newVal) === 'Dormant') {
      sheet.getRange(row, COLS.ORGS.NEXT_CHECK).setValue(addDays(today(), 42));
      autoDismissPendingForTarget('Organisation', orgId, 'Organisation marked Dormant');
      setOpenTodosForTarget('Organisation', orgId, 'Skipped', 'Organisation parked/dormant');
    }
    if (String(newVal) === 'Archived') {
      autoDismissPendingForTarget('Organisation', orgId, 'Organisation archived');
      setOpenTodosForTarget('Organisation', orgId, 'Cancelled', 'Organisation archived');
    }
  }
}

// Active never creates direct Tasks — only two suggestions. The user
// decides whether to act on either.
function fireOrgActiveCascade(orgId, orgName) {
  if (!orgId || !orgName) return;
  appendPendingDecision('ORG_ACTIVE:' + orgId + ':People sourcing', 'Organisation marked Active: ' + orgName,
    'Find people at: ' + orgName, 'Organisation', orgId, 'People sourcing', 'Suggested because this organisation is now Active.');
  appendPendingDecision('ORG_ACTIVE:' + orgId + ':Org job scan', 'Organisation marked Active: ' + orgName,
    'Scan jobs at: ' + orgName, 'Organisation', orgId, 'Org job scan', 'Suggested because this organisation is now Active.');
}

// --- Sectors: Stage 1 (sector-only) and Stage 2/3 (sub-sector) ---

// Stage 1: fires the direct "list sub-sectors" Task. Deduplicated by
// task text + target so re-editing the same Sector row (or capturing
// it again via onboarding) never creates a second copy. Accepts either
// a sector name (creates/finds the sector-only branch) or an
// already-resolved branch object (avoids a redundant upsert when the
// caller already has one, e.g. onEditSectors).
function fireSectorOnlyTask(sector) {
  var branch = (typeof sector === 'object') ? sector : upsertSectorBranch({ sector: sector, source: 'manual_sheet_entry', createExpansionDecision: false });
  if (!branch) return '';
  var linkedTaskText = 'List 2-4 sub-sectors worth exploring for ' + branch.sector;
  return appendTodoOnceForWorkflow(linkedTaskText, 'Sector', branch.id, '', 'Sector selection', 'Not started', '', '20 min',
    'Sub-sectors should be narrow enough that a market map of 10-15 organisations is feasible.', 'Auto-triggered');
}

// Stage 2/3: fired when upsertSectorBranch creates a real sub-sector row
// (only sub-sector rows carry an ID that Organisations.Sub-sector ID
// links against) — raises the "build an org list here?" Decision. Yes
// on that Decision is what creates the Market-map Task (see
// acceptPendingDecision -> appendTodoWithSource, workflow 'Market
// mapping'); No creates nothing.
function fireSubsectorAddedDecision(sector, subsector, subsectorId) {
  var expansionLabel = sector + ' - ' + subsector;
  var expansionKey = 'EXPAND_SUBSECTOR:' + subsectorId;
  if (findDecisionByKey(expansionKey)) return '';
  return appendPendingDecision(expansionKey, 'Sub-sector added: ' + expansionLabel,
    'Market map: ' + expansionLabel, 'Sector', subsectorId, 'Market mapping',
    'Build a list of target organisations in this sub-sector?');
}

// onEdit handler for direct typing on the Sectors tab. Uses the exact
// same upsertSectorBranch/fireSectorOnlyTask/fireSubsectorAddedDecision
// path as onboarding/popup capture, so manual entry and popup capture
// can never drift apart.
function onEditSectors(sheet, row, col, newVal) {
  if (row <= 1) return;
  if (col === COLS.SECTORS.STATUS) {
    var normalizedSectorStatus = normalizeSectorStatus(newVal);
    if (normalizedSectorStatus !== String(newVal || '')) sheet.getRange(row, COLS.SECTORS.STATUS).setValue(normalizedSectorStatus);
    if (normalizedSectorStatus === 'Retired') retireSectorBranch(sheet.getRange(row, COLS.SECTORS.ID).getValue());
    return;
  }
  if (col === COLS.SECTORS.SECTOR || col === COLS.SECTORS.SUBSECTOR) {
    var sectorValue = sheet.getRange(row, COLS.SECTORS.SECTOR).getValue();
    var subsectorValue = sheet.getRange(row, COLS.SECTORS.SUBSECTOR).getValue();
    if (!sectorValue && subsectorValue) { appendNoteFlag(sheet, row, COLS.SECTORS.NOTES, '[taxonomy] Add Sector before Sub-sector'); return; }
    if (!sectorValue) return;
    var existingId = String(sheet.getRange(row, COLS.SECTORS.ID).getValue() || '');
    if (existingId) {
      if (!sheet.getRange(row, COLS.SECTORS.STATUS).getValue()) sheet.getRange(row, COLS.SECTORS.STATUS).setValue('Open');
      propagateSectorRenameToOrganisations(existingId);
      if (!subsectorValue) fireSectorOnlyTask(getSectorBranchById(existingId));
      else fireSubsectorAddedDecision(sectorValue, subsectorValue, existingId);
      return;
    }
    var branch = upsertSectorBranch({ sector: sectorValue, subsector: subsectorValue, source: 'manual_sheet_entry', preferredRow: row, createExpansionDecision: !!subsectorValue });
    if (!branch) return;
    if (branch.row !== row) {
      sheet.getRange(row, 1, 1, HEADERS.Sectors.length).clearContent();
      SpreadsheetApp.getActiveSpreadsheet().toast('Merged duplicate Sectors entry into row ' + branch.row + '.', 'The Planner', 4);
      return;
    }
    if (!subsectorValue) fireSectorOnlyTask(branch);
    return;
  }
}

// =============================================================
// JOBS / PEOPLE — onEdit handlers (manual sheet entry)
//
// v7.1: deferred-cascade fix. Typing a Job title or Person name before
// Organisation used to fire the job/outreach cascade immediately with
// blank org context (job.org === '' / person.org === ''), producing
// Tasks and Decisions like "Find people at: " with no organisation
// named. Now: if Organisation is still blank when the anchor field
// (Opportunity / Name) is entered, the row is created (ID, defaults)
// but the cascade is deferred and a [pending-org] flag is left in
// Notes. As soon as Organisation is filled in on that row, the
// deferred cascade fires with full context and the flag is cleared.
// If Organisation is filled in at the same time as the anchor field
// (already non-blank), behavior is unchanged from v7.0 — fires once,
// immediately, with full context.
// =============================================================

function propagateSectorRenameToOrganisations(sectorId) {
  var branch = getSectorBranchById(sectorId);
  var orgSheet = getSheet('Organisations');
  if (!branch || !orgSheet || orgSheet.getLastRow() < 2) return 0;
  var data = orgSheet.getRange(2, 1, orgSheet.getLastRow() - 1, HEADERS.Organisations.length).getValues();
  var count = 0;
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][COLS.ORGS.SUBSECTOR_ID - 1]) !== String(sectorId)) continue;
    var r = i + 2;
    orgSheet.getRange(r, COLS.ORGS.SECTOR).setValue(branch.sector);
    orgSheet.getRange(r, COLS.ORGS.SUBSECTOR).setValue(branch.subsector);
    clearNoteFlag(orgSheet, r, COLS.ORGS.NOTES, '[orphaned-sector]');
    count++;
  }
  return count;
}

function retireSectorBranch(sectorId) {
  if (!sectorId) return 0;
  var decisions = autoDismissPendingForTarget('Sector', sectorId, 'Sector branch retired');
  var tasks = setOpenTodosForTarget('Sector', sectorId, 'Skipped', 'Sector branch retired');
  populateToday();
  refreshHome();
  return decisions + tasks;
}

function sectorIdExistsMap() {
  var sheet = getSheet('Sectors');
  var out = {};
  if (!sheet || sheet.getLastRow() < 2) return out;
  var ids = sheet.getRange(2, COLS.SECTORS.ID, sheet.getLastRow() - 1, 1).getValues();
  ids.forEach(function (r) { if (r[0]) out[String(r[0])] = true; });
  return out;
}

function repairSectorTaskLinks() {
  var taskSheet = getSheet('Tasks');
  if (!taskSheet || taskSheet.getLastRow() < 2) return 0;
  var repaired = 0;
  var data = taskSheet.getRange(2, 1, taskSheet.getLastRow() - 1, HEADERS['To-do'].length).getValues();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][COLS.TODO.OBJ_TYPE - 1]) !== 'Sector') continue;
    var objId = String(data[i][COLS.TODO.OBJ_ID - 1] || '');
    if (!objId || objId.indexOf('SEC-') === 0 || objId.indexOf('SUB-') === 0) continue;
    var taskText = String(data[i][COLS.TODO.TASK - 1] || '');
    var branch = null;
    // v7.7.1: legacy "Market map: Sector <sep> Sub-sector" task text used
    // either a plain hyphen (fireSubsectorAddedDecision) or an em dash
    // (rowActionSearchOrgsForSubsector) as separator depending on which
    // code path created it — match both, not just the hyphen.
    var marketMapMatch = taskText.match(/^Market map:\s*(.+?)\s*(?:—|-)\s*(.+)$/);
    if (marketMapMatch) branch = upsertSectorBranch({ sector: marketMapMatch[1], subsector: marketMapMatch[2], source: 'repair_backfill', createExpansionDecision: false });
    else branch = upsertSectorBranch({ sector: objId, source: 'repair_backfill', createExpansionDecision: false });
    if (!branch || !branch.id) continue;
    var row = i + 2;
    taskSheet.getRange(row, COLS.TODO.OBJ_ID).setValue(branch.id);
    appendNoteFlag(taskSheet, row, COLS.TODO.NOTES, '[sector-link-repaired] ' + objId + ' -> ' + branch.id);
    repaired++;
  }
  return repaired;
}

function repairSectorRows() {
  var sheet = getSheet('Sectors');
  if (!sheet || sheet.getLastRow() < 2) return 0;
  var repaired = 0;
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS.Sectors.length).getValues();
  for (var i = 0; i < data.length; i++) {
    var sector = String(data[i][COLS.SECTORS.SECTOR - 1] || '').trim();
    if (!sector) continue;
    var row = i + 2;
    var subsector = String(data[i][COLS.SECTORS.SUBSECTOR - 1] || '').trim();
    var id = String(data[i][COLS.SECTORS.ID - 1] || '');
    var prefix = subsector ? 'SUB' : 'SEC';
    if (id.indexOf(prefix + '-') !== 0) {
      sheet.getRange(row, COLS.SECTORS.ID).setValue(nextId(sheet, COLS.SECTORS.ID, prefix));
      appendNoteFlag(sheet, row, COLS.SECTORS.NOTES, '[created-via-repair]');
      repaired++;
    }
    if (!sheet.getRange(row, COLS.SECTORS.STATUS).getValue()) {
      sheet.getRange(row, COLS.SECTORS.STATUS).setValue('Open');
      repaired++;
    }
  }
  return repaired;
}

function detectSectorOrphans() {
  var existing = sectorIdExistsMap();
  var count = 0;
  var orgSheet = getSheet('Organisations');
  if (orgSheet && orgSheet.getLastRow() >= 2) {
    var orgData = orgSheet.getRange(2, 1, orgSheet.getLastRow() - 1, HEADERS.Organisations.length).getValues();
    for (var i = 0; i < orgData.length; i++) {
      var subId = String(orgData[i][COLS.ORGS.SUBSECTOR_ID - 1] || '');
      if (subId && !existing[subId]) {
        appendNoteFlag(orgSheet, i + 2, COLS.ORGS.NOTES, '[orphaned-sector] Linked Sector/Sub-sector no longer exists');
        count++;
      } else {
        clearNoteFlag(orgSheet, i + 2, COLS.ORGS.NOTES, '[orphaned-sector]');
      }
    }
  }
  var taskSheet = getSheet('Tasks');
  if (taskSheet && taskSheet.getLastRow() >= 2) {
    var taskData = taskSheet.getRange(2, 1, taskSheet.getLastRow() - 1, HEADERS['To-do'].length).getValues();
    for (var t = 0; t < taskData.length; t++) {
      var taskSectorId = String(taskData[t][COLS.TODO.OBJ_ID - 1] || '');
      var taskObjType = String(taskData[t][COLS.TODO.OBJ_TYPE - 1]);
      var isResolvedSectorRef = taskSectorId && (taskSectorId.indexOf('SEC-') === 0 || taskSectorId.indexOf('SUB-') === 0);
      if (taskObjType === 'Sector' && isResolvedSectorRef && !existing[taskSectorId]) {
        appendNoteFlag(taskSheet, t + 2, COLS.TODO.NOTES, '[orphaned-sector] Linked Sector/Sub-sector no longer exists');
        count++;
      } else if (taskObjType === 'Sector' && isResolvedSectorRef) {
        clearNoteFlag(taskSheet, t + 2, COLS.TODO.NOTES, '[orphaned-sector]');
      }
    }
  }
  return count;
}

function onEditJobs(sheet, row, col, newVal, e) {
  if (col === COLS.JOBS.OPPORTUNITY || col === COLS.JOBS.ORG) checkJobDuplicate(sheet, row);
  if (col === COLS.JOBS.ORG) {
    inheritOrgFields(sheet, row, COLS.JOBS.ORG, COLS.JOBS.ORG_ID);
    var jNotes = String(sheet.getRange(row, COLS.JOBS.NOTES).getValue() || '');
    if (jNotes.indexOf('[pending-org]') !== -1) {
      clearNoteFlag(sheet, row, COLS.JOBS.NOTES, '[pending-org]');
      var jId = sheet.getRange(row, COLS.JOBS.ID).getValue() || nextId(sheet, COLS.JOBS.ID, 'JOB');
      sheet.getRange(row, COLS.JOBS.ID).setValue(jId);
      var jStatus = normalizeJobStatus(sheet.getRange(row, COLS.JOBS.STATUS).getValue() || 'Want to apply');
      sheet.getRange(row, COLS.JOBS.STATUS).setValue(jStatus);
      fireJobStatusChanged(jId, '', jStatus, { source: 'manual-org-followup' });
    }
    return;
  }
  if (col === COLS.JOBS.OPPORTUNITY && newVal) {
    if (!sheet.getRange(row, COLS.JOBS.ID).getValue()) sheet.getRange(row, COLS.JOBS.ID).setValue(nextId(sheet, COLS.JOBS.ID, 'JOB'));
    if (!sheet.getRange(row, COLS.JOBS.STATUS).getValue()) sheet.getRange(row, COLS.JOBS.STATUS).setValue('Want to apply');
    var org = sheet.getRange(row, COLS.JOBS.ORG).getValue();
    if (org) {
      inheritOrgFields(sheet, row, COLS.JOBS.ORG, COLS.JOBS.ORG_ID);
      fireJobStatusChanged(sheet.getRange(row, COLS.JOBS.ID).getValue(), '', sheet.getRange(row, COLS.JOBS.STATUS).getValue(), { source: 'manual' });
    } else {
      appendNoteFlag(sheet, row, COLS.JOBS.NOTES, '[pending-org] Add Organisation to activate this job\u2019s tasks.');
    }
    return;
  }
  if (col === COLS.JOBS.DEADLINE) { recalcTodosLinkedToObject(String(sheet.getRange(row, COLS.JOBS.ID).getValue())); syncJobsPeopleHealthFlags(); return; }
  if (col === COLS.JOBS.RESPONSE && String(newVal) === 'Yes') {
    var responseJobId = sheet.getRange(row, COLS.JOBS.ID).getValue() || nextId(sheet, COLS.JOBS.ID, 'JOB');
    sheet.getRange(row, COLS.JOBS.ID).setValue(responseJobId);
    createJobResponseOutcomeDecision(responseJobId, 'Response received for ' + sheet.getRange(row, COLS.JOBS.OPPORTUNITY).getValue());
    renderTodayDecisionCards();
    refreshHome();
    return;
  }
  if (col === COLS.JOBS.OUTCOME && newVal) {
    var outcomeJobId = sheet.getRange(row, COLS.JOBS.ID).getValue() || nextId(sheet, COLS.JOBS.ID, 'JOB');
    sheet.getRange(row, COLS.JOBS.ID).setValue(outcomeJobId);
    if (!sheet.getRange(row, COLS.JOBS.RESPONSE).getValue()) sheet.getRange(row, COLS.JOBS.RESPONSE).setValue('Yes');
    createJobResponseOutcomeDecision(outcomeJobId, 'Outcome entered for ' + sheet.getRange(row, COLS.JOBS.OPPORTUNITY).getValue());
    renderTodayDecisionCards();
    refreshHome();
    return;
  }
  if (col === COLS.JOBS.STATUS) {
    var status = normalizeJobStatus(newVal);
    if (status !== String(newVal || '')) sheet.getRange(row, COLS.JOBS.STATUS).setValue(status);
    var id = sheet.getRange(row, COLS.JOBS.ID).getValue() || nextId(sheet, COLS.JOBS.ID, 'JOB');
    sheet.getRange(row, COLS.JOBS.ID).setValue(id);
    if (!sheet.getRange(row, COLS.JOBS.ORG).getValue()) {
      appendNoteFlag(sheet, row, COLS.JOBS.NOTES, '[pending-org] Add Organisation to activate this job\u2019s tasks.');
      return;
    }
    inheritOrgFields(sheet, row, COLS.JOBS.ORG, COLS.JOBS.ORG_ID);
    fireJobStatusChanged(id, e && e.oldValue, status, { source: 'manual' });
    syncJobsPeopleHealthFlags();
  }
}

function onEditPeople(sheet, row, col, newVal, e) {
  if (col === COLS.PEOPLE.NAME || col === COLS.PEOPLE.ORG) checkPeopleDuplicate(sheet, row);
  if (col === COLS.PEOPLE.ORG) {
    inheritOrgFields(sheet, row, COLS.PEOPLE.ORG, COLS.PEOPLE.ORG_ID);
    var pNotes = String(sheet.getRange(row, COLS.PEOPLE.NOTES).getValue() || '');
    if (pNotes.indexOf('[pending-org]') !== -1) {
      clearNoteFlag(sheet, row, COLS.PEOPLE.NOTES, '[pending-org]');
      var pId = sheet.getRange(row, COLS.PEOPLE.ID).getValue() || nextId(sheet, COLS.PEOPLE.ID, 'PER');
      sheet.getRange(row, COLS.PEOPLE.ID).setValue(pId);
      var pStage = normalizePersonStage(sheet.getRange(row, COLS.PEOPLE.STAGE).getValue() || 'Identified');
      sheet.getRange(row, COLS.PEOPLE.STAGE).setValue(pStage);
      firePersonStageChanged(pId, '', pStage, { source: 'manual-org-followup' });
    }
    return;
  }
  if (col === COLS.PEOPLE.NAME && newVal) {
    if (!sheet.getRange(row, COLS.PEOPLE.ID).getValue()) sheet.getRange(row, COLS.PEOPLE.ID).setValue(nextId(sheet, COLS.PEOPLE.ID, 'PER'));
    if (!sheet.getRange(row, COLS.PEOPLE.FOLLOW_UPS_SENT_COUNT).getValue()) sheet.getRange(row, COLS.PEOPLE.FOLLOW_UPS_SENT_COUNT).setValue(0);
    if (!sheet.getRange(row, COLS.PEOPLE.STAGE).getValue()) sheet.getRange(row, COLS.PEOPLE.STAGE).setValue('Identified');
    var orgName = sheet.getRange(row, COLS.PEOPLE.ORG).getValue();
    if (orgName) {
      inheritOrgFields(sheet, row, COLS.PEOPLE.ORG, COLS.PEOPLE.ORG_ID);
      firePersonStageChanged(sheet.getRange(row, COLS.PEOPLE.ID).getValue(), '', 'Identified', { source: 'manual' });
    } else {
      appendNoteFlag(sheet, row, COLS.PEOPLE.NOTES, '[pending-org] Add Organisation to activate outreach task (leave blank and use the Tasks menu if there is none).');
    }
    return;
  }
  if (col === COLS.PEOPLE.REPLY_RECEIVED && String(newVal) === 'Yes') {
    if (!sheet.getRange(row, COLS.PEOPLE.ORG).getValue()) {
      appendNoteFlag(sheet, row, COLS.PEOPLE.NOTES, '[pending-org] Add Organisation before routing this reply.');
      return;
    }
    inheritOrgFields(sheet, row, COLS.PEOPLE.ORG, COLS.PEOPLE.ORG_ID);
    var pid = sheet.getRange(row, COLS.PEOPLE.ID).getValue();
    var oldStage = sheet.getRange(row, COLS.PEOPLE.STAGE).getValue();
    sheet.getRange(row, COLS.PEOPLE.STAGE).setValue('Engaged');
    firePersonStageChanged(pid, oldStage, 'Engaged', { source: 'manual' });
    return;
  }
  if (col === COLS.PEOPLE.CONVERSATION_DATE && newVal) {
    var convPersonId = sheet.getRange(row, COLS.PEOPLE.ID).getValue() || nextId(sheet, COLS.PEOPLE.ID, 'PER');
    sheet.getRange(row, COLS.PEOPLE.ID).setValue(convPersonId);
    if (!sheet.getRange(row, COLS.PEOPLE.ORG).getValue()) {
      appendNoteFlag(sheet, row, COLS.PEOPLE.NOTES, '[pending-org] Add Organisation before routing this conversation.');
      return;
    }
    inheritOrgFields(sheet, row, COLS.PEOPLE.ORG, COLS.PEOPLE.ORG_ID);
    var currentStage = normalizePersonStage(sheet.getRange(row, COLS.PEOPLE.STAGE).getValue());
    if (currentStage !== 'Conversation completed') {
      sheet.getRange(row, COLS.PEOPLE.STAGE).setValue('Conversation scheduled');
      firePersonStageChanged(convPersonId, currentStage, 'Conversation scheduled', { source: 'manual-date', realDate: newVal });
    }
    return;
  }
  if (col === COLS.PEOPLE.STAGE) {
    var personId = sheet.getRange(row, COLS.PEOPLE.ID).getValue() || nextId(sheet, COLS.PEOPLE.ID, 'PER');
    sheet.getRange(row, COLS.PEOPLE.ID).setValue(personId);
    var stage = normalizePersonStage(newVal);
    if (stage !== String(newVal || '')) sheet.getRange(row, COLS.PEOPLE.STAGE).setValue(stage);
    if (!sheet.getRange(row, COLS.PEOPLE.ORG).getValue()) {
      appendNoteFlag(sheet, row, COLS.PEOPLE.NOTES, '[pending-org] Add Organisation before activating this person stage.');
      return;
    }
    inheritOrgFields(sheet, row, COLS.PEOPLE.ORG, COLS.PEOPLE.ORG_ID);
    firePersonStageChanged(personId, e && e.oldValue, stage, { source: 'manual' });
  }
}

// =============================================================
// CONVERSATIONS (Interactions tab)
// =============================================================

function appendInteraction(personId, personName, org, dateValue, typeValue, notes, outcome) {
  var sheet = getSheet('Conversations');
  if (!sheet) return '';
  var id = nextId(sheet, COLS.INTERACTIONS.ID, 'INT');
  var row = new Array(HEADERS.Interactions.length).fill('');
  row[COLS.INTERACTIONS.ID - 1] = id;
  row[COLS.INTERACTIONS.DATE - 1] = dateValue || today();
  row[COLS.INTERACTIONS.PERSON_ID - 1] = personId || '';
  row[COLS.INTERACTIONS.PERSON - 1] = personName || '';
  row[COLS.INTERACTIONS.ORG - 1] = org || '';
  row[COLS.INTERACTIONS.TYPE - 1] = typeValue || 'Auto-log';
  row[COLS.INTERACTIONS.NOTES - 1] = notes || '';
  row[COLS.INTERACTIONS.OUTCOME - 1] = outcome || (typeValue === 'Auto-log' ? 'System log' : 'Useful');
  sheet.appendRow(row);
  linkInteractionPersonCell(sheet.getLastRow());
  return id;
}

function personSheetAnchor(row) {
  var pSheet = getSheet('People');
  if (!pSheet || !row) return '';
  return '#gid=' + pSheet.getSheetId() + '&range=A' + row;
}

function linkInteractionPersonCell(interactionRow) {
  var sheet = getSheet('Conversations');
  var person = null;
  if (!sheet || interactionRow < 2) return false;
  var personId = String(sheet.getRange(interactionRow, COLS.INTERACTIONS.PERSON_ID).getValue() || '');
  if (!personId) return false;
  person = getPersonRowById(personId);
  if (!person) return false;
  sheet.getRange(interactionRow, COLS.INTERACTIONS.ORG).setValue(person.org || '');
  var cell = sheet.getRange(interactionRow, COLS.INTERACTIONS.PERSON);
  var display = String(person.name || '');
  try {
    cell.setRichTextValue(SpreadsheetApp.newRichTextValue()
      .setText(display)
      .setLinkUrl(personSheetAnchor(person.row))
      .build());
  } catch (err) {
    cell.setValue(display);
  }
  return true;
}

function repairInteractionPersonLinks() {
  var sheet = getSheet('Conversations');
  if (!sheet || sheet.getLastRow() < 2) return 0;
  var fixed = 0;
  for (var r = 2; r <= sheet.getLastRow(); r++) {
    if (sheet.getRange(r, COLS.INTERACTIONS.PERSON_ID).getValue() && linkInteractionPersonCell(r)) fixed++;
  }
  return fixed;
}

function resolveInteractionPersonSelection(selection) {
  var sheet = getSheet('People');
  if (!sheet || sheet.getLastRow() < 2 || !selection) return { person: null, ambiguous: false };
  var raw = String(selection || '').trim();
  var labelMatch = raw.match(/^(.*)\s+\(([^()]+)\)$/);
  var wantedName = labelMatch ? labelMatch[1] : raw;
  var wantedOrg = labelMatch ? labelMatch[2] : '';
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS.People.length).getValues();
  var exact = [];
  var fuzzy = [];
  for (var i = 0; i < data.length; i++) {
    var nm = String(data[i][COLS.PEOPLE.NAME - 1] || '');
    var org = String(data[i][COLS.PEOPLE.ORG - 1] || '');
    if (wantedOrg && normalizeKeyPart(org) !== normalizeKeyPart(wantedOrg)) continue;
    if (normalizeKeyPart(nm) === normalizeKeyPart(wantedName)) exact.push({ row: i + 2, data: data[i] });
    else if (!wantedOrg && similarity(wantedName, nm) >= 0.85) fuzzy.push({ row: i + 2, data: data[i] });
  }
  if (exact.length === 1) return { person: exact[0], ambiguous: false };
  if (exact.length > 1) return { person: null, ambiguous: true };
  if (fuzzy.length === 1) return { person: fuzzy[0], ambiguous: false };
  if (fuzzy.length > 1) return { person: null, ambiguous: true };
  return { person: null, ambiguous: false };
}

function refreshInteractionPersonDropdown() {
  var iSheet = getSheet('Conversations');
  var pSheet = getSheet('People');
  if (!iSheet || !pSheet) return;
  var maxRow = Math.max(iSheet.getLastRow() - 1, 1) + 30;
  if (pSheet.getLastRow() < 2) { iSheet.getRange(2, COLS.INTERACTIONS.PERSON, maxRow, 1).clearDataValidations(); return; }
  var data = pSheet.getRange(2, 1, pSheet.getLastRow() - 1, HEADERS.People.length).getValues();
  var nameCounts = {};
  data.forEach(function (r) { var nm = String(r[COLS.PEOPLE.NAME - 1] || '').trim(); if (nm) nameCounts[nm] = (nameCounts[nm] || 0) + 1; });
  var labels = data.map(function (r) {
    var nm = String(r[COLS.PEOPLE.NAME - 1] || '').trim();
    var org = String(r[COLS.PEOPLE.ORG - 1] || '').trim();
    if (!nm) return '';
    return (nameCounts[nm] > 1 && org) ? nm + ' (' + org + ')' : nm;
  }).filter(function (l) { return !!l; });
  setDropdown(iSheet.getRange(2, COLS.INTERACTIONS.PERSON, maxRow, 1), labels);
}

function onEditInteractions(sheet, row, col, newVal) {
  if (col === COLS.INTERACTIONS.PERSON && newVal) {
    var resolved = resolveInteractionPersonSelection(String(newVal));
    if (resolved.person) {
      var person = resolved.person;
      sheet.getRange(row, COLS.INTERACTIONS.PERSON_ID).setValue(person.data[COLS.PEOPLE.ID - 1]);
      sheet.getRange(row, COLS.INTERACTIONS.ORG).setValue(person.data[COLS.PEOPLE.ORG - 1] || '');
      if (!sheet.getRange(row, COLS.INTERACTIONS.DATE).getValue()) sheet.getRange(row, COLS.INTERACTIONS.DATE).setValue(today());
      if (!sheet.getRange(row, COLS.INTERACTIONS.ID).getValue()) sheet.getRange(row, COLS.INTERACTIONS.ID).setValue(nextId(sheet, COLS.INTERACTIONS.ID, 'INT'));
      linkInteractionPersonCell(row);
    } else if (resolved.ambiguous) {
      appendNoteFlag(sheet, row, COLS.INTERACTIONS.NOTES, '[flags] Ambiguous person name - pick the dropdown entry with organisation or fill Person ID.');
      SpreadsheetApp.getActiveSpreadsheet().toast('More than one matching person. Pick the entry with organisation or fill Person ID.', 'The Planner', 5);
    } else {
      SpreadsheetApp.getActiveSpreadsheet().toast('Person "' + newVal + '" not found in People. Add them there first, then re-pick.', 'The Planner', 5);
    }
    return;
  }
  if (col === COLS.INTERACTIONS.PERSON_ID && newVal) {
    linkInteractionPersonCell(row);
    return;
  }
  if (col !== COLS.INTERACTIONS.OUTCOME || !newVal) return;
  if (String(newVal) === 'System log') return;
  var personId = sheet.getRange(row, COLS.INTERACTIONS.PERSON_ID).getValue();
  var personName = sheet.getRange(row, COLS.INTERACTIONS.PERSON).getValue();
  var org = sheet.getRange(row, COLS.INTERACTIONS.ORG).getValue();
  var notes = sheet.getRange(row, COLS.INTERACTIONS.NOTES).getValue();
  var outcome = String(newVal);
  if (!personId) {
    appendNoteFlag(sheet, row, COLS.INTERACTIONS.NOTES, '[flags] \u26a0 Outcome set but Person not identified — cascade skipped');
    return;
  }
  if (outcome === 'Follow-up needed') {
    appendTodoOnceForWorkflow('Follow up with ' + personName, 'Person', personId, org, 'Contact follow-up', 'Not started', addDays(today(), 3), '15 min', notes || '', 'Auto-triggered');
  } else if (outcome === 'Opportunity created') {
    appendPendingDecision('INTERACTION_OPP:' + sheet.getRange(row, COLS.INTERACTIONS.ID).getValue() + ':Job', 'Opportunity mentioned by ' + personName,
      'Add/update job from conversation with ' + personName, 'Person', personId, 'Org job scan', notes || '');
  } else if (outcome === 'Referral given') {
    appendPendingDecision('INTERACTION_REFERRAL:' + sheet.getRange(row, COLS.INTERACTIONS.ID).getValue() + ':Referral search', 'Referral mentioned by ' + personName,
      'Act on referral from ' + personName, 'Person', personId, 'Referral search', notes || '');
  } else if (outcome === 'Dead end') {
    movePersonStage(personId, 'Closed', { source: 'interaction' });
  } else if (outcome === 'Neutral') {
    movePersonStage(personId, 'Nurture', { source: 'interaction' });
  }
}

// =============================================================
// INTERVIEWS (Interview rounds tab)
// =============================================================

function roundTypePrepFocus(roundType) {
  var focus = {
    'Recruiter': 'Role narrative, motivation, logistics, questions, and compensation/availability where relevant.',
    'Hiring manager': 'Role fit, judgement, operating examples, and what success looks like.',
    'Panel': 'Stakeholder map, concise examples, repeated-answer consistency, and audience-specific questions.',
    'Case': 'Structure, issue tree, assumptions, maths, synthesis, and recommendation.',
    'Technical': 'Domain concepts, technical examples, terminology, and evidence of fluency.',
    'Culture fit': 'Values, working style, conflict, leadership, and motivation.',
    'Final': 'Decision-maker narrative, closing story, objections, and final questions.',
    'Other': 'Role narrative, fit examples, questions, logistics, and follow-up.'
  };
  return focus[roundType] || focus.Other;
}

function interviewPrepNotes(roundType, domainReadiness, section) {
  return '[interview-prep]\n' +
    'Round type: ' + (roundType || 'Other') + '\n' +
    'Domain/prep readiness: ' + (domainReadiness || 'Not set') + '\n' +
    'Focus: ' + roundTypePrepFocus(roundType) + '\n' +
    'This task: ' + section;
}

function interviewDebriefTemplate() {
  return '[interview-debrief]\n' +
    'What they asked:\n' +
    'What landed:\n' +
    'What was weak:\n' +
    'Follow-up promised:\n' +
    'Learning for next round:';
}

function interviewerTemplate() {
  return '[interviewers]\nName:\nRole:\nOrganisation:\nPerson ID, if known:\nNotes:';
}

function nextRoundKnownDetailsTemplate() {
  return '[next-round-known-details]\n' +
    'Round type:\n' +
    'Expected timing:\n' +
    'Interviewer/panel:\n' +
    'What they said to prepare:';
}

function conversationPrepNotes() {
  return '[conversation-prep]\n' +
    'Why am I speaking to them?\n' +
    'What do I want to learn?\n' +
    'What can I offer?\n' +
    'What is the soft ask?\n' +
    'What would make this conversation successful?';
}

function conversationDebriefNotes() {
  return '[conversation-debrief]\n' +
    'What happened?\n' +
    'What did I learn?\n' +
    'Roles/orgs/people mentioned:\n' +
    'Referral or opportunity offered:\n' +
    'What did I promise?\n' +
    'Next state:';
}

function ensureInterviewDebriefTemplate(sheet, row) {
  var notes = String(sheet.getRange(row, COLS.ROUNDS.NOTES).getValue() || '');
  if (notes.indexOf('[interview-debrief]') === -1) {
    sheet.getRange(row, COLS.ROUNDS.NOTES).setValue(notes ? notes + '\n\n' + interviewDebriefTemplate() : interviewDebriefTemplate());
  }
}

function ensureInterviewerTemplate(sheet, row) {
  var notes = String(sheet.getRange(row, COLS.ROUNDS.NOTES).getValue() || '');
  if (notes.indexOf('[interviewers]') === -1) {
    sheet.getRange(row, COLS.ROUNDS.NOTES).setValue(notes ? notes + '\n\n' + interviewerTemplate() : interviewerTemplate());
  }
}

function upsertInterviewPrepTask(roundId, workflow, desired) {
  var taskSheet = getSheet('Tasks');
  if (!taskSheet || !roundId || !workflow || !desired) return '';
  if (taskSheet.getLastRow() > 1) {
    var data = taskSheet.getRange(2, 1, taskSheet.getLastRow() - 1, HEADERS['To-do'].length).getValues();
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][COLS.TODO.OBJ_TYPE - 1]) !== 'Interview round') continue;
      if (String(data[i][COLS.TODO.OBJ_ID - 1]) !== String(roundId)) continue;
      if (String(data[i][COLS.TODO.WORKFLOW - 1]) !== String(workflow)) continue;
      var st = String(data[i][COLS.TODO.STATUS - 1]);
      if (st === 'Done' || st === 'Skipped' || st === 'Cancelled') return String(data[i][COLS.TODO.ID - 1] || '');
      var r = i + 2;
      taskSheet.getRange(r, COLS.TODO.TASK).setValue(desired.task);
      taskSheet.getRange(r, COLS.TODO.DUE_DATE).setValue(desired.dueDate || '');
      taskSheet.getRange(r, COLS.TODO.TIME_EST).setValue(desired.timeEst || defaultTimeForWorkflow(workflow));
      taskSheet.getRange(r, COLS.TODO.NOTES).setValue(desired.notes || '');
      taskSheet.getRange(r, COLS.TODO.LAST_EDITED).setValue(today());
      taskSheet.getRange(r, COLS.TODO.COMMITMENT_CLASS).setValue(assignCommitmentClass(workflow, desired.dueDate || '', roundId, 'Interview round'));
      taskSheet.getRange(r, COLS.TODO.CLASS_CALC_AT).setValue(today());
      taskSheet.getRange(r, COLS.TODO.EFFORT_TYPE).setValue(deriveEffortType(workflow));
      applyTaskHelperColumns(taskSheet, r);
      return String(data[i][COLS.TODO.ID - 1] || '');
    }
  }
  return appendTodoWithSource(desired.task, 'Interview round', roundId, desired.org || '', workflow,
    desired.status || 'Not started', desired.dueDate || '', desired.timeEst || defaultTimeForWorkflow(workflow),
    desired.notes || '', 'Auto-triggered');
}

function retireObsoleteInterviewPrepTasks(roundId, desiredWorkflowMap) {
  var taskSheet = getSheet('Tasks');
  if (!taskSheet || !roundId || taskSheet.getLastRow() < 2) return 0;
  var prepWorkflows = {
    'Interview prep (Domain scoping)': true,
    'Interview prep (Study)': true,
    'Interview prep (Fit case)': true,
    'Day-before review': true
  };
  var data = taskSheet.getRange(2, 1, taskSheet.getLastRow() - 1, HEADERS['To-do'].length).getValues();
  var retired = 0;
  for (var i = 0; i < data.length; i++) {
    var workflow = String(data[i][COLS.TODO.WORKFLOW - 1] || '');
    if (!prepWorkflows[workflow] || desiredWorkflowMap[workflow]) continue;
    if (String(data[i][COLS.TODO.OBJ_TYPE - 1]) !== 'Interview round') continue;
    if (String(data[i][COLS.TODO.OBJ_ID - 1]) !== String(roundId)) continue;
    var st = String(data[i][COLS.TODO.STATUS - 1]);
    if (st !== 'Not started' && st !== 'In progress') continue;
    var r = i + 2;
    taskSheet.getRange(r, COLS.TODO.STATUS).setValue('Skipped');
    taskSheet.getRange(r, COLS.TODO.COMPLETED).setValue(today());
    taskSheet.getRange(r, COLS.TODO.LAST_EDITED).setValue(today());
    appendNoteFlag(taskSheet, r, COLS.TODO.NOTES, '[skipped] Prep plan changed; task no longer needed.');
    retired++;
  }
  return retired;
}

function scheduleInterviewRound(roundId, dateValue) {
  var round = getRoundById(roundId);
  var sheet = getSheet('Interviews');
  if (!round || !sheet || !dateValue) return false;
  var interviewDate = parseDateOr(dateValue, '');
  sheet.getRange(round.row, COLS.ROUNDS.INTERVIEW_DATE).setValue(interviewDate);
  sheet.getRange(round.row, COLS.ROUNDS.STATUS).setValue('Scheduled');
  var roundType = String(sheet.getRange(round.row, COLS.ROUNDS.ROUND_TYPE).getValue() || 'Other');
  if (!sheet.getRange(round.row, COLS.ROUNDS.EXPECTED_RESPONSE).getValue()) {
    sheet.getRange(round.row, COLS.ROUNDS.EXPECTED_RESPONSE).setValue(addDays(interviewDate, REPLY_DAYS_BY_ROUND_TYPE[roundType] || 7));
  }
  if (sheet.getRange(round.row, COLS.ROUNDS.DOMAIN_READINESS).getValue()) createInterviewPrepTasks(roundId);
  return true;
}

function createInterviewPrepTasks(roundId) {
  var round = getRoundById(roundId);
  if (!round) return 0;
  var sheet = getSheet('Interviews');
  var domainReadiness = String(sheet.getRange(round.row, COLS.ROUNDS.DOMAIN_READINESS).getValue() || '');
  var roundType = String(sheet.getRange(round.row, COLS.ROUNDS.ROUND_TYPE).getValue() || 'Other');
  var interviewDate = sheet.getRange(round.row, COLS.ROUNDS.INTERVIEW_DATE).getValue();
  var jobAt = round.job + (round.org ? ' at ' + round.org : '');
  var desiredWorkflows = {};
  var created = 0;
  if (!domainReadiness) return 0;
  ensureInterviewerTemplate(sheet, round.row);
  if (!sheet.getRange(round.row, COLS.ROUNDS.EXPECTED_RESPONSE).getValue() && interviewDate) {
    sheet.getRange(round.row, COLS.ROUNDS.EXPECTED_RESPONSE).setValue(addDays(new Date(interviewDate), REPLY_DAYS_BY_ROUND_TYPE[roundType] || 7));
  }
  if (domainReadiness === 'Refresh needed' || domainReadiness === 'Weak or new') {
    desiredWorkflows['Interview prep (Domain scoping)'] = true;
    var domainMinutes = domainReadiness === 'Weak or new' ? '60 min' : '30 min';
    if (upsertInterviewPrepTask(roundId, 'Interview prep (Domain scoping)', {
      task: 'Interview prep - domain map: ' + jobAt,
      org: round.org,
      dueDate: interviewDate ? addDays(new Date(interviewDate), -3) : '',
      timeEst: domainMinutes,
      notes: interviewPrepNotes(roundType, domainReadiness, 'Refresh the organisation, role, sector context, likely themes, and weak spots.')
    })) created++;
  }
  if (domainReadiness === 'Weak or new') {
    desiredWorkflows['Interview prep (Study)'] = true;
    if (upsertInterviewPrepTask(roundId, 'Interview prep (Study)', {
      task: 'Interview prep - study plan: ' + jobAt,
      org: round.org,
      dueDate: interviewDate ? addDays(new Date(interviewDate), -3) : '',
      timeEst: '60 min',
      notes: interviewPrepNotes(roundType, domainReadiness, 'Build the minimum viable study plan for unfamiliar concepts, language, and examples.')
    })) created++;
  }
  desiredWorkflows['Interview prep (Fit case)'] = true;
  if (upsertInterviewPrepTask(roundId, 'Interview prep (Fit case)', {
    task: 'Interview prep - ' + String(roundType || 'fit').toLowerCase() + ' story: ' + jobAt,
    org: round.org,
    dueDate: interviewDate ? addDays(new Date(interviewDate), -2) : '',
    timeEst: domainReadiness === 'Strong' ? '45 min' : '60 min',
    notes: interviewPrepNotes(roundType, domainReadiness, 'Prepare the story, examples, questions, and round-specific answer shape.')
  })) created++;
  if (interviewDate) desiredWorkflows['Day-before review'] = true;
  if (interviewDate && upsertInterviewPrepTask(roundId, 'Day-before review', {
    task: 'Day-before review: ' + jobAt,
    org: round.org,
    dueDate: addDays(new Date(interviewDate), -1),
    timeEst: '90 min',
    notes: interviewPrepNotes(roundType, domainReadiness, 'Final pass: logistics, notes, questions, story anchors, and follow-up plan.')
  })) created++;
  retireObsoleteInterviewPrepTasks(roundId, desiredWorkflows);
  return created;
}

function createInterviewDebriefTask(roundId) {
  var round = getRoundById(roundId);
  if (!round) return '';
  ensureInterviewDebriefTemplate(getSheet('Interviews'), round.row);
  return appendTodoOnceForWorkflow('Thank-you and debrief: ' + round.job + (round.org ? ' at ' + round.org : ''),
    'Interview round', roundId, round.org, 'Thank-you and debrief', 'Not started', today(), '20 min',
    interviewDebriefTemplate(), 'Auto-triggered');
}

function onEditRounds(sheet, row, col, newVal) {
  var roundId = sheet.getRange(row, COLS.ROUNDS.ID).getValue();
  var jobId = sheet.getRange(row, COLS.ROUNDS.JOB_ID).getValue();
  var jobDisplay = sheet.getRange(row, COLS.ROUNDS.JOB_DISPLAY).getValue();
  var orgDisplay = sheet.getRange(row, COLS.ROUNDS.ORG_DISPLAY).getValue();
  var roundNum = sheet.getRange(row, COLS.ROUNDS.ROUND).getValue();

  if (col === COLS.ROUNDS.INTERVIEW_DATE && newVal) {
    scheduleInterviewRound(roundId, newVal);
    return;
  }
  if (col === COLS.ROUNDS.ROUND_TYPE && newVal) {
    var interviewDateForType = sheet.getRange(row, COLS.ROUNDS.INTERVIEW_DATE).getValue();
    if (interviewDateForType && !sheet.getRange(row, COLS.ROUNDS.EXPECTED_RESPONSE).getValue()) {
      sheet.getRange(row, COLS.ROUNDS.EXPECTED_RESPONSE).setValue(addDays(new Date(interviewDateForType), REPLY_DAYS_BY_ROUND_TYPE[String(newVal)] || 7));
    }
    if (sheet.getRange(row, COLS.ROUNDS.DOMAIN_READINESS).getValue()) createInterviewPrepTasks(roundId);
    return;
  }
  if (col === COLS.ROUNDS.DOMAIN_READINESS && String(sheet.getRange(row, COLS.ROUNDS.STATUS).getValue()) === 'Scheduled') {
    createInterviewPrepTasks(roundId);
    return;
  }
  if (col === COLS.ROUNDS.OFFICIAL_OUTCOME) {
    if (String(newVal) === 'Waiting' && !sheet.getRange(row, COLS.ROUNDS.EXPECTED_RESPONSE).getValue()) {
      var waitingDate = sheet.getRange(row, COLS.ROUNDS.INTERVIEW_DATE).getValue() || today();
      var waitingType = String(sheet.getRange(row, COLS.ROUNDS.ROUND_TYPE).getValue() || 'Other');
      sheet.getRange(row, COLS.ROUNDS.EXPECTED_RESPONSE).setValue(addDays(new Date(waitingDate), REPLY_DAYS_BY_ROUND_TYPE[waitingType] || 7));
    }
    if (String(newVal) === 'Rejected') setJobStatus(jobId, 'Closed', { source: 'round-outcome' });
    if (String(newVal) === 'Offer') setJobStatus(jobId, 'Offer', { source: 'round-outcome' });
    if (String(newVal) === 'Parked') setJobStatus(jobId, 'Parked', { source: 'round-outcome' });
    if (String(newVal) === 'Next round') createInterviewRoundForJob(jobId, { roundDetails: { roundNum: (parseInt(roundNum, 10) || 1) + 1, notes: nextRoundKnownDetailsTemplate() } });
    return;
  }
  if (col === COLS.ROUNDS.STATUS) {
    if (String(newVal) === 'Completed') {
      if (!sheet.getRange(row, COLS.ROUNDS.OFFICIAL_OUTCOME).getValue()) sheet.getRange(row, COLS.ROUNDS.OFFICIAL_OUTCOME).setValue('Waiting');
      createInterviewDebriefTask(roundId);
      appendInteraction('', '', orgDisplay, today(), 'Auto-log', 'Interview completed: round ' + (roundNum || '?') + ' - ' + jobDisplay, 'System log');
    }
    if (String(newVal) === 'Reschedule') {
      appendTodoOnceForWorkflow('Reschedule interview: ' + jobDisplay + (orgDisplay ? ' at ' + orgDisplay : ''), 'Interview round', roundId, orgDisplay, 'Interview scheduling', 'Not started', '', '15 min', 'Find a new time, then update Interview date.', 'Auto-triggered');
    }
    if (String(newVal) === 'Cancelled') {
      setOpenTodosForTarget('Interview round', roundId, 'Cancelled', 'Interview round cancelled',
        ['Interview scheduling', 'Interview prep (Domain scoping)', 'Interview prep (Study)', 'Interview prep (Fit case)', 'Day-before review', 'Thank-you and debrief', 'Interview follow-up']);
      // v7.7.4: a round can be cancelled after its 'Completed' cascade
      // already raised an INTERVIEW_OUTCOME decision — without this, that
      // decision stays open forever asking for an outcome on a round the
      // user just said never happened. Same idiom as every other
      // terminal-state cascade (Organisation/Job/Person/Sector).
      autoDismissPendingForTarget('Interview round', roundId, 'Interview round cancelled');
    }
  }
}

function findRoundsNeedingPrep() {
  var sheet = getSheet('Interviews');
  if (!sheet || sheet.getLastRow() < 2) return [];
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, COLS.ROUNDS.NOTES).getValues();
  var todayDate = today(), out = [];
  for (var i = 0; i < data.length; i++) {
    var status = String(data[i][COLS.ROUNDS.STATUS - 1]);
    var domain = String(data[i][COLS.ROUNDS.DOMAIN_READINESS - 1]);
    var interviewDate = data[i][COLS.ROUNDS.INTERVIEW_DATE - 1];
    if (status !== 'Scheduled' || domain || !interviewDate) continue;
    var d = new Date(interviewDate);
    if (isNaN(d.getTime())) continue;
    var daysUntil = daysBetween(todayDate, d);
    if (daysUntil >= 0 && daysUntil <= 5) {
      out.push({ row: i + 2, jobDisplay: String(data[i][COLS.ROUNDS.JOB_DISPLAY - 1]), orgDisplay: String(data[i][COLS.ROUNDS.ORG_DISPLAY - 1]), daysUntil: daysUntil });
    }
  }
  return out;
}

function checkDomainReadinessFlags() {
  var results = findRoundsNeedingPrep();
  var sheet = getSheet('Interviews');
  if (!sheet) return;
  results.forEach(function (r) { appendNoteFlag(sheet, r.row, COLS.ROUNDS.NOTES, '[flags] \u26a0 Domain readiness not set — prep may be missing'); });
}

function checkInterviewRoundHealthFlags() {
  var sheet = getSheet('Interviews');
  if (!sheet || sheet.getLastRow() < 2) return 0;
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS['Interview rounds'].length).getValues();
  var todayDate = today();
  var flagged = 0;
  var jobIds = jobIdExistsMap();
  for (var i = 0; i < data.length; i++) {
    var row = i + 2;
    var roundId = String(data[i][COLS.ROUNDS.ID - 1] || '');
    var jobId = String(data[i][COLS.ROUNDS.JOB_ID - 1] || '');
    var status = String(data[i][COLS.ROUNDS.STATUS - 1] || '');
    var outcome = String(data[i][COLS.ROUNDS.OFFICIAL_OUTCOME - 1] || '');
    var domain = String(data[i][COLS.ROUNDS.DOMAIN_READINESS - 1] || '');
    var interviewDate = data[i][COLS.ROUNDS.INTERVIEW_DATE - 1];
    var expected = data[i][COLS.ROUNDS.EXPECTED_RESPONSE - 1];
    var notes = String(data[i][COLS.ROUNDS.NOTES - 1] || '');
    if (!roundId) continue;

    if (jobId && !jobIds[jobId]) {
      appendNoteFlag(sheet, row, COLS.ROUNDS.NOTES, '[orphaned-job] Linked Job no longer exists');
      flagged++;
    } else {
      clearNoteFlag(sheet, row, COLS.ROUNDS.NOTES, '[orphaned-job]');
    }

    // v7.7.4: [missing-prep]/[stale-round] must clear whenever their
    // setting condition (status==='Scheduled' && interviewDate && ...) is
    // no longer true, for ANY reason — including the round moving off
    // Scheduled entirely (e.g. Reschedule) while domain readiness still
    // isn't set. The previous `if (domain)` guard on the missing-prep
    // clear left it stuck in exactly that case.
    var isScheduledWithDate = status === 'Scheduled' && !!interviewDate;
    var daysUntil = isScheduledWithDate ? daysBetween(todayDate, new Date(interviewDate)) : null;
    if (isScheduledWithDate && !domain && daysUntil >= 0 && daysUntil <= 5) {
      appendNoteFlag(sheet, row, COLS.ROUNDS.NOTES, '[missing-prep] Domain readiness not set - prep may be missing');
      flagged++;
    } else {
      clearNoteFlag(sheet, row, COLS.ROUNDS.NOTES, '[missing-prep]');
    }
    if (isScheduledWithDate && daysUntil < 0) {
      appendNoteFlag(sheet, row, COLS.ROUNDS.NOTES, '[stale-round] Interview date has passed but Status is still Scheduled');
      flagged++;
    } else {
      clearNoteFlag(sheet, row, COLS.ROUNDS.NOTES, '[stale-round]');
    }

    if (status === 'Completed' && (!outcome || outcome === 'Waiting') && expected && new Date(expected) < todayDate) {
      appendNoteFlag(sheet, row, COLS.ROUNDS.NOTES, '[overdue-outcome] Expected response date has passed');
      flagged++;
    } else {
      clearNoteFlag(sheet, row, COLS.ROUNDS.NOTES, '[overdue-outcome]');
    }

    if (status === 'Completed' && notes.indexOf('[interview-debrief]') === -1) {
      appendNoteFlag(sheet, row, COLS.ROUNDS.NOTES, '[missing-debrief] Add substantive debrief notes');
      flagged++;
    } else {
      clearNoteFlag(sheet, row, COLS.ROUNDS.NOTES, '[missing-debrief]');
    }
  }
  return flagged;
}

function showInterviewsTab() {
  var s = getSheet('Interviews');
  if (s && s.isSheetHidden()) s.showSheet();
}

// =============================================================
// EDIT DISPATCH — simple trigger (onEdit) + installable trigger
// (handleEdit) both route through routeEditEvent(e), with a short-lived
// dedup guard so the same physical edit is never processed twice if
// both trigger types are registered on the workbook at once.
//
// v7.1: Home and Today open modal dialogs (HtmlService.showModalDialog)
// and UI alerts from their edit handlers. Simple triggers run with
// restricted authorization and can silently fail to open dialogs in
// some Google account / workspace configurations. installEditTrigger()
// creates an installable trigger bound to handleEdit(e), which runs
// with the script's full authorization and does not have this
// limitation. Both onEdit(e) and handleEdit(e) call the same
// routeEditEvent(e) so behavior is identical either way; the dedup
// guard (via CacheService) prevents a double-fire if a workbook ends up
// with both a simple trigger AND the installable trigger active.
// =============================================================

function editEventDedupKey(e) {
  try {
    var sheet = e.range.getSheet().getName();
    var a1 = e.range.getA1Notation();
    var val = String(e.value !== undefined ? e.value : '');
    // Bucket to the nearest 2-second window — the two trigger types fire
    // for the same user action within milliseconds of each other, so a
    // short bucket is enough to catch true duplicates without risking
    // collisions between genuinely separate edits.
    var bucket = Math.floor(Date.now() / 2000);
    return 'editdedup:' + sheet + ':' + a1 + ':' + val + ':' + bucket;
  } catch (err) {
    return '';
  }
}

function shouldProcessEditEvent(e) {
  var key = editEventDedupKey(e);
  if (!key) return true; // can't build a key — fail open rather than silently drop edits
  try {
    var cache = CacheService.getScriptCache();
    if (cache.get(key)) return false;
    cache.put(key, '1', 5);
    return true;
  } catch (err) {
    return true; // CacheService unavailable under this trigger's authorization — fail open
  }
}

function editMayNeedUi(e) {
  if (!e || !e.range) return false;
  var sheet = e.range.getSheet();
  var name = sheet.getName();
  var row = e.range.getRow();
  var col = e.range.getColumn();
  if (name === 'Home') return true;
  // v7.4 §1.6: endOfDayReconcile() calls ui.alert(...) in a loop — needs
  // the installable trigger, not the simple one, same as Home's popups.
  if (name === 'Today' && row === TODAY_ENDOFDAY_ROW && col === TODAY_ENDOFDAY_COL) return true;
  if (name === 'Organisations' && col === COLS.ORGS.NAME) return true;
  if (name === 'Jobs' && (col === COLS.JOBS.OPPORTUNITY || col === COLS.JOBS.ORG)) return true;
  if (name === 'People' && (col === COLS.PEOPLE.NAME || col === COLS.PEOPLE.ORG)) return true;
  return false;
}

// v7.6 §7.2: dispatch for exactly one edited cell — the body every
// single-cell edit already ran through. Pulled out so routeEditEvent can
// call it once per cell in a multi-cell edit (see below) instead of only
// ever seeing the top-left cell of the pasted/filled range.
function dispatchCellEdit(sheet, row, col, value, e) {
  var name = sheet.getName();
  withDocumentLock(function () {
    if (name === 'Home') { onEditHome(sheet, row, col, value); return; }
    if (row <= 1) return;
    switch (name) {
      case 'Organisations': onEditOrgs(sheet, row, col, value, e); break;
      case 'Sectors': onEditSectors(sheet, row, col, value, e); break;
      case 'Jobs': onEditJobs(sheet, row, col, value, e); break;
      case 'People': onEditPeople(sheet, row, col, value, e); break;
      case 'Conversations': onEditInteractions(sheet, row, col, value); break;
      case 'Interviews': onEditRounds(sheet, row, col, value); break;
      case 'Tasks': onEditTasks(sheet, row, col, value); break;
      case 'Today': onEditToday(sheet, row, col, value); break;
      case 'Decisions': onEditDecisions(sheet, row, col, value, e); break;
    }
  }, { label: 'edit:' + name + ' r' + row + 'c' + col });
}

var EDIT_BATCH_CONTEXT = null;

function routeEditEvent(e, triggerMode) {
  if (!e || !e.range) return;
  if (triggerMode === 'simple' && editMayNeedUi(e)) return;
  if (!shouldProcessEditEvent(e)) return;
  var range = e.range;
  var sheet = range.getSheet();
  var numRows = range.getNumRows();
  var numCols = range.getNumColumns();
  if (numRows === 1 && numCols === 1) {
    dispatchCellEdit(sheet, range.getRow(), range.getColumn(), range.getValue(), e);
    return;
  }
  // A paste or fill-drag spanning more than one cell: e.range.getRow()/
  // getColumn()/getValue() collapse to the top-left cell only, so every
  // other cell in the range would otherwise get its new value with zero
  // cascade — no commitment-class recalc, no Today sync, no completion
  // routing. Loop per affected cell instead of detecting-and-blocking
  // bulk edits, which would fight the legitimate bulk-editing workflow
  // this matters for most (e.g. bulk-skipping a stale backlog on Tasks).
  // e.oldValue isn't populated for multi-cell edits either way, so any
  // handler logic keyed on it (e.g. Jobs/People status-change cascades,
  // Decisions' already-resolved check) simply doesn't fire per-cell here
  // — same as it already doesn't for any other multi-cell paste today.
  var startRow = range.getRow();
  var startCol = range.getColumn();
  var values = range.getValues();
  var isTaskStatusBulk = sheet.getName() === 'Tasks' && startCol === COLS.TODO.STATUS && numCols === 1;
  var priorBatchContext = EDIT_BATCH_CONTEXT;
  if (isTaskStatusBulk) {
    EDIT_BATCH_CONTEXT = { deferTaskRefresh: true, needsDecisionRender: false, needsHomeRefresh: false };
  }
  try {
    for (var r = 0; r < numRows; r++) {
      for (var c = 0; c < numCols; c++) {
        dispatchCellEdit(sheet, startRow + r, startCol + c, values[r][c], null);
      }
    }
  } finally {
    var batchContext = EDIT_BATCH_CONTEXT;
    EDIT_BATCH_CONTEXT = priorBatchContext;
    // Keep the per-row cascades, but collapse expensive Home/Today card
    // refreshes for the common Tasks Status bulk-edit workflow.
    if (isTaskStatusBulk && batchContext) {
      if (batchContext.needsDecisionRender) renderTodayDecisionCards();
      if (batchContext.needsHomeRefresh) refreshHome();
    }
  }
}

// Simple trigger — always present, zero install step. Handles everything
// that doesn't need a modal dialog reliably; for onboarding/capture
// popups specifically, install the installable trigger below.
function onEdit(e) {
  routeEditEvent(e, 'simple');
}

// Installable trigger target. Same routing as onEdit — see
// ensureTriggersInstalled() / setUpTriggers() to attach this with full
// authorization.
function handleEdit(e) {
  routeEditEvent(e, 'installable');
}

// =============================================================
// TRIGGER MANAGEMENT — one idempotent, check-before-create engine
// -------------------------------------------------------------
// v7.3: all trigger wiring now flows through ensureTriggersInstalled(),
// which is idempotent (checks for an existing trigger before creating
// one) and reports what it did. It is called from:
//   - setUpTriggers()  — the explicit menu action
//   - repairAllTabs() and fullRefresh() — so every manual Maintenance run
//     forces an installation check (the fix for silent onboarding-popup
//     failures: the installable edit trigger can never quietly go missing
//     across a Maintenance run)
// It CANNOT be called from onOpen()/onEdit() simple triggers — those run
// in a restricted auth context that is not allowed to create installable
// triggers. onOpen() therefore only *detects and reports* status; the
// user runs one menu item to actually attach it. This is an Apps Script
// platform constraint, not a design choice.
//
// The canonical trigger set this project expects:
//   handleEdit       ON_EDIT  (installable) — reliable modal popups
//   dailyMaintenance CLOCK     daily  ~08:15
//   middayNudge      CLOCK     daily  ~16:00
//   weeklyReview     CLOCK     Sunday ~21:00
// =============================================================

// The one place the expected time-trigger schedule is declared, so the
// installer and the status report can never drift apart.
var EDIT_TRIGGER_HANDLER = 'handleEdit';
var TIME_TRIGGER_SPECS = [
  { handler: 'dailyMaintenance', desc: 'daily ~08:15',
    build: function (tz) { return ScriptApp.newTrigger('dailyMaintenance').timeBased().atHour(8).nearMinute(15).everyDays(1).inTimezone(tz); } },
  { handler: 'middayNudge', desc: 'daily ~16:00',
    build: function (tz) { return ScriptApp.newTrigger('middayNudge').timeBased().atHour(16).nearMinute(0).everyDays(1).inTimezone(tz); } },
  { handler: 'weeklyReview', desc: 'Sunday ~21:00',
    build: function (tz) { return ScriptApp.newTrigger('weeklyReview').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(21).nearMinute(0).inTimezone(tz); } }
];

// Primitive: does an installable trigger for this handler + event type
// already exist? (Simple onEdit(e)/onOpen(e) are NOT project triggers and
// never show up here, so they can't be confused with the installable one.)
function triggerExists(handlerName, eventType) {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === handlerName &&
        (!eventType || triggers[i].getEventType() === eventType)) {
      return true;
    }
  }
  return false;
}

// Primitive: delete every installable trigger for a handler (+ optional
// event type). Returns how many were removed. Used to de-dupe before a
// fresh create and by the uninstall actions.
function deleteTriggersFor(handlerName, eventType) {
  var triggers = ScriptApp.getProjectTriggers();
  var removed = 0;
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === handlerName &&
        (!eventType || triggers[i].getEventType() === eventType)) {
      ScriptApp.deleteTrigger(triggers[i]);
      removed++;
    }
  }
  return removed;
}

// Idempotent installer. Only creates a trigger that is missing; leaves
// existing ones untouched unless opts.force collapses duplicates first.
// Returns a status object describing the end state and what changed.
//   opts.force  — delete-then-recreate every trigger (guarantees exactly
//                 one of each, clears any stacked duplicates)
//   opts.silent — suppress the toast (used when called from a larger run)
function ensureTriggersInstalled(opts) {
  opts = opts || {};
  var tz = plannerTimeZone();
  var report = { editCreated: false, editAlready: false, timeCreated: [], timeAlready: [], forced: !!opts.force };

  // --- Edit trigger (installable handleEdit) ---
  if (opts.force) deleteTriggersFor(EDIT_TRIGGER_HANDLER, ScriptApp.EventType.ON_EDIT);
  if (triggerExists(EDIT_TRIGGER_HANDLER, ScriptApp.EventType.ON_EDIT)) {
    report.editAlready = true;
  } else {
    ScriptApp.newTrigger(EDIT_TRIGGER_HANDLER)
      .forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet()).onEdit().create();
    report.editCreated = true;
  }

  // --- Time triggers ---
  TIME_TRIGGER_SPECS.forEach(function (spec) {
    if (opts.force) deleteTriggersFor(spec.handler, ScriptApp.EventType.CLOCK);
    if (triggerExists(spec.handler, ScriptApp.EventType.CLOCK)) {
      report.timeAlready.push(spec.handler);
    } else {
      spec.build(tz).create();
      report.timeCreated.push(spec.handler);
    }
  });

  if (!opts.silent) {
    var parts = [];
    parts.push(report.editCreated ? 'edit trigger attached' : 'edit trigger already present');
    if (report.timeCreated.length) parts.push('time triggers created: ' + report.timeCreated.join(', '));
    if (report.timeAlready.length && !report.timeCreated.length) parts.push('time triggers already present');
    SpreadsheetApp.getActiveSpreadsheet().toast(
      'Triggers checked (' + tz + '). ' + parts.join('; ') + '.', 'The Planner', 6);
  }
  return report;
}

// Menu action: the explicit, user-driven setup. Forces a clean reinstall
// so the user gets a guaranteed-correct trigger set in one click, then
// shows the status so they can verify it took.
function setUpTriggers() {
  ensureTriggersInstalled({ force: true, silent: true });
  showTriggerStatus();
}

// Menu action: read-only status report so the user can verify wiring
// WITHOUT relying on silent auto-wiring. Uses an alert (not a toast) so it
// stays on screen.
function showTriggerStatus() {
  var editOn = triggerExists(EDIT_TRIGGER_HANDLER, ScriptApp.EventType.ON_EDIT);
  var lines = [];
  lines.push('Edit popups (installable handleEdit): ' + (editOn ? '\u2705 attached' : '\u274c NOT attached'));
  if (!editOn) lines.push('   \u2192 Run "Triggers & setup \u2192 Set up / verify triggers" to fix onboarding & Add/update popups.');
  lines.push('');
  lines.push('Scheduled jobs:');
  TIME_TRIGGER_SPECS.forEach(function (spec) {
    var on = triggerExists(spec.handler, ScriptApp.EventType.CLOCK);
    lines.push('   ' + (on ? '\u2705' : '\u274c') + ' ' + spec.handler + ' (' + spec.desc + ')');
  });
  lines.push('');
  lines.push('Timezone: ' + plannerTimeZone());
  lines.push('Note: the always-on simple onEdit/onOpen triggers need no setup;');
  lines.push('only the installable ones above require this one-time attach.');
  SpreadsheetApp.getUi().alert('The Planner \u2014 trigger status', lines.join('\n'), SpreadsheetApp.getUi().ButtonSet.OK);
}

// Back-compat shims: older menu wiring / muscle memory called these names.
// They now route through the unified engine.
function installEditTrigger() {
  ensureTriggersInstalled({ force: true });
}

function uninstallEditTrigger() {
  var removed = deleteTriggersFor(EDIT_TRIGGER_HANDLER, ScriptApp.EventType.ON_EDIT);
  SpreadsheetApp.getActiveSpreadsheet().toast('Removed ' + removed + ' installable edit trigger(s). The simple onEdit(e) trigger still runs.', 'The Planner', 5);
}

function onEditTasks(sheet, row, col, newVal) {
  if (col === COLS.TODO.STATUS || col === COLS.TODO.DUE_DATE || col === COLS.TODO.TIME_EST) sheet.getRange(row, COLS.TODO.LAST_EDITED).setValue(today());
  if (col === COLS.TODO.STATUS || col === COLS.TODO.DUE_DATE) {
    sheet.getRange(row, COLS.TODO.COMMITMENT_CLASS).setValue(assignCommitmentClass(
      String(sheet.getRange(row, COLS.TODO.WORKFLOW).getValue()), sheet.getRange(row, COLS.TODO.DUE_DATE).getValue(),
      String(sheet.getRange(row, COLS.TODO.OBJ_ID).getValue()), String(sheet.getRange(row, COLS.TODO.OBJ_TYPE).getValue())));
    sheet.getRange(row, COLS.TODO.CLASS_CALC_AT).setValue(today());
  }
  if (col === COLS.TODO.TIME_EST) syncTodayEstMinForTodo(sheet, row);
  if (col !== COLS.TODO.STATUS) return;
  completeTodoRow(sheet, row, newVal, { source: 'tasks' });
}

// =============================================================
// TODAY — the daily operating surface
// =============================================================

// v7.4: value cells moved off column B — they used to share a cell with
// their own label (same bug pattern as the old B3 update-type cell: the
// label write was always clobbered by the value write two lines later,
// so "Priority / focus"/"Available minutes"/"Energy" never actually
// rendered). Column D matches the label/value split row 7 already uses
// (B7 label, D7 value).
var TODAY_CELLS = {
  PRIORITY: 'D4', AVAILABLE_MIN: 'D5', ENERGY: 'D6'
};
var TODAY_TABLE_HEADER_ROW = 10;
var TODAY_TABLE_FIRST_ROW = 11;
var TODAY_TABLE_LAST_ROW = 40;

// v7.4: sections below the Commit/Options table — "Needs breakdown"
// (Multi-day Phase 1), "Progress" (replaces the capacity-fit formula +
// done counter), and "End of day" (relocated from a menu-only action).
var TODAY_NEEDS_BREAKDOWN_HEADER_ROW = 42;
var TODAY_NEEDS_BREAKDOWN_FIRST_ROW = 43;
var TODAY_NEEDS_BREAKDOWN_LAST_ROW = 47;   // 5 rows max

var TODAY_PROGRESS_HEADER_ROW = 49;
var TODAY_PROGRESS_LINE1_ROW = 50;
var TODAY_PROGRESS_LINE2_ROW = 51;

var TODAY_ENDOFDAY_HEADER_ROW = 53;
var TODAY_ENDOFDAY_ROW = 54;
var TODAY_ENDOFDAY_COL = 2;

// Multi-day tasks flagged [needs breakdown] after this many days
// untouched (see runQueueHygiene) — same idiom as the other staleness
// thresholds there, picked to sit between the "HOT" (>3d) and "stale
// active pursuit" (>=10d) thresholds since an un-broken-down Multi-day
// task is invisible to Today the whole time, not just occasionally.
var MULTIDAY_NEEDS_BREAKDOWN_DAYS = 5;

function parseTimeEst(timeStr) {
  if (!timeStr) return 30;
  var str = String(timeStr);
  if (str === 'Multi-day') return null;
  var match = str.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 30;
}

function ensureTodaySheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = getSheet('Today');
  if (!sheet) sheet = ss.insertSheet('Today');
  return sheet;
}

function bootstrapToday() {
  var sheet = ensureTodaySheet();
  sheet.clear();
  sheet.setTabColor(ZONE_WORK_COLOR);

  sheet.getRange('A1:I1').merge().setValue('Today').setFontSize(16).setFontWeight('bold').setFontColor('#FFFFFF').setBackground(HEADER_COLOR);

  // Row 2: friendly plan-built date. Stays a real Date value (formatted,
  // not stringified) so collectPreviousTodayState's same-day check still
  // works unchanged — only the display format changes.
  sheet.getRange('B2:I2').merge().setNumberFormat('dddd d MMMM').setFontColor('#5F625E');

  // Row 3: plan-summary headline — populateTodayImpl fills in the real
  // counts once stagedTodaySelection has run; this just lays out the cell.
  sheet.getRange('B3:I3').merge().setFontWeight('bold').setFontColor('#1B474D').setWrap(true);

  sheet.getRange('B4').setValue('Focus').setFontWeight('bold');
  sheet.getRange(TODAY_CELLS.PRIORITY).setValue('Default');
  setDropdown(sheet.getRange(TODAY_CELLS.PRIORITY), DROPDOWNS.TODAY_PRIORITY);

  sheet.getRange('B5').setValue('Available minutes').setFontWeight('bold');
  sheet.getRange(TODAY_CELLS.AVAILABLE_MIN).setValue(90).setNumberFormat('0');

  sheet.getRange('B6').setValue('Energy').setFontWeight('bold');
  sheet.getRange(TODAY_CELLS.ENERGY).setValue('Normal');
  setDropdown(sheet.getRange(TODAY_CELLS.ENERGY), DROPDOWNS.TODAY_ENERGY);

  sheet.getRange(TODAY_TABLE_HEADER_ROW, 1, 1, HEADERS["Today's plan"].length).setValues([HEADERS["Today's plan"]]).setFontWeight('bold').setBackground('#DDEEEF');
  setDropdown(sheet.getRange(TODAY_TABLE_FIRST_ROW, COLS.TODAY.STATUS, 30, 1), DROPDOWNS.TODAY_STATUS);
  sheet.getRange(TODAY_TABLE_FIRST_ROW, COLS.TODAY.EST_MIN, 30, 1).setNumberFormat('0');
  sheet.getRange(TODAY_TABLE_FIRST_ROW, COLS.TODAY.ACTUAL_MIN, 30, 1).setNumberFormat('0');
  sheet.getRange(TODAY_TABLE_FIRST_ROW, COLS.TODAY.TASK, 30, 1).setWrap(true);
  sheet.getRange(TODAY_TABLE_FIRST_ROW, COLS.TODAY.NOTES, 30, 1).setWrap(true);
  sheet.setFrozenRows(TODAY_TABLE_HEADER_ROW);

  sheet.getRange(TODAY_NEEDS_BREAKDOWN_HEADER_ROW, 2, 1, 7).merge().setValue('Needs breakdown').setFontWeight('bold').setFontColor('#FFFFFF').setBackground(HEADER_COLOR);

  sheet.getRange(TODAY_PROGRESS_HEADER_ROW, 2, 1, 7).merge().setValue('Progress').setFontWeight('bold').setFontColor('#FFFFFF').setBackground(HEADER_COLOR);

  sheet.getRange(TODAY_ENDOFDAY_HEADER_ROW, 2, 1, 7).merge().setValue('End of day').setFontWeight('bold').setFontColor('#FFFFFF').setBackground(HEADER_COLOR);
  sheet.getRange(TODAY_ENDOFDAY_ROW, TODAY_ENDOFDAY_COL).setValue(false).insertCheckboxes().setBackground(MANUAL_COLOR);
  sheet.getRange(TODAY_ENDOFDAY_ROW, TODAY_ENDOFDAY_COL + 1, 1, 6).merge()
    .setValue('Wrap up unfinished tasks').setFontWeight('bold').setFontColor('#01696F').setBackground('#EAF4F5');

  applyTodayTableHeaderStyle();
}

// -------------------------------------------------------------
// STAGED PRIORITY WATERFALL (explicit — not a hidden composite score)
// Order per spec:
//   1. Keep manually pulled-in tasks
//   2. Keep tasks already in progress / already touched today
//   3. Pull fixed / date-bound work
//   4. Pull blocking work
//   5. Pull due / overdue keep-alive work
//   6. Add active-pursuit work matching focus
//   7. Add at most one pipeline-building task, if capacity remains
//   8. Keep a time buffer — don't fill every last minute
//   9. Put near-misses in Options
//  10. Everything else stays hidden in Tasks
//
// v7.1: user-owned Today notes are now preserved across refreshes. See
// splitTodayNotes / composeTodayNotes below — collectPreviousTodayState
// captures any leading bracket tags (e.g. [pulled], [locked]) and any
// user-authored text separately from the system "Why:" reason, and
// writeTodayRow re-composes them instead of overwriting wholesale.
// -------------------------------------------------------------

// Splits a Today Notes cell into { tags, userNote }. `tags` is any
// leading run of bracketed markers like "[pulled] [locked] ". Anything
// after those tags is either the system "Why: ..." reason (discarded —
// it gets regenerated fresh on every refresh) or, if it doesn't start
// with "Why:", is treated as entirely user-authored and preserved. If
// it DOES start with "Why:" but the user has appended their own text
// after a " | " separator, that suffix is preserved as userNote too.
function splitTodayNotes(notes) {
  var raw = String(notes || '');
  var tagMatch = raw.match(/^((?:\[[^\]]+\]\s*)+)/);
  var tags = tagMatch ? tagMatch[1].trim() : '';
  var rest = tagMatch ? raw.slice(tagMatch[1].length) : raw;
  rest = rest.trim();
  var userNote = '';
  if (/^Why:/i.test(rest)) {
    var pipeIdx = rest.indexOf(' | ');
    if (pipeIdx !== -1) userNote = rest.slice(pipeIdx + 3).trim();
  } else if (rest) {
    userNote = rest; // no system "Why:" prefix at all — this is entirely user content
  }
  return { tags: tags, userNote: userNote };
}

// v7.4: no longer embeds the system "Why: <reason>" explanation — that
// now lives in the cell's note (see writeTodayRow) so the visible value
// is just tags + the user's own text. splitTodayNotes still strips a
// leading "Why: ..." if one is found (old rows self-heal to the new
// format on their first refresh after deploy — no migration needed).
function composeTodayNotes(tags, userNote) {
  var out = tags ? tags + ' ' : '';
  out += userNote || '';
  return out.trim();
}

function collectPreviousTodayState(sheet) {
  var state = { sameDay: false, ordered: [], byTodoId: {} };
  var existingDate = sheet.getRange('B2').getValue();
  if (existingDate) {
    var d = new Date(existingDate); d.setHours(0, 0, 0, 0);
    state.sameDay = d.getTime() === today().getTime();
  }
  if (!state.sameDay) return state;
  for (var r = TODAY_TABLE_FIRST_ROW; r <= TODAY_TABLE_LAST_ROW; r++) {
    var task = String(sheet.getRange(r, COLS.TODAY.TASK).getValue() || '');
    var todoId = String(sheet.getRange(r, COLS.TODAY.TODO_ID).getValue() || '');
    if (!task && !todoId) continue;
    var notes = String(sheet.getRange(r, COLS.TODAY.NOTES).getValue() || '');
    var split = splitTodayNotes(notes);
    var rowState = {
      task: task, todoId: todoId,
      estMin: sheet.getRange(r, COLS.TODAY.EST_MIN).getValue(),
      cls: String(sheet.getRange(r, COLS.TODAY.CLASS).getValue() || ''),
      effort: String(sheet.getRange(r, COLS.TODAY.EFFORT).getValue() || ''),
      status: String(sheet.getRange(r, COLS.TODAY.STATUS).getValue() || ''),
      actualMin: sheet.getRange(r, COLS.TODAY.ACTUAL_MIN).getValue(),
      notes: notes,
      tags: split.tags,
      userNote: split.userNote,
      pulled: /\[pulled\]/.test(split.tags),
      locked: /\[locked\]/.test(split.tags)
    };
    state.ordered.push(rowState);
    if (todoId) state.byTodoId[todoId] = rowState;
  }
  return state;
}

// Full candidate pool: every open Task (Not started / In progress) with
// a real time estimate, plus the metadata the waterfall stages need.
// v7.4 §2.1: single bulk read of Organisations/Jobs/People, built once per
// populateToday() call, so each pooled task resolves its org's Tier via
// lookup instead of a per-task sheet call. Tier only ever breaks ties
// between tasks that already landed in the same stage/class — it never
// changes what commitment class a task gets.
function buildOrgTierLookup() {
  var tierByOrgId = {};
  var orgsSheet = getSheet('Organisations');
  if (orgsSheet && orgsSheet.getLastRow() > 1) {
    orgsSheet.getRange(2, 1, orgsSheet.getLastRow() - 1, COLS.ORGS.TIER).getValues().forEach(function (r) {
      tierByOrgId[String(r[COLS.ORGS.ID - 1])] = String(r[COLS.ORGS.TIER - 1] || '');
    });
  }
  var orgIdByJobId = {};
  var jobsSheet = getSheet('Jobs');
  if (jobsSheet && jobsSheet.getLastRow() > 1) {
    jobsSheet.getRange(2, 1, jobsSheet.getLastRow() - 1, COLS.JOBS.ORG_ID).getValues().forEach(function (r) {
      orgIdByJobId[String(r[COLS.JOBS.ID - 1])] = String(r[COLS.JOBS.ORG_ID - 1] || '');
    });
  }
  var orgIdByPersonId = {};
  var peopleSheet = getSheet('People');
  if (peopleSheet && peopleSheet.getLastRow() > 1) {
    peopleSheet.getRange(2, 1, peopleSheet.getLastRow() - 1, COLS.PEOPLE.ORG_ID).getValues().forEach(function (r) {
      orgIdByPersonId[String(r[COLS.PEOPLE.ID - 1])] = String(r[COLS.PEOPLE.ORG_ID - 1] || '');
    });
  }
  return {
    tierFor: function (objType, objId) {
      var orgId = '';
      if (objType === 'Organisation') orgId = String(objId || '');
      else if (objType === 'Job') orgId = orgIdByJobId[String(objId || '')] || '';
      else if (objType === 'Person') orgId = orgIdByPersonId[String(objId || '')] || '';
      var tier = tierByOrgId[orgId] || '';
      // No resolvable org/tier sorts after every real tier (A/B/C).
      return DROPDOWNS.ORG_TIER.indexOf(tier) !== -1 ? tier : 'D';
    }
  };
}

function compareTier(a, b) {
  return a.tier < b.tier ? -1 : (a.tier > b.tier ? 1 : 0);
}

function collectTaskPool(focus, tierLookup) {
  var todoSheet = getSheet('Tasks');
  if (!todoSheet || todoSheet.getLastRow() < 2) return [];
  var data = todoSheet.getRange(2, 1, todoSheet.getLastRow() - 1, COLS.TODO.EFFORT_TYPE).getValues();
  var todayDate = today();
  var pool = [];
  for (var i = 0; i < data.length; i++) {
    var status = String(data[i][COLS.TODO.STATUS - 1]);
    if (status !== 'Not started' && status !== 'In progress') continue;
    var task = String(data[i][COLS.TODO.TASK - 1] || '');
    if (!task) continue;
    var estMin = parseTimeEst(String(data[i][COLS.TODO.TIME_EST - 1] || '30 min'));
    if (estMin === null) continue; // Multi-day — never enters Today; needs breakdown first
    var cls = String(data[i][COLS.TODO.COMMITMENT_CLASS - 1]);
    var dueDate = data[i][COLS.TODO.DUE_DATE - 1];
    var workflow = String(data[i][COLS.TODO.WORKFLOW - 1] || '');
    var objType = String(data[i][COLS.TODO.OBJ_TYPE - 1] || '');
    var objId = String(data[i][COLS.TODO.OBJ_ID - 1] || '');
    var isDue = !dueDate || new Date(dueDate) <= todayDate;
    if (cls === 'Keep-alive' && !isDue) continue; // not due yet — stays hidden in Tasks

    pool.push({
      todoId: String(data[i][COLS.TODO.ID - 1]),
      task: task, org: String(data[i][COLS.TODO.ORG - 1] || ''), objId: objId,
      workflow: workflow, objType: objType,
      cls: cls, dueDate: dueDate, estMin: estMin,
      effort: String(data[i][COLS.TODO.EFFORT_TYPE - 1] || ''),
      source: String(data[i][COLS.TODO.SOURCE - 1] || ''),
      created: data[i][COLS.TODO.CREATED - 1],
      focusMatch: taskMatchesFocus(workflow, objType, focus),
      tier: tierLookup ? tierLookup.tierFor(objType, objId) : 'D'
    });
  }
  return pool;
}

function taskMatchesFocus(workflow, objType, focus) {
  if (!focus || focus === 'Default') return true;
  if (focus === 'Applications') return ['Application preparation', 'Submit application', 'Check application response', 'Offer decision'].indexOf(workflow) !== -1;
  if (focus === 'Networking') return objType === 'Person';
  if (focus === 'Interviews') return objType === 'Interview round' || /Interview/.test(workflow);
  if (focus === 'Pipeline building') return ['Market mapping', 'Org job scan', 'People sourcing', 'Sector selection', 'Org research'].indexOf(workflow) !== -1;
  if (focus === 'Admin / light day') return workflow === 'Admin';
  return true;
}

// v7.4 §2.5: honest "Fixed" labeling — a genuinely immovable task
// (Day-before review) keeps the plain label; a task that's only Fixed
// because a date threshold tripped (assignCommitmentClass) says so.
function reasonForStage(stageLabel, item) {
  var dueBit = '';
  if (item && item.dueDate) {
    var d = daysBetween(today(), new Date(item.dueDate));
    dueBit = d < 0 ? 'overdue' : (d === 0 ? 'due today' : 'due in ' + d + 'd');
  }
  if (stageLabel === 'Fixed' && item && item.workflow && item.workflow !== 'Day-before review') {
    var subject = item.workflow === 'Interview scheduling' ? 'interview' : 'application';
    return 'Fixed (auto: ' + subject + (dueBit ? ' ' + dueBit.replace(/^due /, '') : '') + ')';
  }
  var bits = [stageLabel];
  if (dueBit) bits.push(dueBit);
  return bits.join(' — ');
}

// The staged selector itself. Returns { commit: [...], options: [...] }.
// Shared tie-break comparator: (dueDate asc, tier asc, createdDate asc).
// When energyLow is true, Deep-effort candidates sink to the bottom
// first (§5) — a soft bias, applied only in the stages that opt in.
function compareForStage(energyLow) {
  return function (a, b) {
    if (energyLow) {
      var aDeep = a.effort === 'Deep', bDeep = b.effort === 'Deep';
      if (aDeep !== bDeep) return aDeep ? 1 : -1;
    }
    var ad = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
    var bd = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
    if (ad !== bd) return ad - bd;
    if (a.tier !== b.tier) return compareTier(a, b);
    var ac = a.created ? new Date(a.created).getTime() : 0;
    var bc = b.created ? new Date(b.created).getTime() : 0;
    return ac - bc;
  };
}

// The staged selector itself. Returns { commit: [...], options: [...] }.
function stagedTodaySelection(previousState, availableMinutes, focus, energy) {
  var tierLookup = buildOrgTierLookup();
  var pool = collectTaskPool(focus, tierLookup);
  var byId = {};
  pool.forEach(function (p) { byId[p.todoId] = p; });
  var energyLow = energy === 'Low';

  var commit = [];
  var options = [];
  var usedIds = {};
  var bufferMin = Math.max(15, Math.round(availableMinutes * 0.1));
  var capacity = Math.max(0, availableMinutes - bufferMin);
  var minutesUsed = 0;

  function preserved(todoId) {
    var rs = previousState.byTodoId[todoId];
    return rs ? { tags: rs.tags, userNote: rs.userNote } : { tags: '', userNote: '' };
  }

  function addCommit(item, reason) {
    if (usedIds[item.todoId]) return;
    usedIds[item.todoId] = true;
    var p = preserved(item.todoId);
    commit.push({ todoId: item.todoId, task: item.task, estMin: item.estMin, effort: item.effort, reason: reason, tags: p.tags, userNote: p.userNote });
    minutesUsed += item.estMin || 0;
  }

  // Stage 1 — manually pulled-in tasks (locked or explicitly pulled)
  previousState.ordered.forEach(function (rs) {
    if (!rs.todoId || !(rs.locked || rs.pulled)) return;
    var candidate = byId[rs.todoId] || { todoId: rs.todoId, task: rs.task, estMin: rs.estMin, effort: rs.effort };
    addCommit(candidate, rs.locked ? 'locked in place' : 'manually pulled into Today');
  });

  // Stage 2 — tasks already in progress or already touched today (incl.
  // Done/Skipped/Cancelled today, so the day's record doesn't vanish on refresh)
  previousState.ordered.forEach(function (rs) {
    if (!rs.todoId || usedIds[rs.todoId]) return;
    var touchedToday = rs.status === 'In progress' || rs.status === 'Done' || rs.status === 'Skipped' || rs.status === 'Cancelled';
    if (!touchedToday) return;
    var candidate = byId[rs.todoId] || { todoId: rs.todoId, task: rs.task, estMin: rs.estMin, effort: rs.effort };
    usedIds[rs.todoId] = true;
    commit.push({
      todoId: rs.todoId, task: rs.task, estMin: rs.estMin, effort: rs.effort,
      reason: rs.status === 'In progress' ? 'already in progress today' : 'already ' + rs.status.toLowerCase() + ' today',
      preserveStatus: rs.status, preserveActual: rs.actualMin,
      tags: rs.tags, userNote: rs.userNote
    });
    if (rs.status === 'In progress') minutesUsed += rs.estMin || 0;
  });

  // Stage 3 — Fixed work. Always included: these are real deadlines,
  // not subject to the capacity buffer.
  pool.filter(function (p) { return p.cls === 'Fixed' && !usedIds[p.todoId]; })
    .forEach(function (p) { addCommit(p, reasonForStage('Fixed', p)); });

  // Stage 4 — Blocking work. Same treatment as Fixed: always included.
  // §2.1: now sorted (dueDate asc, tier asc, createdDate asc) — no
  // energy bias here, Blocking work isn't optional regardless of energy.
  pool.filter(function (p) { return p.cls === 'Blocking' && !usedIds[p.todoId]; })
    .sort(compareForStage(false))
    .forEach(function (p) { addCommit(p, reasonForStage('Blocking', p)); });

  // Stage 5 — due/overdue Keep-alive work. Capacity-gated from here on.
  // §2.1: due date stays primary; Tier only breaks same-day ties.
  pool.filter(function (p) { return p.cls === 'Keep-alive' && !usedIds[p.todoId]; })
    .sort(function (a, b) {
      var ad = a.dueDate ? new Date(a.dueDate).getTime() : 0;
      var bd = b.dueDate ? new Date(b.dueDate).getTime() : 0;
      return ad !== bd ? ad - bd : compareTier(a, b);
    })
    .forEach(function (p) {
      if (minutesUsed + p.estMin <= capacity) addCommit(p, reasonForStage('Keep-alive due', p));
      else { var pv = preserved(p.todoId); options.push({ todoId: p.todoId, task: p.task, estMin: p.estMin, effort: p.effort, reason: 'keep-alive, ran out of capacity today', tags: pv.tags, userNote: pv.userNote }); }
      usedIds[p.todoId] = true;
    });

  // Stage 6 — Active pursuit matching focus. §2.1/§5: (dueDate, tier,
  // created) tie-break, with Low-energy sinking Deep-effort candidates.
  pool.filter(function (p) { return p.cls === 'Active pursuit' && !usedIds[p.todoId] && p.focusMatch; })
    .sort(compareForStage(energyLow))
    .forEach(function (p) {
      usedIds[p.todoId] = true;
      if (minutesUsed + p.estMin <= capacity) addCommit(p, reasonForStage('active pursuit' + (focus && focus !== 'Default' ? ', matches ' + focus + ' focus' : ''), p));
      else { var pv2 = preserved(p.todoId); options.push({ todoId: p.todoId, task: p.task, estMin: p.estMin, effort: p.effort, reason: 'active pursuit, near miss on capacity', tags: pv2.tags, userNote: pv2.userNote }); }
    });

  // Stage 7 — at most ONE pipeline-building task, only if capacity remains.
  // §2.2: Tier now comes before age (was pure FIFO) — same comparator as
  // Active pursuit, so a newly-important Tier-A item no longer waits
  // behind an older Tier-C one. §5: Low energy still sinks Deep-effort.
  var pipelineCandidates = pool.filter(function (p) { return p.cls === 'Pipeline-building' && !usedIds[p.todoId]; })
    .sort(compareForStage(energyLow));
  if (pipelineCandidates.length) {
    var chosen = pipelineCandidates[0];
    usedIds[chosen.todoId] = true;
    if (minutesUsed + chosen.estMin <= capacity) addCommit(chosen, 'pipeline-building — keeping the top of the funnel moving');
    else { var pv3 = preserved(chosen.todoId); options.push({ todoId: chosen.todoId, task: chosen.task, estMin: chosen.estMin, effort: chosen.effort, reason: 'pipeline-building, no capacity left today', tags: pv3.tags, userNote: pv3.userNote }); }
    pipelineCandidates.slice(1).forEach(function (p) { usedIds[p.todoId] = true; }); // stays hidden in Tasks — Stage 10
  }

  // Stage 8 — Focus fallback (§2.4): if capacity remains, pull Active
  // pursuit work that Focus excluded rather than leaving capacity idle.
  // Soft preference, not a hard filter — labeled distinctly so it reads
  // as a fill, not a focus match.
  pool.filter(function (p) { return p.cls === 'Active pursuit' && !usedIds[p.todoId]; })
    .sort(compareForStage(energyLow))
    .forEach(function (p) {
      usedIds[p.todoId] = true;
      if (minutesUsed + p.estMin <= capacity) addCommit(p, 'active pursuit — outside today\'s focus, capacity available');
      else { var pv5 = preserved(p.todoId); options.push({ todoId: p.todoId, task: p.task, estMin: p.estMin, effort: p.effort, reason: 'active pursuit, outside focus, near miss on capacity', tags: pv5.tags, userNote: pv5.userNote }); }
    });

  // Stage 9 — remaining near-misses (Backlog-tier or anything left over
  // that's close to fitting) go to Options, capped at 6.
  pool.forEach(function (p) {
    if (usedIds[p.todoId] || options.length >= 6) return;
    if (p.cls === 'Backlog') return; // Stage 10 — stays hidden in Tasks entirely
    var pv4 = preserved(p.todoId);
    options.push({ todoId: p.todoId, task: p.task, estMin: p.estMin, effort: p.effort, reason: 'not selected today — capacity or priority', tags: pv4.tags, userNote: pv4.userNote });
  });
  // Stage 10 — everything not in commit or options simply isn't written
  // to Today. It's still fully visible and workable from Tasks.

  return { commit: commit, options: options, minutesUsed: minutesUsed, bufferMin: bufferMin };
}

function populateToday() {
  // v7.3: guarded so the direct menu path ("Open / populate Today") is
  // serialised too. When called from an already-locked context (edits,
  // dailyMaintenance) the re-entrancy guard runs the body directly.
  return withDocumentLock(populateTodayImpl, { label: 'populateToday' });
}

function populateTodayImpl() {
  var sheet = ensureTodaySheet();
  if (sheet.getMaxRows() < TODAY_TABLE_LAST_ROW || !sheet.getRange(1, 1).getValue()) bootstrapToday();
  var previousState = collectPreviousTodayState(sheet);

  var availableMinutes = parseInt(sheet.getRange(TODAY_CELLS.AVAILABLE_MIN).getValue(), 10);
  if (isNaN(availableMinutes) || availableMinutes <= 0) availableMinutes = 90;
  var focus = String(sheet.getRange(TODAY_CELLS.PRIORITY).getValue() || 'Default');
  var energy = String(sheet.getRange(TODAY_CELLS.ENERGY).getValue() || 'Normal');

  var selection = stagedTodaySelection(previousState, availableMinutes, focus, energy);

  sheet.getRange('B2').setValue(today());
  sheet.getRange(TODAY_TABLE_FIRST_ROW, 1, 30, HEADERS["Today's plan"].length).clearContent();

  var row = TODAY_TABLE_FIRST_ROW;
  var overflowCount = 0;
  selection.commit.forEach(function (item, idx) {
    if (row > TODAY_TABLE_LAST_ROW) {
      overflowCount++;
      return;
    }
    writeTodayRow(sheet, row++, idx + 1, item, 'Commit');
  });
  if (selection.options.length && row <= TODAY_TABLE_LAST_ROW) {
    row++;
    selection.options.slice(0, Math.min(6, TODAY_TABLE_LAST_ROW - row + 1)).forEach(function (item, idx) {
      writeTodayRow(sheet, row++, idx + 1, item, 'Option');
    });
  }
  applyTodayRowStatusDropdowns(sheet);

  var headline = selection.commit.length
    ? 'Today’s plan is ready — ' + selection.commit.length + ' task' + (selection.commit.length === 1 ? '' : 's') +
      ' · ' + selection.minutesUsed + ' min planned · ' + selection.bufferMin + ' min spare'
    : 'Today’s plan is ready — nothing committed yet.';
  sheet.getRange('B3').setValue(headline);

  renderTodayDecisionCards();
  renderNeedsBreakdown(sheet);
  updateTodayProgress(sheet);
  refreshHome();
  var toastMsg = 'Today refreshed - ' + selection.commit.length + ' commit, ' + selection.options.length + ' option(s), ' + selection.bufferMin + ' min buffer kept.';
  if (overflowCount > 0) toastMsg = overflowCount + ' committed task(s) did not fit on Today - see Tasks. ' + toastMsg;
  SpreadsheetApp.getActiveSpreadsheet().toast(toastMsg, 'The Planner', 6);
}

// v7.4 §1.4: Option rows get a smaller dropdown ('Deferred'/'Pull in')
// than Commit rows — re-applied after every populate since row roles
// (Commit vs Option) shift on each refresh. Also the authoritative
// dropdown setter for applySheetDropdowns('Today')/refreshAllDropdowns,
// so a full refresh can't blanket-overwrite Option rows back to the
// Commit-only list.
function applyTodayRowStatusDropdowns(sheet) {
  for (var r = TODAY_TABLE_FIRST_ROW; r <= TODAY_TABLE_LAST_ROW; r++) {
    var slot = String(sheet.getRange(r, COLS.TODAY.SLOT).getValue() || '');
    var values = slot.indexOf('O') === 0 ? DROPDOWNS.TODAY_STATUS_OPTION : DROPDOWNS.TODAY_STATUS;
    setDropdown(sheet.getRange(r, COLS.TODAY.STATUS), values);
  }
}

// v7.4 §4.2 guard: a Multi-day task that's already been broken down
// isn't abandoned, it's handled — runQueueHygiene must not flag it.
function hasSubtasks(todoId) {
  var sheet = getSheet('Tasks');
  if (!sheet || sheet.getLastRow() < 2 || !todoId) return false;
  var parentIds = sheet.getRange(2, COLS.TODO.PARENT_ID, sheet.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < parentIds.length; i++) {
    if (String(parentIds[i][0]) === String(todoId)) return true;
  }
  return false;
}

// v7.4 §4.1: Multi-day tasks flagged [needs breakdown] by runQueueHygiene.
function collectNeedsBreakdownTasks(limit) {
  limit = limit || 5;
  var sheet = getSheet('Tasks');
  if (!sheet || sheet.getLastRow() < 2) return [];
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, COLS.TODO.NOTES).getValues();
  var out = [];
  for (var i = 0; i < data.length && out.length < limit; i++) {
    var status = String(data[i][COLS.TODO.STATUS - 1]);
    if (status !== 'Not started' && status !== 'In progress') continue;
    var notes = String(data[i][COLS.TODO.NOTES - 1] || '');
    if (notes.indexOf('[needs breakdown]') === -1) continue;
    out.push({ todoId: String(data[i][COLS.TODO.ID - 1]), task: String(data[i][COLS.TODO.TASK - 1] || '') });
  }
  return out;
}

function renderNeedsBreakdown(sheet) {
  sheet = sheet || getSheet('Today');
  if (!sheet) return;
  var limit = TODAY_NEEDS_BREAKDOWN_LAST_ROW - TODAY_NEEDS_BREAKDOWN_FIRST_ROW + 1;
  var items = collectNeedsBreakdownTasks(limit);
  try { sheet.getRange(TODAY_NEEDS_BREAKDOWN_FIRST_ROW, 2, limit, 7).breakApart(); } catch (err) { /* not merged, ignore */ }
  sheet.getRange(TODAY_NEEDS_BREAKDOWN_FIRST_ROW, 2, limit, 7).clearContent();
  if (!items.length) {
    sheet.getRange(TODAY_NEEDS_BREAKDOWN_FIRST_ROW, 2, 1, 7).merge().setValue('Nothing needs breaking down.').setFontColor('#5F625E');
    return;
  }
  items.forEach(function (item, idx) {
    sheet.getRange(TODAY_NEEDS_BREAKDOWN_FIRST_ROW + idx, 2, 1, 7).merge()
      .setValue(item.task + ' — use Row actions → Break down (on Tasks)').setFontColor('#964219');
  });
}

function writeTodayRow(sheet, row, slot, item, treatment) {
  sheet.getRange(row, COLS.TODAY.SLOT).setValue(treatment === 'Commit' ? slot : 'O' + slot);
  sheet.getRange(row, COLS.TODAY.TASK).setValue(item.task || '');
  sheet.getRange(row, COLS.TODAY.TODO_ID).setValue(item.todoId || '');
  sheet.getRange(row, COLS.TODAY.EST_MIN).setValue(item.estMin || '');
  sheet.getRange(row, COLS.TODAY.CLASS).setValue(treatment);
  sheet.getRange(row, COLS.TODAY.EFFORT).setValue(item.effort || '');
  var status = item.preserveStatus || (treatment === 'Commit' ? 'Planned' : 'Deferred');
  sheet.getRange(row, COLS.TODAY.STATUS).setValue(status);
  if (item.preserveActual) sheet.getRange(row, COLS.TODAY.ACTUAL_MIN).setValue(item.preserveActual);
  sheet.getRange(row, COLS.TODAY.NOTES).setValue(composeTodayNotes(item.tags, item.userNote))
    .setNote('Why: ' + (item.reason || 'selected for today'));
}

// v7.4 §1.5: replaces the capacity-fit formula + done counter with a
// two-line completion framing. Only Commit rows count (Slot not
// starting with 'O') — Options were never part of today's commitment.
function updateTodayProgress(sheet) {
  sheet = sheet || getSheet('Today');
  if (!sheet) return;
  var totalCommit = 0, doneCommit = 0, plannedMin = 0, doneMin = 0;
  for (var r = TODAY_TABLE_FIRST_ROW; r <= TODAY_TABLE_LAST_ROW; r++) {
    var slot = String(sheet.getRange(r, COLS.TODAY.SLOT).getValue() || '');
    if (!slot || slot.indexOf('O') === 0) continue;
    var task = sheet.getRange(r, COLS.TODAY.TASK).getValue();
    if (!task) continue;
    totalCommit++;
    var estMin = parseInt(sheet.getRange(r, COLS.TODAY.EST_MIN).getValue(), 10) || 0;
    plannedMin += estMin;
    if (String(sheet.getRange(r, COLS.TODAY.STATUS).getValue()) === 'Done') {
      doneCommit++;
      var actualMin = parseInt(sheet.getRange(r, COLS.TODAY.ACTUAL_MIN).getValue(), 10);
      doneMin += (actualMin || estMin);
    }
  }
  sheet.getRange(TODAY_PROGRESS_LINE1_ROW, 2, 1, 7).merge().setValue(doneCommit + ' of ' + totalCommit + ' tasks done').setFontWeight('bold').setFontColor('#1B474D');
  sheet.getRange(TODAY_PROGRESS_LINE2_ROW, 2, 1, 7).merge().setValue(doneMin + ' of ' + plannedMin + ' planned minutes completed').setFontColor('#5F625E');
}

// -------------------------------------------------------------
// Pending Decisions — up to 3 cards live on Home (row 8/9), with a
// "N more in queue" link to Decisions when there are more than 3.
// UI label is "Pending Decisions" everywhere, matching the Decisions
// tab name exactly — no separate "Suggestions" language anywhere.
// -------------------------------------------------------------

// Generalized 3-slot { id, text, action } cell-reference array for a
// Pending-Decision card row pair (id/text on idRow, action on actionRow).
function decisionSlotsFor(idRow, actionRow) {
  return [
    { id: 'A' + idRow, text: 'B' + idRow, action: 'B' + actionRow },
    { id: 'C' + idRow, text: 'D' + idRow, action: 'D' + actionRow },
    { id: 'F' + idRow, text: 'G' + idRow, action: 'G' + actionRow }
  ];
}

function renderDecisionCards(sheet, idRow, actionRow, moreRow) {
  var pendingList = firstPendingDecisions(3);
  var count = pendingDecisionCount();
  var slots = decisionSlotsFor(idRow, actionRow);
  var lastCol = 'I';

  try { sheet.getRange('A' + idRow + ':' + lastCol + actionRow).breakApart(); } catch (err) { /* not merged, ignore */ }
  sheet.getRange('A' + idRow + ':' + lastCol + actionRow).clearContent().clearNote().setBackground(null).setFontColor('#28251D').setFontWeight('normal').setWrap(false);
  if (moreRow) sheet.getRange('A' + moreRow + ':' + lastCol + moreRow).clearContent().clearNote();

  slots.forEach(function (slot) {
    sheet.getRange(slot.id).setValue('');
    sheet.getRange(slot.text).setValue('').setBackground('#F1F3F4');
    sheet.getRange(slot.action).setValue('').setBackground('#F1F3F4');
  });

  if (!pendingList.length) {
    sheet.getRange(slots[0].text).setValue('✓ No pending decisions').setBackground('#F1F3F4').setFontColor('#437A22').setFontWeight('bold');
    return;
  }

  pendingList.forEach(function (pending, idx) {
    var slot = slots[idx];
    var data = pending.data;
    var id = data[COLS.DECISIONS.ID - 1];
    var trigger = data[COLS.DECISIONS.TRIGGER - 1] || 'Decision';
    var task = data[COLS.DECISIONS.TASK - 1] || '';
    var notes = data[COLS.DECISIONS.NOTES - 1] || '';
    var label = 'Pending Decision ' + (idx + 1);
    sheet.getRange(slot.id).setValue(id);
    sheet.getRange(slot.text)
      .setValue(label + ': ' + task)
      .setBackground('#EAF4F5').setFontColor('#1B474D').setFontWeight('bold').setWrap(true)
      .setNote('Why: ' + trigger + (notes ? '\nNotes: ' + notes : ''));
    sheet.getRange(slot.action).setValue('').setBackground(MANUAL_COLOR).setFontWeight('bold');
    setDropdown(sheet.getRange(slot.action), ['', 'Yes', 'No']);
  });

  if (moreRow && count > 3) {
    var decisionsSheet = ensureDecisionsTab();
    sheet.getRange('B' + moreRow).setFormula(
      '=HYPERLINK("#gid=' + decisionsSheet.getSheetId() + '","' + (count - 3) + ' more in queue — open queue ▸")')
      .setFontColor('#01696F').setFontStyle('italic');
  }
}

// Kept as a thin wrapper — several call sites (onEditDecisions,
// completeTodoRow, populateTodayImpl, onOpen, etc.) call this by name and
// don't need to change now that Pending Decisions render on Home.
function renderTodayDecisionCards() {
  var sheet = getSheet('Home');
  if (!sheet) return;
  renderDecisionCards(sheet, HOME_DECISIONS_ID_ROW, HOME_DECISIONS_ACTION_ROW, HOME_DECISIONS_MORE_ROW);
}

function decisionIdForCell(sheet, row, col) {
  if (row !== HOME_DECISIONS_ACTION_ROW) return '';
  if (col === 2) return sheet.getRange('A' + HOME_DECISIONS_ID_ROW).getValue();
  if (col === 4) return sheet.getRange('C' + HOME_DECISIONS_ID_ROW).getValue();
  if (col === 7) return sheet.getRange('F' + HOME_DECISIONS_ID_ROW).getValue();
  return '';
}

function handleDecisionAction(sheet, action, decisionId) {
  action = String(action || '');
  if (!action) return;
  sheet.getRange('B' + HOME_DECISIONS_ACTION_ROW).setValue('');
  sheet.getRange('D' + HOME_DECISIONS_ACTION_ROW).setValue('');
  sheet.getRange('G' + HOME_DECISIONS_ACTION_ROW).setValue('');
  if (['Yes', 'No'].indexOf(action) === -1) return;
  if (!decisionId) return;
  var found = getDecisionRowById(decisionId);
  if (!found) return;
  var decisions = found.sheet;
  var row = found.row;
  if (String(decisions.getRange(row, COLS.DECISIONS.DECISION).getValue()) !== 'Pending') {
    renderDecisionCards(sheet, HOME_DECISIONS_ID_ROW, HOME_DECISIONS_ACTION_ROW, HOME_DECISIONS_MORE_ROW);
    SpreadsheetApp.getActiveSpreadsheet().toast('That decision was already resolved. Home has been refreshed.', 'The Planner', 4);
    return;
  }
  var accepted = resolveDecision(decisions, row, action);
  renderDecisionCards(sheet, HOME_DECISIONS_ID_ROW, HOME_DECISIONS_ACTION_ROW, HOME_DECISIONS_MORE_ROW);
  if (action === 'Yes' && accepted && accepted.ok) populateToday();
  toastForDecisionOutcome(action, accepted);
}

// -------------------------------------------------------------
// Today <-> Tasks sync
// -------------------------------------------------------------

function syncTodayRowForTodo(todoRow, status) {
  var todoSheet = getSheet('Tasks'), planSheet = getSheet('Today');
  if (!todoSheet || !planSheet) return;
  var todoId = String(todoSheet.getRange(todoRow, COLS.TODO.ID).getValue());
  if (!todoId) return;
  for (var r = TODAY_TABLE_FIRST_ROW; r <= TODAY_TABLE_LAST_ROW; r++) {
    if (String(planSheet.getRange(r, COLS.TODAY.TODO_ID).getValue()) === todoId) {
      var mapped = (status === 'Not started') ? 'Planned' : status;
      planSheet.getRange(r, COLS.TODAY.STATUS).setValue(mapped);
      return;
    }
  }
}

function syncTodayEstMinForTodo(todoSheet, todoRow) {
  var planSheet = getSheet('Today');
  if (!planSheet) return;
  var todoId = String(todoSheet.getRange(todoRow, COLS.TODO.ID).getValue());
  if (!todoId) return;
  var mins = parseTimeEst(String(todoSheet.getRange(todoRow, COLS.TODO.TIME_EST).getValue()));
  for (var r = TODAY_TABLE_FIRST_ROW; r <= TODAY_TABLE_LAST_ROW; r++) {
    if (String(planSheet.getRange(r, COLS.TODAY.TODO_ID).getValue()) === todoId) {
      planSheet.getRange(r, COLS.TODAY.EST_MIN).setValue(mins == null ? '' : mins);
      return;
    }
  }
}

// -------------------------------------------------------------
// onEditToday — the single handler for every interactive cell on Today
// -------------------------------------------------------------

function onEditToday(sheet, row, col, newVal) {
  if ((row === 4 || row === 5 || row === 6) && col === 4) { populateToday(); return; }
  if (row === TODAY_ENDOFDAY_ROW && col === TODAY_ENDOFDAY_COL && newVal === true) {
    sheet.getRange(TODAY_ENDOFDAY_ROW, TODAY_ENDOFDAY_COL).setValue(false);
    endOfDayReconcile();
    return;
  }
  if (col !== COLS.TODAY.STATUS || row < TODAY_TABLE_FIRST_ROW || row > TODAY_TABLE_LAST_ROW) return;
  var status = String(newVal || '');

  // v7.4 §1.4: Option rows carry a smaller dropdown ('Deferred'/'Pull
  // in'). Pulling one in promotes it to Commit on the spot instead of
  // waiting for the next manual refresh.
  var slotVal = String(sheet.getRange(row, COLS.TODAY.SLOT).getValue() || '');
  if (slotVal.indexOf('O') === 0 && status === 'Pull in') {
    var existingNotes = String(sheet.getRange(row, COLS.TODAY.NOTES).getValue() || '');
    if (existingNotes.indexOf('[pulled]') === -1) sheet.getRange(row, COLS.TODAY.NOTES).setValue('[pulled] ' + existingNotes);
    sheet.getRange(row, COLS.TODAY.STATUS).setValue('Deferred');
    populateToday();
    return;
  }

  var todoId = sheet.getRange(row, COLS.TODAY.TODO_ID).getValue();
  if (!todoId) return;
  if (status === 'Deferred') {
    var todoSheet = getSheet('Tasks');
    if (todoSheet) {
      var todo = getTodoById(String(todoId));
      if (todo) {
        todoSheet.getRange(todo.row, COLS.TODO.STATUS).setValue('Not started');
        todoSheet.getRange(todo.row, COLS.TODO.DUE_DATE).setValue(addDays(today(), 3));
        todoSheet.getRange(todo.row, COLS.TODO.LAST_EDITED).setValue(today());
        // v7.4 §3.1: onEditTasks already recalculates Commitment class
        // whenever the due date changes — Today's own Deferred push
        // never did, so a deferred task could stay misclassified (e.g.
        // still Fixed on a due date no longer within threshold) until
        // the nightly recalculateCommitmentClasses caught up.
        todoSheet.getRange(todo.row, COLS.TODO.COMMITMENT_CLASS).setValue(assignCommitmentClass(
          String(todoSheet.getRange(todo.row, COLS.TODO.WORKFLOW).getValue()), todoSheet.getRange(todo.row, COLS.TODO.DUE_DATE).getValue(),
          String(todoSheet.getRange(todo.row, COLS.TODO.OBJ_ID).getValue()), String(todoSheet.getRange(todo.row, COLS.TODO.OBJ_TYPE).getValue())));
        todoSheet.getRange(todo.row, COLS.TODO.CLASS_CALC_AT).setValue(today());
      }
    }
    return;
  }
  if (status === 'Done' && !sheet.getRange(row, COLS.TODAY.ACTUAL_MIN).getValue()) {
    sheet.getRange(row, COLS.TODAY.ACTUAL_MIN).setValue(sheet.getRange(row, COLS.TODAY.EST_MIN).getValue() || '');
  }
  completeTodo(String(todoId), status, { source: 'today' });
  updateTodayProgress(sheet);
}

// -------------------------------------------------------------
// Today — menu actions
// -------------------------------------------------------------

function pullSelectedTaskIntoToday() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var active = ss.getActiveSheet();
  if (active.getName() !== 'Tasks') { SpreadsheetApp.getUi().alert('Select a task row on Tasks first.'); return; }
  var row = active.getActiveRange().getRow();
  if (row <= 1) { SpreadsheetApp.getUi().alert('Select a task row on Tasks first.'); return; }
  var todoId = String(active.getRange(row, COLS.TODO.ID).getValue() || '');
  var task = String(active.getRange(row, COLS.TODO.TASK).getValue() || '');
  if (!todoId || !task) { SpreadsheetApp.getUi().alert('That row does not have a Task ID and task.'); return; }

  var todaySheet = getSheet('Today');
  if (!todaySheet) { bootstrapToday(); todaySheet = getSheet('Today'); }
  for (var r = TODAY_TABLE_FIRST_ROW; r <= TODAY_TABLE_LAST_ROW; r++) {
    if (String(todaySheet.getRange(r, COLS.TODAY.TODO_ID).getValue()) === todoId) {
      var notes = String(todaySheet.getRange(r, COLS.TODAY.NOTES).getValue() || '');
      if (notes.indexOf('[pulled]') === -1) todaySheet.getRange(r, COLS.TODAY.NOTES).setValue('[pulled] ' + notes);
      ss.setActiveSheet(todaySheet);
      SpreadsheetApp.getActiveSpreadsheet().toast('Task is already on Today.', 'The Planner', 3);
      return;
    }
  }
  var targetRow = -1;
  for (var empty = TODAY_TABLE_FIRST_ROW; empty <= TODAY_TABLE_LAST_ROW; empty++) {
    if (!todaySheet.getRange(empty, COLS.TODAY.TASK).getValue()) { targetRow = empty; break; }
  }
  if (targetRow === -1) { SpreadsheetApp.getUi().alert('Today is full. Clear or defer something first.'); return; }
  var est = parseTimeEst(String(active.getRange(row, COLS.TODO.TIME_EST).getValue() || '30 min')) || 30;
  writeTodayRow(todaySheet, targetRow, targetRow - 10, {
    todoId: todoId, task: task, estMin: est,
    effort: String(active.getRange(row, COLS.TODO.EFFORT_TYPE).getValue() || ''),
    reason: 'manually pulled from Tasks', tags: '[pulled]', userNote: ''
  }, 'Commit');
  ss.setActiveSheet(todaySheet);
  SpreadsheetApp.getActiveSpreadsheet().toast('Pulled selected task into Today.', 'The Planner', 3);
}

function lockTodayRow() {
  var sheet = SpreadsheetApp.getActiveSheet();
  if (sheet.getName() !== 'Today') { SpreadsheetApp.getUi().alert('Select a row on Today first.'); return; }
  var row = sheet.getActiveRange().getRow();
  if (row < TODAY_TABLE_FIRST_ROW || row > TODAY_TABLE_LAST_ROW) { SpreadsheetApp.getUi().alert('Pick a task row.'); return; }
  var notes = String(sheet.getRange(row, COLS.TODAY.NOTES).getValue() || '');
  if (notes.indexOf('[locked]') === -1) sheet.getRange(row, COLS.TODAY.NOTES).setValue('[locked] ' + notes);
  sheet.getRange(row, COLS.TODAY.TASK).setFontWeight('bold');
  SpreadsheetApp.getActiveSpreadsheet().toast('Row locked — stays in place on the next refresh.', 'The Planner', 3);
}

function unlockTodayRow() {
  var sheet = SpreadsheetApp.getActiveSheet();
  if (sheet.getName() !== 'Today') return;
  var row = sheet.getActiveRange().getRow();
  if (row < TODAY_TABLE_FIRST_ROW || row > TODAY_TABLE_LAST_ROW) return;
  var notes = String(sheet.getRange(row, COLS.TODAY.NOTES).getValue() || '').replace(/\[locked\]\s*/g, '').trim();
  sheet.getRange(row, COLS.TODAY.NOTES).setValue(notes);
  sheet.getRange(row, COLS.TODAY.TASK).setFontWeight('normal');
  SpreadsheetApp.getActiveSpreadsheet().toast('Row unlocked.', 'The Planner', 3);
}

function swapTodayRows(sheet, a, b) {
  var rangeA = sheet.getRange(a, 2, 1, 8), rangeB = sheet.getRange(b, 2, 1, 8);
  var valsA = rangeA.getValues(), valsB = rangeB.getValues();
  rangeA.setValues(valsB); rangeB.setValues(valsA);
}

function moveTodayRowUp() {
  var sheet = SpreadsheetApp.getActiveSheet();
  if (sheet.getName() !== 'Today') return;
  var row = sheet.getActiveRange().getRow();
  if (row <= TODAY_TABLE_FIRST_ROW || row > TODAY_TABLE_LAST_ROW) return;
  swapTodayRows(sheet, row, row - 1);
  sheet.setActiveRange(sheet.getRange(row - 1, COLS.TODAY.TASK));
}

function moveTodayRowDown() {
  var sheet = SpreadsheetApp.getActiveSheet();
  if (sheet.getName() !== 'Today') return;
  var row = sheet.getActiveRange().getRow();
  if (row < TODAY_TABLE_FIRST_ROW || row >= TODAY_TABLE_LAST_ROW) return;
  swapTodayRows(sheet, row, row + 1);
  sheet.setActiveRange(sheet.getRange(row + 1, COLS.TODAY.TASK));
}

function topUpToday() {
  var sheet = getSheet('Today');
  if (!sheet) return;
  var ui = SpreadsheetApp.getUi();
  var resp = ui.prompt('Top up today', 'How many more minutes do you have?', ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  var mins = parseInt(resp.getResponseText().trim(), 10);
  if (isNaN(mins) || mins <= 0) { ui.alert('Enter a positive number.'); return; }
  var current = parseInt(sheet.getRange(TODAY_CELLS.AVAILABLE_MIN).getValue(), 10) || 0;
  sheet.getRange(TODAY_CELLS.AVAILABLE_MIN).setValue(current + mins);
  populateToday();
  SpreadsheetApp.getActiveSpreadsheet().toast('Added ' + mins + ' minutes to today.', 'The Planner', 4);
}

function endOfDayReconcile() {
  var sheet = getSheet('Today');
  if (!sheet) { SpreadsheetApp.getUi().alert('Today tab not found.'); return; }
  var ui = SpreadsheetApp.getUi();
  var doneCount = 0, carried = 0, deferred = 0, skipped = 0;
  for (var r = TODAY_TABLE_FIRST_ROW; r <= TODAY_TABLE_LAST_ROW; r++) {
    var task = sheet.getRange(r, COLS.TODAY.TASK).getValue();
    var status = String(sheet.getRange(r, COLS.TODAY.STATUS).getValue());
    var todoId = sheet.getRange(r, COLS.TODAY.TODO_ID).getValue();
    if (!task) continue;
    if (status === 'Done') { doneCount++; continue; }
    if (status === 'Skipped' || status === 'Deferred') continue;
    var resp = ui.alert('End-of-day: unfinished', '"' + task + '"\n\nYES = carry over  NO = defer 3 days  CANCEL = skip', ui.ButtonSet.YES_NO_CANCEL);
    if (resp === ui.Button.YES) { carried++; }
    else if (resp === ui.Button.NO) {
      deferred++;
      if (todoId) completeTodo(String(todoId), 'Deferred', { source: 'eod' });
      sheet.getRange(r, COLS.TODAY.STATUS).setValue('Deferred');
    } else {
      skipped++;
      if (todoId) completeTodo(String(todoId), 'Skipped', { source: 'eod' });
      sheet.getRange(r, COLS.TODAY.STATUS).setValue('Skipped');
    }
  }
  ui.alert('End-of-day reconcile complete', 'Done: ' + doneCount + ' | Carried: ' + carried + ' | Deferred: ' + deferred + ' | Skipped: ' + skipped, ui.ButtonSet.OK);
}

function checkMorningCarryForward() {
  var sheet = getSheet('Today');
  if (!sheet) return;
  var b2 = sheet.getRange('B2').getValue();
  if (!b2) return;
  var lastDate = new Date(b2); lastDate.setHours(0, 0, 0, 0);
  if (lastDate.getTime() === today().getTime()) return;
  var unfinished = 0;
  for (var r = TODAY_TABLE_FIRST_ROW; r <= TODAY_TABLE_LAST_ROW; r++) {
    var task = sheet.getRange(r, COLS.TODAY.TASK).getValue();
    var status = String(sheet.getRange(r, COLS.TODAY.STATUS).getValue());
    if (task && (status === 'Planned' || status === 'In progress')) unfinished++;
  }
  if (unfinished > 0) {
    SpreadsheetApp.getActiveSpreadsheet().toast(unfinished + ' unfinished item(s) from last session will be re-ranked into today automatically.', 'The Planner', 6);
  }
}

function middayNudge() {
  var sheet = getSheet('Today');
  if (!sheet) return;
  var pending = 0;
  for (var r = TODAY_TABLE_FIRST_ROW; r <= TODAY_TABLE_LAST_ROW; r++) {
    var task = sheet.getRange(r, COLS.TODAY.TASK).getValue();
    var status = String(sheet.getRange(r, COLS.TODAY.STATUS).getValue());
    if (task && (status === 'Planned' || status === 'In progress')) pending++;
  }
  if (pending >= 5) SpreadsheetApp.getActiveSpreadsheet().toast(pending + ' items still open — realistic for today, or should some defer?', 'The Planner · Mid-day check', 8);
}

// =============================================================
// HOME — orientation only. No data entry lives here.
//
// FIX (confirmed): the onboarding and refresh checkboxes are now both
// pinned to fixed rows (4 and 5) ABOVE all variable-height content
// (the setup card, metrics, nav). Previously the refresh checkbox's
// functional cell was hardcoded to row 1 while its label rendered much
// further down wherever the dynamic content happened to end — so the
// visible label and the actual clickable cell were in two different
// places. Pinning both controls above the variable content means their
// cell references can never drift out of sync with what's on screen.
// =============================================================

var HOME_TITLE_ROW = 2;

var HOME_ONBOARD_ROW = 4;
var HOME_ONBOARD_CHECK_COL = 2;        // B — primary checkbox (Start/Continue), hidden when complete
var HOME_ONBOARD_RESET_CHECK_COL = 8;  // H — small secondary "Reset" checkbox, shown only when complete
var HOME_WELCOME_ROW = 5;              // welcome / stage-detail line, one merged row B:F

var HOME_DECISIONS_HEADER_ROW = 7;
var HOME_DECISIONS_ID_ROW = 8;         // A/C/F hold Decision IDs; B/D/G hold the visible card text
var HOME_DECISIONS_ACTION_ROW = 9;     // B/D/G hold the Yes/No dropdowns
var HOME_DECISIONS_MORE_ROW = 10;      // "N more in queue" link, only rendered when count > 3

var HOME_UPDATE_HEADER_ROW = 12;
var HOME_UPDATE_ROW = 13;
var HOME_UPDATE_COL = 2;               // B — the update-type dropdown

var HOME_PLAN_HEADER_ROW = 15;         // "Today's plan"
var HOME_PLAN_STATUS_ROW = 16;         // "Ready — N tasks, M minutes." / "Not built yet."
var HOME_PLAN_START_ROW = 17;          // "Start working ▸" HYPERLINK
var HOME_PLAN_SUBLINE_ROW = 18;        // small muted "<N> tasks remain in your master queue."

var HOME_UPCOMING_HEADER_ROW = 20;
var HOME_UPCOMING_FIRST_ROW = 21;      // 21..25, 5 rows max

var HOME_REFRESH_ROW = 27;             // small utility row
var HOME_REFRESH_COL = 2;

var HOME_LAST_REFRESHED_ROW = 29;

var SETUP_PROP_KEY = 'setupProfile';

function getSetupProfile() {
  var raw = PropertiesService.getDocumentProperties().getProperty(SETUP_PROP_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

function saveSetupProfile(profile) {
  PropertiesService.getDocumentProperties().setProperty(SETUP_PROP_KEY, JSON.stringify(profile));
}

function setupLabel(profile) {
  if (!profile) return 'Not set up yet';
  var goalLabels = { explore_space: 'Exploring a new space', in_process: 'Already in the process', skipped: 'Setup skipped' };
  var entryLabels = { sectors: 'Sectors', interviews: 'Interviews', applications: 'Applications', jobs: 'Jobs', people: 'People', orgs: 'Organisations', not_sure: 'Not sure', skip: 'Skipped' };
  return (goalLabels[profile.goal] || profile.goal || 'Setup') + (profile.entryPoint ? ' — ' + (entryLabels[profile.entryPoint] || profile.entryPoint) : '');
}

// v7.4: matches by workflow identity (COLS.TODO.WORKFLOW), not display
// text, so the checklist can actually resolve to done — see the class
// comment on setupChecklistFor for why the old text/source match never
// worked. `text` is kept only as a legacy fallback for profiles saved by
// pre-v7.4 versions, which have no `workflow` field at all.
function checkAutoCompletion(item) {
  if (item.alwaysDone) return true;
  var todoSheet = getSheet('Tasks');
  if (!todoSheet || todoSheet.getLastRow() < 2) return false;
  var data = todoSheet.getRange(2, 1, todoSheet.getLastRow() - 1, HEADERS['To-do'].length).getValues();
  var matched = [];
  for (var i = 0; i < data.length; i++) {
    var wf = String(data[i][COLS.TODO.WORKFLOW - 1]);
    var taskText = String(data[i][COLS.TODO.TASK - 1]);
    var matchesWorkflow = item.workflow && (wf === item.workflow || (item.altWorkflows && item.altWorkflows.indexOf(wf) !== -1));
    var matchesLegacyText = !matchesWorkflow && !item.workflow && item.text && taskText.indexOf(item.text) === 0;
    if (matchesWorkflow || matchesLegacyText) matched.push(data[i]);
  }
  if (!matched.length) return false; // nothing created yet -> not started
  // Terminal statuses all resolve setup: Done, Skipped, or Cancelled.
  return matched.every(function (row) { return isTerminalTodoStatus(String(row[COLS.TODO.STATUS - 1])); });
}

function shouldShowSetupCard(profile) {
  if (!profile || !profile.checklist || !profile.checklist.length) return false;
  return !profile.checklist.every(function (item) { return checkAutoCompletion(item); });
}

function nextIncompleteChecklistItem(profile) {
  if (!profile || !profile.checklist) return null;
  for (var i = 0; i < profile.checklist.length; i++) {
    if (!checkAutoCompletion(profile.checklist[i])) return profile.checklist[i];
  }
  return null;
}

// v7.6 §2.10: one extended bulk read over the same data the old
// countOpenTasks() scanned (Status/Commitment class/Notes), instead of a
// bare open-task count — no new sheet call, just more out of the same
// pass. No summary/title row added to Tasks itself (ruled out by §1's
// row-2 constraint) — this is Home's line, extended.
function taskQueueSummary() {
  var sheet = getSheet('Tasks');
  if (!sheet || sheet.getLastRow() < 2) return '0 open';
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, COLS.TODO.COMMITMENT_CLASS).getValues();
  var open = 0, fixedCount = 0, blocking = 0, needAttention = 0, needBreakdown = 0, blockedCount = 0;
  data.forEach(function (row) {
    var status = String(row[COLS.TODO.STATUS - 1]);
    if (status !== 'Not started' && status !== 'In progress') return;
    open++;
    var cls = String(row[COLS.TODO.COMMITMENT_CLASS - 1]);
    if (cls === 'Fixed') fixedCount++;
    if (cls === 'Blocking') blocking++;
    var notes = String(row[COLS.TODO.NOTES - 1] || '');
    if (/\[(flags|review|no-estimate|no-link|no-date|parent-still-open)\]/.test(notes)) needAttention++;
    if (notes.indexOf('[needs breakdown]') !== -1) needBreakdown++;
    if (notes.indexOf('[blocked]') !== -1) blockedCount++;
  });
  return open + ' open · ' + fixedCount + ' Fixed · ' + blocking + ' Blocking · ' +
    needAttention + ' need attention · ' + needBreakdown + ' need breakdown · ' + blockedCount + ' blocked';
}

// v7.4: replaces a plain sheet.clear() — clear() alone was found to leave
// stale data-validation rules (checkboxes) from a prior layout in place,
// producing an orphaned checkbox artifact once the row layout moved.
// Explicitly tearing down merges/validations/formatting/content/notes
// before every rebuild means a changed layout can never leave leftover
// state behind.
function hardResetHomeSheet(sheet) {
  var maxRows = Math.max(sheet.getMaxRows(), 60);
  var maxCols = Math.max(sheet.getMaxColumns(), 10);
  try { sheet.getRange(1, 1, maxRows, maxCols).breakApart(); } catch (err) { }
  try { sheet.getRange(1, 1, maxRows, maxCols).clearDataValidations(); } catch (err) { }
  try { sheet.getRange(1, 1, maxRows, maxCols).clearFormat(); } catch (err) { }
  try { sheet.getRange(1, 1, maxRows, maxCols).clearContent(); } catch (err) { }
  try { sheet.getRange(1, 1, maxRows, maxCols).clearNote(); } catch (err) { }
}

// v7.4: Today's-plan hero counts — built only if Today's date (B2) is
// today; a row counts as Commit unless its Slot cell starts with 'O'
// (Option rows are written as 'O1', 'O2', ... by writeTodayRow).
function todayPlanCounts() {
  var result = { built: false, commit: 0, minutes: 0, options: 0 };
  var sheet = getSheet('Today');
  if (!sheet) return result;
  var planDate = sheet.getRange('B2').getValue();
  if (!planDate) return result;
  var d = new Date(planDate); d.setHours(0, 0, 0, 0);
  result.built = d.getTime() === today().getTime();
  if (!result.built) return result;
  for (var r = TODAY_TABLE_FIRST_ROW; r <= TODAY_TABLE_LAST_ROW; r++) {
    var slot = String(sheet.getRange(r, COLS.TODAY.SLOT).getValue() || '');
    if (!slot) continue;
    if (slot.indexOf('O') === 0) {
      result.options++;
    } else {
      result.commit++;
      result.minutes += parseInt(sheet.getRange(r, COLS.TODAY.EST_MIN).getValue(), 10) || 0;
    }
  }
  return result;
}

function formatDateFriendly(d) {
  return Utilities.formatDate(new Date(d), plannerTimeZone(), 'EEE d MMM');
}

// v7.4: read-only merge of the next 5 upcoming dated items across
// Interviews / People (scheduled conversations) / Jobs (applied, awaiting
// review) — no writes, no cascades, just a sorted feed for Home.
function collectUpcomingItems(limit) {
  limit = limit || 5;
  var t = today();
  var items = [];

  var roundsSheet = getSheet('Interviews');
  if (roundsSheet && roundsSheet.getLastRow() > 1) {
    var rData = roundsSheet.getRange(2, 1, roundsSheet.getLastRow() - 1, COLS.ROUNDS.NOTES).getValues();
    rData.forEach(function (r) {
      var d = r[COLS.ROUNDS.INTERVIEW_DATE - 1];
      var status = String(r[COLS.ROUNDS.STATUS - 1]);
      if (d && new Date(d) >= t && ['Completed', 'Cancelled'].indexOf(status) === -1) {
        var label = r[COLS.ROUNDS.ORG_DISPLAY - 1] || r[COLS.ROUNDS.JOB_DISPLAY - 1] || '';
        items.push({ type: 'Interview', date: new Date(d), label: label });
      }
    });
  }

  var peopleSheet = getSheet('People');
  if (peopleSheet && peopleSheet.getLastRow() > 1) {
    var pData = peopleSheet.getRange(2, 1, peopleSheet.getLastRow() - 1, COLS.PEOPLE.FOLLOW_UPS_SENT_COUNT).getValues();
    pData.forEach(function (p) {
      var stage = String(p[COLS.PEOPLE.STAGE - 1]);
      var d = p[COLS.PEOPLE.CONVERSATION_DATE - 1];
      if (stage === 'Conversation scheduled' && d && new Date(d) >= t) {
        items.push({ type: 'Conversation', date: new Date(d), label: p[COLS.PEOPLE.NAME - 1] || '' });
      }
    });
  }

  var jobsSheet = getSheet('Jobs');
  if (jobsSheet && jobsSheet.getLastRow() > 1) {
    var jData = jobsSheet.getRange(2, 1, jobsSheet.getLastRow() - 1, COLS.JOBS.NOTES).getValues();
    jData.forEach(function (j) {
      var status = String(j[COLS.JOBS.STATUS - 1]);
      var d = j[COLS.JOBS.REVIEW_DATE - 1];
      if (status === 'Applied' && d && new Date(d) >= t) {
        items.push({ type: 'Follow-up', date: new Date(d), label: j[COLS.JOBS.ORG - 1] || '' });
      }
    });
  }

  items.sort(function (a, b) { return a.date - b.date; });
  return items.slice(0, limit);
}

function refreshHome() {
  var sheet = getSheet('Home');
  if (!sheet) sheet = SpreadsheetApp.getActiveSpreadsheet().insertSheet('Home', 0);
  hardResetHomeSheet(sheet);
  sheet.setTabColor(ZONE_WORK_COLOR);

  sheet.getRange(HOME_TITLE_ROW, 2, 1, 5).merge().setValue('The Planner').setFontSize(20).setFontWeight('bold').setFontColor('#1B474D');

  // --- Onboarding card (§1.1) ---
  var profile = getSetupProfile();
  if (!profile) {
    sheet.getRange(HOME_ONBOARD_ROW, HOME_ONBOARD_CHECK_COL).setValue(false).insertCheckboxes().setBackground(MANUAL_COLOR);
    sheet.getRange(HOME_ONBOARD_ROW, HOME_ONBOARD_CHECK_COL + 1, 1, 4).merge()
      .setValue('Start onboarding').setFontWeight('bold').setFontColor('#01696F').setBackground('#EAF4F5');
    sheet.getRange(HOME_WELCOME_ROW, 2, 1, 5).merge()
      .setValue('Use the checkbox above or The Planner → Set up / redo onboarding. The popup writes source rows and refreshes Today.')
      .setWrap(true).setFontColor('#5F625E');
  } else if (shouldShowSetupCard(profile)) {
    sheet.getRange(HOME_ONBOARD_ROW, HOME_ONBOARD_CHECK_COL).setValue(false).insertCheckboxes().setBackground(MANUAL_COLOR);
    sheet.getRange(HOME_ONBOARD_ROW, HOME_ONBOARD_CHECK_COL + 1, 1, 4).merge()
      .setValue('Continue onboarding').setFontWeight('bold').setFontColor('#01696F').setBackground('#EAF4F5');
    var nextItem = nextIncompleteChecklistItem(profile);
    var detail = setupLabel(profile) + (nextItem ? ' — next: ' + (nextItem.label || nextItem.text) : '');
    sheet.getRange(HOME_WELCOME_ROW, 2, 1, 5).merge().setValue(detail).setWrap(true).setFontColor('#5F625E');
  } else {
    sheet.getRange(HOME_ONBOARD_ROW, HOME_ONBOARD_CHECK_COL, 1, 5).merge()
      .setValue('✓ Onboarding complete').setFontWeight('bold').setFontColor('#437A22');
    sheet.getRange(HOME_ONBOARD_ROW, HOME_ONBOARD_RESET_CHECK_COL).setValue(false).insertCheckboxes();
    sheet.getRange(HOME_ONBOARD_ROW, HOME_ONBOARD_RESET_CHECK_COL + 1).setValue('Reset').setFontSize(9).setFontColor('#7A7974');
    sheet.getRange(HOME_WELCOME_ROW, 2, 1, 5).merge().setValue('Welcome back. Let’s get you organised for today.').setFontColor('#5F625E');
  }

  // --- Pending Decisions (§1.2) — kept inline, near-zero friction ---
  sheet.getRange(HOME_DECISIONS_HEADER_ROW, 2, 1, 5).merge().setValue('Pending Decisions').setFontWeight('bold').setFontColor('#FFFFFF').setBackground(HEADER_COLOR);
  renderDecisionCards(sheet, HOME_DECISIONS_ID_ROW, HOME_DECISIONS_ACTION_ROW, HOME_DECISIONS_MORE_ROW);

  // --- Add update (§1.3) — the primary capture surface now ---
  sheet.getRange(HOME_UPDATE_HEADER_ROW, 2, 1, 5).merge().setValue('Add update').setFontWeight('bold').setFontColor('#FFFFFF').setBackground(HEADER_COLOR);
  sheet.getRange(HOME_UPDATE_ROW, HOME_UPDATE_COL).setValue('No updates').setBackground(MANUAL_COLOR);
  setDropdown(sheet.getRange(HOME_UPDATE_ROW, HOME_UPDATE_COL), DROPDOWNS.TODAY_UPDATE_TYPES);

  // --- Today's plan hero (§1.4) — replaces the raw open-task count ---
  sheet.getRange(HOME_PLAN_HEADER_ROW, 2, 1, 5).merge().setValue('Today’s plan').setFontWeight('bold').setFontColor('#FFFFFF').setBackground(HEADER_COLOR);
  var planCounts = todayPlanCounts();
  var heroText = 'Not built yet.';
  if (planCounts.built && planCounts.commit > 0) heroText = 'Ready — ' + planCounts.commit + ' tasks, ' + planCounts.minutes + ' minutes.';
  else if (planCounts.built) heroText = 'Built — nothing committed today.';
  sheet.getRange(HOME_PLAN_STATUS_ROW, 2, 1, 5).merge().setValue(heroText).setFontWeight('bold').setFontColor('#1B474D');
  var todaySheetForLink = getSheet('Today');
  if (todaySheetForLink) {
    sheet.getRange(HOME_PLAN_START_ROW, 2).setFormula('=HYPERLINK("#gid=' + todaySheetForLink.getSheetId() + '","Start working ▸")').setFontColor('#01696F').setFontWeight('bold');
  }
  sheet.getRange(HOME_PLAN_SUBLINE_ROW, 2, 1, 5).merge().setValue(taskQueueSummary()).setFontSize(9).setFontColor('#8A8D87');

  // --- Upcoming (§1.5) — read-only, no cascades ---
  sheet.getRange(HOME_UPCOMING_HEADER_ROW, 2, 1, 5).merge().setValue('Upcoming').setFontWeight('bold').setFontColor('#FFFFFF').setBackground(HEADER_COLOR);
  var upcoming = collectUpcomingItems(5);
  if (!upcoming.length) {
    sheet.getRange(HOME_UPCOMING_FIRST_ROW, 2, 1, 5).merge().setValue('Nothing scheduled in the next window.').setFontColor('#5F625E');
  } else {
    upcoming.forEach(function (item, idx) {
      var r = HOME_UPCOMING_FIRST_ROW + idx;
      sheet.getRange(r, 2).setValue(item.type).setFontWeight('bold').setFontColor('#1B474D');
      sheet.getRange(r, 3).setValue(formatDateFriendly(item.date));
      sheet.getRange(r, 4, 1, 3).merge().setValue(item.label);
    });
  }

  // --- Refresh (§1.6) — demoted utility control, folds in trigger status ---
  var editReady = false;
  try { editReady = triggerExists(EDIT_TRIGGER_HANDLER, ScriptApp.EventType.ON_EDIT); } catch (err) { Logger.log('refreshHome trigger check: ' + err); }
  sheet.getRange(HOME_REFRESH_ROW, HOME_REFRESH_COL).setValue(false).insertCheckboxes().setBackground(MANUAL_COLOR);
  sheet.getRange(HOME_REFRESH_ROW, HOME_REFRESH_COL + 1, 1, 4).merge()
    .setValue('Refresh & verify triggers — Capture: ' + (editReady ? 'Ready' : 'Trigger setup needed'))
    .setFontSize(9).setFontColor('#8A8D87');

  sheet.getRange(HOME_LAST_REFRESHED_ROW, 2, 1, 3).merge().setValue('Last refreshed: ' + Utilities.formatDate(new Date(), plannerTimeZone(), 'yyyy-MM-dd HH:mm'))
    .setFontSize(9).setFontColor('#BAB9B4').setFontStyle('italic');

  sheet.setColumnWidths(1, 1, 24);
  sheet.setColumnWidths(2, 1, 170);
  sheet.setColumnWidths(3, 1, 150);
  sheet.setColumnWidths(4, 3, 170);
}

function onEditHome(sheet, row, col, newVal) {
  if (row === HOME_ONBOARD_ROW && col === HOME_ONBOARD_CHECK_COL && newVal === true) {
    sheet.getRange(HOME_ONBOARD_ROW, HOME_ONBOARD_CHECK_COL).setValue(false);
    runSetupInterview();
    return;
  }
  if (row === HOME_ONBOARD_ROW && col === HOME_ONBOARD_RESET_CHECK_COL && newVal === true) {
    sheet.getRange(HOME_ONBOARD_ROW, HOME_ONBOARD_RESET_CHECK_COL).setValue(false);
    runSetupInterview();
    return;
  }
  if (row === HOME_DECISIONS_ACTION_ROW && (col === 2 || col === 4 || col === 7)) {
    handleDecisionAction(sheet, String(newVal || ''), decisionIdForCell(sheet, row, col));
    return;
  }
  if (row === HOME_UPDATE_ROW && col === HOME_UPDATE_COL) {
    var updateType = String(newVal || '');
    var capture = todayUpdateTypeToCapture(updateType);
    if (capture) { sheet.getRange(HOME_UPDATE_ROW, HOME_UPDATE_COL).setValue('No updates'); runCapturePopup(capture); }
    return;
  }
  if (row === HOME_REFRESH_ROW && col === HOME_REFRESH_COL && newVal === true) {
    sheet.getRange(HOME_REFRESH_ROW, HOME_REFRESH_COL).setValue(false);
    fullRefresh();
  }
}

// =============================================================
// ONBOARDING — destructive-then-rebuild, capture entirely via popups
// =============================================================

function clearSheetBody(sheet, headerKey) {
  if (!sheet || !HEADERS[headerKey]) return;
  var rows = Math.max(sheet.getMaxRows() - 1, 1);
  var cols = HEADERS[headerKey].length;
  sheet.getRange(1, 1, 1, cols).setValues([HEADERS[headerKey]]);
  if (rows > 0) sheet.getRange(2, 1, rows, cols).clearContent().clearNote();
}

function resetPlannerDataForOnboarding() {
  var dataTabs = [
    { name: 'Sectors', key: 'Sectors' }, { name: 'Organisations', key: 'Organisations' },
    { name: 'Jobs', key: 'Jobs' }, { name: 'People', key: 'People' },
    { name: 'Conversations', key: 'Interactions' }, { name: 'Interviews', key: 'Interview rounds' },
    { name: 'Tasks', key: 'To-do' }, { name: 'Decisions', key: 'Pending decisions' }
  ];
  dataTabs.forEach(function (spec) {
    var sheet = getSheet(spec.name) || SpreadsheetApp.getActiveSpreadsheet().insertSheet(spec.name);
    clearSheetBody(sheet, spec.key);
  });
  var props = PropertiesService.getDocumentProperties();
  props.deleteProperty(SETUP_PROP_KEY);
  bootstrapToday();
}

function runSetupInterview() {
  var html = HtmlService.createHtmlOutput(buildSetupHtml()).setWidth(640).setHeight(680).setTitle('Set up The Planner');
  SpreadsheetApp.getUi().showModalDialog(html, 'Set up The Planner');
}

function buildSetupHtml() {
  var roundTypes = DROPDOWNS.ROUND_TYPE, domain = DROPDOWNS.DOMAIN_READINESS, jobStatuses = DROPDOWNS.JOB_STATUS, orgStatuses = DROPDOWNS.ORG_STATUS, relTypes = DROPDOWNS.PERSON_REL_TYPE;
  return '' +
    '<style>' +
    'body{font-family:Arial,sans-serif;padding:22px;color:#28251D;background:#FBFBF9;}' +
    'h2{margin:0 0 8px;color:#1B474D;font-size:20px;}' +
    'p{color:#5F625E;font-size:13px;line-height:1.45;margin:6px 0 14px;}' +
    '.step{display:none}.step.active{display:block}' +
    '.option{display:block;width:100%;text-align:left;padding:13px 15px;margin:9px 0;border:1px solid #D8DAD4;border-radius:6px;background:#FFF;cursor:pointer;font-size:14px;color:#28251D;}' +
    '.option:hover{border-color:#01696F;background:#EEF7F6}' +
    '.option small{display:block;color:#6E716C;font-size:12px;margin-top:4px;line-height:1.35}' +
    'label{display:block;margin-top:12px;font-size:12px;font-weight:bold;color:#1B474D;}' +
    'input,textarea,select{box-sizing:border-box;width:100%;margin-top:5px;padding:9px;border:1px solid #D8DAD4;border-radius:5px;background:#FFF;font-size:13px;color:#28251D;}' +
    'textarea{min-height:64px;resize:vertical;}' +
    '.back,.skip{margin-top:12px;font-size:12px;color:#5F625E;text-decoration:underline;cursor:pointer;background:none;border:none;padding:0;}' +
    '.primary{margin-top:18px;padding:10px 14px;border:0;border-radius:5px;background:#01696F;color:#FFF;font-weight:bold;cursor:pointer;}' +
    '#status{font-size:12px;color:#5F625E;margin-top:10px;}' +
    '.warn{font-size:11px;color:#964219;margin-top:4px;}' +
    '</style>' +
    '<h2>Set up your planner</h2>' +
    '<p>This clears any existing planner data first, then captures your starting facts here and writes them to the right tabs.</p>' +
    '<div id="q1" class="step active">' +
    '  <p><strong>1 of 3</strong> Where are you starting from?</p>' +
    '  <button class="option" onclick="pickGoal(\'explore_space\')">I am exploring a new space<small>Start with a broad sector, then sub-sectors, then organisations.</small></button>' +
    '  <button class="option" onclick="pickGoal(\'in_process\')">I am already in the process<small>You already have jobs, applications, interviews, people, or organisations.</small></button>' +
    '</div>' +
    '<div id="q2" class="step">' +
    '  <p id="q2title"><strong>2 of 3</strong></p>' +
    '  <div id="q2_options"></div>' +
    '  <button class="back" onclick="showStep(1)">Back</button>' +
    '</div>' +
    '<div id="q3" class="step">' +
    '  <p id="q3title"><strong>3 of 3</strong></p>' +
    '  <form id="captureForm"></form>' +
    '  <button class="primary" type="button" onclick="submitSetup()">Save (clears existing data first)</button>' +
    '  <button class="back" type="button" onclick="showStep(2)">Back</button>' +
    '  <button class="skip" type="button" onclick="skipSetup()">Skip setup</button>' +
    '  <div id="status"></div>' +
    '</div>' +
    '<script>' +
    'var goal="", entryPoint="";' +
    'var jobStatuses=' + JSON.stringify(jobStatuses) + ', roundTypes=' + JSON.stringify(roundTypes) + ', domainReadiness=' + JSON.stringify(domain) + ', orgStatuses=' + JSON.stringify(orgStatuses) + ', relTypes=' + JSON.stringify(relTypes) + ';' +
    'var forms={' +
    ' sectors:{title:"Add your first sector(s)",fields:[{k:"sectorNames",l:"Sector(s) to explore",t:"textarea",p:"Climate\\nAI governance"}]},' +
    ' interviews:{title:"Capture an active interview",fields:[{k:"org",l:"Organisation",t:"text"},{k:"jobTitle",l:"Job title / opportunity",t:"text"},{k:"roundNumber",l:"Round number",t:"text",p:"1"},{k:"roundType",l:"Round type",t:"select",o:roundTypes},{k:"interviewDate",l:"Interview date",t:"date"},{k:"domainReadiness",l:"Domain readiness",t:"select",o:domainReadiness}]},' +
    ' applications:{title:"Capture an application already submitted",fields:[{k:"org",l:"Organisation",t:"text"},{k:"jobTitle",l:"Job title / opportunity",t:"text"},{k:"appliedDate",l:"When did you apply?",t:"date"},{k:"urlNotes",l:"URL / notes",t:"textarea"}]},' +
    ' jobs:{title:"Capture a job you want to apply to",fields:[{k:"org",l:"Organisation",t:"text"},{k:"jobTitle",l:"Job title / opportunity",t:"text"},{k:"deadline",l:"Deadline, if any",t:"date"},{k:"urlNotes",l:"URL / source / notes",t:"textarea"}]},' +
    ' people:{title:"Capture a person or conversation state",fields:[{k:"name",l:"Name",t:"text"},{k:"org",l:"Organisation",t:"text"},{k:"role",l:"Role/title, if known",t:"text"},{k:"relType",l:"Relationship type",t:"select",o:relTypes},{k:"reachedOut",l:"Have you already reached out?",t:"select",o:["No","Yes"]},{k:"replied",l:"Have they replied?",t:"select",o:["No","Yes"]},{k:"outreachDate",l:"When did you reach out?",t:"date"},{k:"whereNow",l:"If they replied, where are things now?",t:"select",o:["Need to respond / arrange next step","Conversation scheduled","Already spoke"]},{k:"conversationDate",l:"Conversation date, if scheduled/completed",t:"date"},{k:"notes",l:"Notes/source",t:"textarea"}]},' +
    ' orgs:{title:"Capture organisations you are tracking",fields:[{k:"orgNames",l:"Organisation name(s)",t:"textarea",p:"One per line, or comma-separated"},{k:"sector",l:"Sector, if known",t:"text"},{k:"subsector",l:"Sub-sector, if known",t:"text"},{k:"tier",l:"Tier",t:"select",o:["B","A","C"]},{k:"status",l:"Status",t:"select",o:orgStatuses}]},' +
    ' not_sure:{title:"Capture what feels most live",fields:[{k:"notes",l:"What is the thing you are trying to get under control?",t:"textarea",p:"Interview, application, job, person, org, or messy notes..."}]}' +
    '};' +
    'function showStep(n){document.querySelectorAll(".step").forEach(function(x){x.classList.remove("active")});document.getElementById("q"+n).classList.add("active");}' +
    'function pickGoal(g){goal=g;' +
    ' if(g==="explore_space"){entryPoint="sectors";renderForm("sectors");return;}' +
    ' document.getElementById("q2title").innerHTML="<strong>2 of 3</strong> What should we capture first?";' +
    ' var opts=[["interviews","I have interviews","Creates/links a Job and an Interview round."],' +
    ' ["applications","I have applications submitted","Creates an Applied job and a response-check task from the real applied date."],' +
    ' ["jobs","I have jobs I want to apply to","Creates a Want-to-apply job and application prep."],' +
    ' ["people","I have people or conversations","Creates a Person and the right outreach/follow-up state."],' +
    ' ["orgs","I have organisations to track","Creates/classifies Organisations — status you pick is honored; Active only ever suggests, never floods job/people search."],' +
    ' ["not_sure","I am not sure","Creates a light clarification task on Today."]];' +
    ' var c=document.getElementById("q2_options");c.innerHTML="";' +
    ' opts.forEach(function(o){var b=document.createElement("button");b.className="option";b.innerHTML=o[1]+"<small>"+o[2]+"</small>";b.onclick=function(){entryPoint=o[0];renderForm(o[0]);};c.appendChild(b);});' +
    ' showStep(2);}' +
    'function renderForm(ep){var cfg=forms[ep];document.getElementById("q3title").innerHTML="<strong>3 of 3</strong> "+cfg.title;var f=document.getElementById("captureForm");f.innerHTML="";' +
    ' cfg.fields.forEach(function(field){var label=document.createElement("label");label.textContent=field.l;var input;' +
    '  if(field.t==="textarea"){input=document.createElement("textarea");}' +
    '  else if(field.t==="select"){input=document.createElement("select");(field.o||[]).forEach(function(v){var opt=document.createElement("option");opt.value=v;opt.textContent=v;input.appendChild(opt);});}' +
    '  else{input=document.createElement("input");input.type=field.t||"text";}' +
    '  input.name=field.k;if(field.p)input.placeholder=field.p;label.appendChild(input);f.appendChild(label);});' +
    ' showStep(3);}' +
    'function submitSetup(){var fields={};Array.prototype.forEach.call(document.getElementById("captureForm").elements,function(el){if(el.name)fields[el.name]=el.value;});' +
    ' document.getElementById("status").textContent="Clearing existing data and saving...";' +
    ' google.script.run.withSuccessHandler(function(msg){document.getElementById("status").textContent=msg||"Saved.";setTimeout(function(){google.script.host.close();},900);})' +
    ' .withFailureHandler(function(err){document.getElementById("status").textContent=err&&err.message?err.message:String(err);})' +
    ' .completeSetupFromPopup({goal:goal,entryPoint:entryPoint,fields:fields});}' +
    'function skipSetup(){google.script.run.withSuccessHandler(function(){google.script.host.close();}).completeSetupFromPopup({goal:"skipped",entryPoint:"skip",fields:{}});}' +
    '</script>';
}

function splitInputList(value) {
  return String(value || '').split(/[,\n]/).map(function (x) { return x.trim(); }).filter(String);
}

// v7.4: checklist items carry a `workflow` (matched against
// COLS.TODO.WORKFLOW) so checkAutoCompletion can resolve them by identity
// rather than exact display text — see checkAutoCompletion. `text` is
// kept only as a legacy-text fallback for profiles saved before this
// version, which never had a `workflow` field.
function setupChecklistFor(entryPoint, fields) {
  if (entryPoint === 'sectors') {
    return [{
      workflow: 'Sector selection',
      label: 'List 2-4 sub-sectors worth exploring',
      text: 'List 2-4 sub-sectors worth exploring',
      tab: 'Today',
      notes: 'Adding a Sub-sector on Sectors raises a Decision asking whether to build an org list there.'
    }];
  }
  var map = {
    jobs: [{ workflow: 'Application preparation', label: 'Prep application for the captured job', text: 'Prep application for the captured job', tab: 'Tasks', notes: 'Want-to-apply jobs create application prep automatically.' }],
    applications: [{ workflow: 'Check application response', label: 'Check application response', text: 'Check application response', tab: 'Tasks', notes: 'Due from the real applied date + 12 days.' }],
    interviews: [{ workflow: 'Interview scheduling', altWorkflows: ['Interview prep (Domain scoping)', 'Interview prep (Fit case)', 'Day-before review'], label: 'Prepare for the scheduled interview', text: 'Prepare for the scheduled interview', tab: 'Tasks', notes: 'The interview round owns prep timing and follow-up.' }],
    people: [{ workflow: 'Outreach', altWorkflows: ['Send outreach', 'Contact follow-up', 'Reply and arrange conversation'], label: 'Work the next people action', text: 'Work the next people action', tab: 'Tasks', notes: 'Draft outreach, follow up, or arrange a conversation depending on stage.' }],
    // Org onboarding never creates a Task (it only classifies Organisations
    // rows) — there is no task-based completion signal to check, so this
    // item is always considered acknowledged once onboarding runs it.
    orgs: [{ alwaysDone: true, label: 'Review classified organisations', text: 'Review classified organisations', tab: 'Organisations', notes: 'The status you selected was applied as-is; Active only ever suggests people/job-search work.' }],
    not_sure: [{ workflow: 'Admin', label: 'Clarify the most live part of the search', text: 'Clarify the most live part of the search', tab: 'Tasks', notes: 'Pick one anchor: interview, application, job, person, organisation, or sector.' }]
  };
  return map[entryPoint] || map.not_sure;
}

function processOnboardingCapture(goal, entryPoint, fields) {
  if (goal === 'skipped' || entryPoint === 'skip') return { message: 'Setup skipped. You can run onboarding again from the menu any time.' };
  if (entryPoint === 'sectors') return processSectorOnboarding(fields);
  if (entryPoint === 'interviews') return processInterviewOnboarding(fields);
  if (entryPoint === 'applications') return processApplicationOnboarding(fields);
  if (entryPoint === 'jobs') return processJobOnboarding(fields);
  if (entryPoint === 'people') return processPeopleOnboarding(fields);
  if (entryPoint === 'orgs') return processOrgOnboarding(fields);
  return processNotSureOnboarding(fields);
}

// Sector onboarding uses the exact same upsertSectorBranch/
// fireSectorOnlyTask path as manual sheet entry — this is what keeps
// popup capture and direct typing behaviorally identical.
function processSectorOnboarding(fields, source) {
  source = source || 'onboarding';
  var sectors = splitInputList(fields.sectorNames);
  if (!sectors.length) {
    fireSectorOnlyTask('your first sector');
    return { message: 'Added the sector-picking task to Today.' };
  }
  sectors.slice(0, 2).forEach(function (sector) {
    var branch = upsertSectorBranch({ sector: sector, source: source, createExpansionDecision: false });
    fireSectorOnlyTask(branch);
  });
  return { message: 'Added ' + Math.min(sectors.length, 2) + ' sector(s) and the sub-sector task.' };
}

function processApplicationOnboarding(fields) {
  if (!fields.org) return { message: 'I need the organisation name to capture an application.' };
  var org = createNameOnlyOrg(fields.org || '', { status: 'Mapped', stub: true });
  if (!fields.jobTitle) return { message: 'I need at least a job title to capture an application.' };
  var jobId = writeJobRow(fields.jobTitle, org, 'Applied');
  fireJobStatusChanged(jobId, '', 'Applied', { realDate: fields.appliedDate || today() });
  if (fields.urlNotes) appendNoteFlag(getSheet('Jobs'), getJobRowById(jobId).row, COLS.JOBS.NOTES, fields.urlNotes);
  return { message: 'Captured the application and created the response-check follow-up.' };
}

function processJobOnboarding(fields) {
  if (!fields.jobTitle) return { message: 'I need at least a job title to capture a job.' };
  if (!fields.org) return { message: 'I need the organisation name to capture a job.' };
  var org = createNameOnlyOrg(fields.org || '', { status: 'Mapped', stub: true });
  var jobId = writeJobRow(fields.jobTitle, org, 'Want to apply');
  if (fields.deadline) getSheet('Jobs').getRange(getJobRowById(jobId).row, COLS.JOBS.DEADLINE).setValue(fields.deadline);
  if (fields.urlNotes) appendNoteFlag(getSheet('Jobs'), getJobRowById(jobId).row, COLS.JOBS.NOTES, fields.urlNotes);
  fireJobStatusChanged(jobId, '', 'Want to apply', {});
  return { message: 'Captured the job and routed the next application work to Today/Decisions.' };
}

function processInterviewOnboarding(fields) {
  if (!fields.jobTitle) return { message: 'I need at least a job title to capture an interview.' };
  if (!fields.org) return { message: 'I need the organisation name to capture an interview.' };
  var org = createNameOnlyOrg(fields.org || '', { status: 'Mapped', stub: true });
  var jobId = writeJobRow(fields.jobTitle, org, 'Interviewing');
  fireJobStatusChanged(jobId, '', 'Interviewing', {
    forceRound: true,
    roundDetails: { roundNum: fields.roundNumber || '1', roundType: fields.roundType || 'Other', interviewDate: fields.interviewDate || '', domainReadiness: fields.domainReadiness || '' }
  });
  return { message: 'Captured the interview and created the prep path.' };
}

// v7.1: relationship type is now captured and written to People if the
// user supplied one (fields.relType), instead of being silently dropped.
function processPeopleOnboarding(fields) {
  if (!fields.name) return { message: 'I need at least a name to capture this person.' };
  if (!fields.org) return { message: 'I need the organisation name to capture this person.' };
  var org = fields.org ? createNameOnlyOrg(fields.org, { status: 'Mapped', stub: true }) : null;
  var reached = String(fields.reachedOut || 'No') === 'Yes';
  var replied = String(fields.replied || 'No') === 'Yes';
  var stage = 'Identified', realDate = null;
  if (reached && !replied) { stage = 'Outreach sent'; realDate = fields.outreachDate; }
  if (reached && replied) {
    var where = fields.whereNow || '';
    if (where === 'Conversation scheduled') { stage = 'Conversation scheduled'; realDate = fields.conversationDate; }
    else if (where === 'Already spoke') { stage = 'Conversation completed'; realDate = fields.conversationDate; }
    else stage = 'Engaged';
  }
  var personId = writePersonRow(fields.name, org, fields.role || '');
  if (fields.relType && DROPDOWNS.PERSON_REL_TYPE.indexOf(fields.relType) !== -1) {
    var pRow = getPersonRowById(personId);
    if (pRow) getSheet('People').getRange(pRow.row, COLS.PEOPLE.REL_TYPE).setValue(fields.relType);
  }
  firePersonStageChanged(personId, '', stage, { realDate: realDate });
  if (fields.notes) appendNoteFlag(getSheet('People'), getPersonRowById(personId).row, COLS.PEOPLE.NOTES, fields.notes);
  return { message: 'Captured the person and routed the outreach/follow-up state.' };
}

// v7.1: honors the Status the user explicitly picked (Mapped/Active/
// Dormant/Archived) instead of always forcing Mapped. Active still only
// ever creates the two Pending Decisions via createNameOnlyOrg ->
// fireOrgActiveCascade — never a direct search Task.
function processOrgOnboarding(fields) {
  var names = splitInputList(fields.orgNames);
  if (!names.length) return { message: 'I need at least one organisation name to capture this.' };
  var status = (fields.status && DROPDOWNS.ORG_STATUS.indexOf(fields.status) !== -1) ? fields.status : 'Mapped';
  names.forEach(function (name) {
    var org = createNameOnlyOrg(name, { status: status, tier: fields.tier || 'B' });
    applyOrganisationStatusFromCapture(org, status, fields.tier || 'B');
    if (org && (fields.sector || fields.subsector)) applyOrgTaxonomyLink(org.row, fields.sector || '', fields.subsector || '');
  });
  var suffix = status === 'Active' ? ' Marked Active — a Decision to find people/scan jobs was created for each (not a direct Task).' : ' Status: ' + status + '.';
  return { message: 'Captured ' + names.length + ' organisation(s).' + suffix };
}

function processNotSureOnboarding(fields) {
  appendTodo('Clarify what is most live in the search', 'None', '', '', 'Admin', 'Not started', '', '15 min',
    fields.notes || 'Pick the most time-sensitive object: interview, application, job, person, organisation, or sector.');
  return { message: 'Added a light clarification task to Today.' };
}

function writeJobRow(title, org, status) {
  var sheet = getSheet('Jobs');
  var existing = findJobByTitleOrg(title, org ? org.name : '');
  if (existing) return existing.data[COLS.JOBS.ID - 1];
  var id = nextId(sheet, COLS.JOBS.ID, 'JOB');
  var row = new Array(HEADERS.Jobs.length).fill('');
  row[COLS.JOBS.ID - 1] = id;
  row[COLS.JOBS.OPPORTUNITY - 1] = title;
  row[COLS.JOBS.ORG - 1] = org ? org.name : '';
  row[COLS.JOBS.ORG_ID - 1] = org ? org.id : '';
  row[COLS.JOBS.STATUS - 1] = status;
  sheet.appendRow(row);
  return id;
}

function writePersonRow(name, org, role) {
  var sheet = getSheet('People');
  var existing = findPersonByNameOrg(name, org ? org.name : '');
  if (existing) return existing.data[COLS.PEOPLE.ID - 1];
  var id = nextId(sheet, COLS.PEOPLE.ID, 'PER');
  var row = new Array(HEADERS.People.length).fill('');
  row[COLS.PEOPLE.ID - 1] = id;
  row[COLS.PEOPLE.NAME - 1] = name;
  row[COLS.PEOPLE.ORG - 1] = org ? org.name : '';
  row[COLS.PEOPLE.ORG_ID - 1] = org ? org.id : '';
  row[COLS.PEOPLE.ROLE - 1] = role || '';
  row[COLS.PEOPLE.FOLLOW_UPS_SENT_COUNT - 1] = 0;
  sheet.appendRow(row);
  return id;
}

// Called from the popup. Wipes existing data (unless skipped), captures
// the new facts, rebuilds the checklist, and refreshes Today/Home.
function completeSetupFromPopup(payload) {
  payload = payload || {};
  var goal = payload.goal || 'skipped';
  var entryPoint = payload.entryPoint || 'skip';
  var fields = payload.fields || {};
  if (goal !== 'skipped' && entryPoint !== 'skip') resetPlannerDataForOnboarding();

  var result = processOnboardingCapture(goal, entryPoint, fields);
  var checklist = (goal === 'skipped' || entryPoint === 'skip') ? [] : setupChecklistFor(entryPoint, fields);
  saveSetupProfile({ goal: goal, entryPoint: entryPoint, checklist: checklist, capturedAt: new Date().toISOString() });

  populateToday();
  refreshHome();
  colorCodeManualFields();
  applyStatusColorCoding();
  applyColumnLayout();
  applyColumnWidths();

  var todaySheet = getSheet('Today');
  if (todaySheet) SpreadsheetApp.setActiveSheet(todaySheet);
  var suffix = (goal !== 'skipped' && entryPoint !== 'skip') ? ' Existing planner data was cleared first.' : '';
  return (result.message || 'Onboarding saved.') + suffix;
}

// =============================================================
// TODAY — Add/update intake popups (non-destructive, ongoing capture)
// =============================================================

function todayUpdateTypeToCapture(updateType) {
  var map = {
    'Explore sectors': 'Explore sectors',
    'Find organisations': 'Find organisations',
    'Add/update organisation': 'Add/update organisation',
    'Add/update job': 'Add/update job',
    'Application update': 'Application update',
    'Add/update person': 'Add/update person',
    'Add/update conversation': 'Add/update conversation',
    'Add/update interview': 'Add/update interview',
    'Task completed / blocked': 'Task completed / blocked'
  };
  return map[updateType] || '';
}

function captureConfig(captureType) {
  var roundTypes = DROPDOWNS.ROUND_TYPE, domain = DROPDOWNS.DOMAIN_READINESS, jobStatuses = DROPDOWNS.JOB_STATUS;
  var config = {
    'Explore sectors': { title: 'Explore sectors', fields: [{ k: 'sectorNames', l: 'Sector(s) to explore', t: 'textarea' }] },
    'Find organisations': {
      title: 'Add organisations found from exploration',
      fields: [{ k: 'sector', l: 'Sector', t: 'text' }, { k: 'subsector', l: 'Sub-sector', t: 'text' },
      { k: 'orgNames', l: 'Organisation names', t: 'textarea', p: 'One per line, or comma-separated' }]
    },
    'Add/update organisation': {
      title: 'Add/update organisation',
      fields: [{ k: 'orgNames', l: 'Organisation name(s)', t: 'textarea', p: 'One per line, or comma-separated' },
      { k: 'sector', l: 'Sector, if known', t: 'text' }, { k: 'subsector', l: 'Sub-sector, if known', t: 'text' },
      { k: 'tier', l: 'Tier', t: 'select', o: ['B', 'A', 'C'] }, { k: 'status', l: 'Status', t: 'select', o: DROPDOWNS.ORG_STATUS }]
    },
    'Add/update job': {
      title: 'Add/update job',
      fields: [{ k: 'org', l: 'Organisation', t: 'text' }, { k: 'jobTitle', l: 'Job title / opportunity', t: 'text' },
      { k: 'status', l: 'Status', t: 'select', o: jobStatuses }, { k: 'deadline', l: 'Deadline, if any', t: 'date' },
      { k: 'appliedDate', l: 'Applied date, if already applied', t: 'date' }, { k: 'urlNotes', l: 'URL / source / notes', t: 'textarea' },
      { k: 'roundNumber', l: 'Round number, if interviewing', t: 'text', p: '1' }, { k: 'roundType', l: 'Round type, if interviewing', t: 'select', o: roundTypes },
      { k: 'interviewDate', l: 'Interview date, if known', t: 'date' }, { k: 'domainReadiness', l: 'Domain readiness, if interviewing', t: 'select', o: domain }]
    },
    'Application update': {
      title: 'Application update',
      fields: [{ k: 'org', l: 'Organisation', t: 'text' }, { k: 'jobTitle', l: 'Job title / opportunity', t: 'text' },
      { k: 'status', l: 'Current status', t: 'select', o: ['Applied', 'Interviewing', 'Offer', 'Parked', 'Closed'] },
      { k: 'appliedDate', l: 'Applied date, if missing', t: 'date' }, { k: 'response', l: 'Response received?', t: 'select', o: ['', 'Yes', 'No'] },
      { k: 'outcome', l: 'Outcome / latest update', t: 'text' }]
    },
    'Add/update person': {
      title: 'Add/update person',
      fields: [{ k: 'name', l: 'Name', t: 'text' }, { k: 'org', l: 'Organisation', t: 'text' }, { k: 'role', l: 'Role/title, if known', t: 'text' },
      { k: 'relType', l: 'Relationship type', t: 'select', o: DROPDOWNS.PERSON_REL_TYPE },
      { k: 'reachedOut', l: 'Have you already reached out?', t: 'select', o: ['No', 'Yes'] }, { k: 'replied', l: 'Have they replied?', t: 'select', o: ['No', 'Yes'] },
      { k: 'outreachDate', l: 'When did you reach out?', t: 'date' },
      { k: 'whereNow', l: 'If they replied, where are things now?', t: 'select', o: ['Need to respond / arrange next step', 'Conversation scheduled', 'Already spoke'] },
      { k: 'conversationDate', l: 'Conversation date, if scheduled/completed', t: 'date' }, { k: 'notes', l: 'Notes/source', t: 'textarea' }]
    },
    'Add/update conversation': {
      title: 'Add/update conversation',
      fields: [{ k: 'person', l: 'Person', t: 'text' }, { k: 'org', l: 'Organisation', t: 'text' }, { k: 'date', l: 'Date', t: 'date' },
      { k: 'notes', l: 'Notes', t: 'textarea' }, { k: 'outcome', l: 'Outcome', t: 'select', o: DROPDOWNS.INTERACTION_OUTCOME }]
    },
    'Add/update interview': {
      title: 'Add/update interview',
      fields: [{ k: 'org', l: 'Organisation', t: 'text' }, { k: 'jobTitle', l: 'Job title / opportunity', t: 'text' },
      { k: 'roundNumber', l: 'Round number', t: 'text', p: '1' }, { k: 'roundType', l: 'Round type', t: 'select', o: roundTypes },
      { k: 'interviewDate', l: 'Interview date', t: 'date' }, { k: 'domainReadiness', l: 'Domain readiness', t: 'select', o: domain },
      { k: 'officialOutcome', l: 'Official outcome, if known', t: 'select', o: DROPDOWNS.OFFICIAL_OUTCOME }]
    },
    'Task completed / blocked': { title: 'Task completed / blocked', fields: [{ k: 'taskNotes', l: 'What changed?', t: 'textarea', p: 'If a task is done, tick it Done on Today instead. Use this for a blocker or a new follow-up.' }] }
  };
  return config[captureType] || config['Task completed / blocked'];
}

function buildCaptureHtml(captureType) {
  var cfg = captureConfig(captureType);
  var json = JSON.stringify({ captureType: captureType, title: cfg.title, fields: cfg.fields });
  return '' +
    '<style>' +
    'body{font-family:Arial,sans-serif;padding:22px;color:#28251D;background:#FBFBF9;}' +
    'h2{margin:0 0 8px;color:#1B474D;font-size:20px;}p{color:#5F625E;font-size:13px;margin:6px 0 14px;}' +
    'label{display:block;margin-top:12px;font-size:12px;font-weight:bold;color:#1B474D;}' +
    'input,textarea,select{box-sizing:border-box;width:100%;margin-top:5px;padding:9px;border:1px solid #D8DAD4;border-radius:5px;font-size:13px;}' +
    'textarea{min-height:64px;resize:vertical;}.primary{margin-top:18px;padding:10px 14px;border:0;border-radius:5px;background:#01696F;color:#FFF;font-weight:bold;cursor:pointer;}' +
    '#status{font-size:12px;color:#5F625E;margin-top:10px;}</style>' +
    '<h2 id="title"></h2><p>This updates the matching source tab in the background, then refreshes Today.</p>' +
    '<form id="form"></form><button class="primary" type="button" onclick="submitCapture()">Save</button><div id="status"></div>' +
    '<script>var cfg=' + json + ';document.getElementById("title").textContent=cfg.title;var f=document.getElementById("form");' +
    'cfg.fields.forEach(function(field){var label=document.createElement("label");label.textContent=field.l;var input;' +
    'if(field.t==="textarea"){input=document.createElement("textarea");}' +
    'else if(field.t==="select"){input=document.createElement("select");(field.o||[]).forEach(function(v){var opt=document.createElement("option");opt.value=v;opt.textContent=v;input.appendChild(opt);});}' +
    'else{input=document.createElement("input");input.type=field.t||"text";}' +
    'input.name=field.k;if(field.p)input.placeholder=field.p;label.appendChild(input);f.appendChild(label);});' +
    'function submitCapture(){var fields={};Array.prototype.forEach.call(document.getElementById("form").elements,function(el){if(el.name)fields[el.name]=el.value;});' +
    'document.getElementById("status").textContent="Saving...";' +
    'google.script.run.withSuccessHandler(function(msg){document.getElementById("status").textContent=msg||"Saved.";setTimeout(function(){google.script.host.close();},700);})' +
    '.withFailureHandler(function(err){document.getElementById("status").textContent=err&&err.message?err.message:String(err);})' +
    '.completeCaptureFromPopup({captureType:cfg.captureType,fields:fields});}</script>';
}

function runCapturePopup(captureType) {
  if (!captureType || captureType === 'No updates') return;
  var html = HtmlService.createHtmlOutput(buildCaptureHtml(captureType)).setWidth(600).setHeight(600).setTitle(captureType);
  SpreadsheetApp.getUi().showModalDialog(html, captureType);
}

function completeCaptureFromPopup(payload) {
  payload = payload || {};
  var message = processCapturePayload(payload.captureType, payload.fields || {});
  populateToday();
  refreshHome();
  renderTodayDecisionCards();
  colorCodeManualFields();
  applyStatusColorCoding();
  applyColumnLayout();
  applyColumnWidths();
  SpreadsheetApp.getActiveSpreadsheet().toast('Planner updated — Tasks and Today refreshed.', 'The Planner', 4);
  return message || 'Saved and refreshed Today.';
}

function processCapturePayload(captureType, fields) {
  if (captureType === 'Explore sectors') return processSectorOnboarding(fields, 'home_update').message;
  if (captureType === 'Find organisations') {
    var names = splitInputList(fields.orgNames);
    names.forEach(function (name) {
      var org = createNameOnlyOrg(name, { status: 'Mapped', tier: 'B' });
      if (org && (fields.sector || fields.subsector)) applyOrgTaxonomyLink(org.row, fields.sector || '', fields.subsector || '');
    });
    return 'Captured ' + names.length + ' organisation(s) found from exploration.';
  }
  if (captureType === 'Add/update organisation') return processOrgOnboarding(fields).message;
  if (captureType === 'Add/update job' || captureType === 'Application update') return processJobCapture(fields);
  if (captureType === 'Add/update person') return processPeopleOnboarding(fields).message;
  if (captureType === 'Add/update conversation') {
    var org = fields.org ? createNameOnlyOrg(fields.org, { status: 'Mapped', stub: true }) : null;
    var person = findPersonByNameOrg(fields.person, org ? org.name : '');
    var personId = person ? person.data[COLS.PEOPLE.ID - 1] : writePersonRow(fields.person || 'Unknown', org, '');
    appendInteraction(personId, fields.person || '', org ? org.name : (fields.org || ''), fields.date || today(), 'Other', fields.notes || '', fields.outcome || 'Useful');
    if (fields.outcome) {
      var sheet = getSheet('Conversations');
      onEditInteractions(sheet, sheet.getLastRow(), COLS.INTERACTIONS.OUTCOME, fields.outcome);
    }
    return 'Captured the conversation update.';
  }
  if (captureType === 'Add/update interview') return processInterviewOnboarding(fields).message;
  if (captureType === 'Task completed / blocked') {
    appendTodo('Resolve blocker / next action', 'None', '', '', 'Admin', 'Not started', '', '15 min', fields.taskNotes || '');
    return 'Captured the blocker as a task.';
  }
  return 'Nothing captured.';
}

function processJobCapture(fields) {
  if (!fields.jobTitle) return 'I need at least a job title.';
  if (!fields.org) return 'I need the organisation name before I can route this job/application.';
  var org = createNameOnlyOrg(fields.org || '', { status: 'Mapped', stub: true });
  var status = normalizeJobStatus(fields.status || 'Want to apply');
  var jobId = writeJobRow(fields.jobTitle, org, status);
  var job = getJobRowById(jobId);
  var sheet = getSheet('Jobs');
  if (fields.deadline) sheet.getRange(job.row, COLS.JOBS.DEADLINE).setValue(fields.deadline);
  if (fields.urlNotes) appendNoteFlag(sheet, job.row, COLS.JOBS.NOTES, fields.urlNotes);
  var opts = { realDate: fields.appliedDate || '' };
  if (status === 'Interviewing') opts.roundDetails = { roundNum: fields.roundNumber || '1', roundType: fields.roundType || 'Other', interviewDate: fields.interviewDate || '', domainReadiness: fields.domainReadiness || '' };
  fireJobStatusChanged(jobId, '', status, opts);
  job = getJobRowById(jobId);
  if (fields.response) sheet.getRange(job.row, COLS.JOBS.RESPONSE).setValue(fields.response);
  if (fields.outcome) {
    sheet.getRange(job.row, COLS.JOBS.OUTCOME).setValue(fields.outcome);
    if (!sheet.getRange(job.row, COLS.JOBS.RESPONSE).getValue()) sheet.getRange(job.row, COLS.JOBS.RESPONSE).setValue('Yes');
  }
  if (fields.response === 'Yes' || fields.outcome) createJobResponseOutcomeDecision(jobId, 'Job update captured: ' + fields.jobTitle);
  return 'Captured the job/application update.';
}

// =============================================================
// VISUAL POLISH — rich-text guidance headers, manual/auto shading,
// status colour coding, hidden backend columns, tab zones
// =============================================================

var HEADER_GUIDANCE = {
  'Sectors': {
    'Sector ID': 'system', 'Status': 'Open / Retired', 'Notes': 'trace and repair flags',
    'Sub-sector ID': 'system', 'Sector': '1. Broad area — add sector-only rows first', 'Sub-sector': '2. Narrow hunting ground — raises a Decision to build an org list'
  },
  'Organisations': {
    'Org ID': 'system', 'Organisation': '1. Type the name', 'Sector': '2. Link to Sectors taxonomy', 'Sub-sector': '3. Link or create',
    'Sub-sector ID': 'system', 'Tier': 'A/B/C, optional', 'Status': 'Mapped (default) / Active / Dormant / Archived',
    'Known people (count)': 'formula', 'Open opportunities (count)': 'formula', 'Last checked': 'system', 'Next check date': 'system', 'Notes': 'context, links, why it matters'
  },
  'People': {
    'Person ID': 'system', 'Name': 'Type a contact name; Organisation unlocks outreach tasks', 'Organisation': '2. Type org — stub created if needed', 'Org ID': 'system',
    'Role': 'optional', 'Relationship type': 'optional',
    'Stage': 'Identified / Outreach sent / Engaged / Conversation scheduled / Conversation completed / Nurture / Closed',
    'Follow-up date': 'auto or manual',
    'Reply received': 'Yes/No when known', 'Follow-up sent?': 'system', 'Outreach date': 'real outreach date', 'Conversation date': 'scheduled or completed date',
    'Notes': 'source, context, next angle', 'Follow-ups sent count': 'system'
  },
  'Jobs': {
    'Job ID': 'system', 'Opportunity': '1. Job title', 'Organisation': '2. Type org — stub created if needed', 'Org ID': 'system',
    'Status': 'Want to apply / Applied / Interviewing / Offer / Parked / Closed', 'Deadline': 'needed for Want to apply', 'Applied date': 'backend date for response checks',
    'Linked contacts (IDs)': 'system', 'Linked contacts (display)': 'people known at this org', 'Review date': 'backend follow-up date',
    'Response received': 'Set Yes when any response arrives; the system will ask for the outcome',
    'Outcome': 'Entering an outcome marks Response received = Yes. Result or close reason.',
    'Notes': 'URL/source and prep notes'
  },
  'Interactions': {
    'Interaction ID': 'system', 'Date': 'conversation date', 'Person ID': 'system', 'Person': 'pick or type person', 'Organisation': 'auto from person',
    'Type': 'call, email, message, referral, etc.', 'Key notes': 'what changed', 'Outcome': 'drives follow-up decisions'
  },
  'To-do': {
    'Task ID': 'system', 'Task': 'Master task queue — inspect, repair, audit', 'Linked object type': 'system', 'Linked object ID': 'system', 'Org': 'system', 'Workflow type': 'system',
    'Status': 'Done routes through the completion engine', 'Due date': 'auto or manual', 'Time estimate': 'planning size', 'Notes': 'why/context',
    'Parent To-do ID': 'system', 'Created': 'system', 'Completed': 'system', 'Commitment class': 'Fixed/Blocking/Keep-alive/Active pursuit/Pipeline-building/Backlog', 'Source': 'auto/manual/onboarding/decision',
    'Last edited': 'system', 'Class calculated at': 'system', 'Effort type': 'auto',
    'Priority rank': '1=Fixed … 6=Backlog, sort ascending', 'Linked to': 'jumps to the source row', 'On Today right now': 'auto', 'Has sub-tasks': 'auto'
  },
  'Interview rounds': {
    'Round ID': 'system', 'Linked Job ID': 'system', 'Job (display)': 'auto', 'Org (display)': 'auto', 'Round': 'round number', 'Round type': 'recruiter, case, panel, etc.',
    'Interview date': 'scheduled date', 'Status': 'scheduled/completed/cancelled', 'Domain readiness': 'drives prep tasks', 'Official outcome': 'waiting/next/rejected/offer',
    'Expected response date': 'follow-up timing', 'Notes': 'prep, people, logistics'
  },
  "Today's plan": {
    'Slot': 'Commit or option', 'Task': 'selected from Tasks', 'Linked Task ID': 'system', 'Estimated min': 'planned time', 'Plan': 'Commit or Option',
    'Effort': 'light/medium/deep', 'Status': 'tick Done here', 'Actual min': 'optional', 'Why / notes': 'which stage of the priority waterfall selected this — anything you add after it is kept on refresh'
  },
  'Pending decisions': {
    'Decision ID': 'system', 'Created': 'system', 'Decision key': 'system', 'Trigger': 'what happened', 'Suggested task': 'what could happen next',
    'Target type': 'linked object type', 'Target ID': 'system', 'Suggested workflow': 'cascade type', 'Notes': 'context',
    'Decision': 'Pending / Yes / No / Auto-dismissed', 'Decided at': 'system', 'Resulting To-do ID': 'system'
  }
};

function applyRichTextHeaders(canonicalName) {
  var headerKey = SHEET_TO_HEADER_KEY[canonicalName];
  var sheet = getSheet(canonicalName);
  var headers = HEADERS[headerKey];
  var guidance = HEADER_GUIDANCE[headerKey];
  if (!sheet || !headers || !guidance) return;
  var headerRow = (canonicalName === 'Today') ? TODAY_TABLE_HEADER_ROW : 1;
  for (var c = 0; c < headers.length; c++) {
    var name = headers[c];
    var hint = guidance[name] || '';
    var cell = sheet.getRange(headerRow, c + 1);
    if (hint) {
      var fullText = name + '\n' + hint;
      cell.setRichTextValue(SpreadsheetApp.newRichTextValue().setText(fullText)
        .setTextStyle(0, name.length, SpreadsheetApp.newTextStyle().setBold(true).setFontSize(10).setForegroundColor('#FFFFFF').build())
        .setTextStyle(name.length + 1, fullText.length, SpreadsheetApp.newTextStyle().setBold(false).setItalic(true).setFontSize(8).setForegroundColor('#D4D1CA').build())
        .build());
    } else {
      cell.setValue(name).setFontWeight('bold').setFontColor('#FFFFFF').setFontSize(10);
    }
    cell.setBackground(HEADER_COLOR).setVerticalAlignment('top').setWrap(true);
  }
  sheet.setRowHeight(headerRow, 44);
  sheet.setFrozenRows(headerRow);
}

function applyAllRichTextHeaders() {
  CANONICAL_TAB_ORDER.forEach(function (name) { if (SHEET_TO_HEADER_KEY[name]) applyRichTextHeaders(name); });
}

var MANUAL_COLUMNS = {
  'Sectors': [COLS.SECTORS.SECTOR, COLS.SECTORS.SUBSECTOR, COLS.SECTORS.STATUS, COLS.SECTORS.NOTES],
  'Organisations': [COLS.ORGS.NAME, COLS.ORGS.SECTOR, COLS.ORGS.SUBSECTOR, COLS.ORGS.TIER, COLS.ORGS.STATUS, COLS.ORGS.NOTES],
  'People': [COLS.PEOPLE.NAME, COLS.PEOPLE.ORG, COLS.PEOPLE.ROLE, COLS.PEOPLE.REL_TYPE, COLS.PEOPLE.STAGE, COLS.PEOPLE.FOLLOW_UP_DATE, COLS.PEOPLE.REPLY_RECEIVED, COLS.PEOPLE.CONVERSATION_DATE, COLS.PEOPLE.NOTES],
  'Jobs': [COLS.JOBS.OPPORTUNITY, COLS.JOBS.ORG, COLS.JOBS.STATUS, COLS.JOBS.DEADLINE, COLS.JOBS.RESPONSE, COLS.JOBS.OUTCOME, COLS.JOBS.NOTES],
  'Interactions': [COLS.INTERACTIONS.DATE, COLS.INTERACTIONS.PERSON, COLS.INTERACTIONS.TYPE, COLS.INTERACTIONS.NOTES, COLS.INTERACTIONS.OUTCOME],
  'To-do': [COLS.TODO.TASK, COLS.TODO.STATUS, COLS.TODO.DUE_DATE, COLS.TODO.TIME_EST, COLS.TODO.NOTES],
  'Interview rounds': [COLS.ROUNDS.ROUND, COLS.ROUNDS.ROUND_TYPE, COLS.ROUNDS.INTERVIEW_DATE, COLS.ROUNDS.STATUS, COLS.ROUNDS.DOMAIN_READINESS, COLS.ROUNDS.OFFICIAL_OUTCOME, COLS.ROUNDS.EXPECTED_RESPONSE, COLS.ROUNDS.NOTES],
  'Pending decisions': [COLS.DECISIONS.DECISION, COLS.DECISIONS.NOTES]
};

var COLUMN_WIDTHS = {
  'Sectors': { 2: 190, 3: 260, 4: 100, 5: 300 },
  'Organisations': { 2: 220, 3: 170, 4: 220, 6: 70, 7: 120, 8: 135, 9: 165, 12: 300 },
  'People': { 2: 190, 3: 200, 5: 170, 6: 150, 7: 175, 8: 125, 9: 120, 12: 135, 13: 300 },
  'Jobs': { 2: 260, 3: 200, 5: 145, 6: 120, 9: 220, 11: 130, 12: 170, 13: 320 },
  'Interactions': { 2: 120, 4: 190, 5: 200, 6: 150, 7: 320, 8: 160 },
  'To-do': { 2: 340, 7: 125, 8: 120, 9: 115, 10: 320, 14: 130, 19: 70, 20: 200, 21: 100, 22: 100 },
  'Interview rounds': { 3: 220, 4: 190, 5: 80, 6: 140, 7: 125, 8: 125, 9: 150, 10: 145, 11: 145, 12: 300 },
  "Today's plan": { 1: 80, 2: 340, 4: 110, 5: 100, 6: 100, 7: 120, 8: 100, 9: 340 },
  'Pending decisions': { 4: 250, 5: 320, 6: 130, 8: 160, 9: 300, 10: 130 }
};

var WRAP_COLUMNS = {
  'Sectors': [COLS.SECTORS.SUBSECTOR, COLS.SECTORS.NOTES], 'Organisations': [COLS.ORGS.NOTES], 'People': [COLS.PEOPLE.NOTES],
  'Jobs': [COLS.JOBS.OPPORTUNITY, COLS.JOBS.OUTCOME, COLS.JOBS.NOTES], 'Interactions': [COLS.INTERACTIONS.NOTES],
  'To-do': [COLS.TODO.TASK, COLS.TODO.NOTES], 'Interview rounds': [COLS.ROUNDS.NOTES],
  "Today's plan": [COLS.TODAY.TASK, COLS.TODAY.NOTES], 'Pending decisions': [COLS.DECISIONS.TASK, COLS.DECISIONS.NOTES]
};

var STATUS_COLOR_MAP = {
  'Sectors': { col: COLS.SECTORS.STATUS, colors: { 'Open': '#FFFFFF', 'Retired': '#F1F3F4' } },
  'Organisations': { col: COLS.ORGS.STATUS, colors: { 'Mapped': '#E8EAED', 'Active': '#CEEAD6', 'Dormant': '#FEF7CD', 'Archived': '#F1F3F4' } },
  'People': { col: COLS.PEOPLE.STAGE, colors: { 'Identified': '#E8EAED', 'Outreach sent': '#C2DBFF', 'Engaged': '#CEEAD6', 'Conversation scheduled': '#D7BCE8', 'Conversation completed': '#B6E3E0', 'Nurture': '#FEF7CD', 'Closed': '#F1F3F4' } },
  'Jobs': { col: COLS.JOBS.STATUS, colors: { 'Want to apply': '#C2DBFF', 'Applied': '#B6E3E0', 'Interviewing': '#D7BCE8', 'Offer': '#CEEAD6', 'Parked': '#FEF7CD', 'Closed': '#F1F3F4' } },
  'To-do': { col: COLS.TODO.STATUS, colors: { 'Not started': '#FFFFFF', 'In progress': '#FEF7CD', 'Done': '#CEEAD6', 'Skipped': '#F1F3F4', 'Cancelled': '#F1F3F4' } },
  "Today's plan": { col: COLS.TODAY.STATUS, colors: { 'Planned': '#FFFFFF', 'In progress': '#FEF7CD', 'Done': '#CEEAD6', 'Deferred': '#F1F3F4', 'Skipped': '#F1F3F4' } },
  'Pending decisions': { col: COLS.DECISIONS.DECISION, colors: { 'Pending': '#FEF7CD', 'Yes': '#CEEAD6', 'No': '#F1F3F4', 'Auto-dismissed': '#F1F3F4' } }
};

var COMMITMENT_CLASS_COLORS = { 'Fixed': '#F6C7C3', 'Blocking': '#FDE9D9', 'Keep-alive': '#D2E3FC', 'Active pursuit': '#CEEAD6', 'Pipeline-building': '#E6F4EA', 'Backlog': '#F1F3F4' };

// v7.6.3 §4.5: Organisations already has one STATUS_COLOR_MAP entry (its
// Status column) — Tier is a second, independent column on the same
// sheet, so it gets its own small parallel block below, same idiom as
// COMMITMENT_CLASS_COLORS for Tasks.
var TIER_COLOR_MAP = { 'A': '#CEEAD6', 'B': '#FEF7CD', 'C': '#F1F3F4' };

function colorCodeManualFields() {
  Object.keys(MANUAL_COLUMNS).forEach(function (headerKey) {
    var canonical = Object.keys(SHEET_TO_HEADER_KEY).filter(function (n) { return SHEET_TO_HEADER_KEY[n] === headerKey; })[0];
    var sheet = getSheet(canonical);
    if (!sheet) return;
    var headers = HEADERS[headerKey];
    var startRow = (canonical === 'Today') ? TODAY_TABLE_FIRST_ROW : 2;
    var bodyRows = Math.max(sheet.getMaxRows() - startRow + 1, 40);
    sheet.getRange(startRow, 1, bodyRows, headers.length).setBackground(AUTO_COLOR);
    MANUAL_COLUMNS[headerKey].forEach(function (col) {
      try { sheet.getRange(startRow, col, bodyRows, 1).setBackground(MANUAL_COLOR); } catch (err) { }
    });
  });
  var todaySheet = getSheet('Today');
  if (todaySheet) {
    [TODAY_CELLS.PRIORITY, TODAY_CELLS.AVAILABLE_MIN, TODAY_CELLS.ENERGY].forEach(function (a1) { todaySheet.getRange(a1).setBackground(MANUAL_COLOR); });
  }
}

function applyStatusColorCoding() {
  Object.keys(STATUS_COLOR_MAP).forEach(function (headerKey) {
    var canonical = Object.keys(SHEET_TO_HEADER_KEY).filter(function (n) { return SHEET_TO_HEADER_KEY[n] === headerKey; })[0];
    var sheet = getSheet(canonical);
    if (!sheet) return;
    var spec = STATUS_COLOR_MAP[headerKey];
    var startRow = (canonical === 'Today') ? TODAY_TABLE_FIRST_ROW : 2;
    var range = sheet.getRange(startRow, spec.col, Math.max(sheet.getMaxRows() - startRow + 1, 1), 1);
    var rules = sheet.getConditionalFormatRules().filter(function (rule) {
      return !rule.getRanges().some(function (rg) { return rg.getColumn() === spec.col && rg.getNumColumns() === 1 && rg.getRow() === startRow; });
    });
    Object.keys(spec.colors).forEach(function (value) {
      rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(value).setBackground(spec.colors[value]).setRanges([range]).build());
    });
    sheet.setConditionalFormatRules(rules);
  });
  var orgSheet = getSheet('Organisations');
  if (orgSheet) {
    var tierRange = orgSheet.getRange(2, COLS.ORGS.TIER, Math.max(orgSheet.getMaxRows() - 1, 1), 1);
    var tierRules = orgSheet.getConditionalFormatRules().filter(function (r) {
      return !r.getRanges().some(function (rg) { return rg.getColumn() === COLS.ORGS.TIER && rg.getRow() === 2; });
    });
    Object.keys(TIER_COLOR_MAP).forEach(function (val) {
      tierRules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(val).setBackground(TIER_COLOR_MAP[val]).setRanges([tierRange]).build());
    });
    orgSheet.setConditionalFormatRules(tierRules);
  }
  var todoSheet = getSheet('Tasks');
  if (todoSheet) {
    var ccRange = todoSheet.getRange(2, COLS.TODO.COMMITMENT_CLASS, Math.max(todoSheet.getMaxRows() - 1, 1), 1);
    var ccRules = todoSheet.getConditionalFormatRules().filter(function (r) {
      return !r.getRanges().some(function (rg) { return rg.getColumn() === COLS.TODO.COMMITMENT_CLASS && rg.getRow() === 2; });
    });
    Object.keys(COMMITMENT_CLASS_COLORS).forEach(function (val) {
      ccRules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(val).setBackground(COMMITMENT_CLASS_COLORS[val]).setRanges([ccRange]).build());
    });

    // v7.6 §2.6: two whole-row rules layered on top of the per-cell maps
    // above (which stay exactly as-is). Mutual exclusivity is enforced in
    // the formulas themselves (the highlight rule's NOT(OR(...)) clause),
    // not by relying on conditional-format rule order.
    var fullRowRange = todoSheet.getRange(2, 1, Math.max(todoSheet.getMaxRows() - 1, 1), HEADERS['To-do'].length);
    ccRules = ccRules.filter(function (r) {
      return !r.getRanges().some(function (rg) { return rg.getColumn() === 1 && rg.getRow() === 2 && rg.getNumColumns() === HEADERS['To-do'].length; });
    });
    var statusCol = columnToLetter(COLS.TODO.STATUS);
    var notesCol = columnToLetter(COLS.TODO.NOTES);
    var terminalFormula = 'OR($' + statusCol + '2="Done",$' + statusCol + '2="Skipped",$' + statusCol + '2="Cancelled")';
    ccRules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=' + terminalFormula)
      .setBackground('#F7F7F5').setFontColor('#B0AEA4')
      .setRanges([fullRowRange]).build());
    ccRules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=AND($' + notesCol + '2<>"",REGEXMATCH($' + notesCol + '2,"\\[(flags|review|no-estimate|no-link|no-date|needs breakdown|parent-still-open|blocked)\\]"),NOT(' + terminalFormula + '))')
      .setBackground('#FDE9D9')
      .setRanges([fullRowRange]).build());

    todoSheet.setConditionalFormatRules(ccRules);
  }
  var jobsSheet = getSheet('Jobs');
  if (jobsSheet) {
    var jobsRange = jobsSheet.getRange(2, 1, Math.max(jobsSheet.getMaxRows() - 1, 1), HEADERS.Jobs.length);
    var jobsRules = jobsSheet.getConditionalFormatRules().filter(function (r) {
      return !r.getRanges().some(function (rg) { return rg.getColumn() === 1 && rg.getRow() === 2 && rg.getNumColumns() === HEADERS.Jobs.length; });
    });
    var jobsNotesCol = columnToLetter(COLS.JOBS.NOTES);
    jobsRules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=REGEXMATCH($' + jobsNotesCol + '2,"\\[missed-deadline\\]")')
      .setBackground('#FDE9D9')
      .setRanges([jobsRange]).build());
    jobsSheet.setConditionalFormatRules(jobsRules);
  }
}

function columnToLetter(col) {
  var letter = '';
  while (col > 0) {
    var rem = (col - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    col = Math.floor((col - 1) / 26);
  }
  return letter;
}

function hiddenColumnsFor(canonicalName) {
  if (canonicalName === 'Today') return [COLS.TODAY.SLOT, COLS.TODAY.TODO_ID, COLS.TODAY.CLASS, COLS.TODAY.EFFORT, COLS.TODAY.ACTUAL_MIN];
  if (canonicalName === 'Organisations') return [COLS.ORGS.ID, COLS.ORGS.SUBSECTOR_ID, COLS.ORGS.LAST_CHECKED, COLS.ORGS.NEXT_CHECK];
  if (canonicalName === 'Jobs') return [COLS.JOBS.ID, COLS.JOBS.ORG_ID, COLS.JOBS.APPLIED_DATE, COLS.JOBS.CONTACTS_IDS, COLS.JOBS.REVIEW_DATE];
  if (canonicalName === 'People') return [COLS.PEOPLE.ID, COLS.PEOPLE.ORG_ID, COLS.PEOPLE.FOLLOW_UP_SENT, COLS.PEOPLE.OUTREACH_DATE, COLS.PEOPLE.FOLLOW_UPS_SENT_COUNT];
  if (canonicalName === 'Conversations') return [COLS.INTERACTIONS.ID, COLS.INTERACTIONS.PERSON_ID];
  // v7.6 §2.1: Commitment class unhidden — it's the single most important
  // triage signal on this tab, and COMMITMENT_CLASS_COLORS conditional
  // formatting is already wired to it, just previously sitting unused on
  // a hidden column. The four appended helper columns stay visible too.
  if (canonicalName === 'Tasks') return [COLS.TODO.ID, COLS.TODO.OBJ_TYPE, COLS.TODO.OBJ_ID, COLS.TODO.ORG, COLS.TODO.WORKFLOW, COLS.TODO.PARENT_ID, COLS.TODO.CREATED, COLS.TODO.COMPLETED, COLS.TODO.SOURCE, COLS.TODO.LAST_EDITED, COLS.TODO.CLASS_CALC_AT, COLS.TODO.EFFORT_TYPE];
  if (canonicalName === 'Interviews') return [COLS.ROUNDS.ID, COLS.ROUNDS.JOB_ID];
  if (canonicalName === 'Sectors') return [COLS.SECTORS.ID];
  if (canonicalName === 'Decisions') return [COLS.DECISIONS.KEY, COLS.DECISIONS.TARGET_ID, COLS.DECISIONS.TODO_ID];
  return [];
}

function sheetHeaderLength(canonicalName) {
  var key = SHEET_TO_HEADER_KEY[canonicalName];
  return HEADERS[key] ? HEADERS[key].length : 12;
}

function applyColumnLayout() {
  CANONICAL_TAB_ORDER.forEach(function (name) {
    var sheet = getSheet(name);
    if (!sheet || !SHEET_TO_HEADER_KEY[name]) return;
    var len = sheetHeaderLength(name);
    try { sheet.showColumns(1, len); } catch (err) { }
    hiddenColumnsFor(name).forEach(function (col) { try { sheet.hideColumns(col); } catch (err) { } });
  });
}

function showAllColumns() {
  CANONICAL_TAB_ORDER.forEach(function (name) {
    var sheet = getSheet(name);
    if (sheet && SHEET_TO_HEADER_KEY[name]) { try { sheet.showColumns(1, sheetHeaderLength(name)); } catch (err) { } }
  });
  SpreadsheetApp.getActiveSpreadsheet().toast('All columns shown.', 'The Planner', 3);
}

function applyColumnWidths() {
  Object.keys(COLUMN_WIDTHS).forEach(function (headerKey) {
    var canonical = Object.keys(SHEET_TO_HEADER_KEY).filter(function (n) { return SHEET_TO_HEADER_KEY[n] === headerKey; })[0];
    var sheet = getSheet(canonical);
    if (!sheet) return;
    Object.keys(COLUMN_WIDTHS[headerKey]).forEach(function (col) { try { sheet.setColumnWidth(parseInt(col, 10), COLUMN_WIDTHS[headerKey][col]); } catch (err) { } });
  });
  Object.keys(WRAP_COLUMNS).forEach(function (headerKey) {
    var canonical = Object.keys(SHEET_TO_HEADER_KEY).filter(function (n) { return SHEET_TO_HEADER_KEY[n] === headerKey; })[0];
    var sheet = getSheet(canonical);
    if (!sheet) return;
    var startRow = (canonical === 'Today') ? TODAY_TABLE_FIRST_ROW : 2;
    var bodyRows = Math.max(sheet.getMaxRows() - startRow + 1, 40);
    WRAP_COLUMNS[headerKey].forEach(function (col) { try { sheet.getRange(startRow, col, bodyRows, 1).setWrap(true); } catch (err) { } });
  });
}

function hideSystemColumns() { applyColumnLayout(); }

function applyTodayTableHeaderStyle() { applyRichTextHeaders('Today'); }

function reorderAndColourTabs() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  CANONICAL_TAB_ORDER.forEach(function (name, idx) {
    var sheet = getSheet(name);
    if (!sheet) return;
    ss.setActiveSheet(sheet);
    ss.moveActiveSheet(idx + 1);
  });
  ZONE_WORK_TABS.forEach(function (n) { var s = getSheet(n); if (s) s.setTabColor(ZONE_WORK_COLOR); });
  ZONE_DATA_TABS.forEach(function (n) { var s = getSheet(n); if (s) s.setTabColor(ZONE_DATA_COLOR); });
  ZONE_REF_TABS.forEach(function (n) { var s = getSheet(n); if (s) s.setTabColor(ZONE_REF_COLOR); });
}

function hideLegacyUtilityTabs() {
  var d = getSheet('Dashboard');
  if (d && !d.isSheetHidden()) { try { d.hideSheet(); } catch (err) { } }
}

// =============================================================
// LEGACY TAB MIGRATION (v7.1)
//
// The pre-consolidation workbook (v6.x) used different sheet names for
// four of the canonical tabs: "To-do" (now Tasks), "Today's plan" (now
// Today), "Interactions" (now Conversations), "Interview rounds" (now
// Interviews), and possibly "Pending decisions" / "Suggestions" (now
// Decisions). If repairAllTabs() ran against such a workbook without
// this step, getSheet('Tasks') etc. would find nothing and a brand new,
// empty tab would be created — stranding all existing rows on the
// old-named tab, invisible to the rest of the script.
//
// migrateLegacyTabs() runs first, before anything else touches the
// workbook. For each canonical name: if a sheet with that exact name
// already exists, it is left alone (nothing to migrate). Otherwise, if
// a sheet matching one of that canonical name's known legacy aliases is
// found, it is renamed in place via setName() — a pure rename, so every
// row of existing data is preserved untouched. If neither is found,
// nothing happens here; repairAllTabs() will create a fresh empty tab
// as before. Safe to run repeatedly — a no-op once migrated.
// =============================================================

function migrateLegacyTabs() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var renamed = [];
  Object.keys(LEGACY_TAB_NAMES).forEach(function (canonicalName) {
    if (getSheet(canonicalName)) return; // canonical tab already present — nothing to do
    var aliases = LEGACY_TAB_NAMES[canonicalName];
    for (var i = 0; i < aliases.length; i++) {
      var legacy = getSheet(aliases[i]);
      if (legacy) {
        legacy.setName(canonicalName);
        renamed.push(aliases[i] + ' \u2192 ' + canonicalName);
        return;
      }
    }
  });
  if (renamed.length) {
    SpreadsheetApp.getActiveSpreadsheet().toast('Migrated legacy tab(s): ' + renamed.join(', '), 'The Planner', 6);
  }
  return renamed;
}

// =============================================================
// DROPDOWNS — applied per sheet
// =============================================================

function applySheetDropdowns(canonicalName) {
  var sheet = getSheet(canonicalName);
  if (!sheet) return;
  var maxRow = Math.max(sheet.getMaxRows() - 1, 40);
  switch (canonicalName) {
    case 'Sectors':
      setDropdown(sheet.getRange(2, COLS.SECTORS.STATUS, maxRow, 1), DROPDOWNS.SECTOR_STATUS);
      break;
    case 'Organisations':
      setDropdown(sheet.getRange(2, COLS.ORGS.TIER, maxRow, 1), DROPDOWNS.ORG_TIER);
      setDropdown(sheet.getRange(2, COLS.ORGS.STATUS, maxRow, 1), DROPDOWNS.ORG_STATUS);
      break;
    case 'People':
      setDropdown(sheet.getRange(2, COLS.PEOPLE.STAGE, maxRow, 1), DROPDOWNS.PERSON_STAGE);
      setDropdown(sheet.getRange(2, COLS.PEOPLE.REL_TYPE, maxRow, 1), DROPDOWNS.PERSON_REL_TYPE);
      setDropdown(sheet.getRange(2, COLS.PEOPLE.REPLY_RECEIVED, maxRow, 1), DROPDOWNS.YES_NO);
      setDropdown(sheet.getRange(2, COLS.PEOPLE.FOLLOW_UP_SENT, maxRow, 1), DROPDOWNS.YES_NO);
      break;
    case 'Jobs':
      setDropdown(sheet.getRange(2, COLS.JOBS.STATUS, maxRow, 1), DROPDOWNS.JOB_STATUS);
      setDropdown(sheet.getRange(2, COLS.JOBS.RESPONSE, maxRow, 1), DROPDOWNS.YES_NO);
      break;
    case 'Conversations':
      setDropdown(sheet.getRange(2, COLS.INTERACTIONS.TYPE, maxRow, 1), DROPDOWNS.INTERACTION_TYPE);
      setDropdown(sheet.getRange(2, COLS.INTERACTIONS.OUTCOME, maxRow, 1), DROPDOWNS.INTERACTION_OUTCOME);
      refreshInteractionPersonDropdown();
      break;
    case 'Tasks':
      setDropdown(sheet.getRange(2, COLS.TODO.OBJ_TYPE, maxRow, 1), DROPDOWNS.TODO_OBJ_TYPE);
      setDropdown(sheet.getRange(2, COLS.TODO.WORKFLOW, maxRow, 1), DROPDOWNS.TODO_WORKFLOW);
      setDropdown(sheet.getRange(2, COLS.TODO.STATUS, maxRow, 1), DROPDOWNS.TODO_STATUS);
      setDropdown(sheet.getRange(2, COLS.TODO.TIME_EST, maxRow, 1), DROPDOWNS.TODO_TIME);
      setDropdown(sheet.getRange(2, COLS.TODO.COMMITMENT_CLASS, maxRow, 1), DROPDOWNS.TODO_COMMITMENT_CLASS);
      setDropdown(sheet.getRange(2, COLS.TODO.SOURCE, maxRow, 1), DROPDOWNS.TODO_SOURCE);
      break;
    case 'Interviews':
      setDropdown(sheet.getRange(2, COLS.ROUNDS.ROUND_TYPE, maxRow, 1), DROPDOWNS.ROUND_TYPE);
      setDropdown(sheet.getRange(2, COLS.ROUNDS.STATUS, maxRow, 1), DROPDOWNS.ROUND_STATUS);
      setDropdown(sheet.getRange(2, COLS.ROUNDS.DOMAIN_READINESS, maxRow, 1), DROPDOWNS.DOMAIN_READINESS);
      setDropdown(sheet.getRange(2, COLS.ROUNDS.OFFICIAL_OUTCOME, maxRow, 1), DROPDOWNS.OFFICIAL_OUTCOME);
      break;
    case 'Today':
      // v7.4: per-row, not blanket — Option rows need the smaller
      // 'Deferred'/'Pull in' list, not the full Commit-row status list.
      applyTodayRowStatusDropdowns(sheet);
      break;
    case 'Decisions':
      setDropdown(sheet.getRange(2, COLS.DECISIONS.DECISION, maxRow, 1), DROPDOWNS.DECISION);
      break;
  }
}

function refreshAllDropdowns() {
  ['Sectors', 'Organisations', 'People', 'Jobs', 'Conversations', 'Tasks', 'Interviews', 'Today', 'Decisions'].forEach(applySheetDropdowns);
}

// =============================================================
// DAILY SWEEP — materializes due follow-ups, deadlines, etc.
// =============================================================

function materializeDueTasks() {
  var created = 0, todayDate = today();

  var peopleSheet = getSheet('People');
  if (peopleSheet && peopleSheet.getLastRow() > 1) {
    var pData = peopleSheet.getRange(2, 1, peopleSheet.getLastRow() - 1, COLS.PEOPLE.FOLLOW_UPS_SENT_COUNT).getValues();
    for (var i = 0; i < pData.length; i++) {
      var personId = String(pData[i][COLS.PEOPLE.ID - 1]);
      var personName = String(pData[i][COLS.PEOPLE.NAME - 1]);
      var orgName = String(pData[i][COLS.PEOPLE.ORG - 1]);
      var stage = normalizePersonStage(String(pData[i][COLS.PEOPLE.STAGE - 1]));
      var followUpDate = pData[i][COLS.PEOPLE.FOLLOW_UP_DATE - 1];
      var followUpSent = String(pData[i][COLS.PEOPLE.FOLLOW_UP_SENT - 1]);
      if (!personId || !personName) continue;
      if (stage === 'Outreach sent' && followUpDate && new Date(followUpDate) < todayDate && followUpSent === 'No') {
        if (appendTodoOnceForWorkflow('Follow up with ' + personName, 'Person', personId, orgName, 'Contact follow-up', 'Not started', '', '15 min', '', 'Auto-triggered')) created++;
      }
      if (stage === 'Nurture' && followUpDate && new Date(followUpDate) < todayDate) {
        if (appendTodoOnceForWorkflow('Nurture check-in with ' + personName, 'Person', personId, orgName, 'Contact follow-up', 'Not started', '', '15 min', '', 'Auto-triggered')) created++;
      }
    }
  }

  var jobsSheet = getSheet('Jobs');
  if (jobsSheet && jobsSheet.getLastRow() > 1) {
    var jData = jobsSheet.getRange(2, 1, jobsSheet.getLastRow() - 1, COLS.JOBS.NOTES).getValues();
    for (var jj = 0; jj < jData.length; jj++) {
      var jobId = String(jData[jj][COLS.JOBS.ID - 1]);
      var jobTitle = String(jData[jj][COLS.JOBS.OPPORTUNITY - 1]);
      var jobOrg = String(jData[jj][COLS.JOBS.ORG - 1]);
      var jobStatus = normalizeJobStatus(String(jData[jj][COLS.JOBS.STATUS - 1]));
      var reviewDate = jData[jj][COLS.JOBS.REVIEW_DATE - 1];
      var deadline = jData[jj][COLS.JOBS.DEADLINE - 1];
      var response = String(jData[jj][COLS.JOBS.RESPONSE - 1]);
      if (!jobId || !jobTitle) continue;
      if (jobStatus === 'Applied' && reviewDate && new Date(reviewDate) < todayDate && !response) {
        if (appendTodoOnceForWorkflow('Check application response: ' + jobTitle + ' at ' + jobOrg, 'Job', jobId, jobOrg, 'Check application response', 'Not started', '', '15 min', '', 'Auto-triggered')) created++;
      }
      if (jobStatus === 'Want to apply' && deadline) {
        var daysToDeadline = daysBetween(todayDate, new Date(deadline));
        if (daysToDeadline >= 0 && daysToDeadline <= 3) {
          if (appendTodoOnceForWorkflow('Deadline approaching: ' + jobTitle + ' at ' + jobOrg, 'Job', jobId, jobOrg, 'Admin', 'Not started', deadline, '15 min', 'Deadline in ' + daysToDeadline + ' day(s).', 'Auto-triggered')) created++;
        }
      }
    }
  }

  var orgsSheet = getSheet('Organisations');
  if (orgsSheet && orgsSheet.getLastRow() > 1) {
    var oData = orgsSheet.getRange(2, 1, orgsSheet.getLastRow() - 1, COLS.ORGS.NOTES).getValues();
    for (var oo = 0; oo < oData.length; oo++) {
      var oId = String(oData[oo][COLS.ORGS.ID - 1]);
      var oName = String(oData[oo][COLS.ORGS.NAME - 1]);
      var oStatus = String(oData[oo][COLS.ORGS.STATUS - 1]);
      var oNextCheck = oData[oo][COLS.ORGS.NEXT_CHECK - 1];
      if (!oId) continue;
      if (oStatus === 'Dormant' && oNextCheck && new Date(oNextCheck) < todayDate) {
        if (appendTodoOnceForWorkflow('Review dormant org ' + oName, 'Organisation', oId, oName, 'Org research', 'Not started', '', '30 min', 'Decide Active/Archive or extend check date.', 'Auto-triggered')) created++;
      }
    }
  }

  var roundsSheet = getSheet('Interviews');
  if (roundsSheet && roundsSheet.getLastRow() > 1) {
    var rData = roundsSheet.getRange(2, 1, roundsSheet.getLastRow() - 1, COLS.ROUNDS.NOTES).getValues();
    for (var rr = 0; rr < rData.length; rr++) {
      var rId = String(rData[rr][COLS.ROUNDS.ID - 1]);
      var rJobDisp = String(rData[rr][COLS.ROUNDS.JOB_DISPLAY - 1]);
      var rOrgDisp = String(rData[rr][COLS.ROUNDS.ORG_DISPLAY - 1]);
      var rRound = rData[rr][COLS.ROUNDS.ROUND - 1];
      var rStatus = String(rData[rr][COLS.ROUNDS.STATUS - 1]);
      var rOutcome = String(rData[rr][COLS.ROUNDS.OFFICIAL_OUTCOME - 1]);
      var rExpResp = rData[rr][COLS.ROUNDS.EXPECTED_RESPONSE - 1];
      if (!rId) continue;
      if (rStatus === 'Completed' && (!rOutcome || rOutcome === 'Waiting') && rExpResp && new Date(rExpResp) < todayDate) {
        if (appendTodoOnceForWorkflow('Check response from ' + rOrgDisp + ' Round ' + rRound, 'Interview round', rId, rOrgDisp, 'Interview follow-up', 'Not started', '', '15 min', '', 'Auto-triggered')) created++;
      }
    }
  }
  return created;
}

function weeklyReview() {
  // v7.3: guarded — writes stale-nurture flags, so keep it off the daily
  // trigger's toes.
  return withDocumentLock(weeklyReviewImpl, { label: 'weeklyReview', timeoutMs: 30000 });
}

function weeklyReviewImpl() {
  var peopleSheet = getSheet('People');
  if (peopleSheet && peopleSheet.getLastRow() > 1) {
    var pData = peopleSheet.getRange(2, 1, peopleSheet.getLastRow() - 1, COLS.PEOPLE.NOTES).getValues();
    for (var i = 0; i < pData.length; i++) {
      var stage = String(pData[i][COLS.PEOPLE.STAGE - 1]);
      var fupDate = pData[i][COLS.PEOPLE.FOLLOW_UP_DATE - 1];
      if (stage === 'Nurture' && fupDate) {
        var daysOver = daysBetween(new Date(fupDate), today());
        if (daysOver >= 14) appendNoteFlag(peopleSheet, i + 2, COLS.PEOPLE.NOTES, '[weekly-review] \u26a0 Stale nurture — overdue ' + daysOver + ' days');
      }
    }
  }
  checkOrgActiveEmpty();
  checkOrgOrphans();
  detectSectorOrphans();

  colorCodeManualFields();
  applyColumnWidths();
  refreshAllDropdowns();
}

// v7.6.3 §4.6: an Organisation marked Active is a deliberate choice to
// pursue it, but it can still sit with zero known people and zero open
// opportunities. Flag it as a health signal — never create Tasks from
// this, and never apply it to Mapped (inert by design).
function checkOrgActiveEmpty() {
  var sheet = getSheet('Organisations');
  if (!sheet || sheet.getLastRow() < 2) return;
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, COLS.ORGS.NOTES).getValues();
  for (var i = 0; i < data.length; i++) {
    var row = i + 2;
    var status = String(data[i][COLS.ORGS.STATUS - 1]);
    var knownPeople = Number(data[i][COLS.ORGS.KNOWN_PEOPLE - 1]) || 0;
    var openOpps = Number(data[i][COLS.ORGS.OPEN_OPPS - 1]) || 0;
    if (status === 'Active' && knownPeople === 0 && openOpps === 0) {
      appendNoteFlag(sheet, row, COLS.ORGS.NOTES, '[active-empty] Active but no people or open opportunities yet');
    } else {
      clearNoteFlag(sheet, row, COLS.ORGS.NOTES, '[active-empty]');
    }
  }
}

// v7.6.3 §4.3: manual row deletion never fires onEdit, so People/Jobs/
// Tasks/Decisions can keep pointing at an Organisation ID that no longer
// exists. Flagging only — never recreates the Organisation, never
// deletes or relinks the child row.
function checkOrgOrphans() {
  var orgSheet = getSheet('Organisations');
  if (!orgSheet) return;
  var validOrgIds = {};
  if (orgSheet.getLastRow() > 1) {
    orgSheet.getRange(2, COLS.ORGS.ID, orgSheet.getLastRow() - 1, 1).getValues().forEach(function (r) {
      if (r[0]) validOrgIds[String(r[0])] = true;
    });
  }

  function sweep(sheet, orgIdCol, notesCol, typeCol, requiredType) {
    if (!sheet || sheet.getLastRow() < 2) return;
    var width = Math.max(orgIdCol, notesCol, typeCol || 0);
    var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, width).getValues();
    for (var i = 0; i < data.length; i++) {
      var row = i + 2;
      if (typeCol && String(data[i][typeCol - 1] || '') !== requiredType) continue;
      var orgId = data[i][orgIdCol - 1];
      if (orgId && !validOrgIds[String(orgId)]) {
        appendNoteFlag(sheet, row, notesCol, '[orphaned-org] ⚠ Linked Organisation no longer exists');
      } else {
        clearNoteFlag(sheet, row, notesCol, '[orphaned-org]');
      }
    }
  }

  sweep(getSheet('People'), COLS.PEOPLE.ORG_ID, COLS.PEOPLE.NOTES);
  sweep(getSheet('Jobs'), COLS.JOBS.ORG_ID, COLS.JOBS.NOTES);
  sweep(getSheet('Tasks'), COLS.TODO.OBJ_ID, COLS.TODO.NOTES, COLS.TODO.OBJ_TYPE, 'Organisation');
  sweep(getSheet('Decisions'), COLS.DECISIONS.TARGET_ID, COLS.DECISIONS.NOTES, COLS.DECISIONS.TARGET_TYPE, 'Organisation');
}

// =============================================================
// "ADD NEW" ESCAPE HATCHES — quick capture without opening Today
// =============================================================

function addNewOrganisation() {
  var ui = SpreadsheetApp.getUi();
  var nameResp = ui.prompt('Add new organisation', 'Organisation name:', ui.ButtonSet.OK_CANCEL);
  if (nameResp.getSelectedButton() !== ui.Button.OK) return;
  var name = nameResp.getResponseText().trim();
  if (!name) return;
  var org = createNameOnlyOrg(name, { status: 'Mapped', tier: 'B' });
  ui.alert('Added', 'Organisation "' + name + '" added as Mapped. Set Status to Active from Organisations when you\'re ready to pursue it.', ui.ButtonSet.OK);
}

function addNewPerson() {
  var ui = SpreadsheetApp.getUi();
  var nameResp = ui.prompt('Add new person', "Person's name:", ui.ButtonSet.OK_CANCEL);
  if (nameResp.getSelectedButton() !== ui.Button.OK) return;
  var name = nameResp.getResponseText().trim();
  if (!name) return;
  var orgResp = ui.prompt('Organisation', 'Where do they work? (blank if unknown)', ui.ButtonSet.OK_CANCEL);
  var orgName = orgResp.getSelectedButton() === ui.Button.OK ? orgResp.getResponseText().trim() : '';
  var org = orgName ? createNameOnlyOrg(orgName, { status: 'Mapped', stub: true }) : null;
  var personId = writePersonRow(name, org, '');
  firePersonStageChanged(personId, '', 'Identified', {});
  ui.alert('Added', 'Person "' + name + '" added. Draft outreach task created.', ui.ButtonSet.OK);
}

function addNewJob() {
  var ui = SpreadsheetApp.getUi();
  var titleResp = ui.prompt('Add new job', 'Opportunity title:', ui.ButtonSet.OK_CANCEL);
  if (titleResp.getSelectedButton() !== ui.Button.OK) return;
  var title = titleResp.getResponseText().trim();
  if (!title) return;
  var orgResp = ui.prompt('Organisation', 'Which org? (blank if unknown)', ui.ButtonSet.OK_CANCEL);
  var orgName = orgResp.getSelectedButton() === ui.Button.OK ? orgResp.getResponseText().trim() : '';
  var org = orgName ? createNameOnlyOrg(orgName, { status: 'Mapped', stub: true }) : null;
  var jobId = writeJobRow(title, org, 'Want to apply');
  fireJobStatusChanged(jobId, '', 'Want to apply', {});
  ui.alert('Added', 'Job "' + title + '" added with Status = Want to apply.', ui.ButtonSet.OK);
}

function addNewInteraction() {
  var ui = SpreadsheetApp.getUi();
  var personResp = ui.prompt('Log conversation', 'Person name (must exist on People):', ui.ButtonSet.OK_CANCEL);
  if (personResp.getSelectedButton() !== ui.Button.OK) return;
  var personName = personResp.getResponseText().trim();
  var person = findPersonByNameOrg(personName, '');
  if (!person) { ui.alert('Not found', '"' + personName + '" not found on People. Add them first.', ui.ButtonSet.OK); return; }
  var notesResp = ui.prompt('Key notes', 'What was said/decided?', ui.ButtonSet.OK_CANCEL);
  var notes = notesResp.getSelectedButton() === ui.Button.OK ? notesResp.getResponseText().trim() : '';
  var id = appendInteraction(person.data[COLS.PEOPLE.ID - 1], person.data[COLS.PEOPLE.NAME - 1], person.data[COLS.PEOPLE.ORG - 1], today(), 'Other', notes, 'Useful');
  ui.alert('Logged', 'Conversation with ' + person.data[COLS.PEOPLE.NAME - 1] + ' logged.', ui.ButtonSet.OK);
}

function addAdHocTodo() {
  var ui = SpreadsheetApp.getUi();
  var resp = ui.prompt('Add ad-hoc task', 'Task description:', ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  var task = resp.getResponseText().trim();
  if (!task) return;
  appendTodoWithSource(task, 'None', '', '', 'Admin', 'Not started', '', '30 min', '', 'Manually added');
  SpreadsheetApp.getActiveSpreadsheet().toast('Task added.', 'The Planner', 3);
}

// =============================================================
// ROW ACTIONS — explicit, deliberate next steps (not auto-fired)
// =============================================================

function rowActionFindPeopleAtSelectedOrg() {
  var sheet = SpreadsheetApp.getActiveSheet();
  if (sheet.getName() !== 'Organisations') { SpreadsheetApp.getUi().alert('Select an Organisation row first.'); return; }
  var row = sheet.getActiveRange().getRow(); if (row <= 1) return;
  appendTodoWithSource('Find people at: ' + sheet.getRange(row, COLS.ORGS.NAME).getValue(), 'Organisation', sheet.getRange(row, COLS.ORGS.ID).getValue(), sheet.getRange(row, COLS.ORGS.NAME).getValue(), 'People sourcing', 'Not started', '', '30 min', '', 'Manually added');
}

function rowActionScanJobsAtSelectedOrg() {
  var sheet = SpreadsheetApp.getActiveSheet();
  if (sheet.getName() !== 'Organisations') { SpreadsheetApp.getUi().alert('Select an Organisation row first.'); return; }
  var row = sheet.getActiveRange().getRow(); if (row <= 1) return;
  appendTodoWithSource('Scan jobs at: ' + sheet.getRange(row, COLS.ORGS.NAME).getValue(), 'Organisation', sheet.getRange(row, COLS.ORGS.ID).getValue(), sheet.getRange(row, COLS.ORGS.NAME).getValue(), 'Org job scan', 'Not started', '', '30 min', '', 'Manually added');
}

function rowActionPrepSelectedJob() {
  var sheet = SpreadsheetApp.getActiveSheet();
  if (sheet.getName() !== 'Jobs') { SpreadsheetApp.getUi().alert('Select a Job row first.'); return; }
  var row = sheet.getActiveRange().getRow(); if (row <= 1) return;
  appendTodoWithSource('Prep application for: ' + sheet.getRange(row, COLS.JOBS.OPPORTUNITY).getValue(), 'Job', sheet.getRange(row, COLS.JOBS.ID).getValue(), sheet.getRange(row, COLS.JOBS.ORG).getValue(), 'Application preparation', 'Not started', sheet.getRange(row, COLS.JOBS.DEADLINE).getValue(), '60 min', '', 'Manually added');
}

function rowActionReferralSearchSelectedJob() {
  var sheet = SpreadsheetApp.getActiveSheet();
  if (sheet.getName() !== 'Jobs') { SpreadsheetApp.getUi().alert('Select a Job row first.'); return; }
  var row = sheet.getActiveRange().getRow(); if (row <= 1) return;
  appendTodoWithSource('Find people at: ' + sheet.getRange(row, COLS.JOBS.ORG).getValue(), 'Organisation', sheet.getRange(row, COLS.JOBS.ORG_ID).getValue(), sheet.getRange(row, COLS.JOBS.ORG).getValue(), 'Referral search', 'Not started', '', '30 min', '', 'Manually added');
}

function rowActionSearchOrgsForSubsector() {
  var sheet = SpreadsheetApp.getActiveSheet();
  if (sheet.getName() !== 'Sectors') { SpreadsheetApp.getUi().alert('Select a Sectors row first.'); return; }
  var row = sheet.getActiveRange().getRow(); if (row <= 1) return;
  var sector = sheet.getRange(row, COLS.SECTORS.SECTOR).getValue();
  var sub = sheet.getRange(row, COLS.SECTORS.SUBSECTOR).getValue();
  if (!sector || !sub) { SpreadsheetApp.getUi().alert('Select a row with a Sector and Sub-sector.'); return; }
  var branch = upsertSectorBranch({ sector: sector, subsector: sub, source: 'manual_sheet_entry', preferredRow: row, createExpansionDecision: false });
  if (!branch || !branch.id) return;
  appendTodoWithSource('Market map: ' + branch.sector + ' — ' + branch.subsector, 'Sector', branch.id, '', 'Market mapping', 'Not started', '', '45 min', '', 'Manually added');
}

function rowActionBreakDownSelectedSector() {
  var sheet = SpreadsheetApp.getActiveSheet();
  if (sheet.getName() !== 'Sectors') { SpreadsheetApp.getUi().alert('Select a Sectors row first.'); return; }
  var row = sheet.getActiveRange().getRow(); if (row <= 1) return;
  var sector = sheet.getRange(row, COLS.SECTORS.SECTOR).getValue();
  if (!sector) return;
  var branch = upsertSectorBranch({ sector: sector, source: 'manual_sheet_entry', preferredRow: row, createExpansionDecision: false });
  fireSectorOnlyTask(branch);
}

function rowActionAddInterviewRound() {
  var sheet = SpreadsheetApp.getActiveSheet();
  if (sheet.getName() !== 'Jobs') { SpreadsheetApp.getUi().alert('Select a Job row first.'); return; }
  var row = sheet.getActiveRange().getRow(); if (row <= 1) return;
  createInterviewRoundForJob(sheet.getRange(row, COLS.JOBS.ID).getValue(), {});
}

// v7.4 §4.2 — Multi-day Phase 2: break a Multi-day Task into real
// sub-tasks via the dormant Parent To-do ID hook, rather than
// special-casing Multi-day around the waterfall permanently.
function rowActionBreakDownSelectedTask() {
  var sheet = SpreadsheetApp.getActiveSheet();
  if (sheet.getName() !== 'Tasks') { SpreadsheetApp.getUi().alert('Select a Task row first.'); return; }
  var row = sheet.getActiveRange().getRow(); if (row <= 1) return;
  var todoId = String(sheet.getRange(row, COLS.TODO.ID).getValue() || '');
  var timeEst = String(sheet.getRange(row, COLS.TODO.TIME_EST).getValue() || '');
  if (!todoId) { SpreadsheetApp.getUi().alert('That row does not have a Task ID.'); return; }
  if (timeEst !== 'Multi-day') { SpreadsheetApp.getUi().alert('Break down is only for Multi-day tasks.'); return; }
  runBreakdownPopup(todoId, String(sheet.getRange(row, COLS.TODO.TASK).getValue() || ''));
}

function runBreakdownPopup(todoId, taskTitle) {
  var html = HtmlService.createHtmlOutput(buildBreakdownHtml(todoId, taskTitle)).setWidth(600).setHeight(620).setTitle('Break down: ' + taskTitle);
  SpreadsheetApp.getUi().showModalDialog(html, 'Break down: ' + taskTitle);
}

function buildBreakdownHtml(todoId, taskTitle) {
  var json = JSON.stringify({ todoId: todoId, taskTitle: taskTitle, timeOptions: DROPDOWNS.TODO_TIME.filter(function (t) { return t !== 'Multi-day'; }) });
  return '' +
    '<style>' +
    'body{font-family:Arial,sans-serif;padding:22px;color:#28251D;background:#FBFBF9;}' +
    'h2{margin:0 0 8px;color:#1B474D;font-size:20px;}p{color:#5F625E;font-size:13px;margin:6px 0 14px;}' +
    '.row{display:flex;gap:8px;margin-top:10px;}' +
    '.row input{flex:1;}.row select{width:130px;flex:none;}' +
    'input,select{box-sizing:border-box;padding:9px;border:1px solid #D8DAD4;border-radius:5px;font-size:13px;}' +
    '.primary{margin-top:18px;padding:10px 14px;border:0;border-radius:5px;background:#01696F;color:#FFF;font-weight:bold;cursor:pointer;}' +
    '#status{font-size:12px;color:#5F625E;margin-top:10px;}</style>' +
    '<h2>Break down: <span id="title"></span></h2>' +
    '<p>Add up to 6 sub-tasks with a time estimate each. Empty rows are ignored. The Multi-day parent is retired (Skipped) once sub-tasks are created — they inherit its organisation/workflow and flow through Today normally.</p>' +
    '<form id="form"></form>' +
    '<button class="primary" type="button" onclick="submitBreakdown()">Create sub-tasks</button>' +
    '<div id="status"></div>' +
    '<script>var cfg=' + json + ';document.getElementById("title").textContent=cfg.taskTitle;var f=document.getElementById("form");' +
    'for(var i=0;i<6;i++){var r=document.createElement("div");r.className="row";' +
    'var t=document.createElement("input");t.type="text";t.placeholder="Sub-task "+(i+1);t.name="text"+i;' +
    'var s=document.createElement("select");s.name="time"+i;' +
    'cfg.timeOptions.forEach(function(v){var o=document.createElement("option");o.value=v;o.textContent=v;s.appendChild(o);});' +
    'r.appendChild(t);r.appendChild(s);f.appendChild(r);}' +
    'function submitBreakdown(){var subtasks=[];for(var i=0;i<6;i++){var text=f.elements["text"+i].value.trim();if(!text)continue;subtasks.push({text:text,timeEst:f.elements["time"+i].value});}' +
    'if(!subtasks.length){document.getElementById("status").textContent="Add at least one sub-task.";return;}' +
    'document.getElementById("status").textContent="Creating sub-tasks...";' +
    'google.script.run.withSuccessHandler(function(msg){document.getElementById("status").textContent=msg||"Done.";setTimeout(function(){google.script.host.close();},900);})' +
    '.withFailureHandler(function(err){document.getElementById("status").textContent=err&&err.message?err.message:String(err);})' +
    '.completeBreakdownFromPopup(cfg.todoId,subtasks);}</script>';
}

function retireBrokenDownParent(parentTodoId, childCount) {
  var parent = getTodoById(parentTodoId);
  if (!parent) return false;
  parent.sheet.getRange(parent.row, COLS.TODO.STATUS).setValue('Skipped');
  parent.sheet.getRange(parent.row, COLS.TODO.COMPLETED).setValue(today());
  parent.sheet.getRange(parent.row, COLS.TODO.LAST_EDITED).setValue(today());
  appendNoteFlag(parent.sheet, parent.row, COLS.TODO.NOTES, '[has-subtasks] broken down into ' + childCount + ' sub-task(s)');
  // Structural retirement only: do not call completeTodo/handleSkipCascade,
  // because this is a parent rollup, not an abandoned linked workflow.
  syncTodayRowForTodo(parent.row, 'Skipped');
  return true;
}

function completeBreakdownFromPopup(parentTodoId, subtasks) {
  var parent = getTodoById(parentTodoId);
  if (!parent) return 'Parent task not found.';
  var createdIds = [];
  subtasks.forEach(function (st) {
    if (!st.text) return;
    var id = appendTodoWithSource(
      st.text, parent.objType, parent.objId, parent.org, parent.workflow,
      'Not started', '', st.timeEst || defaultTimeForWorkflow(parent.workflow),
      '', 'Manually added', { skipDuplicateCheck: true }
    );
    if (id) {
      var s = getSheet('Tasks');
      var r = getTodoById(id).row;
      s.getRange(r, COLS.TODO.PARENT_ID).setValue(parentTodoId);
      createdIds.push(id);
    }
  });
  if (!createdIds.length) return 'No sub-tasks captured.';
  // Parent becomes a rollup container, not open work. Retire it explicitly
  // so it disappears from the open-task pool without firing skip cascade.
  retireBrokenDownParent(parentTodoId, createdIds.length);
  populateToday();
  refreshHome();
  return 'Created ' + createdIds.length + ' sub-task(s) and retired the Multi-day parent.';
}

function linkContactToJob() {
  var sheet = SpreadsheetApp.getActiveSheet();
  if (sheet.getName() !== 'Jobs') { SpreadsheetApp.getUi().alert('Select a row in Jobs first.'); return; }
  var row = sheet.getActiveRange().getRow(); if (row <= 1) return;
  var ui = SpreadsheetApp.getUi();
  var resp = ui.prompt('Link contact to Job', 'Person name(s), comma-separated:', ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  var names = resp.getResponseText().split(',').map(function (s) { return s.trim(); }).filter(String);
  var jobOrgId = sheet.getRange(row, COLS.JOBS.ORG_ID).getValue();
  var jobOrg = sheet.getRange(row, COLS.JOBS.ORG).getValue();
  var newIds = [], notFound = [], ambiguous = [];
  names.forEach(function (nm) {
    var matches = findPeopleByNameOrgScoped(nm, jobOrgId, jobOrg);
    if (matches.length === 1) newIds.push(String(matches[0].data[COLS.PEOPLE.ID - 1]));
    else if (matches.length > 1) ambiguous.push(nm);
    else notFound.push(nm);
  });
  if (ambiguous.length) ui.alert('Ambiguous contact(s)', ambiguous.join(', ') + ' matched more than one person at ' + (jobOrg || 'this organisation') + '. Link manually from People first.', ui.ButtonSet.OK);
  if (notFound.length) ui.alert('Some names not found', notFound.join(', '), ui.ButtonSet.OK);
  if (!newIds.length) return;
  var existing = sheet.getRange(row, COLS.JOBS.CONTACTS_IDS).getValue();
  sheet.getRange(row, COLS.JOBS.CONTACTS_IDS).setValue(existing ? existing + ', ' + newIds.join(', ') : newIds.join(', '));
  refreshLinkedContactsDisplay();
}

function refreshLinkedContactsDisplay() {
  var jobsSheet = getSheet('Jobs'), peopleSheet = getSheet('People');
  if (!jobsSheet || !peopleSheet || jobsSheet.getLastRow() < 2) return;
  var peopleData = peopleSheet.getLastRow() > 1 ? peopleSheet.getRange(2, 1, peopleSheet.getLastRow() - 1, COLS.PEOPLE.NAME).getValues() : [];
  for (var r = 2; r <= jobsSheet.getLastRow(); r++) {
    var idsRaw = jobsSheet.getRange(r, COLS.JOBS.CONTACTS_IDS).getValue();
    if (!idsRaw) continue;
    var ids = String(idsRaw).split(',').map(function (s) { return s.trim(); });
    var names = [];
    for (var i = 0; i < peopleData.length; i++) { if (ids.indexOf(String(peopleData[i][COLS.PEOPLE.ID - 1])) !== -1) names.push(String(peopleData[i][COLS.PEOPLE.NAME - 1])); }
    jobsSheet.getRange(r, COLS.JOBS.CONTACTS_DISPLAY).setValue(names.join(', '));
  }
}

function logInteractionForRow() {
  var sheet = SpreadsheetApp.getActiveSheet();
  var name = sheet.getName();
  var row = sheet.getActiveRange().getRow();
  if (row <= 1 || (name !== 'People' && name !== 'Jobs')) { SpreadsheetApp.getUi().alert('Select a data row in People or Jobs.'); return; }
  var ui = SpreadsheetApp.getUi();
  var resp = ui.prompt('Log conversation', 'Key notes:', ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  var notes = resp.getResponseText().trim();
  var personId = name === 'People' ? sheet.getRange(row, COLS.PEOPLE.ID).getValue() : '';
  var person = name === 'People' ? sheet.getRange(row, COLS.PEOPLE.NAME).getValue() : '';
  var org = name === 'People' ? sheet.getRange(row, COLS.PEOPLE.ORG).getValue() : sheet.getRange(row, COLS.JOBS.ORG).getValue();
  appendInteraction(personId, person, org, today(), 'Other', notes, 'Useful');
}

function softCloseRow() {
  var sheet = SpreadsheetApp.getActiveSheet();
  var row = sheet.getActiveRange().getRow(); if (row <= 1) return;
  if (sheet.getName() === 'People') movePersonStage(sheet.getRange(row, COLS.PEOPLE.ID).getValue(), 'Closed', {});
  else if (sheet.getName() === 'Jobs') setJobStatus(sheet.getRange(row, COLS.JOBS.ID).getValue(), 'Closed', {});
  else SpreadsheetApp.getUi().alert('Select a row in People or Jobs to soft-close.');
}

// v7.6 §5: prompts for a reason, appends [blocked] <reason> to Notes. No
// schema change — surfaced via the Home aggregate count and the §2.6
// flagged-row highlight (the highlight regex already includes "blocked").
function rowActionMarkTaskBlocked() {
  var sheet = SpreadsheetApp.getActiveSheet();
  if (sheet.getName() !== 'Tasks') { SpreadsheetApp.getUi().alert('Select a Task row first.'); return; }
  var row = sheet.getActiveRange().getRow(); if (row <= 1) return;
  var ui = SpreadsheetApp.getUi();
  var resp = ui.prompt('Mark blocked', 'Why is this task blocked?', ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  var reason = resp.getResponseText().trim();
  if (!reason) { ui.alert('Enter a reason.'); return; }
  appendNoteFlag(sheet, row, COLS.TODO.NOTES, '[blocked] ' + reason);
  refreshHome();
}

// v7.6 §5: Tasks has no Deferred status of its own (DROPDOWNS.TODO_STATUS
// has no such value — only Today's Status column does) — this pushes the
// due date +3 days and recalculates Commitment class immediately,
// without touching Status at all. Copies the *corrected* version of
// Today's Deferred branch (see Today_tab_restructure_spec.md §3.1) —
// the original forgot the recalc step; don't reintroduce that gap here.
function rowActionDeferSelectedTask() {
  var sheet = SpreadsheetApp.getActiveSheet();
  if (sheet.getName() !== 'Tasks') { SpreadsheetApp.getUi().alert('Select a Task row first.'); return; }
  var row = sheet.getActiveRange().getRow(); if (row <= 1) return;
  var newDue = addDays(today(), 3);
  sheet.getRange(row, COLS.TODO.DUE_DATE).setValue(newDue);
  sheet.getRange(row, COLS.TODO.LAST_EDITED).setValue(today());
  sheet.getRange(row, COLS.TODO.COMMITMENT_CLASS).setValue(assignCommitmentClass(
    String(sheet.getRange(row, COLS.TODO.WORKFLOW).getValue()), newDue,
    String(sheet.getRange(row, COLS.TODO.OBJ_ID).getValue()), String(sheet.getRange(row, COLS.TODO.OBJ_TYPE).getValue())));
  sheet.getRange(row, COLS.TODO.CLASS_CALC_AT).setValue(today());
  // v7.6.1: if this task is currently sitting on Today's Commit list, it
  // would otherwise keep showing stale info until some unrelated refresh.
  syncTodayRowForTodo(row, 'Not started');
  populateToday();
  refreshHome();
  SpreadsheetApp.getActiveSpreadsheet().toast('Due date pushed 3 days and commitment class recalculated.', 'The Planner', 4);
}

// =============================================================
// GUIDE TAB — first-time and ongoing reference
// =============================================================

function writeH2(sheet, r, text) { sheet.getRange(r, 2).setValue(text).setFontSize(12).setFontWeight('bold').setFontColor('#1B474D'); return r + 1; }
function writeKV(sheet, r, k, v) {
  sheet.getRange(r, 2).setValue(k).setFontSize(10).setFontWeight('bold');
  sheet.getRange(r, 3).setValue(v).setFontSize(10).setWrap(true);
  return r + 1;
}

function rewriteGuide() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = getSheet('Guide');
  if (!sheet) sheet = ss.insertSheet('Guide');
  sheet.clear();
  sheet.setColumnWidth(1, 30); sheet.setColumnWidth(2, 220); sheet.setColumnWidth(3, 560);
  sheet.setHiddenGridlines(true);
  var r = 2;
  sheet.getRange(r, 2).setValue('The Planner — Guide').setFontSize(16).setFontWeight('bold').setFontColor('#1B474D'); r += 2;

  r = writeH2(sheet, r, 'Operating rhythm');
  r = writeKV(sheet, r, 'Welcome → Resolve → Capture → Plan → Execute → Monitor', 'Home is where the day starts and Pending Decisions get resolved; Today is purely the execution surface.');
  r++;

  r = writeH2(sheet, r, 'The flow');
  r = writeKV(sheet, r, 'Add/update popup', 'Writes the real source tab (Sectors/Organisations/Jobs/People/Conversations/Interviews). Lives on Home now.');
  r = writeKV(sheet, r, 'Cascades', 'Create Pending Decisions where judgment is genuinely needed. Creating or classifying an Organisation never floods job/people-search work on its own.');
  r = writeKV(sheet, r, 'Yes on a Decision', 'Creates a Task.');
  r = writeKV(sheet, r, 'Today', 'Pulls Tasks through a staged priority order. Pending Decisions and Add/update now live on Home.');
  r = writeKV(sheet, r, 'Completing a Task', 'On Today or Tasks — always routes through the same completion engine, which updates source tabs and can create the next Task or Decision.');
  r++;

  r = writeH2(sheet, r, 'Onboarding');
  r = writeKV(sheet, r, 'Set up / redo onboarding', 'A popup captures your starting facts. Redoing onboarding clears existing planner data first, then rebuilds from what you enter — you never have to navigate a backend tab manually.');
  r = writeKV(sheet, r, 'Sectors — 3 stages', '1. Sector-only row → direct task to list 2-4 sub-sectors. 2. Sub-sector row → a Decision asking whether to build an organisation list there. 3. Yes → a Market-map task; No → nothing further.');
  r = writeKV(sheet, r, 'Direct sheet entry', 'Typing a Job title or Person name before Organisation defers the cascade (flagged [pending-org] in Notes) until Organisation is filled in on that row — it then fires automatically with full context.');
  r++;

  r = writeH2(sheet, r, "Today's priority order");
  r = writeKV(sheet, r, 'Staged, not scored', '1 manually pulled-in tasks · 2 tasks already in progress/touched today · 3 fixed work · 4 blocking work · 5 due/overdue keep-alive work · 6 active pursuit matching your focus · 7 at most one pipeline-building task · 8 active pursuit outside your focus, if capacity remains · 9 near-misses go to Options · 10 everything else stays in Tasks, out of sight but not gone. A kept time buffer applies throughout.');
  r = writeKV(sheet, r, 'Tier and Energy', 'Organisation Tier breaks ties within a stage — it never changes which stage a task lands in. Low energy sinks Deep-effort work to the bottom of Active pursuit and Pipeline, but never excludes it.');
  r = writeKV(sheet, r, 'Notes on Today', 'Anything you type into a Today row\u2019s Notes cell is kept across refreshes. The system\u2019s "Why" explanation now lives in the cell\u2019s note (hover to see it) rather than the value.');
  r = writeKV(sheet, r, 'Multi-day tasks', 'Excluded from Today until broken down. A stale one is flagged in the "Needs breakdown" section — use Row actions → Break down (on Tasks) to split it into real sub-tasks.');
  r++;

  r = writeH2(sheet, r, 'Pending Decisions');
  r = writeKV(sheet, r, 'States', 'Pending / Yes / No / Auto-dismissed. There is no "Later" — a suggestion either becomes a Task or is dismissed. Auto-dismissed is system-only, when the underlying state changes.');
  r++;

  r = writeH2(sheet, r, 'Tasks tab');
  r = writeKV(sheet, r, 'Commitment class', 'Fixed / Blocking / Keep-alive / Active pursuit / Pipeline-building / Backlog, in priority order — visible now, colour-coded. Sort by Priority rank (1=Fixed…6=Backlog) for a real priority order; sorting Commitment class alone is alphabetical, not priority.');
  r = writeKV(sheet, r, 'Linked to', 'Jumps to the source row (Job/Person/Organisation/Interview round/Sector). Blank when a task has no linked object (e.g. Admin).');
  r = writeKV(sheet, r, 'On Today right now / Has sub-tasks', 'Both auto-computed — no manual upkeep.');
  r = writeKV(sheet, r, 'Row actions', 'Break down (Multi-day only) · Mark blocked (prompts for a reason) · Defer 3 days (pushes the due date and recalculates Commitment class — Tasks has no Deferred status of its own, unlike Today).');
  r = writeKV(sheet, r, 'Row highlighting', 'Terminal rows (Done/Skipped/Cancelled) dim. Any row carrying a health flag — missing estimate, missing linked object, missing due date on a date-sensitive workflow, already-broken-down parent still open, or manually blocked — highlights instead.');
  r = writeKV(sheet, r, 'Moving a status backward', 'Every automatic cascade only ever moves forward or ends at a Decision/terminal status — nothing loops on its own. Manually moving a source object backward (e.g. a Job from Interviewing back to Applied) re-runs that forward cascade again, including re-creating a task whose original copy is already Done. This is a known, accepted boundary, not a bug: guarding against backward moves would also block legitimate corrections. Forward-only usage is fully deduplicated; deliberately reversing a status re-does the cascade from that point on.');
  r++;

  r = writeH2(sheet, r, 'Jobs statuses');
  r = writeKV(sheet, r, 'Six states', 'Want to apply → Applied → Interviewing → Offer / Parked / Closed.');
  r++;

  r = writeH2(sheet, r, 'People stages');
  r = writeKV(sheet, r, 'Seven states', 'Identified → Outreach sent → Engaged → Conversation scheduled → Conversation completed → Nurture / Closed.');
  r++;

  r = writeH2(sheet, r, 'Column visibility');
  sheet.getRange(r, 2).setValue('Every tab shows what you type into leftmost. IDs, backend dates, and system-managed columns are hidden by default. Menu → "Show all columns" reveals them for a research pass.').setFontSize(10).setWrap(true); r += 2;

  r = writeH2(sheet, r, 'If something breaks');
  r = writeKV(sheet, r, 'Menu missing', 'Extensions → Apps Script → run onOpen. Reload.');
  r = writeKV(sheet, r, 'Popups not opening', 'Menu → Maintenance → Install edit trigger (one-time, grants full authorization for modal dialogs).');
  r = writeKV(sheet, r, 'Home not refreshing', 'Menu → Refresh Home, or tick the refresh checkbox on Home.');
  r = writeKV(sheet, r, 'Today looks stale', 'Menu → Today → Populate Today.');
  r = writeKV(sheet, r, 'Formatting looks off', 'Menu → Maintenance → Repair all tabs.');
  r++;

  sheet.getRange(r, 2).setValue('Version').setFontSize(12).setFontWeight('bold').setFontColor('#7A7974'); r++;
  sheet.getRange(r, 2).setValue('Code.gs ' + SCRIPT_VERSION + ' · Google Sheet only · No external dependencies').setFontSize(10).setFontColor('#7A7974').setFontStyle('italic');
}

// =============================================================
// REPAIR, MAINTENANCE, TRIGGERS
// =============================================================

function repairOrganisationsFormulas() {
  var sheet = getSheet('Organisations');
  if (!sheet || sheet.getLastRow() < 2) return;
  for (var r = 2; r <= sheet.getLastRow(); r++) {
    if (sheet.getRange(r, COLS.ORGS.NAME).getValue()) applyOrgRowFormulas(sheet, r);
  }
}

function orgIdExistsMap() {
  var sheet = getSheet('Organisations');
  var out = {};
  if (!sheet || sheet.getLastRow() < 2) return out;
  var ids = sheet.getRange(2, COLS.ORGS.ID, sheet.getLastRow() - 1, 1).getValues();
  ids.forEach(function (r) { if (r[0]) out[String(r[0])] = true; });
  return out;
}

function jobIdExistsMap() {
  var sheet = getSheet('Jobs');
  var out = {};
  if (!sheet || sheet.getLastRow() < 2) return out;
  var ids = sheet.getRange(2, COLS.JOBS.ID, sheet.getLastRow() - 1, 1).getValues();
  ids.forEach(function (r) { if (r[0]) out[String(r[0])] = true; });
  return out;
}

function personIdExistsMap() {
  var sheet = getSheet('People');
  var out = {};
  if (!sheet || sheet.getLastRow() < 2) return out;
  var ids = sheet.getRange(2, COLS.PEOPLE.ID, sheet.getLastRow() - 1, 1).getValues();
  ids.forEach(function (r) { if (r[0]) out[String(r[0])] = true; });
  return out;
}

function syncJobsPeopleHealthFlags() {
  var todayDate = today();
  var count = 0;
  var orgIds = orgIdExistsMap();
  var jobsSheet = getSheet('Jobs');
  if (jobsSheet && jobsSheet.getLastRow() >= 2) {
    var jobs = jobsSheet.getRange(2, 1, jobsSheet.getLastRow() - 1, HEADERS.Jobs.length).getValues();
    for (var j = 0; j < jobs.length; j++) {
      var jr = j + 2;
      var status = normalizeJobStatus(jobs[j][COLS.JOBS.STATUS - 1]);
      var deadline = jobs[j][COLS.JOBS.DEADLINE - 1];
      if (status === 'Want to apply' && deadline && new Date(deadline) < todayDate) {
        appendNoteFlag(jobsSheet, jr, COLS.JOBS.NOTES, '[missed-deadline] Deadline passed while still Want to apply');
        count++;
      } else {
        clearNoteFlag(jobsSheet, jr, COLS.JOBS.NOTES, '[missed-deadline]');
      }
      var jobOrgId = String(jobs[j][COLS.JOBS.ORG_ID - 1] || '');
      if (jobOrgId && !orgIds[jobOrgId]) {
        appendNoteFlag(jobsSheet, jr, COLS.JOBS.NOTES, '[orphaned-org] Linked Organisation no longer exists');
        count++;
      } else {
        clearNoteFlag(jobsSheet, jr, COLS.JOBS.NOTES, '[orphaned-org]');
      }
    }
  }
  var peopleSheet = getSheet('People');
  if (peopleSheet && peopleSheet.getLastRow() >= 2) {
    var people = peopleSheet.getRange(2, 1, peopleSheet.getLastRow() - 1, HEADERS.People.length).getValues();
    for (var p = 0; p < people.length; p++) {
      var personOrgId = String(people[p][COLS.PEOPLE.ORG_ID - 1] || '');
      if (personOrgId && !orgIds[personOrgId]) {
        appendNoteFlag(peopleSheet, p + 2, COLS.PEOPLE.NOTES, '[orphaned-org] Linked Organisation no longer exists');
        count++;
      } else {
        clearNoteFlag(peopleSheet, p + 2, COLS.PEOPLE.NOTES, '[orphaned-org]');
      }
    }
  }
  var taskSheet = getSheet('Tasks');
  if (taskSheet && taskSheet.getLastRow() >= 2) {
    var jobIds = jobIdExistsMap(), personIds = personIdExistsMap();
    var tasks = taskSheet.getRange(2, 1, taskSheet.getLastRow() - 1, HEADERS['To-do'].length).getValues();
    for (var t = 0; t < tasks.length; t++) {
      var type = String(tasks[t][COLS.TODO.OBJ_TYPE - 1] || '');
      var id = String(tasks[t][COLS.TODO.OBJ_ID - 1] || '');
      var isLinkedJobOrPerson = (type === 'Job' || type === 'Person') && !!id;
      if ((type === 'Job' && id && !jobIds[id]) || (type === 'Person' && id && !personIds[id])) {
        appendNoteFlag(taskSheet, t + 2, COLS.TODO.NOTES, '[orphaned-link] Linked ' + type + ' no longer exists');
        count++;
      } else if (isLinkedJobOrPerson) {
        clearNoteFlag(taskSheet, t + 2, COLS.TODO.NOTES, '[orphaned-link]');
      }
    }
  }
  var decisionSheet = getSheet('Decisions');
  if (decisionSheet && decisionSheet.getLastRow() >= 2) {
    var dJobIds = jobIdExistsMap(), dPersonIds = personIdExistsMap();
    var decisions = decisionSheet.getRange(2, 1, decisionSheet.getLastRow() - 1, HEADERS['Pending decisions'].length).getValues();
    for (var d = 0; d < decisions.length; d++) {
      var dType = String(decisions[d][COLS.DECISIONS.TARGET_TYPE - 1] || '');
      var dId = String(decisions[d][COLS.DECISIONS.TARGET_ID - 1] || '');
      var dIsLinkedJobOrPerson = (dType === 'Job' || dType === 'Person') && !!dId;
      if ((dType === 'Job' && dId && !dJobIds[dId]) || (dType === 'Person' && dId && !dPersonIds[dId])) {
        appendNoteFlag(decisionSheet, d + 2, COLS.DECISIONS.NOTES, '[orphaned-link] Linked ' + dType + ' no longer exists');
        count++;
      } else if (dIsLinkedJobOrPerson) {
        clearNoteFlag(decisionSheet, d + 2, COLS.DECISIONS.NOTES, '[orphaned-link]');
      }
    }
  }
  return count;
}

function ensureCanonicalSheet(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = getSheet(name);
  if (!sheet) sheet = ss.insertSheet(name);
  return sheet;
}

// Idempotent — safe to run any time, on a fresh sheet or an existing one.
// v7.1: migrateLegacyTabs() now runs FIRST, before any canonical sheet
// is created, so a v6.x workbook's existing tabs are renamed in place
// (data preserved) rather than shadowed by new empty canonical tabs.
function repairAllTabs() {
  migrateLegacyTabs();

  CANONICAL_TAB_ORDER.forEach(function (name) {
    var headerKey = SHEET_TO_HEADER_KEY[name];
    if (!headerKey) return;
    var headers = HEADERS[headerKey];
    var sheet = ensureCanonicalSheet(name);
    if (name === 'Today') return; // Today's layout is built by bootstrapToday, not a plain header row
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    styleHeader(sheet, headers.length);
    applySheetDropdowns(name);
  });
  ensureDecisionsTab();
  applySheetDropdowns('Decisions');

  repairSectorRows();
  repairOrgTaxonomyLinks();
  repairSectorTaskLinks();
  detectSectorOrphans();
  syncJobsPeopleHealthFlags();
  repairOrganisationsFormulas();
  refreshLinkedContactsDisplay();
  repairInteractionPersonLinks();
  recalculateCommitmentClasses();
  backfillTaskHelperColumns();
  setupTasksTabExtras();

  bootstrapToday();
  populateToday();
  rewriteGuide();
  refreshHome();

  applyAllRichTextHeaders();
  colorCodeManualFields();
  applyStatusColorCoding();
  applyColumnLayout();
  applyColumnWidths();
  hideLegacyUtilityTabs();
  reorderAndColourTabs();

  buildMenu();
  // v7.3: every manual repair forces a trigger installation check, so the
  // installable edit trigger (onboarding / Add-update popups) can never
  // silently stay missing after a Maintenance run. Idempotent + silent.
  ensureTriggersInstalled({ silent: true });
  SpreadsheetApp.getActiveSpreadsheet().toast('All tabs repaired + triggers verified (' + SCRIPT_VERSION + ').', 'The Planner', 4);
}

function dailyMaintenance() {
  // v7.3: whole daily batch runs under the document lock so it can't
  // interleave with a user edit mid-cascade.
  withDocumentLock(function () {
    Logger.log('dailyMaintenance: START ' + new Date());
    checkMorningCarryForward();
    recalculateCommitmentClasses();
    backfillTaskHelperColumns();
    runQueueHygiene();
    materializeDueTasks();
    repairSectorRows();
    repairSectorTaskLinks();
    detectSectorOrphans();
    syncJobsPeopleHealthFlags();
    checkDomainReadinessFlags();
    checkInterviewRoundHealthFlags();
    refreshInteractionPersonDropdown();
    repairInteractionPersonLinks();
    populateToday();
    refreshHome();
    Logger.log('dailyMaintenance: DONE ' + new Date());
  }, { label: 'dailyMaintenance', timeoutMs: 30000 });
}

function fullRefresh() {
  // v7.3: also force a trigger check on every full refresh.
  ensureTriggersInstalled({ silent: true });
  dailyMaintenance();
  colorCodeManualFields();
  applyStatusColorCoding();
  applyAllRichTextHeaders();
  applyColumnWidths();
  applyColumnLayout();
  refreshAllDropdowns();
  refreshHome();
  renderTodayDecisionCards();
}

// Back-compat: force-reinstall the time triggers only (leaves the edit
// trigger as-is). Routes through the shared engine via the specs.
function installTimeTriggers() {
  var tz = plannerTimeZone();
  var created = [];
  TIME_TRIGGER_SPECS.forEach(function (spec) {
    deleteTriggersFor(spec.handler, ScriptApp.EventType.CLOCK);
    spec.build(tz).create();
    created.push(spec.handler + ' (' + spec.desc + ')');
  });
  SpreadsheetApp.getActiveSpreadsheet().toast('Time triggers installed (' + tz + '): ' + created.join(', ') + '.', 'The Planner', 6);
}

function uninstallTimeTriggers() {
  var removed = 0;
  TIME_TRIGGER_SPECS.forEach(function (spec) {
    removed += deleteTriggersFor(spec.handler, ScriptApp.EventType.CLOCK);
  });
  SpreadsheetApp.getActiveSpreadsheet().toast('Removed ' + removed + ' time-based trigger(s). The edit trigger (if installed) is untouched — use "Triggers & setup" for that.', 'The Planner', 5);
}

// =============================================================
// MENU
// =============================================================

function buildMenu() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('The Planner')
    .addItem('Set up / redo onboarding', 'runSetupInterview')
    .addItem('Open / populate Today', 'populateToday')
    .addItem('Refresh Home', 'refreshHome')
    .addItem('Add ad-hoc task', 'addAdHocTodo')
    .addSeparator()
    .addSubMenu(ui.createMenu('Today')
      .addItem('Populate Today', 'populateToday')
      .addItem('Pull selected Task into Today', 'pullSelectedTaskIntoToday')
      .addItem('Top up Today', 'topUpToday')
      .addItem('Lock selected Today row', 'lockTodayRow')
      .addItem('Unlock selected Today row', 'unlockTodayRow')
      .addItem('Move selected row up', 'moveTodayRowUp')
      .addItem('Move selected row down', 'moveTodayRowDown')
      .addItem('Show all Today columns', 'showAllColumns'))
    .addSubMenu(ui.createMenu('Add/update popups')
      .addItem('Organisation', 'addNewOrganisation')
      .addItem('Person', 'addNewPerson')
      .addItem('Job', 'addNewJob')
      .addItem('Conversation', 'addNewInteraction'))
    .addSubMenu(ui.createMenu('Row actions')
      .addItem('Find people at selected org', 'rowActionFindPeopleAtSelectedOrg')
      .addItem('Scan jobs at selected org', 'rowActionScanJobsAtSelectedOrg')
      .addItem('Prep application for selected job', 'rowActionPrepSelectedJob')
      .addItem('Referral search for selected job', 'rowActionReferralSearchSelectedJob')
      .addItem('Search orgs for selected sub-sector', 'rowActionSearchOrgsForSubsector')
      .addItem('Break down selected sector', 'rowActionBreakDownSelectedSector')
      .addItem('Add interview round for selected job', 'rowActionAddInterviewRound')
      .addItem('Break down selected Multi-day task', 'rowActionBreakDownSelectedTask')
      .addItem('Mark selected Task blocked', 'rowActionMarkTaskBlocked')
      .addItem('Defer selected Task 3 days', 'rowActionDeferSelectedTask')
      .addSeparator()
      .addItem('Link contact to selected Job row', 'linkContactToJob')
      .addItem('Log conversation for selected row', 'logInteractionForRow')
      .addItem('Soft-close selected row', 'softCloseRow'))
    .addSubMenu(ui.createMenu('Triggers & setup')
      .addItem('\u2605 Set up / verify triggers (run this first)', 'setUpTriggers')
      .addItem('Show trigger status', 'showTriggerStatus')
      .addSeparator()
      .addItem('Reinstall edit-popup trigger only', 'installEditTrigger')
      .addItem('Uninstall edit-popup trigger', 'uninstallEditTrigger')
      .addItem('Reinstall scheduled jobs only', 'installTimeTriggers')
      .addItem('Uninstall scheduled jobs', 'uninstallTimeTriggers'))
    .addSubMenu(ui.createMenu('Maintenance')
      .addItem('Repair all tabs (safe to re-run)', 'repairAllTabs')
      .addItem('Migrate legacy tab names', 'migrateLegacyTabs')
      .addItem('Run daily maintenance now', 'dailyMaintenance')
      .addItem('Run weekly review now', 'weeklyReview')
      .addItem('Full refresh', 'fullRefresh')
      .addItem('Recalculate commitment classes', 'recalculateCommitmentClasses')
      .addItem('Show all columns', 'showAllColumns'))
    .addToUi();
}

// Simple onOpen trigger. Runs in a restricted auth context that CANNOT
// create installable triggers, so it does not attempt auto-wiring. Instead
// it *detects* whether the installable edit trigger is attached and shows
// an accurate, actionable prompt — replacing the old always-on "go install
// it" toast that fired even when the trigger was already present.
function onOpen() {
  buildMenu();
  refreshHome();
  renderTodayDecisionCards();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var editReady = false;
  try { editReady = triggerExists(EDIT_TRIGGER_HANDLER, ScriptApp.EventType.ON_EDIT); }
  catch (err) { Logger.log('onOpen trigger check: ' + err); }
  if (editReady) {
    ss.toast('The Planner ready. Start on Home.', 'The Planner', 4);
  } else {
    ss.toast('The Planner loaded, but edit popups are NOT wired yet. Run \u201cThe Planner \u2192 Triggers & setup \u2192 Set up / verify triggers\u201d once so onboarding and Add/update popups open reliably.', 'The Planner \u2014 one-time setup needed', 12);
  }
}
