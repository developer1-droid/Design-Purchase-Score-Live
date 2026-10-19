// Pulls every source the two boards need, keeps the last good copy of each (one failing endpoint
// should not blank the TV), builds every period of both boards and hands the payload to `onScores`.
//   purchase: hr-erp's Purchase MIS report for each period, as the CRM's /purchase-mis page frames it
//             (lib/purchaseSource.js), shaped by engine/purchaseMis.js
//   design:   what the CRM's Designer MIS page reads — the design requests, the report rules, the
//             office calendar, hr-erp's cylinder uploads (/api/designer-steps) and, for a closed week
//             or month, its frozen record (/api/mis/periods, read once) — scored by engine/designMis.js

import {
  MIS_PERIODS, computeDesignMisBoards, designerStepRanges, frozenDesignPeriodsWanted, misPeriodOf, purchaseBoardOf,
  purchasePeriodsOf, rangeKeyOf, DESIGNER_PROFILE,
} from '../engine/index.js';
import { createPurchaseSource } from './purchaseSource.js';

/* What the Designer MIS page loads (CRM, signed in). */
const CRM_SOURCES = {
  designRequests: '/api/design-requests',
  workCalendar: '/api/work-calendar',
  rules: '/api/rules/resolved',
};
const isRecord = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
/* A 200 answer can still be unusable; these make it count as a failed fetch. */
const CRM_CHECKS = {
  designRequests: (json) => (Array.isArray(json?.items) ? null : 'no items list in the response'),
  workCalendar: (json) => (Array.isArray(json?.holidays) ? null : 'no holidays list in the response'),
  // Rules with no profiles or steps could not say how anyone is scored.
  rules: (json) => (json?.success && isRecord(json.profiles) && isRecord(json.steps) ? null : 'report rules unavailable'),
};
const STEPS_TIMEOUT_MS = 100_000; // the CRM proxy waits on hr-erp (maxDuration 90 s)
const FROZEN_TIMEOUT_MS = 130_000; // a first read after a period closes builds the record (maxDuration 120 s)
const stepsPath = (range) => `/api/designer-steps?from=${range.from}&to=${range.to}`;
const frozenPath = (period) => `/api/mis/periods?from=${period.from}&to=${period.to}&profile=${DESIGNER_PROFILE}`;
const errorText = (err) => err?.message || String(err);

function checked(json, check) {
  const problem = check(json);
  if (problem) throw new Error(problem);
  return json;
}

export function createPoller({ client, pollSeconds, onScores, purchaseSource = createPurchaseSource({ client }) }) {
  const lastGood = {};
  const cylinder = {}; // 'from|to' -> the last good /api/designer-steps payload of that window
  const frozen = {}; // 'from_to' -> the CRM's frozen designer record: written once, never changed, so read once
  const purchaseBoards = {}; // period key -> the last good board of that key's current window
  let designReadAt = null;
  let latest = null;
  let timer = null;
  let inFlight = null;

  async function load(name, task, sources, errors) {
    try {
      lastGood[name] = await task();
      sources[name] = 'ok';
      return true;
    } catch (err) {
      sources[name] = lastGood[name] !== undefined ? 'stale' : 'error';
      errors.push(`${name}: ${errorText(err)}`);
      return false;
    }
  }

  /* hr-erp's cylinder uploads for each window the periods need; a window that fails keeps its last good copy. */
  async function loadCylinder(now, sources, errors) {
    const ranges = designerStepRanges(now);
    const states = await Promise.all(ranges.map(async (range) => {
      const key = rangeKeyOf(range);
      try {
        const json = await client.getJson(stepsPath(range), { timeoutMs: STEPS_TIMEOUT_MS });
        if (!Array.isArray(json?.steps)) throw new Error('no steps list in the response');
        // hr-erp's own failure note comes as an empty list with an `error`: keep the last good list then.
        if (json.error && cylinder[key]) throw new Error(String(json.error));
        cylinder[key] = json;
        return 'ok';
      } catch (err) {
        errors.push(`designerSteps ${key}: ${errorText(err)}`);
        return cylinder[key] ? 'stale' : 'error';
      }
    }));
    const wanted = new Set(ranges.map(rangeKeyOf));
    Object.keys(cylinder).forEach((key) => { if (!wanted.has(key)) delete cylinder[key]; });
    sources.designerSteps = states.includes('error') ? 'error' : states.includes('stale') ? 'stale' : 'ok';
  }

  async function loadFrozen(now, errors) {
    const rules = lastGood.rules;
    if (!rules) return;
    for (const { key, period } of frozenDesignPeriodsWanted(rules, now)) {
      if (frozen[key]) continue;
      try {
        const json = await client.getJson(frozenPath(period), { timeoutMs: FROZEN_TIMEOUT_MS });
        const record = json?.records?.[DESIGNER_PROFILE];
        if (!json?.success || !record?.board) throw new Error('the CRM sent no frozen record');
        frozen[key] = record;
      } catch (err) {
        // The board is then scored live, and says so (period.frozenMissing).
        errors.push(`frozen designer ${key}: ${errorText(err)}`);
      }
    }
  }

  function buildDesign(now, errors) {
    const previous = latest?.design ?? null;
    if (!lastGood.designRequests || !lastGood.rules) return previous;
    try {
      const { periods, byPeriod, failed } = computeDesignMisBoards({
        designRequests: lastGood.designRequests,
        readAt: designReadAt,
        rules: lastGood.rules,
        workCalendar: lastGood.workCalendar ?? null,
        cylinder,
        frozen,
      }, { now });
      failed.forEach(({ key, error }) => {
        errors.push(`design engine (${key}): ${error}`);
        if (previous?.byPeriod[key]) byPeriod[key] = previous.byPeriod[key];
      });
      return { periods, byPeriod };
    } catch (err) {
      errors.push(`design engine: ${errorText(err)}`);
      return previous;
    }
  }

  /* One period at a time: each read makes hr-erp build that period's whole MIS. */
  async function loadPurchase(now, sources, errors) {
    for (const { key, label } of MIS_PERIODS) {
      const period = misPeriodOf(key, now);
      const name = `purchase.${key}`;
      const held = purchaseBoards[key];
      // A board held for last week's "This week" must not show under this week's label.
      if (held && (held.period.from !== period.from || held.period.to !== period.to)) delete purchaseBoards[key];
      try {
        const { report, via, note } = await purchaseSource.load(period, label);
        purchaseBoards[key] = purchaseBoardOf(key, report, { via, readAt: now.toISOString() });
        sources[name] = 'ok';
        if (note) errors.push(`${name}: ${note}`);
      } catch (err) {
        sources[name] = purchaseBoards[key] ? 'stale' : 'error';
        errors.push(`${name}: ${errorText(err)}`);
      }
    }
    if (!Object.keys(purchaseBoards).length) return null;
    return { periods: purchasePeriodsOf(purchaseBoards), byPeriod: { ...purchaseBoards } };
  }

  async function loadDesign(now, sources, errors) {
    await Promise.all(Object.entries(CRM_SOURCES).map(([name, path]) =>
      load(name, async () => checked(await client.getJson(path), CRM_CHECKS[name]), sources, errors)
        .then((ok) => { if (ok && name === 'designRequests') designReadAt = new Date().toISOString(); })));
    await Promise.all([loadCylinder(now, sources, errors), loadFrozen(now, errors)]);
  }

  async function run() {
    const errors = [];
    const sources = {};
    const now = new Date();
    const [, purchase] = await Promise.all([loadDesign(now, sources, errors), loadPurchase(now, sources, errors)]);
    latest = {
      updatedAt: new Date().toISOString(),
      pollSeconds,
      status: { ok: false, errors, sources },
      purchase: purchase ?? latest?.purchase ?? null,
      design: buildDesign(now, errors),
    };
    latest.status.ok = errors.length === 0;
    onScores(latest);
    if (errors.length) console.error(`[pd-live] ${now.toISOString()} ${errors.join(' | ')}`);
  }

  /** One poll; a caller that arrives while one is running waits for that one. */
  function tick() {
    if (!inFlight) inFlight = run().finally(() => { inFlight = null; });
    return inFlight;
  }

  const safeTick = () => tick().catch((err) => console.error(`[pd-live] poll failed: ${errorText(err)}`));

  return {
    start() {
      safeTick();
      timer = setInterval(safeTick, pollSeconds * 1000);
    },
    stop() {
      clearInterval(timer);
    },
    refresh: tick,
    latest: () => latest,
  };
}
