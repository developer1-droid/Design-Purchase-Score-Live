// While the voice reads the slides, a slide (and each person of a one-by-one slide) stays on screen
// until its last line has finished playing; only then does the next one come. The server voice is
// faked: each line is an <audio> that ends when the test says so.
// Run: npm test (node --test).
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const playing = [];
class FakeAudio {
  constructor(url) { this.url = url; playing.push(this); }
  play() { return Promise.resolve(); }
  pause() {}
}
globalThis.window = { addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }) };
globalThis.Audio = FakeAudio;
globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) });
// The schedule's 20 s tick is not part of these tests (and would keep the test process alive).
globalThis.setInterval = () => 0;

const settle = async () => { for (let i = 0; i < 30; i += 1) await new Promise((resolve) => { setImmediate(resolve); }); };
const lineText = (audio) => decodeURIComponent(/text=([^&]*)/.exec(audio.url)[1]);
/* End every line that is playing now, one at a time, until nothing new starts. */
async function finishAll(onEach = () => {}) {
  for (let guard = 0; guard < 200; guard += 1) {
    await settle();
    const open = playing.filter((a) => !a.done);
    if (!open.length) return;
    onEach(open[0]);
    open[0].done = true;
    open[0].onended();
  }
  throw new Error('the narration never ended');
}

let createAnnouncer;
let VOICE_DEFAULTS;
const data = JSON.parse(readFileSync(new URL('../public/mock.json', import.meta.url), 'utf8'));
const periods = { purchase: 'this-week', design: 'this-week' };

before(async () => {
  ({ createAnnouncer } = await import('../public/js/voice/announcer.js'));
  ({ VOICE_DEFAULTS } = await import('../public/js/voice/voiceModel.js'));
});

/** A rotation with the methods the announcer uses; `people` = how many cards a one-by-one board has. */
function fakeRotation(seq, startAt, announcer, { people = 0 } = {}) {
  const log = [];
  let cur = startAt;
  let page = 0;
  const board = (id) => (id.startsWith('design') ? data.design.byPeriod[periods.design] : data.purchase.byPeriod[periods.purchase]);
  const show = (id) => {
    cur = id;
    page = 0;
    log.push(`show ${id}`);
    announcer.boardShown(id);
    if (id.endsWith('-people')) announcer.personShown(board(id), 0);
  };
  return {
    log,
    current: () => cur,
    page: () => page,
    first: () => seq[0],
    go: show,
    step() { show(seq[(seq.indexOf(cur) + 1) % seq.length]); },
    peekNext: () => seq[(seq.indexOf(cur) + 1) % seq.length],
    holdForVoice(on) { log.push(`hold ${on}`); },
    restartCurrent() { show(cur); },
    nextPage() {
      if (!cur.endsWith('-people') || page + 1 >= people) return false;
      page += 1;
      log.push(`person ${page}`);
      announcer.personShown(board(cur), page);
      return true;
    },
  };
}

const voice = () => ({ ...VOICE_DEFAULTS, enabled: true, mode: 'slides', language: 'en', chime: 'none', sounds: false, engine: 'server' });

describe('reading the slides', () => {
  it('starts from the first slide and moves on only after the last line of each slide has played', async () => {
    playing.length = 0;
    const announcer = createAnnouncer({ getData: () => data, getPeriods: () => periods, onBlockedChange() {} });
    announcer.setVoice(voice());
    const rotation = fakeRotation(['purchase', 'design'], 'design', announcer);
    announcer.setRotation(rotation);
    announcer.speakNow();
    await settle();
    assert.equal(rotation.current(), 'purchase', 'the reading starts on the first slide');
    assert.deepEqual(rotation.log.slice(0, 2), ['hold true', 'show purchase']);
    const seen = [];
    await finishAll((audio) => {
      // Whatever line is playing, the slide it belongs to is still the one on screen.
      const text = lineText(audio);
      seen.push([rotation.current(), text]);
    });
    const onPurchase = seen.filter(([slide]) => slide === 'purchase').map(([, t]) => t);
    const onDesign = seen.filter(([slide]) => slide === 'design').map(([, t]) => t);
    assert.ok(onPurchase.some((t) => /^Purchase top/.test(t)), 'the purchase lines play while purchase is on screen');
    assert.ok(onDesign.some((t) => /^Design top/.test(t)), 'the design lines play while design is on screen');
    assert.ok(!onPurchase.some((t) => /^Design /.test(t)) && !onDesign.some((t) => /^Purchase /.test(t)), 'no line plays over the wrong slide');
    const firstDesign = seen.findIndex(([slide]) => slide === 'design');
    assert.ok(seen.slice(0, firstDesign).every(([slide]) => slide === 'purchase'), 'purchase is never left before its lines end');
    assert.equal(rotation.log[rotation.log.length - 1], 'hold false', 'after one full cycle the slides get their own timing back');
    assert.match(seen[seen.length - 1][1], /Thank you/);
  });

  it('holds each person of a one-by-one slide until their card has been read', async () => {
    playing.length = 0;
    const announcer = createAnnouncer({ getData: () => data, getPeriods: () => periods, onBlockedChange() {} });
    announcer.setVoice(voice());
    const people = data.purchase.byPeriod[periods.purchase].people.filter((p) => p.rank !== null && !p.isGap).length;
    const rotation = fakeRotation(['purchase-people', 'design'], 'purchase-people', announcer, { people });
    announcer.setRotation(rotation);
    announcer.speakNow();
    const seen = [];
    await finishAll((audio) => seen.push([rotation.current(), rotation.page(), lineText(audio)]));
    const cards = seen.filter(([slide, , text]) => slide === 'purchase-people' && /^Number \d/.test(text));
    assert.equal(cards.length, people, 'every person is read');
    cards.forEach(([, page, text]) => assert.match(text, new RegExp(`^Number ${page + 1},`), `card ${page + 1} is read while it is on screen`));
    assert.ok(rotation.log.indexOf('show design') > rotation.log.indexOf(`person ${people - 1}`), 'the next slide comes after the last person');
  });
});
