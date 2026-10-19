/* Settings shape (contract v3) + the same validation the server applies,
   so mock mode stores exactly what the server would. */
import { VOICE_DEFAULTS, sanitizeVoice } from './voice/voiceModel.js';

export const BOARD_IDS = ['purchase', 'purchase-people', 'purchase-leader', 'design', 'design-people', 'design-leader'];
export const BOARD_LABELS = {
  'purchase': 'Purchase MIS leaderboard',
  'purchase-people': 'Purchase · each person: score and delay',
  'purchase-leader': 'Purchase leader spotlight',
  'design': 'Designer MIS leaderboard',
  'design-people': 'Design · each person: score and delay',
  'design-leader': 'Designer leader spotlight',
};
/* The periods both MIS pages offer (engine/misPeriods.js). */
export const MIS_PERIODS = [
  { key: 'this-week', chip: 'This week' }, { key: 'last-week', chip: 'Last week' },
  { key: 'this-month', chip: 'This month' }, { key: 'last-month', chip: 'Last month' },
];
export const PURCHASE_PERIODS = MIS_PERIODS;
export const DESIGN_PERIODS = MIS_PERIODS;
const PERIOD_KEYS = MIS_PERIODS.map((p) => p.key);
/* The TV's earlier periods (rolling windows, Design Analytics presets), read as the nearest MIS period. */
export const LEGACY_PERIOD = Object.freeze({
  today: 'this-week', weekly: 'this-week', '7d': 'this-week',
  monthly: 'this-month', '30d': 'this-month', mtd: 'this-month', quarterly: 'this-month', qtr: 'this-month',
  halfyearly: 'this-month', yearly: 'this-month', all: 'this-month', custom: 'this-month',
  lastm: 'last-month',
});
export const periodOrLegacy = (key) => LEGACY_PERIOD[key] || key;
export const THEMES = ['dark', 'light', 'auto'];
export const TRANSITIONS = ['slide', 'fade', 'zoom', 'flip', 'wipe'];
export const LIMITS = { dwell: [3, 300], speed: [0.5, 2], rows: [0, 50], pageDwell: [3, 300] };

export const DEFAULT_SETTINGS = Object.freeze({
  version: 1,
  theme: 'dark',
  purchasePeriod: 'this-week',
  designPeriod: 'this-week',
  rotate: true,
  singleBoard: 'purchase',
  boards: [
    { id: 'purchase', enabled: true, dwellSec: 20 },
    { id: 'purchase-people', enabled: true, dwellSec: 40 },
    { id: 'purchase-leader', enabled: true, dwellSec: 8 },
    { id: 'design', enabled: true, dwellSec: 20 },
    { id: 'design-people', enabled: true, dwellSec: 30 },
    { id: 'design-leader', enabled: true, dwellSec: 8 },
  ],
  animation: { enabled: true, transition: 'slide', speed: 1 },
  rowsPerPage: 0,
  pageDwellSec: 8,
  showFilterBar: true,
  showTicker: true,
  voice: VOICE_DEFAULTS,
});

const inList = (v, list, fallback) => (list.includes(v) ? v : fallback);
const bool = (v, fallback) => (typeof v === 'boolean' ? v : fallback);
function num(v, [lo, hi], fallback, round = true) {
  const n = Number(v);
  if (v === null || v === undefined || v === '' || !Number.isFinite(n)) return fallback;
  const c = Math.min(hi, Math.max(lo, n));
  return round ? Math.round(c) : c;
}

/* A board list saved before a board existed gets it in its default place. */
export function withNewBoards(list) {
  const ids = list.map((b) => b && b.id);
  if (ids.some((id) => !BOARD_IDS.includes(id))) return list;
  const out = list.slice();
  BOARD_IDS.forEach((id, i) => {
    if (ids.includes(id)) return;
    const before = BOARD_IDS.slice(0, i).reverse().find((prev) => out.some((b) => b.id === prev));
    out.splice(before ? out.findIndex((b) => b.id === before) + 1 : 0, 0, { ...DEFAULT_SETTINGS.boards.find((b) => b.id === id) });
  });
  return out;
}

function cleanBoards(input, base) {
  if (!Array.isArray(input)) return base.map((b) => ({ ...b }));
  input = withNewBoards(input);
  base = withNewBoards(base);
  const ids = input.map((b) => b && b.id);
  const isPermutation = ids.length === BOARD_IDS.length && BOARD_IDS.every((id) => ids.includes(id));
  if (!isPermutation) return base.map((b) => ({ ...b }));
  return input.map((b) => {
    const prev = base.find((x) => x.id === b.id) || DEFAULT_SETTINGS.boards.find((x) => x.id === b.id);
    return { id: b.id, enabled: bool(b.enabled, prev.enabled), dwellSec: num(b.dwellSec, LIMITS.dwell, prev.dwellSec) };
  });
}

/** Merge a full or partial settings object onto `base`; unknown keys are dropped. */
export function sanitizeSettings(input, base = DEFAULT_SETTINGS) {
  const src = input && typeof input === 'object' ? input : {};
  const anim = { ...base.animation, ...(src.animation && typeof src.animation === 'object' ? src.animation : {}) };
  return {
    version: 1,
    theme: inList(src.theme, THEMES, base.theme),
    purchasePeriod: inList(periodOrLegacy(src.purchasePeriod), PERIOD_KEYS, inList(periodOrLegacy(base.purchasePeriod), PERIOD_KEYS, DEFAULT_SETTINGS.purchasePeriod)),
    designPeriod: inList(periodOrLegacy(src.designPeriod), PERIOD_KEYS, inList(periodOrLegacy(base.designPeriod), PERIOD_KEYS, DEFAULT_SETTINGS.designPeriod)),
    rotate: bool(src.rotate, base.rotate),
    singleBoard: inList(src.singleBoard, BOARD_IDS, inList(base.singleBoard, BOARD_IDS, DEFAULT_SETTINGS.singleBoard)),
    boards: cleanBoards(src.boards === undefined ? base.boards : src.boards, base.boards),
    animation: {
      enabled: bool(anim.enabled, base.animation.enabled),
      transition: inList(anim.transition, TRANSITIONS, base.animation.transition),
      speed: num(anim.speed, LIMITS.speed, base.animation.speed, false),
    },
    rowsPerPage: num(src.rowsPerPage, LIMITS.rows, base.rowsPerPage),
    pageDwellSec: num(src.pageDwellSec, LIMITS.pageDwell, base.pageDwellSec),
    showFilterBar: bool(src.showFilterBar, base.showFilterBar),
    showTicker: bool(src.showTicker, base.showTicker),
    voice: sanitizeVoice(src.voice, base.voice),
  };
}
