// Pure logic: usernames, extra-hours rules. Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { usernameToEmail, emailToUsername, displayName, prettyStore, isValidStoreId } from '../../src/names.js';
import { validateRequest, newRequest, upcoming, groupByDay, dayLabel, TRANSITIONS, STATUSES } from '../../src/extraHours.js';

test('usernames become mock emails', () => {
  assert.equal(usernameToEmail('sa-luca'), 'sa-luca@shift.local');
  assert.equal(usernameToEmail('  SA-Luca '), 'sa-luca@shift.local');
  assert.equal(usernameToEmail('ca-michele@shift.local'), 'ca-michele@shift.local');
  assert.equal(usernameToEmail('sa-luca', 'example.org'), 'sa-luca@example.org');
  assert.equal(usernameToEmail('   '), '');
  assert.equal(emailToUsername('sa-luca@shift.local'), 'sa-luca');
});
test('display names and store names', () => {
  assert.equal(displayName('sa-luca'), 'Luca');
  assert.equal(displayName('admin'), 'Admin');
  assert.equal(prettyStore('SolbiateArno'), 'Solbiate Arno');
  assert.equal(prettyStore('Castellanza'), 'Castellanza');
  assert.ok(isValidStoreId('SolbiateArno') && !isValidStoreId('a/b') && !isValidStoreId('') && !isValidStoreId('x.y'));
});
test('request validation', () => {
  const ok = validateRequest({ day: '2026-10-25', name: ' Anna ', originalHours: '', nextHours: '10-14 / 18-22' }, '2026-10-24');
  assert.equal(ok.ok, true);
  assert.equal(ok.value.name, 'Anna');
  assert.equal(validateRequest({ day: '2026-10-23', name: 'A', nextHours: '1' }, '2026-10-24').ok, false, 'past day');
  assert.equal(validateRequest({ day: '2026-10-24', name: 'A', nextHours: '1' }, '2026-10-24').ok, true, 'today is allowed');
  assert.equal(validateRequest({ day: '', name: 'A', nextHours: '1' }, '2026-10-24').ok, false);
  assert.equal(validateRequest({ day: '2026-10-25', name: ' ', nextHours: '1' }, '2026-10-24').ok, false);
  assert.equal(validateRequest({ day: '2026-10-25', name: 'A', nextHours: '' }, '2026-10-24').ok, false);
  assert.equal(validateRequest({ day: '2026-10-25', name: 'x'.repeat(81), nextHours: '1' }, '2026-10-24').ok, false);
});
test('new request shape matches the database rules', () => {
  const r = newRequest({ day: '2026-10-25', name: 'A', originalHours: '', nextHours: '1' }, 'uid1', 123);
  assert.deepEqual(Object.keys(r).sort(), ['createdAt', 'createdBy', 'day', 'name', 'nextHours', 'originalHours', 'status'].sort());
  assert.equal(r.status, 'pending');
});
test('upcoming drops past days, sorts by day then creation, groups by day', () => {
  const items = [
    { id: 'a', day: '2026-10-26', name: 'C', createdAt: 1 },
    { id: 'b', day: '2026-10-23', name: 'old', createdAt: 1 },
    { id: 'c', day: '2026-10-24', name: 'B', createdAt: 5 },
    { id: 'd', day: '2026-10-24', name: 'A', createdAt: 2 },
    { id: 'e', name: 'no day' },
  ];
  const up = upcoming(items, '2026-10-24');
  assert.deepEqual(up.map((r) => r.id), ['d', 'c', 'a']);
  assert.deepEqual(groupByDay(up).map((g) => [g.day, g.items.length]), [['2026-10-24', 2], ['2026-10-26', 1]]);
});
test('day labels', () => {
  assert.match(dayLabel('2026-10-24', '2026-10-24'), /^Today · Sat 24 Oct 2026$/);
  assert.match(dayLabel('2026-10-25', '2026-10-24'), /^Tomorrow · Sun 25 Oct 2026$/);
  assert.match(dayLabel('2026-12-01', '2026-10-24'), /^Tue 1 Dec 2026$/);
  assert.match(dayLabel('2026-03-29', '2026-03-28'), /^Tomorrow/, 'DST change day');
});
test('status transitions only lead to real statuses, and revoke only follows accept', () => {
  for (const [from, list] of Object.entries(TRANSITIONS)) {
    assert.ok(STATUSES.includes(from));
    for (const [to] of list) { assert.ok(STATUSES.includes(to)); assert.notEqual(to, from); }
  }
  const revokeFrom = Object.entries(TRANSITIONS).filter(([, l]) => l.some(([to]) => to === 'revoked')).map(([f]) => f);
  assert.deepEqual(revokeFrom, ['accepted']);
});
