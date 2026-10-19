/* An MIS board — the Purchase MIS (hr-erp) or the Designer MIS (CRM) — as its page shows it: the
   KPI cards (the team's score: not done on time, 0% best, with its grade; on time, late, not done,
   work not done, pending now and the average delay), then everyone with work due, ranked closest
   to 0% first, each with their own delay. The numbers and their labels ("−44.1%", "8h 47m") come
   from the payload as the page prints them (engine/purchaseMis.js, engine/designMis.js); nothing is
   re-scored or re-rounded here. Whoever is on top has a flame, the last one a little coach. */
import { el, isNum, fmtInt, setNumber, setText, setTone, restartClass, medal, setMedal, headCell } from './dom.js';
import { createRowList } from './rowList.js';
import { createStrip } from './strip.js';
import { coach, flame } from './mascot.js';

const NOTHING = '—';
const positive = (v) => isNum(v) && v > 0;

/* The KPI cards. s = board.summary */
const STRIP = [
  { label: (s) => (s.grade ? `Score · Grade ${s.grade}` : 'Score'), text: (s) => s.scoreText, tone: (s) => s.scoreTone || null,
    sub: (s) => (positive(s.steps) ? `${fmtInt(s.missed)} of ${fmtInt(s.steps)} not on time · 0% is best` : '0% is best') },
  { label: 'On time', value: (s) => s.onTime, fmt: fmtInt, tone: () => 'good',
    sub: (s) => (isNum(s.onTimePct) ? `${s.onTimePct}% · done by the plan` : 'done by the plan') },
  { label: 'Late', value: (s) => s.late, fmt: fmtInt, tone: (s) => (positive(s.late) ? 'warn' : null), sub: () => 'done after the plan' },
  { label: 'Not done', value: (s) => s.overdue, fmt: fmtInt, tone: (s) => (positive(s.overdue) ? 'bad' : null), sub: () => 'open past the plan' },
  { label: 'Work not done', text: (s) => (positive(s.steps) ? s.notDoneText : null), tone: (s) => (s.notDonePct < 0 ? 'bad' : null),
    sub: (s) => (positive(s.steps) ? `${fmtInt(s.overdue || 0)} of ${fmtInt(s.steps)} still open` : '') },
  { label: 'Pending now', value: (s) => s.pending, fmt: fmtInt, tone: (s) => (positive(s.pending) ? 'bad' : null),
    sub: (s) => `${fmtInt(s.overdue || 0)} this period + ${fmtInt(s.carryover || 0)} carried over` },
  { label: 'Avg delay', text: (s) => s.avgDelayLabel, tone: (s) => (s.avgDelayLabel ? 'warn' : null), sub: () => 'working hours late' },
];

/* Row cells: value(p) + fmt (counts) or text(p); sub(p) = small second line. */
const COLS = [
  { head: 'Planned', value: (p) => p.steps, fmt: fmtInt, cls: 'num-strong', sub: (p) => (positive(p.upcoming) ? `+${fmtInt(p.upcoming)} not due yet` : '') },
  { head: 'On time', value: (p) => p.onTime, fmt: fmtInt, tone: (p) => (positive(p.onTime) ? 'good' : null), sub: (p) => (isNum(p.onTimePct) ? `${p.onTimePct}%` : '') },
  { head: 'Late', value: (p) => p.late, fmt: fmtInt, tone: (p) => (positive(p.late) ? 'warn' : null) },
  { head: 'Not done', value: (p) => p.overdue, fmt: fmtInt, tone: (p) => (positive(p.overdue) ? 'bad' : null) },
  { head: 'Not done %', text: (p) => (positive(p.steps) ? p.notDoneText : null), tone: (p) => (p.notDonePct < 0 ? 'bad' : null) },
  { head: 'Backlog', value: (p) => p.pending, fmt: fmtInt, tone: (p) => (positive(p.pending) ? 'bad' : null),
    sub: (p) => (positive(p.carryover) ? `${fmtInt(p.carryover)} carried over` : '') },
  { head: 'Avg delay', text: (p) => p.avgDelayLabel, tone: (p) => (p.avgDelayLabel ? 'warn' : null) },
];

/** The rows a board lists: everyone with work due, ranked, then anyone with only older work pending. */
export const listedPeopleOf = (board) => ((board && board.people) || []).filter((p) => p.steps > 0 || p.pending > 0);
/** The ranked people of a board, best first (nothing due: no rank). */
export const rankedPeopleOf = (board) => ((board && board.people) || [])
  .filter((p) => isNum(p.rank)).sort((a, b) => a.rank - b.rank);

function buildCell(col) {
  const cell = el('div', `r cell2 ${col.cls || ''}`);
  const v = el('span', 'cell-v');
  const s = el('span', 'cell-s');
  cell.append(v, s);
  return { cell, v, s };
}

function buildRow() {
  const root = el('div');
  const rankCell = el('div', 'c');
  const m = medal();
  rankCell.appendChild(m);
  const who = el('div', 'who');
  const nameCell = el('div', 'name-cell');
  const name = el('span', 'name');
  const fire = flame('row-flame');
  const tag = el('span', 'leader-tag', 'Top');
  const push = coach('row-coach');
  const move = el('span', 'move');
  nameCell.append(name, fire, tag, push, move);
  const tags = el('div', 'reason');
  who.append(nameCell, tags);
  const scoreCell = el('div', 'c cell2');
  const scoreLine = el('span', 'cell-v');
  const score = el('span', 'score is-pct');
  const grade = el('span', 'grade');
  scoreLine.append(score, grade);
  const missed = el('span', 'cell-s');
  scoreCell.append(scoreLine, missed);
  const cells = COLS.map(buildCell);
  root.append(rankCell, who, scoreCell, ...cells.map((c) => c.cell));
  return {
    el: root, move,
    update(p, animate) {
      setMedal(m, p.rank);
      root.classList.toggle('is-leader', p.rank === 1);
      root.classList.toggle('is-last', Boolean(p.isLast));
      tag.hidden = p.rank !== 1;
      fire.hidden = p.rank !== 1;
      push.hidden = !p.isLast;
      name.textContent = p.name || NOTHING;
      const tagText = (p.tags || []).join(' · ');
      tags.textContent = tagText;
      tags.hidden = !tagText;
      score.dataset.band = p.scoreTone || '';
      const changed = setText(score, positive(p.steps) ? p.scoreText : null);
      grade.textContent = p.grade || '';
      grade.dataset.tone = p.scoreTone || 'muted';
      grade.hidden = !p.grade;
      missed.textContent = positive(p.steps) ? (p.missed > 0 ? `${fmtInt(p.missed)} of ${fmtInt(p.steps)} missed` : 'none missed') : 'nothing due';
      if (changed && animate) restartClass(scoreCell, 'flash');
      COLS.forEach((col, i) => {
        const { cell, v, s } = cells[i];
        const raw = col.text ? col.text(p) : col.value(p);
        const moved = col.text ? setText(v, raw) : setNumber(v, raw, col.fmt, animate);
        setTone(v, raw === null || raw === undefined || raw === NOTHING ? 'muted' : col.tone ? col.tone(p) : null);
        const sub = col.sub ? col.sub(p) : '';
        s.textContent = sub || '';
        s.hidden = !sub;
        if (moved && animate) restartClass(cell, 'flash');
      });
    },
  };
}

/** kind = 'purchase' | 'design': the row header's word for a person and the empty board's text. */
export function createMisView({ kind }) {
  const who = kind === 'design' ? 'Designer' : 'Doer';
  const root = el('div', `view mis-view mis-${kind}`);
  const strip = createStrip(STRIP, 'strip-mis');
  const heads = [headCell('#', 'c'), headCell(`${who} · ranked, 0% is best`), headCell('Score', 'c sorted'), ...COLS.map((c) => headCell(c.head, 'r'))];
  const list = createRowList({ headCells: heads, gridClass: 'mis-grid', rowClass: 'mis-row', keyOf: (p) => p.id || p.name, buildRow });
  const note = el('div', 'board-note');
  const empty = el('div', 'view-empty');
  root.append(strip.root, list.root, note, empty);

  return {
    root, list,
    /** board = one period's board, or null when that period has no data yet. */
    update(board, { animate, trackMoves, periodLabel }) {
      const listed = listedPeopleOf(board);
      root.classList.toggle('is-empty', !listed.length);
      empty.textContent = board ? `No ${kind} work fell due in ${periodLabel || 'this period'}` : `No ${kind} data for ${periodLabel || 'this period'} yet`;
      strip.update((board && board.summary) || {}, animate);
      // The last ranked person gets the push coach (only when more than two are ranked).
      const lastRank = Math.max(0, ...listed.map((p) => (isNum(p.rank) ? p.rank : 0)));
      list.update(listed.map((p) => ({ ...p, isLast: lastRank > 2 && p.rank === lastRank })), animate, trackMoves);
      const period = (board && board.period) || {};
      const bits = [
        board && board.idle && board.idle.length ? `Nothing due: ${board.idle.join(', ')}` : '',
        period.frozenAt ? `Closed period · scores as the CRM froze them` : '',
        period.frozenMissing ? 'Closed period · frozen record not read yet, scored live' : '',
      ].filter(Boolean);
      note.textContent = bits.join('   ·   ');
      note.hidden = !bits.length || !listed.length;
    },
  };
}
