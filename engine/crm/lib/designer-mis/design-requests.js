// VERBATIM COPY of CRM lib/designer-mis/design-requests.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/designer-mis/design-requests.js
//
// The Designer MIS's steps from the CRM's own Design Requests — the rows the
// Design Report's Detailed Analytics scores designers on (lib/scoring/
// designerScore.js), read the same way:
//
//   • one step per request, the registry's 'designRequest:DW' (design work);
//   • planned at 'Design Due At', done at 'Design Submitted At' once the work
//     status is completed / submitted / done;
//   • late or overdue in the designers' working minutes (lib/workingHours.js,
//     the registry's designer calendar);
//   • a closed request is dropped, as the analytics drops it, and so is one
//     with no designer — the step rule's own exclusions;
//   • the designer is the 'Assigned Designer', matched to the registry's
//     designers by name (lib/designer-mis/designers.js); a name the registry
//     does not list yet is still its own row, never "Unassigned".
//
// The step rule decides whether the designer profile counts it at all
// (scoreIn), so a rule change in Settings > Report Rules reaches this page.
//
// Returns the conversion shape lib/designer-mis/report.js scores, as
// lib/designer-mis/steps.js does for hr-erp's steps. Pure but for the
// designer clock, which can be handed in.

import { isClosedRow } from '../designApprovalClose.js';
import { FLOW } from '../rules/names.js';
import { stepKeyOf } from '../rules/steps-default.js';
import { workingMinutesBetween } from '../workingHours.js';
import { CYLINDER_UPLOAD_KEY, CYLINDER_UPLOAD_LABEL } from './cylinder.js';
import { createDesignerMatcher, designerRosterOf } from './designers.js';
import { DESIGNER_PROFILE } from './types.js';

export const DESIGN_WORK_STEP_KEY = stepKeyOf(FLOW.DESIGN_REQUEST, 'DW');
const DESIGN_WORK_CODE = 'DW';
const DESIGN_WORK_LABEL = 'Design work';
const DONE_STATUSES = new Set(['completed', 'submitted', 'done']);
const STATUS = Object.freeze({ DONE: 'DONE', OPEN: 'OPEN' });
const UNDATED_DONE_REASON = 'Done on the design desk; no submission time recorded';
const NOT_SCORED_WARNING = "The rules do not count design work (designRequest:DW) for the designer profile, so nothing is scored. Settings > Report Rules decides it.";

const text = (value) => String(value ?? '').trim();
const normalizeStatus = (value) => text(value).toLowerCase().replace(/[\s-]+/g, '_');
const isoOf = (value) => {
  const ms = value ? new Date(value).getTime() : Number.NaN;
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};
const join = (parts) => parts.map(text).filter(Boolean).join(' · ');

const emptyCounts = () => ({ listed: 0, skipped: 0, notScored: 0, notRequired: 0, excluded: 0, noPlan: 0, noRule: 0 });

/** The request's revisions so far: how many times the CRM or the buyer sent it back. */
function roundOf(row) {
  try {
    const history = typeof row['Version History'] === 'string' ? JSON.parse(row['Version History']) : row['Version History'];
    return Array.isArray(history) ? history.filter((entry) => entry?.status === 'Disapproved').length + 1 : 1;
  } catch {
    return 1;
  }
}

/**
 * A designer the registry does not list yet, kept as their own row (as the
 * analytics lists every 'Assigned Designer'), keyed by name so two such names
 * never merge. Never registered, so never rewarded.
 */
const UNLISTED_PREFIX = 'designer:';
const unlistedDesigner = (name) => ({ email: `${UNLISTED_PREFIX}${name.toLowerCase()}`, name });

/** The drawer's and the CSV's columns for a request. */
function detailOf(row, designer) {
  return {
    round: roundOf(row),
    requestType: text(row['Request Type']) || 'PI Request',
    packagingType: text(row['Packaging Type']),
    designCategory: text(row['Design Category']),
    piNumber: text(row['PI Number']),
    piItemNo: text(row['Sr No']),
    designRowId: text(row['Row ID']) || text(row['Request ID']),
    jobId: null,
    actedBy: designer,
    cylinderJob: false,
  };
}

/** One request as a MIS step, or null when it has no planned time. */
function stepOf(row, { personOf, now, minutesBetween }) {
  const plannedAt = isoOf(row['Design Due At']);
  if (!plannedAt) return null;
  const designer = text(row['Assigned Designer']);
  const isDone = DONE_STATUSES.has(normalizeStatus(row['Design Work Status']));
  const actualAt = isDone ? isoOf(row['Design Submitted At']) : null;
  const person = personOf({ name: designer }) ?? unlistedDesigner(designer);
  const id = text(row['Row ID']) || text(row['Request ID']) || `${designer}|${plannedAt}`;
  const ref = text(row['PI Number']) ? `PI ${text(row['PI Number'])}` : text(row['Request ID']) || id;
  return {
    id: `design-request|${id}`,
    flow: FLOW.DESIGN_REQUEST,
    stepKey: DESIGN_WORK_STEP_KEY,
    code: DESIGN_WORK_CODE,
    label: DESIGN_WORK_LABEL,
    plannedAt,
    actualAt,
    delayMin: Math.round(minutesBetween(new Date(plannedAt), actualAt ? new Date(actualAt) : now)),
    doers: person ? [person] : [],
    status: isDone ? STATUS.DONE : STATUS.OPEN,
    excuse: isDone && !actualAt ? { reason: UNDATED_DONE_REASON, by: null, at: null } : null,
    delayReason: text(row['Delay Reason']),
    refs: {
      ref,
      detail: join([row['Request Type'], row['Brand Name'], row['Buyer Name'] || row['Buyer'], row['Pack Size']]),
      search: join([row['PI Number'], row['Request ID'], row['Brand Name'], row['Buyer Name'], row['Buyer'], designer, row['Request Type']]).toLowerCase(),
    },
    design: detailOf(row, designer),
  };
}

/**
 * @param {ReadonlyArray<object>} rows  GET /api/design-requests items.
 * @param {object} rules  The resolved rules (whole, or as /api/rules/resolved trims them).
 * @param {{ now: Date, minutesBetween?: (a: Date, b: Date) => number }} options
 *   `minutesBetween`: the designers' signed working minutes from a to b.
 * @returns {{ steps: object[], roster: object[], warnings: string[], error: string|null,
 *   counts: { listed: number, skipped: number, notScored: number, notRequired: number, excluded: number,
 *   noPlan: number, noRule: number } }}
 */
export function designRequestConversion(rows, rules, { now, minutesBetween = workingMinutesBetween }) {
  const roster = designerRosterOf(rules, null);
  const counts = emptyCounts();
  const rule = rules?.steps?.[DESIGN_WORK_STEP_KEY] ?? null;
  const list = Array.isArray(rows) ? rows : [];
  if (!rule) {
    counts.noRule = list.length;
    return { steps: [], roster, warnings: [`No rule in the registry for '${DESIGN_WORK_STEP_KEY}', so no design work is listed.`], error: null, counts };
  }
  if (!(rule.scoreIn ?? []).includes(DESIGNER_PROFILE)) {
    counts.notScored = list.length;
    return { steps: [], roster, warnings: [NOT_SCORED_WARNING], error: null, counts };
  }
  const personOf = createDesignerMatcher(roster);
  const steps = [];
  list.forEach((row) => {
    if (isClosedRow(row) || !text(row['Assigned Designer'])) {
      counts.excluded += 1;
      return;
    }
    const step = stepOf(row, { personOf, now, minutesBetween });
    if (!step) {
      counts.noPlan += 1;
      return;
    }
    counts.listed += 1;
    steps.push(step);
  });
  const warnings = counts.noPlan > 0 ? [`${counts.noPlan} request${counts.noPlan === 1 ? ' has' : 's have'} no 'Design Due At' and cannot be placed in a period.`] : [];
  return { steps, roster, warnings, error: null, counts };
}

const REQUEST_TYPE_KEY = 'requestType:';

/** The Designer MIS's "where work misses" rows: design work by the request's type, the cylinder uploads as their own. */
export function byRequestType(step) {
  if (step?.stepKey === CYLINDER_UPLOAD_KEY) return { key: CYLINDER_UPLOAD_KEY, code: 'C1', label: CYLINDER_UPLOAD_LABEL };
  const type = text(step?.design?.requestType) || 'Design request';
  return { key: `${REQUEST_TYPE_KEY}${type}`, code: type, label: type };
}
