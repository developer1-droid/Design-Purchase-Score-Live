// VERBATIM COPY of CRM lib/designer-mis/steps.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/designer-mis/steps.js
//
// hr-erp's designer steps as the MIS engine's feed rows (lib/mis/types.js
// MisStep), the registry deciding which count:
//
//   • a step is the registry step 'hrerpDesign:D2', 'hrerpDesign:D3' or
//     'hrerpCylinder:C1'; a row with no rule is noted, not scored;
//   • it counts when the rule's `scoreIn` names the designer profile and its
//     `requiredWhen` holds over the row's facts — under the owner's decisions
//     D2 counts for PI requests, help tickets and exhibition posters, C1 when
//     hr-erp opened a cylinder job, D3 for the rest, so one hand-over is never
//     scored twice;
//   • the rule's exclusions are read over the same facts: a buyer-provided
//     design or a rejected PI is left out, a redo the designer is not blamed
//     for is excused — listed with its reason, scored to nobody — and so is an
//     open step on hold with a reason ('held', from hr-erp's facts.held and
//     facts.holdReason; a hold with no reason is scored like any open step).
//     An exclusion hr-erp sends nothing to judge by is not applied, and the
//     conversion warns of it rather than skip it in silence;
//   • hr-erp's own verdicts stand too: 'skipped' is left out, 'excused' keeps
//     hr-erp's reason. The reports follow the boards, and hr-erp is the board;
//   • plannedAt, actualAt and delayMin are passed as sent — hr-erp measured the
//     delay on its own office calendar, and the engine never re-measures;
//   • the step belongs to its designer (lib/designer-mis/designers.js); with
//     none it is "Unassigned".
//
// A step with no planned time cannot be placed in a period; it is left out
// with a warning rather than silently, since hr-erp sends an open one so
// pending work never disappears.
//
// Rules trimmed for display — a step's `requiredWhen` or `exclusions` left
// out, as a public copy of the registry may do — cannot say whether C1 or D3
// is a design's hand-over: read as "always required" they would score both.
// Such rules are refused with an error that names what is missing, and
// nothing is scored, rather than a hand-over being counted twice.
//
// Pure.

import { FAULT_DESIGNER, FAULT_LABELS } from '../design-fault.js';
import { evaluate } from '../rules/conditions.js';
import { createDesignerMatcher, designerRosterOf } from './designers.js';
import { designerStepFacts } from './facts.js';
import { DESIGNER_PROFILE, DESIGNER_STATUS, DESIGNER_STEP_LABELS, DESIGNER_STEP_ORDER, designerStepKeyOf } from './types.js';

/**
 * The registry exclusions a designer step can carry (lib/rules/steps-default.js
 * EXCLUSION), named here so the browser build does not pull in the boards'
 * modules; lib/__tests__/designer-mis-steps.test.js pins them to the registry.
 */
export const DESIGNER_EXCLUSION = Object.freeze({
  BUYER_PROVIDED_DESIGN: 'buyerProvidedDesign',
  REJECTED_PI: 'rejectedPi',
  REDO_NOT_DESIGNER_FAULT: 'redoNotDesignerFault',
  UNASSIGNED: 'unassigned',
  HELD: 'held',
});

/** The exclusions this conversion can apply: hr-erp sends the facts each is judged by. */
const APPLIED_EXCLUSIONS = new Set(Object.values(DESIGNER_EXCLUSION));

/** Whether this conversion applies an exclusion of that name (lib/designer-mis/explain.js marks the others "not applied"). */
export const isAppliedDesignerExclusion = (name) => APPLIED_EXCLUSIONS.has(name);

/**
 * hr-erp's 'excused' stands even when it came with no reason: the engine
 * lists a step as excused only with one, so this stands in rather than the
 * round being scored against a designer hr-erp held not answerable.
 */
export const HRERP_EXCUSED_WITHOUT_REASON = 'Excused by hr-erp (no reason sent)';

/** The registry steps hr-erp sends, in the order the work happens. */
export const DESIGNER_RULE_KEYS = Object.freeze(DESIGNER_STEP_ORDER.map(({ flow, code }) => designerStepKeyOf(flow, code)));

/** The fields of a step rule the conversion decides with. */
const DECIDING_FIELDS = Object.freeze(['scoreIn', 'requiredWhen', 'exclusions']);

const PI_REJECTED = 'rejected';
const FIRST_ROUND = 1;
const FAULT_NOT_RECORDED = 'fault not recorded';

const text = (value) => String(value ?? '').trim();
const joinPresent = (parts, separator) => parts.map(text).filter(Boolean).join(separator);
const isRecord = (value) => Object.prototype.toString.call(value) === '[object Object]';

/** The registry's rule for a step key, or null. */
function stepRuleOf(rules, key) {
  return key && isRecord(rules?.steps) && Object.hasOwn(rules.steps, key) && isRecord(rules.steps[key]) ? rules.steps[key] : null;
}

const scoresIn = (rule, profile) => Array.isArray(rule.scoreIn) && rule.scoreIn.includes(profile);

/**
 * Each step key's rule and whether it scores in the profile, read once per
 * key however many rows share it. Null for a key the registry does not have.
 */
function ruleReader(rules, profile) {
  const read = new Map();
  return (key) => {
    if (!read.has(key)) {
      const rule = stepRuleOf(rules, key);
      read.set(key, rule ? { rule, isScored: scoresIn(rule, profile) } : null);
    }
    return read.get(key);
  };
}

/**
 * The designer steps whose rule may score in the profile but is missing a
 * field the conversion decides with — what a trimmed copy of the rules lacks.
 * A rule that plainly does not score in the profile needs nothing else.
 * @returns {{ key: string, missing: string[] }[]}
 */
export function unreadableDesignerRules(rules, profile = DESIGNER_PROFILE) {
  return DESIGNER_RULE_KEYS.flatMap((key) => {
    const rule = stepRuleOf(rules, key);
    if (!rule) return [];
    const missing = DECIDING_FIELDS.filter((field) => !Object.hasOwn(rule, field));
    const mayScore = !Object.hasOwn(rule, 'scoreIn') || scoresIn(rule, profile);
    return missing.length > 0 && mayScore ? [{ key, missing }] : [];
  });
}

/**
 * The exclusions a designer step's rule names that this conversion cannot
 * apply — 'closedRequest', say, which hr-erp's steps carry nothing to judge
 * by — on the steps the profile scores. Each is a warning, never a silent skip.
 * @returns {{ key: string, names: string[] }[]}
 */
export function unappliedDesignerExclusions(rules, profile = DESIGNER_PROFILE) {
  return DESIGNER_RULE_KEYS.flatMap((key) => {
    const rule = stepRuleOf(rules, key);
    if (!rule || !scoresIn(rule, profile)) return [];
    const names = (Array.isArray(rule.exclusions) ? rule.exclusions : []).filter((name) => !isAppliedDesignerExclusion(name));
    return names.length > 0 ? [{ key, names }] : [];
  });
}

const unappliedWarning = ({ key, names }) => `The rules leave ${names.map((name) => `'${name}'`).join(', ')} out of ${key}, `
  + `but hr-erp's steps carry nothing to judge ${names.length === 1 ? 'it' : 'them'} by: not applied, so those steps are scored as usual.`;

function unreadableRulesError(unreadable) {
  const fields = [...new Set(unreadable.flatMap((entry) => entry.missing))].join(', ');
  const keys = unreadable.map((entry) => entry.key).join(', ');
  return `The report rules reached this page without ${fields} on ${keys}, so it cannot tell which designer steps count — `
    + 'C1 or D3 for a hand-over. Nothing is scored rather than a hand-over counted twice.';
}

/**
 * Why a counted row is left out or excused by the rule's exclusions, read
 * over its facts. A redo round counts only when the revision is the
 * designer's fault (decision #17): a round whose fault was never recorded is
 * not shown to be theirs and is excused, as hr-erp reads its own D2 redo
 * rounds — so a reopened cylinder upload, whose fault hr-erp never records,
 * is listed with that reason rather than scored.
 */
function exclusionVerdict(rule, step, facts, person) {
  const exclusions = new Set(Array.isArray(rule.exclusions) ? rule.exclusions : []);
  if (exclusions.has(DESIGNER_EXCLUSION.BUYER_PROVIDED_DESIGN) && facts.buyerProvided) return { leftOut: true };
  if (exclusions.has(DESIGNER_EXCLUSION.REJECTED_PI) && facts.piStatus.toLowerCase() === PI_REJECTED) return { leftOut: true };
  if (exclusions.has(DESIGNER_EXCLUSION.UNASSIGNED) && !person) return { leftOut: true };
  // A hold pauses an open step; it excuses only with a reason on it, as a board's hold does.
  const holdReason = text(step.facts?.holdReason);
  if (exclusions.has(DESIGNER_EXCLUSION.HELD) && step.facts?.held === true && !step.actualAt && holdReason) {
    return { leftOut: false, excuse: `On hold — ${holdReason}` };
  }
  const round = Number(step.round) || FIRST_ROUND;
  const fault = facts.revisionFault.toLowerCase();
  if (exclusions.has(DESIGNER_EXCLUSION.REDO_NOT_DESIGNER_FAULT) && round > FIRST_ROUND && fault !== FAULT_DESIGNER) {
    return { leftOut: false, excuse: `Redo round ${round} — ${FAULT_LABELS[fault] ?? FAULT_NOT_RECORDED}` };
  }
  return { leftOut: false, excuse: '' };
}

/** hr-erp's own excuse stands first — it is the board's word on the round — then the registry's. */
function excuseReasonOf(step, verdict) {
  if (step.status !== DESIGNER_STATUS.EXCUSED) return verdict.excuse;
  return text(step.excuse) || verdict.excuse || HRERP_EXCUSED_WITHOUT_REASON;
}

/** "PI 26127 · item 4", or the request and its row when there is no PI. */
function refOf(refs) {
  const pi = text(refs.piNumber);
  const item = text(refs.piItemNo);
  if (pi) return item ? `PI ${pi} · item ${item}` : `PI ${pi}`;
  return joinPresent([refs.requestType, refs.designRowId && `row ${text(refs.designRowId)}`], ' · ') || 'Design';
}

function refsOf(step) {
  const refs = step.refs ?? {};
  const facts = step.facts ?? {};
  return {
    ref: refOf(refs),
    detail: joinPresent([facts.buyer, facts.brand, facts.description], ' · '),
    search: joinPresent([
      refs.piNumber, refs.piItemNo, refs.designRowId, refs.jobId, refs.requestType, refs.packagingType, refs.designCategory,
      facts.buyer, facts.brand, facts.description, step.actedBy, step.excuse, facts.holdReason, facts.delayReason,
      step.designer?.name, step.designer?.email,
    ], ' '),
  };
}

function detailOf(step) {
  const refs = step.refs ?? {};
  return {
    round: Number(step.round) || FIRST_ROUND,
    requestType: text(refs.requestType),
    packagingType: text(refs.packagingType),
    designCategory: text(refs.designCategory),
    piNumber: text(refs.piNumber),
    piItemNo: text(refs.piItemNo),
    designRowId: text(refs.designRowId),
    jobId: refs.jobId ? text(refs.jobId) : null,
    actedBy: text(step.actedBy),
    cylinderJob: step.cylinderJob === true,
  };
}

/** @returns {import('./types.js').DesignerMisStep} */
function toMisStep(step, { key, flow, excuseReason, person }) {
  return {
    id: step.stepId,
    flow,
    stepKey: key,
    code: step.stepKey,
    label: DESIGNER_STEP_LABELS[step.stepKey] ?? (text(step.label) || step.stepKey),
    plannedAt: step.plannedAt,
    actualAt: step.actualAt ?? null,
    delayMin: typeof step.delayMin === 'number' ? step.delayMin : null,
    doers: person ? [person] : [],
    status: step.status,
    excuse: excuseReason ? { reason: excuseReason, by: null, at: null } : null,
    delayReason: String(step.facts?.delayReason ?? '').trim(),
    refs: refsOf(step),
    design: detailOf(step),
  };
}

/** "1 step has", "3 steps have". */
const count = (n, noun) => `${n} ${noun}${n === 1 ? ' has' : 's have'}`;

function warningsOf(counts, noRule) {
  const warnings = [];
  noRule.forEach((n, key) => warnings.push(`${count(n, 'step')} no rule in the registry for '${key}' and ${n === 1 ? 'is' : 'are'} not listed.`));
  if (counts.noPlan > 0) warnings.push(`${count(counts.noPlan, 'step')} no planned time yet and cannot be placed in a period.`);
  return warnings;
}

const emptyCounts = () => ({ listed: 0, skipped: 0, notScored: 0, notRequired: 0, excluded: 0, noPlan: 0, noRule: 0 });

/**
 * One hr-erp row's fate: the MisStep it becomes, or the count it adds to.
 * @returns {{ row?: import('./types.js').DesignerMisStep, counted?: string, noRuleKey?: string }}
 */
function convertStep(step, { readRule, personOf }) {
  const key = designerStepKeyOf(step.flow, step.stepKey);
  const entry = readRule(key);
  if (!entry) return { noRuleKey: key ?? `${step.flow}:${step.stepKey}` };
  if (!entry.isScored) return { counted: 'notScored' };
  if (step.status === DESIGNER_STATUS.SKIPPED) return { counted: 'skipped' };
  const facts = designerStepFacts(step);
  if (!evaluate(entry.rule.requiredWhen ?? null, facts)) return { counted: 'notRequired' };
  const person = personOf(step.designer);
  const verdict = exclusionVerdict(entry.rule, step, facts, person);
  if (verdict.leftOut) return { counted: 'excluded' };
  if (!step.plannedAt) return { counted: 'noPlan' };
  return { row: toMisStep(step, { key, flow: entry.rule.flow, excuseReason: excuseReasonOf(step, verdict), person }) };
}

/**
 * @param {import('./types.js').DesignerStepsPayload|null} payload
 * @param {import('../rules/contract.js').Rules} rules
 * @param {{ profile?: string }} [options]  The profile `scoreIn` must name; the designer profile.
 * @returns {{
 *   steps: import('./types.js').DesignerMisStep[],
 *   roster: import('./designers.js').DesignerIdentity[],
 *   warnings: string[],
 *   error: string|null,
 *   counts: { listed: number, skipped: number, notScored: number, notRequired: number, excluded: number, noPlan: number,
 *     noRule: number },
 * }}  Every row sent lands in exactly one count.
 */
export function toDesignerMisSteps(payload, rules, { profile = DESIGNER_PROFILE } = {}) {
  const roster = designerRosterOf(rules, payload);
  const unreadable = unreadableDesignerRules(rules, profile);
  if (unreadable.length > 0) {
    return { steps: [], roster, warnings: [], error: unreadableRulesError(unreadable), counts: emptyCounts() };
  }

  const context = { readRule: ruleReader(rules, profile), personOf: createDesignerMatcher(roster) };
  const counts = emptyCounts();
  const noRule = new Map();
  const steps = [];
  for (const step of payload?.steps ?? []) {
    const { row, counted, noRuleKey } = convertStep(step, context);
    if (row) {
      steps.push(row);
      counts.listed += 1;
    } else if (counted) {
      counts[counted] += 1;
    } else {
      counts.noRule += 1;
      noRule.set(noRuleKey, (noRule.get(noRuleKey) ?? 0) + 1);
    }
  }

  const unapplied = unappliedDesignerExclusions(rules, profile).map(unappliedWarning);
  return { steps, roster, warnings: [...unapplied, ...warningsOf(counts, noRule)], error: null, counts };
}
