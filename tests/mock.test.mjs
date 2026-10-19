// The demo data (public/mock.json, ?mock=1) must have the payload shape the server sends:
// every period of both boards, with the KPI line and each person's score, counts and delay.
// Run: npm test (node --test).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MIS_PERIODS } from '../public/js/settingsModel.js';
import { fmtPct, missPct, mutateMock } from '../public/js/mockDrift.js';

const mock = JSON.parse(readFileSync(new URL('../public/mock.json', import.meta.url), 'utf8'));
const SUMMARY = ['score', 'scoreText', 'scoreTone', 'grade', 'steps', 'onTime', 'onTimePct', 'late', 'overdue', 'pending', 'carryover',
  'missed', 'notDonePct', 'notDoneText', 'avgDelayLabel'];
const PERSON = ['id', 'rank', 'name', 'score', 'scoreText', 'grade', 'steps', 'onTime', 'late', 'overdue', 'pending', 'carryover', 'avgDelayLabel', 'worstStep', 'tags'];
const boards = (d) => ['purchase', 'design'].flatMap((kind) => Object.values(d[kind].byPeriod));

describe('demo data', () => {
  it('has every period of both boards', () => {
    assert.deepEqual(Object.keys(mock.purchase.byPeriod).sort(), MIS_PERIODS.map((p) => p.key).sort());
    assert.deepEqual(Object.keys(mock.design.byPeriod).sort(), MIS_PERIODS.map((p) => p.key).sort());
  });

  it('carries the KPI line and every person\'s score, counts and delay', () => {
    boards(mock).forEach((b) => {
      assert.ok(['purchase', 'design'].includes(b.kind));
      SUMMARY.forEach((f) => assert.ok(f in b.summary, `${b.kind} summary.${f}`));
      b.people.forEach((p) => PERSON.forEach((f) => assert.ok(f in p, `${p.name}.${f}`)));
    });
  });

  it('drifts the MIS way: the signed % from the counts, ranked closest to 0% first', () => {
    let d = mock;
    for (let i = 0; i < 30; i += 1) d = mutateMock(d);
    boards(d).forEach((b) => {
      const ranked = b.people.filter((p) => p.rank !== null);
      ranked.forEach((p, i) => {
        assert.equal(p.rank, i + 1);
        assert.equal(p.scoreText, fmtPct(missPct(p.steps - p.onTime, p.steps)));
        if (i > 0) assert.ok(ranked[i - 1].score >= p.score);
      });
    });
  });
});
