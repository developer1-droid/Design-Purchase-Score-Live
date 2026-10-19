// The periods both MIS pages offer (hr-erp's Purchase MIS and the CRM's Designer MIS): This week,
// Last week, This month, Last month — Monday-to-Sunday weeks and calendar months on the IST
// calendar (CRM lib/mis/period.js, ported unchanged from hr-erp lib/mis/period.ts).
import { MIS_PRESET, periodLabel, presetPeriod } from './crm/lib/mis/period.js';

export const MIS_PERIODS = [
  { key: MIS_PRESET.THIS_WEEK, label: 'This week' },
  { key: MIS_PRESET.LAST_WEEK, label: 'Last week' },
  { key: MIS_PRESET.THIS_MONTH, label: 'This month' },
  { key: MIS_PRESET.LAST_MONTH, label: 'Last month' },
];
export const MIS_PERIOD_KEYS = MIS_PERIODS.map((p) => p.key);
/* Both pages open on this week. */
export const MIS_DEFAULT_PERIOD = MIS_PRESET.THIS_WEEK;

/** { from, to } (IST days) of a period key as of `now`. */
export const misPeriodOf = (key, now) => presetPeriod(key, now);

/** The payload's period block: the chip's name and the page's own dates label ("12 – 18 Oct 2026"). */
export function periodInfo(key, period) {
  return { key, label: MIS_PERIODS.find((p) => p.key === key).label, from: period.from, to: period.to, dates: periodLabel(period) };
}
