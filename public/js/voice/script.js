/* What the voice says: short sentences for the board on screen (so the voice always matches the
   slide) or one summary, in the chosen language and style. Pure. Hindi is Devanagari so a hi-IN
   voice says it right; names stay as the apps spell them. Periods are the ones the screen shows.
   Both boards score the MIS way (a signed miss %, 0% best, with a grade): every score is read as
   the screen prints it ("minus 15.2 percent, grade C"), with each person's average delay. */
import { purchaseBoard, designBoard } from '../payload.js';

const WHEN = {
  hi: { 'this-week': 'इस हफ़्ते', 'last-week': 'पिछले हफ़्ते', 'this-month': 'इस महीने', 'last-month': 'पिछले महीने' },
  en: { 'this-week': 'this week', 'last-week': 'last week', 'this-month': 'this month', 'last-month': 'last month' },
};
const TEAM = {
  hi: { purchase: 'परचेज़', design: 'डिज़ाइन' },
  en: { purchase: 'Purchase', design: 'Design' },
};
/* The delay labels are "3h 36m" / "972h" / "45m" working time, and "9.1h" for a team's average. */
const DELAY_UNITS = {
  hi: { h: ['घंटा', 'घंटे'], m: ['मिनट', 'मिनट'] },
  en: { h: ['hour', 'hours'], m: ['minute', 'minutes'] },
};
/* Grade letters spelled out for the Hindi voice. */
const GRADE_WORDS = { hi: { A: 'ए', B: 'बी', C: 'सी', D: 'डी', E: 'ई', F: 'एफ़' } };
const WORDS = { hi: { minus: 'माइनस', percent: 'प्रतिशत', grade: 'ग्रेड' }, en: { minus: 'minus', percent: 'percent', grade: 'grade' } };

const plural = (n, one, many) => (n === 1 ? one : many);
/* The step said by its name ("Follow-up", "Design work"), the code only when it has none. */
const stepName = (step) => step.label || step.code;
const oneDecimal = (v) => Math.round(v * 10) / 10;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/* Sound cues between the lines (speech.js): a fanfare for the top and the runner-up, a push for the last. */
const CONGRATS = { cue: 'congrats' };
const PUSH = { cue: 'push' };
const gradeWord = (lang, grade) => (GRADE_WORDS[lang] && GRADE_WORDS[lang][grade]) || grade;
/** "माइनस 24.6 प्रतिशत, ग्रेड सी" / "minus 24.6 percent, grade C". */
export function misScoreWords(lang, score, grade) {
  const w = WORDS[lang];
  const said = `${score < 0 ? `${w.minus} ` : ''}${oneDecimal(Math.abs(score))} ${w.percent}`;
  return grade ? `${said}, ${w.grade} ${gradeWord(lang, grade)}` : said;
}
/** A person with their score in words, so every line reads it like the screen. */
const spoken = (lang, p) => (isNum(p.score) ? { ...p, score: misScoreWords(lang, p.score, p.grade) } : p);

const LINES = {
  hi: {
    intro: { friendly: 'नमस्ते टीम, परचेज़ और डिज़ाइन का अपडेट सुनिए।', formal: 'परचेज़ और डिज़ाइन अपडेट।', energetic: 'चलो टीम! परचेज़ और डिज़ाइन का स्कोर सुनिए!' },
    outro: { friendly: 'धन्यवाद, ऐसे ही अच्छा काम करते रहिए!', formal: 'धन्यवाद।', energetic: 'चलो टीम, आज का दिन हमारा है!' },
    praise: { friendly: 'बहुत बढ़िया!', formal: '', energetic: 'शानदार काम!' },
    noData: 'अभी बोर्ड का डेटा नहीं आया है।',
    person: (p) => `${p.name}, स्कोर ${p.score}`,
    top: (team, when, p, delay) => `${team} में ${when} सबसे आगे ${p.name}, स्कोर ${p.score}${delay ? `, औसत देरी ${delay}` : ''}।`,
    next: (list) => `उसके बाद ${list}।`,
    spot: (team, when, p) => `${team} में ${when} नंबर एक: ${p.name}, स्कोर ${p.score}${p.onTimePct != null ? `, ${p.onTimePct} प्रतिशत काम समय पर` : ''}।`,
    delayIntro: { friendly: 'इन पर ध्यान दीजिए।', formal: 'देरी वाले काम।', energetic: 'ये काम आज ही ख़त्म करने हैं!' },
    delay: (p, delay) => `${p.name} के ${p.overdue} काम समय से पीछे हैं${delay ? `, औसत देरी ${delay}` : ''}${p.pending ? `, कुल ${p.pending} पेंडिंग` : ''}।`,
    noDelay: 'अच्छी ख़बर, कोई भी काम समय से पीछे नहीं है।',
    last: {
      friendly: (p, delay) => `सबसे पीछे ${p.name}, स्कोर ${p.score}${delay ? `, औसत देरी ${delay}` : ''}। थोड़ा और ज़ोर लगाइए, आप कर सकते हैं!`,
      formal: (p, delay) => `सबसे पीछे ${p.name}, स्कोर ${p.score}${delay ? `, औसत देरी ${delay}` : ''}। इसमें सुधार ज़रूरी है।`,
      energetic: (p, delay) => `सबसे पीछे ${p.name}, स्कोर ${p.score}${delay ? `, औसत देरी ${delay}` : ''}! चलो, पूरा दम लगाओ, ऊपर आना है!`,
    },
    team: (team, when, s, score, delay) => `${when} ${team} टीम के ${s.steps} काम ड्यू थे, ${s.onTime} समय पर हुए; टीम का स्कोर ${score}${delay ? `, औसत देरी ${delay}` : ''}।`,
    peopleIntro: (team) => `अब ${team} में एक-एक करके सबका स्कोर और देरी।`,
    personCard: (p, delay) => `नंबर ${p.rank}, ${p.name}: स्कोर ${p.score}${delay ? `, औसत देरी ${delay}` : ''}${p.overdue ? `, ${p.overdue} काम बाकी` : ''}${p.worstStep ? `, सबसे ज़्यादा देरी ${stepName(p.worstStep)} में` : ''}।`,
    personTop: { friendly: 'शाबाश, सबसे आगे!', formal: 'सबसे आगे।', energetic: 'ज़बरदस्त, नंबर वन!' },
    personRunnerUp: { friendly: 'बहुत अच्छे, दूसरे नंबर पर!', formal: 'दूसरे नंबर पर।', energetic: 'शानदार, नंबर दो!' },
    personLast: { friendly: 'थोड़ा और ज़ोर लगाइए, आप कर सकते हैं!', formal: 'सुधार की ज़रूरत है।', energetic: 'चलो, पूरा दम लगाओ, ऊपर आना है!' },
  },
  en: {
    intro: { friendly: 'Hello team, here is your Purchase and Design update.', formal: 'Purchase and Design update.', energetic: "Let's go team! Here are the Purchase and Design scores!" },
    outro: { friendly: 'Thank you, keep up the great work!', formal: 'Thank you.', energetic: "Let's make today count!" },
    praise: { friendly: 'Great work!', formal: '', energetic: 'Fantastic!' },
    noData: 'The board has no data yet.',
    person: (p) => `${p.name}, score ${p.score}`,
    top: (team, when, p, delay) => `${team} top ${when}: ${p.name}, score ${p.score}${delay ? `, ${delay} late on average` : ''}.`,
    next: (list) => `Then ${list}.`,
    spot: (team, when, p) => `${team} number one ${when}: ${p.name}, score ${p.score}${p.onTimePct != null ? `, ${p.onTimePct} percent on time` : ''}.`,
    delayIntro: { friendly: 'A few things need attention.', formal: 'Delayed work.', energetic: "Let's clear these today!" },
    delay: (p, delay) => `${p.name} has ${p.overdue} ${plural(p.overdue, 'step', 'steps')} past the plan${delay ? `, ${delay} late on average` : ''}${p.pending ? `, ${p.pending} pending in all` : ''}.`,
    noDelay: 'Good news, nothing is past its plan.',
    last: {
      friendly: (p, delay) => `Last: ${p.name}, score ${p.score}${delay ? `, ${delay} late on average` : ''}. A little more push and you will be up there!`,
      formal: (p, delay) => `Last: ${p.name}, score ${p.score}${delay ? `, ${delay} late on average` : ''}. This needs to improve.`,
      energetic: (p, delay) => `Last: ${p.name}, score ${p.score}${delay ? `, ${delay} late on average` : ''}! Give it everything, time to climb!`,
    },
    team: (team, when, s, score, delay) => `The ${team} team had ${s.steps} steps due ${when}, ${s.onTime} on time; team score ${score}${delay ? `, ${delay} late on average` : ''}.`,
    peopleIntro: (team) => `Now everyone in ${team}, one by one: score and delay.`,
    personCard: (p, delay) => `Number ${p.rank}, ${p.name}: score ${p.score}${delay ? `, ${delay} late on average` : ''}${p.overdue ? `, ${p.overdue} ${plural(p.overdue, 'step', 'steps')} still open` : ''}${p.worstStep ? `, most delay on ${stepName(p.worstStep)}` : ''}.`,
    personTop: { friendly: 'Well done, number one!', formal: 'Number one.', energetic: 'Fantastic, number one!' },
    personRunnerUp: { friendly: 'Great job, runner-up!', formal: 'Runner-up.', energetic: 'Brilliant, number two!' },
    personLast: { friendly: 'A little more push, you can do it!', formal: 'This needs to improve.', energetic: 'Come on, time to climb!' },
  },
};

const delayWords = (label, lang) => String(label).replace(/(\d+(?:\.\d+)?)([hm])/g, (_, n, unit) => {
  const [one, many] = DELAY_UNITS[lang][unit];
  return `${n} ${plural(Number(n), one, many)}`;
});
const delayOf = (p, lang) => (p && p.avgDelayLabel ? delayWords(p.avgDelayLabel, lang) : '');

/* The people a board ranks (nothing due: no rank), never the "nobody assigned" gap. */
const rankedPeople = (board) => ((board && board.people) || [])
  .filter((p) => isNum(p.rank) && !p.isGap).sort((a, b) => a.rank - b.rank);

/* ---------- one board each (falsy entries are dropped later) ---------- */
function boardLinesOf(L, board, kind, when, voice) {
  const lang = voice.language;
  const on = voice.sections;
  const team = TEAM[lang][kind];
  const ranked = rankedPeople(board);
  const said = ranked.map((p) => spoken(lang, p));
  const s = board.summary || {};
  const [top, ...rest] = said;
  const next = rest.slice(0, Math.max(0, voice.topCount - 1));
  const late = ranked.filter((p) => p.overdue > 0).sort((a, b) => b.overdue - a.overdue).slice(0, voice.delayCount);
  const last = said.length > 1 ? said[said.length - 1] : null;
  return [
    ...(on.leaders && top ? [CONGRATS, L.top(team, when, top, delayOf(ranked[0], lang)), next.length ? L.next(next.map(L.person).join('; ')) : null, L.praise[voice.style]] : []),
    ...(on.delays ? (late.length ? [L.delayIntro[voice.style], ...late.map((p) => L.delay(p, delayOf(p, lang)))] : [L.noDelay]) : []),
    // The last person, with how late they run, and a push. Named once: not when the leaders already did.
    ...(on.bottom && last && said.length > voice.topCount ? [PUSH, L.last[voice.style](last, delayOf(ranked[ranked.length - 1], lang))] : []),
    on.team && isNum(s.steps) && s.steps > 0 && isNum(s.score) && L.team(team, when, s, misScoreWords(lang, s.score, s.grade), delayOf(s, lang)),
  ];
}

function spotLinesOf(L, board, kind, when, voice) {
  const lead = rankedPeople(board)[0];
  if (!voice.sections.leaders || !lead) return [];
  return [CONGRATS, L.spot(TEAM[voice.language][kind], when, spoken(voice.language, lead)), L.praise[voice.style]];
}

/**
 * The walkthrough's lines for one person (one card each): their place, score and grade, how late
 * they run, what is still open and where they miss most; a fanfare for the top and the runner-up,
 * a push for the last. The first card opens with what is coming.
 */
export function personLines(board, index, voice, kind = (board && board.kind) || 'purchase') {
  const L = LINES[voice.language];
  const ranked = rankedPeople(board);
  const person = ranked[index];
  if (!person) return [];
  const p = spoken(voice.language, person);
  const isLast = ranked.length > 2 && index === ranked.length - 1;
  const lead = person.rank === 1 || person.rank === 2 ? [CONGRATS] : isLast ? [PUSH] : [];
  const tail = person.rank === 1 ? L.personTop[voice.style] : person.rank === 2 ? L.personRunnerUp[voice.style] : isLast ? L.personLast[voice.style] : '';
  return [index === 0 ? L.peopleIntro(TEAM[voice.language][kind]) : '', ...lead, L.personCard(p, delayOf(person, voice.language)), tail].filter(Boolean);
}

const whenOf = (lang, key) => WHEN[lang][key] || '';
const BOARDS = {
  purchase: (L, data, p, voice) => { const b = purchaseBoard(data, p.purchase); return b ? boardLinesOf(L, b, 'purchase', whenOf(voice.language, p.purchase), voice) : []; },
  'purchase-leader': (L, data, p, voice) => { const b = purchaseBoard(data, p.purchase); return b ? spotLinesOf(L, b, 'purchase', whenOf(voice.language, p.purchase), voice) : []; },
  design: (L, data, p, voice) => { const b = designBoard(data, p.design); return b ? boardLinesOf(L, b, 'design', whenOf(voice.language, p.design), voice) : []; },
  'design-leader': (L, data, p, voice) => { const b = designBoard(data, p.design); return b ? spotLinesOf(L, b, 'design', whenOf(voice.language, p.design), voice) : []; },
  // The walkthroughs speak per person as each card comes up (personLines).
  'purchase-people': () => [],
  'design-people': () => [],
};

/** Lines for the board on screen ([] when it has nothing to say). `periods` = { purchase, design } keys the screen shows. */
export function boardLines(boardId, data, periods, voice) {
  const build = BOARDS[boardId];
  return build && data ? build(LINES[voice.language], data, periods, voice).filter(Boolean) : [];
}

export const introLine = (voice) => LINES[voice.language].intro[voice.style];
export const outroLine = (voice) => LINES[voice.language].outro[voice.style];

/** One combined update: Purchase then Design, opened and closed in the chosen style. */
export function summaryLines(data, periods, voice) {
  const L = LINES[voice.language];
  const purchase = data ? purchaseBoard(data, periods.purchase) : null;
  const design = data ? designBoard(data, periods.design) : null;
  if (!purchase && !design) return [L.noData];
  return [
    introLine(voice),
    ...(purchase ? boardLinesOf(L, purchase, 'purchase', whenOf(voice.language, periods.purchase), voice) : []),
    ...(design ? boardLinesOf(L, design, 'design', whenOf(voice.language, periods.design), voice) : []),
    outroLine(voice),
  ].filter(Boolean);
}
