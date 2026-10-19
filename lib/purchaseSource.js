// hr-erp's Purchase MIS report for a period, read the way the CRM shows it to the TV's login:
// the CRM's /purchase-mis page frames hr-erp's /embed/mis-report with a short-lived token it
// signs for that user (CRM app/(app)/purchase-mis/page.jsx, purchase_mis.view); hr-erp builds the
// report on its server (lib/mis/load.server.ts loadMis) and hands it to the page as one prop, so
// the TV reads that prop out of the page — the same report object the page draws, team line,
// doers and steps. When the page cannot be read (or read whole), hr-erp's per-doer scores from
// the same loadMis (/embed/pc-score, through the CRM's GET /api/purchase-mis-score) stand in.

import { VIA_PAGE, VIA_SCORES, reportFromScores } from '../engine/purchaseMis.js';

const EMBED_TIMEOUT_MS = 100_000; // hr-erp gives loadMis up to 60 s on a cold cache
const SCORES_TIMEOUT_MS = 100_000; // the CRM proxy waits 65 s on hr-erp
/* The CRM signs the frame's token for 30 minutes; a new one is taken well before it runs out. */
const TOKEN_MARGIN_S = 5 * 60;
/* The frame's address, in the page's HTML or in its flight data (where quotes come escaped):
   the origin and the token are all that is needed, so it is cut at the first quote or backslash. */
const IFRAME_SRC = /(https?:\/\/[^"'\\\s<>]+\/embed\/mis-report\?[^"'\\\s<>]+)/;
const FLIGHT_CHUNK = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g;
const REPORT_PROP = '{"report":';

const htmlDecode = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'");

/** Index just past the JSON value that starts at `start` (an object or array), or -1. */
function endOfJson(text, start) {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i += 1;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') depth += 1;
    else if (ch === '}' || ch === ']') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/* React's flight format: a string that starts with "$" is sent as "$$…", undefined as "$undefined";
   any other "$…" is a reference to data sent elsewhere, which this reader does not follow (read as
   null, so checkedReport refuses a report whose numbers came that way). */
function unflight(value) {
  if (typeof value === 'string') {
    if (value === '$undefined') return undefined;
    if (value.startsWith('$$')) return value.slice(1);
    return value.startsWith('$') ? null : value;
  }
  if (Array.isArray(value)) return value.map(unflight);
  if (value && typeof value === 'object') {
    const out = {};
    Object.entries(value).forEach(([k, v]) => {
      const next = unflight(v);
      if (next !== undefined) out[k] = next;
    });
    return out;
  }
  return value;
}

/** The `report` prop of hr-erp's /embed/mis-report page, or null when the page holds none. Pure. */
export function reportFromEmbedHtml(html) {
  let flight = '';
  for (const m of String(html).matchAll(FLIGHT_CHUNK)) flight += JSON.parse(m[1]);
  const at = flight.indexOf(REPORT_PROP);
  if (at < 0) return null;
  const start = at + REPORT_PROP.length;
  if (flight[start] !== '{') return null;
  const end = endOfJson(flight, start);
  if (end < 0) return null;
  return unflight(JSON.parse(flight.slice(start, end)));
}

const isCount = (v) => typeof v === 'number' && Number.isFinite(v);
const COUNTS = ['planned', 'done', 'onTime', 'late', 'notDone', 'carryover', 'backlog'];
const isTally = (t) => Boolean(t) && COUNTS.every((k) => isCount(t[k]));

/** A report of the asked period, whole: or a throw saying what is wrong. */
export function checkedReport(report, period) {
  if (!report) throw new Error('the MIS page held no report');
  if (!report.period || report.period.from !== period.from || report.period.to !== period.to) {
    throw new Error(`the MIS page answered for ${report.period ? `${report.period.from}..${report.period.to}` : 'no period'}`);
  }
  if (!isTally(report.team)) throw new Error('the MIS page sent no whole team line');
  if (!Array.isArray(report.doers) || !report.doers.every((d) => d && typeof d.doer === 'string' && isTally(d))) {
    throw new Error('the MIS page sent no whole doers list');
  }
  if (report.steps !== undefined && !Array.isArray(report.steps)) throw new Error('the MIS page sent no steps list');
  return report;
}

/** Seconds since 1970 when a frame token runs out (its first part), or 0. */
const tokenExpiry = (src) => {
  try {
    return Number(String(new URL(src).searchParams.get('token') || '').split('.')[0]) || 0;
  } catch {
    return 0;
  }
};

/**
 * @param client  lib/crmClient.js (getJson, getText, relogin)
 * @returns {{ load(period: {from,to}, label: string): Promise<{ report, via, note? }> }}
 */
export function createPurchaseSource({ client, fetchImpl = fetch }) {
  let frame = null; // { src, expiresAt } — the CRM page's frame address, token included

  async function frameSrc({ fresh = false } = {}) {
    const nowS = Date.now() / 1000;
    if (!fresh && frame && frame.expiresAt - TOKEN_MARGIN_S > nowS) return frame.src;
    let html = await client.getText('/purchase-mis');
    let m = IFRAME_SRC.exec(html);
    if (!m) {
      // A session the CRM no longer knows gets its login page here, not a 401: sign in again, once.
      await client.relogin();
      html = await client.getText('/purchase-mis');
      m = IFRAME_SRC.exec(html);
    }
    if (!m) {
      const said = /No access to the Purchase MIS|not configured/i.exec(html);
      throw new Error(said ? `CRM /purchase-mis: ${said[0]}` : 'CRM /purchase-mis has no MIS frame');
    }
    const src = htmlDecode(m[1]);
    frame = { src, expiresAt: tokenExpiry(src) };
    return src;
  }

  async function fromPage(period) {
    for (const fresh of [false, true]) {
      const url = new URL(await frameSrc({ fresh }));
      url.searchParams.set('from', period.from);
      url.searchParams.set('to', period.to);
      url.searchParams.delete('doer');
      const res = await fetchImpl(url, { cache: 'no-store', signal: AbortSignal.timeout(EMBED_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`hr-erp /embed/mis-report -> HTTP ${res.status}`);
      const html = await res.text();
      const report = reportFromEmbedHtml(html);
      // An expired or refused token gets a page with no report: take a new token, once.
      if (!report && !fresh && /invalid or expired embed token/i.test(html)) continue;
      return checkedReport(report, period);
    }
    throw new Error('hr-erp refused the MIS frame token');
  }

  async function fromScores(period, label) {
    const json = await client.getJson(`/api/purchase-mis-score?start=${period.from}&end=${period.to}`, { timeoutMs: SCORES_TIMEOUT_MS });
    if (!Array.isArray(json && json.coordinators)) throw new Error('no coordinators list');
    if (json.error && !json.coordinators.length) throw new Error(String(json.error));
    return reportFromScores(period, label, json);
  }

  return {
    async load(period, label) {
      try {
        return { report: await fromPage(period), via: VIA_PAGE };
      } catch (pageErr) {
        try {
          return { report: await fromScores(period, label), via: VIA_SCORES, note: `MIS page: ${pageErr.message}` };
        } catch (scoresErr) {
          throw new Error(`MIS page: ${pageErr.message}; scores: ${scoresErr.message}`);
        }
      }
    },
  };
}
