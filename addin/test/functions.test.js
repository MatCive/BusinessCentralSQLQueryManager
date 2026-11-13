import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dateAdd, dateDiff, datePart, plus } from '../src/functions.js';

test('DATEADD follows SQL Server', () => {
  assert.equal(dateAdd('day', 5, '2025-02-26'), '2025-03-03');
  assert.equal(dateAdd('month', 1, '2025-01-31'), '2025-02-28'); // clamped to month end
  assert.equal(dateAdd('mm', -1, '2024-03-31'), '2024-02-29');
  assert.equal(dateAdd('year', 1, '2024-02-29'), '2025-02-28');
  assert.equal(dateAdd('quarter', 1, '2025-11-30'), '2026-02-28');
  assert.equal(dateAdd('hour', 2, '2025-01-01 23:30:00.000'), '2025-01-02 01:30:00.000');
  assert.equal(dateAdd('day', 1, null), null);
});

test('DATEDIFF counts boundaries crossed', () => {
  assert.equal(dateDiff('year', '2024-12-31', '2025-01-01'), 1);
  assert.equal(dateDiff('month', '2025-01-31', '2025-02-01'), 1);
  assert.equal(dateDiff('day', '2025-01-01 23:59:00', '2025-01-02 00:01:00'), 1);
  assert.equal(dateDiff('dd', '2025-03-10', '2025-03-01'), -9);
  assert.equal(dateDiff('week', '2025-01-04', '2025-01-05'), 1); // Saturday -> Sunday
  assert.equal(dateDiff('week', '2025-01-05', '2025-01-11'), 0); // Sunday -> Saturday
  assert.equal(dateDiff('quarter', '2025-03-31', '2025-04-01'), 1);
});

test('DATEPART', () => {
  assert.equal(datePart('year', '2025-07-15'), 2025);
  assert.equal(datePart('qq', '2025-07-15'), 3);
  assert.equal(datePart('dayofyear', '2025-02-01'), 32);
  assert.equal(datePart('weekday', '2025-01-05'), 1); // Sunday
  assert.equal(datePart('week', '2025-01-05'), 2);
  assert.throws(() => datePart('fortnight', '2025-01-01'), /Unknown date part/);
});

test("'+' concatenates strings and adds numbers like T-SQL", () => {
  assert.equal(plus('a', 'b'), 'ab');
  assert.equal(plus(1, 2), 3);
  assert.equal(plus('1', 2), 3);
  assert.equal(plus('a', null), null);
  assert.throws(() => plus('abc', 1), /Conversion failed/);
});
