/* Bottom crawl: the headline facts of every board, so a glance from across
   the room tells you who leads. Static (no crawl) when motion is off. */
import { el, isNum, fmtInt } from './dom.js';
import { motionOff, motionSpeed } from './motion.js';
import { cardPeopleOf } from './peopleView.js';

const PX_PER_SEC = 90;

/* The No. 1 with their score, then the team line: the board's KPI cards in one sentence. */
function boardItems(board, label, team) {
  if (!board) return [];
  const lead = cardPeopleOf(board)[0];
  const s = board.summary || {};
  return [
    lead ? { tag: `${team} · ${label}`, text: `${lead.name} leads with ${lead.scoreText}${lead.grade ? ` · grade ${lead.grade}` : ''}` } : null,
    isNum(s.steps) && s.steps > 0 ? {
      tag: team,
      text: [`team ${s.scoreText}${s.grade ? ` (${s.grade})` : ''}`, `${fmtInt(s.onTime)} of ${fmtInt(s.steps)} on time`, `${fmtInt(s.late || 0)} late`,
        `${fmtInt(s.overdue || 0)} not done`, `${fmtInt(s.pending || 0)} pending now`, s.avgDelayLabel ? `avg delay ${s.avgDelayLabel}` : null].filter(Boolean).join(' · '),
      tone: s.overdue > 0 ? 'bad' : null,
    } : null,
  ].filter(Boolean);
}

function itemNode(item) {
  const node = el('span', 'tk-item');
  node.append(el('b', `tk-tag${item.tone ? ` tone-${item.tone}` : ''}`, item.tag), document.createTextNode(item.text));
  return node;
}

export function createTicker(host) {
  const track = el('div', 'tk-track');
  host.replaceChildren(track);
  let sig = '';

  return {
    render({ visible, purchase, purchaseLabel, design, designLabel }) {
      host.hidden = !visible;
      if (!visible) return;
      const items = [...boardItems(purchase, purchaseLabel, 'Purchase'), ...boardItems(design, designLabel, 'Design')];
      const nextSig = JSON.stringify([items, motionOff(), motionSpeed()]);
      if (nextSig === sig) return;
      sig = nextSig;
      const run = el('div', 'tk-run');
      run.append(...items.map(itemNode));
      const runs = motionOff() ? [run] : [run, run.cloneNode(true)];
      track.replaceChildren(...runs);
      track.style.animation = 'none';
      track.style.webkitAnimation = 'none';
      if (motionOff() || !items.length) return;
      requestAnimationFrame(() => {
        const secs = Math.max(20, run.scrollWidth / (PX_PER_SEC * motionSpeed()));
        const crawl = `tk-crawl ${secs}s linear infinite`;
        track.style.animation = crawl;
        track.style.webkitAnimation = crawl; // unprefixed only from Chrome 43
      });
    },
  };
}
