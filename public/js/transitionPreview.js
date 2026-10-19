/* Settings page: a miniature TV that keeps swapping two boards with the
   transition being edited, using the same transition code as the TV. */
import { el } from './dom.js';
import { createTransitioner, transitionMs } from './transitions.js';
import { motionOff } from './motion.js';

const HOLD_MS = 1600;
/* Sample rows in the boards' own style: the signed miss %, 0% best. */
const MINI = {
  purchase: { title: 'Purchase MIS', rows: [['Rakhi', '−4.5%', 'warn'], ['Krishna', '−12.7%', 'bad']] },
  design: { title: 'Designer MIS', rows: [['Arun', '0%', 'good'], ['Rishabh Rawat', '−7.1%', 'warn'], ['Manoj', '−28.6%', 'bad']] },
};

function pane(model) {
  const root = el('div', 'pv-pane');
  root.appendChild(el('div', 'pv-title', model.title));
  model.rows.forEach(([name, score, tone], i) => {
    const r = el('div', `pv-row${i === 0 ? ' is-leader' : ''}`);
    r.append(el('span', 'pv-rank', String(i + 1)), el('span', 'pv-name', name), el('span', `pv-score${tone ? ` tone-bg-${tone}` : ''}`, String(score)));
    root.appendChild(r);
  });
  return root;
}

function miniWipe() {
  const wipe = el('div', 'wipe');
  const panel = el('div', 'wipe-panel');
  const label = el('div', 'wipe-label');
  label.append(el('div', 'wipe-kicker', 'Leaderboard'), el('div', 'wipe-title'));
  panel.appendChild(label);
  wipe.append(panel, el('div', 'wipe-edge'));
  return wipe;
}

export function createTransitionPreview(stage, caption) {
  const panes = [pane(MINI.purchase), pane(MINI.design)];
  const wipe = miniWipe();
  stage.replaceChildren(...panes, wipe);
  panes[0].classList.add('is-active');
  const transitioner = createTransitioner();
  let shown = 0;
  let timer = null;
  let anim = { enabled: true, transition: 'slide', speed: 1 };

  function cycle() {
    const next = 1 - shown;
    wipe.querySelector('.wipe-title').textContent = next ? MINI.design.title : MINI.purchase.title;
    const instant = motionOff();
    transitioner.run(panes[shown], panes[next], { style: anim.transition, speed: anim.speed, wipe, instant });
    shown = next;
    timer = setTimeout(cycle, HOLD_MS + (instant ? 0 : transitionMs(anim.transition, anim.speed)));
  }

  return {
    /** Restart the loop with new animation settings, right away so the change is visible. */
    update(nextAnim) {
      anim = nextAnim;
      clearTimeout(timer);
      caption.textContent = motionOff()
        ? 'Animation off: boards cut instantly'
        : `${anim.transition[0].toUpperCase()}${anim.transition.slice(1)} · ${transitionMs(anim.transition, anim.speed)} ms`;
      timer = setTimeout(cycle, 250);
    },
  };
}
