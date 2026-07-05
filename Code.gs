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
 *   - Concurrency: mutating edit, popup, scheduled, menu, and row-action paths use withDocumentLock() where practical.
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
 *                Decisions (inline, actionable), the Capture update
 *                dropdown, a Today's-plan summary, an Upcoming feed, and a
 *                demoted utility refresh control. No raw task table here.
 *   Today      = purely the execution surface: priority/focus, available
 *                minutes, energy, capacity fit, and the Commit/Options
 *                task table. No data capture and no Pending Decisions.
 *   Decisions  = the suggestion queue. States: Pending / Yes / No /
 *                Auto-dismissed. No "Later". Yes routes to the configured
 *                next step: task, popup, capture, source update, or dismiss.
 *   Tasks      = sole owner of task existence, status, linked object,
 *                and workflow. Completion always routes through the
 *                same canonical engine regardless of which tab it was
 *                triggered from (Today or Tasks).
 *   Sectors / Organisations / Jobs / People / Conversations / Interviews
 *              = source-of-truth database tabs. Editable directly, but
 *                routine daily capture should happen via Home's
 *                Capture update popups, not by navigating to these tabs.
 *
 * OPERATING RHYTHM
 * ----------------
 *   Welcome → Resolve → Capture → Plan → Execute → Monitor.
 *
 * FLOW
 * ----
 *   Capture update popup → writes real source tab → cascades create
 *   Decisions (only where judgment is genuinely needed — creating or
 *   classifying an Organisation never floods job/people-search tasks
 *   on its own) → Yes on a Decision creates a Task → Today pulls
 *   Tasks through a staged, explicit priority waterfall → completing
 *   a Task on Today or Tasks routes through one canonical handler →
 *   source tabs and downstream cascades update from there.
 *
 * ONBOARDING
 * ----------
 *   "Start or redo setup" is destructive-then-rebuild: it wipes
 *   existing planner data (Sectors/Organisations/Jobs/People/
 *   Conversations/Interviews/Tasks/Decisions bodies) before writing
 *   anything, then captures starting facts entirely through popups —
 *   the user never has to manually navigate to a backend tab. Sector
 *   onboarding is 3 explicit stages:
 *     1. Sector-only row      → direct Task: "Add 2-4 sub-sector rows"
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
 *   3. Reload the sheet.
 *   4. In The Planner menu, run Triggers & setup > Set up / verify triggers.
 *   5. Run Maintenance > Repair all tabs (safe to re-run).
 *   6. Start from Home, or run The Planner > Start or redo setup.
 */

// =============================================================
// SCHEMA — single source of truth for column layout
// =============================================================

var COLS = {
  SECTORS: { ID: 1, SECTOR: 2, SUBSECTOR_ID: 3, SUBSECTOR: 4, STATUS: 5, NOTES: 6 },

  ORGS: {
    ID: 1, NAME: 2, SECTOR_ID: 3, SECTOR: 4, SUBSECTOR_ID: 5, SUBSECTOR: 6,
    TIER: 7, STATUS: 8,
    KNOWN_PEOPLE: 9, OPEN_OPPS: 10,
    LAST_CHECKED: 11, NEXT_CHECK: 12, NOTES: 13
  },

  PEOPLE: {
    ID: 1, NAME: 2, ORG: 3, ORG_ID: 4,
    ROLE: 5, REL_TYPE: 6, STAGE: 7,
    FOLLOW_UP_DATE: 8, REPLY_RECEIVED: 9,
    FOLLOW_UP_SENT: 10, OUTREACH_DATE: 11,
    CONVERSATION_DATE: 12, NOTES: 13,
    FOLLOW_UPS_SENT_COUNT: 14,
    LAST_INTERACTION: 15, NEXT_ACTION: 16, LINKED_JOBS: 17
  },

  JOBS: {
    ID: 1, OPPORTUNITY: 2, ORG: 3, ORG_ID: 4,
    DEADLINE: 5, STATUS: 6, APPLIED_DATE: 7,
    CONTACTS_IDS: 8, CONTACTS_DISPLAY: 9,
    REVIEW_DATE: 10, RESPONSE: 11, OUTCOME: 12, NOTES: 13
  },

  INTERACTIONS: {
    ID: 1, DATE: 2, PERSON_ID: 3, PERSON: 4, ORG: 5,
    TYPE: 6, STATUS: 7, NOTES: 8, OUTCOME: 9
  },

  TODO: {
    ID: 1, TASK: 2, OBJ_TYPE: 3, OBJ_ID: 4, ORG: 5,
    WORKFLOW: 6, STATUS: 7, DUE_DATE: 8, TIME_EST: 9,
    NOTES: 10, PARENT_ID: 11, CREATED: 12, COMPLETED: 13,
    COMMITMENT_CLASS: 14, SOURCE: 15, LAST_EDITED: 16,
    CLASS_CALC_AT: 17, EFFORT_TYPE: 18,
    // v7.6 — appended, never inserted mid-schema (would shift every
    // trailing index file-wide for a purely cosmetic win).
    PRIORITY_RANK: 19, LINKED_TO: 20, ON_TODAY: 21, HAS_SUBTASKS: 22,
    PLAN_CATEGORY: 23, PLAN_PATTERN: 24, STEP: 25,
    PARENT_TASK: 26, READY_FOR_TODAY: 27, CHILD_PROGRESS: 28,
    BLOCKER: 29, BLOCKED_BY_ID: 30
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
    DECISION: 10, DECIDED_AT: 11, TODO_ID: 12,
    ACTION_TYPE: 13, DUE_DATE: 14, LINKED_TO: 15, RESULT: 16
  },

  TODAY: {
    SLOT: 1, TASK: 2, TODO_ID: 3, EST_MIN: 4,
    CLASS: 5, EFFORT: 6, STATUS: 7, ACTUAL_MIN: 8, NOTES: 9
  }
};

var HEADERS = {
  Sectors: ['Sector ID', 'Sector', 'Sub-sector ID', 'Sub-sector', 'Status', 'Notes'],
  Organisations: [
    'Org ID', 'Organisation', 'Sector ID', 'Sector', 'Sub-sector ID', 'Sub-sector',
    'Tier', 'Status', 'Known people (count)', 'Open opportunities (count)',
    'Last checked', 'Next check date', 'Notes'
  ],
  People: [
    'Person ID', 'Name', 'Organisation', 'Org ID',
    'Role', 'Relationship source', 'Relationship status',
    'Next follow-up date', 'Reply received',
    'Follow-up sent?', 'Outreach date', 'Conversation date',
    'Context / notes', 'Follow-ups sent count',
    'Last interaction', 'Next action', 'Linked jobs'
  ],
  Jobs: [
    'Job ID', 'Opportunity', 'Organisation', 'Org ID',
    'Deadline', 'Application status', 'Submitted date',
    'Linked contacts (IDs)', 'People for this application',
    'Next response check', 'Response received', 'Application result', 'Notes'
  ],
  Interactions: [
    'Interaction ID', 'Date', 'Person ID', 'Person', 'Organisation',
    'Type', 'Interaction status', 'Key notes', 'Outcome'
  ],
  'To-do': [
    'Task ID', 'Task', 'Linked object type', 'Linked object ID', 'Org',
    'Workflow type', 'Status', 'Due date', 'Time estimate',
    'Notes', 'Parent To-do ID', 'Created', 'Completed',
    'Commitment class', 'Source', 'Last edited', 'Class calculated at', 'Effort type',
    'Priority rank', 'Linked to', 'On Today right now', 'Has sub-tasks',
    'Plan category', 'Plan pattern', 'Step', 'Parent task',
    'Ready for Today', 'Child progress', 'Blocker', 'Blocked by To-do ID'
  ],
  'Interview rounds': [
    'Round ID', 'Linked Job ID', 'Job (display)', 'Org (display)',
    'Round', 'Round type', 'Interview date',
    'Status', 'Domain readiness',
    'Official outcome', 'Expected response / follow-up date', 'Notes'
  ],
  'Pending decisions': [
    'Decision ID', 'Created', 'Decision key', 'Trigger', 'Suggested action',
    'Target type', 'Target ID', 'Suggested workflow', 'Notes',
    'Decision', 'Decided at', 'Resulting To-do ID',
    'Decision action type', 'Review by', 'Linked to', 'Result'
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
  'Guide': null
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

var CANONICAL_TAB_ORDER = ['Home', 'Today', 'Decisions', 'Tasks', 'Sectors', 'Organisations', 'Jobs', 'People', 'Interviews', 'Conversations', 'Guide'];
var ZONE_WORK_TABS = ['Home', 'Today', 'Decisions', 'Tasks'];
var ZONE_DATA_TABS = ['Sectors', 'Organisations', 'Jobs', 'People', 'Interviews', 'Conversations'];
var ZONE_REF_TABS = ['Guide'];
var ZONE_WORK_COLOR = '#1B474D';
var ZONE_DATA_COLOR = '#964219';
var ZONE_REF_COLOR = '#7A7974';
var HEADER_COLOR = '#1B474D';
var MANUAL_COLOR = '#FFF8DC';
var AUTO_COLOR = '#F1F3F4';
var SCRIPT_VERSION = 'v7.7.4';
var ORG_NEEDS_CLASSIFICATION_LABEL = 'Needs classification';
var ORG_NEEDS_CLASSIFICATION_FLAG = '[needs-classification]';
var ORG_CLASSIFICATION_WORKFLOW = 'Organisation classification';
var ORG_ACTIVE_REVIEW_DAYS = 14;
var ORG_DORMANT_REVIEW_DAYS = 42;

var DROPDOWNS = {
  SECTOR_STATUS: ['Open', 'Retired'],

  ORG_TIER: ['A', 'B', 'C'],
  ORG_STATUS: ['Mapped', 'Active', 'Dormant', 'Archived'],

  PERSON_STAGE: ['Identified', 'To outreach', 'Outreach drafted', 'Outreach sent', 'Replied', 'Conversation scheduled', 'Conversation completed', 'Keep warm', 'Closed'],
  PERSON_REL_TYPE: ['Ex-colleague / work history', 'Alumni / institutional', 'Warm network', 'Professional community', 'Recruiter / intermediary', 'Field-visible person', 'Cold target search', 'Other'],
  YES_NO: ['Yes', 'No'],

  JOB_STATUS: ['Not started', 'In progress', 'Submitted', 'Closed'],
  JOB_OUTCOME: ['Waiting', 'Interview invite', 'Rejected'],

  INTERACTION_TYPE: ['Intro call', 'Coffee', 'LinkedIn message', 'Email', 'Phone', 'Interview', 'Referral', 'Auto-log', 'Other'],
  INTERACTION_STATUS: ['Scheduled', 'Completed', 'Cancelled'],
  INTERACTION_OUTCOME: ['Useful', 'Neutral', 'Dead end', 'Referral given', 'Opportunity created', 'Follow-up needed', 'System log'],

  TODO_OBJ_TYPE: ['Sector', 'Organisation', 'Person', 'Job', 'Interview round', 'None'],
  TODO_WORKFLOW: [
    'Sector selection', 'Market mapping', 'Organisation classification', 'Org research',
    'Job board scan', 'Org job scan', 'Opportunity scan', 'People sourcing', 'People source scan',
    'Outreach', 'Send outreach', 'Contact follow-up',
    'Reply and arrange conversation', 'Conversation prep',
    'Reschedule conversation', 'Conversation debrief', 'Referral search',
    'Application preparation', 'Application blocker', 'Submit application',
    'Check application response', 'Offer decision',
    'Interview scheduling', 'Plan interview prep', 'Interview prep',
    'Interview prep (Domain scoping)',
    'Interview prep (Study)', 'Interview prep (Fit case)',
    'Day-before review', 'Thank-you and debrief',
    'Interview follow-up', 'Task unblocker', 'Admin'
  ],
  TODO_STATUS: ['Not started', 'In progress', 'Blocked', 'Done', 'Skipped', 'Cancelled'],
  TODO_PLAN_PATTERN: ['Parallel', 'Step-based'],
  READY_FOR_TODAY: ['Ready', 'Waiting', 'Blocked', 'Parent', 'Needs planning', 'Done'],
  // v7.6.1: 'Custom…' removed per the handover spec (§8) — never made
  // functional, and parseTimeEst silently treated it as 30 min, which
  // was misleading. Consistent with minimizing daily choices elsewhere.
  TODO_TIME: ['15 min', '30 min', '45 min', '60 min', '90 min', '120 min', 'Multi-day'],
  TODO_COMMITMENT_CLASS: ['Fixed', 'Blocking', 'Keep-alive', 'Active pursuit', 'Pipeline-building', 'Backlog'],
  TODO_SOURCE: ['Auto-triggered', 'Manually added', 'Onboarding', 'Decision', 'Manual pull'],

  ROUND_TYPE: ['Recruiter', 'Hiring manager', 'Panel', 'Case', 'Technical', 'Culture fit', 'Final', 'Other'],
  ROUND_STATUS: ['To schedule', 'Scheduled', 'Completed', 'Cancelled', 'Reschedule'],
  DOMAIN_READINESS: ['Strong', 'Refresh needed', 'Weak or new'],
  OFFICIAL_OUTCOME: ['Waiting', 'Next round', 'Declined', 'Offer', 'Parked'],

  TODAY_STATUS: ['Planned', 'In progress', 'Blocked', 'Done', 'Deferred', 'Skipped'],
  // v7.4: Option rows get a smaller status list — 'Pull in' promotes the
  // row into Commit on the spot instead of waiting for the next refresh.
  TODAY_STATUS_OPTION: ['Deferred', 'Done', 'Pull in'],
  TODAY_ENERGY: ['Low', 'Normal', 'High'],
  TODAY_PRIORITY: ['Default', 'Applications', 'Networking', 'Interviews', 'Pipeline building', 'Admin / light day'],
  TODAY_UPDATE_TYPES: [
    'No updates', 'Explore sectors', 'Find organisations',
    'Capture organisation', 'Capture job', 'Application update',
    'Capture person', 'Capture conversation', 'Capture interview',
    'Task completed / blocked'
  ],

  // Pending decisions — no "Later". Auto-dismissed is system-only.
  DECISION: ['Pending', 'Yes', 'No', 'Auto-dismissed'],
  DECISION_ACTION_TYPE: ['Create task', 'Open popup', 'Update source', 'Capture data', 'Dismiss only']
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

function okResult(message, extras) {
  var out = extras || {};
  out.ok = true;
  out.message = message || 'Saved.';
  if (!out.warnings) out.warnings = [];
  return out;
}

function failResult(message, field, code) {
  return {
    ok: false,
    message: message || 'Please check the form.',
    field: field || '',
    code: code || 'VALIDATION_ERROR'
  };
}

function coerceResult(result, fallbackMessage) {
  if (result && typeof result === 'object' && result.ok !== undefined) return result;
  if (result && typeof result === 'object' && result.message) return okResult(result.message, result);
  return okResult(result || fallbackMessage || 'Saved.');
}

function popupExceptionResult(context, err) {
  Logger.log(context + ': ' + (err && err.stack ? err.stack : err));
  return failResult('Something went wrong while saving. Run Maintenance > Repair all tabs, then try again.', '', 'SERVER_ERROR');
}

// v7.3.1: Serialises covered mutating paths behind a single document lock so
// two overlapping edits (or an edit landing while dailyMaintenance runs)
// are much less likely to double-create tasks or collide on nextId() /
// appendRow(). Runs fn while holding the lock and always releases it, even
// on error.
//
// IMPORTANT (v7.3.1 fix): if the lock can't be acquired within the
// timeout, fn is STILL RUN (unguarded) rather than silently skipped. In a
// single-user planner, lock contention is rare, but a user clicking
// "Build / refresh Today's plan" and getting NOTHING (no plan, no date update, no error)
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
  var failOpen = opts.failOpen !== false;
  if (_PLANNER_LOCK_HELD) return fn();   // already inside a locked section
  var lock = LockService.getDocumentLock();
  var got = false;
  try {
    try { got = lock.tryLock(timeoutMs); }
    catch (lockErr) { Logger.log('withDocumentLock acquire (' + label + '): ' + lockErr); got = false; }
    if (!got) {
      if (!failOpen) {
        recordMaintenanceError(label, 'Lock unavailable after ' + timeoutMs + 'ms');
        Logger.log('withDocumentLock: lock unavailable for ' + label + ' after ' + timeoutMs + 'ms - skipped.');
        return null;
      }
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

function maintenanceProps() {
  return PropertiesService.getDocumentProperties();
}

function recordMaintenanceHeartbeat(key) {
  try {
    maintenanceProps().setProperty(key, new Date().toISOString());
  } catch (err) {
    Logger.log('recordMaintenanceHeartbeat: ' + err);
  }
}

function recordMaintenanceError(label, message) {
  try {
    maintenanceProps().setProperty('lastMaintenanceError', new Date().toISOString() + ' ' + label + ': ' + message);
  } catch (err) {
    Logger.log('recordMaintenanceError: ' + err);
  }
}

// Tracks when Today's plan was last (re)built, independent of the B2
// display cell — B2 is a live =TODAY() formula so the visible date is
// always current even when nothing has (re)generated the plan; the
// staleness checks (collectPreviousTodayState, todayPlanCounts,
// checkMorningCarryForward) need the actual last-build date instead.
function getTodayPlanBuiltDate() {
  var raw = maintenanceProps().getProperty('todayPlanBuiltDate');
  if (!raw) return null;
  // Split manually rather than `new Date(raw)` — a bare 'yyyy-MM-dd'
  // string parses as UTC midnight, which drifts a calendar day off
  // today()'s local-midnight construction in non-UTC timezones.
  var parts = raw.split('-');
  if (parts.length !== 3) return null;
  var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  return isNaN(d.getTime()) ? null : d;
}

function setTodayPlanBuiltDate(d) {
  maintenanceProps().setProperty('todayPlanBuiltDate', Utilities.formatDate(d, plannerTimeZone(), 'yyyy-MM-dd'));
}

function todayPlanBuiltDateNote(d) {
  return 'Built date: ' + Utilities.formatDate(d, plannerTimeZone(), 'yyyy-MM-dd');
}

function todayPlanDateFromNote(note) {
  var match = String(note || '').match(/Built date:\s*(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  var d = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return isNaN(d.getTime()) ? null : d;
}

function readMaintenanceHealth() {
  var props = maintenanceProps();
  var now = new Date();
  var dailyRaw = props.getProperty('lastDailyMaintenanceAt') || '';
  var weeklyRaw = props.getProperty('lastWeeklyReviewAt') || '';
  var weeklySummary = props.getProperty('lastWeeklyReviewSummary') || '';
  var error = props.getProperty('lastMaintenanceError') || '';
  var stale = false;
  var weeklyStale = false;
  if (dailyRaw) {
    var dailyDate = new Date(dailyRaw);
    stale = !isNaN(dailyDate.getTime()) && ((now.getTime() - dailyDate.getTime()) > 2 * 24 * 60 * 60 * 1000);
  }
  if (weeklyRaw) {
    var weeklyDate = new Date(weeklyRaw);
    weeklyStale = !isNaN(weeklyDate.getTime()) && ((now.getTime() - weeklyDate.getTime()) > 8 * 24 * 60 * 60 * 1000);
  }
  return { daily: dailyRaw, weekly: weeklyRaw, weeklySummary: weeklySummary, error: error, stale: stale, weeklyStale: weeklyStale };
}

function today() {
  var parts = Utilities.formatDate(new Date(), plannerTimeZone(), 'yyyy-MM-dd').split('-');
  return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
}

function addDays(date, days) { var d = new Date(date); d.setDate(d.getDate() + days); return d; }
function daysBetween(a, b) { return Math.floor((new Date(b) - new Date(a)) / 86400000); }
function isDueOnOrBefore(dateValue, targetDate) {
  if (!dateValue) return false;
  var d = new Date(dateValue);
  return !isNaN(d.getTime()) && d <= targetDate;
}

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
  sheet.getRange(1, 1, 1, numCols).clearNote().setBackground(HEADER_COLOR).setFontColor('#FFFFFF').setFontWeight('bold');
}

function setDropdown(range, values, opts) {
  opts = opts || {};
  var allowInvalid = opts.allowInvalid !== false;
  range.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(values, true).setAllowInvalid(allowInvalid).build());
}

function normalizeTier(value) {
  var v = String(value || '').trim().toUpperCase();
  return (DROPDOWNS.ORG_TIER.indexOf(v) !== -1) ? v : 'B';
}

function normalizeOrgStatus(value) {
  var v = String(value || '').trim();
  return DROPDOWNS.ORG_STATUS.indexOf(v) !== -1 ? v : 'Mapped';
}

function normalizeJobStatus(value) {
  var v = String(value || '').trim();
  var legacyMap = {
    'Found': 'Not started',
    'Worth exploring': 'Not started',
    'Referral needed': 'Not started',
    'Apply now': 'In progress',
    'To pursue': 'Not started',
    'Application ready': 'In progress',
    'Want to apply': 'Not started',
    'Applied': 'Submitted',
    'Interviewing': 'Submitted',
    'Offer': 'Submitted',
    'Parked': 'Closed'
  };
  return legacyMap[v] || (DROPDOWNS.JOB_STATUS.indexOf(v) !== -1 ? v : '');
}

function normalizeJobOutcome(value) {
  var v = String(value || '').trim();
  var legacyMap = {
    '': '',
    'No response': 'Waiting',
    'No response yet': 'Waiting',
    'Interview': 'Interview invite',
    'Interviewing': 'Interview invite',
    'Next round': 'Interview invite',
    'Closed': 'Rejected',
    'Reject': 'Rejected'
  };
  return legacyMap[v] !== undefined ? legacyMap[v] : (DROPDOWNS.JOB_OUTCOME.indexOf(v) !== -1 ? v : '');
}

function normalizePersonStage(value) {
  var v = String(value || '').trim();
  var legacyMap = {
    'Not contacted': 'Identified',
    'Outreach ready': 'To outreach',
    'Qualified': 'Identified',
    'Draft ready': 'Outreach drafted',
    'Pending reply': 'Outreach sent',
    'Engaged': 'Replied',
    'Relationship active': 'Replied',
    'Opportunity lead': 'Replied',
    'Nurture': 'Keep warm',
    'No reply': 'Keep warm',
    'Conversation to reschedule': 'Conversation scheduled'
  };
  return legacyMap[v] || (DROPDOWNS.PERSON_STAGE.indexOf(v) !== -1 ? v : '');
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

function findOrgByNameExact(name) {
  var sheet = getSheet('Organisations');
  if (!sheet || sheet.getLastRow() < 2 || !name) return null;
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS.Organisations.length).getValues();
  var target = normalizeKeyPart(name);
  for (var i = 0; i < data.length; i++) {
    if (normalizeKeyPart(data[i][COLS.ORGS.NAME - 1]) === target) return { row: i + 2, data: data[i], score: 1 };
  }
  return null;
}

function ensureOrgIdForMatchedRow(match) {
  if (!match) return '';
  var existingId = match.data[COLS.ORGS.ID - 1];
  if (existingId) return existingId;
  var sheet = getSheet('Organisations');
  if (!sheet) return '';
  var newId = nextId(sheet, COLS.ORGS.ID, 'ORG');
  sheet.getRange(match.row, COLS.ORGS.ID).setValue(newId);
  match.data[COLS.ORGS.ID - 1] = newId;
  applyOrgRowFormulas(sheet, match.row);
  appendNoteFlag(sheet, match.row, COLS.ORGS.NOTES, '[repaired-org-id] Org ID added while linking');
  return newId;
}

function confirmFuzzyOrgMatch(typedName, match) {
  if (!match) return false;
  var canonicalName = String(match.data[COLS.ORGS.NAME - 1] || '');
  if (normalizeKeyPart(typedName) === normalizeKeyPart(canonicalName)) return true;
  var ui = SpreadsheetApp.getUi();
  var resp = ui.alert(
    'Similar organisation found',
    '"' + typedName + '" looks similar to existing Organisation "' + canonicalName + '". Use the existing Organisation?',
    ui.ButtonSet.YES_NO
  );
  return resp === ui.Button.YES;
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
        sectorId: row[COLS.ORGS.SECTOR_ID - 1],
        sector: row[COLS.ORGS.SECTOR - 1],
        subsectorId: row[COLS.ORGS.SUBSECTOR_ID - 1],
        subsector: row[COLS.ORGS.SUBSECTOR - 1],
        tier: row[COLS.ORGS.TIER - 1],
        status: row[COLS.ORGS.STATUS - 1]
      };
    }
  }
  return null;
}

function applyOrgRowFormulas(sheet, row) {
  var orgIdRef = columnToLetter(COLS.ORGS.ID) + row;
  var peopleOrgIdCol = columnToLetter(COLS.PEOPLE.ORG_ID);
  var jobsOpportunityCol = columnToLetter(COLS.JOBS.OPPORTUNITY);
  var jobsOrgIdCol = columnToLetter(COLS.JOBS.ORG_ID);
  var jobsStatusCol = columnToLetter(COLS.JOBS.STATUS);
  sheet.getRange(row, COLS.ORGS.KNOWN_PEOPLE).setFormula('=COUNTIF(People!' + peopleOrgIdCol + ':' + peopleOrgIdCol + ',' + orgIdRef + ')');
  sheet.getRange(row, COLS.ORGS.OPEN_OPPS).setFormula(
    '=COUNTIFS(Jobs!' + jobsOrgIdCol + ':' + jobsOrgIdCol + ',' + orgIdRef + ',Jobs!' + jobsOpportunityCol + ':' + jobsOpportunityCol + ',"<>",Jobs!' + jobsStatusCol + ':' + jobsStatusCol + ',"<>Closed")');
}

function orgReviewIntervalDays(status) {
  status = normalizeOrgStatus(status);
  if (status === 'Active') return ORG_ACTIVE_REVIEW_DAYS;
  if (status === 'Dormant') return ORG_DORMANT_REVIEW_DAYS;
  return 0;
}

function nextOrgReviewDate(status) {
  var days = orgReviewIntervalDays(status);
  return days ? addDays(today(), days) : '';
}

function scheduleOrgReviewForRow(sheet, row, status, opts) {
  opts = opts || {};
  if (!sheet || !row) return;
  status = normalizeOrgStatus(status || sheet.getRange(row, COLS.ORGS.STATUS).getValue());
  if (opts.stampLastChecked) sheet.getRange(row, COLS.ORGS.LAST_CHECKED).setValue(today());
  var next = nextOrgReviewDate(status);
  if (next) sheet.getRange(row, COLS.ORGS.NEXT_CHECK).setValue(next);
  else sheet.getRange(row, COLS.ORGS.NEXT_CHECK).clearContent();
}

function scheduleOrgReviewById(orgId, opts) {
  var org = getOrgById(orgId);
  if (!org) return;
  var sheet = getSheet('Organisations');
  if (!sheet) return;
  scheduleOrgReviewForRow(sheet, org.row, org.status, opts || {});
}

function clearOrgRoutingFlags(sheet, row) {
  if (!sheet || !row) return;
  clearNoteFlag(sheet, row, COLS.ORGS.NOTES, '[review-routed]');
  clearNoteFlag(sheet, row, COLS.ORGS.NOTES, '[dormant-live]');
  clearNoteFlag(sheet, row, COLS.ORGS.NOTES, '[active-empty]');
}

function syncOrgReviewSchedules() {
  var sheet = getSheet('Organisations');
  if (!sheet || sheet.getLastRow() < 2) return 0;
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, COLS.ORGS.NEXT_CHECK).getValues();
  var updated = 0;
  for (var i = 0; i < data.length; i++) {
    var row = i + 2;
    var status = normalizeOrgStatus(data[i][COLS.ORGS.STATUS - 1]);
    var nextCheck = data[i][COLS.ORGS.NEXT_CHECK - 1];
    if ((status === 'Active' || status === 'Dormant') && !nextCheck) {
      sheet.getRange(row, COLS.ORGS.NEXT_CHECK).setValue(nextOrgReviewDate(status));
      updated++;
    } else if ((status === 'Mapped' || status === 'Archived') && nextCheck) {
      sheet.getRange(row, COLS.ORGS.NEXT_CHECK).clearContent();
      updated++;
    }
  }
  return updated;
}

function appendOrgReviewDecision(orgId, orgName, status) {
  status = normalizeOrgStatus(status);
  if (!orgId || !orgName || (status !== 'Active' && status !== 'Dormant')) return '';
  var sheet = getSheet('Organisations');
  var org = getOrgById(orgId);
  if (orgPursuitRouteExists(orgId)) {
    if (sheet && org) appendNoteFlag(sheet, org.row, COLS.ORGS.NOTES, '[review-routed] Org review already has an open route');
    scheduleOrgReviewById(orgId, { stampLastChecked: true });
    return '';
  }
  var isDormant = status === 'Dormant';
  var key = 'ORG_REVIEW_DUE:' + orgId + ':' + status;
  var trigger = (isDormant ? 'Dormant' : 'Active') + ' organisation due for review: ' + orgName;
  var task = 'Review ' + (isDormant ? 'dormant' : 'active') + ' org: ' + orgName;
  var notes = isDormant
    ? 'Decide whether to reactivate, extend dormancy, or archive.'
    : 'Decide whether to find people, scan jobs, keep active, park, or archive.';
  var decisionId = appendPendingDecision(key, trigger, task, 'Organisation', orgId, 'Org research', notes);
  if (decisionId) {
    if (sheet && org) appendNoteFlag(sheet, org.row, COLS.ORGS.NOTES, '[review-routed] Org review decision queued');
    scheduleOrgReviewById(orgId, { stampLastChecked: true });
  }
  return decisionId;
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
  var existing = findOrgByNameExact(orgName);
  var declinedSimilar = null;
  if (!existing) {
    var similar = findOrgByNameFuzzy(orgName, 0.85);
    if (similar && (opts.confirmFuzzy === false || confirmFuzzyOrgMatch(orgName, similar))) {
      existing = similar;
    } else if (similar) {
      declinedSimilar = similar;
    }
  }
  if (existing) {
    var canonicalName = existing.data[COLS.ORGS.NAME - 1];
    // Non-exact fuzzy matches are confirmed before linking; keep an audit
    // note when the typed text differs from the canonical stored name.
    if (String(orgName).trim() !== String(canonicalName).trim()) {
      var orgSheetForTrace = getSheet('Organisations');
      if (orgSheetForTrace) {
        appendNoteFlag(orgSheetForTrace, existing.row, COLS.ORGS.NOTES, '[matched-typed-as] "' + orgName + '"');
        appendNoteFlag(orgSheetForTrace, existing.row, COLS.ORGS.NOTES, '[review-name] Possible canonical-name typo');
      }
    }
    if (!opts.deferClassification) ensureOrgClassificationState(existing.row);
    return { id: ensureOrgIdForMatchedRow(existing), row: existing.row, name: canonicalName, existing: true };
  }
  var sheet = getSheet('Organisations');
  if (!sheet) return null;
  var id = nextId(sheet, COLS.ORGS.ID, 'ORG');
  var status = normalizeOrgStatus(opts.status);
  var row = new Array(HEADERS.Organisations.length).fill('');
  row[COLS.ORGS.ID - 1] = id;
  row[COLS.ORGS.NAME - 1] = orgName;
  row[COLS.ORGS.TIER - 1] = normalizeTier(opts.tier || 'B');
  row[COLS.ORGS.STATUS - 1] = status;
  row[COLS.ORGS.LAST_CHECKED - 1] = today();
  row[COLS.ORGS.NEXT_CHECK - 1] = nextOrgReviewDate(status);
  row[COLS.ORGS.NOTES - 1] = opts.stub ? '[stub] name-only org created from a linked Job/Person' : '';
  sheet.appendRow(row);
  var newRow = sheet.getLastRow();
  applyOrgRowFormulas(sheet, newRow);
  if (declinedSimilar) {
    appendNoteFlag(sheet, newRow, COLS.ORGS.NOTES, '[similar-org-declined: ' + declinedSimilar.data[COLS.ORGS.ID - 1] + ']');
  }
  if (!opts.deferClassification) markOrgNeedsClassification(newRow, id, orgName);
  if (status === 'Active') fireOrgActiveCascade(id, orgName);
  return { id: id, row: newRow, name: orgName, existing: false };
}

function isNeedsClassificationLabel(value) {
  return normalizeKeyPart(value) === normalizeKeyPart(ORG_NEEDS_CLASSIFICATION_LABEL);
}

function ensureOrgClassificationTask(orgId, orgName, orgRow) {
  if (!orgId || !orgName) return '';
  var orgSheet = getSheet('Organisations');
  if (orgSheet && orgRow) {
    var status = String(orgSheet.getRange(orgRow, COLS.ORGS.STATUS).getValue() || '');
    if (status === 'Dormant' || status === 'Archived') return '';
  }
  return appendTodoOnceForWorkflow(
    'Classify organisation: ' + orgName,
    'Organisation',
    orgId,
    orgName,
    ORG_CLASSIFICATION_WORKFLOW,
    'Not started',
    '',
    '15 min',
    'Choose a real Sector/Sub-sector on the Organisations row.',
    'Auto-triggered'
  );
}

function markOrgNeedsClassification(orgRow, orgId, orgName, detail) {
  var sheet = getSheet('Organisations');
  if (!sheet || !orgRow) return;
  orgId = orgId || sheet.getRange(orgRow, COLS.ORGS.ID).getValue();
  orgName = orgName || sheet.getRange(orgRow, COLS.ORGS.NAME).getValue();
  sheet.getRange(orgRow, COLS.ORGS.SECTOR_ID).setValue('');
  sheet.getRange(orgRow, COLS.ORGS.SECTOR).setValue(ORG_NEEDS_CLASSIFICATION_LABEL);
  sheet.getRange(orgRow, COLS.ORGS.SUBSECTOR_ID).setValue('');
  sheet.getRange(orgRow, COLS.ORGS.SUBSECTOR).setValue('');
  appendNoteFlag(sheet, orgRow, COLS.ORGS.NOTES, ORG_NEEDS_CLASSIFICATION_FLAG + ' Choose a real Sector/Sub-sector');
  if (detail) appendNoteFlag(sheet, orgRow, COLS.ORGS.NOTES, '[taxonomy] ' + detail);
  ensureOrgClassificationTask(orgId, orgName, orgRow);
}

function clearOrgNeedsClassification(orgRow, orgId) {
  var sheet = getSheet('Organisations');
  if (!sheet || !orgRow) return;
  orgId = orgId || sheet.getRange(orgRow, COLS.ORGS.ID).getValue();
  clearNoteFlag(sheet, orgRow, COLS.ORGS.NOTES, ORG_NEEDS_CLASSIFICATION_FLAG);
  clearNoteFlag(sheet, orgRow, COLS.ORGS.NOTES, '[taxonomy]');
  if (orgId) setOpenTodosForTarget('Organisation', orgId, 'Done', 'Organisation classified', [ORG_CLASSIFICATION_WORKFLOW]);
}

function ensureOrgClassificationState(orgRow) {
  var sheet = getSheet('Organisations');
  if (!sheet || !orgRow) return;
  var orgId = sheet.getRange(orgRow, COLS.ORGS.ID).getValue();
  var orgName = sheet.getRange(orgRow, COLS.ORGS.NAME).getValue();
  if (!orgId || !orgName) return;
  var sectorId = String(sheet.getRange(orgRow, COLS.ORGS.SECTOR_ID).getValue() || '');
  var sector = String(sheet.getRange(orgRow, COLS.ORGS.SECTOR).getValue() || '');
  if (!sectorId || isNeedsClassificationLabel(sector)) markOrgNeedsClassification(orgRow, orgId, orgName);
}

function applyOrganisationStatusFromCapture(org, status, tier) {
  if (!org || !org.row) return false;
  var sheet = getSheet('Organisations');
  if (!sheet) return false;
  var normalized = normalizeOrgStatus(status);
  var previousStatus = normalizeOrgStatus(sheet.getRange(org.row, COLS.ORGS.STATUS).getValue());
  if (tier) sheet.getRange(org.row, COLS.ORGS.TIER).setValue(normalizeTier(tier));
  sheet.getRange(org.row, COLS.ORGS.STATUS).setValue(normalized);
  clearNoteFlag(sheet, org.row, COLS.ORGS.NOTES, '[review-routed]');
  if (normalized !== 'Dormant') clearNoteFlag(sheet, org.row, COLS.ORGS.NOTES, '[dormant-live]');
  if (normalized !== 'Active') clearNoteFlag(sheet, org.row, COLS.ORGS.NOTES, '[active-empty]');
  if (normalized === 'Archived') clearOrgRoutingFlags(sheet, org.row);
  scheduleOrgReviewForRow(sheet, org.row, normalized, { stampLastChecked: true });
  if (normalized === 'Active' && previousStatus !== 'Active') {
    fireOrgActiveCascade(org.id, org.name);
    return true;
  } else if (normalized === 'Dormant') {
    autoDismissPendingForTarget('Organisation', org.id, 'Organisation marked Dormant');
    setOpenTodosForTarget('Organisation', org.id, 'Skipped', 'Organisation parked/dormant');
  } else if (normalized === 'Archived') {
    autoDismissPendingForTarget('Organisation', org.id, 'Organisation archived');
    setOpenTodosForTarget('Organisation', org.id, 'Cancelled', 'Organisation archived');
  }
  return false;
}

// Auto-promotion is deliberately narrower than a manual Active edit: it
// keeps Org priority honest when live linked work appears, without creating
// the two broad "find people / scan jobs" Active decisions.
function promoteMappedOrgToActive(orgId, reason) {
  var org = getOrgById(orgId);
  if (!org || String(org.status) !== 'Mapped') return false;
  var sheet = getSheet('Organisations');
  if (!sheet) return false;
  sheet.getRange(org.row, COLS.ORGS.STATUS).setValue('Active');
  clearOrgRoutingFlags(sheet, org.row);
  scheduleOrgReviewForRow(sheet, org.row, 'Active', { stampLastChecked: true });
  appendNoteFlag(sheet, org.row, COLS.ORGS.NOTES, '[auto-active] ' + (reason || 'Live linked work exists'));
  return true;
}

function queueDormantOrgReactivationDecision(org, reason) {
  if (!org || String(org.status) !== 'Dormant') return false;
  appendPendingDecision(
    'ORG_DORMANT_LIVE:' + org.id,
    'Live evidence found for Dormant organisation: ' + org.name,
    'Review dormant org: ' + org.name,
    'Organisation',
    org.id,
    'Org research',
    'New live work exists: ' + (reason || 'linked job/person activity') + '. Decide whether to reactivate, keep dormant, or archive.'
  );
  var sheet = getSheet('Organisations');
  if (sheet) appendNoteFlag(sheet, org.row, COLS.ORGS.NOTES, '[dormant-live] Live linked work exists; reactivation decision queued');
  return true;
}

function routeOrgLiveEvidence(orgId, reason) {
  var org = getOrgById(orgId);
  if (!org) return false;
  if (String(org.status) === 'Mapped') return promoteMappedOrgToActive(orgId, reason);
  if (String(org.status) === 'Dormant') return queueDormantOrgReactivationDecision(org, reason);
  return false;
}

function promoteOrgForLiveJob(orgId, status) {
  if (['Not started', 'In progress', 'Submitted'].indexOf(normalizeJobStatus(status)) === -1) return false;
  return routeOrgLiveEvidence(orgId, 'Live job/application evidence');
}

function promoteOrgForLivePerson(orgId, stage) {
  var normalized = normalizePersonStage(stage);
  if (['To outreach', 'Outreach drafted', 'Outreach sent', 'Replied', 'Conversation scheduled', 'Conversation completed', 'Keep warm'].indexOf(normalized) === -1) return false;
  return routeOrgLiveEvidence(orgId, 'Live relationship evidence');
}

function inheritOrgFields(sheet, editedRow, nameCol, orgIdCol) {
  var orgName = sheet.getRange(editedRow, nameCol).getValue();
  if (!orgName) return;
  var org = createNameOnlyOrg(String(orgName).trim(), { status: 'Mapped', stub: true });
  if (!org) return;
  sheet.getRange(editedRow, nameCol).setValue(org.name);
  sheet.getRange(editedRow, orgIdCol).setValue(org.id);
}

function restoreOrClearEditedCell(sheet, row, col, e) {
  if (e && Object.prototype.hasOwnProperty.call(e, 'oldValue')) sheet.getRange(row, col).setValue(e.oldValue);
  else sheet.getRange(row, col).clearContent();
}

function jobRowHasStateBeyondOpportunity(sheet, row) {
  var values = sheet.getRange(row, 1, 1, HEADERS.Jobs.length).getValues()[0];
  var cols = [
    COLS.JOBS.ID, COLS.JOBS.ORG, COLS.JOBS.ORG_ID, COLS.JOBS.STATUS, COLS.JOBS.DEADLINE,
    COLS.JOBS.APPLIED_DATE, COLS.JOBS.CONTACTS_IDS, COLS.JOBS.CONTACTS_DISPLAY,
    COLS.JOBS.REVIEW_DATE, COLS.JOBS.RESPONSE, COLS.JOBS.OUTCOME, COLS.JOBS.NOTES
  ];
  for (var i = 0; i < cols.length; i++) {
    if (String(values[cols[i] - 1] || '').trim()) return true;
  }
  return false;
}

function guardManualJobSystemIdEdit(sheet, row, col, e) {
  var messages = {};
  messages[COLS.JOBS.ID] = 'Job ID is system-generated. Type the Opportunity first.';
  messages[COLS.JOBS.ORG_ID] = 'Org ID is filled from Organisation. Type Organisation instead.';
  messages[COLS.JOBS.CONTACTS_IDS] = 'Linked contact IDs are filled by application/referral actions.';
  messages[COLS.JOBS.CONTACTS_DISPLAY] = 'People for this application is filled by application/referral actions.';
  if (!messages[col]) return false;
  restoreOrClearEditedCell(sheet, row, col, e);
  if (col === COLS.JOBS.CONTACTS_DISPLAY) refreshLinkedContactsDisplay();
  var msg = messages[col];
  SpreadsheetApp.getActiveSpreadsheet().toast(msg, 'The Planner', 5);
  return true;
}

function guardManualPeopleSystemIdEdit(sheet, row, col, e) {
  var messages = {};
  messages[COLS.PEOPLE.ID] = 'Person ID is system-generated. Type the Name first.';
  messages[COLS.PEOPLE.ORG_ID] = 'Org ID is filled from Organisation. Type Organisation instead.';
  messages[COLS.PEOPLE.FOLLOW_UPS_SENT_COUNT] = 'Follow-ups sent count is maintained by the planner.';
  messages[COLS.PEOPLE.LAST_INTERACTION] = 'Last interaction is maintained from Conversations.';
  messages[COLS.PEOPLE.NEXT_ACTION] = 'Next action is maintained from open Tasks.';
  messages[COLS.PEOPLE.LINKED_JOBS] = 'Linked jobs is maintained from Jobs.';
  if (!messages[col]) return false;
  restoreOrClearEditedCell(sheet, row, col, e);
  var msg = messages[col];
  SpreadsheetApp.getActiveSpreadsheet().toast(msg, 'The Planner', 5);
  return true;
}

function personRowHasStateBeyondName(sheet, row) {
  var values = sheet.getRange(row, 1, 1, HEADERS.People.length).getValues()[0];
  var cols = [
    COLS.PEOPLE.ID, COLS.PEOPLE.ORG, COLS.PEOPLE.ORG_ID, COLS.PEOPLE.ROLE,
    COLS.PEOPLE.REL_TYPE, COLS.PEOPLE.STAGE, COLS.PEOPLE.FOLLOW_UP_DATE,
    COLS.PEOPLE.REPLY_RECEIVED, COLS.PEOPLE.FOLLOW_UP_SENT, COLS.PEOPLE.OUTREACH_DATE,
    COLS.PEOPLE.CONVERSATION_DATE, COLS.PEOPLE.NOTES, COLS.PEOPLE.FOLLOW_UPS_SENT_COUNT
  ];
  for (var i = 0; i < cols.length; i++) {
    if (String(values[cols[i] - 1] || '').trim()) return true;
  }
  return false;
}

function guardBlankPersonName(sheet, row, col, newVal, e) {
  if (col !== COLS.PEOPLE.NAME || String(newVal || '').trim()) return false;
  if (!personRowHasStateBeyondName(sheet, row)) return false;
  restoreOrClearEditedCell(sheet, row, col, e);
  appendNoteFlag(sheet, row, COLS.PEOPLE.NOTES, '[name-required] Name identifies this person; close the person instead of blanking it.');
  SpreadsheetApp.getActiveSpreadsheet().toast('Name is required for an existing Person row.', 'The Planner', 5);
  return true;
}

function guardPersonNameBeforeOtherFields(sheet, row, col, newVal, e) {
  if (col === COLS.PEOPLE.ID || col === COLS.PEOPLE.NAME) return false;
  if (!String(newVal || '').trim()) return false;
  if (String(sheet.getRange(row, COLS.PEOPLE.NAME).getValue() || '').trim()) return false;
  restoreOrClearEditedCell(sheet, row, col, e);
  appendNoteFlag(sheet, row, COLS.PEOPLE.NOTES, '[missing-name] Add Name before filling the rest of this Person row.');
  SpreadsheetApp.getActiveSpreadsheet().toast('Add Name before filling other Person fields.', 'The Planner', 5);
  return true;
}

function guardBlankJobOpportunity(sheet, row, col, newVal, e) {
  if (col !== COLS.JOBS.OPPORTUNITY || String(newVal || '').trim()) return false;
  if (!jobRowHasStateBeyondOpportunity(sheet, row)) return false;
  restoreOrClearEditedCell(sheet, row, col, e);
  appendNoteFlag(sheet, row, COLS.JOBS.NOTES, '[opportunity-required] Opportunity names the Job ID; close/park the job instead of blanking it.');
  SpreadsheetApp.getActiveSpreadsheet().toast('Opportunity is required for an existing Job row.', 'The Planner', 5);
  return true;
}

function guardJobOpportunityBeforeOtherFields(sheet, row, col, newVal, e) {
  if (col === COLS.JOBS.ID || col === COLS.JOBS.OPPORTUNITY) return false;
  if (!String(newVal || '').trim()) return false;
  if (String(sheet.getRange(row, COLS.JOBS.OPPORTUNITY).getValue() || '').trim()) return false;
  restoreOrClearEditedCell(sheet, row, col, e);
  appendNoteFlag(sheet, row, COLS.JOBS.NOTES, '[missing-opportunity] Add Opportunity before filling the rest of this Job row.');
  SpreadsheetApp.getActiveSpreadsheet().toast('Add Opportunity before filling other Job fields.', 'The Planner', 5);
  return true;
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

function replaceDisplayText(value, oldText, newText) {
  if (!oldText || !newText || String(oldText) === String(newText)) return value;
  var escaped = String(oldText).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return String(value || '').replace(new RegExp('(^|[^A-Za-z0-9])' + escaped + '(?=$|[^A-Za-z0-9])', 'g'), function (match, prefix) {
    return prefix + newText;
  });
}

function replaceOrgDisplayText(value, oldName, newName) {
  return replaceDisplayText(value, oldName, newName);
}

function collectRoundIdsForJob(jobId) {
  var out = {};
  var sheet = getSheet('Interviews');
  if (!sheet || sheet.getLastRow() < 2 || !jobId) return out;
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, COLS.ROUNDS.JOB_ID).getValues();
  data.forEach(function (row) {
    if (String(row[COLS.ROUNDS.JOB_ID - 1]) === String(jobId) && row[COLS.ROUNDS.ID - 1]) out[String(row[COLS.ROUNDS.ID - 1])] = true;
  });
  return out;
}

function propagateJobTitleRename(jobId, newTitle, oldTitle) {
  if (!jobId || !newTitle || !oldTitle || String(newTitle) === String(oldTitle)) return;
  var roundsSheet = getSheet('Interviews');
  var tasksSheet = getSheet('Tasks');
  var decisionsSheet = getSheet('Decisions');
  var roundIds = collectRoundIdsForJob(jobId);

  if (roundsSheet && roundsSheet.getLastRow() > 1) {
    var roundData = roundsSheet.getRange(2, 1, roundsSheet.getLastRow() - 1, COLS.ROUNDS.JOB_ID).getValues();
    roundData.forEach(function (row, i) {
      if (String(row[COLS.ROUNDS.JOB_ID - 1]) === String(jobId)) roundsSheet.getRange(i + 2, COLS.ROUNDS.JOB_DISPLAY).setValue(newTitle);
    });
  }

  if (tasksSheet && tasksSheet.getLastRow() > 1) {
    var taskData = tasksSheet.getRange(2, 1, tasksSheet.getLastRow() - 1, HEADERS['To-do'].length).getValues();
    taskData.forEach(function (row, i) {
      var objType = String(row[COLS.TODO.OBJ_TYPE - 1] || '');
      var objId = String(row[COLS.TODO.OBJ_ID - 1] || '');
      var linkedJob = objType === 'Job' && objId === String(jobId);
      var linkedRound = objType === 'Interview round' && roundIds[objId];
      if (!(linkedJob || linkedRound)) return;
      var r = i + 2;
      if (!isTerminalTodoStatus(row[COLS.TODO.STATUS - 1])) {
        var updatedTask = replaceDisplayText(row[COLS.TODO.TASK - 1], oldTitle, newTitle);
        if (updatedTask !== row[COLS.TODO.TASK - 1]) tasksSheet.getRange(r, COLS.TODO.TASK).setValue(updatedTask);
      }
      writeLinkedTo(tasksSheet, r, objType, objId);
    });
  }

  if (decisionsSheet && decisionsSheet.getLastRow() > 1) {
    var decisionData = decisionsSheet.getRange(2, 1, decisionsSheet.getLastRow() - 1, COLS.DECISIONS.DECISION).getValues();
    decisionData.forEach(function (row, i) {
      var targetType = String(row[COLS.DECISIONS.TARGET_TYPE - 1] || '');
      var targetId = String(row[COLS.DECISIONS.TARGET_ID - 1] || '');
      var linkedJob = targetType === 'Job' && targetId === String(jobId);
      var linkedRound = targetType === 'Interview round' && roundIds[targetId];
      if (!(linkedJob || linkedRound)) return;
      if (String(row[COLS.DECISIONS.DECISION - 1]) !== 'Pending') return;
      var r = i + 2;
      var trigger = replaceDisplayText(row[COLS.DECISIONS.TRIGGER - 1], oldTitle, newTitle);
      var task = replaceDisplayText(row[COLS.DECISIONS.TASK - 1], oldTitle, newTitle);
      if (trigger !== row[COLS.DECISIONS.TRIGGER - 1]) decisionsSheet.getRange(r, COLS.DECISIONS.TRIGGER).setValue(trigger);
      if (task !== row[COLS.DECISIONS.TASK - 1]) decisionsSheet.getRange(r, COLS.DECISIONS.TASK).setValue(task);
    });
  }
}

function propagateJobOrganisationChange(jobId, newOrgName, newOrgId, oldOrgName, oldOrgId) {
  if (!jobId || !newOrgName) return;
  var roundsSheet = getSheet('Interviews');
  var tasksSheet = getSheet('Tasks');
  var decisionsSheet = getSheet('Decisions');
  var roundIds = collectRoundIdsForJob(jobId);

  if (roundsSheet && roundsSheet.getLastRow() > 1) {
    var roundData = roundsSheet.getRange(2, 1, roundsSheet.getLastRow() - 1, COLS.ROUNDS.JOB_ID).getValues();
    roundData.forEach(function (row, i) {
      if (String(row[COLS.ROUNDS.JOB_ID - 1]) === String(jobId)) roundsSheet.getRange(i + 2, COLS.ROUNDS.ORG_DISPLAY).setValue(newOrgName);
    });
  }

  if (tasksSheet && tasksSheet.getLastRow() > 1) {
    var taskData = tasksSheet.getRange(2, 1, tasksSheet.getLastRow() - 1, HEADERS['To-do'].length).getValues();
    taskData.forEach(function (row, i) {
      var objType = String(row[COLS.TODO.OBJ_TYPE - 1] || '');
      var objId = String(row[COLS.TODO.OBJ_ID - 1] || '');
      var linkedJob = objType === 'Job' && objId === String(jobId);
      var linkedRound = objType === 'Interview round' && roundIds[objId];
      if (!(linkedJob || linkedRound)) return;
      var r = i + 2;
      if (!isTerminalTodoStatus(row[COLS.TODO.STATUS - 1])) {
        tasksSheet.getRange(r, COLS.TODO.ORG).setValue(newOrgName);
        var updatedTask = replaceDisplayText(row[COLS.TODO.TASK - 1], oldOrgName, newOrgName);
        if (updatedTask !== row[COLS.TODO.TASK - 1]) tasksSheet.getRange(r, COLS.TODO.TASK).setValue(updatedTask);
      }
      writeLinkedTo(tasksSheet, r, objType, objId);
    });
  }

  if (decisionsSheet && decisionsSheet.getLastRow() > 1) {
    var decisionData = decisionsSheet.getRange(2, 1, decisionsSheet.getLastRow() - 1, COLS.DECISIONS.DECISION).getValues();
    decisionData.forEach(function (row, i) {
      var targetType = String(row[COLS.DECISIONS.TARGET_TYPE - 1] || '');
      var targetId = String(row[COLS.DECISIONS.TARGET_ID - 1] || '');
      var decisionKey = String(row[COLS.DECISIONS.KEY - 1] || '');
      var linkedJob = targetType === 'Job' && targetId === String(jobId);
      var linkedRound = targetType === 'Interview round' && roundIds[targetId];
      var linkedJobReferralDecision = decisionKey === 'JOB_WANT:' + jobId + ':Referral search';
      if (!(linkedJob || linkedRound || linkedJobReferralDecision)) return;
      if (String(row[COLS.DECISIONS.DECISION - 1]) !== 'Pending') return;
      var r = i + 2;
      var trigger = replaceDisplayText(row[COLS.DECISIONS.TRIGGER - 1], oldOrgName, newOrgName);
      var task = replaceDisplayText(row[COLS.DECISIONS.TASK - 1], oldOrgName, newOrgName);
      if (trigger !== row[COLS.DECISIONS.TRIGGER - 1]) decisionsSheet.getRange(r, COLS.DECISIONS.TRIGGER).setValue(trigger);
      if (task !== row[COLS.DECISIONS.TASK - 1]) decisionsSheet.getRange(r, COLS.DECISIONS.TASK).setValue(task);
      if (linkedJobReferralDecision && newOrgId) {
        decisionsSheet.getRange(r, COLS.DECISIONS.TARGET_ID).setValue(newOrgId);
        if (targetType !== 'Organisation') decisionsSheet.getRange(r, COLS.DECISIONS.TARGET_TYPE).setValue('Organisation');
      }
    });
  }
}

function propagatePersonNameChange(personId, newName, oldName) {
  if (!personId || !newName || !oldName || String(newName) === String(oldName)) return;
  var conversationsSheet = getSheet('Conversations');
  var tasksSheet = getSheet('Tasks');
  var decisionsSheet = getSheet('Decisions');

  if (conversationsSheet && conversationsSheet.getLastRow() > 1) {
    var convData = conversationsSheet.getRange(2, 1, conversationsSheet.getLastRow() - 1, COLS.INTERACTIONS.PERSON_ID).getValues();
    convData.forEach(function (row, i) {
      if (String(row[COLS.INTERACTIONS.PERSON_ID - 1]) === String(personId)) linkInteractionPersonCell(i + 2);
    });
  }

  if (tasksSheet && tasksSheet.getLastRow() > 1) {
    var taskData = tasksSheet.getRange(2, 1, tasksSheet.getLastRow() - 1, HEADERS['To-do'].length).getValues();
    taskData.forEach(function (row, i) {
      var objType = String(row[COLS.TODO.OBJ_TYPE - 1] || '');
      var objId = String(row[COLS.TODO.OBJ_ID - 1] || '');
      if (!(objType === 'Person' && objId === String(personId))) return;
      var r = i + 2;
      if (!isTerminalTodoStatus(row[COLS.TODO.STATUS - 1])) {
        var updatedTask = replaceDisplayText(row[COLS.TODO.TASK - 1], oldName, newName);
        if (updatedTask !== row[COLS.TODO.TASK - 1]) tasksSheet.getRange(r, COLS.TODO.TASK).setValue(updatedTask);
      }
      writeLinkedTo(tasksSheet, r, objType, objId);
    });
  }

  if (decisionsSheet && decisionsSheet.getLastRow() > 1) {
    var decisionData = decisionsSheet.getRange(2, 1, decisionsSheet.getLastRow() - 1, COLS.DECISIONS.DECISION).getValues();
    decisionData.forEach(function (row, i) {
      var targetType = String(row[COLS.DECISIONS.TARGET_TYPE - 1] || '');
      var targetId = String(row[COLS.DECISIONS.TARGET_ID - 1] || '');
      if (!(targetType === 'Person' && targetId === String(personId))) return;
      if (String(row[COLS.DECISIONS.DECISION - 1]) !== 'Pending') return;
      var r = i + 2;
      var trigger = replaceDisplayText(row[COLS.DECISIONS.TRIGGER - 1], oldName, newName);
      var task = replaceDisplayText(row[COLS.DECISIONS.TASK - 1], oldName, newName);
      if (trigger !== row[COLS.DECISIONS.TRIGGER - 1]) decisionsSheet.getRange(r, COLS.DECISIONS.TRIGGER).setValue(trigger);
      if (task !== row[COLS.DECISIONS.TASK - 1]) decisionsSheet.getRange(r, COLS.DECISIONS.TASK).setValue(task);
    });
  }
  refreshLinkedContactsDisplay();
}

function propagatePersonOrganisationChange(personId, newOrgName, newOrgId, oldOrgName, oldOrgId) {
  if (!personId) return;
  var conversationsSheet = getSheet('Conversations');
  var tasksSheet = getSheet('Tasks');
  var decisionsSheet = getSheet('Decisions');

  if (conversationsSheet && conversationsSheet.getLastRow() > 1) {
    var convData = conversationsSheet.getRange(2, 1, conversationsSheet.getLastRow() - 1, COLS.INTERACTIONS.PERSON_ID).getValues();
    convData.forEach(function (row, i) {
      if (String(row[COLS.INTERACTIONS.PERSON_ID - 1]) === String(personId)) linkInteractionPersonCell(i + 2);
    });
  }

  if (tasksSheet && tasksSheet.getLastRow() > 1) {
    var taskData = tasksSheet.getRange(2, 1, tasksSheet.getLastRow() - 1, HEADERS['To-do'].length).getValues();
    taskData.forEach(function (row, i) {
      var objType = String(row[COLS.TODO.OBJ_TYPE - 1] || '');
      var objId = String(row[COLS.TODO.OBJ_ID - 1] || '');
      if (!(objType === 'Person' && objId === String(personId))) return;
      var r = i + 2;
      if (!isTerminalTodoStatus(row[COLS.TODO.STATUS - 1])) {
        tasksSheet.getRange(r, COLS.TODO.ORG).setValue(newOrgName || '');
        var updatedTask = replaceDisplayText(row[COLS.TODO.TASK - 1], oldOrgName, newOrgName);
        if (updatedTask !== row[COLS.TODO.TASK - 1]) tasksSheet.getRange(r, COLS.TODO.TASK).setValue(updatedTask);
      }
      writeLinkedTo(tasksSheet, r, objType, objId);
    });
  }

  if (decisionsSheet && decisionsSheet.getLastRow() > 1) {
    var decisionData = decisionsSheet.getRange(2, 1, decisionsSheet.getLastRow() - 1, COLS.DECISIONS.DECISION).getValues();
    decisionData.forEach(function (row, i) {
      var targetType = String(row[COLS.DECISIONS.TARGET_TYPE - 1] || '');
      var targetId = String(row[COLS.DECISIONS.TARGET_ID - 1] || '');
      if (!(targetType === 'Person' && targetId === String(personId))) return;
      if (String(row[COLS.DECISIONS.DECISION - 1]) !== 'Pending') return;
      var r = i + 2;
      var trigger = replaceDisplayText(row[COLS.DECISIONS.TRIGGER - 1], oldOrgName, newOrgName);
      var task = replaceDisplayText(row[COLS.DECISIONS.TASK - 1], oldOrgName, newOrgName);
      if (trigger !== row[COLS.DECISIONS.TRIGGER - 1]) decisionsSheet.getRange(r, COLS.DECISIONS.TRIGGER).setValue(trigger);
      if (task !== row[COLS.DECISIONS.TASK - 1]) decisionsSheet.getRange(r, COLS.DECISIONS.TASK).setValue(task);
    });
  }
  refreshLinkedContactsDisplay();
}

function collectIdsForOrg(sheet, idCol, orgIdCol, orgId) {
  var out = {};
  if (!sheet || sheet.getLastRow() < 2 || !orgId) return out;
  var width = Math.max(idCol, orgIdCol);
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, width).getValues();
  data.forEach(function (row) {
    if (String(row[orgIdCol - 1]) === String(orgId) && row[idCol - 1]) out[String(row[idCol - 1])] = true;
  });
  return out;
}

function propagateOrganisationRename(orgId, newName, oldName) {
  if (!orgId || !newName) return;
  var jobsSheet = getSheet('Jobs');
  var peopleSheet = getSheet('People');
  var roundsSheet = getSheet('Interviews');
  var tasksSheet = getSheet('Tasks');
  var decisionsSheet = getSheet('Decisions');
  var jobIds = collectIdsForOrg(jobsSheet, COLS.JOBS.ID, COLS.JOBS.ORG_ID, orgId);
  var personIds = collectIdsForOrg(peopleSheet, COLS.PEOPLE.ID, COLS.PEOPLE.ORG_ID, orgId);

  if (jobsSheet && jobsSheet.getLastRow() > 1) {
    var jobData = jobsSheet.getRange(2, 1, jobsSheet.getLastRow() - 1, COLS.JOBS.ORG_ID).getValues();
    jobData.forEach(function (row, i) {
      if (String(row[COLS.JOBS.ORG_ID - 1]) === String(orgId)) jobsSheet.getRange(i + 2, COLS.JOBS.ORG).setValue(newName);
    });
  }

  if (peopleSheet && peopleSheet.getLastRow() > 1) {
    var peopleData = peopleSheet.getRange(2, 1, peopleSheet.getLastRow() - 1, COLS.PEOPLE.ORG_ID).getValues();
    peopleData.forEach(function (row, i) {
      if (String(row[COLS.PEOPLE.ORG_ID - 1]) === String(orgId)) peopleSheet.getRange(i + 2, COLS.PEOPLE.ORG).setValue(newName);
    });
  }

  if (roundsSheet && roundsSheet.getLastRow() > 1) {
    var roundsData = roundsSheet.getRange(2, 1, roundsSheet.getLastRow() - 1, COLS.ROUNDS.JOB_ID).getValues();
    roundsData.forEach(function (row, i) {
      if (jobIds[String(row[COLS.ROUNDS.JOB_ID - 1])]) roundsSheet.getRange(i + 2, COLS.ROUNDS.ORG_DISPLAY).setValue(newName);
    });
  }

  if (tasksSheet && tasksSheet.getLastRow() > 1) {
    var taskData = tasksSheet.getRange(2, 1, tasksSheet.getLastRow() - 1, HEADERS['To-do'].length).getValues();
    taskData.forEach(function (row, i) {
      var objType = String(row[COLS.TODO.OBJ_TYPE - 1] || '');
      var objId = String(row[COLS.TODO.OBJ_ID - 1] || '');
      var linkedToOrg = objType === 'Organisation' && objId === String(orgId);
      var linkedJob = objType === 'Job' && jobIds[objId];
      var linkedPerson = objType === 'Person' && personIds[objId];
      if (!(linkedToOrg || linkedJob || linkedPerson)) return;
      var r = i + 2;
      if (!isTerminalTodoStatus(row[COLS.TODO.STATUS - 1])) {
        tasksSheet.getRange(r, COLS.TODO.ORG).setValue(newName);
        var updatedTask = replaceOrgDisplayText(row[COLS.TODO.TASK - 1], oldName, newName);
        if (updatedTask !== row[COLS.TODO.TASK - 1]) tasksSheet.getRange(r, COLS.TODO.TASK).setValue(updatedTask);
      }
      writeLinkedTo(tasksSheet, r, objType, objId);
    });
  }

  if (decisionsSheet && decisionsSheet.getLastRow() > 1) {
    var decisionData = decisionsSheet.getRange(2, 1, decisionsSheet.getLastRow() - 1, COLS.DECISIONS.DECISION).getValues();
    decisionData.forEach(function (row, i) {
      if (String(row[COLS.DECISIONS.TARGET_TYPE - 1]) !== 'Organisation') return;
      if (String(row[COLS.DECISIONS.TARGET_ID - 1]) !== String(orgId)) return;
      if (String(row[COLS.DECISIONS.DECISION - 1]) !== 'Pending') return;
      var r = i + 2;
      var trigger = replaceOrgDisplayText(row[COLS.DECISIONS.TRIGGER - 1], oldName, newName);
      var task = replaceOrgDisplayText(row[COLS.DECISIONS.TASK - 1], oldName, newName);
      if (trigger !== row[COLS.DECISIONS.TRIGGER - 1]) decisionsSheet.getRange(r, COLS.DECISIONS.TRIGGER).setValue(trigger);
      if (task !== row[COLS.DECISIONS.TASK - 1]) decisionsSheet.getRange(r, COLS.DECISIONS.TASK).setValue(task);
    });
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
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, COLS.PEOPLE.NOTES).getValues();
  var target = String(personId);
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][COLS.PEOPLE.ID - 1]) === target) {
      var row = data[i];
      return {
        row: i + 2, id: personId,
        name: row[COLS.PEOPLE.NAME - 1],
        org: row[COLS.PEOPLE.ORG - 1],
        orgId: row[COLS.PEOPLE.ORG_ID - 1],
        stage: row[COLS.PEOPLE.STAGE - 1],
        notes: row[COLS.PEOPLE.NOTES - 1]
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

function isExactJobTitleOrgMatch(match, title, org) {
  if (!match) return false;
  var titleKey = normalizeKeyPart(title);
  var orgKey = normalizeKeyPart(org);
  var existingTitleKey = normalizeKeyPart(match.data[COLS.JOBS.OPPORTUNITY - 1]);
  var existingOrgKey = normalizeKeyPart(match.data[COLS.JOBS.ORG - 1]);
  return !!titleKey && titleKey === existingTitleKey && (!orgKey || orgKey === existingOrgKey);
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
  setDropdown(sheet.getRange(2, COLS.DECISIONS.DECISION, Math.max(1, sheet.getMaxRows() - 1), 1), DROPDOWNS.DECISION, { allowInvalid: false });
  return sheet;
}

function getDecisionsSheet() {
  return getSheet('Decisions');
}

function findDecisionByKey(key) {
  var sheet = getDecisionsSheet();
  if (!sheet || sheet.getLastRow() < 2 || !key) return null;
  var keys = sheet.getRange(2, COLS.DECISIONS.KEY, sheet.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < keys.length; i++) {
    if (String(keys[i][0]) === String(key)) return { row: i + 2 };
  }
  return null;
}

function findPendingDecisionByKey(key) {
  var sheet = getDecisionsSheet();
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

function pendingDecisionExistsForTargetWorkflow(targetType, targetId, workflow) {
  var sheet = getDecisionsSheet();
  if (!sheet || sheet.getLastRow() < 2 || !targetId) return false;
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS['Pending decisions'].length).getValues();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][COLS.DECISIONS.DECISION - 1]) !== 'Pending') continue;
    if (String(data[i][COLS.DECISIONS.TARGET_TYPE - 1]) !== String(targetType)) continue;
    if (String(data[i][COLS.DECISIONS.TARGET_ID - 1]) !== String(targetId)) continue;
    if (String(data[i][COLS.DECISIONS.WORKFLOW - 1]) === String(workflow)) return true;
  }
  return false;
}

function getDecisionRowById(decisionId) {
  var sheet = getDecisionsSheet();
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
function appendPendingDecision(key, trigger, task, targetType, targetId, workflow, notes, opts) {
  opts = opts || {};
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
    sheet.getRange(existing.row, COLS.DECISIONS.ACTION_TYPE).setValue(opts.actionType || inferDecisionActionType(key, targetType, workflow, task));
    sheet.getRange(existing.row, COLS.DECISIONS.DUE_DATE).setValue(opts.dueDate || decisionDueDateFor(key, targetType, targetId, workflow) || '');
    applyDecisionHelperColumns(sheet, existing.row);
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
  row[COLS.DECISIONS.ACTION_TYPE - 1] = opts.actionType || inferDecisionActionType(key, targetType, workflow, task);
  row[COLS.DECISIONS.DUE_DATE - 1] = opts.dueDate || decisionDueDateFor(key, targetType, targetId, workflow) || '';
  sheet.appendRow(row);
  applyDecisionHelperColumns(sheet, sheet.getLastRow());
  return id;
}

function defaultTimeForWorkflow(workflow) {
  switch (String(workflow || '')) {
    case 'Market mapping': return '45 min';
    case 'Application preparation': return '60 min';
    case 'Application blocker': return '30 min';
    case 'People sourcing':
    case 'Opportunity scan':
    case 'People source scan':
    case 'Org job scan':
    case 'Referral search':
    case 'Conversation prep': return '30 min';
    case 'Offer decision': return '30 min';
    case 'Task unblocker': return '15 min';
    case 'Plan interview prep': return '15 min';
    case 'Contact follow-up':
    case 'Reply and arrange conversation':
    case 'Submit application':
    case 'Interview follow-up':
    case 'Check application response':
    case ORG_CLASSIFICATION_WORKFLOW:
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
function inferDecisionActionType(key, targetType, workflow, task) {
  key = String(key || '');
  if (isApplicationPlanDecisionKey(key)) return 'Open popup';
  if (key.indexOf('JOB_RESPONSE_OUTCOME:') === 0 || key.indexOf('INTERVIEW_OUTCOME:') === 0 ||
      key.indexOf('PERSON_REPLY_OUTCOME:') === 0 || key.indexOf('OFFER_DECISION_DONE:') === 0 ||
      key.indexOf('ORG_DORMANT_LIVE:') === 0 || key.indexOf('ORG_REVIEW_DUE:') === 0) return 'Update source';
  if (key.indexOf('ORG_PEOPLE_FOUND:') === 0 || key.indexOf('ORG_JOBS_FOUND:') === 0 ||
      key.indexOf('ORG_RESEARCH_DONE:') === 0 || key.indexOf('MARKET_MAP_DONE:') === 0 ||
      key.indexOf('INTERACTION_OPP:') === 0 || key.indexOf('INTERACTION_REFERRAL:') === 0 ||
      key.indexOf('REFERRAL_SEARCH_DONE:') === 0 || key.indexOf('SOURCE_SCAN_DONE:') === 0) return 'Capture data';
  return 'Create task';
}

function decisionDueDateFor(key, targetType, targetId, workflow) {
  if (isApplicationPlanDecisionKey(key)) {
    var planJob = getJobRowById(targetId);
    return applicationPlanDueDate(planJob);
  }
  if (targetType === 'Job') {
    var job = getJobRowById(targetId);
    if (job && (workflow === 'Referral search' || workflow === 'Application preparation')) return job.deadline || '';
    if (job && workflow === 'Admin' && normalizeJobStatus(job.status) === 'Submitted') return job.nextCheck || '';
  }
  if (targetType === 'Interview round') {
    var round = getRoundById(targetId);
    if (round) {
      var roundSheet = getSheet('Interviews');
      return roundSheet ? roundSheet.getRange(round.row, COLS.ROUNDS.EXPECTED_RESPONSE).getValue() : '';
    }
  }
  return '';
}

function writeDecisionLinkedTo(sheet, row, targetType, targetId) {
  var cell = sheet.getRange(row, COLS.DECISIONS.LINKED_TO);
  var linked = resolveLinkedTo(String(targetType || ''), String(targetId || ''));
  if (!linked.text) { cell.setValue(''); return; }
  if (!linked.row) { cell.setValue(linked.text); return; }
  var targetSheet = getSheet(linked.sheetName);
  if (!targetSheet) { cell.setValue(linked.text); return; }
  var targetCol = linked.col || 1;
  cell.setFormula('=HYPERLINK("#gid=' + targetSheet.getSheetId() + '&range=' + columnToLetter(targetCol) + linked.row + '","' + linked.text.replace(/"/g, '""') + '")');
}

function writeDecisionResult(sheet, row) {
  var decision = String(sheet.getRange(row, COLS.DECISIONS.DECISION).getValue() || '');
  var todoId = String(sheet.getRange(row, COLS.DECISIONS.TODO_ID).getValue() || '');
  var cell = sheet.getRange(row, COLS.DECISIONS.RESULT);
  if (todoId) {
    var todo = getTodoById(todoId);
    if (todo) {
      cell.setFormula('=HYPERLINK("#gid=' + getSheet('Tasks').getSheetId() + '&range=B' + todo.row + '","Task: ' + String(todo.task || todoId).replace(/"/g, '""') + '")');
      return;
    }
    cell.setValue(todoId);
    return;
  }
  if (decision === 'No') cell.setValue('Dismissed');
  else if (decision === 'Auto-dismissed') cell.setValue('Auto-dismissed');
  else if (decision === 'Yes') cell.setValue('Handled');
  else cell.setValue('');
}

function applyDecisionHelperColumns(sheet, row) {
  var key = String(sheet.getRange(row, COLS.DECISIONS.KEY).getValue() || '');
  if (!key) return;
  var targetType = String(sheet.getRange(row, COLS.DECISIONS.TARGET_TYPE).getValue() || '');
  var targetId = String(sheet.getRange(row, COLS.DECISIONS.TARGET_ID).getValue() || '');
  var workflow = String(sheet.getRange(row, COLS.DECISIONS.WORKFLOW).getValue() || '');
  var task = String(sheet.getRange(row, COLS.DECISIONS.TASK).getValue() || '');
  var decision = String(sheet.getRange(row, COLS.DECISIONS.DECISION).getValue() || '');
  var actionCell = sheet.getRange(row, COLS.DECISIONS.ACTION_TYPE);
  var dueCell = sheet.getRange(row, COLS.DECISIONS.DUE_DATE);
  if (decision === 'Pending' || !actionCell.getValue()) actionCell.setValue(inferDecisionActionType(key, targetType, workflow, task));
  if (decision === 'Pending' || !dueCell.getValue()) dueCell.setValue(decisionDueDateFor(key, targetType, targetId, workflow) || '');
  writeDecisionLinkedTo(sheet, row, targetType, targetId);
  writeDecisionResult(sheet, row);
}

function backfillDecisionHelperColumns() {
  var sheet = ensureDecisionsTab();
  if (!sheet || sheet.getLastRow() < 2) return;
  autoDismissPendingDecisionsForUnavailableSources('Linked source is closed, parked, retired, or missing');
  for (var r = 2; r <= sheet.getLastRow(); r++) applyDecisionHelperColumns(sheet, r);
}

function acceptPendingDecision(sheet, row) {
  var task = sheet.getRange(row, COLS.DECISIONS.TASK).getValue();
  var targetType = sheet.getRange(row, COLS.DECISIONS.TARGET_TYPE).getValue();
  var targetId = sheet.getRange(row, COLS.DECISIONS.TARGET_ID).getValue();
  var workflow = sheet.getRange(row, COLS.DECISIONS.WORKFLOW).getValue();
  var notes = sheet.getRange(row, COLS.DECISIONS.NOTES).getValue();
  var existingTodoId = String(sheet.getRange(row, COLS.DECISIONS.TODO_ID).getValue() || '');
  if (existingTodoId) {
    sheet.getRange(row, COLS.DECISIONS.DECIDED_AT).setValue(today());
    applyDecisionHelperColumns(sheet, row);
    return { ok: true, todoId: existingTodoId, reused: true };
  }
  var org = resolveOrgForTarget(targetType, targetId);
  var dueDate = sheet.getRange(row, COLS.DECISIONS.DUE_DATE).getValue() || '';
  if (targetType === 'Job' && (workflow === 'Application preparation' || workflow === 'Referral search')) {
    var decisionJob = getJobRowById(targetId);
    dueDate = dueDate || (decisionJob ? decisionJob.deadline : '');
  }
  var todoId = appendTodoWithSource(task, targetType, targetId, org, workflow, 'Not started', dueDate, defaultTimeForWorkflow(workflow), notes, 'Decision');
  if (!todoId) todoId = findOpenTodoByTaskTarget(task, targetId, workflow);
  if (todoId) {
    sheet.getRange(row, COLS.DECISIONS.TODO_ID).setValue(todoId);
    applyDecisionHelperColumns(sheet, row);
  } else {
    sheet.getRange(row, COLS.DECISIONS.DECISION).setValue('Pending');
    appendNoteFlag(sheet, row, COLS.DECISIONS.NOTES, '[yes-failed] Task was not created or found');
    return { ok: false, todoId: '', reason: 'Task was not created or found' };
  }
  sheet.getRange(row, COLS.DECISIONS.DECIDED_AT).setValue(today());
  applyDecisionHelperColumns(sheet, row);
  return { ok: true, todoId: todoId, reused: false };
}

// Shared by onEditDecisions and handleDecisionAction: writes the chosen
// action onto the Decisions row, runs the accept flow on Yes (which may
// revert the row back to Pending on failure — see acceptPendingDecision),
// and stamps Decided at for No/Auto-dismissed. Returns the accept result
// (or null for No/Auto-dismissed) so callers can toast appropriately.
function decisionContextFromRow(sheet, row, action) {
  return {
    sheet: sheet,
    row: row,
    action: String(action || ''),
    id: String(sheet.getRange(row, COLS.DECISIONS.ID).getValue() || ''),
    key: String(sheet.getRange(row, COLS.DECISIONS.KEY).getValue() || ''),
    task: String(sheet.getRange(row, COLS.DECISIONS.TASK).getValue() || ''),
    targetType: String(sheet.getRange(row, COLS.DECISIONS.TARGET_TYPE).getValue() || ''),
    targetId: String(sheet.getRange(row, COLS.DECISIONS.TARGET_ID).getValue() || ''),
    workflow: String(sheet.getRange(row, COLS.DECISIONS.WORKFLOW).getValue() || ''),
    notes: String(sheet.getRange(row, COLS.DECISIONS.NOTES).getValue() || ''),
    actionType: String(sheet.getRange(row, COLS.DECISIONS.ACTION_TYPE).getValue() || '')
  };
}

function resolveOpenPopupDecision(ctx) {
  if (isApplicationPlanDecisionKey(ctx.key)) {
    ctx.sheet.getRange(ctx.row, COLS.DECISIONS.DECISION).setValue('Pending');
    runApplicationPlanPopup(ctx.targetId, ctx.id);
    applyDecisionHelperColumns(ctx.sheet, ctx.row);
    return { ok: true, pending: true, popupOpened: true };
  }
  var captureType = sourceUpdateCaptureTypeForDecision(ctx);
  if (captureType) return runDecisionCapturePopup(ctx, captureType);
  return keepDecisionPendingForMissingRoute(ctx, '[route-error]', 'Decision route is not configured; run Repair all tabs, then review this row');
}

function decisionKeySuffix(key, prefix) {
  var raw = String(key || '');
  if (raw.indexOf(prefix) !== 0) return '';
  return raw.slice(prefix.length).split(':')[0];
}

function runDecisionCapturePopup(ctx, captureType) {
  ctx.sheet.getRange(ctx.row, COLS.DECISIONS.DECISION).setValue('Pending');
  runCapturePopup(captureType, ctx.id, captureDefaultsForDecision(ctx, captureType));
  applyDecisionHelperColumns(ctx.sheet, ctx.row);
  return { ok: true, pending: true, popupOpened: true };
}

function captureTypeForDecision(ctx) {
  var key = String(ctx.key || '');
  if (key.indexOf('ORG_PEOPLE_FOUND:') === 0 || key.indexOf('INTERACTION_REFERRAL:') === 0) return 'Add/update person';
  if (key.indexOf('ORG_JOBS_FOUND:') === 0 || key.indexOf('INTERACTION_OPP:') === 0) return 'Add/update job';
  if (key.indexOf('ORG_RESEARCH_DONE:') === 0) return 'Add/update organisation';
  if (key.indexOf('MARKET_MAP_DONE:') === 0) return 'Find organisations';
  return '';
}

function captureDefaultsForDecision(ctx, captureType) {
  var defaults = {};
  if (ctx.targetType === 'Organisation') {
    var org = getOrgById(ctx.targetId);
    if (org) {
      if (captureType === 'Add/update person' || captureType === 'Add/update job') defaults.org = org.name || '';
      if (captureType === 'Add/update organisation') {
        defaults.orgNames = org.name || '';
        defaults.sector = isNeedsClassificationLabel(org.sector) ? '' : (org.sector || '');
        defaults.subsector = org.subsector || '';
        defaults.tier = org.tier || 'B';
        defaults.status = org.status || 'Mapped';
      }
    }
  }
  if (ctx.targetType === 'Job') {
    var job = getJobRowById(ctx.targetId);
    if (job) {
      defaults.org = job.org || '';
      defaults.jobTitle = job.title || '';
      defaults.deadline = formatDateHuman(job.deadline);
      defaults.status = normalizeJobStatus(job.status) || job.status || '';
      defaults.appliedDate = formatDateHuman(job.appliedDate);
      defaults.outcome = normalizeJobOutcome(job.outcome) || '';
    }
  }
  if (ctx.targetType === 'Interview round') {
    var round = getRoundById(ctx.targetId);
    if (round) {
      defaults.org = round.org || '';
      defaults.jobTitle = round.job || '';
      defaults.roundNumber = round.round || '';
      defaults.roundType = round.roundType || '';
      defaults.interviewDate = formatDateHuman(round.interviewDate);
      defaults.status = round.status || '';
      defaults.officialOutcome = round.officialOutcome || '';
    }
  }
  if (ctx.targetType === 'Person') {
    var targetPerson = getPersonRowById(ctx.targetId);
    if (targetPerson) {
      defaults.name = targetPerson.name || '';
      defaults.person = targetPerson.name || '';
      defaults.org = targetPerson.org || '';
    }
  }
  if (ctx.targetType === 'Sector' && captureType === 'Find organisations') {
    var branch = getSectorBranchById(ctx.targetId);
    if (branch) {
      defaults.sector = branch.sector || '';
      defaults.subsector = branch.subsector || '';
    }
  }
  if (ctx.targetType === 'Person' && captureType === 'Add/update conversation') {
    var conversationPerson = getPersonRowById(ctx.targetId);
    if (conversationPerson) {
      defaults.person = conversationPerson.name || '';
      defaults.org = conversationPerson.org || '';
    }
  }
  if (ctx.targetType === 'Person' && captureType === 'Add/update job') {
    var person = getPersonRowById(ctx.targetId);
    if (person && person.org) defaults.org = person.org;
  }
  return defaults;
}

function resolveCaptureDataDecision(ctx) {
  var referralSearchTodoId = decisionKeySuffix(ctx.key, 'REFERRAL_SEARCH_DONE:');
  if (referralSearchTodoId) {
    ctx.sheet.getRange(ctx.row, COLS.DECISIONS.DECISION).setValue('Pending');
    runReferralSearchResultPopup(referralSearchTodoId, ctx.id);
    applyDecisionHelperColumns(ctx.sheet, ctx.row);
    return { ok: true, pending: true, popupOpened: true };
  }
  var sourceScanTodoId = decisionKeySuffix(ctx.key, 'SOURCE_SCAN_DONE:');
  if (sourceScanTodoId) {
    ctx.sheet.getRange(ctx.row, COLS.DECISIONS.DECISION).setValue('Pending');
    runSourceScanResultPopup(sourceScanTodoId, ctx.id);
    applyDecisionHelperColumns(ctx.sheet, ctx.row);
    return { ok: true, pending: true, popupOpened: true };
  }
  var captureType = captureTypeForDecision(ctx);
  if (captureType) {
    ctx.sheet.getRange(ctx.row, COLS.DECISIONS.DECISION).setValue('Pending');
    runCapturePopup(captureType, ctx.id, captureDefaultsForDecision(ctx, captureType));
    applyDecisionHelperColumns(ctx.sheet, ctx.row);
    return { ok: true, pending: true, popupOpened: true };
  }
  return keepDecisionPendingForMissingRoute(ctx, '[route-error]', 'Decision capture route is not configured; run Repair all tabs, then review this row');
}

function keepDecisionPendingForMissingRoute(ctx, flag, reason) {
  ctx.sheet.getRange(ctx.row, COLS.DECISIONS.DECISION).setValue('Pending');
  appendNoteFlag(ctx.sheet, ctx.row, COLS.DECISIONS.NOTES, flag + ' ' + reason);
  applyDecisionHelperColumns(ctx.sheet, ctx.row);
  return { ok: false, pending: true, missingRoute: true, reason: reason };
}

function resolveUpdateSourceDecision(ctx) {
  if (String(ctx.key || '').indexOf('JOB_RESPONSE_OUTCOME:') === 0 && ctx.targetType === 'Job') {
    ctx.sheet.getRange(ctx.row, COLS.DECISIONS.DECISION).setValue('Pending');
    runApplicationResultForJobPopup(ctx.targetId, ctx.id);
    applyDecisionHelperColumns(ctx.sheet, ctx.row);
    return { ok: true, pending: true, popupOpened: true };
  }
  var captureType = '';
  if (String(ctx.key || '').indexOf('INTERVIEW_OUTCOME:') === 0) {
    ctx.sheet.getRange(ctx.row, COLS.DECISIONS.DECISION).setValue('Pending');
    runInterviewOutcomePopup(ctx.targetId, ctx.id);
    applyDecisionHelperColumns(ctx.sheet, ctx.row);
    return { ok: true, pending: true, popupOpened: true };
  }
  if (String(ctx.key || '').indexOf('OFFER_DECISION_DONE:') === 0 && ctx.targetType === 'Job') {
    ctx.sheet.getRange(ctx.row, COLS.DECISIONS.DECISION).setValue('Pending');
    runOfferDecisionPopup(ctx.targetId, ctx.id);
    applyDecisionHelperColumns(ctx.sheet, ctx.row);
    return { ok: true, pending: true, popupOpened: true };
  }
  if ((String(ctx.key || '').indexOf('ORG_DORMANT_LIVE:') === 0 ||
      String(ctx.key || '').indexOf('ORG_REVIEW_DUE:') === 0) && ctx.targetType === 'Organisation') {
    ctx.sheet.getRange(ctx.row, COLS.DECISIONS.DECISION).setValue('Pending');
    runCapturePopup('Add/update organisation', ctx.id, captureDefaultsForDecision(ctx, 'Add/update organisation'));
    applyDecisionHelperColumns(ctx.sheet, ctx.row);
    return { ok: true, pending: true, popupOpened: true };
  }
  if (String(ctx.key || '').indexOf('PERSON_REPLY_OUTCOME:') === 0) captureType = 'Add/update conversation';
  if (captureType) {
    return runDecisionCapturePopup(ctx, captureType);
  }
  captureType = sourceUpdateCaptureTypeForDecision(ctx);
  if (captureType) return runDecisionCapturePopup(ctx, captureType);
  return keepDecisionPendingForMissingRoute(ctx, '[route-error]', 'Decision source-update route is not configured; run Repair all tabs, then review this row');
}

function sourceUpdateCaptureTypeForDecision(ctx) {
  switch (String(ctx.targetType || '')) {
    case 'Job': return 'Application update';
    case 'Organisation': return 'Add/update organisation';
    case 'Person': return 'Add/update person';
    case 'Interview round': return 'Add/update interview';
    default: return '';
  }
}

function resolveCreateTaskDecision(ctx) {
  return acceptPendingDecision(ctx.sheet, ctx.row);
}

function resolveDecisionAction(ctx) {
  if (ctx.action === 'No' || ctx.action === 'Auto-dismissed') {
    ctx.sheet.getRange(ctx.row, COLS.DECISIONS.DECISION).setValue(ctx.action);
    ctx.sheet.getRange(ctx.row, COLS.DECISIONS.DECIDED_AT).setValue(today());
    if (isApplicationPlanDecisionKey(ctx.key)) {
      var job = getJobRowById(ctx.targetId);
      if (job) clearNoteFlag(getSheet('Jobs'), job.row, COLS.JOBS.NOTES, '[needs-application-plan]');
    }
    applyDecisionHelperColumns(ctx.sheet, ctx.row);
    return null;
  }

  ctx.sheet.getRange(ctx.row, COLS.DECISIONS.DECISION).setValue('Yes');
  switch (ctx.actionType || inferDecisionActionType(ctx.key, ctx.targetType, ctx.workflow, ctx.task)) {
    case 'Open popup':
      return resolveOpenPopupDecision(ctx);
    case 'Dismiss only':
      ctx.sheet.getRange(ctx.row, COLS.DECISIONS.DECIDED_AT).setValue(today());
      applyDecisionHelperColumns(ctx.sheet, ctx.row);
      return { ok: true, dismissedOnly: true };
    case 'Capture data':
      return resolveCaptureDataDecision(ctx);
    case 'Update source':
      return resolveUpdateSourceDecision(ctx);
    case 'Create task':
    default:
      return resolveCreateTaskDecision(ctx);
  }
}

function resolveDecision(decisionsSheet, row, action) {
  var ctx = decisionContextFromRow(decisionsSheet, row, action);
  var accepted = resolveDecisionAction(ctx);
  applyDecisionHelperColumns(decisionsSheet, row);
  return accepted;
}

function toastForDecisionOutcome(action, accepted) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (action !== 'Yes') { ss.toast('Decision dismissed.', 'The Planner', 3); return; }
  if (accepted && accepted.popupOpened) {
    ss.toast('Opened the decision popup. This stays Pending until the popup saves.', 'The Planner', 5);
    return;
  }
  if (accepted && accepted.ok) {
    ss.toast(accepted.reused ? 'Already linked to an existing task.' : (accepted.dismissedOnly ? 'Decision handled.' : 'Decision promoted to a Task.'), 'The Planner', 3);
  } else if (accepted && accepted.missingRoute) {
    ss.toast('Decision kept Pending: ' + accepted.reason + '.', 'The Planner', 6);
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
  if (decision === 'Yes' && accepted && accepted.ok && !accepted.popupOpened) populateToday();
  else requestHomeRefresh();
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
    applyDecisionHelperColumns(sheet, r);
    count++;
  }
  return count;
}

function autoDismissPendingDecisionByKey(key, reason) {
  var sheet = ensureDecisionsTab();
  if (!sheet || sheet.getLastRow() < 2 || !key) return false;
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS['Pending decisions'].length).getValues();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][COLS.DECISIONS.KEY - 1]) !== String(key)) continue;
    if (String(data[i][COLS.DECISIONS.DECISION - 1]) !== 'Pending') return false;
    var r = i + 2;
    sheet.getRange(r, COLS.DECISIONS.DECISION).setValue('Auto-dismissed');
    sheet.getRange(r, COLS.DECISIONS.DECIDED_AT).setValue(today());
    appendNoteFlag(sheet, r, COLS.DECISIONS.NOTES, '[auto-dismissed] ' + (reason || 'Superseded by direct action'));
    applyDecisionHelperColumns(sheet, r);
    return true;
  }
  return false;
}

function autoDismissPendingDecisionPrefixForTarget(prefix, targetType, targetId, reason) {
  var sheet = ensureDecisionsTab();
  if (!sheet || sheet.getLastRow() < 2 || !prefix || !targetId) return 0;
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS['Pending decisions'].length).getValues();
  var count = 0;
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][COLS.DECISIONS.DECISION - 1]) !== 'Pending') continue;
    if (String(data[i][COLS.DECISIONS.TARGET_TYPE - 1]) !== String(targetType)) continue;
    if (String(data[i][COLS.DECISIONS.TARGET_ID - 1]) !== String(targetId)) continue;
    if (String(data[i][COLS.DECISIONS.KEY - 1] || '').indexOf(prefix) !== 0) continue;
    var r = i + 2;
    sheet.getRange(r, COLS.DECISIONS.DECISION).setValue('Auto-dismissed');
    sheet.getRange(r, COLS.DECISIONS.DECIDED_AT).setValue(today());
    appendNoteFlag(sheet, r, COLS.DECISIONS.NOTES, '[auto-dismissed] ' + (reason || 'Superseded by direct source update'));
    applyDecisionHelperColumns(sheet, r);
    count++;
  }
  return count;
}

function decisionLinkedSourceIsTerminal(row) {
  var targetType = String(row[COLS.DECISIONS.TARGET_TYPE - 1] || '');
  var targetId = String(row[COLS.DECISIONS.TARGET_ID - 1] || '');
  if (!targetType || targetType === 'None' || !targetId) return false;
  return isSourceObjectTerminal(targetType, targetId);
}

function decisionLinkedSourceIsMissing(row, maps) {
  var targetType = String(row[COLS.DECISIONS.TARGET_TYPE - 1] || '');
  var targetId = String(row[COLS.DECISIONS.TARGET_ID - 1] || '');
  if (!isKnownLinkedObjectType(targetType) || !targetId) return false;
  maps = maps || buildLinkedObjectHealthMaps();
  return !linkedObjectExistsForHealth(targetType, targetId, maps);
}

function decisionLinkedSourceUnavailable(row, maps) {
  return decisionLinkedSourceIsTerminal(row) || decisionLinkedSourceIsMissing(row, maps);
}

function autoDismissPendingDecisionsForUnavailableSources(reason) {
  var sheet = ensureDecisionsTab();
  if (!sheet || sheet.getLastRow() < 2) return 0;
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS['Pending decisions'].length).getValues();
  var maps = buildLinkedObjectHealthMaps();
  var count = 0;
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][COLS.DECISIONS.DECISION - 1]) !== 'Pending') continue;
    if (!decisionLinkedSourceUnavailable(data[i], maps)) continue;
    var row = i + 2;
    sheet.getRange(row, COLS.DECISIONS.DECISION).setValue('Auto-dismissed');
    sheet.getRange(row, COLS.DECISIONS.DECIDED_AT).setValue(today());
    appendNoteFlag(sheet, row, COLS.DECISIONS.NOTES, '[auto-dismissed] ' + (reason || 'Linked source is no longer active or no longer exists'));
    applyDecisionHelperColumns(sheet, row);
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
  applyDecisionHelperColumns(sheet, found.row);
  return true;
}

function decisionSortDateValue(decisionRow) {
  var due = decisionRow[COLS.DECISIONS.DUE_DATE - 1];
  if (due) {
    var dueDate = new Date(due);
    if (!isNaN(dueDate.getTime())) return dueDate.getTime();
  }
  var key = String(decisionRow[COLS.DECISIONS.KEY - 1] || '');
  if (isApplicationPlanDecisionKey(key) && String(decisionRow[COLS.DECISIONS.TARGET_TYPE - 1]) === 'Job') {
    var job = getJobRowById(decisionRow[COLS.DECISIONS.TARGET_ID - 1]);
    var planBy = applicationPlanDueDate(job);
    if (planBy) return new Date(planBy).getTime();
  }
  return 9999999999999;
}

function decisionCreatedDateValue(decisionRow) {
  var created = decisionRow[COLS.DECISIONS.CREATED - 1] || today();
  var createdDate = new Date(created);
  return isNaN(createdDate.getTime()) ? today().getTime() : createdDate.getTime();
}

function collectPendingDecisionQueue(limit) {
  var sheet = getSheet('Decisions');
  if (!sheet || sheet.getLastRow() < 2) return [];
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS['Pending decisions'].length).getValues();
  var maps = buildLinkedObjectHealthMaps();
  var out = [];
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][COLS.DECISIONS.DECISION - 1]) !== 'Pending') continue;
    if (decisionLinkedSourceUnavailable(data[i], maps)) continue;
    out.push({ row: i + 2, data: data[i] });
  }
  out.sort(function (a, b) {
    var dueDiff = decisionSortDateValue(a.data) - decisionSortDateValue(b.data);
    if (dueDiff) return dueDiff;
    var createdDiff = decisionCreatedDateValue(a.data) - decisionCreatedDateValue(b.data);
    return createdDiff || (a.row - b.row);
  });
  return limit ? out.slice(0, limit) : out;
}

function pendingDecisionCount() {
  return collectPendingDecisionQueue().length;
}

function decisionReviewTimingLabel(value) {
  if (!value) return 'No date';
  var date = new Date(value);
  if (isNaN(date.getTime())) return 'No date';
  date.setHours(0, 0, 0, 0);
  var diff = daysBetween(today(), date);
  if (diff < 0) return 'Overdue';
  if (diff === 0) return 'Due today';
  if (diff === 1) return 'Due tomorrow';
  return 'Due in ' + diff + 'd';
}

function decisionLinkedLabel(targetType, targetId) {
  var linked = resolveLinkedTo(String(targetType || ''), String(targetId || ''));
  return linked && linked.text ? linked.text : '';
}

// Up to `limit` (default 3) pending decisions. Application planning
// decisions use their plan-by date, so deadlines push genuinely urgent
// application planning onto Home without changing the Decisions schema.
function firstPendingDecisions(limit) {
  return collectPendingDecisionQueue(limit || 3);
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
  'Interview scheduling', 'Plan interview prep', 'Interview prep', 'Submit application',
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
    case 'Plan interview prep': return (daysToLinked !== null && daysToLinked <= 7) ? 'Blocking' : 'Active pursuit';
    case 'Submit application': return (daysToLinked !== null && daysToLinked <= 3) ? 'Fixed' : 'Blocking';
    case 'Interview prep':
    case 'Interview prep (Domain scoping)':
    case 'Interview prep (Study)':
    case 'Interview prep (Fit case)':
    case 'Application preparation':
      return (daysToLinked !== null && daysToLinked <= 7) ? 'Blocking' : 'Active pursuit';
    case 'Application blocker':
    case 'Task unblocker':
      return 'Blocking';
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
    case ORG_CLASSIFICATION_WORKFLOW:
    case 'Org research':
    case 'People sourcing':
    case 'Opportunity scan':
    case 'People source scan':
    case 'Org job scan':
    case 'Job board scan':
      return 'Pipeline-building';
    case 'Admin': return 'Backlog';
    default: return 'Backlog';
  }
}

function deriveEffortType(workflow) {
  var deep = ['Application preparation', 'Interview prep', 'Interview prep (Domain scoping)', 'Interview prep (Study)', 'Interview prep (Fit case)', 'Market mapping', 'Sector selection', 'Org research'];
  var medium = ['People sourcing', 'People source scan', 'Org job scan', 'Opportunity scan', 'Job board scan', 'Referral search', 'Day-before review', 'Conversation prep'];
  var shallow = [ORG_CLASSIFICATION_WORKFLOW, 'Contact follow-up', 'Reply and arrange conversation', 'Reschedule conversation', 'Thank-you and debrief', 'Send outreach', 'Submit application', 'Application blocker', 'Task unblocker', 'Interview scheduling', 'Plan interview prep', 'Interview follow-up', 'Conversation debrief', 'Outreach', 'Check application response', 'Offer decision'];
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

function recalculateTaskPriorityFromMenu() {
  var result = withDocumentLock(function () {
    recalculateCommitmentClasses();
    backfillTaskHelperColumns();
    populateToday();
    refreshHome();
    SpreadsheetApp.getActiveSpreadsheet().toast("Task priority recalculated. Today's plan and Home were refreshed.", 'The Planner', 5);
    return true;
  }, { label: 'recalculateTaskPriorityFromMenu', timeoutMs: 30000, failOpen: false });
  if (result === null) SpreadsheetApp.getActiveSpreadsheet().toast('Task priority refresh skipped because another Planner action is running. Try again in a minute.', 'The Planner', 6);
  return result;
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

function syncOpenJobDeadlineTaskDates(jobId, deadline) {
  if (!jobId) return 0;
  var sheet = getSheet('Tasks');
  if (!sheet || sheet.getLastRow() < 2) return 0;
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS['To-do'].length).getValues();
  var count = 0;
  var planBy = applicationPlanDueDate({ deadline: deadline });
  var dateDriven = { 'Application preparation': true, 'Submit application': true, 'Referral search': true };
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][COLS.TODO.OBJ_TYPE - 1]) !== 'Job') continue;
    if (String(data[i][COLS.TODO.OBJ_ID - 1]) !== String(jobId)) continue;
    if (isTerminalTodoStatus(data[i][COLS.TODO.STATUS - 1])) continue;
    if (!dateDriven[String(data[i][COLS.TODO.WORKFLOW - 1] || '')]) continue;
    sheet.getRange(i + 2, COLS.TODO.DUE_DATE).setValue(planBy || '');
    count++;
  }
  if (count) recalcTodosLinkedToObject(String(jobId));
  return count;
}

function syncOpenJobResponseCheckDate(jobId, reviewDate) {
  if (!jobId) return 0;
  var sheet = getSheet('Tasks');
  if (!sheet || sheet.getLastRow() < 2) return 0;
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS['To-do'].length).getValues();
  var count = 0;
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][COLS.TODO.OBJ_TYPE - 1]) !== 'Job') continue;
    if (String(data[i][COLS.TODO.OBJ_ID - 1]) !== String(jobId)) continue;
    if (String(data[i][COLS.TODO.WORKFLOW - 1] || '') !== 'Check application response') continue;
    if (isTerminalTodoStatus(data[i][COLS.TODO.STATUS - 1])) continue;
    sheet.getRange(i + 2, COLS.TODO.DUE_DATE).setValue(reviewDate || '');
    count++;
  }
  if (count) recalcTodosLinkedToObject(String(jobId));
  return count;
}

function updateJobSubmittedDates(jobId, submittedDate) {
  var job = getJobRowById(jobId);
  if (!job) return null;
  var applied = parseDateOr(submittedDate);
  var review = addDays(applied, 12);
  var sheet = getSheet('Jobs');
  sheet.getRange(job.row, COLS.JOBS.APPLIED_DATE).setValue(applied);
  sheet.getRange(job.row, COLS.JOBS.REVIEW_DATE).setValue(review);
  syncOpenJobResponseCheckDate(jobId, review);
  if (normalizeJobStatus(sheet.getRange(job.row, COLS.JOBS.STATUS).getValue()) === 'Submitted' && !sheet.getRange(job.row, COLS.JOBS.RESPONSE).getValue()) {
    sheet.getRange(job.row, COLS.JOBS.RESPONSE).setValue('No');
    sheet.getRange(job.row, COLS.JOBS.OUTCOME).setValue('Waiting');
    appendTodoOnceForWorkflow('Check response from ' + job.org + ' for ' + job.title, 'Job', jobId, job.org,
      'Check application response', 'Not started', review, '15 min', 'Submitted on ' + formatDateHuman(applied), 'Auto-triggered');
  }
  return { applied: applied, review: review };
}

function removeOpenDeadlineReminderTasks() {
  var sheet = getSheet('Tasks');
  if (!sheet || sheet.getLastRow() < 2) return 0;
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS['To-do'].length).getValues();
  var rowsToDelete = [];
  for (var i = 0; i < data.length; i++) {
    var task = String(data[i][COLS.TODO.TASK - 1] || '');
    var objType = String(data[i][COLS.TODO.OBJ_TYPE - 1] || '');
    var workflow = String(data[i][COLS.TODO.WORKFLOW - 1] || '');
    var status = String(data[i][COLS.TODO.STATUS - 1] || '');
    var source = String(data[i][COLS.TODO.SOURCE - 1] || '');
    if (task.indexOf('Deadline approaching: ') !== 0) continue;
    if (objType !== 'Job' || workflow !== 'Admin' || source !== 'Auto-triggered') continue;
    if (isTerminalTodoStatus(status)) continue;
    rowsToDelete.push(i + 2);
  }
  for (var r = rowsToDelete.length - 1; r >= 0; r--) sheet.deleteRow(rowsToDelete[r]);
  return rowsToDelete.length;
}

function syncTaskHealthFlags(sheet, row, rowData, daysSinceEdit, planningCtx) {
  var todoId = String(rowData[COLS.TODO.ID - 1] || '');
  var timeEst = String(rowData[COLS.TODO.TIME_EST - 1] || '');
  var workflow = String(rowData[COLS.TODO.WORKFLOW - 1] || '');
  var objType = String(rowData[COLS.TODO.OBJ_TYPE - 1] || '');
  var objId = String(rowData[COLS.TODO.OBJ_ID - 1] || '');
  var dueDate = rowData[COLS.TODO.DUE_DATE - 1];
  var isParent = planningCtx ? !!(planningCtx.childrenByParent[todoId] && planningCtx.childrenByParent[todoId].length) : hasSubtasks(todoId);

  // Mechanical health flags are recomputed every hygiene pass. Sticky
  // manual/review flags ([blocked], [flags], [review]) are intentionally
  // not cleared here.
  if (timeEst === 'Multi-day' && daysSinceEdit !== null && daysSinceEdit >= MULTIDAY_NEEDS_PLANNING_DAYS && !isParent) {
    appendNoteFlag(sheet, row, COLS.TODO.NOTES, '[needs planning] \u26a0 Multi-day - make this task multi-step');
  } else {
    clearNoteFlag(sheet, row, COLS.TODO.NOTES, '[needs planning]');
  }
  clearNoteFlag(sheet, row, COLS.TODO.NOTES, '[needs breakdown]');
  if (!timeEst) appendNoteFlag(sheet, row, COLS.TODO.NOTES, '[no-estimate] \u26a0 Missing time estimate');
  else clearNoteFlag(sheet, row, COLS.TODO.NOTES, '[no-estimate]');

  if (workflow !== 'Admin' && (objType === 'None' || !objType)) appendNoteFlag(sheet, row, COLS.TODO.NOTES, '[no-link] \u26a0 Missing linked object for ' + workflow);
  else clearNoteFlag(sheet, row, COLS.TODO.NOTES, '[no-link]');

  if (DATE_CONDITIONAL_WORKFLOWS.indexOf(workflow) !== -1 && resolveDaysToLinkedDate(workflow, objId, objType, dueDate) === null) {
    appendNoteFlag(sheet, row, COLS.TODO.NOTES, '[no-date] \u26a0 No due date for a date-sensitive workflow');
  } else {
    clearNoteFlag(sheet, row, COLS.TODO.NOTES, '[no-date]');
  }

  clearNoteFlag(sheet, row, COLS.TODO.NOTES, '[parent-still-open]');
}

function runQueueHygiene() {
  var sheet = getSheet('Tasks');
  if (!sheet || sheet.getLastRow() < 2) return;
  var todayDate = today();
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, COLS.TODO.CLASS_CALC_AT).getValues();
  var planningCtx = buildTaskPlanningContext(data);
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
    syncTaskHealthFlags(sheet, r, row, daysSinceEdit, planningCtx);
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
  if (!isOpenTodoStatus(statusToCreate)) return false;
  var linked = !!objId || (workflow && workflow !== 'Admin');
  var data = sheet.getRange(2, 1, lastRow - 1, COLS.TODO.STATUS).getValues();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][COLS.TODO.OBJ_ID - 1]) !== String(objId || '')) continue;
    if (workflow && String(data[i][COLS.TODO.WORKFLOW - 1]) !== String(workflow)) continue;
    var st = String(data[i][COLS.TODO.STATUS - 1]);
    if (!isOpenTodoStatus(st)) continue;
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
    if (isOpenTodoStatus(st)) return true;
  }
  return false;
}

function findOpenTodoForTargetWorkflow(objType, objId, workflow) {
  var sheet = getSheet('Tasks');
  if (!sheet || sheet.getLastRow() < 2 || !objId || !workflow) return null;
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS['To-do'].length).getValues();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][COLS.TODO.OBJ_TYPE - 1]) !== String(objType)) continue;
    if (String(data[i][COLS.TODO.OBJ_ID - 1]) !== String(objId)) continue;
    if (String(data[i][COLS.TODO.WORKFLOW - 1]) !== String(workflow)) continue;
    if (!isOpenTodoStatus(String(data[i][COLS.TODO.STATUS - 1]))) continue;
    return { row: i + 2, id: String(data[i][COLS.TODO.ID - 1] || ''), data: data[i] };
  }
  return null;
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
    if (!isOpenTodoStatus(st)) continue;
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
  syncTaskPlanningHelpers();
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
  var commitmentClassCol = columnToLetter(COLS.TODO.COMMITMENT_CLASS);
  return '=SWITCH($' + commitmentClassCol + row + ',"Fixed",1,"Blocking",2,"Keep-alive",3,"Active pursuit",4,"Pipeline-building",5,"Backlog",6,99)';
}

function onTodayFormula(row) {
  var todayTodoIdCol = columnToLetter(COLS.TODAY.TODO_ID);
  var taskIdCol = columnToLetter(COLS.TODO.ID);
  return '=IF(COUNTIF(Today!$' + todayTodoIdCol + '$' + TODAY_TABLE_FIRST_ROW + ':$' + todayTodoIdCol + '$' + TODAY_TABLE_LAST_ROW + ',$' + taskIdCol + row + ')>0,"Yes","No")';
}

function hasSubtasksFormula(row) {
  var parentIdCol = columnToLetter(COLS.TODO.PARENT_ID);
  var taskIdCol = columnToLetter(COLS.TODO.ID);
  return '=IF(COUNTIF($' + parentIdCol + '$2:$' + parentIdCol + ',$' + taskIdCol + row + ')>0,"Yes","No")';
}

// objType/objId -> source-tab display name + row, for the "Linked to"
// HYPERLINK. Sector-linked tasks may target SEC-* broad sectors or SUB-*
// sub-sector rows; legacy raw-name links are repaired by repairSectorTaskLinks.
var LINKED_TO_MAP = {
  'Job': { sheet: 'Jobs', idCol: 1, nameCol: 2 },
  'Person': { sheet: 'People', idCol: 1, nameCol: 2 },
  'Organisation': { sheet: 'Organisations', idCol: 1, nameCol: 2 },
  'Interview round': { sheet: 'Interviews', idCol: 1, nameCol: 3 }
};

function resolveLinkedTo(objType, objId) {
  if (!objId || !objType || objType === 'None') return { text: '', sheetName: '', row: 0 };
  if (objType === 'Sector') {
    var branch = getSectorBranchById(objId);
    if (branch) return { text: branch.subsector ? branch.sector + ' - ' + branch.subsector : branch.sector, sheetName: 'Sectors', row: branch.row, col: branch.subsector ? COLS.SECTORS.SUBSECTOR : COLS.SECTORS.SECTOR };
    return { text: String(objId), sheetName: '', row: 0 };
  }
  var spec = LINKED_TO_MAP[objType];
  if (!spec) return { text: '', sheetName: '', row: 0 };
  var sheet = getSheet(spec.sheet);
  if (sheet && sheet.getLastRow() > 1) {
    var ids = sheet.getRange(2, spec.idCol, sheet.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === String(objId)) {
        var row = i + 2;
        var name = String(sheet.getRange(row, spec.nameCol).getValue() || '');
        return { text: name || spec.sheet, sheetName: spec.sheet, row: row, col: spec.nameCol };
      }
    }
  }
  return { text: '', sheetName: '', row: 0 };
}

function writeLinkedTo(sheet, row, objType, objId) {
  var cell = sheet.getRange(row, COLS.TODO.LINKED_TO);
  var linked = resolveLinkedTo(objType, objId);
  if (!linked.text) { cell.setValue(''); return; }
  if (!linked.row) { cell.setValue(linked.text); return; }
  var targetSheet = getSheet(linked.sheetName);
  if (!targetSheet) { cell.setValue(linked.text); return; }
  var targetCol = linked.col || 1;
  cell.setFormula('=HYPERLINK("#gid=' + targetSheet.getSheetId() + '&range=' + columnToLetter(targetCol) + linked.row + '","' + linked.text.replace(/"/g, '""') + '")');
}

function taskHasBrokenSourceNotes(notes) {
  return /\[(no-link|orphaned-link|orphaned-sector|orphaned-org)\]/.test(String(notes || ''));
}

function taskStepNumber(row) {
  var raw = row ? row[COLS.TODO.STEP - 1] : '';
  var n = parseInt(raw, 10);
  return isNaN(n) || n <= 0 ? 1 : n;
}

function buildTaskPlanningContext(data) {
  var byId = {}, childrenByParent = {};
  for (var i = 0; i < data.length; i++) {
    var id = String(data[i][COLS.TODO.ID - 1] || '');
    if (!id) continue;
    byId[id] = { row: i + 2, data: data[i], index: i };
  }
  for (var j = 0; j < data.length; j++) {
    var parentId = String(data[j][COLS.TODO.PARENT_ID - 1] || '');
    var childId = String(data[j][COLS.TODO.ID - 1] || '');
    if (!parentId || !childId) continue;
    if (!childrenByParent[parentId]) childrenByParent[parentId] = [];
    childrenByParent[parentId].push({ row: j + 2, data: data[j], index: j });
  }
  return { byId: byId, childrenByParent: childrenByParent, sourceTerminalByKey: {} };
}

function taskLinkedSourceIsTerminal(row, ctx) {
  var objType = String(row[COLS.TODO.OBJ_TYPE - 1] || '');
  var objId = String(row[COLS.TODO.OBJ_ID - 1] || '');
  if (!objType || objType === 'None' || !objId) return false;
  ctx = ctx || { sourceTerminalByKey: {} };
  if (!ctx.sourceTerminalByKey) ctx.sourceTerminalByKey = {};
  var key = objType + '|' + objId;
  if (ctx.sourceTerminalByKey.hasOwnProperty(key)) return ctx.sourceTerminalByKey[key];
  ctx.sourceTerminalByKey[key] = isSourceObjectTerminal(objType, objId);
  return ctx.sourceTerminalByKey[key];
}

function deriveReadyForTodayFromRow(row, ctx) {
  if (!row) return '';
  var id = String(row[COLS.TODO.ID - 1] || '');
  if (!id) return '';
  var status = String(row[COLS.TODO.STATUS - 1] || '');
  if (isTerminalTodoStatus(status)) return 'Done';
  if (status === 'Blocked') return 'Blocked';
  if (taskHasBrokenSourceNotes(row[COLS.TODO.NOTES - 1])) return 'Needs planning';
  if (taskLinkedSourceIsTerminal(row, ctx)) return 'Needs planning';
  if (ctx.childrenByParent[id] && ctx.childrenByParent[id].length) return 'Parent';
  if (String(row[COLS.TODO.TIME_EST - 1] || '') === 'Multi-day') return 'Needs planning';
  if (parseTimeEst(String(row[COLS.TODO.TIME_EST - 1] || '30 min')) === null) return 'Needs planning';

  var parentId = String(row[COLS.TODO.PARENT_ID - 1] || '');
  if (parentId) {
    var parent = ctx.byId[parentId];
    if (!parent) return 'Waiting';
    var pattern = String(parent.data[COLS.TODO.PLAN_PATTERN - 1] || 'Parallel');
    if (pattern === 'Step-based') {
      var siblings = ctx.childrenByParent[parentId] || [];
      var minStep = null;
      for (var i = 0; i < siblings.length; i++) {
        var siblingStatus = String(siblings[i].data[COLS.TODO.STATUS - 1] || '');
        if (isTerminalTodoStatus(siblingStatus)) continue;
        var siblingStep = taskStepNumber(siblings[i].data);
        if (minStep === null || siblingStep < minStep) minStep = siblingStep;
      }
      if (minStep !== null && taskStepNumber(row) !== minStep) return 'Waiting';
    }
  }
  return 'Ready';
}

function childProgressForParent(parentId, ctx) {
  var children = ctx.childrenByParent[parentId] || [];
  if (!children.length) return '';
  var done = 0, blocked = 0, waiting = 0;
  for (var i = 0; i < children.length; i++) {
    var st = String(children[i].data[COLS.TODO.STATUS - 1] || '');
    if (isTerminalTodoStatus(st)) done++;
    if (st === 'Blocked') blocked++;
    if (deriveReadyForTodayFromRow(children[i].data, ctx) === 'Waiting') waiting++;
  }
  var text = done + ' of ' + children.length + ' done';
  if (blocked) text += ' - ' + blocked + ' blocked';
  if (waiting) text += ' - ' + waiting + ' waiting';
  return text;
}

function allChildTodosTerminal(parentTodoId) {
  var sheet = getSheet('Tasks');
  if (!sheet || !parentTodoId || sheet.getLastRow() < 2) return false;
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS['To-do'].length).getValues();
  var found = false;
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][COLS.TODO.PARENT_ID - 1] || '') !== String(parentTodoId)) continue;
    found = true;
    if (!isTerminalTodoStatus(String(data[i][COLS.TODO.STATUS - 1] || ''))) return false;
  }
  return found;
}

function allChildTodosDone(parentTodoId) {
  var sheet = getSheet('Tasks');
  if (!sheet || !parentTodoId || sheet.getLastRow() < 2) return false;
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS['To-do'].length).getValues();
  var found = false;
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][COLS.TODO.PARENT_ID - 1] || '') !== String(parentTodoId)) continue;
    found = true;
    if (String(data[i][COLS.TODO.STATUS - 1] || '') !== 'Done') return false;
  }
  return found;
}

function allChildTodosTerminalInContext(parentTodoId, ctx) {
  var children = ctx.childrenByParent[parentTodoId] || [];
  if (!children.length) return false;
  for (var i = 0; i < children.length; i++) {
    if (!isTerminalTodoStatus(String(children[i].data[COLS.TODO.STATUS - 1] || ''))) return false;
  }
  return true;
}

function allChildTodosDoneInContext(parentTodoId, ctx) {
  var children = ctx.childrenByParent[parentTodoId] || [];
  if (!children.length) return false;
  for (var i = 0; i < children.length; i++) {
    if (String(children[i].data[COLS.TODO.STATUS - 1] || '') !== 'Done') return false;
  }
  return true;
}

function syncTaskPlanningHelpers() {
  var sheet = getSheet('Tasks');
  if (!sheet || sheet.getLastRow() < 2) return;
  var rowCount = sheet.getLastRow() - 1;
  var data = sheet.getRange(2, 1, rowCount, HEADERS['To-do'].length).getValues();
  var ctx = buildTaskPlanningContext(data);
  var readyValues = [], progressValues = [];
  sheet.getRange(2, COLS.TODO.PARENT_TASK, rowCount, 1).clearContent();
  for (var i = 0; i < data.length; i++) {
    var rowNum = i + 2;
    var row = data[i];
    var id = String(row[COLS.TODO.ID - 1] || '');
    var parentId = String(row[COLS.TODO.PARENT_ID - 1] || '');
    if (parentId && ctx.byId[parentId]) {
      var parent = ctx.byId[parentId];
      var parentText = String(parent.data[COLS.TODO.TASK - 1] || parentId).replace(/"/g, '""');
      sheet.getRange(rowNum, COLS.TODO.PARENT_TASK).setFormula('=HYPERLINK("#gid=' + sheet.getSheetId() + '&range=B' + parent.row + '","' + parentText + '")');
    } else if (parentId) {
      sheet.getRange(rowNum, COLS.TODO.PARENT_TASK).setValue(parentId);
    }
    readyValues.push([deriveReadyForTodayFromRow(row, ctx)]);
    progressValues.push([id ? childProgressForParent(id, ctx) : '']);
  }
  sheet.getRange(2, COLS.TODO.READY_FOR_TODAY, rowCount, 1).setValues(readyValues);
  sheet.getRange(2, COLS.TODO.CHILD_PROGRESS, rowCount, 1).setValues(progressValues);
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
  if (!sheet) return;
  var bodyRows = Math.max(sheet.getMaxRows() - 1, 1);
  sheet.getRange(2, COLS.TODO.PRIORITY_RANK, bodyRows, 4).clearContent().clearNote().clearDataValidations();
  sheet.getRange(2, COLS.TODO.PARENT_TASK, bodyRows, 3).clearContent().clearNote().clearDataValidations();
  if (sheet.getLastRow() < 2) return;
  for (var r = 2; r <= sheet.getLastRow(); r++) {
    applyTaskHelperColumns(sheet, r);
  }
  syncTaskPlanningHelpers();
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
function updateOpenTodoDueForTargetWorkflow(objType, objId, workflow, dueDate) {
  var sheet = getSheet('Tasks');
  if (!sheet || sheet.getLastRow() < 2 || !objId || !workflow) return 0;
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS['To-do'].length).getValues();
  var count = 0;
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][COLS.TODO.OBJ_TYPE - 1]) !== String(objType)) continue;
    if (String(data[i][COLS.TODO.OBJ_ID - 1]) !== String(objId)) continue;
    if (String(data[i][COLS.TODO.WORKFLOW - 1]) !== String(workflow)) continue;
    var st = String(data[i][COLS.TODO.STATUS - 1]);
    if (!isOpenTodoStatus(st)) continue;
    var r = i + 2;
    sheet.getRange(r, COLS.TODO.DUE_DATE).setValue(dueDate || '');
    sheet.getRange(r, COLS.TODO.COMMITMENT_CLASS).setValue(assignCommitmentClass(workflow, dueDate, objId, objType));
    sheet.getRange(r, COLS.TODO.LAST_EDITED).setValue(today());
    count++;
  }
  if (count) syncTaskPlanningHelpers();
  return count;
}

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
    if (!isOpenTodoStatus(st)) continue;
    var r = i + 2;
    sheet.getRange(r, COLS.TODO.STATUS).setValue(status);
    sheet.getRange(r, COLS.TODO.COMPLETED).setValue(today());
    appendNoteFlag(sheet, r, COLS.TODO.NOTES, '[' + String(status).toLowerCase() + '] ' + (reason || 'Underlying state changed'));
    count++;
  }
  return count;
}

function cancelInterviewRoundWorkForJob(jobId, reason) {
  var sheet = getSheet('Interviews');
  if (!sheet || sheet.getLastRow() < 2 || !jobId) return 0;
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS['Interview rounds'].length).getValues();
  var count = 0;
  var msg = reason || 'Job closed';
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][COLS.ROUNDS.JOB_ID - 1] || '') !== String(jobId)) continue;
    var roundId = String(data[i][COLS.ROUNDS.ID - 1] || '');
    if (!roundId) continue;
    var row = i + 2;
    var status = String(data[i][COLS.ROUNDS.STATUS - 1] || '');
    if (status && ['Completed', 'Cancelled'].indexOf(status) === -1) {
      sheet.getRange(row, COLS.ROUNDS.STATUS).setValue('Cancelled');
      appendNoteFlag(sheet, row, COLS.ROUNDS.NOTES, '[job-closed] ' + msg);
    }
    count += setOpenTodosForTarget('Interview round', roundId, 'Cancelled', msg);
    autoDismissPendingForTarget('Interview round', roundId, msg);
  }
  if (count) syncTaskPlanningHelpers();
  return count;
}

// =============================================================
// CANONICAL TASK COMPLETION ENGINE
// Every completion — from Today or from Tasks — routes through here.
// =============================================================

// Today is an execution surface, so it says "Planned". Tasks is the
// source of truth, so the same non-started state is stored as "Not started".
// Keep the mapping centralized so new Today/Tasks sync paths cannot drift.
function todoStatusFromTodayStatus(status) {
  var v = String(status || '').trim();
  return v === 'Planned' ? 'Not started' : v;
}

function todayStatusFromTodoStatus(status) {
  return String(status || '') === 'Not started' ? 'Planned' : String(status || '');
}

function canonicalTodoStatus(status) {
  return todoStatusFromTodayStatus(status);
}

function isTerminalTodoStatus(status) {
  return ['Done', 'Skipped', 'Cancelled'].indexOf(String(status || '')) !== -1;
}

function isOpenTodoStatus(status) {
  return ['Not started', 'In progress', 'Blocked'].indexOf(String(status || '')) !== -1;
}

function isExecutableTodoStatus(status) {
  return ['Not started', 'In progress'].indexOf(String(status || '')) !== -1;
}

function todoCompletionRequiresPopup(todo) {
  return !!todo && (
    (todo.workflow === 'Submit application' && todo.objType === 'Job') ||
    isApplicationResponseCheckTask(todo) ||
    isReferralSearchContactTask(todo) ||
    isInterviewPrepPlanningTask(todo) ||
    isSourceLedScanTask(todo)
  );
}

function runCompletionPopupForTodo(todo) {
  if (!todoCompletionRequiresPopup(todo)) return false;
  if (todo.workflow === 'Submit application' && todo.objType === 'Job') runSubmitApplicationPopup(todo.id);
  else if (isApplicationResponseCheckTask(todo)) runApplicationResultPopup(todo.id);
  else if (isReferralSearchContactTask(todo)) runReferralSearchResultPopup(todo.id);
  else if (isInterviewPrepPlanningTask(todo)) runInterviewPrepPlanPopup(todo.objId, todo.id);
  else if (isSourceLedScanTask(todo)) runSourceScanResultPopup(todo.id);
  else return false;
  return true;
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
    parentId: String(sheet.getRange(row, COLS.TODO.PARENT_ID).getValue() || ''),
    blocker: String(sheet.getRange(row, COLS.TODO.BLOCKER).getValue() || ''),
    blockedById: String(sheet.getRange(row, COLS.TODO.BLOCKED_BY_ID).getValue() || ''),
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
    if (before.status === 'Blocked') {
      sheet.getRange(row, COLS.TODO.BLOCKER).setValue('');
      sheet.getRange(row, COLS.TODO.BLOCKED_BY_ID).setValue('');
      appendNoteFlag(sheet, row, COLS.TODO.NOTES, '[unblocked manually]');
    }
    syncTodayRowForTodo(row, target);
    syncTaskPlanningHelpers();
    if (before.status === 'Blocked' && options.source === 'tasks') {
      populateToday();
    } else {
      requestHomeRefresh();
    }
    return true;
  }

  if (target === 'Blocked') {
    sheet.getRange(row, COLS.TODO.COMPLETED).setValue('');
    if (!sheet.getRange(row, COLS.TODO.BLOCKER).getValue()) {
      sheet.getRange(row, COLS.TODO.BLOCKER).setValue('Blocked - add reason');
    }
    appendNoteFlag(sheet, row, COLS.TODO.NOTES, '[blocked] ' + String(sheet.getRange(row, COLS.TODO.BLOCKER).getValue() || 'Blocked'));
    syncTodayRowForTodo(row, target);
    syncTaskPlanningHelpers();
    populateToday();
    requestHomeRefresh();
    return true;
  }

  if (isTerminalTodoStatus(target)) {
    if (!sheet.getRange(row, COLS.TODO.COMPLETED).getValue()) sheet.getRange(row, COLS.TODO.COMPLETED).setValue(today());
    clearNoteFlag(sheet, row, COLS.TODO.NOTES, '[parent-ready]');
    if (target === 'Done' && hasSubtasks(before.id) && !allChildTodosDone(before.id)) {
      sheet.getRange(row, COLS.TODO.STATUS).setValue('In progress');
      sheet.getRange(row, COLS.TODO.COMPLETED).setValue('');
      appendNoteFlag(sheet, row, COLS.TODO.NOTES, '[parent-open] Finish child tasks, or review skipped/cancelled children, before completing the parent.');
      syncTodayRowForTodo(row, 'In progress');
      syncTaskPlanningHelpers();
      requestHomeRefresh();
      return false;
    }
    if (before.parentId) {
      syncTaskPlanningHelpers();
      if (allChildTodosTerminal(before.parentId)) {
        if (allChildTodosDone(before.parentId)) {
          var rollupParent = getTodoById(before.parentId);
          if (rollupParent && todoCompletionRequiresPopup(rollupParent)) {
            rollupParent.sheet.getRange(rollupParent.row, COLS.TODO.STATUS).setValue('In progress');
            rollupParent.sheet.getRange(rollupParent.row, COLS.TODO.COMPLETED).setValue('');
            rollupParent.sheet.getRange(rollupParent.row, COLS.TODO.LAST_EDITED).setValue(today());
            appendNoteFlag(rollupParent.sheet, rollupParent.row, COLS.TODO.NOTES, '[parent-ready] Child tasks are Done; complete this parent to record the source update.');
            syncTodayRowForTodo(rollupParent.row, 'In progress');
            runCompletionPopupForTodo(rollupParent);
            requestHomeRefresh();
            syncTodayRowForTodo(row, target);
            return true;
          }
          completeTodo(before.parentId, 'Done', { source: 'child-rollup' });
        } else {
          var parent = getTodoById(before.parentId);
          if (parent) {
            if (!isTerminalTodoStatus(parent.status)) {
              if (parent.status !== 'Blocked') parent.sheet.getRange(parent.row, COLS.TODO.STATUS).setValue('In progress');
              parent.sheet.getRange(parent.row, COLS.TODO.COMPLETED).setValue('');
              parent.sheet.getRange(parent.row, COLS.TODO.LAST_EDITED).setValue(today());
            }
            appendNoteFlag(parent.sheet, parent.row, COLS.TODO.NOTES, '[parent-open] Review skipped/cancelled child tasks before closing the parent.');
          }
          requestHomeRefresh();
        }
      } else {
        requestHomeRefresh();
      }
      syncTodayRowForTodo(row, target);
      return true;
    }
    if (target === 'Done' && !alreadyTerminal) routeTodoCompletion(getTodoByRow(sheet, row), options);
    // v7.6.1: a Multi-day parent retired via completeBreakdownFromPopup
    // (source: 'breakdown') is a structural rollup, not abandoned work —
    // the skip cascade would otherwise flag the linked source object
    // (e.g. "Prep/submit skipped — Park or Close?") as if it were.
    if (target === 'Skipped' && !alreadyTerminal && options.source !== 'breakdown') handleSkipCascade(sheet, row);
    if (target === 'Cancelled' && !alreadyTerminal) handleCancelCascade(sheet, row);
    syncTodayRowForTodo(row, target);
    syncTaskPlanningHelpers();
    if (EDIT_BATCH_CONTEXT && EDIT_BATCH_CONTEXT.deferTaskRefresh) {
      EDIT_BATCH_CONTEXT.needsDecisionRender = true;
      requestHomeRefresh();
    } else {
      renderTodayDecisionCards();
      requestHomeRefresh();
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
  if (todo.workflow === 'Task unblocker') return handleUnblockerTodoCompletion(todo, options || {});
  if (isSourceLedScanTask(todo)) return handleSourceLedScanCompletion(todo, options || {});
  if (todo.objType === 'Job') return handleJobTodoCompletion(todo, options || {});
  if (todo.objType === 'Person') return handlePersonTodoCompletion(todo, options || {});
  if (todo.objType === 'Interview round') return handleInterviewTodoCompletion(todo, options || {});
  if (todo.objType === 'Organisation') return handleOrganisationTodoCompletion(todo, options || {});
  if (todo.objType === 'Sector') return handleSectorTodoCompletion(todo, options || {});
}

function handleSourceLedScanCompletion(todo, options) {
  if (options.sourceScanHandled) return;
  if (todo.workflow === 'Opportunity scan') {
    appendPendingDecision('SOURCE_SCAN_DONE:' + todo.id, 'Opportunity scan completed',
      'Add/update jobs or organisations found', 'None', '', 'Opportunity scan',
      'Open the capture flow and add any opportunities or organisations found.' + (todo.notes ? '\n' + todo.notes : ''),
      { actionType: 'Capture data' });
  } else if (todo.workflow === 'People source scan') {
    appendPendingDecision('SOURCE_SCAN_DONE:' + todo.id, 'People source scan completed',
      'Add/update people found from source scan', 'None', '', 'People source scan',
      'Add people as Identified contacts. Outreach is a separate choice later.' + (todo.notes ? '\n' + todo.notes : ''),
      { actionType: 'Capture data' });
  }
}

function handleUnblockerTodoCompletion(todo, options) {
  var sheet = getSheet('Tasks');
  if (!sheet || sheet.getLastRow() < 2 || !todo || !todo.id) return 0;
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS['To-do'].length).getValues();
  var count = 0;
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][COLS.TODO.BLOCKED_BY_ID - 1] || '') !== String(todo.id)) continue;
    if (String(data[i][COLS.TODO.STATUS - 1] || '') !== 'Blocked') continue;
    var r = i + 2;
    sheet.getRange(r, COLS.TODO.STATUS).setValue('Not started');
    sheet.getRange(r, COLS.TODO.BLOCKER).setValue('');
    sheet.getRange(r, COLS.TODO.BLOCKED_BY_ID).setValue('');
    sheet.getRange(r, COLS.TODO.LAST_EDITED).setValue(today());
    appendNoteFlag(sheet, r, COLS.TODO.NOTES, '[unblocked] Unblocker completed: ' + todo.id);
    count++;
  }
  if (count) {
    syncTaskPlanningHelpers();
    populateToday();
    refreshHome();
  }
  return count;
}

function handleJobTodoCompletion(todo, options) {
  var job = getJobRowById(todo.objId);
  if (!job) return;
  if (todo.workflow === 'Application preparation' || todo.workflow === 'Application blocker') {
    createFinalSubmitTaskIfApplicationReady(job);
    return;
  } else if (todo.workflow === 'Submit application') {
    var submittedDate = options.realDate ? parseDateOr(options.realDate) : today();
    setJobStatus(todo.objId, 'Submitted', { source: options.source || 'todo-completion', realDate: submittedDate });
    updateJobSubmittedDates(todo.objId, submittedDate);
    if (!options.realDate) appendNoteFlag(getSheet('Jobs'), job.row, COLS.JOBS.NOTES, '[submitted-date-defaulted] Submitted date defaulted to today');
  } else if (todo.workflow === 'Check application response') {
    if (!options.responseCheckHandled) createJobResponseOutcomeDecision(todo.objId, 'Response check completed: ' + job.title);
  } else if (todo.workflow === 'Interview follow-up') {
    createJobResponseOutcomeDecision(todo.objId, 'Response check completed: ' + job.title);
  } else if (todo.workflow === 'Referral search') {
    if (!isReferralSearchContactTask(todo)) return;
    if (options.referralSearchHandled) return;
    appendPendingDecision('REFERRAL_SEARCH_DONE:' + todo.id, 'Referral search completed: ' + job.title,
      'Add/update referral contact found for ' + job.title + ' at ' + job.org,
      'Job', todo.objId, 'People sourcing',
      'If you found someone, accept this and add/link the person. If not, choose No; the application can still be submitted.' + (todo.notes ? '\n' + todo.notes : ''));
  } else if (todo.workflow === 'Offer decision') {
    appendPendingDecision('OFFER_DECISION_DONE:' + todo.id, 'Offer decision needs an outcome: ' + job.title,
      'Record offer decision for ' + job.title + ' at ' + job.org, 'Job', todo.objId, 'Admin', '');
  }
}

function handlePersonTodoCompletion(todo, options) {
  var person = getPersonRowById(todo.objId);
  if (!person) return;
  if (todo.workflow === 'Outreach') {
    movePersonStage(todo.objId, 'Outreach drafted', { source: 'todo-completion' });
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
    appendInteraction(todo.objId, person.name, person.org, today(), 'Auto-log', 'Thank-you/debrief completed', 'System log');
  }
}

function handleInterviewTodoCompletion(todo, options) {
  var round = getRoundById(todo.objId);
  if (!round) return;
  var sheet = getSheet('Interviews');
  if (todo.workflow === 'Interview scheduling') {
    appendNoteFlag(sheet, round.row, COLS.ROUNDS.NOTES, '[schedule-action] Scheduling task completed on ' + formatDateHuman(today()) + '. Add Interview date if it is now known.');
  } else if (todo.workflow === 'Plan interview prep') {
    appendNoteFlag(sheet, round.row, COLS.ROUNDS.NOTES, '[prep-planning] Prep planning task completed');
  } else if (/Interview prep|Day-before review/.test(todo.workflow)) {
    appendNoteFlag(sheet, round.row, COLS.ROUNDS.NOTES, '[prep-completed] ' + todo.workflow + ' on ' + formatDateHuman(today()));
  } else if (todo.workflow === 'Interview follow-up') {
    appendInteraction('', '', round.org, today(), 'Auto-log', 'Interview follow-up sent: ' + round.job, 'System log');
    sheet.getRange(round.row, COLS.ROUNDS.EXPECTED_RESPONSE).setValue(addDays(today(), 7));
    appendPendingDecision(interviewOutcomeDecisionKey(round.id), 'Interview follow-up completed: ' + round.job,
      'Record official outcome for round ' + round.round + ' - ' + round.job, 'Interview round', round.id,
      'Interview follow-up', 'Choose: waiting / next round / declined / offer / parked.');
  } else if (todo.workflow === 'Thank-you and debrief') {
    ensureInterviewDebriefTemplate(sheet, round.row);
    appendNoteFlag(sheet, round.row, COLS.ROUNDS.NOTES, '[debrief-completed] Debrief task completed on ' + formatDateHuman(today()));
    clearNoteFlag(sheet, round.row, COLS.ROUNDS.NOTES, '[missing-debrief]');
    appendInteraction('', '', round.org, today(), 'Auto-log', 'Interview thank-you/debrief completed: round ' + round.round + ' - ' + round.job, 'System log');
    appendPendingDecision(interviewOutcomeDecisionKey(round.id), 'Interview debrief completed: ' + round.job,
      'Record official outcome for round ' + round.round + ' - ' + round.job, 'Interview round', round.id,
      'Interview follow-up', 'Choose: waiting / next round / declined / offer / parked.');
  } else {
    sheet.getRange(round.row, COLS.ROUNDS.STATUS).setValue('Completed');
    if (!sheet.getRange(round.row, COLS.ROUNDS.OFFICIAL_OUTCOME).getValue()) sheet.getRange(round.row, COLS.ROUNDS.OFFICIAL_OUTCOME).setValue('Waiting');
    createInterviewDebriefTask(round.id);
    appendInteraction('', '', round.org, today(), 'Auto-log', 'Interview completed: round ' + round.round + ' - ' + round.job, 'System log');
    appendPendingDecision(interviewOutcomeDecisionKey(round.id), 'Interview completed: ' + round.job,
      'Record interview outcome for round ' + round.round + ' - ' + round.job, 'Interview round', round.id,
      'Interview follow-up', 'Choose: waiting / next round / declined / offer / parked.');
  }
}

function handleOrganisationTodoCompletion(todo, options) {
  var org = getOrgById(todo.objId);
  if (!org) return;
  var sheet = getSheet('Organisations');
  scheduleOrgReviewForRow(sheet, org.row, org.status, { stampLastChecked: true });
  if (todo.workflow === 'Org research') clearOrgRoutingFlags(sheet, org.row);
  if (todo.workflow === ORG_CLASSIFICATION_WORKFLOW) {
    if (!org.sectorId || isNeedsClassificationLabel(org.sector)) {
      markOrgNeedsClassification(org.row, org.id, org.name, 'Classification task was completed before a real Sector was set');
    } else {
      clearOrgNeedsClassification(org.row, org.id);
    }
  } else if (todo.workflow === 'People sourcing' || todo.workflow === 'Referral search') {
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
  if (todo.workflow === 'Market mapping' && todo.objType === 'Sector' && todo.objId) {
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
    case ORG_CLASSIFICATION_WORKFLOW:
      var classOrg = getOrgById(objId);
      if (classOrg && (!classOrg.sectorId || isNeedsClassificationLabel(classOrg.sector))) markOrgNeedsClassification(classOrg.row, classOrg.id, classOrg.name, 'Classification task skipped before a real Sector was set');
      break;
    case 'Org research':
      scheduleOrgReviewById(objId, { stampLastChecked: true });
      var org = getSheet('Organisations');
      if (org) flagLinkedRow(org, COLS.ORGS.ID, objId, COLS.ORGS.NOTES, '\u26a0 Research skipped — decide activation');
      break;
    case 'Application preparation':
    case 'Application blocker':
    case 'Submit application':
      var jobs = getSheet('Jobs');
      if (jobs) flagLinkedRow(jobs, COLS.JOBS.ID, objId, COLS.JOBS.NOTES, '\u26a0 Prep/submit skipped — Park or Close?');
      break;
    case 'Outreach':
    case 'Send outreach':
      var people = getSheet('People');
      if (people) flagLinkedRow(people, COLS.PEOPLE.ID, objId, COLS.PEOPLE.NOTES, '\u26a0 Outreach skipped - not contacted or closed?');
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
  if (objType === 'Job') { var j = getJobRowById(objId); return j && normalizeJobStatus(j.status) === 'Closed'; }
  if (objType === 'Organisation') { var o = getOrgById(objId); return o && ['Archived', 'Dormant'].indexOf(String(o.status)) !== -1; }
  if (objType === 'Person') {
    var p = getPersonRowById(objId);
    return p && (String(p.stage) === 'Closed' || String(p.notes || '').indexOf('[closed]') !== -1);
  }
  if (objType === 'Interview round') {
    var r = getRoundById(objId);
    return r && String(r.status) === 'Cancelled';
  }
  if (objType === 'Sector') {
    var s = getSectorBranchById(objId);
    return s && String(s.status) === 'Retired';
  }
  return false;
}

function handleCancelCascade(todoSheet, row) {
  var objType = String(todoSheet.getRange(row, COLS.TODO.OBJ_TYPE).getValue());
  var objId = String(todoSheet.getRange(row, COLS.TODO.OBJ_ID).getValue());
  var workflow = String(todoSheet.getRange(row, COLS.TODO.WORKFLOW).getValue());
  if (workflow === 'Org research' && objType === 'Organisation') scheduleOrgReviewById(objId, { stampLastChecked: true });
  if (!objId || isSourceObjectTerminal(objType, objId)) return; // parent already answers this — don't add noise
  switch (workflow) {
    case ORG_CLASSIFICATION_WORKFLOW:
      var classOrg = getOrgById(objId);
      if (classOrg && (!classOrg.sectorId || isNeedsClassificationLabel(classOrg.sector))) markOrgNeedsClassification(classOrg.row, classOrg.id, classOrg.name, 'Classification task cancelled before a real Sector was set');
      break;
    case 'Org research':
      var org = getSheet('Organisations'); if (org) flagLinkedRow(org, COLS.ORGS.ID, objId, COLS.ORGS.NOTES, '⚠ Task cancelled — decide activation'); break;
    case 'Application preparation': case 'Application blocker': case 'Submit application':
      var jobs = getSheet('Jobs'); if (jobs) flagLinkedRow(jobs, COLS.JOBS.ID, objId, COLS.JOBS.NOTES, '⚠ Task cancelled — Park or Close?'); break;
    case 'Outreach': case 'Send outreach':
      var people = getSheet('People'); if (people) flagLinkedRow(people, COLS.PEOPLE.ID, objId, COLS.PEOPLE.NOTES, '⚠ Task cancelled - not contacted or closed?'); break;
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
// JOBS - application-status routing
// Statuses: Not started / In progress / Submitted / Closed
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
function applicationPlanDecisionKey(jobId) {
  return 'JOB_PLAN:' + jobId + ':Application preparation';
}

function isApplicationPlanDecisionKey(key) {
  return String(key || '').indexOf('JOB_PLAN:') === 0;
}

function applicationPlanDueDate(job) {
  if (!job || !job.deadline) return '';
  var deadline = new Date(job.deadline);
  if (isNaN(deadline.getTime())) return '';
  return addDays(deadline, -1);
}

function applicationPlanDueText(job) {
  var planBy = applicationPlanDueDate(job);
  if (planBy) return 'Plan by: ' + formatDateHuman(planBy) + '. Deadline: ' + formatDateHuman(job.deadline) + '.';
  return 'No deadline set. Final submit task will stay undated until a deadline is added.';
}

function queueApplicationPlanDecision(job) {
  if (!job || !job.id) return '';
  var openWorkByJobId = openApplicationWorkByJobId();
  if (openWorkByJobId[String(job.id)]) return '';
  return appendPendingDecision(
    applicationPlanDecisionKey(job.id),
    'Application in progress: ' + job.title,
    'Plan application for ' + job.title + ' at ' + job.org,
    'Job',
    job.id,
    'Application preparation',
    applicationPlanDueText(job) + ' Yes opens the application planning form.'
  );
}

function createJobResponseOutcomeDecision(jobId, reason) {
  var job = getJobRowById(jobId);
  if (!job) return '';
  var status = normalizeJobStatus(job.status);
  if (status !== 'Submitted') return '';
  return appendPendingDecision('JOB_RESPONSE_OUTCOME:' + jobId, reason || 'Job response received: ' + job.title,
    'Record response outcome for ' + job.title + ' at ' + job.org, 'Job', jobId, 'Admin',
    'Choose the result on Jobs: waiting / interview invite / rejected.');
}

function isJobSubmittedForResponseTracking(jobId) {
  var job = getJobRowById(jobId);
  return !!job && normalizeJobStatus(job.status) === 'Submitted';
}

function recordJobWaitingForResponse(jobId, opts) {
  opts = opts || {};
  var job = getJobRowById(jobId);
  if (!job || normalizeJobStatus(job.status) !== 'Submitted') return false;
  var sheet = getSheet('Jobs');
  var baseDate = opts.baseDate ? parseDateOr(opts.baseDate) : today();
  var nextCheck = addDays(baseDate, 7);
  sheet.getRange(job.row, COLS.JOBS.RESPONSE).setValue('No');
  sheet.getRange(job.row, COLS.JOBS.OUTCOME).setValue('Waiting');
  sheet.getRange(job.row, COLS.JOBS.REVIEW_DATE).setValue(nextCheck);
  syncOpenJobResponseCheckDate(jobId, nextCheck);
  appendTodoOnceForWorkflow('Check response from ' + job.org + ' for ' + job.title, 'Job', jobId, job.org,
    'Check application response', 'Not started', nextCheck, '15 min', 'Still waiting as of ' + formatDateHuman(baseDate), opts.source || 'Auto-triggered');
  autoDismissPendingDecisionByKey('JOB_RESPONSE_OUTCOME:' + jobId, 'Waiting recorded on Jobs');
  return true;
}

function routeJobOutcome(jobId, outcome, opts) {
  opts = opts || {};
  var normalizedOutcome = normalizeJobOutcome(outcome);
  if (!jobId || !normalizedOutcome || normalizedOutcome === 'Waiting') return false;
  var job = getJobRowById(jobId);
  if (!job) return false;
  if (normalizedOutcome === 'Interview invite') {
    var inviteSheet = getSheet('Jobs');
    inviteSheet.getRange(job.row, COLS.JOBS.RESPONSE).setValue('Yes');
    inviteSheet.getRange(job.row, COLS.JOBS.OUTCOME).setValue('Interview invite');
    inviteSheet.getRange(job.row, COLS.JOBS.REVIEW_DATE).clearContent();
    appendNoteFlag(inviteSheet, job.row, COLS.JOBS.NOTES, '[interview-invite] Interview workflow opened.');
    setJobStatus(jobId, 'Submitted', { source: opts.source || 'job-outcome', realDate: opts.realDate || job.appliedDate || today() });
    autoDismissPendingForTarget('Job', jobId, 'Interview invite recorded');
    setOpenTodosForTarget('Job', jobId, 'Skipped', 'Interview invite received', ['Check application response']);
    if (!jobHasRounds(jobId) || opts.forceRound) createInterviewRoundForJob(jobId, opts);
    showInterviewsTab();
    return true;
  }
  if (normalizedOutcome === 'Rejected') {
    var sheet = getSheet('Jobs');
    sheet.getRange(job.row, COLS.JOBS.RESPONSE).setValue('Yes');
    sheet.getRange(job.row, COLS.JOBS.OUTCOME).setValue('Rejected');
    sheet.getRange(job.row, COLS.JOBS.REVIEW_DATE).clearContent();
    appendNoteFlag(sheet, job.row, COLS.JOBS.NOTES, '[rejected] Application closed after rejection.');
    setJobStatus(jobId, 'Closed', { source: opts.source || 'job-outcome' });
    return true;
  }
  return false;
}

function interviewOutcomeDecisionKey(roundId) {
  return 'INTERVIEW_OUTCOME:' + String(roundId || '');
}

function dismissInterviewOutcomeDecision(roundId, reason) {
  if (!roundId) return false;
  return autoDismissPendingDecisionByKey(interviewOutcomeDecisionKey(roundId), reason || 'Interview outcome recorded');
}

function ensureInterviewFollowUpTask(roundId) {
  var round = getRoundById(roundId);
  if (!round) return '';
  var sheet = getSheet('Interviews');
  var due = round.expectedResponse || '';
  if (!due && sheet) {
    var base = round.interviewDate || today();
    due = addDays(new Date(base), REPLY_DAYS_BY_ROUND_TYPE[String(round.roundType || 'Other')] || 7);
    sheet.getRange(round.row, COLS.ROUNDS.EXPECTED_RESPONSE).setValue(due);
  }
  var id = appendTodoOnceForWorkflow('Check interview outcome: ' + round.job + (round.org ? ' at ' + round.org : ''),
    'Interview round', roundId, round.org, 'Interview follow-up', 'Not started', due || '', '15 min',
    'Follow up or record the official outcome for round ' + (round.round || '?') + '.', 'Auto-triggered');
  updateOpenTodoDueForTargetWorkflow('Interview round', roundId, 'Interview follow-up', due || '');
  return id;
}

function routeInterviewOfficialOutcome(jobId, outcome, opts) {
  opts = opts || {};
  var job = getJobRowById(jobId);
  if (!job) return false;
  if (opts.roundId) dismissInterviewOutcomeDecision(opts.roundId, 'Outcome recorded: ' + outcome);
  if (outcome === 'Declined' || outcome === 'Rejected') {
    if (opts.roundId) setOpenTodosForTarget('Interview round', opts.roundId, 'Cancelled', 'Interview outcome recorded', ['Interview follow-up']);
    setJobStatus(jobId, 'Closed', { source: opts.source || 'round-outcome' });
    return true;
  }
  if (outcome === 'Offer') {
    setJobStatus(jobId, 'Submitted', { source: opts.source || 'round-outcome', realDate: opts.realDate || job.appliedDate || today() });
    autoDismissPendingForTarget('Job', jobId, 'Offer recorded');
    setOpenTodosForTarget('Job', jobId, 'Skipped', 'Offer received', ['Check application response', 'Interview follow-up']);
    if (opts.roundId) setOpenTodosForTarget('Interview round', opts.roundId, 'Skipped', 'Offer received', ['Interview follow-up']);
    appendTodoOnceForWorkflow('Decide on offer: ' + job.title + ' at ' + job.org, 'Job', jobId, job.org,
      'Offer decision', 'Not started', opts.realDate || '', '30 min', 'Offer decision/review.', 'Auto-triggered');
    return true;
  }
  if (outcome === 'Parked') {
    if (opts.roundId) setOpenTodosForTarget('Interview round', opts.roundId, 'Cancelled', 'Interview outcome parked', ['Interview follow-up']);
    setJobStatus(jobId, 'Closed', { source: opts.source || 'round-outcome' });
    return true;
  }
  return false;
}

function handleInterviewOfficialOutcome(roundId, outcome, opts) {
  opts = opts || {};
  var round = getRoundById(roundId);
  var sheet = getSheet('Interviews');
  if (!round || !sheet) return false;
  var normalized = String(outcome || '');
  if (normalized === 'Rejected') normalized = 'Declined';
  if (DROPDOWNS.OFFICIAL_OUTCOME.indexOf(normalized) === -1) return false;
  if (String(sheet.getRange(round.row, COLS.ROUNDS.STATUS).getValue() || '') !== 'Completed') {
    markInterviewRoundCompleted(roundId, { forceLog: true });
  }
  sheet.getRange(round.row, COLS.ROUNDS.OFFICIAL_OUTCOME).setValue(normalized);
  if (!opts.skipDecisionDismiss) dismissInterviewOutcomeDecision(roundId, 'Outcome recorded: ' + normalized);
  if (normalized === 'Waiting') {
    ensureInterviewFollowUpTask(roundId);
    syncOpenInterviewTaskDates(roundId);
    return true;
  }
  if (normalized === 'Next round') {
    setOpenTodosForTarget('Interview round', roundId, 'Skipped', 'Next round recorded', ['Interview follow-up']);
    createInterviewRoundForJob(round.jobId, { roundDetails: { roundNum: (parseInt(round.round, 10) || 1) + 1, notes: nextRoundKnownDetailsTemplate() } });
    return true;
  }
  return routeInterviewOfficialOutcome(round.jobId, normalized, {
    source: opts.source || 'round-outcome',
    roundId: roundId,
    realDate: opts.realDate || ''
  });
}

function fireJobStatusChanged(jobId, oldStatus, newStatus, opts) {
  opts = opts || {};
  var job = getJobRowById(jobId);
  if (!job) return;
  newStatus = normalizeJobStatus(newStatus);
  if (oldStatus !== undefined && oldStatus !== null && String(oldStatus) !== '' && normalizeJobStatus(oldStatus) === newStatus) return;
  var sheet = getSheet('Jobs');

  if (newStatus === 'Not started') {
    autoDismissPendingDecisionByKey(applicationPlanDecisionKey(jobId), 'Application is not in progress');
    clearNoteFlag(sheet, job.row, COLS.JOBS.NOTES, '[needs-application-plan]');
    sheet.getRange(job.row, COLS.JOBS.RESPONSE).clearContent();
    sheet.getRange(job.row, COLS.JOBS.OUTCOME).clearContent();
    sheet.getRange(job.row, COLS.JOBS.REVIEW_DATE).clearContent();
    setOpenTodosForTarget('Job', jobId, 'Skipped', 'Application is not submitted', ['Check application response']);
    return;
  }
  if (newStatus === 'In progress') {
    var decisionId = queueApplicationPlanDecision(job);
    if (decisionId) appendNoteFlag(sheet, job.row, COLS.JOBS.NOTES, '[needs-application-plan] Use Home decision to plan application tasks.');
    else clearNoteFlag(sheet, job.row, COLS.JOBS.NOTES, '[needs-application-plan]');
    sheet.getRange(job.row, COLS.JOBS.RESPONSE).clearContent();
    sheet.getRange(job.row, COLS.JOBS.OUTCOME).clearContent();
    sheet.getRange(job.row, COLS.JOBS.REVIEW_DATE).clearContent();
    setOpenTodosForTarget('Job', jobId, 'Skipped', 'Application is not submitted', ['Check application response']);
    return;
  }
  if (newStatus === 'Submitted') {
    var applied = opts.realDate ? parseDateOr(opts.realDate) : (job.appliedDate ? parseDateOr(job.appliedDate) : today());
    var review = addDays(applied, 12);
    sheet.getRange(job.row, COLS.JOBS.APPLIED_DATE).setValue(applied);
    sheet.getRange(job.row, COLS.JOBS.REVIEW_DATE).setValue(review);
    if (!sheet.getRange(job.row, COLS.JOBS.RESPONSE).getValue()) sheet.getRange(job.row, COLS.JOBS.RESPONSE).setValue('No');
    if (!sheet.getRange(job.row, COLS.JOBS.OUTCOME).getValue()) sheet.getRange(job.row, COLS.JOBS.OUTCOME).setValue('Waiting');
    autoDismissPendingForTarget('Job', jobId, 'Application submitted');
    clearNoteFlag(sheet, job.row, COLS.JOBS.NOTES, '[needs-application-plan]');
    setOpenTodosForTarget('Job', jobId, 'Skipped', 'Job already applied', ['Application preparation', 'Application blocker', 'Submit application']);
    appendTodoOnceForWorkflow('Check response from ' + job.org + ' for ' + job.title, 'Job', jobId, job.org,
      'Check application response', 'Not started', review, '15 min', 'Submitted on ' + formatDateHuman(applied), 'Auto-triggered');
    return;
  }

  if (newStatus === 'Closed') {
    autoDismissPendingForTarget('Job', jobId, 'Job closed');
    clearNoteFlag(sheet, job.row, COLS.JOBS.NOTES, '[needs-application-plan]');
    sheet.getRange(job.row, COLS.JOBS.REVIEW_DATE).clearContent();
    var closedOutcome = normalizeJobOutcome(sheet.getRange(job.row, COLS.JOBS.OUTCOME).getValue());
    if (!closedOutcome || closedOutcome === 'Waiting') {
      sheet.getRange(job.row, COLS.JOBS.RESPONSE).clearContent();
      sheet.getRange(job.row, COLS.JOBS.OUTCOME).clearContent();
    }
    setOpenTodosForTarget('Job', jobId, 'Cancelled', 'Job closed');
    cancelInterviewRoundWorkForJob(jobId, 'Job closed');
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
  }
  appendInteraction('', '', job.org, today(), 'Auto-log', 'Interview round created: ' + job.title + ' (Round ' + roundNum + ')', 'System log');
  return { id: id, row: newRow, created: true, roundNum: roundNum };
}

// =============================================================
// PEOPLE — stage routing
// Relationship status is the visible state machine for outreach and conversations.
// =============================================================

function movePersonStage(personId, stage, opts) {
  opts = opts || { source: 'cascade' };
  var person = getPersonRowById(personId);
  if (!person) return;
  var sheet = getSheet('People');
  var normalized = normalizePersonStage(stage);
  var old = sheet.getRange(person.row, COLS.PEOPLE.STAGE).getValue();
  if (normalizePersonStage(old) === normalized) {
    if (opts.realDate && (normalized === 'Conversation scheduled' || normalized === 'Conversation completed' || normalized === 'Keep warm')) {
      firePersonStageChanged(personId, '', normalized, opts);
    }
    return;
  }
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

// The single place Person outreach-stage transitions are handled.
//
// Identified is inert. To outreach starts drafting; later statuses record
// outreach, replies, scheduled/completed conversations, keep-warm, or close.
//
// action unambiguously — there's nothing left to ask.
function firePersonStageChanged(personId, oldStage, newStage, opts) {
  opts = opts || {};
  var person = getPersonRowById(personId);
  if (!person) return;
  var sheet = getSheet('People');
  newStage = normalizePersonStage(newStage);
  if (oldStage !== undefined && oldStage !== null && String(oldStage) !== '' && normalizePersonStage(oldStage) === newStage) return;

  if (newStage === 'Identified') return;
  if (newStage === 'To outreach') {
    appendTodoOnceForWorkflow('Draft outreach to ' + person.name + (person.org ? ' at ' + person.org : ''),
      'Person', personId, person.org, 'Outreach', 'Not started', '', '20 min',
      'When the draft is ready, tick this Task Done — it will create the send-outreach follow-up.', 'Auto-triggered');
    return;
  }
  if (newStage === 'Outreach drafted') {
    appendTodoOnceForWorkflow('Send outreach to ' + person.name + (person.org ? ' at ' + person.org : ''),
      'Person', personId, person.org, 'Send outreach', 'Not started', '', '15 min',
      'Draft prepared.', 'Auto-triggered');
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
  if (newStage === 'Replied') {
    sheet.getRange(person.row, COLS.PEOPLE.REPLY_RECEIVED).setValue('Yes');
    promoteOrgForLivePerson(person.orgId, newStage);
    appendTodoOnceForWorkflow('Reply and arrange conversation with ' + person.name + (person.org ? ' at ' + person.org : ''),
      'Person', personId, person.org, 'Reply and arrange conversation', 'Not started', '', '15 min',
      opts.notes || 'Reply received; decide whether to schedule, keep warm, or close.', 'Auto-triggered');
    return;
  }
  if (newStage === 'Conversation scheduled') {
    var scheduledDate = opts.realDate ? parseDateOr(opts.realDate) : sheet.getRange(person.row, COLS.PEOPLE.CONVERSATION_DATE).getValue();
    if (scheduledDate) {
      sheet.getRange(person.row, COLS.PEOPLE.CONVERSATION_DATE).setValue(scheduledDate);
      clearNoteFlag(sheet, person.row, COLS.PEOPLE.NOTES, '[missing-date]');
    } else {
      appendNoteFlag(sheet, person.row, COLS.PEOPLE.NOTES, '[missing-date] Add conversation date to create prep task.');
      promoteOrgForLivePerson(person.orgId, newStage);
      return;
    }
    promoteOrgForLivePerson(person.orgId, newStage);
    var prepDueDate = scheduledDate ? addDays(new Date(scheduledDate), -1) : '';
    appendTodoOnceForWorkflow('Prep conversation with ' + person.name + (person.org ? ' at ' + person.org : ''),
      'Person', personId, person.org, 'Conversation prep', 'Not started',
      prepDueDate, '30 min', conversationPrepNotes(), 'Auto-triggered');
    updateOpenTodoDueForTargetWorkflow('Person', personId, 'Conversation prep', prepDueDate);
    autoDismissPendingDecisionPrefixForTarget('PERSON_REPLY_OUTCOME:', 'Person', personId, 'Conversation scheduled');
    return;
  }
  if (newStage === 'Conversation completed') {
    var completedDate = opts.realDate ? parseDateOr(opts.realDate) : (sheet.getRange(person.row, COLS.PEOPLE.CONVERSATION_DATE).getValue() || today());
    sheet.getRange(person.row, COLS.PEOPLE.CONVERSATION_DATE).setValue(completedDate);
    promoteOrgForLivePerson(person.orgId, newStage);
    if (!opts.skipInteractionLog) appendInteraction(personId, person.name, person.org, completedDate, 'Auto-log', 'Conversation completed', 'System log');
    appendTodoOnceForWorkflow('Debrief / thank-you for ' + person.name + (person.org ? ' at ' + person.org : ''),
      'Person', personId, person.org, 'Thank-you and debrief', 'Not started', '', '20 min',
      conversationDebriefNotes(), 'Auto-triggered');
    autoDismissPendingDecisionPrefixForTarget('PERSON_REPLY_OUTCOME:', 'Person', personId, 'Conversation completed');
    return;
  }
  if (newStage === 'Keep warm') {
    var keepWarmDate = opts.realDate ? parseDateOr(opts.realDate) : (sheet.getRange(person.row, COLS.PEOPLE.FOLLOW_UP_DATE).getValue() || addDays(today(), 42));
    sheet.getRange(person.row, COLS.PEOPLE.FOLLOW_UP_DATE).setValue(keepWarmDate);
    sheet.getRange(person.row, COLS.PEOPLE.REPLY_RECEIVED).setValue('Yes');
    promoteOrgForLivePerson(person.orgId, newStage);
    autoDismissPendingDecisionPrefixForTarget('PERSON_REPLY_OUTCOME:', 'Person', personId, 'Keep-warm state recorded');
    return;
  }
  if (newStage === 'Closed') {
    sheet.getRange(person.row, COLS.PEOPLE.FOLLOW_UP_DATE).clearContent();
    sheet.getRange(person.row, COLS.PEOPLE.FOLLOW_UP_SENT).clearContent();
    autoDismissPendingForTarget('Person', personId, 'Person closed');
    setOpenTodosForTarget('Person', personId, 'Cancelled', 'Person closed');
  }
}

function routePersonReplyReceived(personId, opts) {
  movePersonStage(personId, 'Replied', opts || {});
}

function routePersonConversationScheduled(personId, dateValue) {
  movePersonStage(personId, 'Conversation scheduled', { realDate: dateValue });
}

function recordPersonConversationCompleted(personId, dateValue) {
  movePersonStage(personId, 'Conversation completed', { realDate: dateValue });
}

function routePersonConversationCancelled(personId) {
  var person = getPersonRowById(personId);
  if (!person) return;
  var sheet = getSheet('People');
  setOpenTodosForTarget('Person', personId, 'Cancelled', 'Conversation cancelled', ['Conversation prep']);
  if (normalizePersonStage(person.stage) === 'Conversation scheduled') {
    sheet.getRange(person.row, COLS.PEOPLE.STAGE).setValue('Replied');
    appendNoteFlag(sheet, person.row, COLS.PEOPLE.NOTES, '[conversation-cancelled] Conversation cancelled; arrange a new time, keep warm, or close.');
    appendTodoOnceForWorkflow('Reschedule conversation with ' + person.name + (person.org ? ' at ' + person.org : ''),
      'Person', personId, person.org, 'Reschedule conversation', 'Not started', '', '15 min',
      'Conversation was cancelled. Arrange a new time, keep warm, or close.', 'Auto-triggered');
  }
}

function setPersonKeepWarm(personId) {
  movePersonStage(personId, 'Keep warm', {});
}

function closePerson(personId, reason) {
  var person = getPersonRowById(personId);
  if (!person) return;
  var sheet = getSheet('People');
  if (reason) appendNoteFlag(sheet, person.row, COLS.PEOPLE.NOTES, '[closed-note] ' + reason);
  movePersonStage(personId, 'Closed', {});
}

// =============================================================
// ORGANISATIONS & SECTORS — taxonomy + the corrected 3-stage sector model
//
// AGREED MODEL (identical whether triggered by direct sheet edit or by
// an onboarding/capture popup — both paths call the exact same two
// functions below, so there is only one place this logic can drift):
//
//   1. Sector-only row (Sub-sector blank)
//        -> direct Task: "Add 2-4 sub-sector rows"
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
  var sector = String(row[COLS.SECTORS.SECTOR - 1] || '');
  var subsector = String(row[COLS.SECTORS.SUBSECTOR - 1] || '');
  var sectorId = String(row[COLS.SECTORS.ID - 1] || '');
  var subsectorId = String(row[COLS.SECTORS.SUBSECTOR_ID - 1] || '');
  var hasSubsectorIdentity = String(subsectorId || '').indexOf('SUB-') === 0;
  var isSectorOnly = !subsector && !hasSubsectorIdentity;
  return {
    row: rowNumber,
    id: isSectorOnly ? sectorId : subsectorId,
    sectorId: sectorId,
    subsectorId: subsectorId,
    sector: sector,
    subsector: subsector,
    status: normalizeSectorStatus(row[COLS.SECTORS.STATUS - 1]),
    created: false,
    isSectorOnly: isSectorOnly
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
    var branch = sectorBranchFromRow(i + 2, data[i]);
    if (wantSectorOnly && !branch.isSectorOnly) continue;
    if (!wantSectorOnly && branch.isSectorOnly) continue;
    var rowSector = normalizeKeyPart(data[i][COLS.SECTORS.SECTOR - 1]);
    var rowSub = normalizeKeyPart(data[i][COLS.SECTORS.SUBSECTOR - 1]);
    if (!rowSector) continue;
    if (!wantSectorOnly && !rowSub) continue;
    var sectorScore = rowSector === wantSector ? 1 : similarity(wantSector, rowSector);
    var subScore = wantSectorOnly ? 1 : (rowSub === wantSub ? 1 : similarity(wantSub, rowSub));
    var score = Math.min(sectorScore, subScore);
    if (score > bestScore) {
      bestScore = score;
      best = branch;
    }
  }
  return bestScore >= 0.85 ? best : null;
}

function getSectorBranchById(sectorId) {
  var sheet = getSheet('Sectors');
  if (!sheet || sheet.getLastRow() < 2 || !sectorId) return null;
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS.Sectors.length).getValues();
  for (var i = 0; i < data.length; i++) {
    var branch = sectorBranchFromRow(i + 2, data[i]);
    if (String(branch.id) === String(sectorId)) return branch;
  }
  return null;
}

function buildSectorBranchIndexes() {
  var out = { byId: {}, bySectorOnly: {}, bySectorSub: {} };
  var sheet = getSheet('Sectors');
  if (!sheet || sheet.getLastRow() < 2) return out;
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS.Sectors.length).getValues();
  for (var i = 0; i < data.length; i++) {
    var branch = sectorBranchFromRow(i + 2, data[i]);
    if (branch.id) out.byId[String(branch.id)] = branch;
    var sectorKey = normalizeKeyPart(branch.sector);
    var subKey = normalizeKeyPart(branch.subsector);
    if (branch.isSectorOnly && sectorKey) out.bySectorOnly[sectorKey] = branch;
    if (!branch.isSectorOnly && sectorKey && subKey) out.bySectorSub[sectorKey + '|' + subKey] = branch;
  }
  return out;
}

function ensureSectorOnlyBranch(sector, source) {
  sector = String(sector || '').trim().replace(/\s+/g, ' ');
  if (!sector) return null;
  var sheet = getSheet('Sectors');
  if (!sheet) return null;
  var existing = findSectorBranch(sector, '');
  if (existing) return ensureSectorBranchId(sheet, existing);

  var rowValues = new Array(HEADERS.Sectors.length).fill('');
  rowValues[COLS.SECTORS.ID - 1] = nextId(sheet, COLS.SECTORS.ID, 'SEC');
  rowValues[COLS.SECTORS.SECTOR - 1] = sector;
  rowValues[COLS.SECTORS.STATUS - 1] = 'Open';
  sheet.appendRow(rowValues);
  var branch = sectorBranchFromRow(sheet.getLastRow(), rowValues);
  branch.created = true;
  var sourceFlag = sectorSourceFlag(source);
  if (sourceFlag) appendNoteFlag(sheet, branch.row, COLS.SECTORS.NOTES, sourceFlag);
  return branch;
}

function ensureSectorOnlyBranchWithId(sector, sectorId, source) {
  sector = String(sector || '').trim().replace(/\s+/g, ' ');
  sectorId = String(sectorId || '');
  if (!sector || sectorId.indexOf('SEC-') !== 0) return ensureSectorOnlyBranch(sector, source);
  var sheet = getSheet('Sectors');
  if (!sheet) return null;
  if (sheet.getLastRow() >= 2) {
    var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS.Sectors.length).getValues();
    for (var i = 0; i < data.length; i++) {
      var branch = sectorBranchFromRow(i + 2, data[i]);
      if (branch.isSectorOnly && String(branch.sectorId) === sectorId) return branch;
    }
  }
  var rowValues = new Array(HEADERS.Sectors.length).fill('');
  rowValues[COLS.SECTORS.ID - 1] = sectorId;
  rowValues[COLS.SECTORS.SECTOR - 1] = sector;
  rowValues[COLS.SECTORS.STATUS - 1] = 'Open';
  sheet.appendRow(rowValues);
  var created = sectorBranchFromRow(sheet.getLastRow(), rowValues);
  created.created = true;
  var sourceFlag = sectorSourceFlag(source);
  if (sourceFlag) appendNoteFlag(sheet, created.row, COLS.SECTORS.NOTES, sourceFlag);
  return created;
}

function ensureSectorBranchId(sheet, branch) {
  if (!sheet || !branch) return branch;
  var wasCreated = !!branch.created;
  if (branch.isSectorOnly) {
    if (String(branch.sectorId || '').indexOf('SEC-') !== 0) {
      branch.sectorId = nextId(sheet, COLS.SECTORS.ID, 'SEC');
      sheet.getRange(branch.row, COLS.SECTORS.ID).setValue(branch.sectorId);
    }
    if (branch.subsectorId) {
      branch.subsectorId = '';
      sheet.getRange(branch.row, COLS.SECTORS.SUBSECTOR_ID).setValue('');
    }
    branch.id = branch.sectorId;
    branch.created = wasCreated || !!branch.created;
    return branch;
  }

  var parent = ensureSectorOnlyBranch(branch.sector, 'repair_backfill');
  branch.parentBranch = parent;
  branch.parentSectorCreated = !!(parent && parent.created);
  if (parent && branch.sectorId !== parent.sectorId) {
    branch.sectorId = parent.sectorId;
    sheet.getRange(branch.row, COLS.SECTORS.ID).setValue(branch.sectorId);
  }
  if (String(branch.subsectorId || '').indexOf('SUB-') !== 0) {
    branch.subsectorId = nextId(sheet, COLS.SECTORS.SUBSECTOR_ID, 'SUB');
    sheet.getRange(branch.row, COLS.SECTORS.SUBSECTOR_ID).setValue(branch.subsectorId);
  }
  branch.id = branch.subsectorId;
  branch.created = wasCreated || !!branch.created;
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
    var sectorOnly = isSectorOnly ? null : (opts.parentSectorId ? ensureSectorOnlyBranchWithId(sector, opts.parentSectorId, opts.source) : ensureSectorOnlyBranch(sector, opts.source));
    var rowValues = new Array(HEADERS.Sectors.length).fill('');
    rowValues[COLS.SECTORS.ID - 1] = isSectorOnly ? nextId(sheet, COLS.SECTORS.ID, 'SEC') : (sectorOnly ? sectorOnly.sectorId : nextId(sheet, COLS.SECTORS.ID, 'SEC'));
    rowValues[COLS.SECTORS.SUBSECTOR_ID - 1] = isSectorOnly ? '' : nextId(sheet, COLS.SECTORS.SUBSECTOR_ID, 'SUB');
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
    if (!isSectorOnly && sectorOnly && sectorOnly.created) branch.parentSectorCreated = true;
    if (!isSectorOnly && sectorOnly) branch.parentBranch = sectorOnly;
  }
  var parentCreatedBeforeEnsure = !!(branch && branch.parentSectorCreated);
  var parentBranchBeforeEnsure = branch && branch.parentBranch;
  branch = ensureSectorBranchId(sheet, branch);
  if (parentCreatedBeforeEnsure) {
    branch.parentSectorCreated = true;
    branch.parentBranch = parentBranchBeforeEnsure;
  }
  if (!sheet.getRange(branch.row, COLS.SECTORS.STATUS).getValue()) sheet.getRange(branch.row, COLS.SECTORS.STATUS).setValue('Open');
  if (!branch.sector) sheet.getRange(branch.row, COLS.SECTORS.SECTOR).setValue(sector);
  if (!branch.isSectorOnly && !branch.subsector) sheet.getRange(branch.row, COLS.SECTORS.SUBSECTOR).setValue(subsector);
  flagDuplicateSectorNameForReview(branch);
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
  sector = String(sector || '').trim().replace(/\s+/g, ' ');
  subsector = String(subsector || '').trim().replace(/\s+/g, ' ');
  var orgId = sheet.getRange(orgRow, COLS.ORGS.ID).getValue();
  var orgName = sheet.getRange(orgRow, COLS.ORGS.NAME).getValue();
  if (isNeedsClassificationLabel(sector)) {
    markOrgNeedsClassification(orgRow, orgId, orgName, subsector ? 'Choose Sector before Sub-sector can be linked' : '');
    return null;
  }
  if (!sector && !subsector) {
    markOrgNeedsClassification(orgRow, orgId, orgName);
    return null;
  }
  if (!sector && subsector) {
    markOrgNeedsClassification(orgRow, orgId, orgName, 'Choose Sector before Sub-sector can be linked');
    return null;
  }
  if (sector && !subsector) {
    var sectorOnly = upsertSectorBranch({ sector: sector, source: 'organisation_link', sourceObjectType: 'Organisation', createExpansionDecision: false });
    if (sectorOnly) sheet.getRange(orgRow, COLS.ORGS.SECTOR).setValue(sectorOnly.sector);
    sheet.getRange(orgRow, COLS.ORGS.SECTOR_ID).setValue(sectorOnly ? sectorOnly.sectorId : '');
    sheet.getRange(orgRow, COLS.ORGS.SUBSECTOR).setValue('');
    sheet.getRange(orgRow, COLS.ORGS.SUBSECTOR_ID).setValue('');
    if (sectorOnly) clearOrgNeedsClassification(orgRow, orgId);
    return sectorOnly;
  }
  if (!sector || !subsector) return null;
  var sub = upsertSectorBranch({ sector: sector, subsector: subsector, source: 'organisation_link', sourceObjectType: 'Organisation', createExpansionDecision: true });
  if (!sub) return null;
  sheet.getRange(orgRow, COLS.ORGS.SECTOR_ID).setValue(sub.sectorId);
  sheet.getRange(orgRow, COLS.ORGS.SECTOR).setValue(sub.sector);
  sheet.getRange(orgRow, COLS.ORGS.SUBSECTOR_ID).setValue(sub.id);
  sheet.getRange(orgRow, COLS.ORGS.SUBSECTOR).setValue(sub.subsector);
  clearOrgNeedsClassification(orgRow, orgId);
  return sub;
}

function repairOrgTaxonomyLinks() {
  var sheet = getSheet('Organisations');
  if (!sheet || sheet.getLastRow() < 2) return;
  var sectorIndex = buildSectorBranchIndexes();
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS.Organisations.length).getValues();
  for (var i = 0; i < data.length; i++) {
    var row = i + 2;
    var orgId = data[i][COLS.ORGS.ID - 1];
    var orgName = data[i][COLS.ORGS.NAME - 1];
    if (!orgId || !orgName) continue;
    var sector = data[i][COLS.ORGS.SECTOR - 1];
    var sub = data[i][COLS.ORGS.SUBSECTOR - 1];
    var sectorId = data[i][COLS.ORGS.SECTOR_ID - 1];
    var subId = data[i][COLS.ORGS.SUBSECTOR_ID - 1];
    if (subId) {
      var subBranch = sectorIndex.byId[String(subId)];
      if (subBranch) {
        sheet.getRange(row, COLS.ORGS.SECTOR_ID).setValue(subBranch.sectorId);
        sheet.getRange(row, COLS.ORGS.SECTOR).setValue(subBranch.sector);
        sheet.getRange(row, COLS.ORGS.SUBSECTOR_ID).setValue(subBranch.subsectorId);
        sheet.getRange(row, COLS.ORGS.SUBSECTOR).setValue(subBranch.subsector);
        clearOrgNeedsClassification(row, orgId);
        continue;
      }
    }
    if (sectorId) {
      var sectorBranch = sectorIndex.byId[String(sectorId)];
      if (sectorBranch && sectorBranch.isSectorOnly) {
        sheet.getRange(row, COLS.ORGS.SECTOR).setValue(sectorBranch.sector);
        if (sub && !subId) sheet.getRange(row, COLS.ORGS.SUBSECTOR).setValue('');
        sheet.getRange(row, COLS.ORGS.SUBSECTOR_ID).setValue('');
        clearOrgNeedsClassification(row, orgId);
        continue;
      }
    }
    if (!sectorId || isNeedsClassificationLabel(sector)) {
      applyOrgTaxonomyLink(row, sector, sub);
    } else if (sector && (!sectorId || (sub && !subId))) {
      applyOrgTaxonomyLink(row, sector, sub);
    }
  }
}

// v7.1: manual sheet entry now defers the job/person cascade until the
// row has an Organisation, instead of firing immediately with blank org
// context. See onEditJobs / onEditPeople below. Organisation creation
// itself is unaffected — an Organisation row never needed a second
// anchor field.
function onEditOrgs(sheet, row, col, newVal, e) {
  if (col === COLS.ORGS.NAME && !newVal) {
    var existingOrgId = sheet.getRange(row, COLS.ORGS.ID).getValue();
    if (existingOrgId) {
      if (e && e.oldValue) sheet.getRange(row, COLS.ORGS.NAME).setValue(e.oldValue);
      appendNoteFlag(sheet, row, COLS.ORGS.NOTES, '[name-required] Organisation name kept because linked rows use the Org ID');
      SpreadsheetApp.getActiveSpreadsheet().toast('Organisation name is required for linked rows. Archive the org instead of blanking it.', 'The Planner', 5);
    }
    return;
  }
  if (col === COLS.ORGS.NAME && newVal) {
    var oldOrgName = e && e.oldValue ? String(e.oldValue) : '';
    checkOrgDuplicate(sheet, row);
    var idCell = sheet.getRange(row, COLS.ORGS.ID);
    if (!idCell.getValue()) idCell.setValue(nextId(sheet, COLS.ORGS.ID, 'ORG'));
    var orgId = idCell.getValue();
    var finalOrgName = sheet.getRange(row, COLS.ORGS.NAME).getValue();
    if (!sheet.getRange(row, COLS.ORGS.TIER).getValue()) sheet.getRange(row, COLS.ORGS.TIER).setValue('B');
    // Default is Mapped — never Active — so creation alone never floods
    // the queue. Active is only ever set explicitly.
    if (!sheet.getRange(row, COLS.ORGS.STATUS).getValue()) sheet.getRange(row, COLS.ORGS.STATUS).setValue('Mapped');
    sheet.getRange(row, COLS.ORGS.LAST_CHECKED).setValue(today());
    applyOrgRowFormulas(sheet, row);
    propagateOrganisationRename(orgId, finalOrgName, oldOrgName);
    var sector = sheet.getRange(row, COLS.ORGS.SECTOR).getValue();
    var sub = sheet.getRange(row, COLS.ORGS.SUBSECTOR).getValue();
    var linkedBranch = applyOrgTaxonomyLink(row, sector, sub);
    if (linkedBranch && !linkedBranch.isSectorOnly) {
      renderTodayDecisionCards();
      requestHomeRefresh();
    }
    refreshDerivedPlanningSurfaces();
    requestHomeRefresh();
    return;
  }
  if (col === COLS.ORGS.SECTOR || col === COLS.ORGS.SUBSECTOR) {
    var editedSector = sheet.getRange(row, COLS.ORGS.SECTOR).getValue();
    var editedSubsector = sheet.getRange(row, COLS.ORGS.SUBSECTOR).getValue();
    if (col === COLS.ORGS.SECTOR && editedSector && editedSubsector && !isNeedsClassificationLabel(editedSector) && !findSectorBranch(editedSector, editedSubsector)) {
      sheet.getRange(row, COLS.ORGS.SUBSECTOR_ID).setValue('');
      sheet.getRange(row, COLS.ORGS.SUBSECTOR).setValue('');
      appendNoteFlag(sheet, row, COLS.ORGS.NOTES, '[taxonomy] Sub-sector cleared because Sector changed');
      editedSubsector = '';
    }
    var taxonomyBranch = applyOrgTaxonomyLink(row, editedSector, editedSubsector);
    if (taxonomyBranch && !taxonomyBranch.isSectorOnly) {
      renderTodayDecisionCards();
      requestHomeRefresh();
    }
    refreshDerivedPlanningSurfaces();
    requestHomeRefresh();
    return;
  }
  if (col === COLS.ORGS.TIER) {
    sheet.getRange(row, COLS.ORGS.TIER).setValue(normalizeTier(newVal));
    refreshDerivedPlanningSurfaces();
    requestHomeRefresh();
    return;
  }
  if (col === COLS.ORGS.STATUS) {
    var orgId = sheet.getRange(row, COLS.ORGS.ID).getValue();
    var orgName = sheet.getRange(row, COLS.ORGS.NAME).getValue();
    var status = normalizeOrgStatus(newVal);
    if (status !== String(newVal || '')) sheet.getRange(row, COLS.ORGS.STATUS).setValue(status);
    clearNoteFlag(sheet, row, COLS.ORGS.NOTES, '[review-routed]');
    if (status !== 'Dormant') clearNoteFlag(sheet, row, COLS.ORGS.NOTES, '[dormant-live]');
    if (status !== 'Active') clearNoteFlag(sheet, row, COLS.ORGS.NOTES, '[active-empty]');
    if (status === 'Archived') clearOrgRoutingFlags(sheet, row);
    scheduleOrgReviewForRow(sheet, row, status, { stampLastChecked: true });
    if (status === 'Active') {
      ensureOrgClassificationState(row);
      fireOrgActiveCascade(orgId, orgName);
      renderTodayDecisionCards();
      refreshDerivedPlanningSurfaces();
      requestHomeRefresh();
    }
    if (status === 'Mapped') {
      ensureOrgClassificationState(row);
      refreshDerivedPlanningSurfaces();
      requestHomeRefresh();
    }
    if (status === 'Dormant') {
      autoDismissPendingForTarget('Organisation', orgId, 'Organisation marked Dormant');
      setOpenTodosForTarget('Organisation', orgId, 'Skipped', 'Organisation parked/dormant');
      refreshDerivedPlanningSurfaces();
      requestHomeRefresh();
    }
    if (status === 'Archived') {
      autoDismissPendingForTarget('Organisation', orgId, 'Organisation archived');
      setOpenTodosForTarget('Organisation', orgId, 'Cancelled', 'Organisation archived');
      refreshDerivedPlanningSurfaces();
      requestHomeRefresh();
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

// Stage 1: fires the direct "add sub-sector rows" Task. Deduplicated by
// task text + target so re-editing the same Sector row (or capturing
// it again via onboarding) never creates a second copy. Accepts either
// a sector name (creates/finds the sector-only branch) or an
// already-resolved branch object (avoids a redundant upsert when the
// caller already has one, e.g. onEditSectors).
function fireSectorOnlyTask(sector) {
  var branch = (typeof sector === 'object') ? sector : upsertSectorBranch({ sector: sector, source: 'manual_sheet_entry', createExpansionDecision: false });
  if (!branch) return '';
  var linkedTaskText = 'Add 2-4 sub-sector rows for ' + branch.sector;
  return appendTodoOnceForWorkflow(linkedTaskText, 'Sector', branch.id, '', 'Sector selection', 'Not started', '', '20 min',
    'Open Sectors from this task. Add one row per sub-sector: keep Sector = ' + branch.sector + ', fill Sub-sector with the narrower area. Each sub-sector can then become a market-map decision.', 'Auto-triggered');
}

// Stage 2/3: fired when upsertSectorBranch creates a real sub-sector row.
// Organisations.Sector ID points to the SEC-* parent, and
// Organisations.Sub-sector ID points to the SUB-* child. This raises the "build an org list here?" Decision. Yes
// on that Decision is what creates the Market-map Task (see
// acceptPendingDecision -> appendTodoWithSource, workflow 'Market
// mapping'); No creates nothing.
function fireSubsectorAddedDecision(sector, subsector, subsectorId, opts) {
  opts = opts || {};
  var expansionLabel = sector + ' - ' + subsector;
  var expansionKey = 'EXPAND_SUBSECTOR:' + subsectorId;
  if (!opts.allowAfterResolved && findDecisionByKey(expansionKey)) return '';
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
    var statusBranch = sectorBranchFromRow(row, sheet.getRange(row, 1, 1, HEADERS.Sectors.length).getValues()[0]);
    if (normalizedSectorStatus === 'Retired') retireSectorBranch(statusBranch.id);
    return;
  }
  if (col === COLS.SECTORS.SECTOR || col === COLS.SECTORS.SUBSECTOR) {
    var sectorValue = sheet.getRange(row, COLS.SECTORS.SECTOR).getValue();
    var subsectorValue = sheet.getRange(row, COLS.SECTORS.SUBSECTOR).getValue();
    if (!sectorValue && subsectorValue) { appendNoteFlag(sheet, row, COLS.SECTORS.NOTES, '[taxonomy] Add Sector before Sub-sector'); return; }
    if (!sectorValue) return;
    var currentBranch = sectorBranchFromRow(row, sheet.getRange(row, 1, 1, HEADERS.Sectors.length).getValues()[0]);
    var wasSectorOnlyRow = String(currentBranch.sectorId || '').indexOf('SEC-') === 0 && !currentBranch.subsectorId;
    if (col === COLS.SECTORS.SUBSECTOR && wasSectorOnlyRow && subsectorValue) {
      var childBranch = upsertSectorBranch({ sector: sectorValue, subsector: subsectorValue, source: 'manual_sheet_entry', parentSectorId: currentBranch.sectorId, createExpansionDecision: true });
      sheet.getRange(row, COLS.SECTORS.SUBSECTOR).clearContent();
      sheet.getRange(row, COLS.SECTORS.SUBSECTOR_ID).clearContent();
      appendNoteFlag(sheet, row, COLS.SECTORS.NOTES, '[taxonomy] Sub-sector moved to child row ' + (childBranch ? childBranch.row : ''));
      if (childBranch && childBranch.parentBranch && childBranch.parentBranch.created && fireSectorOnlyTask(childBranch.parentBranch)) refreshDerivedPlanningSurfaces();
      renderTodayDecisionCards();
      requestHomeRefresh();
      return;
    }
    var existingId = String(currentBranch.id || '');
    if (existingId) {
      currentBranch = ensureSectorBranchId(sheet, currentBranch);
      var parentCreatedByMove = !!(currentBranch && currentBranch.parentSectorCreated);
      var parentBranchForMove = currentBranch && currentBranch.parentBranch;
      existingId = String(currentBranch.id || '');
      if (!sheet.getRange(row, COLS.SECTORS.STATUS).getValue()) sheet.getRange(row, COLS.SECTORS.STATUS).setValue('Open');
      propagateSectorRenameToOrganisations(existingId);
      currentBranch = getSectorBranchById(existingId);
      flagDuplicateSectorNameForReview(currentBranch);
      var labelUpdates = syncSectorLinkedLabels(currentBranch);
      if (labelUpdates) {
        populateToday();
        renderTodayDecisionCards();
        requestHomeRefresh();
      }
      if (currentBranch && currentBranch.isSectorOnly) {
        if (fireSectorOnlyTask(getSectorBranchById(existingId))) {
          refreshDerivedPlanningSurfaces();
          requestHomeRefresh();
        }
      } else if (!subsectorValue) {
        appendNoteFlag(sheet, row, COLS.SECTORS.NOTES, '[taxonomy] Add Sub-sector name before this child can be used');
        renderTodayDecisionCards();
        requestHomeRefresh();
      } else {
        clearNoteFlag(sheet, row, COLS.SECTORS.NOTES, '[taxonomy]');
        if (parentCreatedByMove && parentBranchForMove && fireSectorOnlyTask(parentBranchForMove)) {
          refreshDerivedPlanningSurfaces();
          requestHomeRefresh();
        }
        if (fireSubsectorAddedDecision(sectorValue, subsectorValue, existingId)) {
          renderTodayDecisionCards();
          requestHomeRefresh();
        }
      }
      return;
    }
    var branch = upsertSectorBranch({ sector: sectorValue, subsector: subsectorValue, source: 'manual_sheet_entry', preferredRow: row, parentSectorId: currentBranch.sectorId, createExpansionDecision: !!subsectorValue });
    if (!branch) return;
    if (branch.row !== row) {
      sheet.getRange(row, 1, 1, HEADERS.Sectors.length).clearContent();
      SpreadsheetApp.getActiveSpreadsheet().toast('Merged duplicate Sectors entry into row ' + branch.row + '.', 'The Planner', 4);
      return;
    }
    if (!subsectorValue) {
      flagDuplicateSectorNameForReview(branch);
      if (fireSectorOnlyTask(branch)) {
        refreshDerivedPlanningSurfaces();
        requestHomeRefresh();
      }
    } else {
      flagDuplicateSectorNameForReview(branch);
      if (branch.parentSectorCreated && branch.parentBranch && fireSectorOnlyTask(branch.parentBranch)) {
        refreshDerivedPlanningSurfaces();
        requestHomeRefresh();
      }
      renderTodayDecisionCards();
      requestHomeRefresh();
    }
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
  if (!branch) return 0;
  var sectorSheet = getSheet('Sectors');
  var count = 0;
  if (branch.isSectorOnly && sectorSheet && sectorSheet.getLastRow() >= 2) {
    var sectorData = sectorSheet.getRange(2, 1, sectorSheet.getLastRow() - 1, HEADERS.Sectors.length).getValues();
    for (var s = 0; s < sectorData.length; s++) {
      var child = sectorBranchFromRow(s + 2, sectorData[s]);
      if (child.isSectorOnly || String(child.sectorId) !== String(branch.sectorId)) continue;
      sectorSheet.getRange(child.row, COLS.SECTORS.SECTOR).setValue(branch.sector);
      count++;
    }
  }
  if (orgSheet && orgSheet.getLastRow() >= 2) {
    var data = orgSheet.getRange(2, 1, orgSheet.getLastRow() - 1, HEADERS.Organisations.length).getValues();
    for (var i = 0; i < data.length; i++) {
      var r = i + 2;
      if (branch.isSectorOnly) {
        if (String(data[i][COLS.ORGS.SECTOR_ID - 1]) !== String(branch.sectorId)) continue;
        orgSheet.getRange(r, COLS.ORGS.SECTOR).setValue(branch.sector);
      } else {
        if (String(data[i][COLS.ORGS.SUBSECTOR_ID - 1]) !== String(branch.subsectorId)) continue;
        orgSheet.getRange(r, COLS.ORGS.SECTOR_ID).setValue(branch.sectorId);
        orgSheet.getRange(r, COLS.ORGS.SECTOR).setValue(branch.sector);
        orgSheet.getRange(r, COLS.ORGS.SUBSECTOR_ID).setValue(branch.subsectorId);
        orgSheet.getRange(r, COLS.ORGS.SUBSECTOR).setValue(branch.subsector);
      }
      clearNoteFlag(orgSheet, r, COLS.ORGS.NOTES, '[orphaned-sector]');
      count++;
    }
  }
  return count;
}

function flagDuplicateSectorNameForReview(branch) {
  var sheet = getSheet('Sectors');
  if (!sheet || !branch || !branch.sector || sheet.getLastRow() < 2) return false;
  var wanted = normalizeKeyPart(branch.sector);
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS.Sectors.length).getValues();
  var duplicate = false;
  for (var i = 0; i < data.length; i++) {
    var candidate = sectorBranchFromRow(i + 2, data[i]);
    if (!candidate.isSectorOnly) continue;
    if (String(candidate.sectorId) === String(branch.sectorId)) continue;
    if (normalizeKeyPart(candidate.sector) === wanted) {
      duplicate = true;
      break;
    }
  }
  var flag = '[review-sector-name] Same Sector name used by another Sector ID';
  if (duplicate) appendNoteFlag(sheet, branch.row, COLS.SECTORS.NOTES, flag);
  else clearNoteFlag(sheet, branch.row, COLS.SECTORS.NOTES, flag);
  return duplicate;
}

function syncSectorLinkedLabels(branch) {
  if (!branch) return 0;
  var branches = [branch];
  var sectorSheet = getSheet('Sectors');
  if (branch.isSectorOnly && sectorSheet && sectorSheet.getLastRow() >= 2) {
    var sectorData = sectorSheet.getRange(2, 1, sectorSheet.getLastRow() - 1, HEADERS.Sectors.length).getValues();
    for (var s = 0; s < sectorData.length; s++) {
      var child = sectorBranchFromRow(s + 2, sectorData[s]);
      if (child.isSectorOnly || String(child.sectorId) !== String(branch.sectorId)) continue;
      branches.push(child);
    }
  }
  var count = 0;
  for (var b = 0; b < branches.length; b++) count += syncSingleSectorLinkedLabel(branches[b]);
  return count;
}

function syncSingleSectorLinkedLabel(branch) {
  if (!branch || !branch.id) return 0;
  var count = 0;
  var taskSheet = getSheet('Tasks');
  if (taskSheet && taskSheet.getLastRow() >= 2) {
    var taskData = taskSheet.getRange(2, 1, taskSheet.getLastRow() - 1, HEADERS['To-do'].length).getValues();
    for (var t = 0; t < taskData.length; t++) {
      if (String(taskData[t][COLS.TODO.OBJ_TYPE - 1]) !== 'Sector') continue;
      if (String(taskData[t][COLS.TODO.OBJ_ID - 1]) !== String(branch.id)) continue;
      if (isTerminalTodoStatus(String(taskData[t][COLS.TODO.STATUS - 1]))) continue;
      writeLinkedTo(taskSheet, t + 2, 'Sector', branch.id);
      var workflow = String(taskData[t][COLS.TODO.WORKFLOW - 1] || '');
      var desiredTask = '';
      if (branch.isSectorOnly && workflow === 'Sector selection') desiredTask = 'Add 2-4 sub-sector rows for ' + branch.sector;
      if (!branch.isSectorOnly && workflow === 'Market mapping' && branch.subsector) desiredTask = 'Market map: ' + branch.sector + ' - ' + branch.subsector;
      if (desiredTask && String(taskData[t][COLS.TODO.TASK - 1]) !== desiredTask) {
        taskSheet.getRange(t + 2, COLS.TODO.TASK).setValue(desiredTask);
        count++;
      }
    }
  }
  var decisionSheet = getSheet('Decisions');
  if (!branch.isSectorOnly && branch.subsector && decisionSheet && decisionSheet.getLastRow() >= 2) {
    var label = branch.sector + ' - ' + branch.subsector;
    var decisionData = decisionSheet.getRange(2, 1, decisionSheet.getLastRow() - 1, HEADERS['Pending decisions'].length).getValues();
    for (var d = 0; d < decisionData.length; d++) {
      if (String(decisionData[d][COLS.DECISIONS.TARGET_TYPE - 1]) !== 'Sector') continue;
      if (String(decisionData[d][COLS.DECISIONS.TARGET_ID - 1]) !== String(branch.id)) continue;
      if (String(decisionData[d][COLS.DECISIONS.DECISION - 1]) !== 'Pending') continue;
      if (String(decisionData[d][COLS.DECISIONS.WORKFLOW - 1]) !== 'Market mapping') continue;
      var row = d + 2;
      decisionSheet.getRange(row, COLS.DECISIONS.TRIGGER).setValue('Sub-sector added: ' + label);
      decisionSheet.getRange(row, COLS.DECISIONS.TASK).setValue('Market map: ' + label);
      count++;
    }
  }
  return count;
}

function retireSectorBranch(sectorId) {
  if (!sectorId) return 0;
  var branch = getSectorBranchById(sectorId);
  var targetIds = [String(sectorId)];
  var sectorSheet = getSheet('Sectors');
  if (branch && branch.isSectorOnly && sectorSheet && sectorSheet.getLastRow() >= 2) {
    var data = sectorSheet.getRange(2, 1, sectorSheet.getLastRow() - 1, HEADERS.Sectors.length).getValues();
    for (var i = 0; i < data.length; i++) {
      var child = sectorBranchFromRow(i + 2, data[i]);
      if (String(child.sectorId) !== String(branch.sectorId)) continue;
      sectorSheet.getRange(child.row, COLS.SECTORS.STATUS).setValue('Retired');
      if (!child.isSectorOnly && child.id) targetIds.push(String(child.id));
    }
  }
  var decisions = 0;
  var tasks = 0;
  targetIds.forEach(function (targetId) {
    decisions += autoDismissPendingForTarget('Sector', targetId, 'Sector branch retired');
    tasks += setOpenTodosForTarget('Sector', targetId, 'Skipped', 'Sector branch retired');
  });
  populateToday();
  refreshHome();
  return decisions + tasks;
}

function sectorIdExistsMap() {
  var sheet = getSheet('Sectors');
  var out = {};
  if (!sheet || sheet.getLastRow() < 2) return out;
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS.Sectors.length).getValues();
  data.forEach(function (r) {
    if (r[COLS.SECTORS.ID - 1]) out[String(r[COLS.SECTORS.ID - 1])] = true;
    if (r[COLS.SECTORS.SUBSECTOR_ID - 1]) out[String(r[COLS.SECTORS.SUBSECTOR_ID - 1])] = true;
  });
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
    var before = sectorBranchFromRow(row, data[i]);
    var beforeId = before.id;
    var after = ensureSectorBranchId(sheet, before);
    if (after.id && after.id !== beforeId) {
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
      var sectorId = String(orgData[i][COLS.ORGS.SECTOR_ID - 1] || '');
      var subId = String(orgData[i][COLS.ORGS.SUBSECTOR_ID - 1] || '');
      if ((sectorId && !existing[sectorId]) || (subId && !existing[subId])) {
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
  var decisionSheet = getSheet('Decisions');
  if (decisionSheet && decisionSheet.getLastRow() >= 2) {
    var decisionData = decisionSheet.getRange(2, 1, decisionSheet.getLastRow() - 1, HEADERS['Pending decisions'].length).getValues();
    for (var d = 0; d < decisionData.length; d++) {
      var decisionSectorId = String(decisionData[d][COLS.DECISIONS.TARGET_ID - 1] || '');
      var decisionObjType = String(decisionData[d][COLS.DECISIONS.TARGET_TYPE - 1]);
      var isResolvedDecisionSectorRef = decisionSectorId && (decisionSectorId.indexOf('SEC-') === 0 || decisionSectorId.indexOf('SUB-') === 0);
      if (decisionObjType === 'Sector' && isResolvedDecisionSectorRef && !existing[decisionSectorId]) {
        appendNoteFlag(decisionSheet, d + 2, COLS.DECISIONS.NOTES, '[orphaned-sector] Linked Sector/Sub-sector no longer exists');
        count++;
      } else if (decisionObjType === 'Sector' && isResolvedDecisionSectorRef) {
        clearNoteFlag(decisionSheet, d + 2, COLS.DECISIONS.NOTES, '[orphaned-sector]');
      }
    }
  }
  return count;
}

function onEditJobs(sheet, row, col, newVal, e) {
  if (guardManualJobSystemIdEdit(sheet, row, col, e)) return;
  if (guardBlankJobOpportunity(sheet, row, col, newVal, e)) return;
  if (guardJobOpportunityBeforeOtherFields(sheet, row, col, newVal, e)) return;
  if (col === COLS.JOBS.OPPORTUNITY || col === COLS.JOBS.ORG) checkJobDuplicate(sheet, row);
  if (col === COLS.JOBS.ORG) {
    var oldJobOrgName = e && e.oldValue ? String(e.oldValue) : '';
    var oldJobOrgId = String(sheet.getRange(row, COLS.JOBS.ORG_ID).getValue() || '');
    var jobTitleForOrg = String(sheet.getRange(row, COLS.JOBS.OPPORTUNITY).getValue() || '').trim();
    var typedOrgForJob = String(newVal || '').trim();
    if (!typedOrgForJob) {
      sheet.getRange(row, COLS.JOBS.ORG_ID).clearContent();
      appendNoteFlag(sheet, row, COLS.JOBS.NOTES, '[pending-org] Add Organisation to activate this job\u2019s tasks.');
      refreshDerivedPlanningSurfaces();
      requestHomeRefresh();
      return;
    }
    if (!jobTitleForOrg) {
      sheet.getRange(row, COLS.JOBS.ORG_ID).clearContent();
      appendNoteFlag(sheet, row, COLS.JOBS.NOTES, '[missing-opportunity] Add Opportunity before Organisation.');
      SpreadsheetApp.getActiveSpreadsheet().toast('Add Opportunity before Organisation on Jobs.', 'The Planner', 5);
      return;
    }
    clearNoteFlag(sheet, row, COLS.JOBS.NOTES, '[missing-opportunity]');
    var ensuredJobIdForOrg = sheet.getRange(row, COLS.JOBS.ID).getValue() || nextId(sheet, COLS.JOBS.ID, 'JOB');
    sheet.getRange(row, COLS.JOBS.ID).setValue(ensuredJobIdForOrg);
    if (!sheet.getRange(row, COLS.JOBS.STATUS).getValue()) sheet.getRange(row, COLS.JOBS.STATUS).setValue('Not started');
    inheritOrgFields(sheet, row, COLS.JOBS.ORG, COLS.JOBS.ORG_ID);
    var relinkJobId = ensuredJobIdForOrg;
    var relinkJobStatus = normalizeJobStatus(sheet.getRange(row, COLS.JOBS.STATUS).getValue() || 'Not started');
    var newJobOrgName = String(sheet.getRange(row, COLS.JOBS.ORG).getValue() || '');
    var newJobOrgId = String(sheet.getRange(row, COLS.JOBS.ORG_ID).getValue() || '');
    var jobOrgChanged = relinkJobId && newJobOrgName && ((oldJobOrgName && oldJobOrgName !== newJobOrgName) || (oldJobOrgId && oldJobOrgId !== newJobOrgId));
    if (jobOrgChanged) {
      propagateJobOrganisationChange(relinkJobId, newJobOrgName, newJobOrgId, oldJobOrgName, oldJobOrgId);
      refreshLinkedContactsDisplay();
    }
    var routedOrgEvidence = promoteOrgForLiveJob(newJobOrgId, relinkJobStatus);
    if (jobOrgChanged || routedOrgEvidence) {
      refreshDerivedPlanningSurfaces();
      requestHomeRefresh();
    }
    var jNotes = String(sheet.getRange(row, COLS.JOBS.NOTES).getValue() || '');
    if (jNotes.indexOf('[pending-org]') !== -1) {
      clearNoteFlag(sheet, row, COLS.JOBS.NOTES, '[pending-org]');
      var jId = sheet.getRange(row, COLS.JOBS.ID).getValue() || nextId(sheet, COLS.JOBS.ID, 'JOB');
      sheet.getRange(row, COLS.JOBS.ID).setValue(jId);
      var jStatus = normalizeJobStatus(sheet.getRange(row, COLS.JOBS.STATUS).getValue() || 'Not started');
      sheet.getRange(row, COLS.JOBS.STATUS).setValue(jStatus);
      promoteOrgForLiveJob(sheet.getRange(row, COLS.JOBS.ORG_ID).getValue(), jStatus);
      fireJobStatusChanged(jId, '', jStatus, { source: 'manual-org-followup' });
      refreshDerivedPlanningSurfaces();
      requestHomeRefresh();
    }
    return;
  }
  if (col === COLS.JOBS.OPPORTUNITY && newVal) {
    clearNoteFlag(sheet, row, COLS.JOBS.NOTES, '[missing-opportunity]');
    clearNoteFlag(sheet, row, COLS.JOBS.NOTES, '[opportunity-required]');
    if (!sheet.getRange(row, COLS.JOBS.ID).getValue()) sheet.getRange(row, COLS.JOBS.ID).setValue(nextId(sheet, COLS.JOBS.ID, 'JOB'));
    var editedJobId = sheet.getRange(row, COLS.JOBS.ID).getValue();
    if (e && e.oldValue) propagateJobTitleRename(editedJobId, String(newVal), String(e.oldValue));
    if (!sheet.getRange(row, COLS.JOBS.STATUS).getValue()) sheet.getRange(row, COLS.JOBS.STATUS).setValue('Not started');
    if (!sheet.getRange(row, COLS.JOBS.ORG).getValue()) {
      appendNoteFlag(sheet, row, COLS.JOBS.NOTES, '[pending-org] Add Organisation to activate this job\u2019s tasks.');
    }
    refreshDerivedPlanningSurfaces();
    requestHomeRefresh();
    return;
  }
  if (col === COLS.JOBS.DEADLINE) {
    var deadlineJobId = String(sheet.getRange(row, COLS.JOBS.ID).getValue());
    syncOpenJobDeadlineTaskDates(deadlineJobId, newVal || '');
    recalcTodosLinkedToObject(deadlineJobId);
    syncJobsPeopleHealthFlags();
    refreshDerivedPlanningSurfaces();
    requestHomeRefresh();
    return;
  }
  if (col === COLS.JOBS.RESPONSE && String(newVal) === 'Yes') {
    var responseJobId = sheet.getRange(row, COLS.JOBS.ID).getValue() || nextId(sheet, COLS.JOBS.ID, 'JOB');
    sheet.getRange(row, COLS.JOBS.ID).setValue(responseJobId);
    if (!isJobSubmittedForResponseTracking(responseJobId)) {
      restoreOrClearEditedCell(sheet, row, col, e);
      appendNoteFlag(sheet, row, COLS.JOBS.NOTES, '[response-before-submit] Submit the application before recording a response.');
      SpreadsheetApp.getActiveSpreadsheet().toast('Submit the application before recording a response.', 'The Planner', 5);
      return;
    }
    restoreOrClearEditedCell(sheet, row, col, e);
    runApplicationResultForJobPopup(responseJobId);
    return;
  }
  if (col === COLS.JOBS.RESPONSE && String(newVal) === 'No') {
    var waitingJobId = sheet.getRange(row, COLS.JOBS.ID).getValue() || nextId(sheet, COLS.JOBS.ID, 'JOB');
    sheet.getRange(row, COLS.JOBS.ID).setValue(waitingJobId);
    if (!isJobSubmittedForResponseTracking(waitingJobId)) {
      restoreOrClearEditedCell(sheet, row, col, e);
      appendNoteFlag(sheet, row, COLS.JOBS.NOTES, '[waiting-before-submit] Submit the application before tracking response checks.');
      SpreadsheetApp.getActiveSpreadsheet().toast('Submit the application before marking it Waiting.', 'The Planner', 5);
      return;
    }
    recordJobWaitingForResponse(waitingJobId, { source: 'job-response' });
    refreshDerivedPlanningSurfaces();
    requestHomeRefresh();
    return;
  }
  if (col === COLS.JOBS.OUTCOME && newVal) {
    var outcomeJobId = sheet.getRange(row, COLS.JOBS.ID).getValue() || nextId(sheet, COLS.JOBS.ID, 'JOB');
    sheet.getRange(row, COLS.JOBS.ID).setValue(outcomeJobId);
    var normalizedOutcome = normalizeJobOutcome(newVal);
    if (!normalizedOutcome) {
      appendNoteFlag(sheet, row, COLS.JOBS.NOTES, '[invalid-value] Job Outcome "' + newVal + '" rejected');
      return;
    }
    if (!isJobSubmittedForResponseTracking(outcomeJobId)) {
      restoreOrClearEditedCell(sheet, row, col, e);
      appendNoteFlag(sheet, row, COLS.JOBS.NOTES, '[result-before-submit] Submit the application before recording an application result.');
      SpreadsheetApp.getActiveSpreadsheet().toast('Submit the application before recording an application result.', 'The Planner', 5);
      return;
    }
    if (normalizedOutcome !== String(newVal || '')) sheet.getRange(row, COLS.JOBS.OUTCOME).setValue(normalizedOutcome);
    if (normalizedOutcome === 'Waiting') recordJobWaitingForResponse(outcomeJobId, { source: 'job-outcome' });
    else {
      sheet.getRange(row, COLS.JOBS.RESPONSE).setValue('Yes');
      routeJobOutcome(outcomeJobId, normalizedOutcome, { source: 'job-outcome' });
    }
    refreshDerivedPlanningSurfaces();
    renderTodayDecisionCards();
    requestHomeRefresh();
    return;
  }
  if (col === COLS.JOBS.STATUS) {
    var rawStatus = normalizeJobStatus(newVal);
    if (!rawStatus && String(newVal || '').trim()) {
      appendNoteFlag(sheet, row, COLS.JOBS.NOTES, '[invalid-value] Application status "' + newVal + '" rejected');
      return;
    }
    var status = rawStatus || 'Not started';
    if (status !== String(newVal || '')) sheet.getRange(row, COLS.JOBS.STATUS).setValue(status);
    var id = sheet.getRange(row, COLS.JOBS.ID).getValue() || nextId(sheet, COLS.JOBS.ID, 'JOB');
    sheet.getRange(row, COLS.JOBS.ID).setValue(id);
    if (!sheet.getRange(row, COLS.JOBS.ORG).getValue()) {
      appendNoteFlag(sheet, row, COLS.JOBS.NOTES, '[pending-org] Add Organisation to activate this job\u2019s tasks.');
      requestHomeRefresh();
      return;
    }
    inheritOrgFields(sheet, row, COLS.JOBS.ORG, COLS.JOBS.ORG_ID);
    promoteOrgForLiveJob(sheet.getRange(row, COLS.JOBS.ORG_ID).getValue(), status);
    fireJobStatusChanged(id, e && e.oldValue, status, { source: 'manual' });
    syncJobsPeopleHealthFlags();
    refreshDerivedPlanningSurfaces();
    requestHomeRefresh();
  }
}

function onEditPeople(sheet, row, col, newVal, e) {
  if (guardManualPeopleSystemIdEdit(sheet, row, col, e)) return;
  if (guardBlankPersonName(sheet, row, col, newVal, e)) return;
  if (guardPersonNameBeforeOtherFields(sheet, row, col, newVal, e)) return;
  if (col === COLS.PEOPLE.NAME || col === COLS.PEOPLE.ORG) checkPeopleDuplicate(sheet, row);
  if (col === COLS.PEOPLE.ORG) {
    var oldPersonOrgName = e && e.oldValue ? String(e.oldValue) : '';
    var oldPersonOrgId = String(sheet.getRange(row, COLS.PEOPLE.ORG_ID).getValue() || '');
    var personNameForOrg = String(sheet.getRange(row, COLS.PEOPLE.NAME).getValue() || '').trim();
    var typedOrgForPerson = String(newVal || '').trim();
    var personIdForOrg = sheet.getRange(row, COLS.PEOPLE.ID).getValue() || nextId(sheet, COLS.PEOPLE.ID, 'PER');
    sheet.getRange(row, COLS.PEOPLE.ID).setValue(personIdForOrg);
    if (!typedOrgForPerson) {
      sheet.getRange(row, COLS.PEOPLE.ORG_ID).clearContent();
      appendNoteFlag(sheet, row, COLS.PEOPLE.NOTES, '[no-org] Organisation optional; add one later if this should link to an organisation.');
      if (oldPersonOrgName || oldPersonOrgId) propagatePersonOrganisationChange(personIdForOrg, '', '', oldPersonOrgName, oldPersonOrgId);
      refreshDerivedPlanningSurfaces();
      requestHomeRefresh();
      return;
    }
    if (!personNameForOrg) {
      sheet.getRange(row, COLS.PEOPLE.ORG_ID).clearContent();
      appendNoteFlag(sheet, row, COLS.PEOPLE.NOTES, '[missing-name] Add Name before Organisation.');
      SpreadsheetApp.getActiveSpreadsheet().toast('Add Name before Organisation on People.', 'The Planner', 5);
      return;
    }
    clearNoteFlag(sheet, row, COLS.PEOPLE.NOTES, '[missing-name]');
    inheritOrgFields(sheet, row, COLS.PEOPLE.ORG, COLS.PEOPLE.ORG_ID);
    var newPersonOrgName = String(sheet.getRange(row, COLS.PEOPLE.ORG).getValue() || '');
    var newPersonOrgId = String(sheet.getRange(row, COLS.PEOPLE.ORG_ID).getValue() || '');
    var personHadPriorOrg = !!(oldPersonOrgName || oldPersonOrgId);
    var personOrgChanged = newPersonOrgName && (!personHadPriorOrg || oldPersonOrgName !== newPersonOrgName || oldPersonOrgId !== newPersonOrgId);
    if (personOrgChanged) propagatePersonOrganisationChange(personIdForOrg, newPersonOrgName, newPersonOrgId, oldPersonOrgName, oldPersonOrgId);
    var currentPersonStage = normalizePersonStage(sheet.getRange(row, COLS.PEOPLE.STAGE).getValue() || 'Identified');
    if (!sheet.getRange(row, COLS.PEOPLE.STAGE).getValue()) sheet.getRange(row, COLS.PEOPLE.STAGE).setValue(currentPersonStage);
    var routedPersonOrgEvidence = promoteOrgForLivePerson(newPersonOrgId, currentPersonStage);
    var pNotes = String(sheet.getRange(row, COLS.PEOPLE.NOTES).getValue() || '');
    if (pNotes.indexOf('[pending-org]') !== -1) {
      clearNoteFlag(sheet, row, COLS.PEOPLE.NOTES, '[pending-org]');
      var pStage = normalizePersonStage(sheet.getRange(row, COLS.PEOPLE.STAGE).getValue() || 'Identified');
      sheet.getRange(row, COLS.PEOPLE.STAGE).setValue(pStage);
      promoteOrgForLivePerson(sheet.getRange(row, COLS.PEOPLE.ORG_ID).getValue(), pStage);
      firePersonStageChanged(personIdForOrg, '', pStage, { source: 'manual-org-followup' });
    }
    if (personOrgChanged || routedPersonOrgEvidence) refreshDerivedPlanningSurfaces();
    requestHomeRefresh();
    return;
  }
  if (col === COLS.PEOPLE.NAME && newVal) {
    if (!sheet.getRange(row, COLS.PEOPLE.ID).getValue()) sheet.getRange(row, COLS.PEOPLE.ID).setValue(nextId(sheet, COLS.PEOPLE.ID, 'PER'));
    var editedPersonId = sheet.getRange(row, COLS.PEOPLE.ID).getValue();
    if (e && e.oldValue) propagatePersonNameChange(editedPersonId, String(newVal), String(e.oldValue));
    if (!sheet.getRange(row, COLS.PEOPLE.FOLLOW_UPS_SENT_COUNT).getValue()) sheet.getRange(row, COLS.PEOPLE.FOLLOW_UPS_SENT_COUNT).setValue(0);
    if (!sheet.getRange(row, COLS.PEOPLE.STAGE).getValue()) sheet.getRange(row, COLS.PEOPLE.STAGE).setValue('Identified');
    var orgName = sheet.getRange(row, COLS.PEOPLE.ORG).getValue();
    if (orgName) {
      inheritOrgFields(sheet, row, COLS.PEOPLE.ORG, COLS.PEOPLE.ORG_ID);
      promoteOrgForLivePerson(sheet.getRange(row, COLS.PEOPLE.ORG_ID).getValue(), sheet.getRange(row, COLS.PEOPLE.STAGE).getValue());
      firePersonStageChanged(sheet.getRange(row, COLS.PEOPLE.ID).getValue(), '', sheet.getRange(row, COLS.PEOPLE.STAGE).getValue(), { source: 'manual' });
      refreshDerivedPlanningSurfaces();
      requestHomeRefresh();
    } else {
      appendNoteFlag(sheet, row, COLS.PEOPLE.NOTES, '[no-org] Organisation optional; add one later if this should link to an organisation.');
    }
    refreshLinkedContactsDisplay();
    requestHomeRefresh();
    return;
  }
  if (col === COLS.PEOPLE.REPLY_RECEIVED && String(newVal) === 'Yes') {
    if (sheet.getRange(row, COLS.PEOPLE.ORG).getValue()) inheritOrgFields(sheet, row, COLS.PEOPLE.ORG, COLS.PEOPLE.ORG_ID);
    var pid = sheet.getRange(row, COLS.PEOPLE.ID).getValue() || nextId(sheet, COLS.PEOPLE.ID, 'PER');
    sheet.getRange(row, COLS.PEOPLE.ID).setValue(pid);
    routePersonReplyReceived(pid, { source: 'manual' });
    refreshDerivedPlanningSurfaces();
    requestHomeRefresh();
    return;
  }
  if (col === COLS.PEOPLE.OUTREACH_DATE && newVal) {
    var outreachPersonId = sheet.getRange(row, COLS.PEOPLE.ID).getValue() || nextId(sheet, COLS.PEOPLE.ID, 'PER');
    sheet.getRange(row, COLS.PEOPLE.ID).setValue(outreachPersonId);
    if (sheet.getRange(row, COLS.PEOPLE.ORG).getValue()) inheritOrgFields(sheet, row, COLS.PEOPLE.ORG, COLS.PEOPLE.ORG_ID);
    var outreachStage = normalizePersonStage(sheet.getRange(row, COLS.PEOPLE.STAGE).getValue() || 'Identified');
    var outreachDate = parseDateOr(newVal);
    sheet.getRange(row, COLS.PEOPLE.OUTREACH_DATE).setValue(outreachDate);
    if (outreachStage === 'Closed') {
      appendNoteFlag(sheet, row, COLS.PEOPLE.NOTES, '[outreach-date-ignored] Person is Closed; outreach follow-up was not reopened.');
      return;
    }
    if (outreachStage === 'Outreach sent') {
      var recalculatedFollowUp = addDays(outreachDate, 6);
      sheet.getRange(row, COLS.PEOPLE.FOLLOW_UP_DATE).setValue(recalculatedFollowUp);
      updateOpenTodoDueForTargetWorkflow('Person', outreachPersonId, 'Contact follow-up', recalculatedFollowUp);
      if (String(sheet.getRange(row, COLS.PEOPLE.FOLLOW_UP_SENT).getValue() || '') !== 'Yes') sheet.getRange(row, COLS.PEOPLE.FOLLOW_UP_SENT).setValue('No');
    } else if (['Identified', 'To outreach', 'Outreach drafted'].indexOf(outreachStage) !== -1) {
      movePersonStage(outreachPersonId, 'Outreach sent', { realDate: outreachDate, source: 'manual-outreach-date' });
    }
    refreshDerivedPlanningSurfaces();
    requestHomeRefresh();
    return;
  }
  if (col === COLS.PEOPLE.CONVERSATION_DATE && newVal) {
    var convPersonId = sheet.getRange(row, COLS.PEOPLE.ID).getValue() || nextId(sheet, COLS.PEOPLE.ID, 'PER');
    sheet.getRange(row, COLS.PEOPLE.ID).setValue(convPersonId);
    if (sheet.getRange(row, COLS.PEOPLE.ORG).getValue()) inheritOrgFields(sheet, row, COLS.PEOPLE.ORG, COLS.PEOPLE.ORG_ID);
    var conversationStage = normalizePersonStage(sheet.getRange(row, COLS.PEOPLE.STAGE).getValue() || 'Identified');
    if (conversationStage === 'Conversation completed' || conversationStage === 'Closed') {
      appendNoteFlag(sheet, row, COLS.PEOPLE.NOTES, '[conversation-date-not-routed] Edit Conversations for completed/closed conversation history.');
      refreshDerivedPlanningSurfaces();
      requestHomeRefresh();
      return;
    }
    upsertScheduledInteractionForPerson(convPersonId, newVal);
    refreshDerivedPlanningSurfaces();
    requestHomeRefresh();
    return;
  }
  if (col === COLS.PEOPLE.STAGE) {
    var personId = sheet.getRange(row, COLS.PEOPLE.ID).getValue() || nextId(sheet, COLS.PEOPLE.ID, 'PER');
    sheet.getRange(row, COLS.PEOPLE.ID).setValue(personId);
    var stage = normalizePersonStage(newVal);
    if (!stage && String(newVal || '').trim()) {
      appendNoteFlag(sheet, row, COLS.PEOPLE.NOTES, '[invalid-value] Relationship status "' + newVal + '" rejected');
      return;
    }
    if (stage !== String(newVal || '')) sheet.getRange(row, COLS.PEOPLE.STAGE).setValue(stage);
    if (sheet.getRange(row, COLS.PEOPLE.ORG).getValue()) inheritOrgFields(sheet, row, COLS.PEOPLE.ORG, COLS.PEOPLE.ORG_ID);
    promoteOrgForLivePerson(sheet.getRange(row, COLS.PEOPLE.ORG_ID).getValue(), stage);
    firePersonStageChanged(personId, e && e.oldValue, stage, { source: 'manual' });
    refreshDerivedPlanningSurfaces();
    requestHomeRefresh();
  }
}

// =============================================================
// CONVERSATIONS (Interactions tab)
// =============================================================

function appendInteraction(personId, personName, org, dateValue, typeValue, notes, outcome, statusValue) {
  migrateInteractionsStatusSchema();
  var sheet = getSheet('Conversations');
  if (!sheet) return '';
  var id = nextId(sheet, COLS.INTERACTIONS.ID, 'INT');
  var row = new Array(HEADERS.Interactions.length).fill('');
  var interactionStatus = statusValue || 'Completed';
  row[COLS.INTERACTIONS.ID - 1] = id;
  row[COLS.INTERACTIONS.DATE - 1] = dateValue || (interactionStatus === 'Scheduled' ? '' : today());
  row[COLS.INTERACTIONS.PERSON_ID - 1] = personId || '';
  row[COLS.INTERACTIONS.PERSON - 1] = personName || '';
  row[COLS.INTERACTIONS.ORG - 1] = org || '';
  row[COLS.INTERACTIONS.TYPE - 1] = typeValue || 'Auto-log';
  row[COLS.INTERACTIONS.STATUS - 1] = interactionStatus;
  row[COLS.INTERACTIONS.NOTES - 1] = notes || '';
  row[COLS.INTERACTIONS.OUTCOME - 1] = outcome || (typeValue === 'Auto-log' ? 'System log' : '');
  sheet.appendRow(row);
  linkInteractionPersonCell(sheet.getLastRow());
  syncPeopleHelperColumns();
  return id;
}

function upsertScheduledInteractionForPerson(personId, dateValue) {
  migrateInteractionsStatusSchema();
  var sheet = getSheet('Conversations');
  var person = getPersonRowById(personId);
  if (!sheet || !person || !dateValue) return '';
  var date = parseDateOr(dateValue);
  if (sheet.getLastRow() > 1) {
    var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS.Interactions.length).getValues();
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][COLS.INTERACTIONS.PERSON_ID - 1]) !== String(personId)) continue;
      if (String(data[i][COLS.INTERACTIONS.STATUS - 1]) !== 'Scheduled') continue;
      var r = i + 2;
      sheet.getRange(r, COLS.INTERACTIONS.DATE).setValue(date);
      if (!sheet.getRange(r, COLS.INTERACTIONS.TYPE).getValue()) sheet.getRange(r, COLS.INTERACTIONS.TYPE).setValue('Other');
      clearNoteFlag(sheet, r, COLS.INTERACTIONS.NOTES, '[missing-date]');
      linkInteractionPersonCell(r);
      routeInteractionStatusForPerson(sheet, r, 'Scheduled');
      syncPeopleHelperColumns();
      return String(data[i][COLS.INTERACTIONS.ID - 1] || '');
    }
  }
  var id = appendInteraction(personId, person.name, person.org, date, 'Other', 'Scheduled from People conversation date.', '', 'Scheduled');
  routeInteractionStatusForPerson(sheet, sheet.getLastRow(), 'Scheduled');
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
    if (!sheet.getRange(r, COLS.INTERACTIONS.PERSON_ID).getValue()) continue;
    if (linkInteractionPersonCell(r)) {
      clearNoteFlag(sheet, r, COLS.INTERACTIONS.NOTES, '[orphaned-person]');
      fixed++;
    } else {
      appendNoteFlag(sheet, r, COLS.INTERACTIONS.NOTES, '[orphaned-person] Person ID no longer matches a People row.');
    }
  }
  return fixed;
}

function personLastInteractionMap() {
  var out = {};
  var sheet = getSheet('Conversations');
  if (!sheet || sheet.getLastRow() < 2) return out;
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS.Interactions.length).getValues();
  data.forEach(function (r) {
    var personId = String(r[COLS.INTERACTIONS.PERSON_ID - 1] || '');
    var status = String(r[COLS.INTERACTIONS.STATUS - 1] || 'Completed');
    var dateValue = r[COLS.INTERACTIONS.DATE - 1];
    if (!personId || status !== 'Completed' || !dateValue) return;
    var time = new Date(dateValue).getTime();
    if (isNaN(time)) return;
    if (!out[personId] || time > out[personId].time) out[personId] = { date: dateValue, time: time };
  });
  return out;
}

function personNextActionMap() {
  var out = {};
  var sheet = getSheet('Tasks');
  if (!sheet || sheet.getLastRow() < 2) return out;
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS['To-do'].length).getValues();
  for (var i = 0; i < data.length; i++) {
    var objType = String(data[i][COLS.TODO.OBJ_TYPE - 1] || '');
    var personId = String(data[i][COLS.TODO.OBJ_ID - 1] || '');
    var status = String(data[i][COLS.TODO.STATUS - 1] || '');
    if (objType !== 'Person' || !personId || (status !== 'Not started' && status !== 'In progress')) continue;
    var due = data[i][COLS.TODO.DUE_DATE - 1];
    var dueTime = due ? new Date(due).getTime() : 9999999999999;
    if (isNaN(dueTime)) dueTime = 9999999999999;
    var label = String(data[i][COLS.TODO.TASK - 1] || '');
    if (due && dueTime !== 9999999999999) label += ' (due ' + formatDateHuman(due) + ')';
    if (!out[personId] || dueTime < out[personId].dueTime) out[personId] = { label: label, dueTime: dueTime };
  }
  return out;
}

function personLinkedJobsMap() {
  var out = {};
  var sheet = getSheet('Jobs');
  if (!sheet || sheet.getLastRow() < 2) return out;
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS.Jobs.length).getValues();
  data.forEach(function (r) {
    var title = String(r[COLS.JOBS.OPPORTUNITY - 1] || '');
    var org = String(r[COLS.JOBS.ORG - 1] || '');
    var ids = parseLinkedContactIds(r[COLS.JOBS.CONTACTS_IDS - 1]);
    ids.forEach(function (personId) {
      if (!out[personId]) out[personId] = [];
      out[personId].push(title + (org ? ' at ' + org : ''));
    });
  });
  return out;
}

function syncPeopleHelperColumns() {
  migrateInteractionsStatusSchema();
  var sheet = getSheet('People');
  if (!sheet || sheet.getLastRow() < 2) return 0;
  var rowCount = sheet.getLastRow() - 1;
  var data = sheet.getRange(2, 1, rowCount, HEADERS.People.length).getValues();
  var lastByPerson = personLastInteractionMap();
  var nextByPerson = personNextActionMap();
  var jobsByPerson = personLinkedJobsMap();
  var values = [];
  for (var i = 0; i < data.length; i++) {
    var personId = String(data[i][COLS.PEOPLE.ID - 1] || '');
    values.push([
      lastByPerson[personId] ? lastByPerson[personId].date : '',
      nextByPerson[personId] ? nextByPerson[personId].label : '',
      jobsByPerson[personId] ? jobsByPerson[personId].join('\n') : ''
    ]);
  }
  sheet.getRange(2, COLS.PEOPLE.LAST_INTERACTION, rowCount, 3).setValues(values);
  return rowCount;
}

function interactionNoOrgLabel() {
  return 'No organisation';
}

function findSingleBlankOrgPersonByExactName(name) {
  var sheet = getSheet('People');
  if (!sheet || sheet.getLastRow() < 2 || !name) return { person: null, ambiguous: false };
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS.People.length).getValues();
  var wanted = normalizeKeyPart(name);
  var matches = [];
  for (var i = 0; i < data.length; i++) {
    if (normalizeKeyPart(data[i][COLS.PEOPLE.NAME - 1]) !== wanted) continue;
    if (data[i][COLS.PEOPLE.ORG - 1] || data[i][COLS.PEOPLE.ORG_ID - 1]) continue;
    matches.push({ row: i + 2, data: data[i] });
  }
  if (matches.length === 1) return { person: matches[0], ambiguous: false };
  if (matches.length > 1) return { person: null, ambiguous: true };
  return { person: null, ambiguous: false };
}

function attachOrgToPersonRow(person, org) {
  if (!person || !org) return person;
  var sheet = getSheet('People');
  if (!sheet) return person;
  var personId = person.data[COLS.PEOPLE.ID - 1];
  var oldOrgName = person.data[COLS.PEOPLE.ORG - 1];
  var oldOrgId = person.data[COLS.PEOPLE.ORG_ID - 1];
  if (oldOrgId || oldOrgName) return person;
  sheet.getRange(person.row, COLS.PEOPLE.ORG).setValue(org.name);
  sheet.getRange(person.row, COLS.PEOPLE.ORG_ID).setValue(org.id);
  clearNoteFlag(sheet, person.row, COLS.PEOPLE.NOTES, '[no-org]');
  propagatePersonOrganisationChange(personId, org.name, org.id, oldOrgName, oldOrgId);
  return getPersonRowById(personId);
}

function resolveInteractionPersonSelection(selection) {
  var sheet = getSheet('People');
  if (!sheet || sheet.getLastRow() < 2 || !selection) return { person: null, ambiguous: false };
  var raw = String(selection || '').trim();
  var labelMatch = raw.match(/^(.*)\s+\(([^()]+)\)$/);
  var wantedName = labelMatch ? labelMatch[1] : raw;
  var wantedOrg = labelMatch ? labelMatch[2] : '';
  var wantsBlankOrg = labelMatch && normalizeKeyPart(wantedOrg) === normalizeKeyPart(interactionNoOrgLabel());
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS.People.length).getValues();
  var exact = [];
  var fuzzy = [];
  for (var i = 0; i < data.length; i++) {
    var nm = String(data[i][COLS.PEOPLE.NAME - 1] || '');
    var org = String(data[i][COLS.PEOPLE.ORG - 1] || '');
    if (wantsBlankOrg && org) continue;
    if (wantedOrg && !wantsBlankOrg && normalizeKeyPart(org) !== normalizeKeyPart(wantedOrg)) continue;
    if (normalizeKeyPart(nm) === normalizeKeyPart(wantedName)) exact.push({ row: i + 2, data: data[i] });
    else if (!labelMatch && similarity(wantedName, nm) >= 0.85) fuzzy.push({ row: i + 2, data: data[i] });
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
  data.forEach(function (r) {
    var nm = String(r[COLS.PEOPLE.NAME - 1] || '').trim();
    var key = normalizeKeyPart(nm);
    if (key) nameCounts[key] = (nameCounts[key] || 0) + 1;
  });
  var labels = data.map(function (r) {
    var nm = String(r[COLS.PEOPLE.NAME - 1] || '').trim();
    var org = String(r[COLS.PEOPLE.ORG - 1] || '').trim();
    var key = normalizeKeyPart(nm);
    if (!nm) return '';
    return nameCounts[key] > 1 ? nm + ' (' + (org || interactionNoOrgLabel()) + ')' : nm;
  }).filter(function (l) { return !!l; });
  setDropdown(iSheet.getRange(2, COLS.INTERACTIONS.PERSON, maxRow, 1), labels);
}

function routeInteractionStatusForPerson(sheet, row, statusValue) {
  var status = String(statusValue || '').trim();
  if (DROPDOWNS.INTERACTION_STATUS.indexOf(status) === -1) return false;
  var personId = sheet.getRange(row, COLS.INTERACTIONS.PERSON_ID).getValue();
  var dateValue = sheet.getRange(row, COLS.INTERACTIONS.DATE).getValue();
  if (!personId) {
    appendNoteFlag(sheet, row, COLS.INTERACTIONS.NOTES, '[flags] Status set but Person not identified - cascade skipped.');
    return false;
  }
  if (status === 'Scheduled') {
    if (!dateValue) {
      appendNoteFlag(sheet, row, COLS.INTERACTIONS.NOTES, '[missing-date] Add conversation date to create prep task.');
      return false;
    }
    clearNoteFlag(sheet, row, COLS.INTERACTIONS.NOTES, '[missing-date]');
    routePersonConversationScheduled(personId, dateValue);
    return true;
  }
  if (status === 'Completed') {
    clearNoteFlag(sheet, row, COLS.INTERACTIONS.NOTES, '[outcome-before-completed]');
    movePersonStage(personId, 'Conversation completed', { realDate: dateValue || today(), skipInteractionLog: true });
    return true;
  }
  if (status === 'Cancelled') {
    routePersonConversationCancelled(personId);
    return true;
  }
  return false;
}

function onEditInteractions(sheet, row, col, newVal) {
  if (col === COLS.INTERACTIONS.PERSON && newVal) {
    var resolved = resolveInteractionPersonSelection(String(newVal));
    if (resolved.person) {
      var person = resolved.person;
      sheet.getRange(row, COLS.INTERACTIONS.PERSON_ID).setValue(person.data[COLS.PEOPLE.ID - 1]);
      sheet.getRange(row, COLS.INTERACTIONS.ORG).setValue(person.data[COLS.PEOPLE.ORG - 1] || '');
      if (!sheet.getRange(row, COLS.INTERACTIONS.ID).getValue()) sheet.getRange(row, COLS.INTERACTIONS.ID).setValue(nextId(sheet, COLS.INTERACTIONS.ID, 'INT'));
      clearNoteFlag(sheet, row, COLS.INTERACTIONS.NOTES, '[person-ambiguous]');
      clearNoteFlag(sheet, row, COLS.INTERACTIONS.NOTES, '[person-not-found]');
      linkInteractionPersonCell(row);
      syncPeopleHelperColumns();
    } else if (resolved.ambiguous) {
      sheet.getRange(row, COLS.INTERACTIONS.PERSON).clearContent();
      sheet.getRange(row, COLS.INTERACTIONS.PERSON_ID).clearContent();
      sheet.getRange(row, COLS.INTERACTIONS.ORG).clearContent();
      appendNoteFlag(sheet, row, COLS.INTERACTIONS.NOTES, '[person-ambiguous] More than one matching person - pick the entry with organisation or fill Person ID.');
      SpreadsheetApp.getActiveSpreadsheet().toast('More than one matching person. Pick the entry with organisation or fill Person ID.', 'The Planner', 5);
    } else {
      sheet.getRange(row, COLS.INTERACTIONS.PERSON).clearContent();
      sheet.getRange(row, COLS.INTERACTIONS.PERSON_ID).clearContent();
      sheet.getRange(row, COLS.INTERACTIONS.ORG).clearContent();
      appendNoteFlag(sheet, row, COLS.INTERACTIONS.NOTES, '[person-not-found] Person "' + newVal + '" not found in People. Add them there first, then re-pick.');
      SpreadsheetApp.getActiveSpreadsheet().toast('Person "' + newVal + '" not found in People. Add them there first, then re-pick.', 'The Planner', 5);
    }
    return;
  }
  if (col === COLS.INTERACTIONS.PERSON_ID && newVal) {
    linkInteractionPersonCell(row);
    syncPeopleHelperColumns();
    return;
  }
  if (col === COLS.INTERACTIONS.DATE && newVal) {
    var datedStatus = String(sheet.getRange(row, COLS.INTERACTIONS.STATUS).getValue() || '');
    if (datedStatus === 'Scheduled' || datedStatus === 'Completed') {
      routeInteractionStatusForPerson(sheet, row, datedStatus);
      refreshDerivedPlanningSurfaces();
      syncPeopleHelperColumns();
      requestHomeRefresh();
    }
    return;
  }
  if (col === COLS.INTERACTIONS.STATUS && newVal) {
    if (routeInteractionStatusForPerson(sheet, row, newVal)) {
      refreshDerivedPlanningSurfaces();
      syncPeopleHelperColumns();
      requestHomeRefresh();
    }
    return;
  }
  if (col !== COLS.INTERACTIONS.OUTCOME || !newVal) return;
  if (String(newVal) === 'System log') return;
  if (String(sheet.getRange(row, COLS.INTERACTIONS.STATUS).getValue() || '') !== 'Completed') {
    appendNoteFlag(sheet, row, COLS.INTERACTIONS.NOTES, '[outcome-before-completed] Set Interaction status to Completed before choosing Outcome.');
    return;
  }
  var personId = sheet.getRange(row, COLS.INTERACTIONS.PERSON_ID).getValue();
  var personName = sheet.getRange(row, COLS.INTERACTIONS.PERSON).getValue();
  var org = sheet.getRange(row, COLS.INTERACTIONS.ORG).getValue();
  var notes = sheet.getRange(row, COLS.INTERACTIONS.NOTES).getValue();
  var outcome = String(newVal);
  if (!personId) {
    appendNoteFlag(sheet, row, COLS.INTERACTIONS.NOTES, '[flags] \u26a0 Outcome set but Person not identified — cascade skipped');
    return;
  }
  var interactionId = sheet.getRange(row, COLS.INTERACTIONS.ID).getValue();
  if (!interactionId) {
    interactionId = nextId(sheet, COLS.INTERACTIONS.ID, 'INT');
    sheet.getRange(row, COLS.INTERACTIONS.ID).setValue(interactionId);
  }
  clearNoteFlag(sheet, row, COLS.INTERACTIONS.NOTES, '[outcome-before-completed]');
  routeInteractionStatusForPerson(sheet, row, 'Completed');
  if (outcome === 'Follow-up needed') {
    appendTodoOnceForWorkflow('Follow up with ' + personName, 'Person', personId, org, 'Contact follow-up', 'Not started', addDays(today(), 3), '15 min', notes || '', 'Auto-triggered');
  } else if (outcome === 'Opportunity created') {
    appendPendingDecision('INTERACTION_OPP:' + interactionId + ':Job', 'Opportunity mentioned by ' + personName,
      'Add/update job from conversation with ' + personName, 'Person', personId, 'Org job scan', notes || '');
  } else if (outcome === 'Referral given') {
    appendPendingDecision('INTERACTION_REFERRAL:' + interactionId + ':Referral search', 'Referral mentioned by ' + personName,
      'Act on referral from ' + personName, 'Person', personId, 'Referral search', notes || '');
  } else if (outcome === 'Dead end') {
    closePerson(personId, 'Conversation outcome: dead end.');
  } else if (outcome === 'Neutral') {
    setPersonKeepWarm(personId);
  } else if (outcome === 'Useful') {
    setPersonKeepWarm(personId);
    appendPendingDecision('INTERACTION_USEFUL:' + interactionId + ':Contact follow-up', 'Useful conversation with ' + personName,
      'Follow up with ' + personName, 'Person', personId, 'Contact follow-up', notes || '');
  }
  refreshDerivedPlanningSurfaces();
  syncPeopleHelperColumns();
  requestHomeRefresh();
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

function interviewDebriefLooksCompleted(notes) {
  var text = String(notes || '');
  if (text.indexOf('[debrief-completed]') !== -1) return true;
  var marker = text.indexOf('[interview-debrief]');
  if (marker === -1) return false;
  var body = text.slice(marker + '[interview-debrief]'.length);
  var nextTag = body.search(/\n\[[^\]]+\]/);
  if (nextTag !== -1) body = body.slice(0, nextTag);
  body = body
    .replace(/What they asked:/g, '')
    .replace(/What landed:/g, '')
    .replace(/What was weak:/g, '')
    .replace(/Follow-up promised:/g, '')
    .replace(/Learning for next round:/g, '')
    .trim();
  return body.length > 0;
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

function interviewPrepAreaDefinitions() {
  return [
    { key: 'company_role', label: 'Company / role research' },
    { key: 'domain', label: 'Domain knowledge' },
    { key: 'experience_stories', label: 'Experience stories' },
    { key: 'fit_behavioural', label: 'Fit / behavioural answers' },
    { key: 'case_technical', label: 'Case / technical practice' },
    { key: 'questions', label: 'Questions to ask them' },
    { key: 'interviewer_panel', label: 'Interviewer / panel research' },
    { key: 'logistics', label: 'Logistics / materials' },
    { key: 'other', label: 'Other custom prep' }
  ];
}

function interviewPrepAreaLabel(areaKey) {
  var defs = interviewPrepAreaDefinitions();
  for (var i = 0; i < defs.length; i++) if (defs[i].key === areaKey) return defs[i].label;
  return areaKey || 'Interview prep';
}

function interviewPrepTaskLibrary() {
  return {
    company_role: {
      Light: [[1, 'Review the job description and role requirements', '30 min'], [1, 'Review the organisation website, strategy, and recent context', '30 min'], [2, 'Capture five role-specific talking points', '30 min'], [3, 'Add key company and role points to interview prep notes', '15 min']],
      Moderate: [[1, 'Map role requirements and likely evaluation criteria', '30 min'], [1, 'Research organisation strategy, priorities, and current context', '60 min'], [1, 'Research the team, function, and likely role expectations', '60 min'], [2, 'Identify what success in the role likely requires', '45 min'], [3, 'Tailor your experience narrative to the role', '45 min'], [4, 'Build a one-page company and role cheat sheet', '30 min']],
      Heavy: [[1, 'Build a role success profile', '45 min'], [1, 'Do deep organisation research', '120 min'], [1, 'Research function, team, stakeholders, and operating context', '90 min'], [2, 'Map role requirements to your strongest evidence', '90 min'], [3, 'Prepare a role-specific narrative and critical insights', '90 min'], [4, 'Build detailed interview research pack', '90 min'], [5, 'Practise role and organisation walkthrough', '45 min']],
      Extensive: [[1, 'Build research plan and key hypotheses', '45 min'], [2, 'Research organisation strategy, history, priorities, and recent developments', '120 min'], [2, 'Research team, function, and stakeholder landscape', '120 min'], [2, 'Research sector and competitor context', '120 min'], [3, 'Build role success profile and fit-gap map', '90 min'], [4, 'Build tailored narrative, risks, and opportunity map', '90 min'], [5, 'Practise role, organisation, and context walkthroughs', '90 min'], [6, 'Produce final executive interview pack', '60 min']]
    },
    domain: {
      Light: [[1, 'Identify likely domain themes for the interview', '30 min'], [2, 'Refresh key concepts, terms, and recent context', '45 min'], [3, 'Prepare three concise explanations or examples', '30 min'], [4, 'Do final recall check', '15 min']],
      Moderate: [[1, 'Define likely topic list', '30 min'], [1, 'Map gaps between likely topics and current knowledge', '30 min'], [2, 'Study highest-priority gaps', '90 min'], [3, 'Build concise domain notes with examples', '60 min'], [4, 'Practise explaining three to five topics aloud', '45 min']],
      Heavy: [[1, 'Build topic map and prioritise domain gaps', '45 min'], [1, 'Gather reliable sources and study materials', '45 min'], [2, 'Study core concepts and current context', '120 min'], [3, 'Build examples, use cases, and points of view', '90 min'], [4, 'Practise explanations and likely follow-up questions', '90 min'], [5, 'Build final domain cheat sheet', '60 min']],
      Extensive: [[1, 'Build multi-day domain study plan', '45 min'], [2, 'Complete domain study block on core concepts', '120 min'], [3, 'Complete domain study block on current context', '120 min'], [4, 'Complete domain study block on examples and cases', '120 min'], [5, 'Create structured domain notes', '90 min'], [6, 'Practise Q&A explanations', '120 min'], [7, 'Run mock deep-dive or timed verbal walkthrough', '120 min'], [8, 'Close weak spots and finalise notes', '90 min']]
    },
    experience_stories: {
      Light: [[1, 'Select three relevant experience examples', '30 min'], [2, 'Map each example to role requirements', '30 min'], [3, 'Refresh structure and key result for each story', '30 min'], [4, 'Practise each story aloud once', '30 min']],
      Moderate: [[1, 'Select five to six relevant examples', '30 min'], [2, 'Map examples to likely interview themes', '45 min'], [3, 'Structure each story with context, action, result, and learning', '60 min'], [4, 'Prepare variants for likely follow-up questions', '60 min'], [5, 'Practise concise delivery', '45 min']],
      Heavy: [[1, 'Build competency grid for the interview', '45 min'], [2, 'Select eight to ten examples across themes', '60 min'], [3, 'Structure and quantify each story', '120 min'], [4, 'Prepare variants for leadership, conflict, judgement, failure, and influence', '90 min'], [5, 'Practise aloud and tighten weak stories', '90 min'], [6, 'Build final story bank', '45 min']],
      Extensive: [[1, 'Build full story bank grid', '60 min'], [2, 'Draft ten to twelve stories', '120 min'], [3, 'Continue drafting and refining story bank', '120 min'], [4, 'Tailor stories to role, organisation, and likely evaluation criteria', '120 min'], [5, 'Stress-test stories against follow-up questions', '120 min'], [6, 'Run mock behavioural practice', '90 min'], [7, 'Revise weak stories', '90 min'], [8, 'Build final quick-reference story bank', '60 min']]
    },
    fit_behavioural: {
      Light: [[1, 'Draft or refresh why this role', '30 min'], [1, 'Draft or refresh why this organisation', '30 min'], [2, 'Prepare working-style or values examples', '30 min'], [3, 'Practise key answers aloud', '30 min']],
      Moderate: [[1, 'Build motivation narrative', '45 min'], [1, 'Prepare why role, why organisation, and why now answers', '45 min'], [2, 'Prepare leadership, conflict, failure, and judgement answers', '90 min'], [3, 'Align answers to organisation values and operating style', '45 min'], [4, 'Practise and refine answers', '45 min']],
      Heavy: [[1, 'Diagnose likely behavioural themes', '45 min'], [2, 'Build personal narrative arc', '90 min'], [3, 'Prepare answer bank for eight to ten behavioural questions', '120 min'], [4, 'Tailor answers to role and organisation', '90 min'], [5, 'Practise with probing follow-up questions', '90 min'], [6, 'Build final fit answer anchors', '45 min']],
      Extensive: [[1, 'Build full behavioural prep map', '60 min'], [2, 'Draft comprehensive behavioural answer bank part 1', '120 min'], [3, 'Draft comprehensive behavioural answer bank part 2', '120 min'], [4, 'Tailor each answer to role and organisation', '120 min'], [5, 'Run mock behavioural interview', '120 min'], [6, 'Revise weak answers', '90 min'], [7, 'Practise concise and long-form versions', '90 min'], [8, 'Build final fit narrative pack', '60 min']]
    },
    case_technical: {
      Light: [[1, 'Confirm likely case or technical format', '30 min'], [2, 'Refresh key framework, concepts, or method', '45 min'], [3, 'Complete one focused drill', '45 min'], [4, 'Review mistakes and capture fixes', '30 min']],
      Moderate: [[1, 'Define likely case or technical topics', '30 min'], [2, 'Refresh methods, frameworks, or technical concepts', '60 min'], [3, 'Complete practice drill 1', '60 min'], [4, 'Complete practice drill 2', '60 min'], [5, 'Review mistakes and patterns', '45 min'], [6, 'Complete final timed mini-run', '30 min']],
      Heavy: [[1, 'Map expected format and skills tested', '45 min'], [2, 'Study or refresh technique', '90 min'], [3, 'Complete practice drill 1', '90 min'], [4, 'Complete practice drill 2', '90 min'], [5, 'Complete practice drill 3', '90 min'], [6, 'Review mistakes and build correction notes', '60 min'], [7, 'Run timed mock or verbal walkthrough', '60 min'], [8, 'Build final method checklist', '45 min']],
      Extensive: [[1, 'Build practice plan and format checklist', '45 min'], [2, 'Complete technique study block', '90 min'], [3, 'Complete practice set 1', '120 min'], [4, 'Review and correct practice set 1', '60 min'], [5, 'Complete practice set 2', '120 min'], [6, 'Complete practice set 3 or targeted drill', '120 min'], [7, 'Run mock interview or timed simulation', '120 min'], [8, 'Review and close targeted gaps', '120 min'], [9, 'Complete final run-through', '60 min']]
    },
    questions: {
      Light: [[1, 'Draft five questions to ask', '30 min'], [2, 'Prioritise top three questions', '15 min'], [3, 'Tailor one question to role or interviewer', '15 min']],
      Moderate: [[1, 'Draft question bank by theme', '45 min'], [1, 'Research enough context to avoid obvious questions', '30 min'], [2, 'Tailor questions to role, organisation, and interview purpose', '45 min'], [3, 'Prioritise questions by what you need to learn', '30 min'], [4, 'Practise asking questions naturally', '30 min']],
      Heavy: [[1, 'Define what you need to learn from the interview', '45 min'], [2, 'Build question bank across role, team, organisation, and culture', '90 min'], [3, 'Tailor questions to interviewer or panel', '60 min'], [4, 'Build follow-up questions', '60 min'], [5, 'Practise conversational flow', '45 min'], [6, 'Finalise question shortlist', '30 min']],
      Extensive: [[1, 'Define decision criteria for the opportunity', '60 min'], [2, 'Build detailed question bank across role, team, strategy, culture, and progression', '120 min'], [2, 'Research context to tailor stronger questions', '90 min'], [3, 'Design interviewer-specific question variants', '90 min'], [4, 'Prepare follow-up probes', '90 min'], [5, 'Practise and refine natural delivery', '60 min'], [6, 'Finalise prioritised question list', '60 min']]
    },
    interviewer_panel: {
      Light: [[1, 'Identify interviewer or panel names', '15 min'], [2, 'Scan LinkedIn, bio, or public profile', '30 min'], [3, 'Note likely interests and one tailored question', '30 min']],
      Moderate: [[1, 'Identify panel members and roles', '30 min'], [2, 'Research each person background', '60 min'], [3, 'Map likely perspective or concerns for each interviewer', '45 min'], [4, 'Prepare tailored talking points and questions', '60 min'], [5, 'Add panel notes to interview pack', '30 min']],
      Heavy: [[1, 'Build panel map', '45 min'], [2, 'Research interviewer backgrounds and public work', '90 min'], [3, 'Infer likely evaluation lens for each person', '90 min'], [4, 'Tailor stories and questions by interviewer', '90 min'], [5, 'Prepare panel strategy and answer allocation', '60 min'], [6, 'Final panel review', '30 min']],
      Extensive: [[1, 'Build full stakeholder and panel map', '60 min'], [2, 'Deep research each interviewer', '120 min'], [3, 'Continue interviewer research and source review', '120 min'], [4, 'Map influence, interests, and evaluation lens', '120 min'], [5, 'Tailor evidence, examples, and questions to each person', '120 min'], [6, 'Practise panel-style answer rotation', '90 min'], [7, 'Prepare final panel cheat sheet', '60 min'], [8, 'Complete final panel review', '30 min']]
    },
    logistics: {
      Light: [[1, 'Confirm time, date, timezone, link, or location', '15 min'], [1, 'Check format and required materials', '15 min'], [2, 'Set reminders and prepare environment', '15 min']],
      Moderate: [[1, 'Confirm logistics and interview format', '30 min'], [2, 'Check tech, environment, travel, or access requirements', '45 min'], [2, 'Prepare documents, portfolio, notes, or materials', '45 min'], [3, 'Run short setup rehearsal', '30 min'], [4, 'Set reminder and backup plan', '15 min']],
      Heavy: [[1, 'Confirm all logistics and stakeholders', '30 min'], [2, 'Resolve travel, access, technical, or materials requirements', '90 min'], [3, 'Prepare backup plan', '60 min'], [4, 'Run full environment or travel test', '60 min'], [4, 'Prepare printed or digital materials', '60 min'], [5, 'Complete final logistics check', '30 min']],
      Extensive: [[1, 'Build logistics plan', '45 min'], [2, 'Confirm full schedule, travel, access, and required materials', '90 min'], [3, 'Prepare required documents, equipment, and backups', '90 min'], [3, 'Build environment and contingency plan', '90 min'], [4, 'Rehearse setup, arrival, or timing', '60 min'], [5, 'Prepare final logistics pack', '60 min'], [6, 'Complete day-before logistics check', '30 min']]
    },
    other: {
      Light: [[1, 'Clarify the custom prep requirement', '15 min'], [2, 'Complete the custom prep item', '60 min'], [3, 'Review and add it to interview pack', '15 min']],
      Moderate: [[1, 'Define expected output and quality standard', '30 min'], [2, 'Gather inputs or materials', '45 min'], [3, 'Prepare first version', '90 min'], [4, 'Review and tighten', '45 min'], [5, 'Finalise custom prep item', '30 min']],
      Heavy: [[1, 'Scope requirement and success criteria', '45 min'], [2, 'Gather inputs, examples, and materials', '60 min'], [3, 'Build or prepare main output', '120 min'], [4, 'Continue building or preparing main output', '90 min'], [5, 'Review, test, or practise', '90 min'], [6, 'Revise and finalise', '60 min'], [7, 'Add to day-before interview pack', '30 min']],
      Extensive: [[1, 'Scope multi-day custom requirement', '45 min'], [2, 'Build workplan', '45 min'], [3, 'Complete work block 1', '120 min'], [4, 'Complete work block 2', '120 min'], [5, 'Complete work block 3 or targeted improvement', '120 min'], [6, 'Review, test, or practise', '120 min'], [7, 'Revise weak areas', '90 min'], [8, 'Finalise and rehearse', '90 min'], [9, 'Add to final interview pack', '30 min']]
    }
  };
}

function interviewPrepRowsFor(areaKey, band) {
  var lib = interviewPrepTaskLibrary();
  return (lib[areaKey] && lib[areaKey][band]) ? lib[areaKey][band] : [];
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
    if (!isOpenTodoStatus(st)) continue;
    var r = i + 2;
    taskSheet.getRange(r, COLS.TODO.STATUS).setValue('Skipped');
    taskSheet.getRange(r, COLS.TODO.COMPLETED).setValue(today());
    taskSheet.getRange(r, COLS.TODO.LAST_EDITED).setValue(today());
    appendNoteFlag(taskSheet, r, COLS.TODO.NOTES, '[skipped] Prep plan changed; task no longer needed.');
    retired++;
  }
  return retired;
}

function interviewPrepWorkflowList() {
  return ['Plan interview prep', 'Interview prep', 'Interview prep (Domain scoping)', 'Interview prep (Study)', 'Interview prep (Fit case)', 'Day-before review'];
}

function interviewExpectedResponseLooksAuto(interviewDate, expectedResponse) {
  if (!expectedResponse) return true;
  var interview = parseDateOr(interviewDate, '');
  var expected = parseDateOr(expectedResponse, '');
  if (!interview || !expected) return false;
  var expectedKey = formatDateHuman(expected);
  var seen = {};
  Object.keys(REPLY_DAYS_BY_ROUND_TYPE).forEach(function (roundType) {
    seen[formatDateHuman(addDays(interview, REPLY_DAYS_BY_ROUND_TYPE[roundType] || 7))] = true;
  });
  seen[formatDateHuman(addDays(interview, 7))] = true;
  return !!seen[expectedKey];
}

function pauseInterviewPrepForReschedule(roundId) {
  var count = setOpenTodosForTarget('Interview round', roundId, 'Skipped', 'Interview rescheduled; re-plan prep after the new date is set', interviewPrepWorkflowList());
  var round = getRoundById(roundId);
  var sheet = getSheet('Interviews');
  if (round && sheet) appendNoteFlag(sheet, round.row, COLS.ROUNDS.NOTES, '[prep-date-changed] Prep paused for reschedule; run Plan interview prep after the new date is set.');
  if (count) syncTaskPlanningHelpers();
  return count;
}

function scheduleInterviewRound(roundId, dateValue) {
  var round = getRoundById(roundId);
  var sheet = getSheet('Interviews');
  if (!round || !sheet || !dateValue) return false;
  var interviewDate = parseDateOr(dateValue, '');
  sheet.getRange(round.row, COLS.ROUNDS.INTERVIEW_DATE).setValue(interviewDate);
  sheet.getRange(round.row, COLS.ROUNDS.STATUS).setValue('Scheduled');
  var roundType = String(sheet.getRange(round.row, COLS.ROUNDS.ROUND_TYPE).getValue() || 'Other');
  setOpenTodosForTarget('Interview round', roundId, 'Skipped', 'Interview scheduled', ['Interview scheduling']);
  sheet.getRange(round.row, COLS.ROUNDS.EXPECTED_RESPONSE).setValue(addDays(interviewDate, REPLY_DAYS_BY_ROUND_TYPE[roundType] || 7));
  createInterviewPrepPlanningTask(roundId);
  syncOpenInterviewTaskDates(roundId);
  return true;
}

// Legacy/simple prep generator kept for old workflows only. New scheduled
// rounds should create Plan interview prep, then parent/child Interview prep
// tasks from the popup.
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

function isInterviewPrepPlanningTask(todo) {
  return !!todo && todo.workflow === 'Plan interview prep' && todo.objType === 'Interview round';
}

function isSourceLedScanTask(todo) {
  return !!todo && ['Opportunity scan', 'People source scan'].indexOf(String(todo.workflow || '')) !== -1;
}

function workflowOpensCompletionPopup(workflow) {
  return ['Submit application', 'Referral search', 'Plan interview prep', 'Opportunity scan', 'People source scan'].indexOf(String(workflow || '')) !== -1;
}

function createInterviewPrepPlanningTask(roundId) {
  var round = getRoundById(roundId);
  if (!round) return '';
  var id = appendTodoOnceForWorkflow('Plan interview prep: ' + round.job + (round.org ? ' at ' + round.org : ''),
    'Interview round', roundId, round.org, 'Plan interview prep', 'Not started', today(), '15 min',
    'Choose prep areas and effort bands. This generates the actual interview prep tasks.', 'Auto-triggered');
  if (id) return id;
  var existing = findOpenTodoForTargetWorkflow('Interview round', roundId, 'Plan interview prep');
  return existing ? existing.id : '';
}

function interviewPrepKey(roundId, areaKey, band, seq) {
  return String(roundId || '') + '|' + String(areaKey || '') + '|' + String(band || '').toLowerCase() + '|' + ('0' + seq).slice(-2);
}

function interviewPrepParentKey(roundId, areaKey) {
  return String(roundId || '') + '|' + String(areaKey || '');
}

function clampDateNotPast(d) {
  if (!d) return '';
  var parsed = parseDateOr(d, '');
  if (!parsed) return '';
  return parsed < today() ? today() : parsed;
}

function interviewPrepDueDate(interviewDate, step) {
  if (!interviewDate) return '';
  var n = parseInt(step, 10) || 1;
  var daysBefore = Math.max(1, 5 - Math.min(n, 4));
  return clampDateNotPast(addDays(new Date(interviewDate), -daysBefore));
}

function syncOpenInterviewTaskDates(roundId) {
  var round = getRoundById(roundId);
  var sheet = getSheet('Tasks');
  if (!round || !sheet || sheet.getLastRow() < 2) return 0;
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS['To-do'].length).getValues();
  var count = 0;
  var interviewDate = round.interviewDate ? parseDateOr(round.interviewDate, '') : '';
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][COLS.TODO.OBJ_TYPE - 1]) !== 'Interview round') continue;
    if (String(data[i][COLS.TODO.OBJ_ID - 1]) !== String(roundId)) continue;
    if (!isOpenTodoStatus(data[i][COLS.TODO.STATUS - 1])) continue;
    var workflow = String(data[i][COLS.TODO.WORKFLOW - 1] || '');
    var due = null;
    if (workflow === 'Interview prep') {
      var notes = String(data[i][COLS.TODO.NOTES - 1] || '');
      if (notes.indexOf('[prep-parent-key:') !== -1 || String(data[i][COLS.TODO.TIME_EST - 1]) === 'Multi-day') due = '';
      else {
        var step = parseInt(data[i][COLS.TODO.STEP - 1], 10) || parseInt((notes.match(/\[seq:(\d+)\]/) || [])[1], 10) || 1;
        due = interviewDate ? interviewPrepDueDate(interviewDate, step) : '';
      }
    } else if (workflow === 'Day-before review') {
      due = interviewDate ? clampDateNotPast(addDays(new Date(interviewDate), -1)) : '';
    } else if (workflow === 'Interview prep (Domain scoping)' || workflow === 'Interview prep (Study)') {
      due = interviewDate ? clampDateNotPast(addDays(new Date(interviewDate), -3)) : '';
    } else if (workflow === 'Interview prep (Fit case)') {
      due = interviewDate ? clampDateNotPast(addDays(new Date(interviewDate), -2)) : '';
    } else if (workflow === 'Interview follow-up') {
      due = round.expectedResponse || '';
    }
    if (due === null) continue;
    var row = i + 2;
    sheet.getRange(row, COLS.TODO.DUE_DATE).setValue(due);
    sheet.getRange(row, COLS.TODO.COMMITMENT_CLASS).setValue(assignCommitmentClass(workflow, due, roundId, 'Interview round'));
    sheet.getRange(row, COLS.TODO.CLASS_CALC_AT).setValue(today());
    sheet.getRange(row, COLS.TODO.LAST_EDITED).setValue(today());
    applyTaskHelperColumns(sheet, row);
    count++;
  }
  if (count) syncTaskPlanningHelpers();
  return count;
}

function interviewPrepNotesFor(areaKey, band, seq, dependency, customDescription) {
  return '[interview-prep]\n' +
    '[prep-area:' + interviewPrepAreaLabel(areaKey) + ']\n' +
    '[prep-band:' + band + ']\n' +
    '[seq:' + seq + ']\n' +
    '[dependency:' + (dependency || 'Step-based') + ']' +
    (customDescription ? '\n[custom-prep:' + customDescription + ']' : '');
}

function findOpenTodoByNoteToken(objType, objId, workflow, token) {
  var sheet = getSheet('Tasks');
  if (!sheet || sheet.getLastRow() < 2 || !token) return null;
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS['To-do'].length).getValues();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][COLS.TODO.OBJ_TYPE - 1]) !== String(objType)) continue;
    if (String(data[i][COLS.TODO.OBJ_ID - 1]) !== String(objId)) continue;
    if (String(data[i][COLS.TODO.WORKFLOW - 1]) !== String(workflow)) continue;
    if (!isOpenTodoStatus(String(data[i][COLS.TODO.STATUS - 1]))) continue;
    if (String(data[i][COLS.TODO.NOTES - 1] || '').indexOf(token) === -1) continue;
    return { row: i + 2, id: String(data[i][COLS.TODO.ID - 1] || ''), data: data[i] };
  }
  return null;
}

function upsertInterviewPrepParentTask(round, areaKey, band) {
  var parentKey = interviewPrepParentKey(round.id, areaKey);
  var token = '[prep-parent-key:' + parentKey + ']';
  var sheet = getSheet('Tasks');
  var title = 'Interview prep - ' + interviewPrepAreaLabel(areaKey) + ': ' + round.job + (round.org ? ' at ' + round.org : '');
  var notes = token + '\n[prep-area:' + interviewPrepAreaLabel(areaKey) + ']\n[prep-band:' + band + ']';
  if (areaKey === 'other' && round.customPrepDescription) notes += '\n[custom-prep:' + round.customPrepDescription + ']';
  var existing = findOpenTodoByNoteToken('Interview round', round.id, 'Interview prep', token);
  var id = existing ? existing.id : appendTodoWithSource(title, 'Interview round', round.id, round.org, 'Interview prep',
    'Not started', '', 'Multi-day', notes, 'Interview prep plan', { skipDuplicateCheck: true });
  var todo = getTodoById(id);
  if (!todo || !sheet) return '';
  sheet.getRange(todo.row, COLS.TODO.TASK).setValue(title);
  sheet.getRange(todo.row, COLS.TODO.TIME_EST).setValue('Multi-day');
  sheet.getRange(todo.row, COLS.TODO.NOTES).setValue(notes);
  sheet.getRange(todo.row, COLS.TODO.PLAN_CATEGORY).setValue(interviewPrepAreaLabel(areaKey));
  sheet.getRange(todo.row, COLS.TODO.PLAN_PATTERN).setValue('Step-based');
  sheet.getRange(todo.row, COLS.TODO.LAST_EDITED).setValue(today());
  return id;
}

function upsertInterviewPrepChildTask(round, parentId, areaKey, band, spec, seq) {
  var key = interviewPrepKey(round.id, areaKey, band, seq);
  var token = '[prep-key:' + key + ']';
  var sheet = getSheet('Tasks');
  var title = spec[1] + ': ' + round.job + (round.org ? ' at ' + round.org : '');
  var step = parseInt(spec[0], 10) || seq;
  var timeEst = spec[2] || '30 min';
  var due = interviewPrepDueDate(round.interviewDate, step);
  var notes = token + '\n' + interviewPrepNotesFor(areaKey, band, seq, 'Step-based', areaKey === 'other' ? round.customPrepDescription || '' : '');
  var existing = findOpenTodoByNoteToken('Interview round', round.id, 'Interview prep', token);
  var id = existing ? existing.id : appendTodoWithSource(title, 'Interview round', round.id, round.org, 'Interview prep',
    'Not started', due, timeEst, notes, 'Interview prep plan', { skipDuplicateCheck: true });
  var todo = getTodoById(id);
  if (!todo || !sheet) return '';
  sheet.getRange(todo.row, COLS.TODO.TASK).setValue(title);
  sheet.getRange(todo.row, COLS.TODO.DUE_DATE).setValue(due);
  sheet.getRange(todo.row, COLS.TODO.TIME_EST).setValue(timeEst);
  sheet.getRange(todo.row, COLS.TODO.NOTES).setValue(notes);
  sheet.getRange(todo.row, COLS.TODO.PARENT_ID).setValue(parentId);
  sheet.getRange(todo.row, COLS.TODO.PLAN_CATEGORY).setValue(interviewPrepAreaLabel(areaKey));
  sheet.getRange(todo.row, COLS.TODO.STEP).setValue(step);
  sheet.getRange(todo.row, COLS.TODO.COMMITMENT_CLASS).setValue(assignCommitmentClass('Interview prep', due, round.id, 'Interview round'));
  sheet.getRange(todo.row, COLS.TODO.CLASS_CALC_AT).setValue(today());
  sheet.getRange(todo.row, COLS.TODO.EFFORT_TYPE).setValue(deriveEffortType('Interview prep'));
  sheet.getRange(todo.row, COLS.TODO.LAST_EDITED).setValue(today());
  applyTaskHelperColumns(sheet, todo.row);
  return id;
}

function retireObsoleteInterviewPrepPlanTasks(roundId, activeTokens) {
  var sheet = getSheet('Tasks');
  if (!sheet || !roundId || sheet.getLastRow() < 2) return 0;
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS['To-do'].length).getValues();
  var retired = 0;
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][COLS.TODO.OBJ_TYPE - 1]) !== 'Interview round') continue;
    if (String(data[i][COLS.TODO.OBJ_ID - 1]) !== String(roundId)) continue;
    if (String(data[i][COLS.TODO.WORKFLOW - 1]) !== 'Interview prep') continue;
    if (!isOpenTodoStatus(String(data[i][COLS.TODO.STATUS - 1]))) continue;
    var notes = String(data[i][COLS.TODO.NOTES - 1] || '');
    var match = notes.match(/\[(prep-key|prep-parent-key):([^\]]+)\]/);
    if (!match) continue;
    var token = '[' + match[1] + ':' + match[2] + ']';
    if (activeTokens[token]) continue;
    var r = i + 2;
    sheet.getRange(r, COLS.TODO.STATUS).setValue('Skipped');
    sheet.getRange(r, COLS.TODO.COMPLETED).setValue(today());
    sheet.getRange(r, COLS.TODO.LAST_EDITED).setValue(today());
    appendNoteFlag(sheet, r, COLS.TODO.NOTES, '[skipped] Prep plan changed; task no longer needed.');
    retired++;
  }
  return retired;
}

function upsertInterviewPrepPlanBlock(round, areas, blockers, interviewerNames, notes, otherDescription) {
  var sheet = getSheet('Interviews');
  if (!sheet || !round) return;
  var current = String(sheet.getRange(round.row, COLS.ROUNDS.NOTES).getValue() || '');
  var lines = ['[interview-prep-plan]', 'created: ' + Utilities.formatDate(today(), plannerTimeZone(), 'yyyy-MM-dd'), 'areas:'];
  Object.keys(areas || {}).sort().forEach(function (areaKey) {
    lines.push('- ' + areaKey + ': ' + areas[areaKey]);
  });
  if (blockers) lines.push('blockers: ' + blockers);
  if (interviewerNames) lines.push('interviewers: ' + interviewerNames);
  if (otherDescription) lines.push('other: ' + otherDescription);
  if (notes) lines.push('notes: ' + notes);
  lines.push('[/interview-prep-plan]');
  var block = lines.join('\n');
  current = current.replace(/\[interview-prep-plan\][\s\S]*?\[\/interview-prep-plan\]\s*/g, '').trim();
  sheet.getRange(round.row, COLS.ROUNDS.NOTES).setValue((current ? current + '\n\n' : '') + block);
  appendNoteFlag(sheet, round.row, COLS.ROUNDS.NOTES, '[prep-planned] Prep plan generated');
  clearNoteFlag(sheet, round.row, COLS.ROUNDS.NOTES, '[prep-date-changed]');
}

function parseInterviewPrepPlanBlock(notes) {
  var out = { areas: {}, blockers: '', interviewerNames: '', otherDescription: '', notes: '' };
  var match = String(notes || '').match(/\[interview-prep-plan\]([\s\S]*?)\[\/interview-prep-plan\]/);
  if (!match) return out;
  var lines = match[1].split(/\r?\n/);
  var noteLines = [];
  var readingNotes = false;
  lines.forEach(function (line) {
    var s = String(line || '').trim();
    if (!s) return;
    if (readingNotes) {
      noteLines.push(s);
      return;
    }
    var area = s.match(/^-\s*([^:]+):\s*(.+)$/);
    if (area) {
      out.areas[area[1]] = area[2];
      return;
    }
    if (s.indexOf('blockers:') === 0) out.blockers = s.replace(/^blockers:\s*/, '');
    else if (s.indexOf('interviewers:') === 0) out.interviewerNames = s.replace(/^interviewers:\s*/, '');
    else if (s.indexOf('other:') === 0) out.otherDescription = s.replace(/^other:\s*/, '');
    else if (s.indexOf('notes:') === 0) {
      out.notes = s.replace(/^notes:\s*/, '');
      readingNotes = true;
    }
  });
  if (noteLines.length) out.notes = [out.notes].concat(noteLines).filter(String).join('\n');
  return out;
}

function createInterviewPrepTasksFromPlan(roundId, payload) {
  var round = getRoundById(roundId);
  if (!round) return { created: 0, updated: 0, retired: 0, total: 0 };
  round.customPrepDescription = String((payload && payload.otherDescription) || '');
  var areas = (payload && payload.areas) || {};
  var activeTokens = {};
  var createdOrUpdated = 0, totalMinutes = 0;
  Object.keys(areas).forEach(function (areaKey) {
    var band = areas[areaKey];
    var rows = interviewPrepRowsFor(areaKey, band);
    if (!rows.length) return;
    var parentId = upsertInterviewPrepParentTask(round, areaKey, band);
    if (!parentId) return;
    activeTokens['[prep-parent-key:' + interviewPrepParentKey(round.id, areaKey) + ']'] = true;
    rows.forEach(function (spec, idx) {
      var seq = idx + 1;
      var id = upsertInterviewPrepChildTask(round, parentId, areaKey, band, spec, seq);
      if (id) {
        activeTokens['[prep-key:' + interviewPrepKey(round.id, areaKey, band, seq) + ']'] = true;
        createdOrUpdated++;
        totalMinutes += parseTimeEst(spec[2]) || 0;
      }
    });
  });
  var retired = retireObsoleteInterviewPrepPlanTasks(round.id, activeTokens);
  retired += retireObsoleteInterviewPrepTasks(round.id, { 'Day-before review': true });
  var dayBeforeTime = totalMinutes > 360 ? '90 min' : (totalMinutes >= 180 ? '60 min' : '30 min');
  if (round.interviewDate) {
    upsertInterviewPrepTask(round.id, 'Day-before review', {
      task: 'Day-before review: ' + round.job + (round.org ? ' at ' + round.org : ''),
      org: round.org,
      dueDate: clampDateNotPast(addDays(new Date(round.interviewDate), -1)),
      timeEst: dayBeforeTime,
      notes: 'Review logistics, final notes, top stories, likely questions, interviewer notes, and follow-up plan.'
    });
  }
  upsertInterviewPrepPlanBlock(round, areas, payload && payload.blockers, payload && payload.interviewerNames, payload && payload.notes, payload && payload.otherDescription);
  syncTaskPlanningHelpers();
  return { created: createdOrUpdated, updated: createdOrUpdated, retired: retired, total: totalMinutes };
}

function buildInterviewPrepPlanHtml(roundId, todoId) {
  var round = getRoundById(roundId);
  if (!round) return '<p>Interview round not found.</p>';
  var data = {
    roundId: round.id,
    todoId: todoId || '',
    title: round.job + (round.org ? ' at ' + round.org : ''),
    interviewDate: round.interviewDate ? formatDateHuman(round.interviewDate) : '',
    areas: interviewPrepAreaDefinitions(),
    bands: ['Light', 'Moderate', 'Heavy', 'Extensive'],
    existing: parseInterviewPrepPlanBlock(round.notes || '')
  };
  var json = JSON.stringify(data).replace(/</g, '\\u003c');
  return '' +
    '<style>' +
    'body{font-family:Arial,sans-serif;padding:22px;color:#28251D;background:#FBFBF9;}' +
    'h2{margin:0 0 6px;color:#1B474D;font-size:20px;}p{color:#5F625E;font-size:13px;margin:6px 0 14px;}' +
    '.area{display:grid;grid-template-columns:24px 1fr 145px;gap:8px;align-items:center;border-bottom:1px solid #E8E5DD;padding:9px 0;}' +
    '.area label{font-size:13px;font-weight:bold;color:#1B474D;}select,input,textarea{box-sizing:border-box;width:100%;padding:8px;border:1px solid #D8DAD4;border-radius:5px;font-size:13px;background:#FFF;}' +
    '.small{font-size:12px;color:#5F625E;}textarea{min-height:70px;margin-top:6px;} .field{margin-top:12px;}' +
    '.primary{margin-top:18px;padding:10px 14px;border:0;border-radius:5px;background:#01696F;color:#FFF;font-weight:bold;cursor:pointer;}' +
    '.secondary{margin-top:18px;margin-left:8px;padding:10px 14px;border:1px solid #D8DAD4;border-radius:5px;background:#FFF;color:#1B474D;font-weight:bold;cursor:pointer;}' +
    '#status{font-size:12px;color:#5F625E;margin-top:10px;}</style>' +
    '<h2>Plan interview prep</h2><p id="meta"></p><div id="areas"></div>' +
    '<div class="field"><label class="small">Other prep description, if Other is selected</label><input id="otherDesc"></div>' +
    '<div class="field"><label class="small">Known blockers or unclear items</label><textarea id="blockers"></textarea></div>' +
    '<div class="field"><label class="small">Interviewer names, if known</label><input id="interviewers"></div>' +
    '<div class="field"><label class="small">Notes</label><textarea id="notes"></textarea></div>' +
    '<button class="primary" type="button" onclick="save()">Create prep plan</button><button class="secondary" type="button" onclick="google.script.host.close()">Cancel</button><div id="status"></div>' +
    '<script>var data=' + json + ';document.getElementById("meta").textContent=data.title+(data.interviewDate?" - "+data.interviewDate:"");' +
    'var wrap=document.getElementById("areas");data.areas.forEach(function(a){var row=document.createElement("div");row.className="area";var cb=document.createElement("input");cb.type="checkbox";cb.id="need_"+a.key;var lab=document.createElement("label");lab.htmlFor=cb.id;lab.textContent=a.label;var sel=document.createElement("select");sel.id="band_"+a.key;data.bands.forEach(function(b){var o=document.createElement("option");o.value=b;o.textContent=b;sel.appendChild(o);});row.appendChild(cb);row.appendChild(lab);row.appendChild(sel);wrap.appendChild(row);});' +
    'Object.keys((data.existing&&data.existing.areas)||{}).forEach(function(k){var cb=document.getElementById("need_"+k),sel=document.getElementById("band_"+k);if(cb&&sel){cb.checked=true;sel.value=data.existing.areas[k];}});document.getElementById("otherDesc").value=(data.existing&&data.existing.otherDescription)||"";document.getElementById("blockers").value=(data.existing&&data.existing.blockers)||"";document.getElementById("interviewers").value=(data.existing&&data.existing.interviewerNames)||"";document.getElementById("notes").value=(data.existing&&data.existing.notes)||"";' +
    'function save(){var areas={};data.areas.forEach(function(a){if(document.getElementById("need_"+a.key).checked)areas[a.key]=document.getElementById("band_"+a.key).value;});var status=document.getElementById("status");if(!Object.keys(areas).length){status.textContent="Choose at least one prep area.";return;}if(areas.other&&!String(document.getElementById("otherDesc").value||"").trim()){status.textContent="Describe the Other prep area.";return;}status.textContent="Creating prep tasks...";google.script.run.withSuccessHandler(function(res){res=res||{};if(!res.ok){status.textContent=res.message||"Could not create prep plan.";return;}status.textContent=res.message||"Prep plan created.";setTimeout(function(){google.script.host.close();},900);}).withFailureHandler(function(){status.textContent="Could not create prep plan. Try again from Tasks.";}).completeInterviewPrepPlanFromPopup({roundId:data.roundId,todoId:data.todoId,areas:areas,otherDescription:document.getElementById("otherDesc").value,blockers:document.getElementById("blockers").value,interviewerNames:document.getElementById("interviewers").value,notes:document.getElementById("notes").value});}</script>';
}

function runInterviewPrepPlanPopup(roundId, todoId) {
  var html = HtmlService.createHtmlOutput(buildInterviewPrepPlanHtml(roundId, todoId)).setWidth(700).setHeight(760).setTitle('Plan interview prep');
  SpreadsheetApp.getUi().showModalDialog(html, 'Plan interview prep');
}

function completeInterviewPrepPlanFromPopup(payload) {
  return withDocumentLock(function () {
    try {
      payload = payload || {};
      var round = getRoundById(payload.roundId);
      if (!round) return failResult('I could not find that interview round.', 'roundId', 'ROUND_NOT_FOUND');
      if (!Object.keys((payload && payload.areas) || {}).length) return failResult('Choose at least one prep area.', 'areas', 'MISSING_PREP_AREA');
      if (payload.areas.other && !String(payload.otherDescription || '').trim()) return failResult('Describe the Other prep area.', 'otherDescription', 'MISSING_OTHER_PREP');
      var result = createInterviewPrepTasksFromPlan(round.id, payload);
      if (payload.todoId) {
        var todo = getTodoById(payload.todoId);
        if (todo && todo.workflow === 'Plan interview prep') {
          todo.sheet.getRange(todo.row, COLS.TODO.STATUS).setValue('Done');
          todo.sheet.getRange(todo.row, COLS.TODO.COMPLETED).setValue(today());
          todo.sheet.getRange(todo.row, COLS.TODO.LAST_EDITED).setValue(today());
          appendNoteFlag(todo.sheet, todo.row, COLS.TODO.NOTES, '[planned] Interview prep plan created');
          syncTodayRowForTodo(todo.row, 'Done');
        }
      }
      populateToday();
      refreshHome();
      return okResult('Interview prep plan created: ' + result.created + ' prep task(s), ' + result.retired + ' old task(s) retired.');
    } catch (err) {
      return popupExceptionResult('completeInterviewPrepPlanFromPopup', err);
    }
  }, { label: 'completeInterviewPrepPlanFromPopup', timeoutMs: 30000 });
}

function markInterviewRoundCompleted(roundId, opts) {
  opts = opts || {};
  var round = getRoundById(roundId);
  var sheet = getSheet('Interviews');
  if (!round || !sheet) return false;
  var wasCompleted = String(round.status || '') === 'Completed';
  sheet.getRange(round.row, COLS.ROUNDS.STATUS).setValue('Completed');
  var outcome = String(sheet.getRange(round.row, COLS.ROUNDS.OFFICIAL_OUTCOME).getValue() || '');
  if (!outcome) {
    sheet.getRange(round.row, COLS.ROUNDS.OFFICIAL_OUTCOME).setValue('Waiting');
    outcome = 'Waiting';
  }
  setOpenTodosForTarget('Interview round', roundId, 'Skipped', 'Interview completed',
    ['Interview scheduling', 'Plan interview prep', 'Interview prep', 'Interview prep (Domain scoping)', 'Interview prep (Study)', 'Interview prep (Fit case)', 'Day-before review']);
  createInterviewDebriefTask(roundId);
  if (outcome === 'Waiting') ensureInterviewFollowUpTask(roundId);
  if (opts.forceLog || !wasCompleted) {
    appendInteraction('', '', round.org, today(), 'Auto-log',
      'Interview completed: round ' + (round.round || '?') + ' - ' + round.job, 'System log');
  }
  return true;
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

  if (col === COLS.ROUNDS.ROUND) {
    checkInterviewRoundHealthFlags();
    refreshDerivedPlanningSurfaces();
    requestHomeRefresh();
    return;
  }
  if (col === COLS.ROUNDS.INTERVIEW_DATE) {
    if (newVal) {
      scheduleInterviewRound(roundId, newVal);
    } else {
      sheet.getRange(row, COLS.ROUNDS.STATUS).setValue('To schedule');
      sheet.getRange(row, COLS.ROUNDS.EXPECTED_RESPONSE).setValue('');
      appendTodoOnceForWorkflow('Schedule interview: ' + jobDisplay + (orgDisplay ? ' at ' + orgDisplay : ''), 'Interview round', roundId, orgDisplay, 'Interview scheduling', 'Not started', '', '15 min', 'Set Interview date on the Interviews row when known.', 'Auto-triggered');
      pauseInterviewPrepForReschedule(roundId);
      syncOpenInterviewTaskDates(roundId);
    }
    refreshDerivedPlanningSurfaces();
    requestHomeRefresh();
    return;
  }
  if (col === COLS.ROUNDS.ROUND_TYPE && newVal) {
    var interviewDateForType = sheet.getRange(row, COLS.ROUNDS.INTERVIEW_DATE).getValue();
    if (interviewDateForType) {
      var currentExpected = sheet.getRange(row, COLS.ROUNDS.EXPECTED_RESPONSE).getValue();
      if (interviewExpectedResponseLooksAuto(interviewDateForType, currentExpected)) {
        sheet.getRange(row, COLS.ROUNDS.EXPECTED_RESPONSE).setValue(addDays(new Date(interviewDateForType), REPLY_DAYS_BY_ROUND_TYPE[String(newVal)] || 7));
        syncOpenInterviewTaskDates(roundId);
      }
    }
    refreshDerivedPlanningSurfaces();
    requestHomeRefresh();
    return;
  }
  if (col === COLS.ROUNDS.DOMAIN_READINESS && String(sheet.getRange(row, COLS.ROUNDS.STATUS).getValue()) === 'Scheduled') {
    createInterviewPrepPlanningTask(roundId);
    refreshDerivedPlanningSurfaces();
    requestHomeRefresh();
    return;
  }
  if (col === COLS.ROUNDS.EXPECTED_RESPONSE) {
    updateOpenTodoDueForTargetWorkflow('Interview round', roundId, 'Interview follow-up', newVal || '');
    refreshDerivedPlanningSurfaces();
    requestHomeRefresh();
    return;
  }
  if (col === COLS.ROUNDS.OFFICIAL_OUTCOME) {
    handleInterviewOfficialOutcome(roundId, newVal, { source: 'round-outcome' });
    refreshDerivedPlanningSurfaces();
    requestHomeRefresh();
    return;
  }
  if (col === COLS.ROUNDS.STATUS) {
    if (String(newVal) === 'Completed') {
      markInterviewRoundCompleted(roundId, {});
    }
    if (String(newVal) === 'Reschedule') {
      sheet.getRange(row, COLS.ROUNDS.INTERVIEW_DATE).setValue('');
      sheet.getRange(row, COLS.ROUNDS.EXPECTED_RESPONSE).setValue('');
      appendTodoOnceForWorkflow('Reschedule interview: ' + jobDisplay + (orgDisplay ? ' at ' + orgDisplay : ''), 'Interview round', roundId, orgDisplay, 'Interview scheduling', 'Not started', '', '15 min', 'Find a new time, then update Interview date.', 'Auto-triggered');
      pauseInterviewPrepForReschedule(roundId);
      syncOpenInterviewTaskDates(roundId);
    }
    if (String(newVal) === 'Cancelled') {
      setOpenTodosForTarget('Interview round', roundId, 'Cancelled', 'Interview round cancelled',
        ['Interview scheduling', 'Plan interview prep', 'Interview prep', 'Interview prep (Domain scoping)', 'Interview prep (Study)', 'Interview prep (Fit case)', 'Day-before review', 'Thank-you and debrief', 'Interview follow-up']);
      // v7.7.4: a round can be cancelled after its 'Completed' cascade
      // already raised an INTERVIEW_OUTCOME decision — without this, that
      // decision stays open forever asking for an outcome on a round the
      // user just said never happened. Same idiom as every other
      // terminal-state cascade (Organisation/Job/Person/Sector).
      autoDismissPendingForTarget('Interview round', roundId, 'Interview round cancelled');
    }
    refreshDerivedPlanningSurfaces();
    requestHomeRefresh();
  }
}

function findRoundsNeedingPrep() {
  var sheet = getSheet('Interviews');
  if (!sheet || sheet.getLastRow() < 2) return [];
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, COLS.ROUNDS.NOTES).getValues();
  var todayDate = today(), out = [];
  for (var i = 0; i < data.length; i++) {
    var status = String(data[i][COLS.ROUNDS.STATUS - 1]);
    var interviewDate = data[i][COLS.ROUNDS.INTERVIEW_DATE - 1];
    var notes = String(data[i][COLS.ROUNDS.NOTES - 1] || '');
    var hasPrepPlan = notes.indexOf('[prep-planned]') !== -1 || notes.indexOf('[interview-prep-plan]') !== -1;
    if (status !== 'Scheduled' || hasPrepPlan || !interviewDate) continue;
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
  results.forEach(function (r) {
    appendNoteFlag(sheet, r.row, COLS.ROUNDS.NOTES, '[flags] Prep plan not set - interview prep may be missing');
    createInterviewPrepPlanningTask(String(sheet.getRange(r.row, COLS.ROUNDS.ID).getValue() || ''));
  });
}

function checkInterviewRoundHealthFlags() {
  var sheet = getSheet('Interviews');
  if (!sheet || sheet.getLastRow() < 2) return 0;
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS['Interview rounds'].length).getValues();
  var todayDate = today();
  var flagged = 0;
  var jobIds = jobIdExistsMap();
  var roundIdRows = {};
  var jobRoundRows = {};
  for (var scan = 0; scan < data.length; scan++) {
    var scanRow = scan + 2;
    var scanRoundId = String(data[scan][COLS.ROUNDS.ID - 1] || '');
    var scanJobId = String(data[scan][COLS.ROUNDS.JOB_ID - 1] || '');
    var scanRoundNum = String(data[scan][COLS.ROUNDS.ROUND - 1] || '');
    if (scanRoundId) {
      if (!roundIdRows[scanRoundId]) roundIdRows[scanRoundId] = [];
      roundIdRows[scanRoundId].push(scanRow);
    }
    if (scanJobId && scanRoundNum) {
      var jrKey = scanJobId + '|' + scanRoundNum;
      if (!jobRoundRows[jrKey]) jobRoundRows[jrKey] = [];
      jobRoundRows[jrKey].push(scanRow);
    }
  }
  for (var i = 0; i < data.length; i++) {
    var row = i + 2;
    var roundId = String(data[i][COLS.ROUNDS.ID - 1] || '');
    var jobId = String(data[i][COLS.ROUNDS.JOB_ID - 1] || '');
    var roundNum = String(data[i][COLS.ROUNDS.ROUND - 1] || '');
    var status = String(data[i][COLS.ROUNDS.STATUS - 1] || '');
    var outcome = String(data[i][COLS.ROUNDS.OFFICIAL_OUTCOME - 1] || '');
    var interviewDate = data[i][COLS.ROUNDS.INTERVIEW_DATE - 1];
    var expected = data[i][COLS.ROUNDS.EXPECTED_RESPONSE - 1];
    var notes = String(data[i][COLS.ROUNDS.NOTES - 1] || '');
    if (!roundId) continue;

    if (roundIdRows[roundId] && roundIdRows[roundId].length > 1) {
      appendNoteFlag(sheet, row, COLS.ROUNDS.NOTES, '[duplicate-round-id] Also used on row(s): ' + roundIdRows[roundId].filter(function (r) { return r !== row; }).join(', '));
      flagged++;
    } else {
      clearNoteFlag(sheet, row, COLS.ROUNDS.NOTES, '[duplicate-round-id]');
    }

    var jobRoundKey = jobId && roundNum ? jobId + '|' + roundNum : '';
    if (jobRoundKey && jobRoundRows[jobRoundKey] && jobRoundRows[jobRoundKey].length > 1) {
      appendNoteFlag(sheet, row, COLS.ROUNDS.NOTES, '[duplicate-job-round] Same Job and Round number also on row(s): ' + jobRoundRows[jobRoundKey].filter(function (r) { return r !== row; }).join(', '));
      flagged++;
    } else {
      clearNoteFlag(sheet, row, COLS.ROUNDS.NOTES, '[duplicate-job-round]');
    }

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
    var hasPrepPlan = notes.indexOf('[prep-planned]') !== -1 || notes.indexOf('[interview-prep-plan]') !== -1;
    if (isScheduledWithDate && !hasPrepPlan && daysUntil >= 0 && daysUntil <= 5) {
      appendNoteFlag(sheet, row, COLS.ROUNDS.NOTES, '[missing-prep-plan] Prep plan not set - interview prep may be missing');
      createInterviewPrepPlanningTask(roundId);
      flagged++;
    } else {
      clearNoteFlag(sheet, row, COLS.ROUNDS.NOTES, '[missing-prep-plan]');
      clearNoteFlag(sheet, row, COLS.ROUNDS.NOTES, '[missing-prep]');
    }
    if (isScheduledWithDate && daysUntil < 0) {
      appendNoteFlag(sheet, row, COLS.ROUNDS.NOTES, '[stale-round] Interview date has passed but Status is still Scheduled');
      flagged++;
    } else {
      clearNoteFlag(sheet, row, COLS.ROUNDS.NOTES, '[stale-round]');
    }

    if (status === 'Completed' && (!outcome || outcome === 'Waiting') && expected && new Date(expected) < todayDate) {
      appendNoteFlag(sheet, row, COLS.ROUNDS.NOTES, '[overdue-outcome] Expected response / follow-up date has passed');
      ensureInterviewFollowUpTask(roundId);
      flagged++;
    } else {
      clearNoteFlag(sheet, row, COLS.ROUNDS.NOTES, '[overdue-outcome]');
    }

    if (status === 'Completed' && !interviewDebriefLooksCompleted(notes)) {
      appendNoteFlag(sheet, row, COLS.ROUNDS.NOTES, '[missing-debrief] Add substantive debrief notes');
      createInterviewDebriefTask(roundId);
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
  if (name === 'Today' && col === COLS.TODAY.STATUS && String(e.value || '') === 'Done') {
    try {
      var todayTodoId = String(sheet.getRange(row, COLS.TODAY.TODO_ID).getValue() || '');
      var todayTodo = getTodoById(todayTodoId);
      if (todayTodo && workflowOpensCompletionPopup(todayTodo.workflow)) return true;
    } catch (err) {
      Logger.log('editMayNeedUi Today completion popup check: ' + err);
    }
  }
  if (name === 'Organisations' && col === COLS.ORGS.NAME) return true;
  if (name === 'Jobs' && (col === COLS.JOBS.OPPORTUNITY || col === COLS.JOBS.ORG)) return true;
  if (name === 'People' && (col === COLS.PEOPLE.NAME || col === COLS.PEOPLE.ORG)) return true;
  if (name === 'Tasks' && col === COLS.TODO.STATUS && String(e.value || '') === 'Done') {
    try {
      if (workflowOpensCompletionPopup(sheet.getRange(row, COLS.TODO.WORKFLOW).getValue())) return true;
    } catch (err) {
      Logger.log('editMayNeedUi Tasks completion popup check: ' + err);
    }
  }
  if (name === 'Tasks' && col === COLS.TODO.STATUS && e.range.getNumRows && e.range.getNumRows() > 8) {
    try { return triggerExists(EDIT_TRIGGER_HANDLER, ScriptApp.EventType.ON_EDIT); }
    catch (err) { Logger.log('editMayNeedUi bulk status trigger check: ' + err); return false; }
  }
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
      case 'Tasks': onEditTasks(sheet, row, col, value, e); break;
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
  if (isTaskStatusBulk && numRows > 8) {
    var ui = SpreadsheetApp.getUi();
    var resp = ui.alert('Bulk task status change',
      'You are changing ' + numRows + ' task statuses. This can fire completion cascades and create follow-up tasks or decisions. Continue?',
      ui.ButtonSet.YES_NO);
    if (resp !== ui.Button.YES) return;
  }
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
    parts.push(report.editCreated ? 'edit actions turned on' : 'edit actions already on');
    if (report.timeCreated.length) parts.push('daily/weekly automation turned on: ' + report.timeCreated.join(', '));
    if (report.timeAlready.length && !report.timeCreated.length) parts.push('daily/weekly automation already on');
    SpreadsheetApp.getActiveSpreadsheet().toast(
      'Planner automation checked (' + tz + '). ' + parts.join('; ') + '.', 'The Planner', 6);
  }
  return report;
}

// Menu action: the explicit, user-driven setup. Forces a clean reinstall
// so the user gets a guaranteed-correct trigger set in one click, then
// shows the status so they can verify it took.
function setUpTriggers() {
  ensureTriggersInstalled({ force: true, silent: true });
  checkTriggerHealth();
  showTriggerStatus();
}

// Menu action: read-only status report so the user can verify wiring
// WITHOUT relying on silent auto-wiring. Uses an alert (not a toast) so it
// stays on screen.
function showTriggerStatus() {
  var editOn = triggerExists(EDIT_TRIGGER_HANDLER, ScriptApp.EventType.ON_EDIT);
  var lines = [];
  lines.push('Edit actions and popups: ' + (editOn ? '\u2705 on' : '\u274c off'));
  if (!editOn) lines.push('   \u2192 Run "Triggers & setup \u2192 Set up / verify triggers" to make Home, Today, and Capture update respond.');
  lines.push('');
  lines.push('Daily/weekly automation:');
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

function checkTriggerHealth() {
  var editOn = triggerExists(EDIT_TRIGGER_HANDLER, ScriptApp.EventType.ON_EDIT);
  var missing = [];
  if (!editOn) missing.push(EDIT_TRIGGER_HANDLER);
  TIME_TRIGGER_SPECS.forEach(function (spec) {
    if (!triggerExists(spec.handler, ScriptApp.EventType.CLOCK)) missing.push(spec.handler);
  });
  var props = maintenanceProps();
  props.setProperty('lastTriggerHealthCheckAt', new Date().toISOString());
  props.setProperty('lastTriggerHealthStatus', missing.length ? 'Missing: ' + missing.join(', ') : 'OK');
  if (missing.length) recordMaintenanceError('triggerHealth', 'Missing trigger(s): ' + missing.join(', '));
  else props.deleteProperty('lastMaintenanceError');
  return { ok: !missing.length, missing: missing };
}

function requestHomeRefresh() {
  if (EDIT_BATCH_CONTEXT && EDIT_BATCH_CONTEXT.deferTaskRefresh) {
    EDIT_BATCH_CONTEXT.needsHomeRefresh = true;
    return;
  }
  refreshHome();
}

function refreshDerivedPlanningSurfaces() {
  syncPeopleHelperColumns();
  populateToday();
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

function onEditTasks(sheet, row, col, newVal, e) {
  if (col === COLS.TODO.STATUS && String(newVal || '') === 'Done') {
    var editedTodo = getTodoByRow(sheet, row);
    if (editedTodo.workflow === 'Submit application' && editedTodo.objType === 'Job') {
      var priorStatus = e && e.oldValue && DROPDOWNS.TODO_STATUS.indexOf(String(e.oldValue)) !== -1 ? String(e.oldValue) : 'Not started';
      sheet.getRange(row, COLS.TODO.STATUS).setValue(priorStatus);
      sheet.getRange(row, COLS.TODO.COMPLETED).clearContent();
      runSubmitApplicationPopup(editedTodo.id);
      return;
    }
    if (isApplicationResponseCheckTask(editedTodo)) {
      var priorResponseStatus = e && e.oldValue && DROPDOWNS.TODO_STATUS.indexOf(String(e.oldValue)) !== -1 ? String(e.oldValue) : 'Not started';
      sheet.getRange(row, COLS.TODO.STATUS).setValue(priorResponseStatus);
      sheet.getRange(row, COLS.TODO.COMPLETED).clearContent();
      runApplicationResultPopup(editedTodo.id);
      return;
    }
    if (isReferralSearchContactTask(editedTodo)) {
      var priorReferralStatus = e && e.oldValue && DROPDOWNS.TODO_STATUS.indexOf(String(e.oldValue)) !== -1 ? String(e.oldValue) : 'Not started';
      sheet.getRange(row, COLS.TODO.STATUS).setValue(priorReferralStatus);
      sheet.getRange(row, COLS.TODO.COMPLETED).clearContent();
      runReferralSearchResultPopup(editedTodo.id);
      return;
    }
    if (isInterviewPrepPlanningTask(editedTodo)) {
      var priorPrepStatus = e && e.oldValue && DROPDOWNS.TODO_STATUS.indexOf(String(e.oldValue)) !== -1 ? String(e.oldValue) : 'Not started';
      sheet.getRange(row, COLS.TODO.STATUS).setValue(priorPrepStatus);
      sheet.getRange(row, COLS.TODO.COMPLETED).clearContent();
      runInterviewPrepPlanPopup(editedTodo.objId, editedTodo.id);
      return;
    }
    if (isSourceLedScanTask(editedTodo)) {
      var priorSourceStatus = e && e.oldValue && DROPDOWNS.TODO_STATUS.indexOf(String(e.oldValue)) !== -1 ? String(e.oldValue) : 'Not started';
      sheet.getRange(row, COLS.TODO.STATUS).setValue(priorSourceStatus);
      sheet.getRange(row, COLS.TODO.COMPLETED).clearContent();
      runSourceScanResultPopup(editedTodo.id);
      return;
    }
  }
  if (col === COLS.TODO.STATUS || col === COLS.TODO.DUE_DATE || col === COLS.TODO.TIME_EST) sheet.getRange(row, COLS.TODO.LAST_EDITED).setValue(today());
  if (col === COLS.TODO.STATUS || col === COLS.TODO.DUE_DATE) {
    sheet.getRange(row, COLS.TODO.COMMITMENT_CLASS).setValue(assignCommitmentClass(
      String(sheet.getRange(row, COLS.TODO.WORKFLOW).getValue()), sheet.getRange(row, COLS.TODO.DUE_DATE).getValue(),
      String(sheet.getRange(row, COLS.TODO.OBJ_ID).getValue()), String(sheet.getRange(row, COLS.TODO.OBJ_TYPE).getValue())));
    sheet.getRange(row, COLS.TODO.CLASS_CALC_AT).setValue(today());
  }
  if (col === COLS.TODO.TIME_EST) syncTodayEstMinForTodo(sheet, row);
  if (col === COLS.TODO.STATUS) {
    completeTodoRow(sheet, row, newVal, { source: 'tasks' });
    return;
  }
  var todayAffectingCols = [
    COLS.TODO.DUE_DATE, COLS.TODO.TIME_EST, COLS.TODO.COMMITMENT_CLASS,
    COLS.TODO.PARENT_ID, COLS.TODO.PLAN_PATTERN, COLS.TODO.STEP,
    COLS.TODO.BLOCKER, COLS.TODO.BLOCKED_BY_ID
  ];
  var helperAffectingCols = todayAffectingCols.concat([COLS.TODO.NOTES, COLS.TODO.PLAN_CATEGORY]);
  if (helperAffectingCols.indexOf(col) !== -1) {
    syncTaskPlanningHelpers();
    if (todayAffectingCols.indexOf(col) !== -1) {
      populateToday();
      return;
    }
    requestHomeRefresh();
  }
}

// =============================================================
// TODAY — the daily operating surface
// =============================================================

// v7.4: value cells moved off column B — they used to share a cell with
// their own label (same bug pattern as the old B3 update-type cell: the
// label write was always clobbered by the value write two lines later,
// so "Priority / focus"/"Available minutes"/"Energy" never actually
// rendered). Column D holds the value next to each row's label.
var TODAY_CELLS = {
  PRIORITY: 'D4', AVAILABLE_MIN: 'D5', ENERGY: 'D6'
};

// Checkbox-as-button, same convention as HOME_REFRESH_ROW/TODAY_ENDOFDAY_ROW:
// a self-resetting checkbox that calls populateToday() on tick, so refreshing
// Today's plan is a visible on-sheet action rather than menu-only.
var TODAY_REFRESH_ROW = 7;
var TODAY_REFRESH_COL = 2;

var TODAY_TABLE_HEADER_ROW = 10;
var TODAY_TABLE_FIRST_ROW = 11;
var TODAY_TABLE_LAST_ROW = 40;

// v7.4: sections below the Commit/Options table - "Needs planning"
// (Multi-day Phase 1), "Progress" (replaces the capacity-fit formula +
// done counter), and "End of day" (relocated from a menu-only action).
var TODAY_NEEDS_PLANNING_HEADER_ROW = 42;
var TODAY_NEEDS_PLANNING_FIRST_ROW = 43;
var TODAY_NEEDS_PLANNING_LAST_ROW = 47;   // 5 rows max

var TODAY_PROGRESS_HEADER_ROW = 49;
var TODAY_PROGRESS_LINE1_ROW = 50;
var TODAY_PROGRESS_LINE2_ROW = 51;

var TODAY_ENDOFDAY_HEADER_ROW = 53;
var TODAY_ENDOFDAY_ROW = 54;
var TODAY_ENDOFDAY_COL = 2;

// Multi-day tasks flagged [needs planning] after this many days
// untouched (see runQueueHygiene) — same idiom as the other staleness
// thresholds there, picked to sit between the "HOT" (>3d) and "stale
// active pursuit" (>=10d) thresholds since an un-broken-down Multi-day
// task is invisible to Today the whole time, not just occasionally.
var MULTIDAY_NEEDS_PLANNING_DAYS = 5;

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

function hardResetTodaySheet(sheet) {
  var maxRows = Math.max(sheet.getMaxRows(), TODAY_ENDOFDAY_ROW);
  var maxCols = Math.max(sheet.getMaxColumns(), HEADERS["Today's plan"].length);
  try { sheet.getRange(1, 1, maxRows, maxCols).breakApart(); } catch (err) { }
  try { sheet.getRange(1, 1, maxRows, maxCols).clearDataValidations(); } catch (err) { }
  try { sheet.getRange(1, 1, maxRows, maxCols).clearFormat(); } catch (err) { }
  try { sheet.getRange(1, 1, maxRows, maxCols).clearContent(); } catch (err) { }
  try { sheet.getRange(1, 1, maxRows, maxCols).clearNote(); } catch (err) { }
}

function clearTodayPlanHeadlineValidation(sheet) {
  try { sheet.getRange('B3:I3').clearDataValidations(); } catch (err) { }
  try { sheet.getRange('B3').clearDataValidations(); } catch (err2) { }
}

function bootstrapToday() {
  var sheet = ensureTodaySheet();
  hardResetTodaySheet(sheet);
  sheet.setTabColor(ZONE_WORK_COLOR);

  sheet.getRange('A1:I1').merge().setValue('Today').setFontSize(16).setFontWeight('bold').setFontColor('#FFFFFF').setBackground(HEADER_COLOR);
  var homeSheetForToday = getSheet('Home');
  if (homeSheetForToday) sheet.getRange('A2').setFormula('=HYPERLINK("#gid=' + homeSheetForToday.getSheetId() + '","Home")').setFontSize(9).setFontColor('#01696F').setFontWeight('bold');
  var guideSheetForToday = getSheet('Guide');
  if (guideSheetForToday) sheet.getRange('A3').setFormula('=HYPERLINK("#gid=' + guideSheetForToday.getSheetId() + '","Guide")').setFontSize(9).setFontColor('#01696F').setFontWeight('bold');

  // Row 2: live current-date display, decoupled from the plan itself —
  // it's a =TODAY() formula so it's always correct regardless of when
  // the plan was last (re)generated. The plan's own staleness tracking
  // lives in the todayPlanBuiltDate document property instead (see
  // getTodayPlanBuiltDate/setTodayPlanBuiltDate).
  sheet.getRange('B2:I2').merge().setFormula('=TODAY()').setNumberFormat('dddd d MMMM').setFontColor('#5F625E');

  // Row 3: plan-summary headline. populateTodayImpl replaces this
  // placeholder with the real counts once stagedTodaySelection has run.
  clearTodayPlanHeadlineValidation(sheet);
  sheet.getRange('B3:I3').merge()
    .setValue("Plan not built yet - tick below to build today's plan.")
    .setFontWeight('bold')
    .setFontColor(HEADER_COLOR)
    .setWrap(true);

  sheet.getRange('B4').setValue('Focus').setFontWeight('bold');
  sheet.getRange(TODAY_CELLS.PRIORITY).setValue('Default');
  setDropdown(sheet.getRange(TODAY_CELLS.PRIORITY), DROPDOWNS.TODAY_PRIORITY);

  sheet.getRange('B5').setValue('Available minutes').setFontWeight('bold');
  sheet.getRange(TODAY_CELLS.AVAILABLE_MIN).setValue(90).setNumberFormat('0');

  sheet.getRange('B6').setValue('Energy').setFontWeight('bold');
  sheet.getRange(TODAY_CELLS.ENERGY).setValue('Normal');
  setDropdown(sheet.getRange(TODAY_CELLS.ENERGY), DROPDOWNS.TODAY_ENERGY);

  sheet.getRange(TODAY_REFRESH_ROW, TODAY_REFRESH_COL).setValue(false).insertCheckboxes().setBackground(MANUAL_COLOR);
  sheet.getRange(TODAY_REFRESH_ROW, TODAY_REFRESH_COL + 1, 1, 6).merge()
    .setValue("Build / refresh Today's plan").setFontWeight('bold').setFontSize(12).setFontColor('#FFFFFF').setBackground(HEADER_COLOR);

  sheet.getRange(TODAY_TABLE_HEADER_ROW, 1, 1, HEADERS["Today's plan"].length).setValues([HEADERS["Today's plan"]]).setFontWeight('bold').setBackground('#DDEEEF');
  setDropdown(sheet.getRange(TODAY_TABLE_FIRST_ROW, COLS.TODAY.STATUS, 30, 1), DROPDOWNS.TODAY_STATUS);
  sheet.getRange(TODAY_TABLE_FIRST_ROW, COLS.TODAY.EST_MIN, 30, 1).setNumberFormat('0');
  sheet.getRange(TODAY_TABLE_FIRST_ROW, COLS.TODAY.ACTUAL_MIN, 30, 1).setNumberFormat('0');
  sheet.getRange(TODAY_TABLE_FIRST_ROW, COLS.TODAY.TASK, 30, 1).setWrap(true);
  sheet.getRange(TODAY_TABLE_FIRST_ROW, COLS.TODAY.NOTES, 30, 1).setWrap(true);
  sheet.setFrozenRows(TODAY_TABLE_HEADER_ROW);

  sheet.getRange(TODAY_NEEDS_PLANNING_HEADER_ROW, 2, 1, 7).merge().setValue('Needs planning').setFontWeight('bold').setFontColor('#FFFFFF').setBackground(HEADER_COLOR);

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
//   7. Add pipeline-building work when it fits
//   8. Keep a time buffer, but fill usable spare capacity with any task that fits
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

function appendTodayTag(tags, tag) {
  tag = String(tag || '').trim();
  if (!tag) return String(tags || '').trim();
  var out = String(tags || '').trim();
  var lower = out.toLowerCase();
  if (lower.indexOf(tag.toLowerCase()) !== -1) return out;
  return (out ? out + ' ' : '') + tag;
}

function todayVisibleReasonTag(reason, treatment, status) {
  var r = String(reason || '').toLowerCase();
  if (String(status || '') === 'Blocked') return '[Blocked]';
  if (treatment === 'Option') return '[Option]';
  if (r.indexOf('locked') !== -1) return '[Locked]';
  if (r.indexOf('pulled') !== -1) return '[Pulled]';
  if (r.indexOf('fixed') !== -1) return '[Fixed]';
  if (r.indexOf('blocking') !== -1) return '[Blocking]';
  if (r.indexOf('keep-alive') !== -1 || r.indexOf('due') !== -1 || r.indexOf('overdue') !== -1) return '[Due]';
  if (r.indexOf('matches') !== -1 || r.indexOf('focus') !== -1) return r.indexOf('outside') !== -1 ? '[Outside focus]' : '[Focus]';
  if (r.indexOf('pipeline') !== -1) return '[Pipeline]';
  if (r.indexOf('spare') !== -1 || r.indexOf('backlog') !== -1 || r.indexOf('capacity available') !== -1) return '[Spare]';
  return '';
}

function addTodayRowTag(sheet, row, tag) {
  var cell = sheet.getRange(row, COLS.TODAY.NOTES);
  var split = splitTodayNotes(String(cell.getValue() || ''));
  cell.setValue(composeTodayNotes(appendTodayTag(split.tags, tag), split.userNote));
}

function collectPreviousTodayState(sheet) {
  var state = { sameDay: false, ordered: [], byTodoId: {} };
  var builtDate = getTodayPlanBuiltDate();
  if (builtDate) state.sameDay = builtDate.getTime() === today().getTime();
  if (!state.sameDay) {
    var noteDate = todayPlanDateFromNote(sheet.getRange('B3').getNote());
    if (noteDate) state.sameDay = noteDate.getTime() === today().getTime();
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
  var data = todoSheet.getRange(2, 1, todoSheet.getLastRow() - 1, HEADERS['To-do'].length).getValues();
  var planningCtx = buildTaskPlanningContext(data);
  var todayDate = today();
  var pool = [];
  for (var i = 0; i < data.length; i++) {
    var status = String(data[i][COLS.TODO.STATUS - 1]);
    if (status !== 'Not started' && status !== 'In progress') continue;
    var task = String(data[i][COLS.TODO.TASK - 1] || '');
    if (!task) continue;
    var readyState = deriveReadyForTodayFromRow(data[i], planningCtx);
    if (readyState !== 'Ready') continue;
    var estMin = parseTimeEst(String(data[i][COLS.TODO.TIME_EST - 1] || '30 min'));
    if (estMin === null) continue; // Multi-day - never enters Today; needs planning first
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
  if (focus === 'Applications') return ['Application preparation', 'Application blocker', 'Referral search', 'Submit application', 'Check application response', 'Offer decision', 'Opportunity scan'].indexOf(workflow) !== -1;
  if (focus === 'Networking') return objType === 'Person' || workflow === 'People source scan';
  if (focus === 'Interviews') return objType === 'Interview round' || /Interview/.test(workflow);
  if (focus === 'Pipeline building') return ['Market mapping', 'Org job scan', 'Opportunity scan', 'People sourcing', 'People source scan', 'Sector selection', ORG_CLASSIFICATION_WORKFLOW, 'Org research'].indexOf(workflow) !== -1;
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

function buildCurrentTaskStateForToday() {
  var sheet = getSheet('Tasks');
  var byId = {};
  if (!sheet || sheet.getLastRow() < 2) return byId;
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS['To-do'].length).getValues();
  var ctx = buildTaskPlanningContext(data);
  for (var i = 0; i < data.length; i++) {
    var id = String(data[i][COLS.TODO.ID - 1] || '');
    if (!id) continue;
    byId[id] = {
      exists: true,
      status: String(data[i][COLS.TODO.STATUS - 1] || ''),
      readyState: deriveReadyForTodayFromRow(data[i], ctx),
      task: String(data[i][COLS.TODO.TASK - 1] || ''),
      estMin: parseTimeEst(String(data[i][COLS.TODO.TIME_EST - 1] || '30 min')),
      effort: String(data[i][COLS.TODO.EFFORT_TYPE - 1] || ''),
      cls: String(data[i][COLS.TODO.COMMITMENT_CLASS - 1] || '')
    };
  }
  return byId;
}

function preservedTodayRowStillExecutable(rs, currentState) {
  if (!rs || !rs.todoId || !currentState) return false;
  if (isTerminalTodoStatus(currentState.status)) return false;
  if (currentState.status === 'Blocked') return rs.status === 'Blocked';
  return currentState.readyState === 'Ready' || currentState.status === 'In progress';
}

// The staged selector itself. Returns { commit: [...], options: [...] }.
function stagedTodaySelection(previousState, availableMinutes, focus, energy) {
  var tierLookup = buildOrgTierLookup();
  var pool = collectTaskPool(focus, tierLookup);
  var byId = {};
  pool.forEach(function (p) { byId[p.todoId] = p; });
  var currentStateById = buildCurrentTaskStateForToday();
  var energyLow = energy === 'Low';

  var commit = [];
  var options = [];
  var usedIds = {};
  var bufferMin = availableMinutes <= 30 ? 0 : Math.max(15, Math.round(availableMinutes * 0.1));
  var capacity = Math.max(0, availableMinutes - bufferMin);
  var minutesUsed = 0;
  var requiredMin = 0;
  var minimumMin = 0;
  var minimumCount = 0;

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
    if (item.cls === 'Fixed' || item.cls === 'Blocking') requiredMin += item.estMin || 0;
    if (item.cls === 'Fixed' || item.cls === 'Blocking' || /^Keep-alive due/i.test(String(reason || ''))) {
      minimumCount++;
      minimumMin += item.estMin || 0;
    }
  }

  // Stage 1 — manually pulled-in tasks (locked or explicitly pulled)
  previousState.ordered.forEach(function (rs) {
    if (!rs.todoId || !(rs.locked || rs.pulled)) return;
    var current = currentStateById[rs.todoId];
    if (!preservedTodayRowStillExecutable(rs, current)) return;
    var candidate = byId[rs.todoId] || { todoId: rs.todoId, task: current.task || rs.task, estMin: current.estMin || rs.estMin, effort: current.effort || rs.effort, cls: current.cls };
    addCommit(candidate, rs.locked ? 'locked in place' : 'manually pulled into Today');
  });

  // Stage 2 — tasks already in progress or already touched today (incl.
  // Done/Skipped/Cancelled today, so the day's record doesn't vanish on refresh)
  previousState.ordered.forEach(function (rs) {
    if (!rs.todoId || usedIds[rs.todoId]) return;
    var touchedToday = rs.status === 'In progress' || rs.status === 'Blocked' || rs.status === 'Done' || rs.status === 'Skipped' || rs.status === 'Cancelled';
    if (!touchedToday) return;
    if (!currentStateById[rs.todoId]) return;
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

  // Stage 7 — pipeline-building work, capacity-gated like other flexible
  // work. It should flow in when there is room, but a no-deadline 20 min
  // task should not appear in a 15 min day.
  // §2.2: Tier now comes before age (was pure FIFO) — same comparator as
  // Active pursuit, so a newly-important Tier-A item no longer waits
  // behind an older Tier-C one. §5: Low energy still sinks Deep-effort.
  var pipelineCandidates = pool.filter(function (p) { return p.cls === 'Pipeline-building' && !usedIds[p.todoId]; })
    .sort(compareForStage(energyLow));
  pipelineCandidates.forEach(function (p) {
    if (minutesUsed + p.estMin <= capacity) addCommit(p, 'pipeline-building — fits today');
  });

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

  // Stage 8.5 — Backlog fill: deadline-bearing and focus-relevant work
  // above always wins the capacity first, but idle capacity shouldn't
  // sit empty just because what's left is ad-hoc/Admin-class Backlog.
  // Items that don't fit fall through to Stage 9's options fallback below
  // like anything else, rather than being permanently hidden.
  pool.filter(function (p) { return p.cls === 'Backlog' && !usedIds[p.todoId]; })
    .sort(compareForStage(energyLow))
    .forEach(function (p) {
      if (minutesUsed + p.estMin <= capacity) { usedIds[p.todoId] = true; addCommit(p, 'backlog — filling spare capacity'); }
    });

  // Stage 8.75 — final fit pass. If any open task still fits inside the
  // usable capacity, include it rather than leaving time idle. This keeps
  // the buffer intact while avoiding the frustrating "there was room, why
  // didn't it pull something?" failure mode.
  pool.filter(function (p) { return !usedIds[p.todoId]; })
    .sort(compareForStage(energyLow))
    .forEach(function (p) {
      if (minutesUsed + p.estMin <= capacity) addCommit(p, 'spare capacity — fits today');
    });

  // Stage 9 — remaining near-misses (including Backlog that missed on
  // capacity above) go to Options, capped at 6.
  pool.forEach(function (p) {
    if (usedIds[p.todoId] || options.length >= 6) return;
    var pv4 = preserved(p.todoId);
    var optionReason = p.estMin > availableMinutes
      ? 'does not fit today\'s available time'
      : 'not selected today — capacity or priority';
    options.push({ todoId: p.todoId, task: p.task, estMin: p.estMin, effort: p.effort, reason: optionReason, tags: pv4.tags, userNote: pv4.userNote });
  });
  // Stage 10 — everything not in commit or options simply isn't written
  // to Today. It's still fully visible and workable from Tasks.

  return { commit: commit, options: options, minutesUsed: minutesUsed, requiredMin: requiredMin, minimumCount: minimumCount, minimumMin: minimumMin, bufferMin: bufferMin };
}

function populateToday() {
  // v7.3: guarded so the direct menu path ("Build / refresh Today's plan") is
  // serialised too. When called from an already-locked context (edits,
  // dailyMaintenance) the re-entrancy guard runs the body directly.
  return withDocumentLock(populateTodayImpl, { label: 'populateToday' });
}

function todayCapacityHeadline(selection, availableMinutes) {
  var planned = selection.minutesUsed || 0;
  var required = selection.requiredMin || 0;
  var minimumMin = selection.minimumMin || 0;
  var minimumCount = selection.minimumCount || 0;
  var taskText = selection.commit.length + ' task' + (selection.commit.length === 1 ? '' : 's');
  var minimumText = 'Minimum day: ' + minimumCount + ' task' + (minimumCount === 1 ? '' : 's') + ', ' + minimumMin + ' min.';
  if (!selection.commit.length) {
    return selection.options.length
      ? 'Today is ready - nothing fits in ' + availableMinutes + ' min; ' + selection.options.length + ' option' + (selection.options.length === 1 ? '' : 's') + ' below.'
      : 'Today is ready - nothing committed yet.';
  }
  if (required > availableMinutes) return 'Deadline/blocking work exceeds capacity - ' + required + ' min required, ' + availableMinutes + ' available. ' + minimumText;
  if (planned > availableMinutes) return 'Today is over capacity - ' + planned + ' min planned against ' + availableMinutes + ' available; over by ' + (planned - availableMinutes) + ' min. ' + minimumText;
  if (planned > Math.round(availableMinutes * 0.85)) return 'Today is tight - ' + taskText + ' - recommended ' + planned + ' of ' + availableMinutes + ' min. ' + minimumText;
  return 'Today is realistic - ' + taskText + ' - recommended ' + planned + ' of ' + availableMinutes + ' min. ' + minimumText;
}

function populateTodayImpl() {
  var sheet = ensureTodaySheet();
  if (sheet.getMaxRows() < TODAY_ENDOFDAY_ROW || !sheet.getRange(1, 1).getValue()) bootstrapToday();
  var previousState = collectPreviousTodayState(sheet);

  var availableMinutes = parseInt(sheet.getRange(TODAY_CELLS.AVAILABLE_MIN).getValue(), 10);
  if (isNaN(availableMinutes) || availableMinutes <= 0) availableMinutes = 90;
  var focus = String(sheet.getRange(TODAY_CELLS.PRIORITY).getValue() || 'Default');
  var energy = String(sheet.getRange(TODAY_CELLS.ENERGY).getValue() || 'Normal');

  var selection = stagedTodaySelection(previousState, availableMinutes, focus, energy);

  setTodayPlanBuiltDate(today());
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

  var unplannedMin = Math.max(0, availableMinutes - selection.minutesUsed);
  var headline = selection.commit.length
    ? 'Today’s plan is ready — ' + selection.commit.length + ' task' + (selection.commit.length === 1 ? '' : 's') +
      ' · ' + selection.minutesUsed + ' min planned · ' + unplannedMin + ' min unplanned'
    : (selection.options.length
      ? 'Today’s plan is ready — nothing fits in ' + availableMinutes + ' min; ' + selection.options.length + ' option' + (selection.options.length === 1 ? '' : 's') + ' below.'
      : 'Today’s plan is ready — nothing committed yet.');
  clearTodayPlanHeadlineValidation(sheet);
  headline = todayCapacityHeadline(selection, availableMinutes);
  sheet.getRange('B3').setValue(headline).setNote(todayPlanBuiltDateNote(today()) +
    '\nMinimum day: ' + (selection.minimumCount || 0) + ' task(s), ' + (selection.minimumMin || 0) + ' min' +
    '\nRecommended day: ' + selection.commit.length + ' task(s), ' + selection.minutesUsed + ' min' +
    '\nBuffer kept: ' + (selection.bufferMin || 0) + ' min');

  renderTodayDecisionCards();
  renderNeedsPlanning(sheet);
  updateTodayProgress(sheet);
  refreshHome();
  var toastMsg = 'Today refreshed - ' + selection.commit.length + ' commit, ' + selection.options.length + ' option(s), ' + unplannedMin + ' min unplanned.';
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
    if (!slot) {
      sheet.getRange(r, COLS.TODAY.STATUS).clearDataValidations();
      continue;
    }
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

// v7.4 §4.1: tasks that need planning before Today can pull them.
function needsPlanningReasonForRow(row, ctx) {
  var id = String(row[COLS.TODO.ID - 1] || '');
  var status = String(row[COLS.TODO.STATUS - 1] || '');
  var notes = String(row[COLS.TODO.NOTES - 1] || '');
  var blocker = String(row[COLS.TODO.BLOCKER - 1] || '');
  var blockedById = String(row[COLS.TODO.BLOCKED_BY_ID - 1] || '');
  var readyState = deriveReadyForTodayFromRow(row, ctx);

  if (status === 'Blocked') {
    if (!blocker || blocker === 'Blocked - add reason') return { reason: 'Blocked without a clear reason', suggestedAction: 'Add the blocker, or use Row actions > Unblock selected Task' };
    if (!blockedById) return { reason: 'Blocked without an unblocker task', suggestedAction: 'Use Row actions > Mark selected Task blocked to add an unblocker, or unblock it' };
    var blockerTask = ctx.byId[blockedById];
    if (!blockerTask) return { reason: 'Blocked by a missing task', suggestedAction: 'Clear the stale blocked-by link, or create a new unblocker' };
    if (isTerminalTodoStatus(String(blockerTask.data[COLS.TODO.STATUS - 1] || ''))) return { reason: 'Unblocker is complete', suggestedAction: 'Use Row actions > Unblock selected Task' };
    return null;
  }

  if (status !== 'Not started' && status !== 'In progress') return null;
  if (taskHasBrokenSourceNotes(notes)) return { reason: 'Broken or missing source link', suggestedAction: 'Repair the linked source row before doing this task' };
  if (taskLinkedSourceIsTerminal(row, ctx)) return { reason: 'Linked source is closed, parked, or retired', suggestedAction: 'Cancel this task, reopen the source, or relink it to live work' };
  if (readyState === 'Needs planning') return { reason: 'Needs breakdown or a usable time estimate', suggestedAction: 'Use Row actions > Make selected Task multi-step' };
  if (notes.indexOf('[parent-ready]') !== -1) return { reason: 'Child tasks are done; source update still needs recording', suggestedAction: 'Complete the parent task to open the required popup' };
  if (notes.indexOf('[needs planning]') !== -1) return { reason: 'Flagged for planning', suggestedAction: 'Clarify the next action or break it down' };
  if (notes.indexOf('[needs breakdown]') !== -1) return { reason: 'Needs breakdown', suggestedAction: 'Use Row actions > Make selected Task multi-step' };
  if (allChildTodosTerminalInContext(id, ctx) && !allChildTodosDoneInContext(id, ctx)) {
    return { reason: 'Child tasks are finished, but not all were Done', suggestedAction: 'Review skipped/cancelled children, then close or revise the parent' };
  }
  return null;
}

function collectNeedsPlanningTasks(limit) {
  limit = limit || 5;
  var sheet = getSheet('Tasks');
  if (!sheet || sheet.getLastRow() < 2) return [];
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS['To-do'].length).getValues();
  var ctx = buildTaskPlanningContext(data);
  var out = [];
  for (var i = 0; i < data.length && out.length < limit; i++) {
    var reason = needsPlanningReasonForRow(data[i], ctx);
    if (!reason) continue;
    out.push({
      todoId: String(data[i][COLS.TODO.ID - 1]),
      task: String(data[i][COLS.TODO.TASK - 1] || ''),
      reason: reason.reason,
      suggestedAction: reason.suggestedAction
    });
  }
  return out;
}

function renderNeedsPlanning(sheet) {
  sheet = sheet || getSheet('Today');
  if (!sheet) return;
  var limit = TODAY_NEEDS_PLANNING_LAST_ROW - TODAY_NEEDS_PLANNING_FIRST_ROW + 1;
  var items = collectNeedsPlanningTasks(limit);
  try { sheet.getRange(TODAY_NEEDS_PLANNING_FIRST_ROW, 2, limit, 7).breakApart(); } catch (err) { /* not merged, ignore */ }
  sheet.getRange(TODAY_NEEDS_PLANNING_FIRST_ROW, 2, limit, 7).clearContent();
  if (!items.length) {
    sheet.getRange(TODAY_NEEDS_PLANNING_FIRST_ROW, 2, 1, 7).merge().setValue('Nothing needs planning.').setFontColor('#5F625E');
    return;
  }
  items.forEach(function (item, idx) {
    sheet.getRange(TODAY_NEEDS_PLANNING_FIRST_ROW + idx, 2, 1, 7).merge()
      .setValue(item.task + ' - ' + item.reason + '. ' + item.suggestedAction).setFontColor('#964219');
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
  var visibleTags = appendTodayTag(item.tags, todayVisibleReasonTag(item.reason, treatment, status));
  sheet.getRange(row, COLS.TODAY.NOTES).setValue(composeTodayNotes(visibleTags, item.userNote))
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
  if (moreRow) sheet.getRange('A' + moreRow + ':' + lastCol + moreRow).clearContent().clearNote().setBackground(null);

  slots.forEach(function (slot) {
    sheet.getRange(slot.id).setValue('');
    sheet.getRange(slot.text).setValue('').setBackground(null);
    sheet.getRange(slot.action).setValue('').setBackground(null).clearDataValidations();
  });

  if (!pendingList.length) {
    sheet.getRange(slots[0].text).setValue('✓ No pending decisions - work from Today.').setBackground(null).setFontColor('#437A22').setFontWeight('bold');
    return;
  }

  pendingList.forEach(function (pending, idx) {
    var slot = slots[idx];
    var data = pending.data;
    var id = data[COLS.DECISIONS.ID - 1];
    var trigger = data[COLS.DECISIONS.TRIGGER - 1] || 'Decision';
    var task = data[COLS.DECISIONS.TASK - 1] || '';
    var notes = data[COLS.DECISIONS.NOTES - 1] || '';
    var actionType = data[COLS.DECISIONS.ACTION_TYPE - 1] || inferDecisionActionType(data[COLS.DECISIONS.KEY - 1], data[COLS.DECISIONS.TARGET_TYPE - 1], data[COLS.DECISIONS.WORKFLOW - 1], task);
    var timing = decisionReviewTimingLabel(data[COLS.DECISIONS.DUE_DATE - 1]);
    var linked = decisionLinkedLabel(data[COLS.DECISIONS.TARGET_TYPE - 1], data[COLS.DECISIONS.TARGET_ID - 1]);
    var meta = timing + ' - ' + actionType + (linked ? ' - ' + linked : '');
    sheet.getRange(slot.id).setValue(id);
    sheet.getRange(slot.text)
      .setValue(meta + '\n' + task)
      .setBackground('#EAF4F5').setFontColor('#1B474D').setFontWeight('bold').setWrap(true)
      .setNote('Why: ' + trigger + (linked ? '\nLinked to: ' + linked : '') + (notes ? '\nNotes: ' + notes : ''));
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
  if (action === 'Yes' && accepted && accepted.ok && !accepted.popupOpened) populateToday();
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
      var mapped = todayStatusFromTodoStatus(status);
      planSheet.getRange(r, COLS.TODAY.STATUS).setValue(mapped);
      if (mapped === 'Done' && !planSheet.getRange(r, COLS.TODAY.ACTUAL_MIN).getValue()) {
        planSheet.getRange(r, COLS.TODAY.ACTUAL_MIN).setValue(planSheet.getRange(r, COLS.TODAY.EST_MIN).getValue() || '');
      }
      updateTodayProgress(planSheet);
      return;
    }
  }
}

function deferTodoById(todoId, days, source) {
  var todo = getTodoById(String(todoId || ''));
  if (!todo) return false;
  days = days || 3;
  var due = addDays(today(), days);
  todo.sheet.getRange(todo.row, COLS.TODO.STATUS).setValue('Not started');
  todo.sheet.getRange(todo.row, COLS.TODO.DUE_DATE).setValue(due);
  todo.sheet.getRange(todo.row, COLS.TODO.LAST_EDITED).setValue(today());
  todo.sheet.getRange(todo.row, COLS.TODO.COMMITMENT_CLASS).setValue(assignCommitmentClass(
    String(todo.sheet.getRange(todo.row, COLS.TODO.WORKFLOW).getValue()), due,
    String(todo.sheet.getRange(todo.row, COLS.TODO.OBJ_ID).getValue()), String(todo.sheet.getRange(todo.row, COLS.TODO.OBJ_TYPE).getValue())));
  todo.sheet.getRange(todo.row, COLS.TODO.CLASS_CALC_AT).setValue(today());
  appendNoteFlag(todo.sheet, todo.row, COLS.TODO.NOTES, '[deferred] pushed ' + days + ' days' + (source ? ' from ' + source : ''));
  return true;
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
      updateTodayProgress(planSheet);
      return;
    }
  }
}

// -------------------------------------------------------------
// onEditToday — the single handler for every interactive cell on Today
// -------------------------------------------------------------

function onEditToday(sheet, row, col, newVal) {
  if ((row === 4 || row === 5 || row === 6) && col === 4) { populateToday(); return; }
  if (row === TODAY_REFRESH_ROW && col === TODAY_REFRESH_COL && newVal === true) {
    sheet.getRange(TODAY_REFRESH_ROW, TODAY_REFRESH_COL).setValue(false);
    populateToday();
    return;
  }
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
  if (status === 'Done') {
    var todo = getTodoById(String(todoId));
    if (todo && todo.workflow === 'Submit application' && todo.objType === 'Job') {
      sheet.getRange(row, COLS.TODAY.STATUS).setValue(todayStatusFromTodoStatus(todo.status || 'Not started'));
      runSubmitApplicationPopup(String(todoId));
      return;
    }
    if (isApplicationResponseCheckTask(todo)) {
      sheet.getRange(row, COLS.TODAY.STATUS).setValue(todayStatusFromTodoStatus(todo.status || 'Not started'));
      runApplicationResultPopup(String(todoId));
      return;
    }
    if (isReferralSearchContactTask(todo)) {
      sheet.getRange(row, COLS.TODAY.STATUS).setValue(todayStatusFromTodoStatus(todo.status || 'Not started'));
      runReferralSearchResultPopup(String(todoId));
      return;
    }
    if (isInterviewPrepPlanningTask(todo)) {
      sheet.getRange(row, COLS.TODAY.STATUS).setValue(todayStatusFromTodoStatus(todo.status || 'Not started'));
      runInterviewPrepPlanPopup(todo.objId, String(todoId));
      return;
    }
    if (isSourceLedScanTask(todo)) {
      sheet.getRange(row, COLS.TODAY.STATUS).setValue(todayStatusFromTodoStatus(todo.status || 'Not started'));
      runSourceScanResultPopup(String(todoId));
      return;
    }
  }
  if (status === 'Deferred') {
    deferTodoById(String(todoId), 3, 'today');
    requestHomeRefresh();
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

  withDocumentLock(function () {
    var allData = active.getLastRow() > 1 ? active.getRange(2, 1, active.getLastRow() - 1, HEADERS['To-do'].length).getValues() : [];
    var planningCtx = buildTaskPlanningContext(allData);
    var selectedData = active.getRange(row, 1, 1, HEADERS['To-do'].length).getValues()[0];
    var readyState = deriveReadyForTodayFromRow(selectedData, planningCtx);
    if (readyState !== 'Ready') {
      SpreadsheetApp.getUi().alert('Cannot pull this into Today', 'Ready for Today is "' + (readyState || 'blank') + '". Fix the blocker/planning issue on Tasks first.', SpreadsheetApp.getUi().ButtonSet.OK);
      return;
    }
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
    applyTodayRowStatusDropdowns(todaySheet);
    ss.setActiveSheet(todaySheet);
    SpreadsheetApp.getActiveSpreadsheet().toast("Added selected task to Today's plan.", 'The Planner', 3);
  }, { label: 'pullSelectedTaskIntoToday' });
}

function lockTodayRow() {
  var sheet = SpreadsheetApp.getActiveSheet();
  if (sheet.getName() !== 'Today') { SpreadsheetApp.getUi().alert('Select a row on Today first.'); return; }
  var row = sheet.getActiveRange().getRow();
  if (row < TODAY_TABLE_FIRST_ROW || row > TODAY_TABLE_LAST_ROW) { SpreadsheetApp.getUi().alert('Pick a task row.'); return; }
  withDocumentLock(function () {
    var notes = String(sheet.getRange(row, COLS.TODAY.NOTES).getValue() || '');
    if (notes.indexOf('[locked]') === -1) sheet.getRange(row, COLS.TODAY.NOTES).setValue('[locked] ' + notes);
    sheet.getRange(row, COLS.TODAY.TASK).setFontWeight('bold');
    SpreadsheetApp.getActiveSpreadsheet().toast('This row will stay in place on the next refresh.', 'The Planner', 3);
  }, { label: 'lockTodayRow' });
}

function unlockTodayRow() {
  var sheet = SpreadsheetApp.getActiveSheet();
  if (sheet.getName() !== 'Today') return;
  var row = sheet.getActiveRange().getRow();
  if (row < TODAY_TABLE_FIRST_ROW || row > TODAY_TABLE_LAST_ROW) return;
  withDocumentLock(function () {
    var notes = String(sheet.getRange(row, COLS.TODAY.NOTES).getValue() || '').replace(/\[locked\]\s*/g, '').trim();
    sheet.getRange(row, COLS.TODAY.NOTES).setValue(notes);
    sheet.getRange(row, COLS.TODAY.TASK).setFontWeight('normal');
    SpreadsheetApp.getActiveSpreadsheet().toast('This row can move on the next refresh.', 'The Planner', 3);
  }, { label: 'unlockTodayRow' });
}

function swapTodayRows(sheet, a, b) {
  var rangeA = sheet.getRange(a, 1, 1, HEADERS["Today's plan"].length);
  var rangeB = sheet.getRange(b, 1, 1, HEADERS["Today's plan"].length);
  var valsA = rangeA.getValues(), valsB = rangeB.getValues();
  var notesA = rangeA.getNotes(), notesB = rangeB.getNotes();
  rangeA.setValues(valsB); rangeB.setValues(valsA);
  rangeA.setNotes(notesB); rangeB.setNotes(notesA);
  applyTodayRowStatusDropdowns(sheet);
}

function moveTodayRowUp() {
  var sheet = SpreadsheetApp.getActiveSheet();
  if (sheet.getName() !== 'Today') return;
  var row = sheet.getActiveRange().getRow();
  if (row <= TODAY_TABLE_FIRST_ROW || row > TODAY_TABLE_LAST_ROW) return;
  withDocumentLock(function () {
    swapTodayRows(sheet, row, row - 1);
    sheet.setActiveRange(sheet.getRange(row - 1, COLS.TODAY.TASK));
  }, { label: 'moveTodayRowUp' });
}

function moveTodayRowDown() {
  var sheet = SpreadsheetApp.getActiveSheet();
  if (sheet.getName() !== 'Today') return;
  var row = sheet.getActiveRange().getRow();
  if (row < TODAY_TABLE_FIRST_ROW || row >= TODAY_TABLE_LAST_ROW) return;
  withDocumentLock(function () {
    swapTodayRows(sheet, row, row + 1);
    sheet.setActiveRange(sheet.getRange(row + 1, COLS.TODAY.TASK));
  }, { label: 'moveTodayRowDown' });
}

function topUpToday() {
  var sheet = getSheet('Today');
  if (!sheet) return;
  var ui = SpreadsheetApp.getUi();
  var resp = ui.prompt('Add more time to Today', 'How many extra minutes do you have?', ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  var mins = parseInt(resp.getResponseText().trim(), 10);
  if (isNaN(mins) || mins <= 0) { ui.alert('Enter a positive number.'); return; }
  withDocumentLock(function () {
    var current = parseInt(sheet.getRange(TODAY_CELLS.AVAILABLE_MIN).getValue(), 10) || 0;
    sheet.getRange(TODAY_CELLS.AVAILABLE_MIN).setValue(current + mins);
    populateToday();
    SpreadsheetApp.getActiveSpreadsheet().toast("Added " + mins + " minutes and rebuilt Today's plan.", 'The Planner', 4);
  }, { label: 'topUpToday' });
}

function markTodoBlockedFromToday(todoId, reason) {
  var todo = getTodoById(String(todoId || ''));
  if (!todo) return false;
  todo.sheet.getRange(todo.row, COLS.TODO.STATUS).setValue('Blocked');
  todo.sheet.getRange(todo.row, COLS.TODO.BLOCKER).setValue(reason || 'Blocked - add reason');
  todo.sheet.getRange(todo.row, COLS.TODO.COMPLETED).setValue('');
  todo.sheet.getRange(todo.row, COLS.TODO.LAST_EDITED).setValue(today());
  appendNoteFlag(todo.sheet, todo.row, COLS.TODO.NOTES, '[blocked] ' + (reason || 'Blocked'));
  syncTaskPlanningHelpers();
  return true;
}

function endOfDayReconcile() {
  var sheet = getSheet('Today');
  if (!sheet) { SpreadsheetApp.getUi().alert('Today tab not found.'); return; }
  var ui = SpreadsheetApp.getUi();
  var doneCount = 0;
  var unfinished = [];
  for (var r = TODAY_TABLE_FIRST_ROW; r <= TODAY_TABLE_LAST_ROW; r++) {
    var task = sheet.getRange(r, COLS.TODAY.TASK).getValue();
    var status = String(sheet.getRange(r, COLS.TODAY.STATUS).getValue());
    var todoId = sheet.getRange(r, COLS.TODAY.TODO_ID).getValue();
    if (!task) continue;
    if (status === 'Done') { doneCount++; continue; }
    if (status === 'Skipped' || status === 'Deferred') continue;
    unfinished.push({ row: r, task: task, todoId: todoId });
  }
  if (!unfinished.length) {
    ui.alert('End-of-day reconcile complete', 'Done: ' + doneCount + ' | No unfinished tasks to reconcile.', ui.ButtonSet.OK);
    return;
  }
  showEndOfDayReconcilePopup(doneCount, unfinished);
}

function showEndOfDayReconcilePopup(doneCount, unfinished) {
  var data = {
    doneCount: doneCount || 0,
    items: (unfinished || []).map(function (item) {
      return { row: item.row, todoId: String(item.todoId || ''), task: String(item.task || '') };
    })
  };
  var html = HtmlService.createHtmlOutput(buildEndOfDayReconcileHtml(data)).setWidth(760).setHeight(620).setTitle('Wrap up today');
  SpreadsheetApp.getUi().showModalDialog(html, 'Wrap up today');
}

function buildEndOfDayReconcileHtml(data) {
  var json = JSON.stringify(data || { doneCount: 0, items: [] });
  return '' +
    '<style>' +
    'body{font-family:Arial,sans-serif;padding:20px;color:#28251D;background:#FBFBF9;}' +
    'h2{margin:0 0 6px;color:#1B474D;font-size:20px;}' +
    'p{margin:6px 0 14px;color:#5F625E;font-size:13px;line-height:1.4;}' +
    '.toolbar{display:flex;gap:10px;align-items:center;margin:12px 0 14px;}' +
    'select,textarea{box-sizing:border-box;width:100%;border:1px solid #D8DAD4;border-radius:5px;background:#FFF;color:#28251D;font-size:13px;padding:8px;}' +
    '.default{width:190px;}' +
    'table{border-collapse:collapse;width:100%;font-size:13px;background:#FFF;}' +
    'th{background:#1B474D;color:#FFF;text-align:left;padding:8px;font-size:12px;}' +
    'td{border-bottom:1px solid #E1E3DD;padding:8px;vertical-align:top;}' +
    '.task{font-weight:bold;line-height:1.35;}' +
    '.reason{display:none;margin-top:6px;min-height:42px;}' +
    '.hint{font-size:11px;color:#7A7974;margin-top:4px;}' +
    '.primary{margin-top:16px;padding:10px 14px;border:0;border-radius:5px;background:#01696F;color:#FFF;font-weight:bold;cursor:pointer;}' +
    '.secondary{margin-top:16px;margin-left:8px;padding:10px 14px;border:1px solid #D8DAD4;border-radius:5px;background:#FFF;color:#28251D;cursor:pointer;}' +
    '#status{font-size:12px;color:#5F625E;margin-top:10px;}' +
    '</style>' +
    '<h2>Wrap up today</h2>' +
    '<p>' + (data.doneCount || 0) + ' done. Choose what should happen to each unfinished item.</p>' +
    '<div class="toolbar"><span class="hint">Default for all</span><select id="defaultAction" class="default" onchange="applyDefault()"><option value="carry">Carry over</option><option value="defer">Defer 3 days</option><option value="blocked">Blocked</option><option value="skip">Skip</option></select></div>' +
    '<table><thead><tr><th style="width:48%">Task</th><th style="width:170px">Action</th><th>Blocker reason</th></tr></thead><tbody id="rows"></tbody></table>' +
    '<button class="primary" onclick="save()">Save wrap-up</button><button class="secondary" onclick="google.script.host.close()">Cancel</button><div id="status"></div>' +
    '<script>var data=' + json + ';' +
    'var actions=[["carry","Carry over"],["defer","Defer 3 days"],["blocked","Blocked"],["skip","Skip"]];' +
    'function esc(s){return String(s||"").replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c];});}' +
    'function render(){var body=document.getElementById("rows");body.innerHTML="";(data.items||[]).forEach(function(item,idx){var tr=document.createElement("tr");var opts=actions.map(function(a){return "<option value=\\""+a[0]+"\\">"+a[1]+"</option>";}).join("");tr.innerHTML="<td><div class=\\"task\\">"+esc(item.task)+"</div></td><td><select id=\\"action_"+idx+"\\" onchange=\\"toggleReason("+idx+")\\">"+opts+"</select></td><td><textarea class=\\"reason\\" id=\\"reason_"+idx+"\\" placeholder=\\"What is blocking this?\\"></textarea></td>";body.appendChild(tr);toggleReason(idx);});}' +
    'function toggleReason(idx){var action=document.getElementById("action_"+idx).value;document.getElementById("reason_"+idx).style.display=action==="blocked"?"block":"none";}' +
    'function applyDefault(){var val=document.getElementById("defaultAction").value;(data.items||[]).forEach(function(_,idx){document.getElementById("action_"+idx).value=val;toggleReason(idx);});}' +
    'function save(){var status=document.getElementById("status");var items=(data.items||[]).map(function(item,idx){return {row:item.row,todoId:item.todoId,task:item.task,action:document.getElementById("action_"+idx).value,reason:document.getElementById("reason_"+idx).value};});for(var i=0;i<items.length;i++){if(items[i].action==="blocked"&&!String(items[i].reason||"").trim()){status.textContent="Add a blocker reason, or choose Carry over instead.";document.getElementById("reason_"+i).focus();return;}}status.textContent="Saving wrap-up...";google.script.run.withSuccessHandler(function(res){res=res||{};if(!res.ok){status.textContent=res.message||"Could not save.";return;}status.textContent=res.message||"Saved.";setTimeout(function(){google.script.host.close();},900);}).withFailureHandler(function(){status.textContent="Could not save. Try again from Today.";}).completeEndOfDayReconcileFromPopup({items:items});}' +
    'render();</script>';
}

function completeEndOfDayReconcileFromPopup(payload) {
  payload = payload || {};
  var items = payload.items || [];
  if (!items.length) return okResult('No unfinished tasks to reconcile.');
  return withDocumentLock(function () {
    var sheet = getSheet('Today');
    if (!sheet) return failResult('Today tab not found.', '', 'TODAY_NOT_FOUND');
    var counts = { carried: 0, deferred: 0, blocked: 0, skipped: 0 };
    var priorBatch = EDIT_BATCH_CONTEXT;
    EDIT_BATCH_CONTEXT = { deferTaskRefresh: true, needsDecisionRender: false, needsHomeRefresh: false };
    try {
      items.forEach(function (item) {
        var row = parseInt(item.row, 10);
        if (!row || row < TODAY_TABLE_FIRST_ROW || row > TODAY_TABLE_LAST_ROW) return;
        var todoId = String(item.todoId || sheet.getRange(row, COLS.TODAY.TODO_ID).getValue() || '');
        var action = String(item.action || 'carry');
        if (action === 'defer') {
          counts.deferred++;
          if (todoId) deferTodoById(todoId, 3, 'eod');
          sheet.getRange(row, COLS.TODAY.STATUS).setValue('Deferred');
        } else if (action === 'blocked') {
          var reason = String(item.reason || '').trim();
          if (!reason) reason = 'Blocked - add reason';
          counts.blocked++;
          if (todoId) markTodoBlockedFromToday(todoId, reason);
          sheet.getRange(row, COLS.TODAY.STATUS).setValue('Blocked');
          addTodayRowTag(sheet, row, '[Blocked]');
        } else if (action === 'skip') {
          counts.skipped++;
          if (todoId) completeTodo(todoId, 'Skipped', { source: 'eod' });
          sheet.getRange(row, COLS.TODAY.STATUS).setValue('Skipped');
        } else {
          counts.carried++;
          addTodayRowTag(sheet, row, '[Carried]');
        }
      });
    } finally {
      EDIT_BATCH_CONTEXT = priorBatch;
    }
    populateToday();
    refreshHome();
    return okResult('Wrap-up saved. Carried: ' + counts.carried + ' | Deferred: ' + counts.deferred + ' | Blocked: ' + counts.blocked + ' | Skipped: ' + counts.skipped + '.');
  }, { label: 'completeEndOfDayReconcileFromPopup', timeoutMs: 30000 });
}

function checkMorningCarryForward() {
  var sheet = getSheet('Today');
  if (!sheet) return;
  var builtDate = getTodayPlanBuiltDate();
  if (!builtDate) return;
  if (builtDate.getTime() === today().getTime()) return;
  var ready = 0, blocked = 0, needsPlanning = 0;
  var currentStateById = buildCurrentTaskStateForToday();
  for (var r = TODAY_TABLE_FIRST_ROW; r <= TODAY_TABLE_LAST_ROW; r++) {
    var task = sheet.getRange(r, COLS.TODAY.TASK).getValue();
    var status = String(sheet.getRange(r, COLS.TODAY.STATUS).getValue());
    var todoId = String(sheet.getRange(r, COLS.TODAY.TODO_ID).getValue() || '');
    if (!task || ['Planned', 'In progress', 'Blocked'].indexOf(status) === -1) continue;
    var current = currentStateById[todoId];
    if (status === 'Blocked' || (current && current.status === 'Blocked')) blocked++;
    else if (current && current.readyState !== 'Ready' && current.status !== 'In progress') needsPlanning++;
    else ready++;
  }
  if (ready + blocked + needsPlanning > 0) {
    SpreadsheetApp.getActiveSpreadsheet().toast('Yesterday unfinished: ' + ready + ' still ready, ' + blocked + ' blocked, ' + needsPlanning + ' need planning. Refresh Today to re-rank.', 'The Planner', 8);
  }
}

function middayNudge() {
  return withDocumentLock(function () {
    var sheet = getSheet('Today');
    if (!sheet) return;
    var pending = 0;
    for (var r = TODAY_TABLE_FIRST_ROW; r <= TODAY_TABLE_LAST_ROW; r++) {
      var task = sheet.getRange(r, COLS.TODAY.TASK).getValue();
      var status = String(sheet.getRange(r, COLS.TODAY.STATUS).getValue());
      if (task && (status === 'Planned' || status === 'In progress')) pending++;
    }
    checkTriggerHealth();
    recordMaintenanceHeartbeat('lastMiddayNudgeAt');
    if (pending >= 5) SpreadsheetApp.getActiveSpreadsheet().toast(pending + ' items still open - realistic for today, or should some defer?', 'The Planner - Mid-day check', 8);
  }, { label: 'middayNudge', timeoutMs: 30000, failOpen: false });
}
// =============================================================
// HOME — daily command centre. It shows judgement, readiness, capture,
// active application context, and system health without owning source data.
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
var HOME_ATTENTION_ROW = 6;            // compact critical warnings, only populated when something needs repair

var HOME_DECISIONS_HEADER_ROW = 7;
var HOME_DECISIONS_ID_ROW = 8;         // A/C/F hold Decision IDs; B/D/G hold the visible card text
var HOME_DECISIONS_ACTION_ROW = 9;     // B/D/G hold the Yes/No dropdowns
var HOME_DECISIONS_MORE_ROW = 10;      // "N more in queue" link, only rendered when count > 3

var HOME_UPDATE_HEADER_ROW = 17;
var HOME_UPDATE_ROW = 18;
var HOME_UPDATE_COL = 2;               // B — the update-type dropdown

var HOME_PLAN_HEADER_ROW = 12;         // "Today's plan"
var HOME_PLAN_STATUS_ROW = 13;         // "Ready — N tasks, M minutes." / "Not built yet."
var HOME_PLAN_START_ROW = 14;          // "Start working ▸" HYPERLINK
var HOME_PLAN_SUBLINE_ROW = 15;        // small muted "<N> tasks remain in your master queue."

var HOME_APPLICATIONS_HEADER_ROW = 20;
var HOME_APPLICATIONS_FIRST_ROW = 21;  // 21..24, 4 rows max

var HOME_UPCOMING_HEADER_ROW = 26;
var HOME_UPCOMING_FIRST_ROW = 27;      // 27..31, 5 rows max

var HOME_REFRESH_ROW = 33;             // small utility row
var HOME_REFRESH_COL = 2;

var HOME_LAST_REFRESHED_ROW = 35;

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
  var ctx = buildTaskPlanningContext(data);
  var open = 0, fixedCount = 0, blocking = 0, needAttention = 0, needPlanning = 0, blockedCount = 0, brokenLinks = 0;
  data.forEach(function (row) {
    var status = String(row[COLS.TODO.STATUS - 1]);
    if (!isOpenTodoStatus(status)) return;
    open++;
    var cls = String(row[COLS.TODO.COMMITMENT_CLASS - 1]);
    if (cls === 'Fixed') fixedCount++;
    if (cls === 'Blocking') blocking++;
    var notes = String(row[COLS.TODO.NOTES - 1] || '');
    if (/\[(flags|review|no-estimate|no-link|no-date|parent-still-open|parent-ready|orphaned-link|orphaned-sector|orphaned-org)\]/.test(notes)) needAttention++;
    if (notes.indexOf('[needs planning]') !== -1 || notes.indexOf('[needs breakdown]') !== -1 || notes.indexOf('[parent-ready]') !== -1 || taskHasBrokenSourceNotes(notes) || taskLinkedSourceIsTerminal(row, ctx)) needPlanning++;
    if (status === 'Blocked') blockedCount++;
    if (taskHasBrokenSourceNotes(notes)) brokenLinks++;
  });
  var summary = open + ' open · ' + fixedCount + ' Fixed · ' + blocking + ' Blocking · ' +
    needAttention + ' need attention · ' + needPlanning + ' need planning · ' + blockedCount + ' blocked';
  if (brokenLinks) summary += ' · ' + brokenLinks + ' broken link' + (brokenLinks === 1 ? '' : 's');
  return summary;
}

// v7.4: replaces a plain sheet.clear() — clear() alone was found to leave
// stale data-validation rules (checkboxes) from a prior layout in place,
// producing an orphaned checkbox artifact once the row layout moved.
// Explicitly tearing down merges/validations/formatting/content/notes
// before every rebuild means a changed layout can never leave leftover
// state behind.
function collectHomeAttentionItems() {
  var items = [];
  var taskSheet = getSheet('Tasks');
  if (taskSheet && taskSheet.getLastRow() > 1) {
    var tasks = taskSheet.getRange(2, 1, taskSheet.getLastRow() - 1, HEADERS['To-do'].length).getValues();
    var ctx = buildTaskPlanningContext(tasks);
    var brokenOrClosed = 0;
    var blockedNeedsReason = 0;
    var parentReview = 0;
    tasks.forEach(function (row) {
      var status = String(row[COLS.TODO.STATUS - 1] || '');
      if (!isOpenTodoStatus(status)) return;
      var notes = String(row[COLS.TODO.NOTES - 1] || '');
      if (taskHasBrokenSourceNotes(notes) || taskLinkedSourceIsTerminal(row, ctx)) brokenOrClosed++;
      if (status === 'Blocked') {
        var blocker = String(row[COLS.TODO.BLOCKER - 1] || '');
        var blockedBy = String(row[COLS.TODO.BLOCKED_BY_ID - 1] || '');
        if (!blocker || blocker === 'Blocked - add reason' || !blockedBy) blockedNeedsReason++;
      }
      var id = String(row[COLS.TODO.ID - 1] || '');
      if (notes.indexOf('[parent-ready]') !== -1 || (allChildTodosTerminalInContext(id, ctx) && !allChildTodosDoneInContext(id, ctx))) parentReview++;
    });
    if (brokenOrClosed) items.push(brokenOrClosed + ' task' + (brokenOrClosed === 1 ? '' : 's') + ' need source repair');
    if (blockedNeedsReason) items.push(blockedNeedsReason + ' blocked task' + (blockedNeedsReason === 1 ? '' : 's') + ' need recovery');
    if (parentReview) items.push(parentReview + ' parent task' + (parentReview === 1 ? '' : 's') + ' need review');
  }

  var decisionSheet = getSheet('Decisions');
  if (decisionSheet && decisionSheet.getLastRow() > 1) {
    var decisions = decisionSheet.getRange(2, 1, decisionSheet.getLastRow() - 1, HEADERS['Pending decisions'].length).getValues();
    var maps = buildLinkedObjectHealthMaps();
    var staleDecisions = 0;
    decisions.forEach(function (row) {
      if (String(row[COLS.DECISIONS.DECISION - 1] || '') === 'Pending' && decisionLinkedSourceUnavailable(row, maps)) staleDecisions++;
    });
    if (staleDecisions) items.push(staleDecisions + ' stale decision' + (staleDecisions === 1 ? '' : 's') + ' hidden from Home');
  }

  var maint = readMaintenanceHealth();
  if (maint.error) items.push('maintenance issue logged');
  else if (maint.stale) items.push('maintenance has not run in 2 days');
  if (maint.weeklyStale) items.push('weekly review has not run in 8 days');
  var invalidDropdowns = scanInvalidDropdownValues(false);
  if (invalidDropdowns.count) items.push(invalidDropdowns.count + ' invalid dropdown value' + (invalidDropdowns.count === 1 ? '' : 's') + ' need repair');
  var duplicateIds = scanDuplicateIdValues(false);
  if (duplicateIds.count) items.push(duplicateIds.count + ' duplicate ID row' + (duplicateIds.count === 1 ? '' : 's') + ' need repair');
  return items;
}

function homeAttentionActionHint(items) {
  items = items || [];
  var hasTaskRecovery = false;
  var hasRepair = false;
  var hasMaintenance = false;
  items.forEach(function (item) {
    var text = String(item || '');
    if (text.indexOf('blocked task') !== -1 || text.indexOf('parent task') !== -1) hasTaskRecovery = true;
    if (text.indexOf('source repair') !== -1 || text.indexOf('stale decision') !== -1 || text.indexOf('invalid dropdown') !== -1 || text.indexOf('duplicate ID') !== -1) hasRepair = true;
    if (text.indexOf('maintenance') !== -1 || text.indexOf('weekly review') !== -1) hasMaintenance = true;
  });
  if (hasTaskRecovery && (hasRepair || hasMaintenance)) return 'Open Today > Needs planning, then run Maintenance if repair remains';
  if (hasTaskRecovery) return 'Open Today > Needs planning or Tasks row actions';
  if (hasRepair) return 'Use Maintenance > Repair all tabs';
  if (hasMaintenance) return 'Use The Planner > Maintenance';
  return 'Review the highlighted planner items';
}

function hardResetHomeSheet(sheet) {
  var maxRows = Math.max(sheet.getMaxRows(), 60);
  var maxCols = Math.max(sheet.getMaxColumns(), 10);
  try { sheet.getRange(1, 1, maxRows, maxCols).breakApart(); } catch (err) { }
  try { sheet.getRange(1, 1, maxRows, maxCols).clearDataValidations(); } catch (err) { }
  try { sheet.getRange(1, 1, maxRows, maxCols).clearFormat(); } catch (err) { }
  try { sheet.getRange(1, 1, maxRows, maxCols).clearContent(); } catch (err) { }
  try { sheet.getRange(1, 1, maxRows, maxCols).clearNote(); } catch (err) { }
}

// v7.4: Today's-plan hero counts. Prefer the explicit build date stored
// in document properties / the B3 note, then fall back to the visible
// ready headline plus actual Today rows so Home cannot contradict the
// Today tab if a property write is missing or stale.
// A row counts as Commit unless its Slot cell starts with 'O' (Option
// rows are written as 'O1', 'O2', ... by writeTodayRow).
function todayPlanCounts() {
  var result = { built: false, unverified: false, commit: 0, minutes: 0, options: 0, headline: '' };
  var sheet = getSheet('Today');
  if (!sheet) return result;
  result.headline = String(sheet.getRange('B3').getValue() || '');
  var builtDate = getTodayPlanBuiltDate();
  var noteDate = todayPlanDateFromNote(sheet.getRange('B3').getNote());
  var t = today().getTime();
  var verifiedBuilt = (builtDate && builtDate.getTime() === t) || (noteDate && noteDate.getTime() === t);
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
  result.built = verifiedBuilt;
  var notBuiltHeadline = /not built/i.test(result.headline);
  var builtLookingHeadline = /(ready|realistic|tight|over capacity|nothing committed|no ready tasks)/i.test(result.headline);
  if (!result.built && !notBuiltHeadline && (result.commit + result.options > 0 || builtLookingHeadline)) {
    result.built = true;
    result.unverified = true;
  }
  return result;
}

function formatDateFriendly(d) {
  return Utilities.formatDate(new Date(d), plannerTimeZone(), 'EEE d MMM');
}

function formatHomeFeedDate(d) {
  var date = new Date(d);
  if (isNaN(date.getTime())) return '';
  var day = new Date(date);
  day.setHours(0, 0, 0, 0);
  var diff = daysBetween(today(), day);
  if (diff < 0) return 'Overdue - ' + formatDateFriendly(date);
  if (diff === 0) return 'Today - ' + formatDateFriendly(date);
  if (diff === 1) return 'Tomorrow - ' + formatDateFriendly(date);
  return formatDateFriendly(date);
}

// v7.4: read-only merge of the next 5 upcoming dated items across
// Interviews / People (scheduled conversations) / Jobs (applied, awaiting
// review) — no writes, no cascades, just a sorted feed for Home.
function collectUpcomingItems(limit) {
  limit = limit || 5;
  var items = [];

  var roundsSheet = getSheet('Interviews');
  if (roundsSheet && roundsSheet.getLastRow() > 1) {
    var rData = roundsSheet.getRange(2, 1, roundsSheet.getLastRow() - 1, COLS.ROUNDS.NOTES).getValues();
    rData.forEach(function (r) {
      var d = r[COLS.ROUNDS.INTERVIEW_DATE - 1];
      var status = String(r[COLS.ROUNDS.STATUS - 1]);
      if (d && ['Completed', 'Cancelled'].indexOf(status) === -1) {
        var label = r[COLS.ROUNDS.ORG_DISPLAY - 1] || r[COLS.ROUNDS.JOB_DISPLAY - 1] || '';
        items.push({ type: 'Interview', date: new Date(d), label: label });
      }
    });
  }

  var peopleSheet = getSheet('People');
  if (peopleSheet && peopleSheet.getLastRow() > 1) {
    var pData = peopleSheet.getRange(2, 1, peopleSheet.getLastRow() - 1, COLS.PEOPLE.FOLLOW_UPS_SENT_COUNT).getValues();
    pData.forEach(function (p) {
      var d = p[COLS.PEOPLE.CONVERSATION_DATE - 1];
      var stage = normalizePersonStage(p[COLS.PEOPLE.STAGE - 1]);
      if (stage === 'Conversation scheduled' && d) {
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
      var outcome = normalizeJobOutcome(j[COLS.JOBS.OUTCOME - 1]);
      if (normalizeJobStatus(status) === 'Submitted' && (!outcome || outcome === 'Waiting') && d) {
        items.push({ type: 'Follow-up', date: new Date(d), label: j[COLS.JOBS.ORG - 1] || '' });
      }
    });
  }

  items.sort(function (a, b) { return a.date - b.date; });
  return items.slice(0, limit);
}

function collectOpenApplications(limit) {
  limit = limit || 4;
  var sheet = getSheet('Jobs');
  if (!sheet || sheet.getLastRow() < 2) return [];
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, COLS.JOBS.NOTES).getValues();
  var items = [];
  data.forEach(function (row) {
    var status = normalizeJobStatus(row[COLS.JOBS.STATUS - 1]);
    if (status !== 'In progress' && status !== 'Submitted') return;
    var title = String(row[COLS.JOBS.OPPORTUNITY - 1] || '').trim();
    var org = String(row[COLS.JOBS.ORG - 1] || '').trim();
    var deadline = row[COLS.JOBS.DEADLINE - 1];
    var result = normalizeJobOutcome(row[COLS.JOBS.OUTCOME - 1]);
    var nextCheck = row[COLS.JOBS.REVIEW_DATE - 1];
    var sortDate = deadline || nextCheck || addDays(today(), 365);
    var detail = status;
    if (status === 'Submitted') detail = result || 'Submitted';
    if (status === 'Submitted' && result === 'Interview invite') detail = 'Interview invite - see Interviews';
    if (status === 'In progress' && deadline) detail += ' · due ' + formatDateFriendly(deadline);
    if (status === 'Submitted' && nextCheck && (result || '') === 'Waiting') detail += ' · check ' + formatDateFriendly(nextCheck);
    items.push({ title: title, org: org, status: status, detail: detail, date: new Date(sortDate) });
  });
  items.sort(function (a, b) {
    if (a.status !== b.status) return a.status === 'In progress' ? -1 : 1;
    return a.date - b.date;
  });
  return items.slice(0, limit);
}

function refreshHome() {
  var sheet = getSheet('Home');
  if (!sheet) sheet = SpreadsheetApp.getActiveSpreadsheet().insertSheet('Home', 0);
  hardResetHomeSheet(sheet);
  sheet.setTabColor(ZONE_WORK_COLOR);

  sheet.getRange(HOME_TITLE_ROW, 2, 1, 5).merge().setValue('The Planner').setFontSize(20).setFontWeight('bold').setFontColor(HEADER_COLOR);
  var editReady = false;
  try { editReady = triggerExists(EDIT_TRIGGER_HANDLER, ScriptApp.EventType.ON_EDIT); } catch (err) { Logger.log('refreshHome trigger check: ' + err); }
  if (!editReady) {
    sheet.getRange(3, 2, 1, 7).merge()
      .setValue('⚠ One-time setup needed: open The Planner → Triggers & setup → Set up / verify triggers, or nothing on this page will respond.')
      .setFontWeight('bold').setFontColor(HEADER_COLOR).setBackground(MANUAL_COLOR).setWrap(true);
  }

  // --- Onboarding card (§1.1) ---
  var profile = getSetupProfile();
  if (!profile) {
    if (editReady) {
      sheet.getRange(HOME_ONBOARD_ROW, HOME_ONBOARD_CHECK_COL).setValue(false).insertCheckboxes().setBackground(MANUAL_COLOR);
    } else {
      sheet.getRange(HOME_ONBOARD_ROW, HOME_ONBOARD_CHECK_COL).clearDataValidations().setValue('').setBackground('#FCE8E6');
    }
    sheet.getRange(HOME_ONBOARD_ROW, HOME_ONBOARD_CHECK_COL + 1, 1, 4).merge()
      .setValue(editReady ? 'Start onboarding' : 'Install triggers to start onboarding')
      .setFontWeight('bold').setFontColor(editReady ? '#01696F' : '#964219').setBackground(editReady ? '#EAF4F5' : '#FCE8E6');
    sheet.getRange(HOME_WELCOME_ROW, 2, 1, 5).merge()
      .setValue(editReady ? 'Use the checkbox above or The Planner → Start or redo setup. The popup writes source rows and refreshes Today.' : 'Run The Planner > Triggers & setup > Set up / verify triggers, then come back here.')
      .setWrap(true).setFontColor('#5F625E');
  } else if (shouldShowSetupCard(profile)) {
    if (editReady) {
      sheet.getRange(HOME_ONBOARD_ROW, HOME_ONBOARD_CHECK_COL).setValue(false).insertCheckboxes().setBackground(MANUAL_COLOR);
    } else {
      sheet.getRange(HOME_ONBOARD_ROW, HOME_ONBOARD_CHECK_COL).clearDataValidations().setValue('').setBackground('#FCE8E6');
    }
    sheet.getRange(HOME_ONBOARD_ROW, HOME_ONBOARD_CHECK_COL + 1, 1, 4).merge()
      .setValue(editReady ? 'Continue onboarding' : 'Install triggers to continue onboarding')
      .setFontWeight('bold').setFontColor(editReady ? '#01696F' : '#964219').setBackground(editReady ? '#EAF4F5' : '#FCE8E6');
    var nextItem = nextIncompleteChecklistItem(profile);
    var detail = editReady ? setupLabel(profile) + (nextItem ? ' — next: ' + (nextItem.label || nextItem.text) : '') : 'Run The Planner > Triggers & setup > Set up / verify triggers, then continue onboarding.';
    sheet.getRange(HOME_WELCOME_ROW, 2, 1, 5).merge().setValue(detail).setWrap(true).setFontColor('#5F625E');
  } else {
    sheet.getRange(HOME_ONBOARD_ROW, HOME_ONBOARD_CHECK_COL, 1, 5).merge()
      .setValue('✓ Onboarding complete').setFontWeight('bold').setFontColor('#437A22');
    sheet.getRange(HOME_ONBOARD_ROW, HOME_ONBOARD_RESET_CHECK_COL).setValue(false).insertCheckboxes();
    sheet.getRange(HOME_ONBOARD_ROW, HOME_ONBOARD_RESET_CHECK_COL + 1)
      .setValue('Redo setup')
      .setNote('Reopens onboarding. If existing planner data would be cleared, the setup flow offers a backup copy first.')
      .setFontSize(9).setFontColor('#7A7974');
    sheet.getRange(HOME_WELCOME_ROW, 2, 1, 5).merge().setValue('Welcome back. Let’s get you organised for today.').setFontColor('#5F625E');
  }
  var guideSheetForHome = getSheet('Guide');
  if (guideSheetForHome) {
    sheet.getRange(HOME_WELCOME_ROW, 7)
      .setFormula('=HYPERLINK("#gid=' + guideSheetForHome.getSheetId() + '","New here? Read the Guide ▸")')
      .setFontSize(9).setFontColor(HEADER_COLOR).setFontWeight('bold');
  }

  // --- Pending Decisions (§1.2) — kept inline, near-zero friction ---
  var attentionItems = collectHomeAttentionItems();
  if (attentionItems.length) {
    sheet.getRange(HOME_ATTENTION_ROW, 2, 1, 5).merge()
      .setValue('Needs attention: ' + attentionItems.slice(0, 3).join(' - ') + (attentionItems.length > 3 ? ' - +' + (attentionItems.length - 3) + ' more' : ''))
      .setFontWeight('bold').setFontColor(HEADER_COLOR).setBackground(MANUAL_COLOR).setWrap(true);
    sheet.getRange(HOME_ATTENTION_ROW, 7)
      .setValue(homeAttentionActionHint(attentionItems))
      .setFontSize(9).setFontColor('#8A8D87');
  }
  sheet.getRange(HOME_DECISIONS_HEADER_ROW, 2, 1, 5).merge().setValue('Pending Decisions').setFontWeight('bold').setFontColor('#FFFFFF').setBackground(HEADER_COLOR);
  renderDecisionCards(sheet, HOME_DECISIONS_ID_ROW, HOME_DECISIONS_ACTION_ROW, HOME_DECISIONS_MORE_ROW);

  // --- Capture update (§1.3) — the primary capture surface now ---
  sheet.getRange(HOME_UPDATE_HEADER_ROW, 2, 1, 5).merge().setValue('Capture update').setFontWeight('bold').setFontColor('#FFFFFF').setBackground(HEADER_COLOR);
  if (editReady) {
    sheet.getRange(HOME_UPDATE_ROW, HOME_UPDATE_COL).setValue('No updates').setBackground(MANUAL_COLOR);
    setDropdown(sheet.getRange(HOME_UPDATE_ROW, HOME_UPDATE_COL), DROPDOWNS.TODAY_UPDATE_TYPES);
  } else {
    sheet.getRange(HOME_UPDATE_ROW, HOME_UPDATE_COL).clearDataValidations().setValue('Install triggers first').setBackground(MANUAL_COLOR).setFontColor(HEADER_COLOR).setFontWeight('bold');
  }

  // --- Today's plan hero (§1.4) — replaces the raw open-task count ---
  sheet.getRange(HOME_PLAN_HEADER_ROW, 2, 1, 5).merge().setValue('Today’s plan').setFontWeight('bold').setFontColor('#FFFFFF').setBackground(HEADER_COLOR);
  var planCounts = todayPlanCounts();
  var heroText = 'Not built yet.';
  if (planCounts.built && planCounts.commit > 0) heroText = 'Ready — ' + planCounts.commit + ' tasks, ' + planCounts.minutes + ' minutes.';
  else if (planCounts.built) heroText = 'Built — nothing committed today.';
  if (planCounts.built && planCounts.headline) heroText = planCounts.headline;
  sheet.getRange(HOME_PLAN_STATUS_ROW, 2, 1, 5).merge().setValue(heroText).setFontWeight('bold').setFontColor('#1B474D');
  var todaySheetForLink = getSheet('Today');
  if (todaySheetForLink) {
    var todayAction = planCounts.built && planCounts.commit > 0
      ? 'Start working ▸'
      : (planCounts.built ? 'Open Today ▸' : "Open Today to build plan ▸");
    sheet.getRange(HOME_PLAN_START_ROW, 2).setFormula('=HYPERLINK("#gid=' + todaySheetForLink.getSheetId() + '","' + todayAction + '")').setFontColor('#01696F').setFontWeight('bold');
  }
  var planSubline = taskQueueSummary();
  if (planCounts.unverified) planSubline = planSubline + ' Today has a visible plan, but the build date is not verified - refresh Today if this looks stale.';
  if (!planCounts.built) planSubline = planSubline + " On Today, tick Build / refresh Today's plan.";
  else if (planCounts.commit === 0) planSubline = planSubline + ' Open Today to see options, or add more available minutes.';
  sheet.getRange(HOME_PLAN_SUBLINE_ROW, 2, 1, 5).merge().setValue(planSubline).setFontSize(9).setFontColor('#8A8D87');

  // --- Open applications — current state without turning Home into Jobs ---
  sheet.getRange(HOME_APPLICATIONS_HEADER_ROW, 2, 1, 5).merge().setValue('Open applications').setFontWeight('bold').setFontColor('#FFFFFF').setBackground(HEADER_COLOR);
  var applications = collectOpenApplications(4);
  if (!applications.length) {
    sheet.getRange(HOME_APPLICATIONS_FIRST_ROW, 2, 1, 5).merge().setValue('No open applications. Capture a job or run an Opportunity scan.').setFontColor('#5F625E');
  } else {
    applications.forEach(function (app, idx) {
      var r = HOME_APPLICATIONS_FIRST_ROW + idx;
      sheet.getRange(r, 2, 1, 2).merge().setValue(app.title || '(Untitled opportunity)').setFontWeight('bold').setFontColor('#1B474D');
      sheet.getRange(r, 4).setValue(app.org || '');
      sheet.getRange(r, 5, 1, 2).merge().setValue(app.detail || app.status).setFontColor('#5F625E');
    });
  }

  // --- Upcoming (§1.5) — read-only, no cascades ---
  sheet.getRange(HOME_UPCOMING_HEADER_ROW, 2, 1, 5).merge().setValue('Upcoming').setFontWeight('bold').setFontColor('#FFFFFF').setBackground(HEADER_COLOR);
  var upcoming = collectUpcomingItems(5);
  if (!upcoming.length) {
    sheet.getRange(HOME_UPCOMING_FIRST_ROW, 2, 1, 5).merge().setValue('Nothing scheduled or waiting. Capture updates as they happen.').setFontColor('#5F625E');
  } else {
    upcoming.forEach(function (item, idx) {
      var r = HOME_UPCOMING_FIRST_ROW + idx;
      sheet.getRange(r, 2).setValue(item.type).setFontWeight('bold').setFontColor('#1B474D');
      sheet.getRange(r, 3).setValue(formatHomeFeedDate(item.date));
      sheet.getRange(r, 4, 1, 3).merge().setValue(item.label);
    });
  }

  // --- Refresh (§1.6) — demoted utility control for re-reading Home status ---
  sheet.getRange(HOME_REFRESH_ROW, HOME_REFRESH_COL).setValue(false).insertCheckboxes().setBackground(MANUAL_COLOR);
  sheet.getRange(HOME_REFRESH_ROW, HOME_REFRESH_COL + 1, 1, 4).merge()
    .setValue('Refresh Home status')
    .setFontSize(9).setFontColor('#8A8D87');

  var maint = readMaintenanceHealth();
  if (maint.error || maint.stale) {
    var maintText = maint.error ? ('Maintenance issue: ' + maint.error) : 'Maintenance has not run in 2 days. Use The Planner > Maintenance > Run daily maintenance now.';
    sheet.getRange(HOME_REFRESH_ROW + 1, HOME_REFRESH_COL + 1, 1, 4).merge()
      .setValue(maintText).setFontSize(9).setFontColor('#964219').setWrap(true);
  } else if (maint.weeklyStale) {
    sheet.getRange(HOME_REFRESH_ROW + 1, HOME_REFRESH_COL + 1, 1, 4).merge()
      .setValue('Weekly review has not run in 8 days. Use The Planner > Maintenance > Run weekly review now.')
      .setFontSize(9).setFontColor('#964219').setWrap(true);
  } else if (maint.weeklySummary) {
    sheet.getRange(HOME_REFRESH_ROW + 1, HOME_REFRESH_COL + 1, 1, 4).merge()
      .setValue(maint.weeklySummary)
      .setFontSize(9).setFontColor('#8A8D87').setWrap(true);
  }

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
    refreshHomeStatusFromButton();
  }
}

function refreshHomeStatusFromButton() {
  checkTriggerHealth();
  refreshHome();
  SpreadsheetApp.getActiveSpreadsheet().toast('Home refreshed from Today, Tasks, and Decisions.', 'The Planner', 3);
}

// =============================================================
// ONBOARDING — destructive-then-rebuild, capture entirely via popups
// =============================================================

function clearSheetBody(sheet, headerKey) {
  if (!sheet || !HEADERS[headerKey]) return;
  var headers = HEADERS[headerKey];
  var cols = HEADERS[headerKey].length;
  if (sheet.getMaxColumns() < cols) sheet.insertColumnsAfter(sheet.getMaxColumns(), cols - sheet.getMaxColumns());
  sheet.getRange(1, 1, 1, cols).setValues([headers]);
  if (sheet.getMaxColumns() > cols) {
    sheet.getRange(1, cols + 1, 1, sheet.getMaxColumns() - cols).clearContent().clearNote().clearDataValidations().clearFormat();
  }
  var rows = sheet.getMaxRows() - 1;
  if (rows > 0) {
    sheet.getRange(2, 1, rows, sheet.getMaxColumns()).clearContent().clearNote().clearDataValidations().clearFormat();
  }
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

function createPlannerBackupCopy() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var stamp = Utilities.formatDate(new Date(), plannerTimeZone(), 'yyyy-MM-dd HHmm');
  var copy = ss.copy(ss.getName() + ' backup ' + stamp);
  return { name: copy.getName(), url: copy.getUrl(), id: copy.getId() };
}

function plannerDataRowCount() {
  var tabs = ['Sectors', 'Organisations', 'Jobs', 'People', 'Conversations', 'Interviews', 'Tasks', 'Decisions'];
  return tabs.reduce(function (count, name) {
    var sheet = getSheet(name);
    if (!sheet) return count;
    return count + Math.max(sheet.getLastRow() - 1, 0);
  }, 0);
}

function runSetupInterview() {
  var html = HtmlService.createHtmlOutput(buildSetupHtml()).setWidth(640).setHeight(680).setTitle('Set up The Planner');
  SpreadsheetApp.getUi().showModalDialog(html, 'Set up The Planner');
}

function buildSetupHtml() {
  var roundTypes = DROPDOWNS.ROUND_TYPE, jobStatuses = DROPDOWNS.JOB_STATUS, orgStatuses = DROPDOWNS.ORG_STATUS, relTypes = DROPDOWNS.PERSON_REL_TYPE;
  var existingRows = plannerDataRowCount();
  var setupIntro = existingRows ? 'Redoing setup will clear existing planner data first, then capture your starting facts and write them to the right tabs.' : 'This captures your starting facts and writes them to the right tabs.';
  var setupButton = existingRows ? 'Save (clears existing planner data first)' : 'Save setup';
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
    '.backup{display:block;margin-top:14px;font-size:12px;font-weight:normal;color:#5F625E;}.backup input{width:auto;margin:0 7px 0 0;vertical-align:middle;}' +
    '</style>' +
    '<h2>Set up your planner</h2>' +
    '<p>' + setupIntro + '</p>' +
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
    (existingRows ? '  <label class="backup"><input id="backupBeforeReset" type="checkbox" checked>Save a backup copy before clearing existing data</label>' : '') +
    '  <button class="primary" type="button" onclick="submitSetup()">' + setupButton + '</button>' +
    '  <button class="back" type="button" onclick="showStep(2)">Back</button>' +
    '  <button class="skip" type="button" onclick="skipSetup()">Skip setup</button>' +
    '  <div id="status"></div>' +
    '</div>' +
    '<script>' +
    'var goal="", entryPoint="";' +
    'var existingRows=' + existingRows + ';' +
    'var jobStatuses=' + JSON.stringify(jobStatuses) + ', roundTypes=' + JSON.stringify(roundTypes) + ', orgStatuses=' + JSON.stringify(orgStatuses) + ', relTypes=' + JSON.stringify(relTypes) + ';' +
    'var forms={' +
    ' sectors:{title:"Add your first broad sector(s)",fields:[{k:"sectorNames",l:"Broad sector(s) to explore",t:"textarea",p:"Climate\\nAI governance"}]},' +
    ' interviews:{title:"Capture an active interview",fields:[{k:"org",l:"Organisation",t:"text",req:true},{k:"jobTitle",l:"Job title / opportunity",t:"text",req:true},{k:"roundNumber",l:"Round number",t:"text",p:"1"},{k:"roundType",l:"Round type",t:"select",o:roundTypes,blank:true},{k:"interviewDate",l:"Interview date",t:"date"}]},' +
    ' applications:{title:"Capture an application already submitted",fields:[{k:"org",l:"Organisation",t:"text",req:true},{k:"jobTitle",l:"Job title / opportunity",t:"text",req:true},{k:"appliedDate",l:"Submitted date",t:"date"},{k:"urlNotes",l:"URL / notes",t:"textarea"}]},' +
    ' jobs:{title:"Capture a job you want to apply to",fields:[{k:"org",l:"Organisation",t:"text",req:true},{k:"jobTitle",l:"Job title / opportunity",t:"text",req:true},{k:"deadline",l:"Deadline, if any",t:"date"},{k:"urlNotes",l:"URL / source / notes",t:"textarea"}]},' +
    ' people:{title:"Capture a person or conversation state",fields:[{k:"name",l:"Name",t:"text",req:true},{k:"org",l:"Organisation, if relevant",t:"text"},{k:"role",l:"Role/title, if known",t:"text"},{k:"relType",l:"Source / relationship",t:"select",o:relTypes,blank:true},{k:"reachedOut",l:"Have you already reached out?",t:"select",o:["No","Yes"],defaultValue:"No"},{k:"replied",l:"Have they replied?",t:"select",o:["No","Yes"],defaultValue:"No",showIf:{k:"reachedOut",v:"Yes"}},{k:"outreachDate",l:"When did you reach out?",t:"date",showIf:{k:"reachedOut",v:"Yes"}},{k:"whereNow",l:"If they replied, where are things now?",t:"select",o:["Need to respond / arrange next step","Conversation scheduled","Already spoke"],blank:true,showIf:{k:"replied",v:"Yes"}},{k:"conversationDate",l:"Conversation date, if scheduled/completed",t:"date",showIfAny:[{k:"whereNow",v:"Conversation scheduled"},{k:"whereNow",v:"Already spoke"}]},{k:"notes",l:"Notes/source",t:"textarea"}]},' +
    ' orgs:{title:"Capture organisations you are tracking",fields:[{k:"orgNames",l:"Organisation name(s)",t:"textarea",p:"One per line, or comma-separated",req:true},{k:"sector",l:"Sector (leave blank to classify later)",t:"text"},{k:"subsector",l:"Sub-sector, if known",t:"text"},{k:"tier",l:"Tier",t:"select",o:["B","A","C"],defaultValue:"B"},{k:"status",l:"Status",t:"select",o:orgStatuses,defaultValue:"Mapped"}]},' +
    ' not_sure:{title:"Capture what feels most live",fields:[{k:"notes",l:"What is the thing you are trying to get under control?",t:"textarea",p:"Interview, application, job, person, org, or messy notes..."}]}' +
    '};' +
    'function showStep(n){document.querySelectorAll(".step").forEach(function(x){x.classList.remove("active")});document.getElementById("q"+n).classList.add("active");}' +
    'function pickGoal(g){goal=g;' +
    ' if(g==="explore_space"){entryPoint="sectors";renderForm("sectors");return;}' +
    ' document.getElementById("q2title").innerHTML="<strong>2 of 3</strong> What should we capture first?";' +
    ' var opts=[["interviews","I have interviews","Creates/links a Job and an Interview round."],' +
    ' ["applications","I have applications submitted","Creates a Submitted application and a response-check task from the real submitted date."],' +
    ' ["jobs","I have jobs I want to apply to","Creates a Not-started application and asks whether to start work."],' +
    ' ["people","I have people or conversations","Creates a Person and the right outreach/follow-up state."],' +
    ' ["orgs","I have organisations to track","Creates/classifies Organisations — status you pick is honored; Active only ever suggests, never floods job/people search."],' +
    ' ["not_sure","I am not sure","Creates a light clarification task on Today."]];' +
    ' var c=document.getElementById("q2_options");c.innerHTML="";' +
    ' opts.forEach(function(o){var b=document.createElement("button");b.className="option";b.innerHTML=o[1]+"<small>"+o[2]+"</small>";b.onclick=function(){entryPoint=o[0];renderForm(o[0]);};c.appendChild(b);});' +
    ' showStep(2);}' +
    'function fieldVisible(field,form){if(field.showIf)return form.elements[field.showIf.k]&&form.elements[field.showIf.k].value===field.showIf.v;if(field.showIfAny)return field.showIfAny.some(function(rule){return form.elements[rule.k]&&form.elements[rule.k].value===rule.v;});if(field.showIfSet)return !!(form.elements[field.showIfSet]&&form.elements[field.showIfSet].value);return true;}' +
    'function updateConditional(form,cfg){(cfg.fields||[]).forEach(function(field,idx){var label=form.children[idx];if(label)label.style.display=fieldVisible(field,form)?"block":"none";});}' +
    'function visibleFields(form,cfg){var fields={};Array.prototype.forEach.call(form.elements,function(el){if(!el.name)return;var idx=(cfg.fields||[]).map(function(f){return f.k;}).indexOf(el.name),field=cfg.fields[idx];if(!field||fieldVisible(field,form))fields[el.name]=el.value;});return fields;}' +
    'function renderForm(ep){var cfg=forms[ep];document.getElementById("q3title").innerHTML="<strong>3 of 3</strong> "+cfg.title;var f=document.getElementById("captureForm");f.innerHTML="";' +
    ' cfg.fields.forEach(function(field){var label=document.createElement("label");label.textContent=field.l+(field.req?" *":"");var input;' +
    '  if(field.t==="textarea"){input=document.createElement("textarea");}' +
    '  else if(field.t==="select"){input=document.createElement("select");if(field.blank){var blank=document.createElement("option");blank.value="";blank.textContent="Select...";input.appendChild(blank);}(field.o||[]).forEach(function(v){var opt=document.createElement("option");opt.value=v;opt.textContent=v;input.appendChild(opt);});if(field.defaultValue!==undefined)input.value=field.defaultValue;}' +
    '  else{input=document.createElement("input");input.type=field.t||"text";}' +
    '  input.name=field.k;if(field.req)input.required=true;if(field.p)input.placeholder=field.p;label.appendChild(input);f.appendChild(label);});Array.prototype.forEach.call(f.elements,function(el){el.onchange=function(){updateConditional(f,cfg);};});updateConditional(f,cfg);' +
    ' showStep(3);}' +
    'function submitSetup(){var form=document.getElementById("captureForm"),status=document.getElementById("status"),cfg=forms[entryPoint]||{fields:[]},fields=visibleFields(form,cfg);' +
    ' for(var i=0;i<cfg.fields.length;i++){var field=cfg.fields[i];if(fieldVisible(field,form)&&field.req&&!String(fields[field.k]||"").trim()){status.textContent=field.l+" is required.";if(form.elements[field.k])form.elements[field.k].focus();return;}}' +
    ' var resetConfirmed=existingRows>0&&goal!=="skipped"&&entryPoint!=="skip";if(resetConfirmed&&!confirm("Redo onboarding will clear "+existingRows+" existing planner row(s). Continue?")){status.textContent="Setup cancelled. Existing data was not changed.";return;}' +
    ' var backupBeforeReset=resetConfirmed&&document.getElementById("backupBeforeReset")&&document.getElementById("backupBeforeReset").checked;' +
    ' status.textContent=resetConfirmed?(backupBeforeReset?"Creating backup copy, then clearing data...":"Clearing existing data and saving..."):"Saving setup...";' +
    ' google.script.run.withSuccessHandler(function(res){res=res||{};var status=document.getElementById("status");if(!res.ok){status.textContent=res.message||"Please check the form.";if(res.field&&document.getElementById("captureForm").elements[res.field])document.getElementById("captureForm").elements[res.field].focus();return;}status.textContent=res.message||"Saved.";setTimeout(function(){google.script.host.close();},900);})' +
    ' .withFailureHandler(function(err){document.getElementById("status").textContent="Could not save. Run Maintenance > Repair all tabs, then try again.";})' +
    ' .completeSetupFromPopup({goal:goal,entryPoint:entryPoint,fields:fields,resetConfirmed:resetConfirmed,backupBeforeReset:backupBeforeReset});}' +
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
      alwaysDone: true,
      label: 'Add 2-4 sub-sector rows for your first broad sector',
      text: 'Add 2-4 sub-sector rows',
      tab: 'Today',
      notes: 'Open the linked Sector task, then add child rows on Sectors with the same Sector and a filled Sub-sector.'
    }];
  }
  var map = {
    jobs: [{ alwaysDone: true, label: 'Review the start-application decision', text: 'Review the start-application decision', tab: 'Home', notes: 'The captured job queues a Home decision before application work is created.' }],
    applications: [{ workflow: 'Check application response', label: 'Check application response', text: 'Check application response', tab: 'Tasks', notes: 'Due from the submitted date + 12 days.' }],
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
  if (goal === 'skipped' || entryPoint === 'skip') return okResult('Setup skipped. You can run onboarding again from the menu any time.');
  if (entryPoint === 'sectors') return processSectorOnboarding(fields);
  if (entryPoint === 'interviews') return processInterviewOnboarding(fields);
  if (entryPoint === 'applications') return processApplicationOnboarding(fields);
  if (entryPoint === 'jobs') return processJobOnboarding(fields);
  if (entryPoint === 'people') return processPeopleOnboarding(fields);
  if (entryPoint === 'orgs') return processOrgOnboarding(fields);
  return processNotSureOnboarding(fields);
}

function validateOnboardingPayload(goal, entryPoint, fields) {
  fields = fields || {};
  if (goal === 'skipped' || entryPoint === 'skip') return okResult('Setup skipped.');
  if (entryPoint === 'applications') {
    if (!fields.org) return failResult('I need the organisation name to capture an application.', 'org', 'MISSING_ORG');
    if (!fields.jobTitle) return failResult('I need at least a job title to capture an application.', 'jobTitle', 'MISSING_JOB_TITLE');
  }
  if (entryPoint === 'jobs') {
    if (!fields.jobTitle) return failResult('I need at least a job title to capture a job.', 'jobTitle', 'MISSING_JOB_TITLE');
    if (!fields.org) return failResult('I need the organisation name to capture a job.', 'org', 'MISSING_ORG');
  }
  if (entryPoint === 'interviews') {
    if (!fields.jobTitle) return failResult('I need at least a job title to capture an interview.', 'jobTitle', 'MISSING_JOB_TITLE');
    if (!fields.org) return failResult('I need the organisation name to capture an interview.', 'org', 'MISSING_ORG');
  }
  if (entryPoint === 'people') {
    if (!fields.name) return failResult('I need at least a name to capture this person.', 'name', 'MISSING_PERSON');
    if (!fields.org) return failResult('I need the organisation name to capture this person.', 'org', 'MISSING_ORG');
  }
  if (entryPoint === 'orgs' && !splitInputList(fields.orgNames).length) {
    return failResult('I need at least one organisation name to capture this.', 'orgNames', 'MISSING_ORG');
  }
  return okResult('Valid.');
}

// Sector onboarding uses the exact same upsertSectorBranch/
// fireSectorOnlyTask path as manual sheet entry — this is what keeps
// popup capture and direct typing behaviorally identical.
function processSectorOnboarding(fields, source) {
  source = source || 'onboarding';
  var sectors = splitInputList(fields.sectorNames);
  if (!sectors.length) {
    fireSectorOnlyTask('your first sector');
    return okResult('Added the sector-picking task to Today.');
  }
  sectors.forEach(function (sector, idx) {
    var branch = upsertSectorBranch({ sector: sector, source: source, createExpansionDecision: false });
    if (idx < 2) fireSectorOnlyTask(branch);
  });
  var warnings = sectors.length > 2 ? ['Created all broad sectors; sub-sector entry tasks were created for the first 2.'] : [];
  return okResult('Added ' + sectors.length + ' broad sector(s). Today now has the task to add narrower sub-sector rows.', { warnings: warnings });
}

function processApplicationOnboarding(fields) {
  if (!fields.org) return failResult('I need the organisation name to capture an application.', 'org', 'MISSING_ORG');
  var org = createNameOnlyOrg(fields.org || '', { status: 'Mapped', stub: true });
  if (!fields.jobTitle) return failResult('I need at least a job title to capture an application.', 'jobTitle', 'MISSING_JOB_TITLE');
  var jobId = writeJobRow(fields.jobTitle, org, 'Submitted');
  promoteOrgForLiveJob(org && org.id, 'Submitted');
  fireJobStatusChanged(jobId, '', 'Submitted', { realDate: fields.appliedDate || today() });
  if (fields.urlNotes) appendNoteFlag(getSheet('Jobs'), getJobRowById(jobId).row, COLS.JOBS.NOTES, fields.urlNotes);
  return okResult('Captured the application and created the response-check follow-up.');
}

function processJobOnboarding(fields) {
  if (!fields.jobTitle) return failResult('I need at least a job title to capture a job.', 'jobTitle', 'MISSING_JOB_TITLE');
  if (!fields.org) return failResult('I need the organisation name to capture a job.', 'org', 'MISSING_ORG');
  var org = createNameOnlyOrg(fields.org || '', { status: 'Mapped', stub: true });
  var jobId = writeJobRow(fields.jobTitle, org, 'Not started');
  promoteOrgForLiveJob(org && org.id, 'Not started');
  if (fields.deadline) getSheet('Jobs').getRange(getJobRowById(jobId).row, COLS.JOBS.DEADLINE).setValue(fields.deadline);
  if (fields.urlNotes) appendNoteFlag(getSheet('Jobs'), getJobRowById(jobId).row, COLS.JOBS.NOTES, fields.urlNotes);
  fireJobStatusChanged(jobId, '', 'Not started', {});
  return okResult('Captured the job. Set Application status to In progress when you are ready to plan the application work.');
}

function processInterviewOnboarding(fields) {
  if (!fields.jobTitle) return failResult('I need at least a job title to capture an interview.', 'jobTitle', 'MISSING_JOB_TITLE');
  if (!fields.org) return failResult('I need the organisation name to capture an interview.', 'org', 'MISSING_ORG');
  var org = createNameOnlyOrg(fields.org || '', { status: 'Mapped', stub: true });
  var jobId = writeJobRow(fields.jobTitle, org, 'Submitted');
  promoteOrgForLiveJob(org && org.id, 'Submitted');
  var roundNum = fields.roundNumber || '1';
  fireJobStatusChanged(jobId, '', 'Submitted', { realDate: fields.appliedDate || today() });
  routeJobOutcome(jobId, 'Interview invite', {
    source: 'interview-onboarding',
    forceRound: true,
    roundDetails: { roundNum: roundNum, roundType: fields.roundType || 'Other', interviewDate: fields.interviewDate || '', domainReadiness: fields.domainReadiness || '' }
  });
  var round = findRoundByJobRound(jobId, roundNum);
  if (round && (fields.status || fields.officialOutcome)) {
    var sheet = getSheet('Interviews');
    if (fields.status && DROPDOWNS.ROUND_STATUS.indexOf(fields.status) !== -1) {
      sheet.getRange(round.row, COLS.ROUNDS.STATUS).setValue(fields.status);
      if (fields.status === 'Completed') {
        markInterviewRoundCompleted(round.id, { forceLog: true });
      }
      if (fields.status === 'Reschedule') {
        sheet.getRange(round.row, COLS.ROUNDS.INTERVIEW_DATE).setValue('');
        sheet.getRange(round.row, COLS.ROUNDS.EXPECTED_RESPONSE).setValue('');
        appendTodoOnceForWorkflow('Reschedule interview: ' + fields.jobTitle + ' at ' + org.name, 'Interview round', round.id, org.name, 'Interview scheduling', 'Not started', '', '15 min', 'Find a new time, then update Interview date.', 'Auto-triggered');
        pauseInterviewPrepForReschedule(round.id);
        syncOpenInterviewTaskDates(round.id);
      }
      if (fields.status === 'Cancelled') {
        setOpenTodosForTarget('Interview round', round.id, 'Cancelled', 'Interview round cancelled',
          ['Interview scheduling', 'Plan interview prep', 'Interview prep', 'Interview prep (Domain scoping)', 'Interview prep (Study)', 'Interview prep (Fit case)', 'Day-before review', 'Thank-you and debrief', 'Interview follow-up']);
        autoDismissPendingForTarget('Interview round', round.id, 'Interview round cancelled');
      }
    }
    if (fields.officialOutcome && DROPDOWNS.OFFICIAL_OUTCOME.indexOf(fields.officialOutcome) !== -1) {
      handleInterviewOfficialOutcome(round.id, fields.officialOutcome, { source: 'interview-onboarding' });
    }
  }
  return okResult('Captured the interview and created the prep path.');
}

// v7.1: relationship type is now captured and written to People if the
// user supplied one (fields.relType), instead of being silently dropped.
function processPeopleOnboarding(fields) {
  if (!fields.name) return failResult('I need at least a name to capture this person.', 'name', 'MISSING_PERSON');
  var org = fields.org ? createNameOnlyOrg(fields.org, { status: 'Mapped', stub: true }) : null;
  var existingPerson = findPersonByNameOrg(fields.name, org ? org.name : '');
  var reached = String(fields.reachedOut || 'No') === 'Yes';
  var replied = String(fields.replied || 'No') === 'Yes';
  var stage = reached ? 'Outreach sent' : 'Identified';
  var realDate = reached ? fields.outreachDate : null;
  var personId = writePersonRow(fields.name, org, fields.role || '');
  promoteOrgForLivePerson(org && org.id, stage);
  if (fields.relType && DROPDOWNS.PERSON_REL_TYPE.indexOf(fields.relType) !== -1) {
    var pRow = getPersonRowById(personId);
    if (pRow) getSheet('People').getRange(pRow.row, COLS.PEOPLE.REL_TYPE).setValue(fields.relType);
  }
  movePersonStage(personId, stage, { realDate: realDate });
  if (reached && replied) {
    var where = fields.whereNow || '';
    if (where === 'Conversation scheduled') routePersonConversationScheduled(personId, fields.conversationDate);
    else if (where === 'Already spoke') recordPersonConversationCompleted(personId, fields.conversationDate);
    else routePersonReplyReceived(personId, { source: 'capture' });
  }
  if (fields.notes) appendNoteFlag(getSheet('People'), getPersonRowById(personId).row, COLS.PEOPLE.NOTES, fields.notes);
  return okResult((existingPerson ? 'Updated existing' : 'Created') + ' person: ' + fields.name + ' at ' + (org ? org.name : fields.org) + '. Routed the outreach/follow-up state.');
}

// v7.1: honors the Status the user explicitly picked (Mapped/Active/
// Dormant/Archived) instead of always forcing Mapped. Active still only
// ever creates the two Pending Decisions via createNameOnlyOrg ->
// fireOrgActiveCascade — never a direct search Task.
function processOrgOnboarding(fields) {
  var names = splitInputList(fields.orgNames);
  if (!names.length) return failResult('I need at least one organisation name to capture this.', 'orgNames', 'MISSING_ORG');
  if (fields.subsector && !fields.sector) return failResult('Add Sector before Sub-sector so I know where to link it.', 'sector', 'MISSING_SECTOR');
  var status = (fields.status && DROPDOWNS.ORG_STATUS.indexOf(fields.status) !== -1) ? fields.status : 'Mapped';
  var created = 0, reused = 0, activeRoutes = 0;
  names.forEach(function (name) {
    var hasTaxonomyInput = !!(fields.sector || fields.subsector);
    var org = createNameOnlyOrg(name, { status: status, tier: fields.tier || 'B', deferClassification: hasTaxonomyInput });
    if (org && org.existing) reused++; else if (org) created++;
    if (applyOrganisationStatusFromCapture(org, status, fields.tier || 'B') || (org && !org.existing && status === 'Active')) activeRoutes++;
    if (org && (fields.sector || fields.subsector)) applyOrgTaxonomyLink(org.row, fields.sector || '', fields.subsector || '');
    else if (org) ensureOrgClassificationState(org.row);
  });
  var suffix = status === 'Active'
    ? (activeRoutes ? ' Marked Active - decisions to find people/scan jobs were queued where newly needed.' : ' Status: Active. No new people/job-scan decisions were needed.')
    : ' Status: ' + status + '.';
  return okResult('Captured ' + names.length + ' organisation(s): ' + created + ' new, ' + reused + ' existing.' + suffix);
}

function processNotSureOnboarding(fields) {
  appendTodo('Clarify what is most live in the search', 'None', '', '', 'Admin', 'Not started', '', '15 min',
    fields.notes || 'Pick the most time-sensitive object: interview, application, job, person, organisation, or sector.');
  return okResult('Added a light clarification task to Today.');
}

function writeJobRow(title, org, status) {
  var sheet = getSheet('Jobs');
  var existing = findJobByTitleOrg(title, org ? org.name : '');
  var exactExisting = isExactJobTitleOrgMatch(existing, title, org ? org.name : '');
  if (exactExisting) {
    var normalizedStatus = normalizeJobStatus(status);
    if (normalizedStatus && normalizeJobStatus(existing.data[COLS.JOBS.STATUS - 1]) !== normalizedStatus) {
      sheet.getRange(existing.row, COLS.JOBS.STATUS).setValue(normalizedStatus);
    }
    return existing.data[COLS.JOBS.ID - 1];
  }
  var id = nextId(sheet, COLS.JOBS.ID, 'JOB');
  var row = new Array(HEADERS.Jobs.length).fill('');
  row[COLS.JOBS.ID - 1] = id;
  row[COLS.JOBS.OPPORTUNITY - 1] = title;
  row[COLS.JOBS.ORG - 1] = org ? org.name : '';
  row[COLS.JOBS.ORG_ID - 1] = org ? org.id : '';
  row[COLS.JOBS.STATUS - 1] = normalizeJobStatus(status) || status;
  sheet.appendRow(row);
  if (existing && !exactExisting) {
    appendNoteFlag(sheet, sheet.getLastRow(), COLS.JOBS.NOTES, '[possible-duplicate-job] Similar to row ' + existing.row + ': ' + existing.data[COLS.JOBS.OPPORTUNITY - 1]);
  }
  return id;
}

function writePersonRow(name, org, role) {
  var sheet = getSheet('People');
  var existing = findPersonByNameOrg(name, org ? org.name : '');
  if (existing) {
    if (role && !existing.data[COLS.PEOPLE.ROLE - 1]) sheet.getRange(existing.row, COLS.PEOPLE.ROLE).setValue(role);
    return existing.data[COLS.PEOPLE.ID - 1];
  }
  var id = nextId(sheet, COLS.PEOPLE.ID, 'PER');
  var row = new Array(HEADERS.People.length).fill('');
  row[COLS.PEOPLE.ID - 1] = id;
  row[COLS.PEOPLE.NAME - 1] = name;
  row[COLS.PEOPLE.ORG - 1] = org ? org.name : '';
  row[COLS.PEOPLE.ORG_ID - 1] = org ? org.id : '';
  row[COLS.PEOPLE.ROLE - 1] = role || '';
  row[COLS.PEOPLE.STAGE - 1] = 'Identified';
  row[COLS.PEOPLE.FOLLOW_UPS_SENT_COUNT - 1] = 0;
  sheet.appendRow(row);
  return id;
}

function knownPeopleForJob(jobId) {
  var job = getJobRowById(jobId);
  var sheet = getSheet('People');
  if (!job || !sheet || sheet.getLastRow() < 2) return [];
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS.People.length).getValues();
  var out = [];
  for (var i = 0; i < data.length; i++) {
    var orgId = String(data[i][COLS.PEOPLE.ORG_ID - 1] || '');
    var orgName = String(data[i][COLS.PEOPLE.ORG - 1] || '');
    if ((job.orgId && orgId === String(job.orgId)) || (!job.orgId && orgName === String(job.org))) {
      out.push({
        id: String(data[i][COLS.PEOPLE.ID - 1] || ''),
        name: String(data[i][COLS.PEOPLE.NAME - 1] || ''),
        role: String(data[i][COLS.PEOPLE.ROLE - 1] || ''),
        stage: String(data[i][COLS.PEOPLE.STAGE - 1] || '')
      });
    }
  }
  return out.filter(function (p) { return p.id && p.name; });
}

function parseLinkedContactIds(value) {
  return String(value || '').split(',').map(function (s) { return s.trim(); }).filter(String);
}

function uniqueLinkedContactIds(ids) {
  var seen = {}, out = [];
  (ids || []).forEach(function (id) {
    var clean = String(id || '').trim();
    if (!clean || seen[clean]) return;
    seen[clean] = true;
    out.push(clean);
  });
  return out;
}

function writeLinkedContactIdsForJobRow(sheet, row, ids) {
  var clean = uniqueLinkedContactIds(ids);
  sheet.getRange(row, COLS.JOBS.CONTACTS_IDS).setValue(clean.join(', '));
  return clean;
}

function linkPersonIdToJob(jobId, personId) {
  var job = getJobRowById(jobId), person = getPersonRowById(personId);
  if (!job || !person) return false;
  var sheet = getSheet('Jobs');
  var existing = String(sheet.getRange(job.row, COLS.JOBS.CONTACTS_IDS).getValue() || '');
  writeLinkedContactIdsForJobRow(sheet, job.row, parseLinkedContactIds(existing).concat([personId]));
  refreshLinkedContactsDisplay();
  syncPeopleHelperColumns();
  return true;
}

function createReferralOutreachTask(job, personId, source) {
  var person = getPersonRowById(personId);
  if (!job || !person) return '';
  var personName = String(person.name || '');
  var task = 'Draft outreach to ' + personName + ' about ' + job.title + ' at ' + job.org;
  var todoId = appendTodoOnceForWorkflow(task, 'Person', personId, job.org, 'Outreach', 'Not started',
    applicationPlanDueDate(job), '20 min',
    'Referral outreach for ' + job.title + ' at ' + job.org + '. Referral is optional; submit without it if there is not enough time.',
    source || 'Application plan');
  movePersonStage(personId, 'To outreach', { source: source || 'Application plan' });
  return todoId;
}

function applicationPlanTaskSpec(item, effort, job) {
  var map = {
    cv: {
      label: 'CV',
      Ready: ['Review CV', '15 min'],
      Light: ['Light CV edits', '30 min'],
      Moderate: ['Tailor CV', '60 min'],
      Heavy: ['Rebuild CV', '120 min']
    },
    cover: {
      label: 'Cover letter',
      Ready: ['Review cover letter', '15 min'],
      Light: ['Light cover letter edits', '30 min'],
      Moderate: ['Draft/tailor cover letter', '60 min'],
      Heavy: ['Write cover letter from scratch', '120 min']
    },
    form: {
      label: 'Application form',
      Ready: ['Review application form', '15 min'],
      Light: ['Complete short application form', '30 min'],
      Moderate: ['Complete application form', '60 min'],
      Heavy: ['Complete long application form', '120 min']
    },
    other: {
      label: 'Other',
      Ready: ['Review other application item', '15 min'],
      Light: ['Prepare other application item', '30 min'],
      Moderate: ['Prepare other application item', '60 min'],
      Heavy: ['Prepare other application item', '120 min']
    }
  };
  var itemMap = map[item];
  if (!itemMap || !itemMap[effort]) return null;
  return {
    task: itemMap[effort][0] + ': ' + job.title + ' at ' + job.org,
    time: itemMap[effort][1],
    notes: itemMap.label + ' effort: ' + effort + '.'
  };
}

function createApplicationPlanTask(job, task, workflow, dueDate, timeEst, notes) {
  var id = appendTodoWithSource(task, 'Job', job.id, job.org, workflow, 'Not started', dueDate, timeEst, notes, 'Application plan');
  return id || findOpenTodoByTaskTarget(task, job.id, workflow);
}

function openApplicationPrepTaskCount(jobId) {
  var sheet = getSheet('Tasks');
  if (!sheet || sheet.getLastRow() < 2 || !jobId) return 0;
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS['To-do'].length).getValues();
  var count = 0;
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][COLS.TODO.OBJ_TYPE - 1]) !== 'Job') continue;
    if (String(data[i][COLS.TODO.OBJ_ID - 1]) !== String(jobId)) continue;
    if (['Application preparation', 'Application blocker'].indexOf(String(data[i][COLS.TODO.WORKFLOW - 1])) === -1) continue;
    var status = String(data[i][COLS.TODO.STATUS - 1] || '');
    if (isOpenTodoStatus(status)) count++;
  }
  return count;
}

function createFinalSubmitTaskIfApplicationReady(job) {
  if (!job || !job.id) return '';
  if (openApplicationPrepTaskCount(job.id) > 0) return '';
  return createApplicationPlanTask(job, 'Final QA and submit application: ' + job.title + ' at ' + job.org,
    'Submit application', applicationPlanDueDate(job), '20 min',
    'All required application prep is complete. Referral is optional; do not block submission just because no referral was found.');
}

function resolveApplicationPlanDecision(decisionId, todoId) {
  if (!decisionId) return;
  var found = getDecisionRowById(decisionId);
  if (!found) return;
  found.sheet.getRange(found.row, COLS.DECISIONS.DECISION).setValue('Yes');
  found.sheet.getRange(found.row, COLS.DECISIONS.DECIDED_AT).setValue(today());
  if (todoId) found.sheet.getRange(found.row, COLS.DECISIONS.TODO_ID).setValue(todoId);
  applyDecisionHelperColumns(found.sheet, found.row);
}

function resolvePopupDecision(decisionId, todoId, note) {
  if (!decisionId) return;
  var found = getDecisionRowById(decisionId);
  if (!found) return;
  found.sheet.getRange(found.row, COLS.DECISIONS.DECISION).setValue('Yes');
  found.sheet.getRange(found.row, COLS.DECISIONS.DECIDED_AT).setValue(today());
  if (todoId) found.sheet.getRange(found.row, COLS.DECISIONS.TODO_ID).setValue(todoId);
  if (note) appendNoteFlag(found.sheet, found.row, COLS.DECISIONS.NOTES, '[handled] ' + note);
  applyDecisionHelperColumns(found.sheet, found.row);
}

// Called from the popup. Wipes existing data (unless skipped), captures
// the new facts, rebuilds the checklist, and refreshes Today/Home.
function completeSetupFromPopup(payload) {
  payload = payload || {};
  var goal = payload.goal || 'skipped';
  var entryPoint = payload.entryPoint || 'skip';
  var fields = payload.fields || {};
  var validation = validateOnboardingPayload(goal, entryPoint, fields);
  if (!validation.ok) return validation;
  var shouldReset = goal !== 'skipped' && entryPoint !== 'skip';
  if (shouldReset && plannerDataRowCount() > 0 && payload.resetConfirmed !== true) {
    var resp = SpreadsheetApp.getUi().alert(
      'Clear existing planner data?',
      'This clears all Sectors/Organisations/Jobs/People/Conversations/Interviews/Tasks/Decisions data. Continue?',
      SpreadsheetApp.getUi().ButtonSet.YES_NO);
    if (resp !== SpreadsheetApp.getUi().Button.YES) return failResult('Setup cancelled. Existing planner data was not changed.', '', 'SETUP_RESET_CANCELLED');
  }
  return withDocumentLock(function () {
    try {
      var backup = null;
      if (shouldReset && payload.backupBeforeReset === true) {
        try {
          backup = createPlannerBackupCopy();
        } catch (backupErr) {
          Logger.log('completeSetupFromPopup.backup: ' + (backupErr && backupErr.stack ? backupErr.stack : backupErr));
          return failResult('Backup copy could not be created, so existing data was not cleared. Try again, or untick the backup option if you already saved a copy.', '', 'SETUP_BACKUP_FAILED');
        }
      }
      if (shouldReset) resetPlannerDataForOnboarding();

      var result = coerceResult(processOnboardingCapture(goal, entryPoint, fields), 'Onboarding saved.');
      if (!result.ok) return result;
      var checklist = (goal === 'skipped' || entryPoint === 'skip') ? [] : setupChecklistFor(entryPoint, fields);
      saveSetupProfile({ goal: goal, entryPoint: entryPoint, checklist: checklist, capturedAt: new Date().toISOString() });

      refreshAllDropdowns();
      applyAllRichTextHeaders();
      setupTasksTabExtras();
      populateToday();
      refreshHome();
      colorCodeManualFields();
      applyStatusColorCoding();
      applyColumnLayout();
      applyColumnWidths();

      var todaySheet = getSheet('Today');
      if (todaySheet) SpreadsheetApp.setActiveSheet(todaySheet);
      var suffix = (goal !== 'skipped' && entryPoint !== 'skip') ? ' Existing planner data was cleared first.' : '';
      if (backup) suffix += ' Backup copy created: ' + backup.name + '.';
      result.message = (result.message || 'Onboarding saved.') + suffix;
      return result;
    } catch (err) {
      return popupExceptionResult('completeSetupFromPopup', err);
    }
  }, { label: 'completeSetupFromPopup', timeoutMs: 30000 });
}

// =============================================================
// TODAY — Capture update intake popups (non-destructive, ongoing capture)
// =============================================================

function todayUpdateTypeToCapture(updateType) {
  var map = {
    'Explore sectors': 'Explore sectors',
    'Find organisations': 'Find organisations',
    'Capture organisation': 'Add/update organisation',
    'Capture job': 'Add/update job',
    'Capture person': 'Add/update person',
    'Capture conversation': 'Add/update conversation',
    'Capture interview': 'Add/update interview',
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
  var roundTypes = DROPDOWNS.ROUND_TYPE, jobStatuses = DROPDOWNS.JOB_STATUS, jobOutcomes = DROPDOWNS.JOB_OUTCOME;
  var config = {
    'Explore sectors': { title: 'Explore broad sectors', fields: [{ k: 'sectorNames', l: 'Broad sector(s) to explore', t: 'textarea', p: 'Climate\nAI governance' }] },
    'Find organisations': {
      title: 'Add organisations found from exploration',
      fields: [{ k: 'sector', l: 'Sector', t: 'text' }, { k: 'subsector', l: 'Sub-sector', t: 'text' },
      { k: 'orgNames', l: 'Organisation names', t: 'textarea', p: 'One per line, or comma-separated', req: true }]
    },
    'Add/update organisation': {
      title: 'Capture organisation',
      fields: [{ k: 'orgNames', l: 'Organisation name(s)', t: 'textarea', p: 'One per line, or comma-separated', req: true },
      { k: 'sector', l: 'Sector (leave blank to classify later)', t: 'text' }, { k: 'subsector', l: 'Sub-sector, if known', t: 'text' },
      { k: 'tier', l: 'Tier', t: 'select', o: ['B', 'A', 'C'], defaultValue: 'B' }, { k: 'status', l: 'Status', t: 'select', o: DROPDOWNS.ORG_STATUS, defaultValue: 'Mapped' }]
    },
    'Add/update job': {
      title: 'Capture job',
      fields: [{ k: 'org', l: 'Organisation', t: 'text', req: true }, { k: 'jobTitle', l: 'Job title / opportunity', t: 'text', req: true },
      { k: 'deadline', l: 'Deadline, if any', t: 'date' }, { k: 'status', l: 'Application status', t: 'select', o: jobStatuses, defaultValue: 'Not started' },
      { k: 'appliedDate', l: 'Submitted date, if already submitted', t: 'date', showIfAny: [{ k: 'status', v: 'Submitted' }, { k: 'status', v: 'Closed' }] }, { k: 'urlNotes', l: 'URL / source / notes', t: 'textarea' }]
    },
    'Application update': {
      title: 'Application update',
      fields: [{ k: 'org', l: 'Organisation', t: 'text', req: true }, { k: 'jobTitle', l: 'Job title / opportunity', t: 'text', req: true },
      { k: 'status', l: 'Application status', t: 'select', o: jobStatuses, blank: true, req: true },
      { k: 'appliedDate', l: 'Submitted date, if missing', t: 'date', showIfAny: [{ k: 'status', v: 'Submitted' }, { k: 'status', v: 'Closed' }] },
      { k: 'outcome', l: 'Application result', t: 'select', o: jobOutcomes, blank: true, showIfAny: [{ k: 'status', v: 'Submitted' }, { k: 'status', v: 'Closed' }] }]
    },
    'Add/update person': {
      title: 'Capture person',
      fields: [{ k: 'name', l: 'Name', t: 'text', req: true }, { k: 'org', l: 'Organisation, if relevant', t: 'text' }, { k: 'role', l: 'Role/title, if known', t: 'text' },
      { k: 'relType', l: 'Source / relationship', t: 'select', o: DROPDOWNS.PERSON_REL_TYPE, blank: true },
      { k: 'reachedOut', l: 'Have you already reached out?', t: 'select', o: ['No', 'Yes'], defaultValue: 'No' }, { k: 'replied', l: 'Have they replied?', t: 'select', o: ['No', 'Yes'], defaultValue: 'No', showIf: { k: 'reachedOut', v: 'Yes' } },
      { k: 'outreachDate', l: 'When did you reach out?', t: 'date', showIf: { k: 'reachedOut', v: 'Yes' } },
      { k: 'whereNow', l: 'If they replied, where are things now?', t: 'select', o: ['Need to respond / arrange next step', 'Conversation scheduled', 'Already spoke'], blank: true, showIf: { k: 'replied', v: 'Yes' } },
      { k: 'conversationDate', l: 'Conversation date, if scheduled/completed', t: 'date', showIfAny: [{ k: 'whereNow', v: 'Conversation scheduled' }, { k: 'whereNow', v: 'Already spoke' }] }, { k: 'notes', l: 'Notes/source', t: 'textarea' }]
    },
    'Add/update conversation': {
      title: 'Capture conversation',
      fields: [{ k: 'person', l: 'Person', t: 'text', req: true }, { k: 'org', l: 'Organisation', t: 'text' }, { k: 'date', l: 'Date', t: 'date' },
      { k: 'status', l: 'Interaction status', t: 'select', o: DROPDOWNS.INTERACTION_STATUS, defaultValue: 'Completed' },
      { k: 'notes', l: 'Notes', t: 'textarea' }, { k: 'outcome', l: 'Outcome', t: 'select', o: DROPDOWNS.INTERACTION_OUTCOME, blank: true, showIf: { k: 'status', v: 'Completed' } }]
    },
    'Add/update interview': {
      title: 'Capture interview',
      fields: [{ k: 'org', l: 'Organisation', t: 'text', req: true }, { k: 'jobTitle', l: 'Job title / opportunity', t: 'text', req: true },
      { k: 'roundNumber', l: 'Round number', t: 'text', p: '1' }, { k: 'roundType', l: 'Round type', t: 'select', o: roundTypes, blank: true },
      { k: 'interviewDate', l: 'Interview date', t: 'date' }, { k: 'status', l: 'Round status', t: 'select', o: DROPDOWNS.ROUND_STATUS, defaultValue: 'Scheduled', showIfSet: 'interviewDate' },
      { k: 'officialOutcome', l: 'Official outcome, if known', t: 'select', o: DROPDOWNS.OFFICIAL_OUTCOME, blank: true, showIf: { k: 'status', v: 'Completed' } }]
    },
    'Task completed / blocked': { title: 'Task completed / blocked', fields: [{ k: 'taskNotes', l: 'What changed?', t: 'textarea', p: 'If a task is done, tick it Done on Today instead. Use this for a blocker or a new follow-up.', req: true }] }
  };
  return config[captureType] || config['Task completed / blocked'];
}

function buildCaptureHtml(captureType, decisionId, presetFields) {
  var cfg = captureConfig(captureType);
  var json = JSON.stringify({ captureType: captureType, decisionId: decisionId || '', values: presetFields || {}, title: cfg.title, fields: cfg.fields });
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
    'cfg.fields.forEach(function(field){var label=document.createElement("label");label.textContent=field.l+(field.req?" *":"");var input;' +
    'if(field.t==="textarea"){input=document.createElement("textarea");}' +
    'else if(field.t==="select"){input=document.createElement("select");if(field.blank){var blank=document.createElement("option");blank.value="";blank.textContent="Select...";input.appendChild(blank);}(field.o||[]).forEach(function(v){var opt=document.createElement("option");opt.value=v;opt.textContent=v;input.appendChild(opt);});if(field.defaultValue!==undefined)input.value=field.defaultValue;}' +
    'else{input=document.createElement("input");input.type=field.t||"text";}' +
    'input.name=field.k;if(cfg.values&&Object.prototype.hasOwnProperty.call(cfg.values,field.k))input.value=cfg.values[field.k];if(field.req)input.required=true;if(field.p)input.placeholder=field.p;label.appendChild(input);f.appendChild(label);});' +
    'function fieldVisible(field){if(field.showIf)return f.elements[field.showIf.k]&&f.elements[field.showIf.k].value===field.showIf.v;if(field.showIfAny)return field.showIfAny.some(function(rule){return f.elements[rule.k]&&f.elements[rule.k].value===rule.v;});if(field.showIfSet)return !!(f.elements[field.showIfSet]&&f.elements[field.showIfSet].value);return true;}' +
    'function updateConditional(){cfg.fields.forEach(function(field,idx){var label=f.children[idx];label.style.display=fieldVisible(field)?"block":"none";});}' +
    'Array.prototype.forEach.call(f.elements,function(el){el.onchange=updateConditional;});updateConditional();' +
    'function submitCapture(){var fields={},form=document.getElementById("form"),status=document.getElementById("status");Array.prototype.forEach.call(form.elements,function(el){if(!el.name)return;var idx=cfg.fields.map(function(field){return field.k;}).indexOf(el.name),field=cfg.fields[idx];if(!field||fieldVisible(field))fields[el.name]=el.value;});' +
    'for(var i=0;i<cfg.fields.length;i++){var field=cfg.fields[i];if(fieldVisible(field)&&field.req&&!String(fields[field.k]||"").trim()){status.textContent=field.l+" is required.";if(form.elements[field.k])form.elements[field.k].focus();return;}}' +
    'status.textContent="Saving...";' +
    'google.script.run.withSuccessHandler(function(res){res=res||{};var status=document.getElementById("status");if(!res.ok){status.textContent=res.message||"Please check the form.";if(res.field&&document.getElementById("form").elements[res.field])document.getElementById("form").elements[res.field].focus();return;}status.textContent=res.message||"Saved.";setTimeout(function(){google.script.host.close();},700);})' +
    '.withFailureHandler(function(err){document.getElementById("status").textContent="Could not save. Run Maintenance > Repair all tabs, then try again.";})' +
    '.completeCaptureFromPopup({captureType:cfg.captureType,decisionId:cfg.decisionId,fields:fields});}</script>';
}

function runCapturePopup(captureType, decisionId, presetFields) {
  if (!captureType || captureType === 'No updates') return;
  var title = (captureConfig(captureType) || {}).title || captureType;
  var html = HtmlService.createHtmlOutput(buildCaptureHtml(captureType, decisionId || '', presetFields || {})).setWidth(600).setHeight(600).setTitle(title);
  SpreadsheetApp.getUi().showModalDialog(html, title);
}

function buildApplicationPlanHtml(jobId, decisionId) {
  var job = getJobRowById(jobId);
  if (!job) return '<p>Job not found.</p>';
  var data = {
    jobId: job.id,
    decisionId: decisionId || '',
    title: job.title,
    org: job.org,
    deadline: job.deadline ? formatDateHuman(job.deadline) : '',
    planBy: applicationPlanDueDate(job) ? formatDateHuman(applicationPlanDueDate(job)) : '',
    people: knownPeopleForJob(job.id)
  };
  var json = JSON.stringify(data).replace(/</g, '\\u003c');
  return '' +
    '<style>' +
    'body{font-family:Arial,sans-serif;padding:22px;color:#28251D;background:#FBFBF9;}' +
    'h2{margin:0 0 6px;color:#1B474D;font-size:20px;}p{color:#5F625E;font-size:13px;margin:6px 0 14px;}' +
    '.section{border-top:1px solid #D8DAD4;margin-top:16px;padding-top:14px;}.section h3{margin:0 0 8px;color:#1B474D;font-size:14px;}' +
    '.item{display:grid;grid-template-columns:1fr 160px;gap:10px;align-items:center;margin:8px 0;}.item label{font-weight:bold;color:#1B474D;font-size:13px;}' +
    'select,input,textarea{box-sizing:border-box;width:100%;padding:8px;border:1px solid #D8DAD4;border-radius:5px;font-size:13px;background:#FFF;}' +
    'textarea{min-height:58px;resize:vertical;}.hint{font-size:12px;color:#5F625E;margin-top:6px;}.hidden{display:none;}' +
    '.primary{margin-top:18px;padding:10px 14px;border:0;border-radius:5px;background:#01696F;color:#FFF;font-weight:bold;cursor:pointer;}' +
    '#status{font-size:12px;color:#5F625E;margin-top:10px;}</style>' +
    '<h2>Plan application</h2><p id="jobLine"></p>' +
    '<div class="section"><h3>What needs submitting?</h3><div id="items"></div><div class="hint">Ready = final check only; Light = under 30 min; Moderate = 30-90 min; Heavy = 90+ min.</div></div>' +
    '<div class="section"><h3>Referral</h3><select id="referral"></select><div id="knownBlock" class="hidden"><select id="personId"></select></div><div id="newBlock" class="hidden"><input id="personName" placeholder="Contact name"></div><div class="hint">Referral is optional. Submit is created when required prep is done, even if no referral was found.</div></div>' +
    '<div class="section"><h3>Blocker</h3><select id="blocker"><option>No</option><option>Yes</option></select><textarea id="blockerNotes" class="hidden" placeholder="What is blocking this application?"></textarea></div>' +
    '<button class="primary" type="button" onclick="submitPlan()">Create plan</button><div id="status"></div>' +
    '<script>var data=' + json + ';' +
    'var efforts=["Ready","Light","Moderate","Heavy"],items=[["cv","CV"],["cover","Cover letter"],["form","Application form"],["other","Other"]];' +
    'document.getElementById("jobLine").textContent=data.title+" at "+data.org+(data.deadline?" · Deadline "+data.deadline:"")+(data.planBy?" · Plan by "+data.planBy:"");' +
    'var itemsEl=document.getElementById("items");items.forEach(function(it){var row=document.createElement("div");row.className="item";var label=document.createElement("label");var cb=document.createElement("input");cb.type="checkbox";cb.id="need_"+it[0];label.appendChild(cb);label.appendChild(document.createTextNode(" "+it[1]));var sel=document.createElement("select");sel.id="effort_"+it[0];efforts.forEach(function(e){var opt=document.createElement("option");opt.value=e;opt.textContent=e;sel.appendChild(opt);});row.appendChild(label);row.appendChild(sel);itemsEl.appendChild(row);});' +
    'var ref=document.getElementById("referral"),opts=[["no_referral","No referral / submit without it"],["already_have","Already have referral"],["find_contact","Need to find someone"]];if(data.people.length)opts.push(["known_person","Reach out to known person"]);opts.push(["new_person","Add a new contact to reach out"]);opts.forEach(function(o){var opt=document.createElement("option");opt.value=o[0];opt.textContent=o[1];ref.appendChild(opt);});' +
    'var person=document.getElementById("personId");data.people.forEach(function(p){var opt=document.createElement("option");opt.value=p.id;opt.textContent=p.name+(p.role?" - "+p.role:"")+(p.stage?" ("+p.stage+")":"");person.appendChild(opt);});' +
    'function update(){document.getElementById("knownBlock").className=ref.value==="known_person"?"":"hidden";document.getElementById("newBlock").className=ref.value==="new_person"?"":"hidden";document.getElementById("blockerNotes").className=document.getElementById("blocker").value==="Yes"?"":"hidden";}' +
    'ref.onchange=update;document.getElementById("blocker").onchange=update;update();' +
    'function submitPlan(){var payload={jobId:data.jobId,decisionId:data.decisionId,items:{},referralPlan:ref.value,personId:person.value,personName:document.getElementById("personName").value,blocker:document.getElementById("blocker").value,blockerNotes:document.getElementById("blockerNotes").value};items.forEach(function(it){if(document.getElementById("need_"+it[0]).checked)payload.items[it[0]]=document.getElementById("effort_"+it[0]).value;});var status=document.getElementById("status");if(payload.referralPlan==="known_person"&&!payload.personId){status.textContent="Choose the known person.";return;}if(payload.referralPlan==="new_person"&&!String(payload.personName||"").trim()){status.textContent="Add the contact name.";return;}status.textContent="Creating plan...";google.script.run.withSuccessHandler(function(res){res=res||{};if(!res.ok){status.textContent=res.message||"Could not create plan.";return;}status.textContent=res.message||"Plan created.";setTimeout(function(){google.script.host.close();},900);}).withFailureHandler(function(){status.textContent="Could not create plan. Try again from Home.";}).completeApplicationPlanFromPopup(payload);}</script>';
}

function runApplicationPlanPopup(jobId, decisionId) {
  var html = HtmlService.createHtmlOutput(buildApplicationPlanHtml(jobId, decisionId)).setWidth(660).setHeight(700).setTitle('Plan application');
  SpreadsheetApp.getUi().showModalDialog(html, 'Plan application');
}

function completeApplicationPlanFromPopup(payload) {
  return withDocumentLock(function () {
    try {
      payload = payload || {};
      var job = getJobRowById(payload.jobId);
      if (!job) return failResult('I could not find that job.', '', 'JOB_NOT_FOUND');
      var due = applicationPlanDueDate(job);
      var created = [], finalSubmitId = '';
      var items = payload.items || {};
      if (String(payload.blocker || 'No') === 'Yes') {
        var blockerId = createApplicationPlanTask(job, 'Resolve application blocker: ' + job.title + ' at ' + job.org,
          'Application blocker', today(), '30 min', payload.blockerNotes || 'Application planning blocker.');
        if (blockerId) created.push(blockerId);
      }
      ['cv', 'cover', 'form', 'other'].forEach(function (item) {
        var spec = applicationPlanTaskSpec(item, items[item], job);
        if (!spec) return;
        var id = createApplicationPlanTask(job, spec.task, 'Application preparation', due, spec.time,
          spec.notes + ' Created from application planning.');
        if (id) created.push(id);
      });

      var referralPlan = String(payload.referralPlan || 'no_referral');
      if (referralPlan === 'already_have') {
        var reviewId = createApplicationPlanTask(job, 'Review referral plan: ' + job.title + ' at ' + job.org,
          'Referral search', due, '15 min', 'Referral is optional; submit without it if timing is tight.');
        if (reviewId) created.push(reviewId);
      } else if (referralPlan === 'find_contact') {
        var findId = createApplicationPlanTask(job, 'Find referral contact: ' + job.title + ' at ' + job.org,
          'Referral search', due, '30 min',
          'When done, the planner asks whether to link an existing person, add a new person, or close without a referral. Submit still proceeds.');
        if (findId) created.push(findId);
      } else if (referralPlan === 'known_person') {
        if (!payload.personId) return failResult('Choose the known person.', 'personId', 'MISSING_PERSON');
        linkPersonIdToJob(job.id, payload.personId);
        var knownOutreachId = createReferralOutreachTask(job, payload.personId, 'Application plan');
        if (knownOutreachId) created.push(knownOutreachId);
      } else if (referralPlan === 'new_person') {
        var personName = String(payload.personName || '').trim();
        if (!personName) return failResult('Add the contact name.', 'personName', 'MISSING_PERSON');
        var personId = writePersonRow(personName, { id: job.orgId, name: job.org }, '');
        var person = getPersonRowById(personId);
        if (person && !person.stage) getSheet('People').getRange(person.row, COLS.PEOPLE.STAGE).setValue('Identified');
        linkPersonIdToJob(job.id, personId);
        var newOutreachId = createReferralOutreachTask(job, personId, 'Application plan');
        if (newOutreachId) created.push(newOutreachId);
      }

      if (openApplicationPrepTaskCount(job.id) === 0) {
        finalSubmitId = createFinalSubmitTaskIfApplicationReady(job);
        if (finalSubmitId) created.push(finalSubmitId);
      }

      resolveApplicationPlanDecision(payload.decisionId, finalSubmitId || created[0] || '');
      clearNoteFlag(getSheet('Jobs'), job.row, COLS.JOBS.NOTES, '[needs-application-plan]');
      populateToday();
      refreshHome();
      renderTodayDecisionCards();
      colorCodeManualFields();
      return okResult('Application plan created: ' + created.length + ' task(s).');
    } catch (err) {
      return popupExceptionResult('completeApplicationPlanFromPopup', err);
    }
  }, { label: 'completeApplicationPlanFromPopup', timeoutMs: 30000 });
}

function isReferralSearchContactTask(todo) {
  return !!todo && todo.workflow === 'Referral search' && todo.objType === 'Job';
}

function isApplicationResponseCheckTask(todo) {
  return !!todo && todo.workflow === 'Check application response' && todo.objType === 'Job';
}

function buildReferralSearchResultHtml(todoId, decisionId) {
  var todo = getTodoById(todoId);
  var job = todo ? getJobRowById(todo.objId) : null;
  if (!todo || !job || !isReferralSearchContactTask(todo)) return '<p>Referral search task not found.</p>';
  var data = {
    todoId: todo.id,
    decisionId: decisionId || '',
    title: job.title,
    org: job.org,
    people: knownPeopleForJob(job.id)
  };
  var json = JSON.stringify(data).replace(/</g, '\\u003c');
  return '' +
    '<style>' +
    'body{font-family:Arial,sans-serif;padding:22px;color:#28251D;background:#FBFBF9;}' +
    'h2{margin:0 0 6px;color:#1B474D;font-size:20px;}p{color:#5F625E;font-size:13px;margin:6px 0 14px;}' +
    'label{display:block;margin-top:12px;font-size:12px;font-weight:bold;color:#1B474D;}' +
    'select,input{box-sizing:border-box;width:100%;margin-top:5px;padding:9px;border:1px solid #D8DAD4;border-radius:5px;font-size:13px;background:#FFF;}' +
    '.hidden{display:none;}.primary{margin-top:18px;padding:10px 14px;border:0;border-radius:5px;background:#01696F;color:#FFF;font-weight:bold;cursor:pointer;}' +
    '.secondary{margin-top:18px;margin-left:8px;padding:10px 14px;border:1px solid #D8DAD4;border-radius:5px;background:#FFF;color:#1B474D;font-weight:bold;cursor:pointer;}' +
    '#status{font-size:12px;color:#5F625E;margin-top:10px;}</style>' +
    '<h2>Referral/contact search</h2><p id="jobLine"></p>' +
    '<label>Result<select id="result"><option value="none">No useful contact found</option><option value="known">Use someone already in People</option><option value="new">Add someone new</option></select></label>' +
    '<label id="knownBlock" class="hidden">Person<select id="personId"></select></label>' +
    '<label id="newNameBlock" class="hidden">Contact name<input id="personName"></label>' +
    '<label id="newRoleBlock" class="hidden">Role/title, if known<input id="personRole"></label>' +
    '<button class="primary" type="button" onclick="save()">Save</button><button class="secondary" type="button" onclick="google.script.host.close()">Cancel</button><div id="status"></div>' +
    '<script>var data=' + json + ';document.getElementById("jobLine").textContent=data.title+" at "+data.org;' +
    'var person=document.getElementById("personId");data.people.forEach(function(p){var opt=document.createElement("option");opt.value=p.id;opt.textContent=p.name+(p.role?" - "+p.role:"")+(p.stage?" ("+p.stage+")":"");person.appendChild(opt);});' +
    'var result=document.getElementById("result");if(!data.people.length){Array.prototype.forEach.call(result.options,function(o){if(o.value==="known")o.disabled=true;});}function update(){var known=result.value==="known",nw=result.value==="new";document.getElementById("knownBlock").className=known?"":"hidden";document.getElementById("newNameBlock").className=nw?"":"hidden";document.getElementById("newRoleBlock").className=nw?"":"hidden";}' +
    'result.onchange=update;update();' +
    'function save(){var payload={todoId:data.todoId,decisionId:data.decisionId,result:result.value,personId:person.value,personName:document.getElementById("personName").value,personRole:document.getElementById("personRole").value};var status=document.getElementById("status");if(payload.result==="known"&&!payload.personId){status.textContent="Choose the person.";return;}if(payload.result==="new"&&!String(payload.personName||"").trim()){status.textContent="Add the contact name.";return;}status.textContent="Saving...";google.script.run.withSuccessHandler(function(res){res=res||{};if(!res.ok){status.textContent=res.message||"Could not save.";return;}status.textContent=res.message||"Saved.";setTimeout(function(){google.script.host.close();},800);}).withFailureHandler(function(){status.textContent="Could not save. Try again from Tasks.";}).completeReferralSearchResultFromPopup(payload);}</script>';
}

function runReferralSearchResultPopup(todoId, decisionId) {
  var html = HtmlService.createHtmlOutput(buildReferralSearchResultHtml(todoId, decisionId || '')).setWidth(520).setHeight(430).setTitle('Referral/contact search');
  SpreadsheetApp.getUi().showModalDialog(html, 'Referral/contact search');
}

function completeReferralSearchResultFromPopup(payload) {
  return withDocumentLock(function () {
    try {
      payload = payload || {};
      var todo = getTodoById(payload.todoId);
      var job = todo ? getJobRowById(todo.objId) : null;
      if (!todo || !job || !isReferralSearchContactTask(todo)) return failResult('I could not find that referral search task.', '', 'TASK_NOT_FOUND');
      var result = String(payload.result || 'none');
      var personId = '';
      if (result === 'known') {
        if (!payload.personId) return failResult('Choose the person.', 'personId', 'MISSING_PERSON');
        personId = String(payload.personId);
        if (!linkPersonIdToJob(job.id, personId)) return failResult('I could not link that person to the job.', 'personId', 'LINK_FAILED');
        createReferralOutreachTask(job, personId, 'Referral search');
      } else if (result === 'new') {
        var personName = String(payload.personName || '').trim();
        if (!personName) return failResult('Add the contact name.', 'personName', 'MISSING_PERSON');
        personId = writePersonRow(personName, { id: job.orgId, name: job.org }, String(payload.personRole || '').trim());
        var person = getPersonRowById(personId);
        if (person && !person.stage) getSheet('People').getRange(person.row, COLS.PEOPLE.STAGE).setValue('Identified');
        linkPersonIdToJob(job.id, personId);
        createReferralOutreachTask(job, personId, 'Referral search');
      } else if (result !== 'none') {
        return failResult('Choose what happened with the referral search.', 'result', 'INVALID_RESULT');
      }
      completeTodo(todo.id, 'Done', { source: 'referral-popup', referralSearchHandled: true });
      refreshLinkedContactsDisplay();
      resolvePopupDecision(payload.decisionId, '', result === 'none' ? 'Referral search closed without a contact' : 'Referral contact linked');
      populateToday();
      refreshHome();
      renderTodayDecisionCards();
      return okResult(result === 'none' ? 'Referral search closed. Submit is not blocked.' : 'Contact linked to this application and outreach task created.');
    } catch (err) {
      return popupExceptionResult('completeReferralSearchResultFromPopup', err);
    }
  }, { label: 'completeReferralSearchResultFromPopup', timeoutMs: 30000 });
}

function buildSourceScanResultHtml(todoId, decisionId) {
  var todo = getTodoById(todoId);
  if (!todo || !isSourceLedScanTask(todo)) return '<p>Source scan task not found.</p>';
  var isPeople = todo.workflow === 'People source scan';
  var data = { todoId: todo.id, decisionId: decisionId || '', workflow: todo.workflow, isPeople: isPeople, sources: DROPDOWNS.PERSON_REL_TYPE };
  var json = JSON.stringify(data).replace(/</g, '\\u003c');
  return '' +
    '<style>body{font-family:Arial,sans-serif;padding:22px;color:#28251D;background:#FBFBF9;}h2{margin:0 0 8px;color:#1B474D;font-size:20px;}p,.hint{color:#5F625E;font-size:13px;}label{display:block;margin-top:12px;font-size:12px;font-weight:bold;color:#1B474D;}input,textarea,select{box-sizing:border-box;width:100%;margin-top:5px;padding:9px;border:1px solid #D8DAD4;border-radius:5px;font-size:13px;}textarea{min-height:70px;resize:vertical;}.hidden{display:none;}.primary{margin-top:18px;padding:10px 14px;border:0;border-radius:5px;background:#01696F;color:#FFF;font-weight:bold;cursor:pointer;}.secondary{margin-top:18px;margin-left:8px;padding:10px 14px;border:1px solid #D8DAD4;border-radius:5px;background:#FBFBF9;color:#1B474D;font-weight:bold;cursor:pointer;}#status{font-size:12px;color:#5F625E;margin-top:10px;}</style>' +
    '<h2>Capture scan results</h2><p id="intro"></p>' +
    '<div id="peopleBlock" class="hidden"><label>People found<textarea id="personNames" placeholder="One per line, or comma-separated"></textarea></label><label>Relationship source<select id="relType"></select></label><label>Organisation, if relevant<input id="personOrg"></label><label>Notes/source<textarea id="peopleNotes"></textarea></label><div class="hint">People are saved as Identified. Outreach is not created automatically.</div></div>' +
    '<div id="oppBlock" class="hidden"><label>Organisations found<textarea id="orgNames" placeholder="One per line, or comma-separated"></textarea></label><label>Sector<input id="sector"></label><label>Sub-sector<input id="subsector"></label><label>Opportunity title<input id="jobTitle"></label><label>Organisation for opportunity<input id="jobOrg"></label><label>Deadline<input id="deadline" type="date"></label><label>URL / notes<textarea id="urlNotes"></textarea></label></div>' +
    '<button class="primary" type="button" onclick="save(false)">Save results</button><button class="secondary" type="button" onclick="save(true)">Nothing useful found</button><div id="status"></div>' +
    '<script>var data=' + json + ';document.getElementById("intro").textContent=data.workflow+" completed.";document.getElementById(data.isPeople?"peopleBlock":"oppBlock").className="";var rel=document.getElementById("relType");data.sources.forEach(function(s){var opt=document.createElement("option");opt.value=s;opt.textContent=s;rel.appendChild(opt);});' +
    'function save(noResults){var payload={todoId:data.todoId,decisionId:data.decisionId,workflow:data.workflow,noResults:!!noResults,personNames:document.getElementById("personNames").value,relType:rel.value,personOrg:document.getElementById("personOrg").value,peopleNotes:document.getElementById("peopleNotes").value,orgNames:document.getElementById("orgNames").value,sector:document.getElementById("sector").value,subsector:document.getElementById("subsector").value,jobTitle:document.getElementById("jobTitle").value,jobOrg:document.getElementById("jobOrg").value,deadline:document.getElementById("deadline").value,urlNotes:document.getElementById("urlNotes").value};var status=document.getElementById("status");if(!payload.noResults&&data.isPeople&&!String(payload.personNames||"").trim()){status.textContent="Add at least one person, or use Nothing useful found.";return;}if(!payload.noResults&&!data.isPeople&&!String((payload.orgNames||"")+(payload.jobTitle||"")).trim()){status.textContent="Add an organisation or opportunity, or use Nothing useful found.";return;}status.textContent="Saving...";google.script.run.withSuccessHandler(function(res){res=res||{};if(!res.ok){status.textContent=res.message||"Could not save.";return;}status.textContent=res.message||"Saved.";setTimeout(function(){google.script.host.close();},800);}).withFailureHandler(function(){status.textContent="Could not save. Try again from Tasks.";}).completeSourceScanResultFromPopup(payload);}</script>';
}

function runSourceScanResultPopup(todoId, decisionId) {
  var html = HtmlService.createHtmlOutput(buildSourceScanResultHtml(todoId, decisionId || '')).setWidth(600).setHeight(650).setTitle('Capture scan results');
  SpreadsheetApp.getUi().showModalDialog(html, 'Capture scan results');
}

function processSourceLedPeopleCapture(fields) {
  var names = splitInputList(fields.personNames);
  if (!names.length) return failResult('Add at least one person found by the scan.', 'personNames', 'MISSING_PERSON');
  var org = fields.personOrg ? createNameOnlyOrg(fields.personOrg, { status: 'Mapped', stub: true }) : null;
  var relType = DROPDOWNS.PERSON_REL_TYPE.indexOf(fields.relType) !== -1 ? fields.relType : '';
  var created = 0, reused = 0;
  names.forEach(function (name) {
    var existing = findPersonByNameOrg(name, org ? org.name : '');
    var personId = writePersonRow(name, org, '');
    var person = getPersonRowById(personId);
    if (!person) return;
    if (existing) reused++; else created++;
    var peopleSheet = getSheet('People');
    if (relType) peopleSheet.getRange(person.row, COLS.PEOPLE.REL_TYPE).setValue(relType);
    if (!peopleSheet.getRange(person.row, COLS.PEOPLE.STAGE).getValue()) peopleSheet.getRange(person.row, COLS.PEOPLE.STAGE).setValue('Identified');
    if (fields.peopleNotes) appendNoteFlag(peopleSheet, person.row, COLS.PEOPLE.NOTES, fields.peopleNotes);
  });
  syncPeopleHelperColumns();
  return okResult('Captured ' + names.length + ' people from source scan as Identified.');
}

function completeSourceScanResultFromPopup(payload) {
  return withDocumentLock(function () {
    try {
      payload = payload || {};
      var todo = getTodoById(payload.todoId);
      if (!todo || !isSourceLedScanTask(todo)) return failResult('I could not find that source-scan task.', '', 'TASK_NOT_FOUND');
      var result;
      var noResults = payload.noResults === true || String(payload.noResults || '') === 'true';
      if (noResults) {
        appendNoteFlag(todo.sheet, todo.row, COLS.TODO.NOTES, '[no-results] Source scan completed without useful rows found.');
        result = okResult('Closed source scan with no new rows.');
      } else if (todo.workflow === 'People source scan') {
        result = processSourceLedPeopleCapture(payload);
      } else {
        var captured = [];
        if (String(payload.orgNames || '').trim()) {
          var orgResult = processCapturePayload('Find organisations', { orgNames: payload.orgNames, sector: payload.sector, subsector: payload.subsector });
          if (!orgResult.ok) return orgResult;
          captured.push('organisations');
        }
        if (String(payload.jobTitle || '').trim()) {
          if (!String(payload.jobOrg || '').trim()) return failResult('Add the organisation for the opportunity.', 'jobOrg', 'MISSING_ORG');
          var jobResult = processCapturePayload('Add/update job', { jobTitle: payload.jobTitle, org: payload.jobOrg, deadline: payload.deadline, status: 'Not started', urlNotes: payload.urlNotes });
          if (!jobResult.ok) return jobResult;
          captured.push('opportunity');
        }
        result = okResult('Captured scan result: ' + (captured.length ? captured.join(' and ') : 'nothing new') + '.');
      }
      if (!result.ok) return result;
      completeTodo(todo.id, 'Done', { source: 'source-scan-popup', sourceScanHandled: true });
      resolvePopupDecision(payload.decisionId, '', noResults ? 'No source-scan results captured' : 'Captured source-scan results');
      populateToday();
      refreshHome();
      renderTodayDecisionCards();
      colorCodeManualFields();
      return result;
    } catch (err) {
      return popupExceptionResult('completeSourceScanResultFromPopup', err);
    }
  }, { label: 'completeSourceScanResultFromPopup', timeoutMs: 30000 });
}

function buildApplicationResultHtml(todoId) {
  return buildApplicationResultHtmlForJob('', todoId);
}

function buildApplicationResultHtmlForJob(jobId, todoId, decisionId) {
  var todo = todoId ? getTodoById(todoId) : null;
  var job = todo ? getJobRowById(todo.objId) : getJobRowById(jobId);
  if (todoId && (!todo || !isApplicationResponseCheckTask(todo))) return '<p>Application response task not found.</p>';
  if (!job) return '<p>Application not found.</p>';
  var data = {
    todoId: todo ? todo.id : '',
    decisionId: decisionId || '',
    jobId: job.id,
    title: job.title,
    org: job.org,
    current: normalizeJobOutcome(job.outcome) || 'Waiting',
    outcomes: DROPDOWNS.JOB_OUTCOME
  };
  var json = JSON.stringify(data).replace(/</g, '\\u003c');
  return '' +
    '<style>' +
    'body{font-family:Arial,sans-serif;padding:22px;color:#28251D;background:#FBFBF9;}' +
    'h2{margin:0 0 6px;color:#1B474D;font-size:20px;}p{color:#5F625E;font-size:13px;margin:6px 0 14px;}' +
    'label{display:block;margin-top:12px;font-size:12px;font-weight:bold;color:#1B474D;}' +
    'select{box-sizing:border-box;width:100%;margin-top:5px;padding:9px;border:1px solid #D8DAD4;border-radius:5px;font-size:13px;background:#FFF;}' +
    '.primary{margin-top:18px;padding:10px 14px;border:0;border-radius:5px;background:#01696F;color:#FFF;font-weight:bold;cursor:pointer;}' +
    '.secondary{margin-top:18px;margin-left:8px;padding:10px 14px;border:1px solid #D8DAD4;border-radius:5px;background:#FFF;color:#1B474D;font-weight:bold;cursor:pointer;}' +
    '#status{font-size:12px;color:#5F625E;margin-top:10px;}</style>' +
    '<h2>Application result</h2><p id="jobLine"></p>' +
    '<label>Result<select id="result"></select></label>' +
    '<button class="primary" type="button" onclick="save()">Save</button><button class="secondary" type="button" onclick="google.script.host.close()">Cancel</button><div id="status"></div>' +
    '<script>var data=' + json + ';document.getElementById("jobLine").textContent=data.title+" at "+data.org;' +
    'var result=document.getElementById("result");data.outcomes.forEach(function(o){var opt=document.createElement("option");opt.value=o;opt.textContent=o;result.appendChild(opt);});result.value=data.current;' +
    'function save(){var status=document.getElementById("status");status.textContent="Saving...";google.script.run.withSuccessHandler(function(res){res=res||{};if(!res.ok){status.textContent=res.message||"Could not save.";return;}status.textContent=res.message||"Saved.";setTimeout(function(){google.script.host.close();},800);}).withFailureHandler(function(){status.textContent="Could not save. Try again from Home.";}).completeApplicationResultFromPopup({todoId:data.todoId,decisionId:data.decisionId,jobId:data.jobId,outcome:result.value});}</script>';
}

function runApplicationResultPopup(todoId) {
  var html = HtmlService.createHtmlOutput(buildApplicationResultHtml(todoId)).setWidth(460).setHeight(300).setTitle('Application result');
  SpreadsheetApp.getUi().showModalDialog(html, 'Application result');
}

function runApplicationResultForJobPopup(jobId, decisionId) {
  var html = HtmlService.createHtmlOutput(buildApplicationResultHtmlForJob(jobId, '', decisionId || '')).setWidth(460).setHeight(300).setTitle('Application result');
  SpreadsheetApp.getUi().showModalDialog(html, 'Application result');
}

function completeApplicationResultFromPopup(payload) {
  return withDocumentLock(function () {
    try {
      payload = payload || {};
      var todo = payload.todoId ? getTodoById(payload.todoId) : null;
      if (payload.todoId && !isApplicationResponseCheckTask(todo)) return failResult('I could not find that response-check task.', '', 'TASK_NOT_FOUND');
      var job = todo ? getJobRowById(todo.objId) : getJobRowById(payload.jobId);
      if (!job) return failResult('I could not find that application.', '', 'JOB_NOT_FOUND');
      if (!isJobSubmittedForResponseTracking(job.id)) return failResult('Set Application status to Submitted before recording a result.', '', 'NOT_SUBMITTED');
      var outcome = normalizeJobOutcome(payload.outcome);
      if (!outcome) return failResult('Choose Waiting, Interview invite, or Rejected.', 'outcome', 'INVALID_OUTCOME');

      if (todo) completeTodo(todo.id, 'Done', { source: 'application-result-popup', responseCheckHandled: true });
      var sheet = getSheet('Jobs');
      job = getJobRowById(job.id);
      if (!job) return failResult('I could not find the job after updating the task.', '', 'JOB_NOT_FOUND');
      if (outcome === 'Waiting') {
        recordJobWaitingForResponse(job.id, { source: 'application-result-popup' });
      } else {
        sheet.getRange(job.row, COLS.JOBS.RESPONSE).setValue('Yes');
        sheet.getRange(job.row, COLS.JOBS.OUTCOME).setValue(outcome);
        routeJobOutcome(job.id, outcome, { source: 'application-result-popup' });
      }
      resolvePopupDecision(payload.decisionId, '', 'Application result recorded: ' + outcome);
      populateToday();
      refreshHome();
      renderTodayDecisionCards();
      return okResult(outcome === 'Waiting' ? 'Still waiting. Next response check scheduled.' : 'Application result recorded: ' + outcome + '.');
    } catch (err) {
      return popupExceptionResult('completeApplicationResultFromPopup', err);
    }
  }, { label: 'completeApplicationResultFromPopup', timeoutMs: 30000 });
}

function buildInterviewOutcomeHtml(roundId, decisionId) {
  var round = getRoundById(roundId);
  if (!round) return '<p>Interview round not found.</p>';
  var data = {
    roundId: round.id,
    decisionId: decisionId || '',
    job: round.job,
    org: round.org,
    round: round.round,
    current: round.officialOutcome || 'Waiting',
    outcomes: DROPDOWNS.OFFICIAL_OUTCOME
  };
  var json = JSON.stringify(data).replace(/</g, '\\u003c');
  return '' +
    '<style>' +
    'body{font-family:Arial,sans-serif;padding:22px;color:#28251D;background:#FBFBF9;}' +
    'h2{margin:0 0 6px;color:#1B474D;font-size:20px;}p{color:#5F625E;font-size:13px;margin:6px 0 14px;}' +
    'label{display:block;margin-top:12px;font-size:12px;font-weight:bold;color:#1B474D;}' +
    'select{box-sizing:border-box;width:100%;margin-top:5px;padding:9px;border:1px solid #D8DAD4;border-radius:5px;font-size:13px;background:#FFF;}' +
    '.primary{margin-top:18px;padding:10px 14px;border:0;border-radius:5px;background:#01696F;color:#FFF;font-weight:bold;cursor:pointer;}' +
    '.secondary{margin-top:18px;margin-left:8px;padding:10px 14px;border:1px solid #D8DAD4;border-radius:5px;background:#FFF;color:#1B474D;font-weight:bold;cursor:pointer;}' +
    '#status{font-size:12px;color:#5F625E;margin-top:10px;}</style>' +
    '<h2>Interview outcome</h2><p id="roundLine"></p>' +
    '<label>Official outcome<select id="outcome"></select></label>' +
    '<button class="primary" type="button" onclick="save()">Save</button><button class="secondary" type="button" onclick="google.script.host.close()">Cancel</button><div id="status"></div>' +
    '<script>var data=' + json + ';document.getElementById("roundLine").textContent="Round "+data.round+" - "+data.job+(data.org?" at "+data.org:"");' +
    'var outcome=document.getElementById("outcome");data.outcomes.forEach(function(o){var opt=document.createElement("option");opt.value=o;opt.textContent=o;outcome.appendChild(opt);});outcome.value=data.current;' +
    'function save(){var status=document.getElementById("status");status.textContent="Saving...";google.script.run.withSuccessHandler(function(res){res=res||{};if(!res.ok){status.textContent=res.message||"Could not save.";return;}status.textContent=res.message||"Saved.";setTimeout(function(){google.script.host.close();},800);}).withFailureHandler(function(){status.textContent="Could not save. Try again from Decisions.";}).completeInterviewOutcomeFromPopup({roundId:data.roundId,decisionId:data.decisionId,outcome:outcome.value});}</script>';
}

function runInterviewOutcomePopup(roundId, decisionId) {
  var html = HtmlService.createHtmlOutput(buildInterviewOutcomeHtml(roundId, decisionId || '')).setWidth(460).setHeight(300).setTitle('Interview outcome');
  SpreadsheetApp.getUi().showModalDialog(html, 'Interview outcome');
}

function completeInterviewOutcomeFromPopup(payload) {
  return withDocumentLock(function () {
    try {
      payload = payload || {};
      var round = getRoundById(payload.roundId);
      if (!round) return failResult('I could not find that interview round.', '', 'ROUND_NOT_FOUND');
      var outcome = String(payload.outcome || '');
      if (DROPDOWNS.OFFICIAL_OUTCOME.indexOf(outcome) === -1) return failResult('Pick a valid interview outcome.', 'outcome', 'INVALID_OUTCOME');
      handleInterviewOfficialOutcome(round.id, outcome, { source: 'interview-outcome-popup', skipDecisionDismiss: true });
      resolvePopupDecision(payload.decisionId, '', 'Interview outcome recorded: ' + outcome);
      populateToday();
      refreshHome();
      renderTodayDecisionCards();
      return okResult('Interview outcome recorded: ' + outcome + '.');
    } catch (err) {
      return popupExceptionResult('completeInterviewOutcomeFromPopup', err);
    }
  }, { label: 'completeInterviewOutcomeFromPopup', timeoutMs: 30000 });
}

function buildOfferDecisionHtml(jobId, decisionId) {
  var job = getJobRowById(jobId);
  if (!job) return '<p>Job not found.</p>';
  var data = {
    jobId: job.id,
    decisionId: decisionId || '',
    title: job.title,
    org: job.org,
    outcomes: ['Accepted', 'Declined', 'Parked', 'Still deciding']
  };
  var json = JSON.stringify(data).replace(/</g, '\\u003c');
  return '' +
    '<style>' +
    'body{font-family:Arial,sans-serif;padding:22px;color:#28251D;background:#FBFBF9;}' +
    'h2{margin:0 0 6px;color:#1B474D;font-size:20px;}p{color:#5F625E;font-size:13px;margin:6px 0 14px;}' +
    'label{display:block;margin-top:12px;font-size:12px;font-weight:bold;color:#1B474D;}' +
    'select{box-sizing:border-box;width:100%;margin-top:5px;padding:9px;border:1px solid #D8DAD4;border-radius:5px;font-size:13px;background:#FFF;}' +
    '.primary{margin-top:18px;padding:10px 14px;border:0;border-radius:5px;background:#01696F;color:#FFF;font-weight:bold;cursor:pointer;}' +
    '.secondary{margin-top:18px;margin-left:8px;padding:10px 14px;border:1px solid #D8DAD4;border-radius:5px;background:#FFF;color:#1B474D;font-weight:bold;cursor:pointer;}' +
    '#status{font-size:12px;color:#5F625E;margin-top:10px;}</style>' +
    '<h2>Offer decision</h2><p id="jobLine"></p>' +
    '<label>Decision<select id="outcome"></select></label>' +
    '<button class="primary" type="button" onclick="save()">Save</button><button class="secondary" type="button" onclick="google.script.host.close()">Cancel</button><div id="status"></div>' +
    '<script>var data=' + json + ';document.getElementById("jobLine").textContent=data.title+" at "+data.org;' +
    'var outcome=document.getElementById("outcome");data.outcomes.forEach(function(o){var opt=document.createElement("option");opt.value=o;opt.textContent=o;outcome.appendChild(opt);});' +
    'function save(){var status=document.getElementById("status");status.textContent="Saving...";google.script.run.withSuccessHandler(function(res){res=res||{};if(!res.ok){status.textContent=res.message||"Could not save.";return;}status.textContent=res.message||"Saved.";setTimeout(function(){google.script.host.close();},800);}).withFailureHandler(function(){status.textContent="Could not save. Try again from Decisions.";}).completeOfferDecisionFromPopup({jobId:data.jobId,decisionId:data.decisionId,outcome:outcome.value});}</script>';
}

function runOfferDecisionPopup(jobId, decisionId) {
  var html = HtmlService.createHtmlOutput(buildOfferDecisionHtml(jobId, decisionId || '')).setWidth(460).setHeight(300).setTitle('Offer decision');
  SpreadsheetApp.getUi().showModalDialog(html, 'Offer decision');
}

function completeOfferDecisionFromPopup(payload) {
  return withDocumentLock(function () {
    try {
      payload = payload || {};
      var job = getJobRowById(payload.jobId);
      if (!job) return failResult('I could not find that job.', '', 'JOB_NOT_FOUND');
      var outcome = String(payload.outcome || '');
      if (['Accepted', 'Declined', 'Parked', 'Still deciding'].indexOf(outcome) === -1) return failResult('Pick a valid offer decision.', 'outcome', 'INVALID_OUTCOME');
      var sheet = getSheet('Jobs');
      appendNoteFlag(sheet, job.row, COLS.JOBS.NOTES, '[offer-decision] ' + outcome + ' on ' + formatDateHuman(today()));
      if (outcome === 'Still deciding') {
        appendTodoOnceForWorkflow('Decide on offer: ' + job.title + ' at ' + job.org, 'Job', job.id, job.org,
          'Offer decision', 'Not started', addDays(today(), 2), '30 min', 'Offer still under review.', 'Auto-triggered');
      } else {
        setJobStatus(job.id, 'Closed', { source: 'offer-decision-popup' });
        setOpenTodosForTarget('Job', job.id, 'Cancelled', 'Offer decision recorded', ['Offer decision']);
      }
      resolvePopupDecision(payload.decisionId, '', 'Offer decision recorded: ' + outcome);
      populateToday();
      refreshHome();
      renderTodayDecisionCards();
      return okResult('Offer decision recorded: ' + outcome + '.');
    } catch (err) {
      return popupExceptionResult('completeOfferDecisionFromPopup', err);
    }
  }, { label: 'completeOfferDecisionFromPopup', timeoutMs: 30000 });
}

function buildSubmitApplicationHtml(todoId) {
  var todo = getTodoById(todoId);
  var job = todo ? getJobRowById(todo.objId) : null;
  if (!todo || !job) return '<p>Application task not found.</p>';
  var data = {
    todoId: todo.id,
    title: job.title,
    org: job.org,
    submittedDate: formatDateHuman(today())
  };
  var json = JSON.stringify(data).replace(/</g, '\\u003c');
  return '' +
    '<style>' +
    'body{font-family:Arial,sans-serif;padding:22px;color:#28251D;background:#FBFBF9;}' +
    'h2{margin:0 0 6px;color:#1B474D;font-size:20px;}p{color:#5F625E;font-size:13px;margin:6px 0 14px;}' +
    'label{display:block;margin-top:12px;font-size:12px;font-weight:bold;color:#1B474D;}' +
    'input{box-sizing:border-box;width:100%;margin-top:5px;padding:9px;border:1px solid #D8DAD4;border-radius:5px;font-size:13px;background:#FFF;}' +
    '.primary{margin-top:18px;padding:10px 14px;border:0;border-radius:5px;background:#01696F;color:#FFF;font-weight:bold;cursor:pointer;}' +
    '.secondary{margin-top:18px;margin-left:8px;padding:10px 14px;border:1px solid #D8DAD4;border-radius:5px;background:#FFF;color:#1B474D;font-weight:bold;cursor:pointer;}' +
    '#status{font-size:12px;color:#5F625E;margin-top:10px;}</style>' +
    '<h2>Application submitted</h2><p id="jobLine"></p>' +
    '<label>Submitted date<input id="submittedDate" type="date"></label>' +
    '<button class="primary" type="button" onclick="save()">Save</button><button class="secondary" type="button" onclick="google.script.host.close()">Cancel</button><div id="status"></div>' +
    '<script>var data=' + json + ';document.getElementById("jobLine").textContent=data.title+" at "+data.org;document.getElementById("submittedDate").value=data.submittedDate;' +
    'function save(){var date=document.getElementById("submittedDate").value,status=document.getElementById("status");if(!date){status.textContent="Submitted date is required.";return;}status.textContent="Saving...";google.script.run.withSuccessHandler(function(res){res=res||{};if(!res.ok){status.textContent=res.message||"Could not save.";return;}status.textContent=res.message||"Saved.";setTimeout(function(){google.script.host.close();},700);}).withFailureHandler(function(){status.textContent="Could not save. Try again from Tasks or Home.";}).completeSubmitApplicationFromPopup({todoId:data.todoId,submittedDate:date});}</script>';
}

function runSubmitApplicationPopup(todoId) {
  var html = HtmlService.createHtmlOutput(buildSubmitApplicationHtml(todoId)).setWidth(460).setHeight(300).setTitle('Application submitted');
  SpreadsheetApp.getUi().showModalDialog(html, 'Application submitted');
}

function completeSubmitApplicationFromPopup(payload) {
  return withDocumentLock(function () {
    try {
      payload = payload || {};
      var todo = getTodoById(payload.todoId);
      if (!todo) return failResult('I could not find that submit task.', '', 'TASK_NOT_FOUND');
      if (todo.workflow !== 'Submit application' || todo.objType !== 'Job') return failResult('That task is not an application submit task.', '', 'NOT_SUBMIT_TASK');
      var submittedDate = parseDateOr(payload.submittedDate);
      completeTodo(todo.id, 'Done', { source: 'submit-popup', realDate: submittedDate });
      populateToday();
      refreshHome();
      renderTodayDecisionCards();
      return okResult('Application marked submitted for ' + formatDateHuman(submittedDate) + '.');
    } catch (err) {
      return popupExceptionResult('completeSubmitApplicationFromPopup', err);
    }
  }, { label: 'completeSubmitApplicationFromPopup', timeoutMs: 30000 });
}

function completeCaptureFromPopup(payload) {
  return withDocumentLock(function () {
    try {
      payload = payload || {};
      var result = coerceResult(processCapturePayload(payload.captureType, payload.fields || {}), 'Saved and refreshed Today.');
      if (!result.ok) return result;
      resolvePopupDecision(payload.decisionId, '', 'Captured via ' + payload.captureType);
      populateToday();
      refreshHome();
      renderTodayDecisionCards();
      colorCodeManualFields();
      SpreadsheetApp.getActiveSpreadsheet().toast('Planner updated - Tasks and Today refreshed.', 'The Planner', 4);
      return result;
    } catch (err) {
      return popupExceptionResult('completeCaptureFromPopup', err);
    }
  }, { label: 'completeCaptureFromPopup', timeoutMs: 30000 });
}
function processCapturePayload(captureType, fields) {
  fields = fields || {};
  if (captureType === 'Explore sectors') return processSectorOnboarding(fields, 'home_update');
  if (captureType === 'Find organisations') {
    var namesNew = splitInputList(fields.orgNames);
    if (!namesNew.length) return failResult('I need at least one organisation name.', 'orgNames', 'MISSING_ORG');
    if (fields.subsector && !fields.sector) return failResult('Add Sector before Sub-sector so I know where to link it.', 'sector', 'MISSING_SECTOR');
    var createdFound = 0, reusedFound = 0;
    namesNew.forEach(function (name) {
      var hasTaxonomyInput = !!(fields.sector || fields.subsector);
      var org = createNameOnlyOrg(name, { status: 'Mapped', tier: 'B', deferClassification: hasTaxonomyInput });
      if (org && org.existing) reusedFound++; else if (org) createdFound++;
      if (org && (fields.sector || fields.subsector)) applyOrgTaxonomyLink(org.row, fields.sector || '', fields.subsector || '');
      else if (org) ensureOrgClassificationState(org.row);
    });
    return okResult('Captured ' + namesNew.length + ' organisation(s) found from exploration: ' + createdFound + ' new, ' + reusedFound + ' existing.');
  }
  if (captureType === 'Add/update organisation') return processOrgOnboarding(fields);
  if (captureType === 'Application update' && !fields.status) return failResult('Pick the current application status.', 'status', 'MISSING_STATUS');
  if (captureType === 'Add/update job' || captureType === 'Application update') return processJobCapture(fields);
  if (captureType === 'Add/update person') return processPeopleOnboarding(fields);
  if (captureType === 'Add/update conversation') return processConversationCapture(fields);
  if (captureType === 'Add/update interview') return processInterviewOnboarding(fields);
  if (captureType === 'Task completed / blocked') {
    if (!fields.taskNotes) return failResult('Tell me what changed or what is blocked.', 'taskNotes', 'MISSING_TASK_NOTES');
    appendTodo('Resolve blocker / next action', 'None', '', '', 'Admin', 'Not started', '', '15 min', fields.taskNotes || '');
    return okResult('Captured the blocker as a task.');
  }
  return failResult('Nothing captured.', '', 'NO_CAPTURE_TYPE');
}
function processConversationCapture(fields) {
  fields = fields || {};
  if (!fields.person) return failResult("I need the person's name.", 'person', 'MISSING_PERSON');
  var requestedStatus = fields.status || 'Completed';
  if (requestedStatus === 'Scheduled' && !fields.date) return failResult('Add a date before scheduling a conversation.', 'date', 'MISSING_CONVERSATION_DATE');
  if (fields.outcome && requestedStatus !== 'Completed') return failResult('Set Interaction status to Completed before choosing an outcome.', 'status', 'OUTCOME_REQUIRES_COMPLETED');
  var org = fields.org ? createNameOnlyOrg(fields.org, { status: 'Mapped', stub: true }) : null;
  var selection = fields.org ? fields.person + ' (' + (org ? org.name : fields.org) + ')' : fields.person;
  var resolved = resolveInteractionPersonSelection(selection);
  if (resolved.ambiguous) return failResult('More than one matching person. Add the organisation or choose the exact person from Conversations.', 'person', 'AMBIGUOUS_PERSON');
  var person = resolved.person;
  var createdPerson = false;
  if (!person) {
    var blankOrgMatch = org ? findSingleBlankOrgPersonByExactName(fields.person) : { person: null, ambiguous: false };
    if (blankOrgMatch.ambiguous) return failResult('More than one no-organisation person has that name. Choose the exact person from Conversations first.', 'person', 'AMBIGUOUS_PERSON');
    if (blankOrgMatch.person) {
      person = attachOrgToPersonRow(blankOrgMatch.person, org);
    } else {
      var newPersonId = writePersonRow(fields.person, org, '');
      person = getPersonRowById(newPersonId);
      createdPerson = true;
    }
  }
  if (!person) return failResult('I could not resolve that person.', 'person', 'PERSON_NOT_FOUND');
  var personId = person.data[COLS.PEOPLE.ID - 1];
  var personName = person.data[COLS.PEOPLE.NAME - 1];
  var personOrg = person.data[COLS.PEOPLE.ORG - 1] || (org ? org.name : fields.org || '');
  var status = requestedStatus;
  if (status !== 'Cancelled') promoteOrgForLivePerson(org ? org.id : person.data[COLS.PEOPLE.ORG_ID - 1], status === 'Scheduled' ? 'Conversation scheduled' : 'Conversation completed');
  appendInteraction(personId, personName, personOrg, fields.date || '', 'Other', fields.notes || '', '', status);
  var interactionSheet = getSheet('Conversations');
  var interactionRow = interactionSheet.getLastRow();
  routeInteractionStatusForPerson(interactionSheet, interactionRow, status);
  if (fields.outcome) {
    interactionSheet.getRange(interactionRow, COLS.INTERACTIONS.OUTCOME).setValue(fields.outcome);
    onEditInteractions(interactionSheet, interactionRow, COLS.INTERACTIONS.OUTCOME, fields.outcome);
  }
  syncPeopleHelperColumns();
  return okResult('Captured the conversation update for ' + personName + (createdPerson ? ' and created the person row.' : '.'));
}

function processJobCapture(fields) {
  if (!fields.jobTitle) return failResult('I need at least a job title.', 'jobTitle', 'MISSING_JOB_TITLE');
  if (!fields.org) return failResult('I need the organisation name before I can route this job/application.', 'org', 'MISSING_ORG');
  var status = normalizeJobStatus(fields.status || 'Not started');
  if (!status) return failResult('Pick a valid application status.', 'status', 'INVALID_STATUS');
  var org = createNameOnlyOrg(fields.org || '', { status: 'Mapped', stub: true });
  var existingJob = findJobByTitleOrg(fields.jobTitle, org ? org.name : '');
  var exactExistingJob = isExactJobTitleOrgMatch(existingJob, fields.jobTitle, org ? org.name : '');
  var previousStatus = exactExistingJob ? normalizeJobStatus(existingJob.data[COLS.JOBS.STATUS - 1]) : '';
  var jobId = writeJobRow(fields.jobTitle, org, status);
  promoteOrgForLiveJob(org && org.id, status);
  var job = getJobRowById(jobId);
  var sheet = getSheet('Jobs');
  if (fields.deadline) {
    sheet.getRange(job.row, COLS.JOBS.DEADLINE).setValue(fields.deadline);
    syncOpenJobDeadlineTaskDates(jobId, fields.deadline);
  }
  if (fields.urlNotes) appendNoteFlag(sheet, job.row, COLS.JOBS.NOTES, fields.urlNotes);
  var opts = { realDate: fields.appliedDate || '' };
  fireJobStatusChanged(jobId, previousStatus, status, opts);
  job = getJobRowById(jobId);
  if (fields.appliedDate && status === 'Submitted') {
    updateJobSubmittedDates(jobId, fields.appliedDate);
  }
  if (fields.response) sheet.getRange(job.row, COLS.JOBS.RESPONSE).setValue(fields.response);
  if (fields.outcome) {
    var normalizedOutcome = normalizeJobOutcome(fields.outcome);
    if (!normalizedOutcome) return failResult('Pick a valid job outcome.', 'outcome', 'INVALID_OUTCOME');
    if (!isJobSubmittedForResponseTracking(jobId)) {
      return failResult('Set Application status to Submitted before recording an application result.', 'status', 'RESULT_BEFORE_SUBMIT');
    }
    sheet.getRange(job.row, COLS.JOBS.OUTCOME).setValue(normalizedOutcome);
    if (normalizedOutcome === 'Waiting') recordJobWaitingForResponse(jobId, { source: 'capture-outcome' });
    else {
      sheet.getRange(job.row, COLS.JOBS.RESPONSE).setValue('Yes');
      routeJobOutcome(jobId, normalizedOutcome, { source: 'capture-outcome', realDate: fields.appliedDate || '' });
    }
  }
  if (fields.response === 'No' && !fields.outcome) {
    if (!isJobSubmittedForResponseTracking(jobId)) return failResult('Set Application status to Submitted before recording a response.', 'status', 'RESPONSE_BEFORE_SUBMIT');
    recordJobWaitingForResponse(jobId, { source: 'capture-response' });
  }
  if (fields.response === 'Yes' && !fields.outcome) {
    if (!isJobSubmittedForResponseTracking(jobId)) return failResult('Set Application status to Submitted before recording a response.', 'status', 'RESPONSE_BEFORE_SUBMIT');
    createJobResponseOutcomeDecision(jobId, 'Job update captured: ' + fields.jobTitle);
  }
  return okResult((exactExistingJob ? 'Updated existing' : 'Created') + ' job/application: ' + fields.jobTitle + ' at ' + (org ? org.name : fields.org) + '.');
}
// =============================================================
// VISUAL POLISH — rich-text guidance headers, manual/auto shading,
// status colour coding, hidden backend columns, tab zones
// =============================================================

var HEADER_GUIDANCE = {
  'Sectors': {
    'Sector ID': 'Filled automatically. Links broad sector rows.',
    'Sector': 'Broad search area. Use the same Sector for each narrower sub-sector row.',
    'Sub-sector ID': 'Filled automatically. Stays with this sub-sector if renamed or moved.',
    'Sub-sector': 'Narrower area under Sector. Leave blank on the broad-sector row.',
    'Status': 'Open = in your search universe. Retired = no new daily suggestions.',
    'Notes': 'Your context plus repair flags.'
  },
  'Organisations': {
    'Org ID': 'Filled automatically.', 'Organisation': 'Target organisation name. Prefer Home > Capture update for normal entry.',
    'Sector ID': 'Filled automatically from Sector.', 'Sector': 'Choose the broad sector, or leave blank if it still needs classification.',
    'Sub-sector ID': 'Filled automatically from Sub-sector.', 'Sub-sector': 'Optional narrower area; choose after Sector.',
    'Tier': 'A/B/C priority for tie-breaks; defaults to B.', 'Status': 'Mapped = known; Active = suggest next moves; Dormant = pause org-level suggestions; Archived = retired.',
    'Known people (count)': 'Updates from linked People rows.', 'Open opportunities (count)': 'Updates from linked open Jobs.', 'Last checked': 'Last org-level review date.', 'Next check date': 'Next planned org review date.', 'Notes': 'Your context plus repair flags.'
  },
  'People': {
    'Person ID': 'Filled automatically.', 'Name': 'Contact name. Prefer Home > Capture update when adding people.', 'Organisation': 'Link when relevant; blank is okay for broad network leads.', 'Org ID': 'Filled automatically from Organisation.',
    'Role': 'Optional role or relationship context.', 'Relationship source': 'How you found or know them; this does not create outreach by itself.',
    'Relationship status': 'Identified, outreach, reply, conversation, keep-warm, or closed.',
    'Next follow-up date': 'Next relationship follow-up; tasks handle the actual work.',
    'Reply received': 'Yes when they replied.', 'Follow-up sent?': 'Filled automatically.', 'Outreach date': 'Date outreach was sent.', 'Conversation date': 'Scheduled or completed conversation date.',
    'Context / notes': 'Relationship context, angle, and repair flags.', 'Follow-ups sent count': 'Filled automatically.',
    'Last interaction': 'Updates from completed Conversations.', 'Next action': 'Updates from open Tasks.', 'Linked jobs': 'Updates from Jobs where this person is linked.'
  },
  'Jobs': {
    'Job ID': 'Filled automatically.', 'Opportunity': 'Job or opportunity title.', 'Organisation': 'Organisation for this opportunity; used to link work.', 'Org ID': 'Filled automatically from Organisation.',
    'Deadline': 'Application deadline. It affects priority but does not create tasks by itself.', 'Application status': 'Not started / In progress / Submitted / Closed.', 'Submitted date': 'Date you submitted the application.',
    'Linked contacts (IDs)': 'Filled automatically from linked People.', 'People for this application': 'Contacts linked through referral/application actions.', 'Next response check': 'Next date to check for an application response.',
    'Response received': 'Set Yes to record a result; Waiting keeps this as No.',
    'Application result': 'Waiting / Interview invite / Rejected. Use after the application is Submitted.',
    'Notes': 'URL, source, application context, and repair flags.'
  },
  'Interactions': {
    'Interaction ID': 'Filled automatically.', 'Date': 'Interaction or scheduled conversation date.', 'Person ID': 'Filled automatically from Person.', 'Person': 'Pick or type the person; Home > Capture update is preferred.', 'Organisation': 'Filled from the linked Person when known.',
    'Type': 'Call, email, message, referral, interview, or other.', 'Interaction status': 'Scheduled / Completed / Cancelled.', 'Key notes': 'What changed or what to remember.', 'Outcome': 'May route follow-up work or decisions.'
  },
  'To-do': {
    'Task ID': 'system', 'Task': 'Master task queue — inspect, repair, audit', 'Linked object type': 'system', 'Linked object ID': 'system', 'Org': 'system', 'Workflow type': 'system',
    'Status': 'Done routes through the completion engine', 'Due date': 'auto or manual', 'Time estimate': 'planning size', 'Notes': 'why/context',
    'Parent To-do ID': 'system', 'Created': 'system', 'Completed': 'system', 'Commitment class': 'Fixed/Blocking/Keep-alive/Active pursuit/Pipeline-building/Backlog', 'Source': 'auto/manual/onboarding/decision',
    'Last edited': 'system', 'Class calculated at': 'system', 'Effort type': 'auto',
    'Plan category': 'group or theme for multi-step work', 'Plan pattern': 'Parallel or Step-based', 'Step': 'order within a Step-based plan',
    'Parent task': 'jumps to the container task', 'Ready for Today': 'Ready / Waiting / Blocked / Parent / Needs planning / Done',
    'Child progress': 'automatic progress for container tasks', 'Blocker': 'what must clear before this can move', 'Blocked by To-do ID': 'system link to unblocker task',
    'Priority rank': '1=Fixed … 6=Backlog, sort ascending', 'Linked to': 'jumps to the source row', 'On Today right now': 'auto', 'Has sub-tasks': 'auto'
  },
  'Interview rounds': {
    'Round ID': 'Filled automatically.', 'Linked Job ID': 'Filled automatically.', 'Job (display)': 'Filled from linked Job.', 'Org (display)': 'Filled from linked Job.', 'Round': 'Round number.', 'Round type': 'Recruiter, case, panel, hiring manager, or other.',
    'Interview date': 'Scheduled date; creates or updates prep timing.', 'Status': 'To schedule / Scheduled / Completed / Reschedule / Cancelled.',
    'Domain readiness': 'Optional context; prep depth is planned from Tasks.',
    'Official outcome': 'Waiting / Next round / Declined / Offer / Parked; resolves pending outcome prompts',
    'Expected response / follow-up date': 'Creates or updates interview follow-up timing.', 'Notes': 'Prep context, debrief, interviewers, and repair flags.'
  },
  "Today's plan": {
    'Slot': 'Commit or option.', 'Task': 'Selected from Tasks.', 'Linked Task ID': 'Filled automatically.', 'Estimated min': 'Planned time.', 'Plan': 'Commit or Option.',
    'Effort': 'Light/medium/deep.', 'Status': 'Planned / In progress / Blocked / Done / Deferred / Skipped.', 'Actual min': 'Optional actual time.', 'Why / notes': 'Reason tags plus your notes; hover for the full Why.'
  },
  'Pending decisions': {
    'Decision ID': 'Filled automatically.', 'Created': 'Filled automatically.', 'Decision key': 'Filled automatically.', 'Trigger': 'Why this decision exists.', 'Suggested action': 'What you are deciding.',
    'Target type': 'Linked object type.', 'Target ID': 'Filled automatically.', 'Suggested workflow': 'Suggested next-step type.', 'Notes': 'Context.',
    'Decision': 'Choose Yes or No; Auto-dismissed means the situation changed.', 'Decided at': 'Filled automatically.', 'Resulting To-do ID': 'Filled when Yes creates a task.',
    'Decision action type': 'What Yes will do: create task, open popup, capture data, update source, or dismiss',
    'Review by': 'When this should be reviewed; urgent decisions sort first.', 'Linked to': 'Link to the source row.', 'Result': 'What happened after deciding.'
  }
};

function userFacingHeaderHint(canonicalName, name, hint) {
  var h = String(hint || '');
  var exact = {
    'system': 'Filled automatically',
    'system link to unblocker task': 'Filled automatically when an unblocker exists',
    'formula': 'Updates automatically',
    'auto': 'Filled automatically',
    'auto from person': 'Filled from Person when known',
    'backend date for response checks': 'Used for response checks',
    'cascade type': 'Suggested next-step type'
  };
  if (exact[h]) h = exact[h];
  h = h.replace(/\bbackend\b/g, 'Planner')
    .replace(/\bcascade type\b/g, 'suggested next-step type')
    .replace(/\bcascades?\b/g, 'follow-up routing')
    .replace(/\bformula\b/g, 'updates automatically');

  if (canonicalName === 'Tasks') {
    if (name === 'Task') return 'Work queue. Use Today for daily execution; use Tasks for repair/planning';
    if (name === 'Workflow type') return 'Planner route for this work';
    if (name === 'Status') return 'Done/Skipped/Cancelled route through completion';
    if (name === 'Due date') return 'Planner may set this; edit if the date is wrong';
    if (name === 'Time estimate') return 'Planning size for Today';
    if (name === 'Notes') return 'Why, context, and repair flags';
    if (name === 'Commitment class') return 'How Today prioritises this work';
    if (name === 'Plan category') return 'Theme for multi-step work';
    if (name === 'Plan pattern') return 'Parallel or Step-based';
    if (name === 'Step') return 'Order within a Step-based plan';
    if (name === 'Parent task') return 'Link to the container task';
    if (name === 'Ready for Today') return 'Ready work can appear on Today; blocked/waiting/planning work cannot';
    if (name === 'Child progress') return 'Progress for container tasks';
    if (name === 'Blocker') return 'What must clear before this can move';
    if (name === 'Priority rank') return 'Lower number appears earlier';
    if (name === 'Linked to') return 'Link to the source row';
    if (name === 'On Today right now') return 'Updates from Today';
    if (name === 'Has sub-tasks') return 'Updates from child tasks';
    if (name === 'Source') return 'Where the task came from';
  }
  if (canonicalName === 'Decisions') {
    if (name === 'Decision') return 'Choose Yes or No; Auto-dismissed means the situation changed';
    if (name === 'Decided at') return 'Filled when decided';
    if (name === 'Resulting To-do ID') return 'Filled when Yes creates a task';
    if (name === 'Decision action type') return 'What Yes will do';
    if (name === 'Review by') return 'When this should be reviewed; urgent decisions sort first';
    if (name === 'Result') return 'What happened after deciding';
  }
  if (canonicalName === 'Interviews') {
    if (name === 'Status') return 'To schedule / Scheduled / Completed / Reschedule / Cancelled';
    if (name === 'Domain readiness') return 'Optional context; prep depth is planned from Tasks';
    if (name === 'Official outcome') return 'Waiting / Next round / Declined / Offer / Parked';
    if (name === 'Expected response / follow-up date') return 'Creates or updates interview follow-up timing';
    if (name === 'Notes') return 'Prep context, debrief, interviewers, and repair flags';
  }
  if (canonicalName === 'Conversations' && name === 'Outcome') return 'May route follow-up work or decisions';
  if (canonicalName === 'Organisations' && (name === 'Known people (count)' || name === 'Open opportunities (count)')) return 'Updates as linked rows are added';
  return h;
}

function applyRichTextHeaders(canonicalName) {
  var headerKey = SHEET_TO_HEADER_KEY[canonicalName];
  var sheet = getSheet(canonicalName);
  var headers = HEADERS[headerKey];
  var guidance = HEADER_GUIDANCE[headerKey];
  if (!sheet || !headers || !guidance) return;
  var headerRow = (canonicalName === 'Today') ? TODAY_TABLE_HEADER_ROW : 1;
  for (var c = 0; c < headers.length; c++) {
    var name = headers[c];
    var hint = userFacingHeaderHint(canonicalName, name, guidance[name] || '');
    var cell = sheet.getRange(headerRow, c + 1);
    cell.clearNote();
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
  'Interactions': [COLS.INTERACTIONS.DATE, COLS.INTERACTIONS.PERSON, COLS.INTERACTIONS.TYPE, COLS.INTERACTIONS.STATUS, COLS.INTERACTIONS.NOTES, COLS.INTERACTIONS.OUTCOME],
  'To-do': [COLS.TODO.STATUS, COLS.TODO.DUE_DATE, COLS.TODO.TIME_EST, COLS.TODO.NOTES, COLS.TODO.PLAN_CATEGORY, COLS.TODO.PLAN_PATTERN, COLS.TODO.STEP, COLS.TODO.BLOCKER],
  'Interview rounds': [COLS.ROUNDS.ROUND, COLS.ROUNDS.ROUND_TYPE, COLS.ROUNDS.INTERVIEW_DATE, COLS.ROUNDS.STATUS, COLS.ROUNDS.DOMAIN_READINESS, COLS.ROUNDS.OFFICIAL_OUTCOME, COLS.ROUNDS.EXPECTED_RESPONSE, COLS.ROUNDS.NOTES],
  'Pending decisions': [COLS.DECISIONS.DECISION, COLS.DECISIONS.NOTES]
};

var COLUMN_WIDTHS = {
  'Sectors': { 2: 190, 4: 260, 5: 100, 6: 300 },
  'Organisations': { 2: 220, 4: 170, 6: 220, 7: 70, 8: 120, 9: 135, 10: 165, 13: 300 },
  'People': { 2: 190, 3: 200, 5: 170, 6: 175, 7: 185, 8: 125, 9: 120, 11: 125, 12: 135, 13: 300, 15: 125, 16: 260, 17: 260 },
  'Jobs': { 2: 260, 3: 200, 5: 120, 6: 145, 9: 220, 11: 130, 12: 170, 13: 320 },
  'Interactions': { 2: 120, 4: 190, 5: 200, 6: 150, 7: 135, 8: 320, 9: 160 },
  'To-do': { 2: 340, 7: 125, 8: 120, 9: 115, 10: 320, 14: 130, 19: 70, 20: 200, 21: 100, 22: 100, 23: 150, 24: 120, 25: 70, 26: 220, 27: 125, 28: 150, 29: 240 },
  'Interview rounds': { 3: 220, 4: 190, 5: 80, 6: 140, 7: 125, 8: 125, 9: 150, 10: 145, 11: 145, 12: 300 },
  "Today's plan": { 1: 80, 2: 340, 4: 110, 5: 100, 6: 100, 7: 120, 8: 100, 9: 340 },
  'Pending decisions': { 4: 250, 5: 320, 6: 130, 8: 160, 9: 300, 10: 130, 13: 130, 14: 125, 15: 200, 16: 220 }
};

var WRAP_COLUMNS = {
  'Sectors': [COLS.SECTORS.SUBSECTOR, COLS.SECTORS.NOTES], 'Organisations': [COLS.ORGS.NOTES], 'People': [COLS.PEOPLE.NOTES, COLS.PEOPLE.NEXT_ACTION, COLS.PEOPLE.LINKED_JOBS],
  'Jobs': [COLS.JOBS.OPPORTUNITY, COLS.JOBS.OUTCOME, COLS.JOBS.NOTES], 'Interactions': [COLS.INTERACTIONS.NOTES],
  'To-do': [COLS.TODO.TASK, COLS.TODO.NOTES, COLS.TODO.PARENT_TASK, COLS.TODO.CHILD_PROGRESS, COLS.TODO.BLOCKER], 'Interview rounds': [COLS.ROUNDS.NOTES],
  "Today's plan": [COLS.TODAY.TASK, COLS.TODAY.NOTES], 'Pending decisions': [COLS.DECISIONS.TASK, COLS.DECISIONS.NOTES, COLS.DECISIONS.LINKED_TO, COLS.DECISIONS.RESULT]
};

// v7.7.5: three same-column colors previously collided outright (To-do
// Skipped/Cancelled, Today's plan Deferred/Skipped, Pending decisions
// No/Auto-dismissed all shared #F1F3F4), and Organisations Mapped/Archived
// were close enough to be indistinguishable at a glance. Introduced a
// small, consistent neutral system instead of one-off fixes: #F1F3F4
// (cool grey) stays "skipped/declined this instance"; #EAE3DD (new, warm
// taupe) means "permanently set aside" (cancelled/archived/auto-dismissed);
// #D2E3FC (already used elsewhere for Keep-alive) means "paused, will
// resume" (deferred). No dropdown/status text values changed — colors only.
var STATUS_COLOR_MAP = {
  'Sectors': { col: COLS.SECTORS.STATUS, colors: { 'Open': '#FFFFFF', 'Retired': '#F1F3F4' } },
  'Organisations': { col: COLS.ORGS.STATUS, colors: { 'Mapped': '#E8EAED', 'Active': '#CEEAD6', 'Dormant': '#FEF7CD', 'Archived': '#EAE3DD' } },
  'People': { col: COLS.PEOPLE.STAGE, colors: { 'Identified': '#E8EAED', 'To outreach': '#FEF7CD', 'Outreach drafted': '#FEF7CD', 'Outreach sent': '#C2DBFF', 'Replied': '#B6E3E0', 'Conversation scheduled': '#D2E3FC', 'Conversation completed': '#CEEAD6', 'Keep warm': '#FEF7CD', 'Closed': '#EAE3DD' } },
  'Jobs': { col: COLS.JOBS.STATUS, colors: { 'Not started': '#FFFFFF', 'In progress': '#FEF7CD', 'Submitted': '#B6E3E0', 'Closed': '#F1F3F4' } },
  'To-do': { col: COLS.TODO.STATUS, colors: { 'Not started': '#FFFFFF', 'In progress': '#FEF7CD', 'Blocked': '#FDE9D9', 'Done': '#CEEAD6', 'Skipped': '#F1F3F4', 'Cancelled': '#EAE3DD' } },
  "Today's plan": { col: COLS.TODAY.STATUS, colors: { 'Planned': '#FFFFFF', 'In progress': '#FEF7CD', 'Blocked': '#FDE9D9', 'Done': '#CEEAD6', 'Deferred': '#D2E3FC', 'Skipped': '#F1F3F4' } },
  'Pending decisions': { col: COLS.DECISIONS.DECISION, colors: { 'Pending': '#FEF7CD', 'Yes': '#CEEAD6', 'No': '#F1F3F4', 'Auto-dismissed': '#EAE3DD' } }
};

var COMMITMENT_CLASS_COLORS = { 'Fixed': '#F6C7C3', 'Blocking': '#FDE9D9', 'Keep-alive': '#D2E3FC', 'Active pursuit': '#CEEAD6', 'Pipeline-building': '#E6F4EA', 'Backlog': '#F1F3F4' };
var READY_FOR_TODAY_COLORS = { 'Ready': '#CEEAD6', 'Waiting': '#D2E3FC', 'Blocked': '#FDE9D9', 'Parent': '#EAF4F5', 'Needs planning': '#FEF7CD', 'Done': '#F1F3F4' };

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
      .whenFormulaSatisfied('=AND($' + notesCol + '2<>"",REGEXMATCH($' + notesCol + '2,"\\[(flags|review|no-estimate|no-link|orphaned-link|orphaned-sector|orphaned-org|no-date|needs planning|needs breakdown|parent-still-open|parent-ready|blocked)\\]"),NOT(' + terminalFormula + '))')
      .setBackground('#FDE9D9')
      .setRanges([fullRowRange]).build());

    var readyRange = todoSheet.getRange(2, COLS.TODO.READY_FOR_TODAY, Math.max(todoSheet.getMaxRows() - 1, 1), 1);
    ccRules = ccRules.filter(function (r) {
      return !r.getRanges().some(function (rg) { return rg.getColumn() === COLS.TODO.READY_FOR_TODAY && rg.getRow() === 2; });
    });
    Object.keys(READY_FOR_TODAY_COLORS).forEach(function (val) {
      ccRules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(val).setBackground(READY_FOR_TODAY_COLORS[val]).setRanges([readyRange]).build());
    });
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
  if (canonicalName === 'Organisations') return [COLS.ORGS.ID, COLS.ORGS.SECTOR_ID, COLS.ORGS.SUBSECTOR_ID, COLS.ORGS.LAST_CHECKED, COLS.ORGS.NEXT_CHECK];
  if (canonicalName === 'Jobs') return [COLS.JOBS.ID, COLS.JOBS.ORG_ID, COLS.JOBS.APPLIED_DATE, COLS.JOBS.CONTACTS_IDS, COLS.JOBS.REVIEW_DATE];
  if (canonicalName === 'People') return [COLS.PEOPLE.ID, COLS.PEOPLE.ORG_ID, COLS.PEOPLE.FOLLOW_UP_SENT, COLS.PEOPLE.FOLLOW_UPS_SENT_COUNT];
  if (canonicalName === 'Conversations') return [COLS.INTERACTIONS.ID, COLS.INTERACTIONS.PERSON_ID];
  // v7.6 §2.1: Commitment class unhidden — it's the single most important
  // triage signal on this tab, and COMMITMENT_CLASS_COLORS conditional
  // formatting is already wired to it, just previously sitting unused on
  // a hidden column. The four appended helper columns stay visible too.
  if (canonicalName === 'Tasks') return [COLS.TODO.ID, COLS.TODO.OBJ_TYPE, COLS.TODO.OBJ_ID, COLS.TODO.ORG, COLS.TODO.WORKFLOW, COLS.TODO.PARENT_ID, COLS.TODO.CREATED, COLS.TODO.COMPLETED, COLS.TODO.SOURCE, COLS.TODO.LAST_EDITED, COLS.TODO.CLASS_CALC_AT, COLS.TODO.EFFORT_TYPE, COLS.TODO.PRIORITY_RANK, COLS.TODO.HAS_SUBTASKS, COLS.TODO.BLOCKED_BY_ID];
  if (canonicalName === 'Interviews') return [COLS.ROUNDS.ID, COLS.ROUNDS.JOB_ID];
  if (canonicalName === 'Sectors') return [COLS.SECTORS.ID, COLS.SECTORS.SUBSECTOR_ID];
  if (canonicalName === 'Decisions') return [COLS.DECISIONS.ID, COLS.DECISIONS.KEY, COLS.DECISIONS.TARGET_TYPE, COLS.DECISIONS.TARGET_ID, COLS.DECISIONS.WORKFLOW, COLS.DECISIONS.TODO_ID];
  return [];
}

function sheetHeaderLength(canonicalName) {
  var key = SHEET_TO_HEADER_KEY[canonicalName];
  return HEADERS[key] ? HEADERS[key].length : 12;
}

function clearRetiredSchemaColumns(sheet, canonicalName) {
  var width = sheetHeaderLength(canonicalName);
  var extraCols = sheet.getMaxColumns() - width;
  if (!width || extraCols <= 0) return;
  sheet.getRange(1, width + 1, sheet.getMaxRows(), extraCols)
    .clearContent()
    .clearNote()
    .clearDataValidations()
    .clearFormat();
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
  SpreadsheetApp.getActiveSpreadsheet().toast('Hidden columns shown for inspection.', 'The Planner', 3);
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

function isLegacySpacerSheetName(name) {
  var compact = String(name || '').replace(/\s/g, '');
  return /^(?:\||│)+$/.test(compact);
}

function isSheetEmpty(sheet) {
  return sheet && sheet.getLastRow() === 0 && sheet.getLastColumn() === 0;
}

function deleteSheetIfSafe(sheet) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!sheet || ss.getSheets().length <= 1) return false;
  if (ss.getActiveSheet().getSheetId() === sheet.getSheetId()) {
    var fallback = getSheet('Home') || ss.getSheets().filter(function (s) { return s.getSheetId() !== sheet.getSheetId(); })[0];
    if (fallback) ss.setActiveSheet(fallback);
  }
  ss.deleteSheet(sheet);
  return true;
}

function hideLegacyUtilityTabs() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var dashboard = getSheet('Dashboard');
  if (dashboard) deleteSheetIfSafe(dashboard);

  ss.getSheets().slice().forEach(function (sheet) {
    if (!isLegacySpacerSheetName(sheet.getName())) return;
    if (isSheetEmpty(sheet)) {
      deleteSheetIfSafe(sheet);
    } else if (!sheet.isSheetHidden()) {
      try { sheet.hideSheet(); } catch (err) { }
    }
  });
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
    SpreadsheetApp.getActiveSpreadsheet().toast('Old tab names cleaned up: ' + renamed.join(', '), 'The Planner', 6);
  }
  return renamed;
}

function nextMigratedId(maxByPrefix, prefix) {
  maxByPrefix[prefix] = (maxByPrefix[prefix] || 0) + 1;
  return prefix + '-' + String(maxByPrefix[prefix]).padStart(3, '0');
}

function scanLegacySectorIdMax(oldRows) {
  var out = { SEC: 0, SUB: 0 };
  oldRows.forEach(function (row) {
    var id = String(row[0] || '');
    var m = id.match(/^(SEC|SUB)-(\d+)$/);
    if (m) out[m[1]] = Math.max(out[m[1]] || 0, parseInt(m[2], 10) || 0);
  });
  return out;
}

function migrateSectorsTwoIdSchema() {
  var sheet = getSheet('Sectors');
  if (!sheet || sheet.getLastRow() < 1) return false;
  var headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 6)).getValues()[0].map(String);
  if (headers[0] === 'Sector ID' && headers[1] === 'Sector' && headers[2] === 'Sub-sector ID') return false;
  var hasOriginalLegacyOrder = headers[0] === 'Sector ID' && headers[1] === 'Sector' && headers[2] === 'Sub-sector';
  var hasTwoIdOldOrder = headers[0] === 'Sector ID' && headers[1] === 'Sub-sector ID' && headers[2] === 'Sector';
  if (!hasOriginalLegacyOrder && !hasTwoIdOldOrder) return false;

  var rawRows = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, hasTwoIdOldOrder ? 6 : 5).getValues() : [];
  var oldRows = rawRows.map(function (row) {
    return hasTwoIdOldOrder
      ? [row[0], row[2], row[3], row[4], row[5], row[1]]
      : [row[0], row[1], row[2], row[3], row[4], ''];
  });
  var maxByPrefix = scanLegacySectorIdMax(oldRows);
  var sectorIdByName = {};
  oldRows.forEach(function (row) {
    var oldId = String(row[0] || '');
    var sector = String(row[1] || '').trim();
    var sub = String(row[2] || '').trim();
    if (sector && !sub && oldId.indexOf('SEC-') === 0) sectorIdByName[normalizeKeyPart(sector)] = oldId;
  });

  var parentRows = [];
  var newRows = [];
  oldRows.forEach(function (row) {
    var oldId = String(row[0] || '');
    var sector = String(row[1] || '').trim();
    var sub = String(row[2] || '').trim();
    var status = row[3] || '';
    var notes = row[4] || '';
    if (!sector && !sub && !oldId && !status && !notes) return;
    var key = normalizeKeyPart(sector);
    if (sub) {
      if (!sectorIdByName[key]) {
        sectorIdByName[key] = nextMigratedId(maxByPrefix, 'SEC');
        parentRows.push([sectorIdByName[key], sector, '', '', 'Open', '[created-via-migration]']);
      }
      var migratedSubId = row[5] || (oldId.indexOf('SUB-') === 0 ? oldId : nextMigratedId(maxByPrefix, 'SUB'));
      newRows.push([sectorIdByName[key], sector, migratedSubId, sub, status || 'Open', notes]);
    } else {
      var sectorId = oldId.indexOf('SEC-') === 0 ? oldId : (sectorIdByName[key] || nextMigratedId(maxByPrefix, 'SEC'));
      sectorIdByName[key] = sectorId;
      newRows.push([sectorId, sector, '', '', status || 'Open', notes]);
    }
  });

  var rowsToClear = Math.max(sheet.getMaxRows() - 1, 1);
  sheet.getRange(1, 1, 1, HEADERS.Sectors.length).setValues([HEADERS.Sectors]);
  sheet.getRange(2, 1, rowsToClear, HEADERS.Sectors.length).clearContent().clearNote().clearDataValidations();
  var combined = parentRows.concat(newRows);
  if (combined.length) sheet.getRange(2, 1, combined.length, HEADERS.Sectors.length).setValues(combined);
  return true;
}

function migrateOrganisationSectorIdSchema() {
  var sheet = getSheet('Organisations');
  if (!sheet || sheet.getLastRow() < 1) return false;
  var headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 13)).getValues()[0].map(String);
  if (headers[2] === 'Sector ID' && headers[4] === 'Sub-sector ID') return false;
  if (!(headers[2] === 'Sector' && headers[3] === 'Sub-sector' && (headers[4] === 'Sub-sector ID' || headers[4] === 'Sector branch ID'))) return false;

  var oldRows = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 12).getValues() : [];
  var newRows = oldRows.map(function (row) {
    var sector = row[2] || '';
    var sub = row[3] || '';
    var branchId = String(row[4] || '');
    var sectorId = '';
    var subId = '';
    if (branchId.indexOf('SUB-') === 0) {
      var subBranch = getSectorBranchById(branchId);
      subId = branchId;
      sectorId = subBranch ? subBranch.sectorId : '';
    } else if (branchId.indexOf('SEC-') === 0) {
      sectorId = branchId;
    }
    if (!sectorId && sector) {
      var branch = findSectorBranch(sector, sub);
      if (branch) {
        sectorId = branch.sectorId;
        subId = branch.subsectorId;
      }
    }
    return [
      row[0], row[1], sectorId, sector, subId, sub,
      row[5], row[6], row[7], row[8], row[9], row[10], row[11]
    ];
  });

  var rowsToClear = Math.max(sheet.getMaxRows() - 1, 1);
  sheet.getRange(1, 1, 1, HEADERS.Organisations.length).setValues([HEADERS.Organisations]);
  sheet.getRange(2, 1, rowsToClear, HEADERS.Organisations.length).clearContent().clearNote().clearDataValidations();
  if (newRows.length) sheet.getRange(2, 1, newRows.length, HEADERS.Organisations.length).setValues(newRows);
  return true;
}

function openApplicationWorkByJobId() {
  var out = {};
  var sheet = getSheet('Tasks');
  if (!sheet || sheet.getLastRow() < 2) return out;
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS['To-do'].length).getValues();
  var workflows = ['Application preparation', 'Application blocker', 'Submit application', 'Referral search'];
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][COLS.TODO.OBJ_TYPE - 1]) !== 'Job') continue;
    if (workflows.indexOf(String(data[i][COLS.TODO.WORKFLOW - 1])) === -1) continue;
    var status = String(data[i][COLS.TODO.STATUS - 1]);
    if (!isOpenTodoStatus(status)) continue;
    var jobId = String(data[i][COLS.TODO.OBJ_ID - 1] || '');
    if (jobId) out[jobId] = true;
  }
  return out;
}

function migrateLegacyApplicationStatusValue(value, jobId, openWorkByJobId) {
  var raw = String(value || '').trim();
  if (!raw) return '';
  if (DROPDOWNS.JOB_STATUS.indexOf(raw) !== -1) return raw;
  if (raw === 'Want to apply') return openWorkByJobId && openWorkByJobId[String(jobId)] ? 'In progress' : 'Not started';
  return normalizeJobStatus(raw) || raw;
}

function migrateJobsDeadlineStatusSchema() {
  var sheet = getSheet('Jobs');
  if (!sheet || sheet.getLastRow() < 1) return false;
  var headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), HEADERS.Jobs.length)).getValues()[0].map(String);
  var oldOrder = headers[4] === 'Status' && headers[5] === 'Deadline';
  var renamedStatus = headers[4] === 'Deadline' && headers[5] === 'Status';
  var current = headers[4] === 'Deadline' && headers[5] === 'Application status';
  if (!oldOrder && !renamedStatus && !current) return false;

  var changed = !current;
  var rowCount = Math.max(sheet.getLastRow() - 1, 0);
  if (rowCount > 0) {
    var openWorkByJobId = openApplicationWorkByJobId();
    if (oldOrder) {
      var rows = sheet.getRange(2, 1, rowCount, HEADERS.Jobs.length).getValues();
      for (var i = 0; i < rows.length; i++) {
        var oldStatus = rows[i][4];
        var oldDeadline = rows[i][5];
        rows[i][4] = oldDeadline;
        rows[i][5] = migrateLegacyApplicationStatusValue(oldStatus, rows[i][0], openWorkByJobId);
      }
      sheet.getRange(2, 1, rowCount, HEADERS.Jobs.length).setValues(rows);
      changed = true;
    } else {
      var statusValues = sheet.getRange(2, COLS.JOBS.STATUS, rowCount, 1).getValues();
      var ids = sheet.getRange(2, COLS.JOBS.ID, rowCount, 1).getValues();
      for (var j = 0; j < statusValues.length; j++) {
        var migrated = migrateLegacyApplicationStatusValue(statusValues[j][0], ids[j][0], openWorkByJobId);
        if (migrated !== String(statusValues[j][0] || '').trim()) {
          statusValues[j][0] = migrated;
          changed = true;
        }
      }
      if (changed) sheet.getRange(2, COLS.JOBS.STATUS, rowCount, 1).setValues(statusValues);
    }
  }
  if (!current) sheet.getRange(1, 1, 1, HEADERS.Jobs.length).setValues([HEADERS.Jobs]);
  return changed;
}

function migrateInteractionsStatusSchema() {
  var sheet = getSheet('Conversations');
  if (!sheet || sheet.getLastRow() < 1) return false;
  var width = Math.max(sheet.getLastColumn(), HEADERS.Interactions.length);
  var headers = sheet.getRange(1, 1, 1, width).getValues()[0].map(String);
  if (headers[COLS.INTERACTIONS.STATUS - 1] === 'Interaction status') return false;
  var oldNotesAtStatus = headers[COLS.INTERACTIONS.STATUS - 1] === 'Key notes' && headers[COLS.INTERACTIONS.NOTES - 1] === 'Outcome';
  if (!oldNotesAtStatus) return false;
  sheet.insertColumnBefore(COLS.INTERACTIONS.STATUS);
  sheet.getRange(1, 1, 1, HEADERS.Interactions.length).setValues([HEADERS.Interactions]);
  var rowCount = Math.max(sheet.getLastRow() - 1, 0);
  if (rowCount > 0) {
    var statuses = [];
    for (var i = 0; i < rowCount; i++) statuses.push(['Completed']);
    sheet.getRange(2, COLS.INTERACTIONS.STATUS, rowCount, 1).setValues(statuses);
  }
  return true;
}

function migrateSectorIdSchema() {
  var migratedSectors = migrateSectorsTwoIdSchema();
  var migratedOrgs = migrateOrganisationSectorIdSchema();
  return migratedSectors || migratedOrgs;
}

function migrateWorkbookSchema() {
  var migratedSectorsOrOrgs = migrateSectorIdSchema();
  var migratedJobs = migrateJobsDeadlineStatusSchema();
  var migratedInteractions = migrateInteractionsStatusSchema();
  return migratedSectorsOrOrgs || migratedJobs || migratedInteractions;
}

// =============================================================
// DROPDOWNS — applied per sheet
// =============================================================

function clearBodyDropdowns(sheet, canonicalName, maxRow) {
  if (canonicalName === 'Today') return;
  var width = sheetHeaderLength(canonicalName);
  if (!width) return;
  sheet.getRange(2, 1, maxRow, width).clearDataValidations();
}

function normalizeExistingPeopleStages(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return 0;
  var rowCount = sheet.getLastRow() - 1;
  var stageRange = sheet.getRange(2, COLS.PEOPLE.STAGE, rowCount, 1);
  var replyRange = sheet.getRange(2, COLS.PEOPLE.REPLY_RECEIVED, rowCount, 1);
  var values = stageRange.getValues();
  var replies = replyRange.getValues();
  var changed = 0;
  for (var i = 0; i < values.length; i++) {
    var raw = String(values[i][0] || '');
    var normalized = normalizePersonStage(raw) || 'Identified';
    if (raw && normalized && raw !== normalized) {
      values[i][0] = normalized;
      changed++;
    }
    if (['Engaged', 'Conversation scheduled', 'Conversation completed', 'Replied', 'Keep warm'].indexOf(raw) !== -1 && String(replies[i][0] || '') !== 'Yes') {
      replies[i][0] = 'Yes';
      changed++;
    }
  }
  if (changed) {
    stageRange.setValues(values);
    replyRange.setValues(replies);
  }
  return changed;
}

function applySheetDropdowns(canonicalName) {
  var sheet = getSheet(canonicalName);
  if (!sheet) return;
  var maxRow = Math.max(sheet.getMaxRows() - 1, 40);
  clearBodyDropdowns(sheet, canonicalName, maxRow);
  switch (canonicalName) {
    case 'Sectors':
      setDropdown(sheet.getRange(2, COLS.SECTORS.STATUS, maxRow, 1), DROPDOWNS.SECTOR_STATUS, { allowInvalid: false });
      break;
    case 'Organisations':
      setDropdown(sheet.getRange(2, COLS.ORGS.TIER, maxRow, 1), DROPDOWNS.ORG_TIER, { allowInvalid: false });
      setDropdown(sheet.getRange(2, COLS.ORGS.STATUS, maxRow, 1), DROPDOWNS.ORG_STATUS, { allowInvalid: false });
      break;
    case 'People':
      normalizeExistingPeopleStages(sheet);
      setDropdown(sheet.getRange(2, COLS.PEOPLE.STAGE, maxRow, 1), DROPDOWNS.PERSON_STAGE, { allowInvalid: false });
      setDropdown(sheet.getRange(2, COLS.PEOPLE.REL_TYPE, maxRow, 1), DROPDOWNS.PERSON_REL_TYPE);
      setDropdown(sheet.getRange(2, COLS.PEOPLE.REPLY_RECEIVED, maxRow, 1), DROPDOWNS.YES_NO);
      setDropdown(sheet.getRange(2, COLS.PEOPLE.FOLLOW_UP_SENT, maxRow, 1), DROPDOWNS.YES_NO);
      break;
    case 'Jobs':
      setDropdown(sheet.getRange(2, COLS.JOBS.STATUS, maxRow, 1), DROPDOWNS.JOB_STATUS, { allowInvalid: false });
      setDropdown(sheet.getRange(2, COLS.JOBS.RESPONSE, maxRow, 1), DROPDOWNS.YES_NO);
      setDropdown(sheet.getRange(2, COLS.JOBS.OUTCOME, maxRow, 1), DROPDOWNS.JOB_OUTCOME, { allowInvalid: false });
      break;
    case 'Conversations':
      setDropdown(sheet.getRange(2, COLS.INTERACTIONS.TYPE, maxRow, 1), DROPDOWNS.INTERACTION_TYPE);
      setDropdown(sheet.getRange(2, COLS.INTERACTIONS.STATUS, maxRow, 1), DROPDOWNS.INTERACTION_STATUS, { allowInvalid: false });
      setDropdown(sheet.getRange(2, COLS.INTERACTIONS.OUTCOME, maxRow, 1), DROPDOWNS.INTERACTION_OUTCOME, { allowInvalid: false });
      refreshInteractionPersonDropdown();
      break;
    case 'Tasks':
      setDropdown(sheet.getRange(2, COLS.TODO.OBJ_TYPE, maxRow, 1), DROPDOWNS.TODO_OBJ_TYPE);
      setDropdown(sheet.getRange(2, COLS.TODO.WORKFLOW, maxRow, 1), DROPDOWNS.TODO_WORKFLOW, { allowInvalid: false });
      setDropdown(sheet.getRange(2, COLS.TODO.STATUS, maxRow, 1), DROPDOWNS.TODO_STATUS, { allowInvalid: false });
      setDropdown(sheet.getRange(2, COLS.TODO.TIME_EST, maxRow, 1), DROPDOWNS.TODO_TIME);
      setDropdown(sheet.getRange(2, COLS.TODO.COMMITMENT_CLASS, maxRow, 1), DROPDOWNS.TODO_COMMITMENT_CLASS, { allowInvalid: false });
      setDropdown(sheet.getRange(2, COLS.TODO.SOURCE, maxRow, 1), DROPDOWNS.TODO_SOURCE);
      setDropdown(sheet.getRange(2, COLS.TODO.PLAN_PATTERN, maxRow, 1), DROPDOWNS.TODO_PLAN_PATTERN);
      break;
    case 'Interviews':
      setDropdown(sheet.getRange(2, COLS.ROUNDS.ROUND_TYPE, maxRow, 1), DROPDOWNS.ROUND_TYPE, { allowInvalid: false });
      setDropdown(sheet.getRange(2, COLS.ROUNDS.STATUS, maxRow, 1), DROPDOWNS.ROUND_STATUS, { allowInvalid: false });
      setDropdown(sheet.getRange(2, COLS.ROUNDS.DOMAIN_READINESS, maxRow, 1), DROPDOWNS.DOMAIN_READINESS);
      setDropdown(sheet.getRange(2, COLS.ROUNDS.OFFICIAL_OUTCOME, maxRow, 1), DROPDOWNS.OFFICIAL_OUTCOME, { allowInvalid: false });
      break;
    case 'Today':
      // v7.4: per-row, not blanket — Option rows need the smaller
      // 'Deferred'/'Pull in' list, not the full Commit-row status list.
      applyTodayRowStatusDropdowns(sheet);
      break;
    case 'Decisions':
      setDropdown(sheet.getRange(2, COLS.DECISIONS.DECISION, maxRow, 1), DROPDOWNS.DECISION, { allowInvalid: false });
      setDropdown(sheet.getRange(2, COLS.DECISIONS.ACTION_TYPE, maxRow, 1), DROPDOWNS.DECISION_ACTION_TYPE, { allowInvalid: false });
      break;
  }
}

function refreshAllDropdowns() {
  ['Sectors', 'Organisations', 'People', 'Jobs', 'Conversations', 'Tasks', 'Interviews', 'Today', 'Decisions'].forEach(applySheetDropdowns);
}

// =============================================================
// DAILY SWEEP — materializes due follow-ups, deadlines, etc.
// =============================================================

function dropdownIntegrityRules() {
  return [
    { sheet: 'Sectors', headerKey: 'Sectors', col: COLS.SECTORS.STATUS, notesCol: COLS.SECTORS.NOTES, label: 'Status', values: DROPDOWNS.SECTOR_STATUS },
    { sheet: 'Organisations', headerKey: 'Organisations', col: COLS.ORGS.TIER, notesCol: COLS.ORGS.NOTES, label: 'Tier', values: DROPDOWNS.ORG_TIER },
    { sheet: 'Organisations', headerKey: 'Organisations', col: COLS.ORGS.STATUS, notesCol: COLS.ORGS.NOTES, label: 'Status', values: DROPDOWNS.ORG_STATUS },
    { sheet: 'People', headerKey: 'People', col: COLS.PEOPLE.STAGE, notesCol: COLS.PEOPLE.NOTES, label: 'Relationship status', values: DROPDOWNS.PERSON_STAGE },
    { sheet: 'People', headerKey: 'People', col: COLS.PEOPLE.REPLY_RECEIVED, notesCol: COLS.PEOPLE.NOTES, label: 'Reply received', values: DROPDOWNS.YES_NO },
    { sheet: 'People', headerKey: 'People', col: COLS.PEOPLE.FOLLOW_UP_SENT, notesCol: COLS.PEOPLE.NOTES, label: 'Follow-up sent?', values: DROPDOWNS.YES_NO },
    { sheet: 'Jobs', headerKey: 'Jobs', col: COLS.JOBS.STATUS, notesCol: COLS.JOBS.NOTES, label: 'Application status', values: DROPDOWNS.JOB_STATUS },
    { sheet: 'Jobs', headerKey: 'Jobs', col: COLS.JOBS.RESPONSE, notesCol: COLS.JOBS.NOTES, label: 'Response received', values: DROPDOWNS.YES_NO },
    { sheet: 'Jobs', headerKey: 'Jobs', col: COLS.JOBS.OUTCOME, notesCol: COLS.JOBS.NOTES, label: 'Application result', values: DROPDOWNS.JOB_OUTCOME },
    { sheet: 'Conversations', headerKey: 'Interactions', col: COLS.INTERACTIONS.STATUS, notesCol: COLS.INTERACTIONS.NOTES, label: 'Interaction status', values: DROPDOWNS.INTERACTION_STATUS },
    { sheet: 'Conversations', headerKey: 'Interactions', col: COLS.INTERACTIONS.OUTCOME, notesCol: COLS.INTERACTIONS.NOTES, label: 'Outcome', values: DROPDOWNS.INTERACTION_OUTCOME },
    { sheet: 'Tasks', headerKey: 'To-do', col: COLS.TODO.OBJ_TYPE, notesCol: COLS.TODO.NOTES, label: 'Linked object type', values: DROPDOWNS.TODO_OBJ_TYPE },
    { sheet: 'Tasks', headerKey: 'To-do', col: COLS.TODO.WORKFLOW, notesCol: COLS.TODO.NOTES, label: 'Workflow', values: DROPDOWNS.TODO_WORKFLOW },
    { sheet: 'Tasks', headerKey: 'To-do', col: COLS.TODO.STATUS, notesCol: COLS.TODO.NOTES, label: 'Status', values: DROPDOWNS.TODO_STATUS },
    { sheet: 'Tasks', headerKey: 'To-do', col: COLS.TODO.COMMITMENT_CLASS, notesCol: COLS.TODO.NOTES, label: 'Commitment class', values: DROPDOWNS.TODO_COMMITMENT_CLASS },
    { sheet: 'Tasks', headerKey: 'To-do', col: COLS.TODO.PLAN_PATTERN, notesCol: COLS.TODO.NOTES, label: 'Plan pattern', values: DROPDOWNS.TODO_PLAN_PATTERN },
    { sheet: 'Interviews', headerKey: 'Interview rounds', col: COLS.ROUNDS.ROUND_TYPE, notesCol: COLS.ROUNDS.NOTES, label: 'Round type', values: DROPDOWNS.ROUND_TYPE },
    { sheet: 'Interviews', headerKey: 'Interview rounds', col: COLS.ROUNDS.STATUS, notesCol: COLS.ROUNDS.NOTES, label: 'Round status', values: DROPDOWNS.ROUND_STATUS },
    { sheet: 'Interviews', headerKey: 'Interview rounds', col: COLS.ROUNDS.OFFICIAL_OUTCOME, notesCol: COLS.ROUNDS.NOTES, label: 'Official outcome', values: DROPDOWNS.OFFICIAL_OUTCOME },
    { sheet: 'Decisions', headerKey: 'Pending decisions', col: COLS.DECISIONS.DECISION, notesCol: COLS.DECISIONS.NOTES, label: 'Decision', values: DROPDOWNS.DECISION },
    { sheet: 'Decisions', headerKey: 'Pending decisions', col: COLS.DECISIONS.ACTION_TYPE, notesCol: COLS.DECISIONS.NOTES, label: 'Decision action type', values: DROPDOWNS.DECISION_ACTION_TYPE }
  ];
}

function scanInvalidDropdownValues(writeFlags) {
  var count = 0;
  var bySheet = {};
  var rulesBySheet = {};
  dropdownIntegrityRules().forEach(function (rule) {
    if (!rulesBySheet[rule.sheet]) rulesBySheet[rule.sheet] = [];
    rulesBySheet[rule.sheet].push(rule);
  });
  Object.keys(rulesBySheet).forEach(function (sheetName) {
    var rules = rulesBySheet[sheetName];
    var sheet = getSheet(sheetName);
    if (!sheet || sheet.getLastRow() < 2) return;
    var width = HEADERS[rules[0].headerKey].length;
    var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, width).getValues();
    for (var i = 0; i < values.length; i++) {
      var row = i + 2;
      var messages = [];
      for (var j = 0; j < rules.length; j++) {
        var rule = rules[j];
        var raw = String(values[i][rule.col - 1] || '').trim();
        if (!raw || rule.values.indexOf(raw) !== -1) continue;
        count++;
        bySheet[sheetName] = (bySheet[sheetName] || 0) + 1;
        messages.push(rule.label + ' "' + raw + '"');
      }
      if (!writeFlags) continue;
      if (messages.length) appendNoteFlag(sheet, row, rules[0].notesCol, '[invalid-value] ' + messages.join('; ') + ' not in current dropdowns');
      else clearNoteFlag(sheet, row, rules[0].notesCol, '[invalid-value]');
    }
  });
  return { count: count, bySheet: bySheet };
}

function duplicateIdIntegrityRules() {
  return [
    { sheet: 'Sectors', headerKey: 'Sectors', idCol: COLS.SECTORS.SUBSECTOR_ID, notesCol: COLS.SECTORS.NOTES, label: 'Sub-sector ID', flag: '[duplicate-subsector-id]' },
    { sheet: 'Organisations', headerKey: 'Organisations', idCol: COLS.ORGS.ID, notesCol: COLS.ORGS.NOTES, label: 'Org ID', flag: '[duplicate-org-id]' },
    { sheet: 'Jobs', headerKey: 'Jobs', idCol: COLS.JOBS.ID, notesCol: COLS.JOBS.NOTES, label: 'Job ID', flag: '[duplicate-job-id]' },
    { sheet: 'People', headerKey: 'People', idCol: COLS.PEOPLE.ID, notesCol: COLS.PEOPLE.NOTES, label: 'Person ID', flag: '[duplicate-person-id]' },
    { sheet: 'Conversations', headerKey: 'Interactions', idCol: COLS.INTERACTIONS.ID, notesCol: COLS.INTERACTIONS.NOTES, label: 'Interaction ID', flag: '[duplicate-interaction-id]' },
    { sheet: 'Interviews', headerKey: 'Interview rounds', idCol: COLS.ROUNDS.ID, notesCol: COLS.ROUNDS.NOTES, label: 'Round ID', flag: '[duplicate-round-id]' },
    { sheet: 'Tasks', headerKey: 'To-do', idCol: COLS.TODO.ID, notesCol: COLS.TODO.NOTES, label: 'To-do ID', flag: '[duplicate-task-id]' },
    { sheet: 'Decisions', headerKey: 'Pending decisions', idCol: COLS.DECISIONS.ID, notesCol: COLS.DECISIONS.NOTES, label: 'Decision ID', flag: '[duplicate-decision-id]' }
  ];
}

function scanDuplicateIdValues(writeFlags) {
  var count = 0;
  var bySheet = {};
  duplicateIdIntegrityRules().forEach(function (rule) {
    var sheet = getSheet(rule.sheet);
    if (!sheet || sheet.getLastRow() < 2) return;
    var width = HEADERS[rule.headerKey].length;
    var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, width).getValues();
    var rowsById = {};
    values.forEach(function (row, idx) {
      var id = String(row[rule.idCol - 1] || '').trim();
      if (!id) return;
      if (!rowsById[id]) rowsById[id] = [];
      rowsById[id].push(idx + 2);
    });
    values.forEach(function (row, idx) {
      var id = String(row[rule.idCol - 1] || '').trim();
      var sheetRow = idx + 2;
      var duplicateRows = id ? (rowsById[id] || []).filter(function (r) { return r !== sheetRow; }) : [];
      if (duplicateRows.length) {
        count++;
        bySheet[rule.sheet] = (bySheet[rule.sheet] || 0) + 1;
        if (writeFlags) appendNoteFlag(sheet, sheetRow, rule.notesCol, rule.flag + ' ' + rule.label + ' also used on row(s): ' + duplicateRows.join(', '));
      } else if (writeFlags) {
        clearNoteFlag(sheet, sheetRow, rule.notesCol, rule.flag);
      }
    });
  });
  return { count: count, bySheet: bySheet };
}

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
      var replyReceived = String(pData[i][COLS.PEOPLE.REPLY_RECEIVED - 1] || '');
      var followUpSent = String(pData[i][COLS.PEOPLE.FOLLOW_UP_SENT - 1]);
      var keepWarm = stage === 'Keep warm';
      var closed = stage === 'Closed';
      if (!personId || !personName) continue;
      if (closed) continue;
      if (!keepWarm && !closed && replyReceived !== 'Yes' && stage === 'Outreach sent' && followUpDate && new Date(followUpDate) < todayDate && followUpSent === 'No') {
        if (appendTodoOnceForWorkflow('Follow up with ' + personName, 'Person', personId, orgName, 'Contact follow-up', 'Not started', followUpDate, '15 min', '', 'Auto-triggered')) created++;
      }
      if (keepWarm && followUpDate && new Date(followUpDate) < todayDate) {
        if (appendTodoOnceForWorkflow('Keep-warm check-in with ' + personName, 'Person', personId, orgName, 'Contact follow-up', 'Not started', followUpDate, '15 min', '', 'Auto-triggered')) created++;
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
      var outcome = normalizeJobOutcome(jData[jj][COLS.JOBS.OUTCOME - 1]);
      if (!jobId || !jobTitle) continue;
      var stillWaiting = !response || response === 'No' || outcome === 'Waiting';
      if (jobStatus === 'Submitted' && reviewDate && new Date(reviewDate) < todayDate && stillWaiting) {
        if (appendTodoOnceForWorkflow('Check application response: ' + jobTitle + ' at ' + jobOrg, 'Job', jobId, jobOrg, 'Check application response', 'Not started', reviewDate, '15 min', '', 'Auto-triggered')) created++;
      }
    }
  }

  var orgsSheet = getSheet('Organisations');
  if (orgsSheet && orgsSheet.getLastRow() > 1) {
    var oData = orgsSheet.getRange(2, 1, orgsSheet.getLastRow() - 1, COLS.ORGS.NOTES).getValues();
    for (var oo = 0; oo < oData.length; oo++) {
      var oId = String(oData[oo][COLS.ORGS.ID - 1]);
      var oName = String(oData[oo][COLS.ORGS.NAME - 1]);
      var oStatus = normalizeOrgStatus(oData[oo][COLS.ORGS.STATUS - 1]);
      var oNextCheck = oData[oo][COLS.ORGS.NEXT_CHECK - 1];
      if (!oId) continue;
      if (oStatus === 'Active' && isDueOnOrBefore(oNextCheck, todayDate)) {
        if (appendOrgReviewDecision(oId, oName, oStatus)) created++;
      }
      if (oStatus === 'Dormant' && isDueOnOrBefore(oNextCheck, todayDate)) {
        if (appendOrgReviewDecision(oId, oName, oStatus)) created++;
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
        if (appendTodoOnceForWorkflow('Check response from ' + rOrgDisp + ' Round ' + rRound, 'Interview round', rId, rOrgDisp, 'Interview follow-up', 'Not started', rExpResp, '15 min', '', 'Auto-triggered')) created++;
      }
    }
  }
  return created;
}

function weeklyReview() {
  // v7.3: guarded — writes stale-nurture flags, so keep it off the daily
  // trigger's toes.
  var summary = withDocumentLock(weeklyReviewImpl, { label: 'weeklyReview', timeoutMs: 30000, failOpen: false });
  if (summary && summary.message) {
    SpreadsheetApp.getActiveSpreadsheet().toast(summary.message, 'The Planner', 8);
  } else {
    SpreadsheetApp.getActiveSpreadsheet().toast('Weekly review skipped because another Planner action is running. Try again in a minute.', 'The Planner', 6);
  }
  return summary;
}

function weeklyReviewImpl() {
  var summary = { staleKeepWarm: 0, activeEmpty: 0, activeEmptyTasks: 0, activeEmptyAlreadyRouted: 0, orgOrphans: 0, sectorOrphans: 0 };
  var peopleSheet = getSheet('People');
  if (peopleSheet && peopleSheet.getLastRow() > 1) {
    var pData = peopleSheet.getRange(2, 1, peopleSheet.getLastRow() - 1, COLS.PEOPLE.NOTES).getValues();
    for (var i = 0; i < pData.length; i++) {
      var fupDate = pData[i][COLS.PEOPLE.FOLLOW_UP_DATE - 1];
      var pStage = normalizePersonStage(pData[i][COLS.PEOPLE.STAGE - 1]);
      if (pStage === 'Keep warm' && fupDate) {
        var daysOver = daysBetween(new Date(fupDate), today());
        if (daysOver >= 14) {
          var pId = String(pData[i][COLS.PEOPLE.ID - 1] || '');
          var hasFollowUp = openTodoExistsForTargetWorkflow('Person', pId, 'Contact follow-up');
          appendNoteFlag(peopleSheet, i + 2, COLS.PEOPLE.NOTES,
            hasFollowUp ? '[weekly-review] Keep-warm follow-up overdue; follow-up task already open.' : '[weekly-review] Keep-warm follow-up overdue; no follow-up task found.');
          summary.staleKeepWarm++;
        }
      }
    }
  }
  syncOrgReviewSchedules();
  var activeEmpty = checkOrgActiveEmpty();
  summary.activeEmpty = activeEmpty.flagged;
  summary.activeEmptyTasks = activeEmpty.tasksCreated;
  summary.activeEmptyAlreadyRouted = activeEmpty.alreadyRouted;
  summary.orgOrphans = checkOrgOrphans();
  summary.sectorOrphans = detectSectorOrphans();

  colorCodeManualFields();
  applyColumnWidths();
  refreshAllDropdowns();
  checkTriggerHealth();
  recordMaintenanceHeartbeat('lastWeeklyReviewAt');
  summary.message = 'Weekly review: ' + summary.activeEmptyTasks + ' org review route(s) created, ' + summary.activeEmptyAlreadyRouted + ' empty Active org(s) already routed, ' + summary.staleKeepWarm + ' stale keep-warm, ' + summary.orgOrphans + ' org orphans, ' + summary.sectorOrphans + ' sector orphans.';
  try { maintenanceProps().setProperty('lastWeeklyReviewSummary', summary.message); } catch (err) { Logger.log('weeklyReview summary store: ' + err); }
  populateToday();
  refreshHome();
  return summary;
}

function orgPursuitRouteExists(orgId) {
  var workflows = ['People sourcing', 'Org job scan', 'Org research'];
  for (var i = 0; i < workflows.length; i++) {
    if (openTodoExistsForTargetWorkflow('Organisation', orgId, workflows[i])) return true;
    if (pendingDecisionExistsForTargetWorkflow('Organisation', orgId, workflows[i])) return true;
  }
  return false;
}

function orgKnownPeopleCountMap() {
  var out = {};
  var sheet = getSheet('People');
  if (!sheet || sheet.getLastRow() < 2) return out;
  var data = sheet.getRange(2, COLS.PEOPLE.ORG_ID, sheet.getLastRow() - 1, 1).getValues();
  data.forEach(function (r) {
    var orgId = String(r[0] || '');
    if (orgId) out[orgId] = (out[orgId] || 0) + 1;
  });
  return out;
}

function orgOpenOpportunityCountMap() {
  var out = {};
  var sheet = getSheet('Jobs');
  if (!sheet || sheet.getLastRow() < 2) return out;
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, COLS.JOBS.STATUS).getValues();
  data.forEach(function (r) {
    var opportunity = String(r[COLS.JOBS.OPPORTUNITY - 1] || '');
    var orgId = String(r[COLS.JOBS.ORG_ID - 1] || '');
    var status = String(r[COLS.JOBS.STATUS - 1] || '');
    if (opportunity && orgId && status !== 'Closed') out[orgId] = (out[orgId] || 0) + 1;
  });
  return out;
}

// An Organisation marked Active is a deliberate choice to pursue it. If it
// still has no people and no open opportunities, weekly review turns that
// hidden health signal into one visible review task, unless a pursuit route
// is already open in Decisions or Tasks.
function checkOrgActiveEmpty() {
  var sheet = getSheet('Organisations');
  var result = { flagged: 0, tasksCreated: 0, alreadyRouted: 0 };
  if (!sheet || sheet.getLastRow() < 2) return result;
  var knownPeopleByOrg = orgKnownPeopleCountMap();
  var openOppsByOrg = orgOpenOpportunityCountMap();
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, COLS.ORGS.NOTES).getValues();
  for (var i = 0; i < data.length; i++) {
    var row = i + 2;
    var orgId = String(data[i][COLS.ORGS.ID - 1] || '');
    var orgName = String(data[i][COLS.ORGS.NAME - 1] || '');
    var status = normalizeOrgStatus(data[i][COLS.ORGS.STATUS - 1]);
    var nextCheck = data[i][COLS.ORGS.NEXT_CHECK - 1];
    var knownPeople = knownPeopleByOrg[orgId] || 0;
    var openOpps = openOppsByOrg[orgId] || 0;
    if (status === 'Active' && orgId && knownPeople === 0 && openOpps === 0) {
      result.flagged++;
      if (nextCheck && !isDueOnOrBefore(nextCheck, today())) {
        appendNoteFlag(sheet, row, COLS.ORGS.NOTES, '[active-empty] Active but no people/open opportunities; next review scheduled');
        result.alreadyRouted++;
      } else if (orgPursuitRouteExists(orgId)) {
        appendNoteFlag(sheet, row, COLS.ORGS.NOTES, '[active-empty] Active but no people/open opportunities; pursuit route already open');
        result.alreadyRouted++;
      } else {
        var routeId = appendOrgReviewDecision(orgId, orgName, status);
        appendNoteFlag(sheet, row, COLS.ORGS.NOTES, routeId ? '[active-empty] Active but no people/open opportunities; review decision queued' : '[active-empty] Active but no people/open opportunities; review route already open');
        if (routeId) result.tasksCreated++;
        else result.alreadyRouted++;
      }
    } else {
      clearNoteFlag(sheet, row, COLS.ORGS.NOTES, '[active-empty]');
    }
  }
  return result;
}

// v7.6.3 §4.3: manual row deletion never fires onEdit, so People/Jobs/
// Tasks/Decisions can keep pointing at an Organisation ID that no longer
// exists. Flagging only — never recreates the Organisation, never
// deletes or relinks the child row.
function checkOrgOrphans() {
  var orgSheet = getSheet('Organisations');
  if (!orgSheet) return 0;
  var count = 0;
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
        count++;
      } else {
        clearNoteFlag(sheet, row, notesCol, '[orphaned-org]');
      }
    }
  }

  sweep(getSheet('People'), COLS.PEOPLE.ORG_ID, COLS.PEOPLE.NOTES);
  sweep(getSheet('Jobs'), COLS.JOBS.ORG_ID, COLS.JOBS.NOTES);
  sweep(getSheet('Tasks'), COLS.TODO.OBJ_ID, COLS.TODO.NOTES, COLS.TODO.OBJ_TYPE, 'Organisation');
  sweep(getSheet('Decisions'), COLS.DECISIONS.TARGET_ID, COLS.DECISIONS.NOTES, COLS.DECISIONS.TARGET_TYPE, 'Organisation');
  return count;
}

// =============================================================
// "ADD NEW" ESCAPE HATCHES — quick capture without opening Today
// =============================================================

function addNewSector() {
  runCapturePopup('Explore sectors');
}

function addExplorationOrganisations() {
  runCapturePopup('Find organisations');
}

function addNewOrganisation() {
  runCapturePopup('Add/update organisation');
}

function addNewInterview() {
  runCapturePopup('Add/update interview');
}

function addNewPerson() {
  runCapturePopup('Add/update person');
}

function addNewJob() {
  runCapturePopup('Add/update job');
}

function addNewInteraction() {
  runCapturePopup('Add/update conversation');
}

function addAdHocTodo() {
  var ui = SpreadsheetApp.getUi();
  var resp = ui.prompt('Add one-off task', 'What do you need to do?', ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  var task = resp.getResponseText().trim();
  if (!task) { ui.alert('Task description required.', ui.ButtonSet.OK); return; }
  withDocumentLock(function () {
    appendTodoWithSource(task, 'None', '', '', 'Admin', 'Not started', '', '30 min', '', 'Manually added');
    refreshDerivedPlanningSurfaces();
    requestHomeRefresh();
  }, { label: 'addAdHocTodo' });
  SpreadsheetApp.getActiveSpreadsheet().toast('One-off task added. Today and Home were refreshed.', 'The Planner', 4);
}

// =============================================================
// ROW ACTIONS — explicit, deliberate next steps (not auto-fired)
// =============================================================

function rowActionFindPeopleAtSelectedOrg() {
  var sheet = SpreadsheetApp.getActiveSheet();
  if (sheet.getName() !== 'Organisations') { SpreadsheetApp.getUi().alert('Select an Organisation row first.'); return; }
  var row = sheet.getActiveRange().getRow(); if (row <= 1) return;
  withDocumentLock(function () {
    appendTodoWithSource('Find people at: ' + sheet.getRange(row, COLS.ORGS.NAME).getValue(), 'Organisation', sheet.getRange(row, COLS.ORGS.ID).getValue(), sheet.getRange(row, COLS.ORGS.NAME).getValue(), 'People sourcing', 'Not started', '', '30 min', '', 'Manually added');
    refreshDerivedPlanningSurfaces();
    requestHomeRefresh();
  }, { label: 'rowActionFindPeopleAtSelectedOrg' });
}

function rowActionStartPursuingSelectedOrg() {
  var sheet = SpreadsheetApp.getActiveSheet();
  if (sheet.getName() !== 'Organisations') { SpreadsheetApp.getUi().alert('Select an Organisation row first.'); return; }
  var row = sheet.getActiveRange().getRow(); if (row <= 1) return;
  withDocumentLock(function () {
    var orgId = sheet.getRange(row, COLS.ORGS.ID).getValue();
    var orgName = sheet.getRange(row, COLS.ORGS.NAME).getValue();
    if (!orgId || !orgName) {
      SpreadsheetApp.getUi().alert('Select an Organisation row with an Org ID and name.');
      return;
    }
    sheet.getRange(row, COLS.ORGS.STATUS).setValue('Active');
    scheduleOrgReviewForRow(sheet, row, 'Active', { stampLastChecked: true });
    ensureOrgClassificationState(row);
    fireOrgActiveCascade(orgId, orgName);
    renderTodayDecisionCards();
    refreshDerivedPlanningSurfaces();
    requestHomeRefresh();
    SpreadsheetApp.getActiveSpreadsheet().toast('Organisation is Active. People/job-scan decisions are queued on Home.', 'The Planner', 5);
  }, { label: 'rowActionStartPursuingSelectedOrg' });
}

function rowActionScanJobsAtSelectedOrg() {
  var sheet = SpreadsheetApp.getActiveSheet();
  if (sheet.getName() !== 'Organisations') { SpreadsheetApp.getUi().alert('Select an Organisation row first.'); return; }
  var row = sheet.getActiveRange().getRow(); if (row <= 1) return;
  withDocumentLock(function () {
    appendTodoWithSource('Scan jobs at: ' + sheet.getRange(row, COLS.ORGS.NAME).getValue(), 'Organisation', sheet.getRange(row, COLS.ORGS.ID).getValue(), sheet.getRange(row, COLS.ORGS.NAME).getValue(), 'Org job scan', 'Not started', '', '30 min', '', 'Manually added');
    refreshDerivedPlanningSurfaces();
    requestHomeRefresh();
  }, { label: 'rowActionScanJobsAtSelectedOrg' });
}

function ensureJobRowActionContext(sheet, row) {
  var ui = SpreadsheetApp.getUi();
  var title = String(sheet.getRange(row, COLS.JOBS.OPPORTUNITY).getValue() || '').trim();
  if (!title) {
    ui.alert('Add the Opportunity first', 'Type the job/opportunity title in this row before using Job row actions.', ui.ButtonSet.OK);
    return null;
  }
  var org = String(sheet.getRange(row, COLS.JOBS.ORG).getValue() || '').trim();
  if (!org) {
    ui.alert('Add the Organisation next', 'Add Organisation on this Job row before routing tasks or interview rounds.', ui.ButtonSet.OK);
    return null;
  }
  var id = String(sheet.getRange(row, COLS.JOBS.ID).getValue() || '').trim();
  if (!id) {
    id = nextId(sheet, COLS.JOBS.ID, 'JOB');
    sheet.getRange(row, COLS.JOBS.ID).setValue(id);
  }
  if (!sheet.getRange(row, COLS.JOBS.STATUS).getValue()) sheet.getRange(row, COLS.JOBS.STATUS).setValue('Not started');
  inheritOrgFields(sheet, row, COLS.JOBS.ORG, COLS.JOBS.ORG_ID);
  org = String(sheet.getRange(row, COLS.JOBS.ORG).getValue() || '').trim();
  var orgId = String(sheet.getRange(row, COLS.JOBS.ORG_ID).getValue() || '').trim();
  if (!orgId) {
    ui.alert('Organisation could not be linked', 'Check the Organisation value, then try the row action again.', ui.ButtonSet.OK);
    return null;
  }
  return {
    id: id,
    title: title,
    org: org,
    orgId: orgId,
    status: normalizeJobStatus(sheet.getRange(row, COLS.JOBS.STATUS).getValue() || 'Not started'),
    deadline: sheet.getRange(row, COLS.JOBS.DEADLINE).getValue()
  };
}

function rowActionPrepSelectedJob() {
  var sheet = SpreadsheetApp.getActiveSheet();
  if (sheet.getName() !== 'Jobs') { SpreadsheetApp.getUi().alert('Select a Job row first.'); return; }
  var row = sheet.getActiveRange().getRow(); if (row <= 1) return;
  withDocumentLock(function () {
    var job = ensureJobRowActionContext(sheet, row);
    if (!job) return;
    setJobStatus(job.id, 'In progress', { source: 'row-action-prep' });
    promoteOrgForLiveJob(job.orgId, 'In progress');
    refreshDerivedPlanningSurfaces();
    requestHomeRefresh();
  }, { label: 'rowActionPrepSelectedJob' });
}

function rowActionReferralSearchSelectedJob() {
  var sheet = SpreadsheetApp.getActiveSheet();
  if (sheet.getName() !== 'Jobs') { SpreadsheetApp.getUi().alert('Select a Job row first.'); return; }
  var row = sheet.getActiveRange().getRow(); if (row <= 1) return;
  withDocumentLock(function () {
    var job = ensureJobRowActionContext(sheet, row);
    if (!job) return;
    setJobStatus(job.id, 'In progress', { source: 'row-action-referral' });
    promoteOrgForLiveJob(job.orgId, 'In progress');
    appendTodoWithSource('Find referral contact: ' + job.title + ' at ' + job.org, 'Job', job.id, job.org, 'Referral search', 'Not started',
      applicationPlanDueDate(job), '30 min', 'When done, the planner asks whether to link someone or close without a referral. Submit is not blocked.', 'Manually added');
    refreshDerivedPlanningSurfaces();
    requestHomeRefresh();
  }, { label: 'rowActionReferralSearchSelectedJob' });
}

function rowActionSearchOrgsForSubsector() {
  var sheet = SpreadsheetApp.getActiveSheet();
  if (sheet.getName() !== 'Sectors') { SpreadsheetApp.getUi().alert('Select a Sectors row first.'); return; }
  var row = sheet.getActiveRange().getRow(); if (row <= 1) return;
  var sector = sheet.getRange(row, COLS.SECTORS.SECTOR).getValue();
  var sub = sheet.getRange(row, COLS.SECTORS.SUBSECTOR).getValue();
  if (!sector || !sub) { SpreadsheetApp.getUi().alert('Select a row with a Sector and Sub-sector.'); return; }
  withDocumentLock(function () {
    var branch = upsertSectorBranch({ sector: sector, subsector: sub, source: 'manual_sheet_entry', preferredRow: row, createExpansionDecision: false });
    if (!branch || !branch.id) return;
    var hadPending = !!findPendingDecisionByKey('EXPAND_SUBSECTOR:' + branch.id);
    if (fireSubsectorAddedDecision(branch.sector, branch.subsector, branch.id, { allowAfterResolved: true })) {
      renderTodayDecisionCards();
      requestHomeRefresh();
      SpreadsheetApp.getActiveSpreadsheet().toast(hadPending ? 'Market-map decision is already in the queue.' : 'Market-map decision queued on Home.', 'The Planner', 4);
    } else {
      SpreadsheetApp.getActiveSpreadsheet().toast('No market-map decision was queued. Check the selected sub-sector row.', 'The Planner', 5);
    }
  }, { label: 'rowActionSearchOrgsForSubsector' });
}

function rowActionBreakDownSelectedSector() {
  var sheet = SpreadsheetApp.getActiveSheet();
  if (sheet.getName() !== 'Sectors') { SpreadsheetApp.getUi().alert('Select a Sectors row first.'); return; }
  var row = sheet.getActiveRange().getRow(); if (row <= 1) return;
  var sector = sheet.getRange(row, COLS.SECTORS.SECTOR).getValue();
  if (!sector) return;
  withDocumentLock(function () {
    var branch = sectorBranchFromRow(row, sheet.getRange(row, 1, 1, HEADERS.Sectors.length).getValues()[0]);
    if (branch.isSectorOnly) branch = ensureSectorBranchId(sheet, branch);
    else branch = ensureSectorOnlyBranch(branch.sector || sector, 'manual_sheet_entry');
    if (fireSectorOnlyTask(branch)) {
      populateToday();
      requestHomeRefresh();
      SpreadsheetApp.getActiveSpreadsheet().toast('Sub-sector entry task queued on Today.', 'The Planner', 4);
    } else {
      SpreadsheetApp.getActiveSpreadsheet().toast('Sub-sector entry task already exists or is in progress.', 'The Planner', 4);
    }
  }, { label: 'rowActionBreakDownSelectedSector' });
}

function rowActionAddInterviewRound() {
  var sheet = SpreadsheetApp.getActiveSheet();
  if (sheet.getName() !== 'Jobs') { SpreadsheetApp.getUi().alert('Select a Job row first.'); return; }
  var row = sheet.getActiveRange().getRow(); if (row <= 1) return;
  withDocumentLock(function () {
    var job = ensureJobRowActionContext(sheet, row);
    if (!job) return;
    createInterviewRoundForJob(job.id, {});
    refreshDerivedPlanningSurfaces();
    requestHomeRefresh();
  }, { label: 'rowActionAddInterviewRound' });
}

function rowActionPlanPrepForSelectedInterview() {
  var sheet = SpreadsheetApp.getActiveSheet();
  if (sheet.getName() !== 'Interviews') { SpreadsheetApp.getUi().alert('Select an Interview row first.'); return; }
  var row = sheet.getActiveRange().getRow(); if (row <= 1) return;
  var roundId = String(sheet.getRange(row, COLS.ROUNDS.ID).getValue() || '');
  if (!roundId) { SpreadsheetApp.getUi().alert('That row does not have a Round ID. Add the interview from Jobs or Home first.'); return; }
  var todoId = '';
  withDocumentLock(function () {
    todoId = createInterviewPrepPlanningTask(roundId);
    refreshDerivedPlanningSurfaces();
    requestHomeRefresh();
  }, { label: 'rowActionPlanPrepForSelectedInterview' });
  runInterviewPrepPlanPopup(roundId, todoId);
}

// v7.4 §4.2 — Multi-day Phase 2: break a Multi-day Task into real
// sub-tasks via the dormant Parent To-do ID hook, rather than
// special-casing Multi-day around the waterfall permanently.
function rowActionBreakDownSelectedTask() {
  var sheet = SpreadsheetApp.getActiveSheet();
  if (sheet.getName() !== 'Tasks') { SpreadsheetApp.getUi().alert('Select a Task row first.'); return; }
  var row = sheet.getActiveRange().getRow(); if (row <= 1) return;
  var todoId = String(sheet.getRange(row, COLS.TODO.ID).getValue() || '');
  if (!todoId) { SpreadsheetApp.getUi().alert('That row does not have a Task ID.'); return; }
  var status = String(sheet.getRange(row, COLS.TODO.STATUS).getValue() || '');
  if (!isOpenTodoStatus(status)) { SpreadsheetApp.getUi().alert('Only open tasks can be made multi-step.'); return; }
  runBreakdownPopup(todoId, String(sheet.getRange(row, COLS.TODO.TASK).getValue() || ''));
}

function runBreakdownPopup(todoId, taskTitle) {
  var html = HtmlService.createHtmlOutput(buildBreakdownHtml(todoId, taskTitle)).setWidth(640).setHeight(680).setTitle('Make multi-step: ' + taskTitle);
  SpreadsheetApp.getUi().showModalDialog(html, 'Make multi-step: ' + taskTitle);
}

function buildBreakdownHtml(todoId, taskTitle) {
  var json = JSON.stringify({ todoId: todoId, taskTitle: taskTitle, timeOptions: DROPDOWNS.TODO_TIME.filter(function (t) { return t !== 'Multi-day'; }) });
  return '' +
    '<style>' +
    'body{font-family:Arial,sans-serif;padding:22px;color:#28251D;background:#FBFBF9;}' +
    'h2{margin:0 0 8px;color:#1B474D;font-size:20px;}p{color:#5F625E;font-size:13px;margin:6px 0 14px;}' +
    '.meta{display:grid;grid-template-columns:1fr 150px;gap:8px;margin:14px 0;}' +
    '.row{display:grid;grid-template-columns:1fr 120px 70px;gap:8px;margin-top:10px;}' +
    '.notes{grid-column:1/4;}input,select{box-sizing:border-box;padding:9px;border:1px solid #D8DAD4;border-radius:5px;font-size:13px;min-width:0;}' +
    '.primary{margin-top:18px;padding:10px 14px;border:0;border-radius:5px;background:#01696F;color:#FFF;font-weight:bold;cursor:pointer;}' +
    '#status{font-size:12px;color:#5F625E;margin-top:10px;}</style>' +
    '<h2>Make multi-step: <span id="title"></span></h2>' +
    '<p>Add up to 6 child tasks. The parent stays as a container; ready child tasks flow through Today.</p>' +
    '<div class="meta"><input id="category" placeholder="Plan category"><select id="pattern"><option>Step-based</option><option>Parallel</option></select></div>' +
    '<form id="form"></form><button class="primary" type="button" onclick="submitBreakdown()">Create child tasks</button><div id="status"></div>' +
    '<script>var cfg=' + json + ';document.getElementById("title").textContent=cfg.taskTitle;var f=document.getElementById("form");' +
    'for(var i=0;i<6;i++){var r=document.createElement("div");r.className="row";var t=document.createElement("input");t.type="text";t.placeholder="Child task "+(i+1);t.name="text"+i;var s=document.createElement("select");s.name="time"+i;cfg.timeOptions.forEach(function(v){var o=document.createElement("option");o.value=v;o.textContent=v;s.appendChild(o);});var step=document.createElement("input");step.type="number";step.min="1";step.value=i+1;step.name="step"+i;var notes=document.createElement("input");notes.type="text";notes.placeholder="Optional notes";notes.name="notes"+i;notes.className="notes";r.appendChild(t);r.appendChild(s);r.appendChild(step);r.appendChild(notes);f.appendChild(r);}' +
    'function submitBreakdown(){var subtasks=[];for(var i=0;i<6;i++){var text=f.elements["text"+i].value.trim();if(!text)continue;subtasks.push({text:text,timeEst:f.elements["time"+i].value,step:f.elements["step"+i].value||1,notes:f.elements["notes"+i].value.trim()});}if(!subtasks.length){document.getElementById("status").textContent="Add at least one child task.";return;}document.getElementById("status").textContent="Creating child tasks...";google.script.run.withSuccessHandler(function(msg){document.getElementById("status").textContent=msg||"Done.";setTimeout(function(){google.script.host.close();},900);}).withFailureHandler(function(err){document.getElementById("status").textContent="Could not create child tasks. Run Maintenance > Repair all tabs, then try again.";}).completeBreakdownFromPopup(cfg.todoId,{category:document.getElementById("category").value.trim()||cfg.taskTitle,pattern:document.getElementById("pattern").value,children:subtasks});}</script>';
}

function completeBreakdownFromPopup(parentTodoId, payload) {
  return withDocumentLock(function () {
    return completeBreakdownFromPopupImpl(parentTodoId, payload);
  }, { label: 'completeBreakdownFromPopup' });
}

function completeBreakdownFromPopupImpl(parentTodoId, payload) {
  var parent = getTodoById(parentTodoId);
  if (!parent) return 'Parent task not found.';
  var subtasks = (payload && payload.children) ? payload.children : (payload || []);
  var category = (payload && payload.category) || parent.task;
  var pattern = (payload && payload.pattern) || 'Step-based';
  var childDueDate = parent.dueDate || '';
  if (DROPDOWNS.TODO_PLAN_PATTERN.indexOf(pattern) === -1) pattern = 'Step-based';
  parent.sheet.getRange(parent.row, COLS.TODO.PLAN_CATEGORY).setValue(category);
  parent.sheet.getRange(parent.row, COLS.TODO.PLAN_PATTERN).setValue(pattern);
  var createdIds = [];
  subtasks.forEach(function (st) {
    if (!st.text) return;
    var id = appendTodoWithSource(
      st.text, parent.objType, parent.objId, parent.org, parent.workflow,
      'Not started', childDueDate, st.timeEst || defaultTimeForWorkflow(parent.workflow),
      '', 'Manually added', { skipDuplicateCheck: true }
    );
    if (id) {
      var s = getSheet('Tasks');
      var r = getTodoById(id).row;
      s.getRange(r, COLS.TODO.PARENT_ID).setValue(parentTodoId);
      s.getRange(r, COLS.TODO.PLAN_CATEGORY).setValue(category);
      s.getRange(r, COLS.TODO.STEP).setValue(pattern === 'Parallel' ? 1 : (parseInt(st.step, 10) || 1));
      if (st.notes) s.getRange(r, COLS.TODO.NOTES).setValue(st.notes);
      createdIds.push(id);
    }
  });
  if (!createdIds.length) return 'No sub-tasks captured.';
  appendNoteFlag(parent.sheet, parent.row, COLS.TODO.NOTES, '[has-subtasks] structured into ' + createdIds.length + ' child task(s)');
  syncTaskPlanningHelpers();
  populateToday();
  refreshHome();
  return 'Created ' + createdIds.length + ' child task(s). Parent now acts as a container.';
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
  withDocumentLock(function () {
    var existing = sheet.getRange(row, COLS.JOBS.CONTACTS_IDS).getValue();
    writeLinkedContactIdsForJobRow(sheet, row, parseLinkedContactIds(existing).concat(newIds));
    refreshLinkedContactsDisplay();
    syncPeopleHelperColumns();
  }, { label: 'linkContactToJob' });
}

function refreshLinkedContactsDisplay() {
  var jobsSheet = getSheet('Jobs'), peopleSheet = getSheet('People');
  if (!jobsSheet || !peopleSheet) return;
  var bodyRows = Math.max(jobsSheet.getMaxRows() - 1, 1);
  jobsSheet.getRange(2, COLS.JOBS.CONTACTS_DISPLAY, bodyRows, 1).clearContent().clearNote().clearDataValidations();
  if (jobsSheet.getLastRow() < 2) return;
  var peopleById = {};
  if (peopleSheet.getLastRow() > 1) {
    var peopleData = peopleSheet.getRange(2, 1, peopleSheet.getLastRow() - 1, HEADERS.People.length).getValues();
    peopleData.forEach(function (p) {
      var id = String(p[COLS.PEOPLE.ID - 1] || '');
      if (!id) return;
      peopleById[id] = {
        name: String(p[COLS.PEOPLE.NAME - 1] || ''),
        orgId: String(p[COLS.PEOPLE.ORG_ID - 1] || ''),
        org: String(p[COLS.PEOPLE.ORG - 1] || '')
      };
    });
  }
  var jobData = jobsSheet.getRange(2, 1, jobsSheet.getLastRow() - 1, HEADERS.Jobs.length).getValues();
  for (var i = 0; i < jobData.length; i++) {
    var r = i + 2;
    var ids = uniqueLinkedContactIds(parseLinkedContactIds(jobData[i][COLS.JOBS.CONTACTS_IDS - 1]));
    if (!ids.length) {
      clearNoteFlag(jobsSheet, r, COLS.JOBS.NOTES, '[orphaned-contact]');
      clearNoteFlag(jobsSheet, r, COLS.JOBS.NOTES, '[contact-org-mismatch]');
      continue;
    }
    var idsRaw = String(jobData[i][COLS.JOBS.CONTACTS_IDS - 1] || '');
    if (ids.join(', ') !== idsRaw) jobsSheet.getRange(r, COLS.JOBS.CONTACTS_IDS).setValue(ids.join(', '));
    var names = [], missing = [], mismatch = [];
    var jobOrgId = String(jobData[i][COLS.JOBS.ORG_ID - 1] || '');
    ids.forEach(function (id) {
      var person = peopleById[id];
      if (!person) {
        missing.push(id);
        return;
      }
      names.push(person.name || id);
      if (jobOrgId && person.orgId && String(person.orgId) !== jobOrgId) mismatch.push(person.name || id);
    });
    jobsSheet.getRange(r, COLS.JOBS.CONTACTS_DISPLAY).setValue(names.join(', '));
    if (missing.length) appendNoteFlag(jobsSheet, r, COLS.JOBS.NOTES, '[orphaned-contact] Linked person ID not found: ' + missing.join(', '));
    else clearNoteFlag(jobsSheet, r, COLS.JOBS.NOTES, '[orphaned-contact]');
    if (mismatch.length) appendNoteFlag(jobsSheet, r, COLS.JOBS.NOTES, '[contact-org-mismatch] Linked contact belongs to another organisation: ' + mismatch.join(', '));
    else clearNoteFlag(jobsSheet, r, COLS.JOBS.NOTES, '[contact-org-mismatch]');
  }
}

function logInteractionForRow() {
  var sheet = SpreadsheetApp.getActiveSheet();
  var name = sheet.getName();
  var row = sheet.getActiveRange().getRow();
  if (row <= 1 || (name !== 'People' && name !== 'Jobs')) { SpreadsheetApp.getUi().alert('Select a data row in People or Jobs.'); return; }
  var defaults = { date: formatDateHuman(today()), status: 'Completed' };
  if (name === 'People') {
    defaults.person = sheet.getRange(row, COLS.PEOPLE.NAME).getValue();
    defaults.org = sheet.getRange(row, COLS.PEOPLE.ORG).getValue();
  } else {
    defaults.org = sheet.getRange(row, COLS.JOBS.ORG).getValue();
    var contactIds = parseLinkedContactIds(sheet.getRange(row, COLS.JOBS.CONTACTS_IDS).getValue());
    if (contactIds.length === 1) {
      var contact = getPersonRowById(contactIds[0]);
      if (contact) defaults.person = contact.name || '';
    }
  }
  runCapturePopup('Add/update conversation', '', defaults);
}

function softCloseRow() {
  var sheet = SpreadsheetApp.getActiveSheet();
  var row = sheet.getActiveRange().getRow(); if (row <= 1) return;
  if (sheet.getName() !== 'People' && sheet.getName() !== 'Jobs') { SpreadsheetApp.getUi().alert('Select a row in People or Jobs to close.'); return; }
  withDocumentLock(function () {
    if (sheet.getName() === 'People') {
      closePerson(sheet.getRange(row, COLS.PEOPLE.ID).getValue(), 'Closed from row action.');
      SpreadsheetApp.getActiveSpreadsheet().toast('Person closed. Open follow-up work was cancelled.', 'The Planner', 4);
    } else {
      setJobStatus(sheet.getRange(row, COLS.JOBS.ID).getValue(), 'Closed', {});
      SpreadsheetApp.getActiveSpreadsheet().toast('Job closed. Open application work was cancelled.', 'The Planner', 4);
    }
    refreshDerivedPlanningSurfaces();
    requestHomeRefresh();
  }, { label: 'softCloseRow' });
}

// v7.6 §5: prompts for a reason, appends [blocked] <reason> to Notes. No
// schema change — surfaced via the Home aggregate count and the §2.6
// flagged-row highlight (the highlight regex already includes "blocked").
function rowActionMarkTaskBlocked() {
  var sheet = SpreadsheetApp.getActiveSheet();
  if (sheet.getName() !== 'Tasks' && sheet.getName() !== 'Today') { SpreadsheetApp.getUi().alert('Select a Task row or Today row first.'); return; }
  var row = sheet.getActiveRange().getRow(); if (row <= 1) return;
  var ui = SpreadsheetApp.getUi();
  var resp = ui.prompt('Mark blocked', 'Why is this task blocked?', ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  var reason = resp.getResponseText().trim();
  if (!reason) { ui.alert('Enter a reason.'); return; }
  var unblockerResp = ui.prompt('Optional unblocker task', 'Add an unblocker task title, or leave blank for none.', ui.ButtonSet.OK_CANCEL);
  if (unblockerResp.getSelectedButton() !== ui.Button.OK) return;
  var unblockerTitle = unblockerResp.getResponseText().trim();
  withDocumentLock(function () {
    var todo = null;
    if (sheet.getName() === 'Tasks') todo = getTodoByRow(sheet, row);
    else {
      var todoId = String(sheet.getRange(row, COLS.TODAY.TODO_ID).getValue() || '');
      todo = getTodoById(todoId);
    }
    if (!todo) { SpreadsheetApp.getUi().alert('Could not find the linked Task.'); return; }
    todo.sheet.getRange(todo.row, COLS.TODO.STATUS).setValue('Blocked');
    todo.sheet.getRange(todo.row, COLS.TODO.BLOCKER).setValue(reason);
    todo.sheet.getRange(todo.row, COLS.TODO.COMPLETED).setValue('');
    todo.sheet.getRange(todo.row, COLS.TODO.LAST_EDITED).setValue(today());
    appendNoteFlag(todo.sheet, todo.row, COLS.TODO.NOTES, '[blocked] ' + reason);
    if (unblockerTitle) {
      var unblockerId = appendTodoWithSource(unblockerTitle, todo.objType, todo.objId, todo.org, 'Task unblocker',
        'Not started', '', '15 min', '[unblocks: ' + todo.id + '] ' + reason, 'Manually added', { skipDuplicateCheck: true });
      if (unblockerId) todo.sheet.getRange(todo.row, COLS.TODO.BLOCKED_BY_ID).setValue(unblockerId);
    }
    syncTaskPlanningHelpers();
    populateToday();
    refreshHome();
  }, { label: 'rowActionMarkTaskBlocked' });
}

function rowActionUnblockSelectedTask() {
  var sheet = SpreadsheetApp.getActiveSheet();
  if (sheet.getName() !== 'Tasks' && sheet.getName() !== 'Today') { SpreadsheetApp.getUi().alert('Select a Task row or Today row first.'); return; }
  var row = sheet.getActiveRange().getRow(); if (row <= 1) return;
  withDocumentLock(function () {
    var todo = null;
    if (sheet.getName() === 'Tasks') todo = getTodoByRow(sheet, row);
    else todo = getTodoById(String(sheet.getRange(row, COLS.TODAY.TODO_ID).getValue() || ''));
    if (!todo) { SpreadsheetApp.getUi().alert('Could not find the linked Task.'); return; }
    todo.sheet.getRange(todo.row, COLS.TODO.STATUS).setValue('Not started');
    todo.sheet.getRange(todo.row, COLS.TODO.BLOCKER).setValue('');
    todo.sheet.getRange(todo.row, COLS.TODO.BLOCKED_BY_ID).setValue('');
    todo.sheet.getRange(todo.row, COLS.TODO.COMPLETED).setValue('');
    todo.sheet.getRange(todo.row, COLS.TODO.LAST_EDITED).setValue(today());
    appendNoteFlag(todo.sheet, todo.row, COLS.TODO.NOTES, '[unblocked manually]');
    syncTaskPlanningHelpers();
    populateToday();
    refreshHome();
  }, { label: 'rowActionUnblockSelectedTask' });
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
  withDocumentLock(function () {
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
  }, { label: 'rowActionDeferSelectedTask' });
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
  sheet.getRange(r, 2).setValue('The Planner - Guide').setFontSize(16).setFontWeight('bold').setFontColor('#1B474D'); r += 2;

  r = writeH2(sheet, r, 'Start here (once)');
  r = writeKV(sheet, r, '1. Turn it on', 'Run The Planner > Triggers & setup > Set up / verify triggers. This makes dropdowns, popups, checkboxes, and daily refreshes respond.');
  r = writeKV(sheet, r, '2. Add your starting facts', 'Use The Planner > Start or redo setup. Pick the closest starting point: interviews, applications, jobs, people, organisations, sectors, or not sure.');
  r = writeKV(sheet, r, '3. Let the planner build the work', 'Saving setup writes the right rows and creates the next follow-up tasks or decisions.');
  r = writeKV(sheet, r, '4. Work from Home and Today', 'Home is for capture and judgment. Today is for doing. The data tabs are there when you need to inspect or repair details.');
  r++;

  r = writeH2(sheet, r, 'Your daily 10 minutes');
  r = writeKV(sheet, r, '1. Open Home', 'Resolve any Pending Decisions. Yes creates the suggested task, opens the relevant popup, or routes the capture/update shown on the card. No dismisses it.');
  r = writeKV(sheet, r, '2. Capture what changed', 'Use Capture update on Home for new jobs, people, conversations, interviews, organisations, or sectors.');
  r = writeKV(sheet, r, '3. Refresh Today', "Use Today > Build / refresh Today's plan if the plan has not already refreshed.");
  r = writeKV(sheet, r, '4. Do the work on Today', 'Mark work In progress, Blocked, Done, Deferred, Skipped, or Pull in an option directly from Today.');
  r = writeKV(sheet, r, '5. End the day', 'Use the End of day checkbox on Today when you want to carry, defer, block, or skip unfinished work.');
  r++;

  r = writeH2(sheet, r, 'How adding things works');
  r = writeKV(sheet, r, 'Use Home first', 'The Capture update popup is the easiest path. It writes the source tab, links IDs, and refreshes Today for you.');
  r = writeKV(sheet, r, 'You can still type in tabs', 'If you type directly into Jobs or People, fill Organisation too. Without an Organisation, the row is saved but the follow-up work waits until the Organisation is filled.');
  r = writeKV(sheet, r, 'Typing into Sectors', 'For a broad area, fill Sector and leave Sub-sector blank. For a narrower area, add a new row with the same Sector and fill Sub-sector.');
  r = writeKV(sheet, r, 'Cream and grey cells', 'Cream cells are yours to edit. Grey cells are filled in and kept up to date by the planner.');
  r = writeKV(sheet, r, 'Organisation links', 'Type an organisation name on a Job or Person. The planner finds or creates the Organisation and fills the ID behind the scenes.');
  r++;

  r = writeH2(sheet, r, 'What each tab is for');
  r = writeKV(sheet, r, 'Home', 'Start here. Capture updates, resolve Pending Decisions, see what needs attention.');
  r = writeKV(sheet, r, 'Today', 'Do the work here. It is rebuilt from Tasks, but your notes and locked/pulled rows are preserved.');
  r = writeKV(sheet, r, 'Decisions', 'Judgment queue and audit trail. Action type shows what Yes will do; Review by controls urgency.');
  r = writeKV(sheet, r, 'Tasks', 'Master task queue. Usually inspect or repair here, not daily capture.');
  r = writeKV(sheet, r, 'Sectors / Organisations / Jobs / People', 'The main source tabs. Home popups write here for you.');
  r = writeKV(sheet, r, 'Conversations / Interviews', 'Mostly filled from updates and task completions. Edit when you need to correct details.');
  r++;

  r = writeH2(sheet, r, 'How Today decides');
  r = writeKV(sheet, r, 'Fixed order, not a mystery score', 'It works down a fixed order: things you pinned or pulled in, work already in progress, hard deadlines, work blocking other work, follow-ups that are due, active pursuit matching your focus, pipeline-building work, then anything else that fits.');
  r = writeKV(sheet, r, 'Capacity matters', 'Today keeps a time buffer on normal days and says when the plan is realistic, tight, or over capacity. The headline separates the Minimum day from the recommended plan. Near-misses appear as Options.');
  r = writeKV(sheet, r, 'Tier and energy', 'Organisation Tier breaks ties. Low energy pushes deep work lower, but does not delete it.');
  r = writeKV(sheet, r, 'Why a task appears', 'Today shows compact tags like [Fixed], [Focus], [Pipeline], [Spare], or [Pulled]. Hover the notes cell for the full reason.');
  r = writeKV(sheet, r, 'Multi-day work', 'Multi-day tasks stay out of Today until you make them multi-step from Tasks > Row actions > Make selected Task multi-step.');
  r = writeKV(sheet, r, 'Source-led scans', 'Opportunity scan and People source scan are flexible pipeline-building tasks. When completed, they ask what you found; people found this way are saved as Identified, not automatic outreach.');
  r = writeKV(sheet, r, 'Interview prep', 'Scheduled interviews create one Plan interview prep task. Completing it opens the prep popup and creates parent/child prep tasks; Today shows only ready child work.');
  r++;

  r = writeH2(sheet, r, 'The status labels');
  r = writeKV(sheet, r, 'Jobs', 'Application status: Not started > In progress > Submitted > Closed. Result is Waiting, Interview invite, or Rejected.');
  r = writeKV(sheet, r, 'People', 'Relationship status runs from Identified to outreach, reply, conversation, keep-warm, or closed. Conversations are logged on the Conversations tab.');
  r = writeKV(sheet, r, 'Tasks', 'Not started / In progress / Blocked / Done / Skipped / Cancelled. Today shows selected Not started work as Planned.');
  r = writeKV(sheet, r, 'Interviews', 'To schedule / Scheduled / Completed / Reschedule / Cancelled. Official outcome is Waiting / Next round / Declined / Offer / Parked.');
  r = writeKV(sheet, r, 'Interview outcomes', 'Waiting creates follow-up work. Next round creates the next round. Declined and Parked close the job; Offer creates offer-decision work.');
  r = writeKV(sheet, r, 'Decisions', 'Pending / Yes / No / Auto-dismissed. Auto-dismissed means the underlying situation changed. Review by is the decision urgency date.');
  r++;

  r = writeH2(sheet, r, 'Good to know');
  r = writeKV(sheet, r, 'Hidden columns', 'IDs and helper dates are hidden by default. Use The Planner > Maintenance > Show hidden columns when you need to inspect them.');
  r = writeKV(sheet, r, 'Sectors', 'A parent Sector row names the broad area. A Sub-sector row belongs to that Sector ID. Editing Sector on a parent row renames it; editing Sector on a Sub-sector row moves that child under another sector.');
  r = writeKV(sheet, r, 'Direct edits are allowed', 'They are best for corrections. For normal daily capture, Home is easier and safer.');
  r = writeKV(sheet, r, 'Deferred is Today-only', 'Deferring from Today pushes the due date. Tasks itself does not have a Deferred status.');
  r = writeKV(sheet, r, 'Row actions', 'Tasks has row actions for multi-step planning, blocking, unblocking, and deferring. Today has row actions for pulling, locking, moving, and topping up the day.');
  r = writeKV(sheet, r, 'Colour cues', 'Colours help scanning, but the actual status text is always the source of truth.');
  r = writeKV(sheet, r, 'Tasks and Decisions columns', 'Tasks owns executable work and readiness. Decisions owns judgment, Review by, Action type, Linked to, and Result. Home shows the front of that queue.');
  r++;

  r = writeH2(sheet, r, 'If something breaks');
  r = writeKV(sheet, r, 'Menu missing', 'Extensions > Apps Script > run onOpen. Reload the sheet.');
  r = writeKV(sheet, r, 'Popups not opening', 'Run The Planner > Triggers & setup > Set up / verify triggers (one-time, grants full authorization for modal dialogs).');
  r = writeKV(sheet, r, 'Home not refreshing', 'Use The Planner > Refresh Home, or tick the refresh checkbox on Home.');
  r = writeKV(sheet, r, 'Today looks stale', "Use The Planner > Today > Build / refresh Today's plan.");
  r = writeKV(sheet, r, 'Formatting looks off', 'Use The Planner > Maintenance > Repair all tabs.');
  r = writeKV(sheet, r, 'Broken source link', 'Tasks with [no-link], [orphaned-link], [orphaned-sector], or [orphaned-org] stay out of Today until the linked source row is repaired.');
  r = writeKV(sheet, r, 'A row is not routing', 'Check whether required fields are missing, especially Organisation on Jobs and People. Notes may show a [pending-org] or review flag.');
  r++;

  sheet.getRange(r, 2).setValue('Version').setFontSize(12).setFontWeight('bold').setFontColor('#7A7974'); r++;
  sheet.getRange(r, 2).setValue('Code.gs ' + SCRIPT_VERSION + ' - Google Sheet only - No external dependencies').setFontSize(10).setFontColor('#7A7974').setFontStyle('italic');
}

// =============================================================
// REPAIR, MAINTENANCE, TRIGGERS
// =============================================================

function repairOrganisationsFormulas() {
  var sheet = getSheet('Organisations');
  if (!sheet) return;
  var bodyRows = Math.max(sheet.getMaxRows() - 1, 1);
  sheet.getRange(2, COLS.ORGS.KNOWN_PEOPLE, bodyRows, 2).clearContent().clearNote().clearDataValidations();
  if (sheet.getLastRow() < 2) return;
  var rowCount = sheet.getLastRow() - 1;
  var names = sheet.getRange(2, COLS.ORGS.NAME, rowCount, 1).getValues();
  var orgIdCol = columnToLetter(COLS.ORGS.ID);
  var peopleOrgIdCol = columnToLetter(COLS.PEOPLE.ORG_ID);
  var jobsOpportunityCol = columnToLetter(COLS.JOBS.OPPORTUNITY);
  var jobsOrgIdCol = columnToLetter(COLS.JOBS.ORG_ID);
  var jobsStatusCol = columnToLetter(COLS.JOBS.STATUS);
  var formulas = [];
  for (var i = 0; i < rowCount; i++) {
    var r = i + 2;
    if (!names[i][0]) {
      formulas.push(['', '']);
      continue;
    }
    var orgIdRef = orgIdCol + r;
    formulas.push([
      '=COUNTIF(People!' + peopleOrgIdCol + ':' + peopleOrgIdCol + ',' + orgIdRef + ')',
      '=COUNTIFS(Jobs!' + jobsOrgIdCol + ':' + jobsOrgIdCol + ',' + orgIdRef + ',Jobs!' + jobsOpportunityCol + ':' + jobsOpportunityCol + ',"<>",Jobs!' + jobsStatusCol + ':' + jobsStatusCol + ',"<>Closed")'
    ]);
  }
  sheet.getRange(2, COLS.ORGS.KNOWN_PEOPLE, rowCount, 2).setFormulas(formulas);
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

function roundIdExistsMap() {
  var sheet = getSheet('Interviews');
  var out = {};
  if (!sheet || sheet.getLastRow() < 2) return out;
  var ids = sheet.getRange(2, COLS.ROUNDS.ID, sheet.getLastRow() - 1, 1).getValues();
  ids.forEach(function (r) { if (r[0]) out[String(r[0])] = true; });
  return out;
}

function buildLinkedObjectHealthMaps() {
  return {
    orgIds: orgIdExistsMap(),
    jobIds: jobIdExistsMap(),
    personIds: personIdExistsMap(),
    sectorIds: sectorIdExistsMap(),
    roundIds: roundIdExistsMap()
  };
}

function linkedObjectExistsForHealth(type, id, maps) {
  if (!id || !type || type === 'None') return true;
  if (type === 'Job') return !!maps.jobIds[id];
  if (type === 'Person') return !!maps.personIds[id];
  if (type === 'Organisation') return !!maps.orgIds[id];
  if (type === 'Sector') return !!maps.sectorIds[id];
  if (type === 'Interview round') return !!maps.roundIds[id];
  return true;
}

function isKnownLinkedObjectType(type) {
  return ['Job', 'Person', 'Organisation', 'Sector', 'Interview round'].indexOf(String(type || '')) !== -1;
}

function syncJobsPeopleHealthFlags() {
  var todayDate = today();
  var count = 0;
  var orgIds = orgIdExistsMap();
  var jobsSheet = getSheet('Jobs');
  if (jobsSheet && jobsSheet.getLastRow() >= 2) {
    var jobs = jobsSheet.getRange(2, 1, jobsSheet.getLastRow() - 1, HEADERS.Jobs.length).getValues();
    var jobIdRows = {};
    jobs.forEach(function (jobRow, idx) {
      var jobId = String(jobRow[COLS.JOBS.ID - 1] || '');
      if (!jobId) return;
      if (!jobIdRows[jobId]) jobIdRows[jobId] = [];
      jobIdRows[jobId].push(idx + 2);
    });
    for (var j = 0; j < jobs.length; j++) {
      var jr = j + 2;
      var jobId = String(jobs[j][COLS.JOBS.ID - 1] || '');
      var opportunity = String(jobs[j][COLS.JOBS.OPPORTUNITY - 1] || '');
      if (opportunity && !jobId) {
        appendNoteFlag(jobsSheet, jr, COLS.JOBS.NOTES, '[missing-job-id] Opportunity has no Job ID; run row action or repair after checking the row');
        count++;
      } else {
        clearNoteFlag(jobsSheet, jr, COLS.JOBS.NOTES, '[missing-job-id]');
      }
      if (jobId && jobIdRows[jobId] && jobIdRows[jobId].length > 1) {
        appendNoteFlag(jobsSheet, jr, COLS.JOBS.NOTES, '[duplicate-job-id] Also used on row(s): ' + jobIdRows[jobId].filter(function (r) { return r !== jr; }).join(', '));
        count++;
      } else {
        clearNoteFlag(jobsSheet, jr, COLS.JOBS.NOTES, '[duplicate-job-id]');
      }
      var status = normalizeJobStatus(jobs[j][COLS.JOBS.STATUS - 1]);
      var deadline = jobs[j][COLS.JOBS.DEADLINE - 1];
      if ((status === 'Not started' || status === 'In progress') && deadline && new Date(deadline) < todayDate) {
        appendNoteFlag(jobsSheet, jr, COLS.JOBS.NOTES, '[missed-deadline] Deadline passed before application was submitted');
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
    var personIdRows = {};
    people.forEach(function (personRow, idx) {
      var personId = String(personRow[COLS.PEOPLE.ID - 1] || '');
      if (!personId) return;
      if (!personIdRows[personId]) personIdRows[personId] = [];
      personIdRows[personId].push(idx + 2);
    });
    for (var p = 0; p < people.length; p++) {
      var pr = p + 2;
      var personIdForHealth = String(people[p][COLS.PEOPLE.ID - 1] || '');
      if (personIdForHealth && personIdRows[personIdForHealth] && personIdRows[personIdForHealth].length > 1) {
        appendNoteFlag(peopleSheet, pr, COLS.PEOPLE.NOTES, '[duplicate-person-id] Also used on row(s): ' + personIdRows[personIdForHealth].filter(function (r) { return r !== pr; }).join(', '));
        count++;
      } else {
        clearNoteFlag(peopleSheet, pr, COLS.PEOPLE.NOTES, '[duplicate-person-id]');
      }
      var personOrgId = String(people[p][COLS.PEOPLE.ORG_ID - 1] || '');
      if (personOrgId && !orgIds[personOrgId]) {
        appendNoteFlag(peopleSheet, pr, COLS.PEOPLE.NOTES, '[orphaned-org] Linked Organisation no longer exists');
        count++;
      } else {
        clearNoteFlag(peopleSheet, pr, COLS.PEOPLE.NOTES, '[orphaned-org]');
      }
    }
  }
  var taskSheet = getSheet('Tasks');
  var healthMaps = buildLinkedObjectHealthMaps();
  healthMaps.orgIds = orgIds;
  if (taskSheet && taskSheet.getLastRow() >= 2) {
    var tasks = taskSheet.getRange(2, 1, taskSheet.getLastRow() - 1, HEADERS['To-do'].length).getValues();
    for (var t = 0; t < tasks.length; t++) {
      var type = String(tasks[t][COLS.TODO.OBJ_TYPE - 1] || '');
      var id = String(tasks[t][COLS.TODO.OBJ_ID - 1] || '');
      var isLinkedKnownObject = isKnownLinkedObjectType(type) && !!id;
      if (isLinkedKnownObject && !linkedObjectExistsForHealth(type, id, healthMaps)) {
        appendNoteFlag(taskSheet, t + 2, COLS.TODO.NOTES, '[orphaned-link] Linked ' + type + ' no longer exists');
        count++;
      } else if (isLinkedKnownObject) {
        clearNoteFlag(taskSheet, t + 2, COLS.TODO.NOTES, '[orphaned-link]');
      }
    }
  }
  var decisionSheet = getSheet('Decisions');
  if (decisionSheet && decisionSheet.getLastRow() >= 2) {
    var decisions = decisionSheet.getRange(2, 1, decisionSheet.getLastRow() - 1, HEADERS['Pending decisions'].length).getValues();
    for (var d = 0; d < decisions.length; d++) {
      var dType = String(decisions[d][COLS.DECISIONS.TARGET_TYPE - 1] || '');
      var dId = String(decisions[d][COLS.DECISIONS.TARGET_ID - 1] || '');
      var dIsLinkedKnownObject = isKnownLinkedObjectType(dType) && !!dId;
      if (dIsLinkedKnownObject && !linkedObjectExistsForHealth(dType, dId, healthMaps)) {
        appendNoteFlag(decisionSheet, d + 2, COLS.DECISIONS.NOTES, '[orphaned-link] Linked ' + dType + ' no longer exists');
        count++;
      } else if (dIsLinkedKnownObject) {
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
  var result = withDocumentLock(repairAllTabsImpl, { label: 'repairAllTabs', timeoutMs: 30000, failOpen: false });
  if (result === null) SpreadsheetApp.getActiveSpreadsheet().toast('Repair skipped because another Planner action is running. Try again in a minute.', 'The Planner', 6);
  return result;
}

function repairAllTabsImpl() {
  migrateLegacyTabs();
  migrateWorkbookSchema();

  CANONICAL_TAB_ORDER.forEach(function (name) {
    var headerKey = SHEET_TO_HEADER_KEY[name];
    if (!headerKey) return;
    var headers = HEADERS[headerKey];
    var sheet = ensureCanonicalSheet(name);
    if (name === 'Today') return; // Today's layout is built by bootstrapToday, not a plain header row
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    styleHeader(sheet, headers.length);
    clearRetiredSchemaColumns(sheet, name);
    applySheetDropdowns(name);
  });
  ensureDecisionsTab();
  applySheetDropdowns('Decisions');

  repairSectorRows();
  repairOrgTaxonomyLinks();
  repairSectorTaskLinks();
  detectSectorOrphans();
  syncJobsPeopleHealthFlags();
  checkDomainReadinessFlags();
  checkInterviewRoundHealthFlags();
  removeOpenDeadlineReminderTasks();
  repairOrganisationsFormulas();
  syncOrgReviewSchedules();
  refreshLinkedContactsDisplay();
  repairInteractionPersonLinks();
  syncPeopleHelperColumns();
  scanInvalidDropdownValues(true);
  scanDuplicateIdValues(true);
  recalculateCommitmentClasses();
  backfillTaskHelperColumns();
  backfillDecisionHelperColumns();
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
  return true;
}

function dailyMaintenance() {
  // v7.3: whole daily batch runs under the document lock so it can't
  // interleave with a user edit mid-cascade.
  withDocumentLock(function () {
    Logger.log('dailyMaintenance: START ' + new Date());
    var migratedJobs = migrateJobsDeadlineStatusSchema();
    var migratedInteractions = migrateInteractionsStatusSchema();
    if (migratedJobs || migratedInteractions) {
      applySheetDropdowns('Jobs');
      applySheetDropdowns('Conversations');
      colorCodeManualFields();
      applyStatusColorCoding();
      applyColumnWidths();
    }
    checkMorningCarryForward();
    recalculateCommitmentClasses();
    backfillTaskHelperColumns();
    backfillDecisionHelperColumns();
    runQueueHygiene();
    repairOrganisationsFormulas();
    syncOrgReviewSchedules();
    materializeDueTasks();
    removeOpenDeadlineReminderTasks();
    repairSectorRows();
    repairSectorTaskLinks();
    detectSectorOrphans();
    syncJobsPeopleHealthFlags();
    refreshLinkedContactsDisplay();
    checkDomainReadinessFlags();
    checkInterviewRoundHealthFlags();
    refreshInteractionPersonDropdown();
    repairInteractionPersonLinks();
    syncPeopleHelperColumns();
    scanInvalidDropdownValues(true);
    scanDuplicateIdValues(true);
    populateToday();
    refreshHome();
    checkTriggerHealth();
    recordMaintenanceHeartbeat('lastDailyMaintenanceAt');
    Logger.log('dailyMaintenance: DONE ' + new Date());
  }, { label: 'dailyMaintenance', timeoutMs: 30000, failOpen: false });
}

function fullRefresh() {
  var result = withDocumentLock(fullRefreshImpl, { label: 'fullRefresh', timeoutMs: 30000, failOpen: false });
  if (result === null) SpreadsheetApp.getActiveSpreadsheet().toast('Refresh skipped because another Planner action is running. Try again in a minute.', 'The Planner', 6);
  else SpreadsheetApp.getActiveSpreadsheet().toast('Derived data refreshed. Source rows were not cleared.', 'The Planner', 5);
  return result;
}

function refreshAllDerivedData() {
  return fullRefresh();
}

function fullRefreshImpl() {
  // v7.3: also force a trigger check on every full refresh.
  ensureTriggersInstalled({ silent: true });
  dailyMaintenance();
  colorCodeManualFields();
  applyStatusColorCoding();
  applyAllRichTextHeaders();
  applyColumnWidths();
  applyColumnLayout();
  hideLegacyUtilityTabs();
  refreshAllDropdowns();
  refreshHome();
  renderTodayDecisionCards();
  return true;
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
  SpreadsheetApp.getActiveSpreadsheet().toast('Daily/weekly automation installed (' + tz + '): ' + created.join(', ') + '.', 'The Planner', 6);
}

function uninstallTimeTriggers() {
  var removed = 0;
  TIME_TRIGGER_SPECS.forEach(function (spec) {
    removed += deleteTriggersFor(spec.handler, ScriptApp.EventType.CLOCK);
  });
  SpreadsheetApp.getActiveSpreadsheet().toast('Turned off ' + removed + ' daily/weekly automation trigger(s). Edit actions are untouched — use "Triggers & setup" for those.', 'The Planner', 5);
}

// =============================================================
// MENU
// =============================================================

function buildMenu() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('The Planner')
    .addItem('Start or redo setup', 'runSetupInterview')
    .addItem("Build / refresh Today's plan", 'populateToday')
    .addItem('Refresh Home status', 'refreshHome')
    .addItem('Add one-off task', 'addAdHocTodo')
    .addSeparator()
    .addSubMenu(ui.createMenu('Today')
      .addItem("Build / refresh Today's plan", 'populateToday')
      .addItem("Add selected Task to Today's plan", 'pullSelectedTaskIntoToday')
      .addItem('Add more time to Today', 'topUpToday')
      .addItem('Keep selected Today row in place', 'lockTodayRow')
      .addItem('Let selected Today row move again', 'unlockTodayRow')
      .addItem('Move selected row up', 'moveTodayRowUp')
      .addItem('Move selected row down', 'moveTodayRowDown')
      .addItem('Show all Today columns', 'showAllColumns'))
    .addSubMenu(ui.createMenu('Capture update')
      .addItem('Explore broad sectors', 'addNewSector')
      .addItem('Organisations found from exploration', 'addExplorationOrganisations')
      .addItem('Organisation / target', 'addNewOrganisation')
      .addItem('Person / contact', 'addNewPerson')
      .addItem('Job / opportunity', 'addNewJob')
      .addItem('Conversation / interaction', 'addNewInteraction')
      .addItem('Interview / round', 'addNewInterview'))
    .addSubMenu(ui.createMenu('Row actions')
      .addItem('Start pursuing selected org', 'rowActionStartPursuingSelectedOrg')
      .addItem('Find people at selected org', 'rowActionFindPeopleAtSelectedOrg')
      .addItem('Scan jobs at selected org', 'rowActionScanJobsAtSelectedOrg')
      .addItem('Prep application for selected job', 'rowActionPrepSelectedJob')
      .addItem('Referral search for selected job', 'rowActionReferralSearchSelectedJob')
      .addItem('Queue market-map decision for selected sub-sector', 'rowActionSearchOrgsForSubsector')
      .addItem('Queue sub-sector task for selected sector', 'rowActionBreakDownSelectedSector')
      .addItem('Add interview round for selected job', 'rowActionAddInterviewRound')
      .addItem('Plan prep for selected interview', 'rowActionPlanPrepForSelectedInterview')
      .addItem('Make selected Task multi-step', 'rowActionBreakDownSelectedTask')
      .addItem('Mark selected Task blocked', 'rowActionMarkTaskBlocked')
      .addItem('Unblock selected Task', 'rowActionUnblockSelectedTask')
      .addItem('Defer selected Task 3 days', 'rowActionDeferSelectedTask')
      .addSeparator()
      .addItem('Link contact to selected Job row', 'linkContactToJob')
      .addItem('Log conversation for selected row', 'logInteractionForRow')
      .addItem('Close selected Person/Job row', 'softCloseRow'))
    .addSubMenu(ui.createMenu('Triggers & setup')
      .addItem('\u2605 Set up / verify triggers (run this first)', 'setUpTriggers')
      .addItem('Show trigger status', 'showTriggerStatus')
      .addSeparator()
      .addItem('Repair edit actions only', 'installEditTrigger')
      .addItem('Turn off edit actions', 'uninstallEditTrigger')
      .addItem('Repair daily/weekly automation only', 'installTimeTriggers')
      .addItem('Turn off daily/weekly automation', 'uninstallTimeTriggers'))
    .addSubMenu(ui.createMenu('Maintenance')
      .addItem('Repair all tabs (safe to re-run)', 'repairAllTabs')
      .addItem('Clean up old tab names', 'migrateLegacyTabs')
      .addItem('Run daily maintenance now', 'dailyMaintenance')
      .addItem('Run weekly review now', 'weeklyReview')
      .addItem('Refresh derived data (safe)', 'refreshAllDerivedData')
      .addItem('Recalculate task priority', 'recalculateTaskPriorityFromMenu')
      .addItem('Show hidden columns', 'showAllColumns'))
    .addToUi();
}

// Simple onOpen trigger. Runs in a restricted auth context that CANNOT
// create installable triggers, so it does not attempt auto-wiring. Instead
// it *detects* whether the installable edit trigger is attached and shows
// an accurate, actionable prompt — replacing the old always-on "go install
// it" toast that fired even when the trigger was already present.
function onOpen() {
  buildMenu();
  try { if (migrateWorkbookSchema()) refreshAllDropdowns(); }
  catch (err) { Logger.log('onOpen schema migration check: ' + err); }
  refreshHome();
  renderTodayDecisionCards();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var editReady = false;
  try { editReady = triggerExists(EDIT_TRIGGER_HANDLER, ScriptApp.EventType.ON_EDIT); }
  catch (err) { Logger.log('onOpen trigger check: ' + err); }
  if (editReady) {
    ss.toast('The Planner ready. Start on Home.', 'The Planner', 4);
  } else {
    ss.toast('The Planner loaded, but edit actions are NOT wired yet. Run \u201cThe Planner \u2192 Triggers & setup \u2192 Set up / verify triggers\u201d once so onboarding and Capture update work reliably.', 'The Planner \u2014 one-time setup needed', 12);
  }
}
