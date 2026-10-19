// VERBATIM COPY of CRM lib/designer-mis/facts.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/designer-mis/facts.js
//
// A designer step's facts, as the registry's conditions read them
// (lib/rules/conditions.js FACT_CATALOGUE.hrerpDesign / hrerpCylinder):
// requestType, isHelpTicket, isExhibitionPoster, designCategory, packagingType,
// buyerProvided, cylinderJob, revisionFault, piStatus and the owner's role.
//
// hr-erp sends the row's values; this reads them into the typed facts the
// conditions compare. Text stays as sent (the conditions compare trimmed and
// case-blind); booleans are true or false, never 'Yes'. Facts hr-erp does not
// send (piApprovedAt, country) are left out, so a condition on them reads
// "missing" rather than a made-up value.
//
// Pure.

import { ROLE } from '../team-roles.js';

const HELP_TICKET = 'help ticket';
const EXHIBITION = 'exhibition';

const text = (value) => String(value ?? '').trim();
const isType = (requestType, type) => requestType.toLowerCase() === type;

/**
 * @param {import('./types.js').DesignerStep} step
 * @returns {Object<string, string|boolean>}
 */
export function designerStepFacts(step) {
  const refs = step.refs ?? {};
  const facts = step.facts ?? {};
  const requestType = text(refs.requestType);
  return {
    role: ROLE.DESIGNER,
    requestType,
    isHelpTicket: isType(requestType, HELP_TICKET),
    isExhibitionPoster: isType(requestType, EXHIBITION),
    designCategory: text(refs.designCategory),
    packagingType: text(refs.packagingType),
    buyerProvided: refs.buyerProvided === true,
    cylinderJob: step.cylinderJob === true,
    revisionFault: text(facts.fault),
    piStatus: text(refs.piStatus),
  };
}
