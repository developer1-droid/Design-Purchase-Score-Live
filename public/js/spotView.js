/* Leader spotlight interstitial + the model that feeds it (both MIS boards). */
import { el, isNum, fmtInt, dash, setNumber, medal, setMedal } from './dom.js';
import { motionOff } from './motion.js';
import { flame } from './mascot.js';
import { cardPeopleOf } from './peopleView.js';

export function createSpotView() {
  const root = el('div', 'view');
  const spot = el('section', 'spot');
  const main = el('div', 'spot-main');
  const kicker = el('div', 'spot-kicker');
  const rule = el('div', 'spot-rule');
  const mask = el('div', 'spot-name-mask');
  const name = el('div', 'spot-name');
  mask.appendChild(name);
  const sub = el('div', 'spot-sub');
  const facts = el('div', 'spot-facts');
  // The leader is on fire.
  main.append(flame('spot-flame'), kicker, rule, mask, sub, facts);
  const side = el('div', 'spot-side');
  const bigLabel = el('div', 'spot-big-label');
  const big = el('div', 'spot-big');
  const bigNote = el('div', 'spot-big-note');
  const chasers = el('div', 'chasers');
  side.append(bigLabel, big, bigNote, chasers);
  spot.append(main, side);
  root.appendChild(spot);
  let bigValue = null;

  return {
    root,
    replay() {
      big._num = null;
      if (!isNum(bigValue)) return;
      if (motionOff()) { big.textContent = fmtInt(bigValue); return; }
      big._num = bigValue > 1 ? 0 : bigValue;
      setNumber(big, bigValue, fmtInt, true);
    },
    update(model) {
      kicker.textContent = model.kicker;
      name.textContent = model.name;
      sub.textContent = model.sub;
      facts.classList.toggle('is-grid', model.facts.length > 4);
      facts.replaceChildren(...model.facts.map((f) => {
        const box = el('div', 'fact');
        box.append(el('div', 'fact-label', f.label), el('div', `fact-value${f.tone ? ` tone-${f.tone}` : ''}`, f.value));
        return box;
      }));
      bigLabel.textContent = model.bigLabel;
      // A text score (the MIS's signed %, as the app prints it) is shown as sent, never counted up.
      bigValue = model.bigText ? null : model.big;
      big._num = null;
      big.classList.toggle('is-text', Boolean(model.bigText));
      big.dataset.band = model.bigTone || '';
      big.textContent = model.bigText || (isNum(model.big) ? fmtInt(model.big) : '—');
      bigNote.textContent = model.bigNote;
      chasers.replaceChildren(...model.chasers.map((ch) => {
        const row = el('div', 'chaser');
        const m = medal();
        setMedal(m, ch.rank);
        row.append(m, el('span', 'name', ch.name), el('span', 'chaser-val', ch.value));
        return row;
      }));
    },
  };
}

/** The No. 1 of an MIS board (Purchase MIS or Designer MIS), or null when nobody is ranked. */
export function misSpotModel(board) {
  if (!board) return null;
  const people = cardPeopleOf(board);
  const lead = people[0];
  if (!lead) return null;
  return {
    kicker: `${board.title} · No. 1`,
    name: lead.name,
    sub: [(lead.tags || []).join(' · ') || null, board.period && board.period.label].filter(Boolean).join(' · ') || 'Top score',
    facts: [
      { label: 'On time', value: isNum(lead.onTime) ? `${fmtInt(lead.onTime)} of ${fmtInt(lead.steps)}` : '—', tone: 'good' },
      { label: 'Late', value: dash(lead.late, fmtInt), tone: lead.late > 0 ? 'warn' : null },
      { label: 'Not done', value: dash(lead.overdue, fmtInt), tone: lead.overdue > 0 ? 'bad' : null },
      { label: 'Avg delay', value: lead.avgDelayLabel || '—', tone: lead.avgDelayLabel ? 'warn' : null },
    ],
    bigLabel: 'Score',
    big: lead.score,
    bigText: lead.scoreText || '—',
    bigTone: lead.scoreTone || '',
    bigNote: `${lead.grade ? `Grade ${lead.grade} · ` : ''}0% is best`,
    chasers: people.slice(1, 3).map((p) => ({ rank: p.rank, name: p.name, value: p.scoreText })),
  };
}
