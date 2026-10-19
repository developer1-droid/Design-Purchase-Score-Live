// VERBATIM COPY of CRM lib/design-fault.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
/**
 * Whose fault a design revision was — the choice the reviewer makes when they
 * disapprove.
 *
 * This used to be a single boolean, `Is Buyers Fault`, asked only at the buyer
 * and management gates. Two problems with that, both of which cost real data:
 *
 *   1. Two answers only. A rejection caused by OUR OWN brief — wrong pack size,
 *      importer details never confirmed, variety copied off the previous order —
 *      had to be filed as either the buyer's or the designer's, and both are
 *      wrong. It is CRM's, and now that is sayable.
 *   2. One column per ROW, overwritten by the next rejection. A request that
 *      bounced four times kept only the fourth answer; the first three were
 *      gone. The choice now also goes into that revision's own Version History
 *      entry, where nothing can overwrite it.
 *
 * The sheet column stays written for back-compat (hr-erp and older readers key
 * off it), with CRM's fault recorded there as FALSE — it is not the buyer's.
 * Anything that needs the real answer reads Version History.
 *
 * The designer's clock is the other thing this drives: it restarts unless the
 * designer is the one who got it wrong. That was already true for the buyer and
 * is equally true for CRM — a designer should not carry delay for a brief they
 * were handed.
 */

export const FAULT_BUYER = 'buyer';
export const FAULT_DESIGNER = 'designer';
export const FAULT_CRM = 'crm';

export const FAULT_PARTIES = [FAULT_BUYER, FAULT_DESIGNER, FAULT_CRM];

export const FAULT_LABELS = {
  [FAULT_BUYER]: "Buyer's Fault",
  [FAULT_DESIGNER]: "Designer's Fault",
  [FAULT_CRM]: 'CRM / Our Brief',
};

/** Option list for the disapproval modal — order and wording live here, once. */
export const FAULT_OPTIONS = [
  {
    id: FAULT_BUYER,
    label: FAULT_LABELS[FAULT_BUYER],
    hint: 'Buyer changed their mind. Designer clock restarts.',
    tone: 'amber',
  },
  {
    id: FAULT_DESIGNER,
    label: FAULT_LABELS[FAULT_DESIGNER],
    hint: 'Artwork did not match the brief. Delay keeps accumulating.',
    tone: 'rose',
  },
  {
    id: FAULT_CRM,
    label: FAULT_LABELS[FAULT_CRM],
    hint: 'Spec or information from our side was wrong or missing. Designer clock restarts.',
    tone: 'sky',
  },
];

/** A value we are willing to store, or null. Never throws — callers get null. */
export const normalizeFault = (value) => {
  const v = String(value ?? '').trim().toLowerCase();
  return FAULT_PARTIES.includes(v) ? v : null;
};

/**
 * Does the designer get a fresh clock for the redo?
 *
 * Yes for everything except their own mistake. `null` (nobody said) leaves the
 * clock alone — guessing here would silently erase or invent delay.
 */
export const resetsDesignerClock = (fault) => {
  const f = normalizeFault(fault);
  return f === FAULT_BUYER || f === FAULT_CRM;
};

/** What the legacy `Is Buyers Fault` column should hold for this choice. */
export const legacyIsBuyersFault = (fault) => normalizeFault(fault) === FAULT_BUYER;

/** Read the legacy column back. 'TRUE' → buyer, 'FALSE' → designer, blank → null. */
export const faultFromLegacyFlag = (raw) => {
  const v = String(raw ?? '').trim().toLowerCase();
  if (v === 'true') return FAULT_BUYER;
  if (v === 'false') return FAULT_DESIGNER;
  return null;
};

/**
 * Accept either shape from an API caller: the new `faultParty` string, or the
 * old `isBuyersFault` boolean a stale browser tab may still be sending.
 */
export const faultFromPayload = ({ faultParty, isBuyersFault } = {}) => {
  const explicit = normalizeFault(faultParty);
  if (explicit) return explicit;
  if (isBuyersFault === true) return FAULT_BUYER;
  if (isBuyersFault === false) return FAULT_DESIGNER;
  return null;
};
