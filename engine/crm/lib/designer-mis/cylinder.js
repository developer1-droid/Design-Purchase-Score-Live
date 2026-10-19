// VERBATIM COPY of CRM lib/designer-mis/cylinder.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/designer-mis/cylinder.js
//
// The designer's cylinder design upload (C1) from hr-erp, beside the design
// requests' own design work (lib/designer-mis/design-requests.js): the
// Designer MIS counts both (owner, 16 Oct 2026). Only C1 is taken from hr-erp
// — its D2 design work is the design requests' DW, and would be counted twice.
// The registry's C1 rule decides the rest (lib/designer-mis/steps.js): only
// where hr-erp opened a cylinder job, and never a buyer-provided design, a
// rejected PI or a redo round that was not the designer's fault.
//
// A failed read of hr-erp is a warning beside the design work, never the
// board's failure: the design requests still stand on their own.
//
// Pure; lib/__tests__/designer-mis-cylinder.test.js.

import { toDesignerMisSteps } from './steps.js';
import { DESIGNER_STEP, designerStepKeyOf } from './types.js';

const CYLINDER_FLOW = 'cylinder';
export const CYLINDER_UPLOAD_KEY = designerStepKeyOf(CYLINDER_FLOW, DESIGNER_STEP.DESIGN_UPLOAD);
export const CYLINDER_UPLOAD_LABEL = 'Cylinder design upload';

const isCylinderUpload = (step) => step?.flow === CYLINDER_FLOW && step?.stepKey === DESIGNER_STEP.DESIGN_UPLOAD;

/** hr-erp's payload narrowed to the cylinder design uploads. */
export function cylinderUploadsOf(payload) {
  return { ...payload, steps: (payload?.steps ?? []).filter(isCylinderUpload) };
}

/**
 * The cylinder uploads as Designer MIS steps, or null with no payload yet.
 * @param {object|null} payload  GET /api/designer-steps (lib/designer-mis/proxy.js).
 * @param {object} rules
 */
export function cylinderConversion(payload, rules) {
  if (!payload) return null;
  const conversion = toDesignerMisSteps(cylinderUploadsOf(payload), rules);
  const failure = [payload.error, conversion.error].filter(Boolean).join(' ');
  return {
    ...conversion,
    error: null,
    warnings: [...(failure ? [`The cylinder uploads could not be read from hr-erp: ${failure}`] : []), ...conversion.warnings],
  };
}

/**
 * The design work and the cylinder uploads as one conversion: every step and
 * warning, the roster merged by email (the design requests' first). The
 * design requests' counts stay the report's counts; the uploads' ride beside
 * them as `cylinderCounts`.
 */
export function mergeConversions(designWork, uploads) {
  if (!uploads) return designWork;
  const known = new Set(designWork.roster.map((identity) => identity.email));
  return {
    steps: [...designWork.steps, ...uploads.steps],
    roster: [...designWork.roster, ...uploads.roster.filter((identity) => !known.has(identity.email))],
    warnings: [...designWork.warnings, ...uploads.warnings],
    error: designWork.error,
    counts: designWork.counts,
    cylinderCounts: uploads.counts,
  };
}
