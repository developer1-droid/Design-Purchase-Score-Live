// VERBATIM COPY of CRM lib/designer-mis/designers.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/designer-mis/designers.js
//
// Who a designer step is scored to. The registry (lib/rules designers: email,
// name, aliases) names the designers the owner knows (decision #21: Arun,
// Manoj and Rishabh Rawat, by their HR-ERP user); hr-erp's payload names the
// designers its own roster has. The two are matched by email, lower-case:
//
//   • a designer in both keeps the registry's name — the owner's spelling;
//   • a designer only hr-erp knows is kept as their own row, never dropped —
//     a person the registry has not listed yet is a gap to fill, not work to
//     hide;
//   • a step with no designer is nobody's, and the engine scores it to
//     "Unassigned" (lib/mis/doers.js).
//
// Pure.

const emailKey = (email) => String(email ?? '').trim().toLowerCase();
const nameKey = (name) => String(name ?? '').trim().toLowerCase();

export const DESIGNER_SOURCE = Object.freeze({ REGISTRY: 'registry', HRERP: 'hrerp', BOTH: 'both' });

/**
 * @typedef {object} DesignerIdentity
 * @property {string} email    Lower-case; the identity a step is scored to.
 * @property {string} name     The registry's name when it knows the person, else hr-erp's.
 * @property {string[]} aliases  The registry's other spellings of the name, lower-case.
 * @property {'registry'|'hrerp'|'both'} source
 */

/**
 * The designers the page shows: the registry's, with hr-erp's roster matched
 * in by email, in the registry's order and then hr-erp's.
 * @param {{ designers?: { email: string, name: string, aliases?: string[] }[] }|null} rules
 * @param {{ designers?: { email: string, name: string }[] }|null} payload
 * @returns {DesignerIdentity[]}
 */
export function designerRosterOf(rules, payload) {
  const byEmail = new Map();
  for (const designer of rules?.designers ?? []) {
    const email = emailKey(designer.email);
    if (!email || byEmail.has(email)) continue;
    const aliases = (Array.isArray(designer.aliases) ? designer.aliases : []).map(nameKey).filter(Boolean);
    byEmail.set(email, { email, name: String(designer.name ?? '').trim() || email, aliases, source: DESIGNER_SOURCE.REGISTRY });
  }
  for (const designer of payload?.designers ?? []) {
    const email = emailKey(designer.email);
    if (!email) continue;
    const known = byEmail.get(email);
    if (known) {
      known.source = DESIGNER_SOURCE.BOTH;
      continue;
    }
    byEmail.set(email, { email, name: String(designer.name ?? '').trim() || email, aliases: [], source: DESIGNER_SOURCE.HRERP });
  }
  return [...byEmail.values()];
}

const personOf = (identity) => ({ email: identity.email, name: identity.name });

/**
 * A matcher from a step's `designer` to the person it is scored to: by email
 * first, then by name or alias for a row hr-erp could only name. A designer
 * neither list holds is still their own person when they have an email. Null
 * when there is nobody to score — the engine's "Unassigned".
 * @param {ReadonlyArray<DesignerIdentity>} roster
 * @returns {(designer: { email?: string, name?: string }|null|undefined) => import('../mis/types.js').MisPerson|null}
 */
export function createDesignerMatcher(roster) {
  const byEmail = new Map(roster.map((identity) => [identity.email, identity]));
  const byName = new Map();
  for (const identity of roster) {
    [identity.name, ...identity.aliases].map(nameKey).filter(Boolean).forEach((name) => {
      if (!byName.has(name)) byName.set(name, identity);
    });
  }
  return (designer) => {
    if (!designer) return null;
    const email = emailKey(designer.email);
    const known = (email && byEmail.get(email)) || byName.get(nameKey(designer.name));
    if (known) return personOf(known);
    if (!email) return null;
    return { email, name: String(designer.name ?? '').trim() || email };
  };
}
