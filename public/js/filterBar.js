/* On-screen period chips for the Purchase and Design boards — the MIS pages' own periods
   (This week, Last week, This month, Last month) — plus "Set as default". */
import { el } from './dom.js';
import { PURCHASE_PERIODS, DESIGN_PERIODS } from './settingsModel.js';

const SAVED_MS = 2200;

function chipGroup(label, periods, onPick, withKeys) {
  const group = el('div', 'fb-group');
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', `${label} period`);
  const chips = new Map(periods.map((p, i) => {
    const b = el('button', 'fb-chip', p.chip);
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.dataset.key = p.key;
    if (withKeys && i < 9) b.title = `${p.chip} (key ${i + 1})`;
    b.addEventListener('click', () => onPick(p.key));
    return [p.key, b];
  }));
  group.append(el('span', 'fb-label', label), ...chips.values());
  return { group, chips };
}

/**
 * onPick(kind, key) — kind 'purchase' | 'design'; onSaveDefault() → Promise.
 */
export function createFilterBar(host, { onPick, onSaveDefault }) {
  const purchase = chipGroup('Purchase', PURCHASE_PERIODS, (key) => onPick('purchase', key), true);
  const design = chipGroup('Design', DESIGN_PERIODS, (key) => onPick('design', key), false);
  const save = el('button', 'fb-save', 'Set as default');
  save.type = 'button';
  const note = el('span', 'fb-note');
  note.setAttribute('role', 'status');
  const end = el('div', 'fb-end');
  end.append(note, save);
  host.replaceChildren(purchase.group, design.group, end);

  let noteTimer = null;
  function flash(text, tone) {
    note.textContent = text;
    note.dataset.tone = tone;
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => { note.textContent = ''; }, SAVED_MS);
  }

  save.addEventListener('click', () => {
    save.disabled = true;
    onSaveDefault()
      .then(() => flash('Saved ✓ for every screen', 'good'))
      .catch((err) => flash(err && err.message ? err.message : 'Could not save', 'bad'))
      .finally(() => { save.disabled = false; });
  });

  const mark = (chips, key) => chips.forEach((b, k) => b.setAttribute('aria-checked', String(k === key)));

  return {
    /** focus = which group the current board uses ('purchase' | 'design' | null). */
    render({ purchaseKey, designKey, focus, isDirty, visible }) {
      host.hidden = !visible;
      mark(purchase.chips, purchaseKey);
      mark(design.chips, designKey);
      purchase.group.classList.toggle('is-focus', focus === 'purchase');
      design.group.classList.toggle('is-focus', focus === 'design');
      save.hidden = !isDirty;
    },
  };
}
