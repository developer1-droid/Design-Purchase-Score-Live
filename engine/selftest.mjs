// Builds every period of both boards from saved answers and checks them.
//   npm run selftest                         → engine/sample/ (clock pinned to sample/meta.json)
//   LIVE_DIR=<dir> node engine/selftest.mjs  → answers saved by `node tools/fetch-crm.mjs samples <dir>`
// Purchase: hr-erp's own report (the page's prop) must come through unchanged — team line, ranks,
// counts, the signed % as the page prints it. Design: the CRM's Designer MIS code over the saved
// reads; a closed period is compared with the record the CRM froze (computed by the CRM itself).
process.env.TZ = 'Asia/Kolkata';
const path = await import('node:path');
const fs = await import('node:fs');
const { fileURLToPath } = await import('node:url');
const here = path.dirname(fileURLToPath(import.meta.url));
const {
  MIS_PERIODS, computeDesignMisBoards, designerStepRanges, frozenDesignPeriodsWanted, misGrade, missPct, misPeriodOf,
  purchaseBoardOf, rangeKeyOf, teamAvgDelayMin,
} = await import('./index.js');
const { fmtPct } = await import('./crm/lib/mis/format.js');
const { normalize, DEFAULT_SETTINGS } = await import('../lib/settings.js');
const { boardLines, personLines, summaryLines } = await import('../public/js/voice/script.js');
const { VOICE_DEFAULTS } = await import('../public/js/voice/voiceModel.js');

const dir = path.resolve(process.env.LIVE_DIR || path.join(here, 'sample'));
const read = (rel) => {
  const file = path.join(dir, rel);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
};
const meta = read('meta.json') || {};
const now = new Date(process.env.NOW || meta.now || Date.now());

let failures = 0;
let checks = 0;
function check(ok, message) {
  checks += 1;
  if (!ok) {
    failures += 1;
    console.error(`  FAIL ${message}`);
  }
}
const COUNTS = ['planned', 'done', 'onTime', 'late', 'notDone', 'carryover', 'backlog'];
const sumOf = (t) => `${t.planned}/${t.onTime}/${t.late}/${t.notDone}/bk${t.backlog}`;
const line = (p) => `  ${String(p.rank ?? '-').padStart(2)} ${p.name.padEnd(16)} ${String(p.scoreText).padStart(7)} ${(p.grade || '').padEnd(1)}  due ${String(p.steps).padStart(3)}`
  + `${p.upcoming ? ` (+${p.upcoming})` : ''}  on ${p.onTime} late ${p.late} not done ${p.overdue}  backlog ${p.pending} (carried ${p.carryover})  delay ${p.avgDelayLabel || '—'}`
  + `${p.worstStep ? `  misses ${p.worstStep.code} ${p.worstStep.missed}/${p.worstStep.planned}` : ''}`;

console.log(`samples ${dir}\nnow     ${now.toISOString()} (TZ ${process.env.TZ})\n`);

/* ---------------- Purchase MIS ---------------- */
const purchaseBoards = {};
MIS_PERIODS.forEach(({ key }) => {
  const saved = read(path.join('purchase', `${key}.json`));
  if (!saved) { console.log(`PURCHASE ${key}: no sample`); return; }
  const { report, via } = saved;
  const period = misPeriodOf(key, now);
  check(report.period.from === period.from && report.period.to === period.to, `purchase ${key}: sample is for ${report.period.from}..${report.period.to}, the clock says ${period.from}..${period.to}`);
  const board = purchaseBoardOf(key, report, { via });
  purchaseBoards[key] = board;
  const s = board.summary;
  console.log(`PURCHASE · ${board.period.label} · ${board.period.dates} · via ${via}`);
  console.log(`  TEAM ${s.scoreText} ${s.grade}  ${s.missed} of ${s.steps} not on time · on ${s.onTime} late ${s.late} not done ${s.overdue} · work not done ${s.notDoneText} · pending ${s.pending} (carried ${s.carryover}) · not due yet ${s.upcoming} · avg delay ${s.avgDelayLabel || '—'}`);
  board.people.forEach((p) => console.log(line(p)));
  // The page's numbers, untouched.
  const t = report.team;
  check(s.steps === t.planned && s.onTime === t.onTime && s.late === t.late && s.overdue === t.notDone && s.pending === t.backlog && s.carryover === t.carryover,
    `purchase ${key}: team line ${sumOf(t)} not shown as sent`);
  check(t.planned === t.onTime + t.late + t.notDone && t.backlog === t.notDone + t.carryover, `purchase ${key}: team counts do not add up (${sumOf(t)})`);
  check(t.notOnTimePct === missPct(t.planned - t.onTime, t.planned) && s.scoreText === fmtPct(t.notOnTimePct), `purchase ${key}: team score ${t.notOnTimePct} / ${s.scoreText}`);
  check(s.grade === misGrade(t.notOnTimePct), `purchase ${key}: team grade`);
  check(s.avgDelayMin === teamAvgDelayMin(report.steps), `purchase ${key}: team delay`);
  check(board.people.length === report.doers.length, `purchase ${key}: ${report.doers.length} doers, ${board.people.length} shown`);
  report.doers.forEach((d, i) => {
    const p = board.people[i];
    check(p && p.name === d.doer, `purchase ${key}: doer ${i + 1} is ${d.doer}, the board shows ${p && p.name}`);
    if (!p) return;
    check(COUNTS.every((k) => typeof d[k] === 'number'), `purchase ${key}: ${d.doer} counts missing`);
    check(p.steps === d.planned && p.onTime === d.onTime && p.late === d.late && p.overdue === d.notDone && p.pending === d.backlog, `purchase ${key}: ${d.doer} counts not shown as sent`);
    check(d.notOnTimePct === missPct(d.planned - d.onTime, d.planned) && p.scoreText === fmtPct(d.notOnTimePct ?? null), `purchase ${key}: ${d.doer} score`);
    check(d.planned > 0 ? p.rank === d.rank : p.rank === null, `purchase ${key}: ${d.doer} rank`);
    if (i > 0 && d.planned > 0) check((report.doers[i - 1].notOnTimePct ?? -Infinity) >= d.notOnTimePct, `purchase ${key}: ranked out of order at ${d.doer}`);
  });
  console.log('');
});

/* ---------------- Designer MIS ---------------- */
const designRequests = read('design-requests.json');
const rules = read('rules.json');
const workCalendar = read('work-calendar.json');
let design = null;
if (!designRequests || !rules) {
  console.log('DESIGN: no sample');
} else {
  const cylinder = {};
  designerStepRanges(now).forEach((r) => {
    const payload = read(path.join('designer-steps', `${r.from}_${r.to}.json`));
    check(Boolean(payload), `design: no designer-steps sample for ${r.from}..${r.to}`);
    if (payload) cylinder[rangeKeyOf(r)] = payload;
  });
  const frozen = {};
  frozenDesignPeriodsWanted(rules, now).forEach(({ key }) => {
    const record = read(path.join('frozen', `${key}.json`));
    if (record) frozen[key] = record;
  });
  const raw = { designRequests, readAt: meta.readAt || now.toISOString(), rules, workCalendar, cylinder };
  design = computeDesignMisBoards({ ...raw, frozen }, { now });
  const live = computeDesignMisBoards({ ...raw, frozen: {} }, { now });
  check(design.failed.length === 0, `design engine failed: ${design.failed.map((f) => `${f.key}: ${f.error}`).join('; ')}`);
  MIS_PERIODS.forEach(({ key }) => {
    const board = design.byPeriod[key];
    if (!board) { check(false, `design ${key} not built`); return; }
    const s = board.summary;
    console.log(`DESIGN · ${board.period.label} · ${board.period.dates}${board.period.frozenAt ? ` · frozen ${board.period.frozenAt}` : ''}${board.period.frozenMissing ? ' · frozen record missing: live' : ''}`);
    console.log(`  TEAM ${s.scoreText} ${s.grade || ''}  ${s.missed} of ${s.steps} not on time · on ${s.onTime} late ${s.late} not done ${s.overdue} · pending ${s.pending} (carried ${s.carryover}) · avg delay ${s.avgDelayLabel || '—'}`);
    board.people.filter((p) => p.steps > 0 || p.pending > 0).forEach((p) => console.log(line(p)));
    if (board.idle.length) console.log(`  Nothing due: ${board.idle.join(', ')}`);
    board.warnings.forEach((w) => console.log(`  note: ${w}`));
    check(s.steps === s.onTime + s.late + s.overdue, `design ${key}: team counts do not add up`);
    check(s.score === missPct(s.steps - s.onTime, s.steps) && s.scoreText === fmtPct(s.score), `design ${key}: team score ${s.score} / ${s.scoreText}`);
    const ranked = board.people.filter((p) => p.rank !== null);
    ranked.forEach((p, i) => {
      check(p.rank === i + 1, `design ${key}: ${p.name} rank ${p.rank} at place ${i + 1}`);
      check(p.score === missPct(p.steps - p.onTime, p.steps), `design ${key}: ${p.name} score`);
      if (i > 0) check(ranked[i - 1].score >= p.score, `design ${key}: ranked out of order at ${p.name}`);
    });
    // A closed period: the CRM's own frozen board against this engine's live board over the same reads.
    if (board.period.frozenAt) {
      const l = live.byPeriod[key].summary;
      const same = l.steps === s.steps && l.onTime === s.onTime && l.late === s.late && l.overdue === s.overdue && l.score === s.score;
      console.log(`  frozen by the CRM ${s.missed}/${s.steps} ${s.scoreText} · this engine live ${l.missed}/${l.steps} ${l.scoreText}: ${same ? 'same' : 'DIFFERENT (the data changed since it was frozen, or the engine differs)'}`);
    }
    console.log('');
  });
}

/* ---------------- voice ---------------- */
const data = {
  purchase: { byPeriod: purchaseBoards },
  design: design ? { byPeriod: design.byPeriod } : null,
};
const periods = { purchase: 'this-week', design: 'this-week' };
['en', 'hi'].forEach((language) => {
  const voice = { ...VOICE_DEFAULTS, language, sections: { ...VOICE_DEFAULTS.sections, bottom: true } };
  const said = [
    ...['purchase', 'purchase-leader', 'design', 'design-leader'].flatMap((id) => boardLines(id, data, periods, voice)),
    ...[purchaseBoards['this-week'], design && design.byPeriod['this-week']].filter(Boolean)
      .flatMap((b) => b.people.filter((p) => p.rank !== null && !p.isGap).flatMap((_, i) => personLines(b, i, voice))),
    ...summaryLines(data, periods, voice),
  ];
  const text = said.filter((x) => typeof x === 'string');
  check(text.length > 0 && text.every((x) => !/undefined|NaN|null|\[object/.test(x)), `voice ${language}: a line says undefined / NaN`);
  if (language === 'en') console.log(`VOICE (en) sample:\n  ${text.slice(0, 8).join('\n  ')}\n`);
});

/* ---------------- settings ---------------- */
const legacy = normalize({ purchasePeriod: 'weekly', designPeriod: 'mtd', boards: [
  { id: 'purchase', enabled: true, dwellSec: 25 }, { id: 'purchase-leader', enabled: true, dwellSec: 8 },
  { id: 'design', enabled: false, dwellSec: 20 }, { id: 'design-leader', enabled: true, dwellSec: 8 }] });
check(legacy.errors.length === 0, `legacy settings refused: ${legacy.errors.join('; ')}`);
check(legacy.settings.purchasePeriod === 'this-week' && legacy.settings.designPeriod === 'this-month', 'legacy periods not read as the nearest MIS period');
check(legacy.settings.boards.map((b) => b.id).join() === 'purchase,purchase-people,purchase-leader,design,design-people,design-leader', 'one-by-one boards not added in place');
check(legacy.settings.boards[0].dwellSec === 25 && legacy.settings.boards[3].enabled === false, 'saved board times lost');
check(normalize({ designPeriod: 'last-week' }).settings.designPeriod === 'last-week', 'MIS period refused');
check(normalize({ purchasePeriod: 'yesterday' }).errors.length === 1, 'unknown period accepted');
check(DEFAULT_SETTINGS.purchasePeriod === 'this-week', 'default period');

console.log(`${checks - failures} of ${checks} checks passed${failures ? ` · ${failures} FAILED` : ''}`);
process.exit(failures ? 1 : 0);
