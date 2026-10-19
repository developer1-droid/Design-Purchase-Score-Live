/* The summary strip of tiles above a board. Each def reads one summary object:
   { label | label(s), value(s) + fmt | text(s), tone(s)?, sub(s)? }. */
import { el, setNumber, setText, setTone } from './dom.js';

export function createStrip(defs, cls) {
  const root = el('section', `strip ${cls || ''}`);
  const tiles = defs.map((def, i) => {
    const tile = el('div', 'tile');
    tile.style.setProperty('--i', i);
    const label = el('div', 'tile-label', typeof def.label === 'function' ? '' : def.label);
    const value = el('div', 'tile-value');
    const sub = el('div', 'tile-sub');
    tile.append(label, value, sub);
    root.appendChild(tile);
    return { def, label, value, sub };
  });

  return {
    root,
    update(s, animate) {
      tiles.forEach(({ def, label, value, sub }) => {
        if (typeof def.label === 'function') label.textContent = def.label(s);
        const raw = def.text ? def.text(s) : def.value(s);
        if (def.text) setText(value, raw);
        else setNumber(value, raw, def.fmt, animate);
        setTone(value, raw === null || raw === undefined ? 'muted' : def.tone ? def.tone(s) : null);
        sub.textContent = def.sub ? def.sub(s) : '';
      });
    },
  };
}
