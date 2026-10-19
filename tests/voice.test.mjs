// Voice: settings cleaning/validation, schedule, and what is said for each board.
// Run: npm test (node --test).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { VOICE_DEFAULTS, sanitizeVoice, voiceErrors } from '../public/js/voice/voiceModel.js';
import { GRACE_MS, dueSlot, scheduleLabel } from '../public/js/voice/schedule.js';
import { boardLines, personLines, summaryLines } from '../public/js/voice/script.js';
import { DEFAULT_SETTINGS, normalize } from '../lib/settings.js';
import { readFileSync } from 'node:fs';

const voiceWith = (patch) => sanitizeVoice(patch);

describe('voice settings', () => {
  it('fills the defaults when nothing is saved yet', () => {
    assert.deepEqual(sanitizeVoice(undefined), { ...VOICE_DEFAULTS });
  });

  it('keeps times in the order they were entered and drops repeats', () => {
    assert.deepEqual(voiceWith({ times: ['16:30', '09:00', '16:30'] }).times, ['16:30', '09:00']);
  });

  it('reports bad values instead of saving them', () => {
    assert.equal(voiceErrors({ times: ['9am'] }).length, 1);
    assert.equal(voiceErrors({ volume: 3 }).length, 1);
    assert.equal(voiceErrors({ sections: { jokes: true } }).length, 1);
    assert.deepEqual(voiceErrors({ enabled: true, mode: 'summary', times: ['09:30'] }), []);
  });

  it('is part of the shared settings the server stores', () => {
    const { settings, errors } = normalize({ voice: { enabled: true, times: ['09:30'] } });
    assert.deepEqual(errors, []);
    assert.equal(settings.voice.enabled, true);
    assert.deepEqual(settings.voice.times, ['09:30']);
  });

  it('keeps the saved voice when an update is invalid', () => {
    const { settings, errors } = normalize({ voice: { times: ['9am'] } });
    assert.match(errors[0], /^voice\.times/);
    assert.deepEqual(settings.voice.times, VOICE_DEFAULTS.times);
  });

  it('gives settings saved before the voice existed the default voice', () => {
    const { voice, ...older } = DEFAULT_SETTINGS;
    assert.deepEqual(normalize({}, older).settings.voice, voice);
  });

  it('needs at least one thing to say', () => {
    const allOff = Object.fromEntries(Object.keys(VOICE_DEFAULTS.sections).map((k) => [k, false]));
    assert.deepEqual(normalize({ voice: { sections: allOff } }).errors, ['voice must say at least one thing']);
  });
});

describe('voice schedule', () => {
  const daily = voiceWith({ enabled: true, times: ['16:30', '10:00'] });
  // weekday 1 = Monday 2026-10-05, 4 = Thursday 2026-10-08 (Date#getDay numbering)
  const at = (weekday, h, m) => new Date(2026, 9, 4 + weekday, h, m);

  it('plays a time from its minute until the grace window ends, once per screen', () => {
    assert.equal(dueSlot(daily, at(1, 10, 0)), '2026-10-05 10:00');
    assert.equal(dueSlot(daily, new Date(at(1, 10, 0).getTime() + GRACE_MS - 1)), '2026-10-05 10:00');
    assert.equal(dueSlot(daily, new Date(at(1, 10, 0).getTime() + GRACE_MS)), null);
    assert.equal(dueSlot(daily, at(1, 10, 2), ['2026-10-05 10:00']), null);
  });

  it('stays quiet when off and on days a weekly schedule skips', () => {
    assert.equal(dueSlot({ ...daily, enabled: false }, at(1, 10, 0)), null);
    const weekly = { ...daily, frequency: 'weekly', weekdays: [4] };
    assert.equal(dueSlot(weekly, at(1, 10, 0)), null);
    assert.equal(dueSlot(weekly, at(4, 10, 0)), '2026-10-08 10:00');
  });

  it('keeps to the office IST clock even on a screen whose own time zone is not IST', () => {
    // 04:32 UTC = 10:02 IST on Monday 5 Oct 2026, whatever TZ this process runs in.
    assert.equal(dueSlot(daily, new Date('2026-10-05T04:32:00Z')), '2026-10-05 10:00');
    assert.equal(dueSlot(daily, new Date('2026-10-05T10:00:00Z')), null); // 15:30 IST: nothing due
    const weekly = { ...daily, frequency: 'weekly', weekdays: [1] };
    assert.equal(dueSlot(weekly, new Date('2026-10-04T23:00:00Z')), null); // Sun 23:00 UTC is Mon 04:30 IST: no 10:00 yet
  });

  it('describes the schedule in time order', () => {
    assert.equal(scheduleLabel(daily), 'Every day at 10:00, 16:30 IST');
    assert.equal(scheduleLabel({ ...daily, frequency: 'weekly', weekdays: [1, 4] }), 'Mon, Thu at 10:00, 16:30 IST');
  });
});

const mock = JSON.parse(readFileSync(new URL('../public/mock.json', import.meta.url), 'utf8'));
const periods = { purchase: 'this-week', design: 'this-week' };
const en = sanitizeVoice({ language: 'en', sections: { leaders: true, delays: true, bottom: true, team: true } });
const texts = (lines) => lines.filter((x) => typeof x === 'string');
const cues = (lines) => lines.filter((x) => typeof x === 'object').map((x) => x.cue);
const ranked = (board) => board.people.filter((p) => p.rank !== null && !p.isGap).sort((a, b) => a.rank - b.rank);

describe('what the voice says', () => {
  const purchase = mock.purchase.byPeriod[periods.purchase];
  const design = mock.design.byPeriod[periods.design];

  it('reads the purchase board as the screen shows it: the top with a fanfare, who is late and by how much, the last with a push, the team', () => {
    const lines = boardLines('purchase', mock, periods, en);
    const said = texts(lines).join(' ');
    const [top] = ranked(purchase);
    const last = ranked(purchase).at(-1);
    assert.equal(cues(lines)[0], 'congrats');
    assert.ok(cues(lines).includes('push'));
    assert.match(said, new RegExp(`Purchase top this week: ${top.name}, score minus ${Math.abs(top.score)} percent, grade ${top.grade}`));
    assert.match(said, new RegExp(`Last: ${last.name}, score minus ${Math.abs(last.score)} percent`));
    assert.match(said, /late on average/);
    assert.match(said, new RegExp(`The Purchase team had ${purchase.summary.steps} steps due this week, ${purchase.summary.onTime} on time; team score minus`));
    assert.ok(!/undefined|NaN|null/.test(said));
  });

  it('reads the design board and the two spotlights', () => {
    assert.match(texts(boardLines('design', mock, periods, en)).join(' '), /^Design top this week: /);
    assert.match(texts(boardLines('purchase-leader', mock, periods, en))[0], /^Purchase number one this week: /);
    assert.match(texts(boardLines('design-leader', mock, periods, en))[0], /^Design number one this week: /);
  });

  it('says each delay in words: 8h 47m is 8 hours 47 minutes', () => {
    const person = { ...ranked(purchase)[0], avgDelayLabel: '8h 47m' };
    const board = { ...purchase, people: [person] };
    assert.match(texts(personLines(board, 0, en)).join(' '), /8 hours 47 minutes late on average/);
  });

  it('reads one card at a time on the one-by-one slides: a fanfare for the top and the runner-up, a push for the last', () => {
    const people = ranked(purchase);
    const first = personLines(purchase, 0, en);
    assert.match(texts(first)[0], /^Now everyone in Purchase, one by one/);
    assert.equal(cues(first)[0], 'congrats');
    assert.match(texts(first)[1], new RegExp(`^Number 1, ${people[0].name}: score minus`));
    assert.deepEqual(cues(personLines(purchase, people.length - 1, en)), people.length > 2 ? ['push'] : []);
    assert.deepEqual(personLines(purchase, people.length, en), []);
  });

  it('speaks Hindi in Devanagari with the grade spelled out', () => {
    const hi = sanitizeVoice({ language: 'hi' });
    const said = texts(boardLines('purchase', mock, periods, hi)).join(' ');
    assert.match(said, /माइनस/);
    assert.match(said, /प्रतिशत/);
    assert.match(said, /ग्रेड (ए|बी|सी|डी)/);
  });

  it('builds one summary, purchase then design, and says so when there is no board yet', () => {
    const lines = texts(summaryLines(mock, periods, en));
    assert.match(lines[0], /^Hello team/);
    assert.ok(lines.findIndex((t) => /^Purchase top/.test(t)) < lines.findIndex((t) => /^Design top/.test(t)));
    assert.deepEqual(summaryLines(null, periods, en), ['The board has no data yet.']);
  });
});
