// The mock backend imitates database.rules.json. These tests check the behaviour the real rules must also have
// (the rules themselves can only be tested in Firebase: see README section 7, "Firebase setup" step 5).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockBackend } from '../../src/backend/mock.js';

const memStorage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const fresh = (storage = memStorage()) => createMockBackend({ storage, delay: 0 });
const list = (b, path, opts = {}) => new Promise((res, rej) => { const u = b.watchList(path, opts, (d) => { u(); res(d); }, rej); });
const reqs = (store) => `stores/${store}/extraHoursRequests`;
const good = (uid, over = {}) => ({ day: '2099-01-01', name: 'N', originalHours: '', nextHours: '10-12', status: 'pending', createdAt: 1, createdBy: uid, ...over });

test('sign in / sign out / wrong password', async () => {
  const b = fresh();
  await assert.rejects(b.signIn('sa-luca@shift.local', 'bad'), { code: 'bad-credentials' });
  await assert.rejects(b.signIn('nobody@shift.local', 'test1234'), { code: 'bad-credentials' });
  const seen = [];
  b.onAuthChange((u) => seen.push(u?.uid ?? null));
  await b.signIn('sa-luca@shift.local', 'test1234');
  await b.signOut();
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(seen, [null, 'uid-luca', null]);
});
test('login survives a "reload" (same storage), logout clears it', async () => {
  const storage = memStorage();
  await fresh(storage).signIn('sa-luca@shift.local', 'test1234');
  const again = fresh(storage);
  const u = await new Promise((res) => again.onAuthChange(res));
  assert.equal(u.uid, 'uid-luca');
  await again.signOut();
  assert.equal(await new Promise((res) => fresh(storage).onAuthChange(res)), null);
});
test('a user reads only their own userStores entry', async () => {
  const b = fresh();
  await b.signIn('sa-luca@shift.local', 'test1234');
  assert.equal(await b.getValue('userStores/uid-luca'), 'SolbiateArno');
  await assert.rejects(b.getValue('userStores/uid-michele'), { code: 'permission-denied' });
  await assert.rejects(b.getValue('userStores'), { code: 'permission-denied' });
  await assert.rejects(b.getValue(''), { code: 'permission-denied' });
});
test('nobody signed in reads nothing', async () => {
  const b = fresh();
  await assert.rejects(b.getValue('userStores/uid-luca'), { code: 'permission-denied' });
  await assert.rejects(list(b, reqs('SolbiateArno')), { code: 'permission-denied' });
});
test('cross-store access is denied for reads, writes, updates and deletes', async () => {
  const b = fresh();
  await b.signIn('sa-luca@shift.local', 'test1234');
  await assert.rejects(list(b, reqs('Castellanza')), { code: 'permission-denied' });
  await assert.rejects(b.getValue('stores/Castellanza'), { code: 'permission-denied' });
  await assert.rejects(b.push(reqs('Castellanza'), good('uid-luca')), { code: 'permission-denied' });
  await assert.rejects(b.update(`${reqs('Castellanza')}/-Me`, { status: 'accepted' }), { code: 'permission-denied' });
  await assert.rejects(b.remove(`${reqs('Castellanza')}/-Me`), { code: 'permission-denied' });
  await assert.rejects(b.getValue('stores'), { code: 'permission-denied' });
});
test('clients can never write userStores (no self-assigning a store)', async () => {
  const b = fresh();
  await b.signIn('sa-luca@shift.local', 'test1234');
  await assert.rejects(b.push('userStores', 'Castellanza'), { code: 'permission-denied' });
  await assert.rejects(b.update('userStores', { 'uid-luca': 'Castellanza' }), { code: 'permission-denied' });
  await assert.rejects(b.remove('userStores/uid-luca'), { code: 'permission-denied' });
});
test('an account without a store mapping cannot read or write any store', async () => {
  const b = fresh();
  await b.signIn('sa-nostore@shift.local', 'test1234');
  assert.equal(await b.getValue('userStores/uid-nostore'), null);
  await assert.rejects(list(b, reqs('SolbiateArno')), { code: 'permission-denied' });
  await assert.rejects(b.push(reqs('SolbiateArno'), good('uid-nostore')), { code: 'permission-denied' });
});
test('own store: query "from today" returns only later days, in day order', async () => {
  const b = fresh();
  await b.signIn('sa-luca@shift.local', 'test1234');
  const all = await list(b, reqs('SolbiateArno'));
  assert.ok(all.length >= 5);
  const from = all.map((r) => r.day).sort()[1]; // skip the oldest day
  const sub = await list(b, reqs('SolbiateArno'), { orderBy: 'day', startAt: from });
  assert.ok(sub.length < all.length && sub.every((r) => r.day >= from));
  assert.deepEqual(sub.map((r) => r.day), [...sub.map((r) => r.day)].sort());
});
test('add / update / delete in own store, and watchers get notified', async () => {
  const b = fresh();
  await b.signIn('sa-luca@shift.local', 'test1234');
  const seen = [];
  const unsub = b.watchList(reqs('SolbiateArno'), { orderBy: 'day', startAt: '2099-01-01' }, (d) => seen.push(d.length), () => {});
  await new Promise((r) => setTimeout(r, 5));
  const key = await b.push(reqs('SolbiateArno'), good('uid-luca'));
  await b.update(`${reqs('SolbiateArno')}/${key}`, { status: 'accepted', updatedAt: 5 });
  assert.equal((await list(b, reqs('SolbiateArno'), { orderBy: 'day', startAt: '2099-01-01' }))[0].status, 'accepted');
  await b.remove(`${reqs('SolbiateArno')}/${key}`);
  unsub();
  assert.deepEqual(seen, [0, 1, 1, 0], 'initial, after add, after update, after delete');
});
test('validation (like .validate in the rules): bad status, bad day, extra fields, forged creator', async () => {
  const b = fresh();
  await b.signIn('sa-luca@shift.local', 'test1234');
  const p = reqs('SolbiateArno');
  await assert.rejects(b.push(p, good('uid-luca', { status: 'hacked' })), { code: 'permission-denied' });
  await assert.rejects(b.push(p, good('uid-luca', { day: 'tomorrow' })), { code: 'permission-denied' });
  await assert.rejects(b.push(p, good('uid-luca', { name: '' })), { code: 'permission-denied' });
  await assert.rejects(b.push(p, good('uid-luca', { name: 'x'.repeat(81) })), { code: 'permission-denied' });
  await assert.rejects(b.push(p, good('uid-luca', { extra: 1 })), { code: 'permission-denied' });
  await assert.rejects(b.push(p, good('uid-michele')), { code: 'permission-denied' }, 'createdBy must be the signed-in user');
  const key = await b.push(p, good('uid-luca'));
  await assert.rejects(b.update(`${p}/${key}`, { status: 'nope' }), { code: 'permission-denied' });
  await assert.rejects(b.update(`${p}/${key}`, { createdBy: 'uid-michele' }), { code: 'permission-denied' }, 'creator cannot be rewritten');
});
test('data survives a "reload"', async () => {
  const storage = memStorage();
  const a = fresh(storage); await a.signIn('sa-luca@shift.local', 'test1234');
  const key = await a.push(reqs('SolbiateArno'), good('uid-luca', { name: 'Persist' }));
  const b = fresh(storage);
  const u = await new Promise((res) => b.onAuthChange(res)); assert.ok(u);
  assert.ok((await list(b, reqs('SolbiateArno'))).some((r) => r.id === key && r.name === 'Persist'));
});
