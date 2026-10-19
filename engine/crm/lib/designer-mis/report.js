// VERBATIM COPY of CRM lib/designer-mis/report.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/designer-mis/report.js
//
// The Designer MIS for a period: hr-erp's steps through the registry
// (lib/designer-mis/steps.js) and the MIS engine (lib/mis/score.js), scored
// with the designer profile's policy, grades and reward — decision #1's
// miss-% score, #2's IST periods and #3's carry-over and early-finish rules
// come from that profile, never from here.
//
// Every designer the registry or hr-erp names is on the board, with a row of
// zeros when nothing of theirs was planned: the page shows the whole design
// team, as the Scoreboard does, and a designer with no work in a week is a
// fact worth seeing, not a missing row. When the steps could not be read —
// hr-erp's error, or rules the conversion cannot use — there are no zero rows:
// a board of zeros would read as a quiet week, not a failure.
//
// The reward goes to the registry's designers (decision #21 names them; a
// reward is paid, decision #4). "Unassigned" — steps hr-erp could not put on
// a designer — and a designer only hr-erp's roster knows are ranked with
// everyone, as the engine ranks them, so their work is seen; neither is ever
// rewarded, and neither takes a place in the top N.
//
// Pure. `now` is passed in so a test and the page build the same report.

import { MIS_DEFAULT_GRADES, NO_GRACE_MIN } from '../mis/types.js';
import { doerStepsOf } from '../mis/doers.js';
import { frozenDoersOf } from '../mis/frozen.js';
import { periodBounds, periodLabel } from '../mis/period.js';
import { doerKeyOf, misGrade, misPolicyOf, rewardedDoers, scoreMis } from '../mis/score.js';
import { DESIGNER_SOURCE, designerRosterOf } from './designers.js';
import { cylinderConversion, mergeConversions } from './cylinder.js';
import { designRequestConversion } from './design-requests.js';
import { toDesignerMisSteps } from './steps.js';
import { DESIGNER_PROFILE } from './types.js';

/**
 * @typedef {import('../mis/types.js').MisDoerRow & { grade: string, isRewarded: boolean, isRegistered: boolean }} DesignerRow
 *   `isRegistered`: the designer is in the registry's designers, so the reward can be theirs.
 *
 * @typedef {object} DesignerMisReport
 * @property {import('../mis/types.js').MisPeriod} period
 * @property {string} label
 * @property {string} generatedAt
 * @property {import('../mis/types.js').MisTally} team
 * @property {string} teamGrade
 * @property {DesignerRow[]} doers
 * @property {(import('../mis/types.js').MisReportStep & { design: import('./types.js').DesignerStepDetail })[]} steps
 * @property {string[]} warnings  hr-erp's, then the conversion's, then a missing profile's.
 * @property {string|null} error  Why steps are missing: hr-erp's (or the proxy's) failure note, or rules the
 *   conversion cannot read.
 * @property {{ key: string, label: string, formula: string|null, grades: { grade: string, min: number|null }[],
 *   hasOwnGrades: boolean, reward: { topN: number, minScore: number }|null, outcome: object|null,
 *   isMissing: boolean }} profile  `grades` are the bands applied: the profile's, or hr-erp's when it sets none.
 * @property {{ builtAt: string|null, fetchedAt: string|null, from: string|null, to: string|null,
 *   calendar: object|null, rules: { stepKey: string, text: string }[] }} hrerp
 * @property {{ listed: number, skipped: number, notScored: number, notRequired: number, excluded: number, noPlan: number,
 *   noRule: number }} counts  What became of every row hr-erp sent (lib/designer-mis/steps.js).
 */

/**
 * The grade bands the designer profile scores on. A profile with none (today's
 * defaults describe the old weighted score, which had no letters) is graded on
 * hr-erp's bands — the engine's default and owner decision #1 — as the CRM MIS
 * grades its profiles.
 */
export const gradesOf = (profile) => (Array.isArray(profile?.grades) && profile.grades.length > 0 ? profile.grades : MIS_DEFAULT_GRADES);

/**
 * The instant a report is read at: when hr-erp built the steps, since that is
 * when it measured the open ones' delay — so "due" and "late" agree with the
 * numbers it sent. When the payload says nothing usable, the fallback.
 * @param {{ builtAt?: string }|null} payload
 * @param {Date} fallback
 */
export function reportClockOf(payload, fallback) {
  const builtAt = Date.parse(payload?.builtAt ?? '');
  return Number.isNaN(builtAt) ? fallback : new Date(builtAt);
}

/** A designer with nothing in the period's view: every count the engine would give, at zero. */
function zeroRow(identity, rank) {
  return {
    doer: identity.name,
    doerId: identity.email,
    planned: 0,
    done: 0,
    onTime: 0,
    late: 0,
    notDone: 0,
    carryover: 0,
    upcoming: 0,
    excused: 0,
    notDonePct: null,
    notOnTimePct: null,
    backlog: 0,
    flows: [],
    avgDelayMin: null,
    byStep: [],
    rank,
  };
}

/** The scored rows, then a zero row for each designer on the roster the period did not reach. */
function withEveryDesigner(doers, roster) {
  const seen = new Set(doers.map(doerKeyOf));
  const missing = roster.filter((identity) => !seen.has(identity.email));
  return [...doers, ...missing.map((identity, index) => zeroRow(identity, doers.length + index + 1))];
}

/** The emails the registry names as designers — in it alone, or matched to hr-erp's roster too. */
export function registeredDesigners(roster) {
  return new Set(roster.filter((identity) => identity.source !== DESIGNER_SOURCE.HRERP).map((identity) => identity.email));
}

/**
 * The doers the reward goes to: the registry's designers only, the top N
 * counted among them, in rank order.
 * @param {ReadonlyArray<import('../mis/types.js').MisDoerScore>} doers  Ranked.
 * @param {{ topN: number, minScore: number }|null} reward
 * @param {ReadonlySet<string>} registered  registeredDesigners.
 */
function rewardedPeople(doers, reward, registered) {
  const eligible = doers.filter((row) => registered.has(row.doerId)).map((row, index) => ({ ...row, rank: index + 1 }));
  return new Set(rewardedDoers(eligible, reward).map(doerKeyOf));
}

function profileSummary(profile) {
  return {
    key: DESIGNER_PROFILE,
    label: profile?.label ?? 'Designers',
    formula: profile?.formula ?? null,
    grades: gradesOf(profile),
    hasOwnGrades: gradesOf(profile) !== MIS_DEFAULT_GRADES,
    reward: profile?.reward ?? null,
    outcome: profile?.outcome ?? null,
    isMissing: !profile,
  };
}

const textOf = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);

/** Said when the rules carry no designer profile, so the reader knows whose rules the numbers follow. */
export const MISSING_PROFILE_WARNING =
  `The rules have no "${DESIGNER_PROFILE}" scoring profile: hr-erp's own policy and grades apply, and nobody is rewarded.`;

/**
 * The report over steps already converted for the engine — hr-erp's
 * (lib/designer-mis/steps.js) or the CRM's own design requests
 * (lib/designer-mis/design-requests.js) — scored with the designer profile.
 *
 * @param {object} input
 * @param {{ steps: object[], roster: object[], warnings: string[], error: string|null, counts: object }} input.conversion
 * @param {import('../rules/contract.js').Rules} input.rules
 * @param {import('../mis/types.js').MisPeriod} input.period
 * @param {Date} input.now
 * @param {{ error?: string|null, warnings?: string[], builtAt?: string|null, fetchedAt?: string|null, from?: string|null,
 *   to?: string|null, calendar?: object|null, rules?: object[] }} [input.source]  Where the steps were read: its failure
 *   note, its own warnings, and when it built them.
 * @returns {DesignerMisReport}
 */
export function buildDesignerMisReportFrom({ conversion, rules, period, now, source = {} }) {
  const profile = rules?.profiles?.[DESIGNER_PROFILE] ?? null;
  const { start, end } = periodBounds(period);
  // Each step's own grace from its rule: the registry decides.
  const graceOf = (step) => {
    const grace = rules?.steps?.[step.stepKey]?.graceMin;
    return Number.isFinite(grace) ? grace : NO_GRACE_MIN;
  };
  const scored = scoreMis(doerStepsOf(conversion.steps), start, end, now, misPolicyOf(profile, graceOf));
  const grades = gradesOf(profile);
  const registered = registeredDesigners(conversion.roster);
  const rewarded = rewardedPeople(scored.doers, profile?.reward ?? null, registered);
  const errors = [textOf(source.error), conversion.error].filter(Boolean);
  // A failed read lists what was scored (nothing, as a rule) and no zero rows.
  const rows = errors.length > 0 ? scored.doers : withEveryDesigner(scored.doers, conversion.roster);
  const doers = rows.map((row) => ({
    ...row,
    duties: [],
    grade: misGrade(row.notOnTimePct, grades),
    isRewarded: rewarded.has(doerKeyOf(row)),
    isRegistered: registered.has(row.doerId),
  }));
  const sourceWarnings = Array.isArray(source.warnings) ? source.warnings.map(String) : [];

  return {
    period,
    label: periodLabel(period),
    generatedAt: now.toISOString(),
    team: scored.team,
    teamGrade: misGrade(scored.team.notOnTimePct, grades),
    doers,
    steps: scored.steps,
    warnings: [...sourceWarnings, ...conversion.warnings, ...(profile ? [] : [MISSING_PROFILE_WARNING])],
    error: errors.length > 0 ? errors.join(' ') : null,
    profile: profileSummary(profile),
    hrerp: {
      builtAt: source.builtAt ?? null,
      fetchedAt: source.fetchedAt ?? null,
      from: source.from ?? null,
      to: source.to ?? null,
      calendar: source.calendar ?? null,
      rules: Array.isArray(source.rules) ? source.rules : [],
    },
    counts: conversion.counts,
    cylinderCounts: conversion.cylinderCounts ?? null,
  };
}

/**
 * The report over hr-erp's designer steps as /api/designer-steps hands them over.
 * @param {object} input
 * @param {import('./types.js').DesignerStepsPayload|null} input.payload
 * @param {import('../rules/contract.js').Rules} input.rules
 * @param {import('../mis/types.js').MisPeriod} input.period
 * @param {Date} input.now
 * @returns {DesignerMisReport}
 */
export function buildDesignerMisReport({ payload, rules, period, now }) {
  return buildDesignerMisReportFrom({ conversion: toDesignerMisSteps(payload, rules), rules, period, now, source: payload ?? {} });
}

/**
 * The report over the CRM's own design requests — the rows the Design
 * Report's Detailed Analytics scores designers on (lib/designer-mis/
 * design-requests.js) — with hr-erp's cylinder design uploads beside them
 * (lib/designer-mis/cylinder.js) once they are read. `readAt` is when the rows
 * were read.
 * @param {{ rows: object[], rules: import('../rules/contract.js').Rules, period: import('../mis/types.js').MisPeriod,
 *   now: Date, readAt?: string|null, cylinderPayload?: object|null }} input
 * @returns {DesignerMisReport}
 */
export function buildDesignRequestMisReport({ rows, rules, period, now, readAt = null, cylinderPayload = null }) {
  return buildDesignerMisReportFrom({
    conversion: mergeConversions(designRequestConversion(rows, rules, { now }), cylinderConversion(cylinderPayload, rules)),
    rules,
    period,
    now,
    source: {
      builtAt: readAt,
      fetchedAt: cylinderPayload?.fetchedAt ?? readAt,
      calendar: cylinderPayload?.calendar ?? null,
      rules: cylinderPayload?.rules ?? [],
    },
  });
}

const NO_HRERP = Object.freeze({ builtAt: null, fetchedAt: null, from: null, to: null, calendar: null, rules: [] });

/**
 * The Designer MIS of a closed period the designer profile freezes (decision
 * #4): the designers' rows, the team line, its grade and the reward as the
 * period's frozen record keeps them — never scored again — over the live
 * read's steps, counts and notes when there is one, which the drawer and the
 * steps export list. Null until the record is read.
 *
 * @param {object|null} board  The record's board (hooks/useFrozenBoard.js), carrying `frozen`.
 * @param {{ live: DesignerMisReport|null, rules: object|null }} input
 * @returns {(DesignerMisReport & { frozen: { createdAt: string, rulesVersion: number|null }|null })|null}
 */
export function frozenDesignerReportOf(board, { live, rules }) {
  if (!board) return null;
  const registered = registeredDesigners(designerRosterOf(rules, null));
  const base = live ?? {
    period: board.period,
    label: board.periodLabel,
    generatedAt: board.generatedAt,
    steps: [],
    warnings: [],
    error: null,
    profile: profileSummary(rules?.profiles?.[DESIGNER_PROFILE] ?? null),
    hrerp: NO_HRERP,
    counts: null,
  };
  return {
    ...base,
    team: board.team,
    teamGrade: board.teamGrade,
    doers: frozenDoersOf(board, (doerId) => ({ isRegistered: registered.has(doerId) })),
    profile: { ...base.profile, reward: board.reward ?? null },
    frozen: board.frozen ?? null,
  };
}
