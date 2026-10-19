// VERBATIM COPY of CRM lib/mis/trend.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/mis/trend.js
//
// How a team's score moved week by week: the last few IST Monday–Sunday weeks
// up to the current one, each scored the way its own period would be (the
// caller hands in a function that builds the period's team line, so the trend
// can never disagree with the page it sits on). The current week runs up to
// now, as its period does, and is marked so a chart can show it as partial.
//
// Pure; lib/__tests__/mis-trend.test.js.

import { MIS_PRESET, presetPeriod } from './period.js';

export const DEFAULT_TREND_WEEKS = 8;
const DAY_MS = 24 * 60 * 60 * 1000;
const DAYS_IN_WEEK = 7;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const shiftDay = (day, days) => new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/** "12 Oct" for 2026-10-12. */
export function weekLabel(day) {
  const [, month, date] = day.split('-').map(Number);
  return `${date} ${MONTHS[month - 1]}`;
}

/**
 * The last `count` IST weeks, oldest first, the current one last.
 * @param {Date} now
 * @param {number} [count]
 * @returns {{ from: string, to: string, isCurrent: boolean }[]}
 */
export function recentWeeks(now, count = DEFAULT_TREND_WEEKS) {
  const current = presetPeriod(MIS_PRESET.THIS_WEEK, now);
  return Array.from({ length: count }, (_, index) => {
    const from = shiftDay(current.from, -DAYS_IN_WEEK * (count - 1 - index));
    return { from, to: shiftDay(from, DAYS_IN_WEEK - 1), isCurrent: index === count - 1 };
  });
}

/**
 * Each week with its team line, scored by `teamOf`.
 * @param {{ from: string, to: string, isCurrent: boolean }[]} weeks  recentWeeks.
 * @param {(period: { from: string, to: string }) => import('./types.js').MisTally|null} teamOf
 * @returns {{ from: string, to: string, label: string, isCurrent: boolean, score: number|null, planned: number,
 *   onTime: number, late: number, notDone: number }[]}  `score` is the signed miss %, null with nothing due.
 */
export function trendRows(weeks, teamOf) {
  return weeks.map((week) => {
    const team = teamOf({ from: week.from, to: week.to });
    return {
      ...week,
      label: weekLabel(week.from),
      score: team?.notOnTimePct ?? null,
      planned: team?.planned ?? 0,
      onTime: team?.onTime ?? 0,
      late: team?.late ?? 0,
      notDone: team?.notDone ?? 0,
    };
  });
}
