// The Purchase MIS board as hr-erp's MIS page shows it (hr-erp app/purchase/mis-report, which the CRM
// shows at /purchase-mis): hr-erp builds the report on its server (lib/mis/load.server.ts loadMis) and
// the TV takes it as built — the team line (every step once, however many people share it), each
// doer ranked 0% best with their duties, and the steps behind them — so every number is the page's.
// When the page itself cannot be read, hr-erp's per-doer scores (/embed/pc-score, through the CRM's
// GET /api/purchase-mis-score, made by the same loadMis) stand in, with the team line added up
// from them. Each doer's own delay is hr-erp's (the average working minutes late over their late
// and not-done steps); the team's Avg delay is that same average over the team's steps, each once.

import { fmtPct, scoreTone } from './crm/lib/mis/format.js';
import { TV_TONE, delayLabel, pctOf } from './designMis.js';
import { MIS_PERIODS, periodInfo } from './misPeriods.js';

export const PURCHASE_TITLE = 'Purchase MIS';
export const VIA_PAGE = 'page';
export const VIA_SCORES = 'scores';

/** hr-erp lib/mis/score.ts misGrade (the letter the CRM Scoreboard shows): A down to −5%, B to −15%, C to −30%, D below. */
export function misGrade(score) {
  if (score === null || score === undefined) return null;
  if (score >= -5) return 'A';
  if (score >= -15) return 'B';
  if (score >= -30) return 'C';
  return 'D';
}

/** hr-erp lib/mis/score.ts missPct: −(missed ÷ planned) to one decimal; null with nothing planned. Never "−0". */
export function missPct(missed, planned) {
  if (planned <= 0) return null;
  const pct = Math.round((missed / planned) * 1000) / 10;
  return pct === 0 ? 0 : -pct;
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
/* "S5 · Follow-up" -> code S5, label Follow-up. */
const splitStep = (s) => {
  const label = String(s.stepLabel || s.stepKey || '');
  const at = label.indexOf(' · ');
  return at > 0 ? { code: label.slice(0, at), label: label.slice(at + 3) } : { code: String(s.stepKey || label), label };
};

/** The step a doer misses most this period, from their own step counts (the page's drill-down). */
function worstStepOf(byStep) {
  const rows = (byStep || [])
    .map((s) => ({ ...splitStep(s), missed: num(s.planned) - num(s.onTime), planned: num(s.planned) }))
    .filter((s) => s.missed > 0)
    .sort((a, b) => b.missed - a.missed || b.planned - a.planned);
  return rows[0] || null;
}

function personOf(row) {
  const isScored = num(row.planned) > 0;
  return {
    id: row.doerId || `unassigned:${row.doer}`,
    rank: isScored ? row.rank : null,
    name: row.doer,
    isGap: !row.doerId,
    score: row.notOnTimePct ?? null,
    scoreText: fmtPct(row.notOnTimePct ?? null),
    scoreTone: TV_TONE[scoreTone(row.notOnTimePct ?? null)],
    grade: misGrade(row.notOnTimePct ?? null),
    steps: num(row.planned),
    done: num(row.done),
    onTime: num(row.onTime),
    onTimePct: pctOf(num(row.onTime), num(row.planned)),
    late: num(row.late),
    overdue: num(row.notDone),
    pending: num(row.backlog),
    carryover: num(row.carryover),
    upcoming: typeof row.upcoming === 'number' ? row.upcoming : null,
    missed: num(row.planned) - num(row.onTime),
    notDonePct: row.notDonePct ?? null,
    notDoneText: fmtPct(row.notDonePct ?? null),
    avgDelayMin: row.avgDelayMin ?? null,
    avgDelayLabel: delayLabel(row.avgDelayMin ?? null),
    reward: false,
    tags: Array.isArray(row.duties) ? row.duties : [],
    worstStep: worstStepOf(row.byStep),
    topReason: null,
  };
}

/** hr-erp's doer delay (lib/mis/score.ts countStep) over the team: late and not-done steps, each step once. */
export function teamAvgDelayMin(steps) {
  const seen = new Set();
  let sum = 0;
  let count = 0;
  (steps || []).forEach((s) => {
    if (seen.has(s.stepId) || (s.outcome !== 'late' && s.outcome !== 'not-done') || !(num(s.delayMin) > 0)) return;
    seen.add(s.stepId);
    sum += s.delayMin;
    count += 1;
  });
  return count > 0 ? Math.round(sum / count) : null;
}

function summaryOf(team, avgDelayMin) {
  return {
    score: team.notOnTimePct ?? null,
    scoreText: fmtPct(team.notOnTimePct ?? null),
    scoreTone: TV_TONE[scoreTone(team.notOnTimePct ?? null)],
    grade: misGrade(team.notOnTimePct ?? null),
    steps: num(team.planned),
    done: num(team.done),
    onTime: num(team.onTime),
    onTimePct: pctOf(num(team.onTime), num(team.planned)),
    late: num(team.late),
    overdue: num(team.notDone),
    pending: num(team.backlog),
    carryover: num(team.carryover),
    upcoming: typeof team.upcoming === 'number' ? team.upcoming : null,
    missed: num(team.planned) - num(team.onTime),
    notDonePct: team.notDonePct ?? null,
    notDoneText: fmtPct(team.notDonePct ?? null),
    avgDelayMin,
    avgDelayLabel: delayLabel(avgDelayMin),
  };
}

/**
 * hr-erp's per-doer scores (/embed/pc-score: { coordinators }) as a report: the doers as sent,
 * the team line added up from them (exact while no step is shared by two people).
 */
export function reportFromScores(period, label, json) {
  const coordinators = Array.isArray(json && json.coordinators) ? json.coordinators : [];
  const doers = coordinators.filter((c) => c && c.name).map((c) => {
    const planned = num(c.total);
    return {
      doer: c.name,
      doerId: c.name === 'Unassigned' ? null : c.name,
      rank: c.rank,
      planned,
      done: num(c.done),
      onTime: num(c.onTime),
      late: num(c.late),
      notDone: num(c.overdue),
      carryover: num(c.prevPending),
      upcoming: null,
      backlog: num(c.overdue) + num(c.prevPending),
      notOnTimePct: planned > 0 ? c.notOnTimePct ?? c.score ?? null : null,
      notDonePct: planned > 0 ? c.notDonePct ?? null : null,
      avgDelayMin: num(c.avgDelayMins) > 0 ? c.avgDelayMins : null,
      duties: [],
    };
  });
  const team = ['planned', 'done', 'onTime', 'late', 'notDone', 'carryover', 'backlog']
    .reduce((t, k) => ({ ...t, [k]: doers.reduce((sum, d) => sum + d[k], 0) }), {});
  team.upcoming = null;
  team.notOnTimePct = missPct(team.planned - team.onTime, team.planned);
  team.notDonePct = missPct(team.planned - team.done, team.planned);
  return { period, label, team, doers, steps: [], warnings: json && json.error ? [String(json.error)] : [] };
}

/** One period's board from hr-erp's report (as the page has it, or reportFromScores). */
export function purchaseBoardOf(key, report, { via = VIA_PAGE, readAt = null } = {}) {
  const info = periodInfo(key, report.period);
  const people = (report.doers || []).map(personOf);
  return {
    title: PURCHASE_TITLE,
    kind: 'purchase',
    period: { ...info, dates: report.label || info.dates, via, builtAt: report.generatedAt || readAt },
    summary: summaryOf(report.team || {}, teamAvgDelayMin(report.steps)),
    people,
    idle: people.filter((p) => p.steps === 0 && !p.isGap).map((p) => p.name),
    warnings: [...(report.warnings || []), ...(via === VIA_SCORES ? ['MIS page not readable: team line added up from the doers'] : [])],
  };
}

/** The periods block of the payload, from the boards held. */
export const purchasePeriodsOf = (byPeriod) =>
  MIS_PERIODS.map(({ key, label }) => ({ key, label, dates: byPeriod[key]?.period.dates || null }));
