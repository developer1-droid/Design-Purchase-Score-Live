// The Designer MIS board as the CRM's Designer MIS page shows it (app/(app)/reports/designer-mis):
// the page's periods (engine/misPeriods.js), its report built by the CRM's own code
// (lib/designer-mis/report.js buildDesignRequestMisReport, copied by tools/sync-crm.mjs) from the
// same reads the page makes — the design requests, the report rules, the office calendar and
// hr-erp's cylinder design uploads (GET /api/designer-steps, for the period and the trend's weeks
// together, as useDesignerMis asks for them) — and a closed week or month read from its frozen
// record (GET /api/mis/periods), as useDesignerMisView reads it. The KPI cards' average delay is
// the page's (averageDelayHours over the period's steps); each designer's own delay, the step they
// miss most and the delay reason they write most are what the TV's walkthrough says about them.

import { buildDesignRequestMisReport, frozenDesignerReportOf } from './crm/lib/designer-mis/report.js';
import { DESIGNER_PROFILE } from './crm/lib/designer-mis/types.js';
import { topReasonByDoer } from './crm/lib/mis/delay-reasons.js';
import { MIS_TONE, fmtPct, fmtWorkingMinutes, scoreTone } from './crm/lib/mis/format.js';
import { frozenPeriodKey, readsFrozen } from './crm/lib/mis/frozen.js';
import { doerKeyOf } from './crm/lib/mis/score.js';
import { averageDelayHours, stepDelayRows } from './crm/lib/mis/step-delay.js';
import { recentWeeks } from './crm/lib/mis/trend.js';
import { MIS_NO_GRADE } from './crm/lib/mis/types.js';
import { setHolidays } from './crm/lib/work-calendar.js';
import { setClockRules } from './crm/lib/work-clock.js';
import { MIS_PERIODS, misPeriodOf, periodInfo } from './misPeriods.js';

export const DESIGN_TITLE = 'Designer MIS';
export { DESIGNER_PROFILE };

/* The engine's score tones (lib/mis/format.js) as the TV's bands. */
export const TV_TONE = Object.freeze({ [MIS_TONE.GOOD]: 'good', [MIS_TONE.WARN]: 'warn', [MIS_TONE.BAD]: 'bad', [MIS_TONE.NONE]: null });
const PERCENT = 100;
export const pctOf = (part, whole) => (whole > 0 ? Math.round((part / whole) * PERCENT) : null);
export const delayLabel = (min) => (fmtWorkingMinutes(min ?? null) === '—' ? null : fmtWorkingMinutes(min));
/* The page's Avg delay card: "7.4h" working hours. */
export const hoursLabel = (hours) => (hours === null || hours === undefined ? null : `${hours}h`);
const gradeOf = (grade) => (grade && grade !== MIS_NO_GRADE ? grade : null);

/** The days the cylinder uploads are read for: the period and the trend's weeks together (useDesignerMis cylinderRangeOf). */
export function cylinderRangeOf(period, now) {
  const weeks = recentWeeks(now);
  const first = weeks[0].from;
  const last = weeks[weeks.length - 1].to;
  return { from: period.from < first ? period.from : first, to: period.to > last ? period.to : last };
}
export const rangeKeyOf = (range) => `${range.from}|${range.to}`;

/** The distinct /api/designer-steps windows the periods need this poll. */
export function designerStepRanges(now) {
  const ranges = new Map();
  MIS_PERIODS.forEach(({ key }) => {
    const range = cylinderRangeOf(misPeriodOf(key, now), now);
    ranges.set(rangeKeyOf(range), range);
  });
  return [...ranges.values()];
}

const profileOf = (rules) => (rules && rules.profiles && rules.profiles[DESIGNER_PROFILE]) || null;

/** The closed weeks and months read from the CRM's frozen record: [{ key: 'from_to', period }]. */
export function frozenDesignPeriodsWanted(rules, now) {
  const profile = profileOf(rules);
  const wanted = new Map();
  MIS_PERIODS.forEach(({ key }) => {
    const period = misPeriodOf(key, now);
    if (readsFrozen(profile, period, now)) wanted.set(frozenPeriodKey(period), period);
  });
  return [...wanted].map(([key, period]) => ({ key, period }));
}

/** A frozen record as the page reads it (hooks/useFrozenBoards.js boardOf). */
const boardOf = (record) => ({ ...record.board, frozen: { createdAt: record.createdAt, rulesVersion: record.rulesVersion } });

/** The step a designer misses most this period (the page's "Where work misses", for one person). */
function worstStepOf(steps) {
  const top = stepDelayRows(steps || []).find((row) => row.missed > 0);
  return top ? { code: top.code, label: top.label, missed: top.missed, planned: top.planned } : null;
}

function personOf(row, details) {
  const isScored = row.planned > 0;
  return {
    id: doerKeyOf(row),
    rank: isScored ? row.rank : null,
    name: row.doer,
    isGap: !row.doerId,
    score: row.notOnTimePct,
    scoreText: fmtPct(row.notOnTimePct),
    scoreTone: TV_TONE[scoreTone(row.notOnTimePct)],
    grade: gradeOf(row.grade),
    steps: row.planned,
    done: row.done,
    onTime: row.onTime,
    onTimePct: pctOf(row.onTime, row.planned),
    late: row.late,
    overdue: row.notDone,
    pending: row.backlog,
    carryover: row.carryover,
    upcoming: row.upcoming,
    missed: row.planned - row.onTime,
    notDonePct: row.notDonePct,
    notDoneText: fmtPct(row.notDonePct),
    avgDelayMin: row.avgDelayMin ?? null,
    avgDelayLabel: delayLabel(row.avgDelayMin),
    reward: Boolean(row.isRewarded),
    tags: [],
    ...details(doerKeyOf(row)),
  };
}

function summaryOf(report, avgDelayHours) {
  const t = report.team;
  return {
    score: t.notOnTimePct,
    scoreText: fmtPct(t.notOnTimePct),
    scoreTone: TV_TONE[scoreTone(t.notOnTimePct)],
    grade: gradeOf(report.teamGrade),
    steps: t.planned,
    done: t.done,
    onTime: t.onTime,
    onTimePct: pctOf(t.onTime, t.planned),
    late: t.late,
    overdue: t.notDone,
    pending: t.backlog,
    carryover: t.carryover,
    upcoming: t.upcoming,
    missed: t.planned - t.onTime,
    notDonePct: t.notDonePct,
    notDoneText: fmtPct(t.notDonePct),
    avgDelayHours,
    avgDelayLabel: hoursLabel(avgDelayHours),
  };
}

/** What every period shares: the reads, and the office calendar loaded into the CRM's clocks (useWorkCalendar). */
function prepare(raw, now) {
  const rows = raw.designRequests && Array.isArray(raw.designRequests.items) ? raw.designRequests.items : null;
  if (!rows) throw new Error('the design requests are not read yet');
  if (!raw.rules) throw new Error('the report rules are not read yet');
  // A calendar that could not be read leaves the clocks on their built-in calendars, as on the page.
  if (raw.workCalendar) {
    setHolidays(raw.workCalendar.holidays);
    if (raw.workCalendar.clock) setClockRules(raw.workCalendar.clock);
  }
  const readAt = raw.readAt ? new Date(raw.readAt) : now;
  return { now, readAt, rows, rules: raw.rules, profile: profileOf(raw.rules), cylinder: raw.cylinder || {}, frozen: raw.frozen || {} };
}

/** One period's board. */
function boardFor(base, key) {
  const period = misPeriodOf(key, base.now);
  const cylinderPayload = base.cylinder[rangeKeyOf(cylinderRangeOf(period, base.now))] || null;
  const live = buildDesignRequestMisReport({
    rows: base.rows, rules: base.rules, period, now: base.readAt, readAt: base.readAt.toISOString(), cylinderPayload,
  });
  const shouldFreeze = readsFrozen(base.profile, period, base.now);
  const record = shouldFreeze ? base.frozen[frozenPeriodKey(period)] : null;
  // A closed period whose record could not be read is shown live, and says so (period.frozenMissing).
  const report = (record && frozenDesignerReportOf(boardOf(record), { live, rules: base.rules })) || live;
  const steps = report.steps || [];
  const reasons = topReasonByDoer(steps, doerKeyOf);
  const stepsByDoer = new Map();
  steps.forEach((step) => {
    const doer = doerKeyOf(step);
    if (!stepsByDoer.has(doer)) stepsByDoer.set(doer, []);
    stepsByDoer.get(doer).push(step);
  });
  const details = (doer) => {
    const reason = reasons.get(doer);
    return {
      worstStep: worstStepOf(stepsByDoer.get(doer)),
      topReason: reason ? { reason: reason.reason, count: reason.count, delayed: reason.delayed } : null,
    };
  };
  const people = (report.doers || []).map((row) => personOf(row, details));
  return {
    title: DESIGN_TITLE,
    kind: 'design',
    period: {
      ...periodInfo(key, period),
      dates: report.label || periodInfo(key, period).dates,
      frozenAt: record ? record.createdAt || null : null,
      frozenMissing: shouldFreeze && !record,
    },
    summary: summaryOf(report, averageDelayHours(steps)),
    people,
    // The page's "Score by designer": nothing fell due for these.
    idle: people.filter((p) => p.steps === 0).map((p) => p.name),
    warnings: [report.error, ...(report.warnings || [])].filter(Boolean),
  };
}

/**
 * Every period from the same reads. A period that throws is left out and reported in `failed`,
 * so the caller can keep its last good board.
 * @param {object} raw  { designRequests: { items }, readAt, rules, workCalendar, cylinder: { 'from|to': payload },
 *   frozen: { 'from_to': record } }
 * @returns {{ periods: {key,label,dates}[], byPeriod: Record<string, object>, failed: {key, error}[] }}
 */
export function computeDesignMisBoards(raw, { now = new Date() } = {}) {
  const base = prepare(raw, now);
  const byPeriod = {};
  const failed = [];
  MIS_PERIODS.forEach(({ key }) => {
    try {
      byPeriod[key] = boardFor(base, key);
    } catch (err) {
      failed.push({ key, error: err?.message || String(err) });
    }
  });
  const periods = MIS_PERIODS.map(({ key, label }) => ({ key, label, dates: byPeriod[key]?.period.dates || null }));
  return { periods, byPeriod, failed };
}
