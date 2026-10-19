/* Reading the /api/scores payload: { purchase: {periods, byPeriod}, design: {periods, byPeriod} },
   each board as engine/purchaseMis.js and engine/designMis.js shape it. */
import { MIS_PERIODS } from './settingsModel.js';

function pick(section, key) {
  if (!section || !section.byPeriod) return null;
  return section.byPeriod[key] || null;
}

export const purchaseBoard = (data, key) => pick(data && data.purchase, key);
export const designBoard = (data, key) => pick(data && data.design, key);

/** The header's period: the chip's name and the page's dates ("This week · 12 – 18 Oct 2026"). kind = 'purchase' | 'design'. */
export function periodLabel(kind, data, key) {
  const board = kind === 'design' ? designBoard(data, key) : purchaseBoard(data, key);
  const chip = (MIS_PERIODS.find((p) => p.key === key) || {}).chip || key;
  const dates = board && board.period && board.period.dates;
  return dates ? `${chip} · ${dates}` : chip;
}
