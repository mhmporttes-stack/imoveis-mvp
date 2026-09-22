import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyGoalPercent } from '../lib/daily-goal-progress.mjs';

test('full daily target includes new, second and third contacts', () => {
  const target = 20 + 41 + 9;
  assert.equal(dailyGoalPercent(17, target), 24);
  assert.equal(dailyGoalPercent(70, target), 100);
  assert.equal(dailyGoalPercent(100, target), 130);
});

test('each extra prospect adds one percentage point for any broker', () => {
  for (const target of [20, 36, 70, 100]) {
    assert.equal(dailyGoalPercent(target + 1, target), 101);
    assert.equal(dailyGoalPercent(target + 30, target), 130);
  }
  assert.equal(dailyGoalPercent(111, 20), 191);
});

test('cannot show completion before all required contacts are done', () => {
  assert.equal(dailyGoalPercent(999, 1000), 99);
  assert.equal(dailyGoalPercent(0, 70), 0);
  assert.equal(dailyGoalPercent(0, 0), 0);
});
