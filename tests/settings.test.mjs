// The browser's settings copy (public/js/settingsModel.js) must match the server's
// (lib/settings.js) and the engine's period keys, or a save is rejected.
// Run: npm test (node --test).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as browser from '../public/js/settingsModel.js';
import * as server from '../lib/settings.js';
import { MIS_PERIOD_KEYS } from '../engine/index.js';

describe('settings shape', () => {
  it('has the same boards and defaults on both sides', () => {
    assert.deepEqual(browser.BOARD_IDS, server.BOARD_IDS);
    assert.deepEqual(browser.DEFAULT_SETTINGS, server.DEFAULT_SETTINGS);
    assert.deepEqual(Object.keys(browser.BOARD_LABELS), browser.BOARD_IDS);
  });

  it('offers exactly the MIS pages\' periods for both boards: This week, Last week, This month, Last month', () => {
    assert.deepEqual(browser.PURCHASE_PERIODS.map((p) => p.key), MIS_PERIOD_KEYS);
    assert.deepEqual(browser.DESIGN_PERIODS.map((p) => p.key), MIS_PERIOD_KEYS);
    assert.deepEqual(browser.PURCHASE_PERIODS.map((p) => p.chip), ['This week', 'Last week', 'This month', 'Last month']);
  });

  it('reads a period saved before as the nearest MIS period, on both sides', () => {
    const old = { purchasePeriod: 'weekly', designPeriod: 'lastm' };
    const clean = browser.sanitizeSettings(old);
    assert.equal(clean.purchasePeriod, 'this-week');
    assert.equal(clean.designPeriod, 'last-month');
    const { settings, errors } = server.normalize({ purchasePeriod: 'mtd', designPeriod: '30d' });
    assert.deepEqual(errors, []);
    assert.equal(settings.purchasePeriod, 'this-month');
    assert.equal(settings.designPeriod, 'this-month');
    assert.equal(server.normalize({ purchasePeriod: 'nope' }).errors.length, 1);
  });

  it('adds the one-by-one boards to a board list saved before them, keeping its order and times', () => {
    const boards = [
      { id: 'design', enabled: true, dwellSec: 30 }, { id: 'design-leader', enabled: false, dwellSec: 8 },
      { id: 'purchase', enabled: true, dwellSec: 25 }, { id: 'purchase-leader', enabled: true, dwellSec: 8 },
    ];
    const { settings, errors } = server.normalize({ boards });
    assert.deepEqual(errors, []);
    assert.deepEqual(settings.boards.map((b) => b.id), ['design', 'design-people', 'design-leader', 'purchase', 'purchase-people', 'purchase-leader']);
    assert.equal(settings.boards.find((b) => b.id === 'design').dwellSec, 30);
    assert.equal(settings.boards.find((b) => b.id === 'design-leader').enabled, false);
    assert.deepEqual(browser.sanitizeSettings({ boards }).boards, settings.boards);
  });

  it('cleans a saved file the way the server does', () => {
    const input = { purchasePeriod: 'monthly', designPeriod: 'nope', boards: [{ id: 'crm' }] };
    const clean = browser.sanitizeSettings(input);
    assert.equal(clean.purchasePeriod, 'this-month');
    assert.equal(clean.designPeriod, 'this-week');
    assert.deepEqual(clean.boards, browser.DEFAULT_SETTINGS.boards);
    assert.deepEqual(server.normalize(clean).errors, []);
  });
});
