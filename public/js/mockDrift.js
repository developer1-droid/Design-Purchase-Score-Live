/* Demo mode only: random drift so the count-ups, row moves and rank chips can be seen. The MIS
   rules are applied as the engines apply them (lib/mis/score: −(planned − on time) ÷ planned,
   one decimal, 0% best; ranked closest to 0 first), so the demo boards stay self-consistent. */
const rand = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export function missPct(missed, planned) {
  if (!(planned > 0)) return null;
  const pct = Math.round((missed / planned) * 1000) / 10;
  return pct === 0 ? 0 : -pct;
}
export const fmtPct = (pct) => (pct === null ? '—' : pct === 0 ? '0%' : `−${Number.isInteger(Math.abs(pct)) ? Math.abs(pct) : Math.abs(pct).toFixed(1)}%`);
const gradeOf = (pct) => (pct === null ? null : pct >= -5 ? 'A' : pct >= -15 ? 'B' : pct >= -30 ? 'C' : 'D');
const toneOf = (pct) => (pct === null ? null : pct === 0 ? 'good' : pct >= -10 ? 'warn' : 'bad');

/** Score fields from the counts, as the payload carries them. */
function rescore(x) {
  x.missed = x.steps - x.onTime;
  x.done = x.onTime + x.late;
  x.pending = x.overdue + (x.carryover || 0);
  x.score = missPct(x.steps - x.onTime, x.steps);
  x.scoreText = fmtPct(x.score);
  x.scoreTone = toneOf(x.score);
  x.grade = gradeOf(x.score);
  x.notDonePct = missPct(x.steps - x.done, x.steps);
  x.notDoneText = fmtPct(x.notDonePct);
  x.onTimePct = x.steps > 0 ? Math.round((x.onTime / x.steps) * 100) : null;
}

/* Closest to 0 first; nothing due last (lib/mis/score byScore). */
function rerank(people) {
  const key = (p) => (isNum(p.score) ? p.score : Number.NEGATIVE_INFINITY);
  people.sort((a, b) => key(b) - key(a) || b.steps - a.steps || String(a.name).localeCompare(String(b.name)));
  let rank = 0;
  people.forEach((p) => { p.rank = p.steps > 0 ? (rank += 1) : null; });
}

function drift(board) {
  const people = (board.people || []).filter((p) => p.steps > 0 && !p.isGap);
  if (!people.length) return;
  const p = people[rand(0, people.length - 1)];
  if (p.overdue > 0 && rand(0, 1)) {
    // A step past its plan gets done: late now.
    p.overdue -= 1;
    p.late += 1;
  } else if (isNum(p.upcoming) && p.upcoming > 0) {
    // A step falls due and is done in time.
    p.upcoming -= 1;
    p.steps += 1;
    p.onTime += 1;
  } else {
    return;
  }
  rescore(p);
  const s = board.summary;
  ['steps', 'onTime', 'late', 'overdue', 'carryover'].forEach((k) => { s[k] = board.people.reduce((sum, x) => sum + (x[k] || 0), 0); });
  if (isNum(s.upcoming)) s.upcoming = board.people.reduce((sum, x) => sum + (x.upcoming || 0), 0);
  rescore(s);
  rerank(board.people);
}

export function mutateMock(d) {
  const next = JSON.parse(JSON.stringify(d));
  next.updatedAt = new Date().toISOString();
  ['purchase', 'design'].forEach((kind) => Object.values((next[kind] && next[kind].byPeriod) || {}).forEach(drift));
  return next;
}

/* ?rows=N pads the demo boards to N rows so paging can be seen. */
export function padMock(d, n) {
  if (!n) return d;
  ['purchase', 'design'].forEach((kind) => Object.values((d[kind] && d[kind].byPeriod) || {}).forEach((b) => {
    const base = b.people.filter((p) => p.steps > 0);
    if (!base.length) return;
    for (let i = base.length; i < n; i += 1) {
      const p = JSON.parse(JSON.stringify(base[i % base.length]));
      b.people.push({ ...p, id: `${p.id}-${i}`, name: `${p.name} ${i + 1}` });
    }
    rerank(b.people);
  }));
  return d;
}
