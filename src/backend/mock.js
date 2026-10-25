// Fake backend for development and tests (`npm run dev:mock`, `npm test`). Same interface as backend/firebase.js,
// but everything lives in memory and in the browser's localStorage, so a reload keeps both the login and the data,
// just like the real thing. It also imitates the security rules (a user only reaches stores/<their store>), so
// "permission denied" handling in the UI can be exercised without Firebase.
//
// Test accounts (password for all: test1234):
//   sa-luca@shift.local     store SolbiateArno
//   ca-michele@shift.local  store Castellanza
//   sa-nostore@shift.local  signed in but with NO store assigned (to see that screen)
import { dateStr } from '../util.js';

const PASSWORD = 'test1234';
export const MOCK_USERS = {
  'sa-luca@shift.local': { uid: 'uid-luca', store: 'SolbiateArno' },
  'ca-michele@shift.local': { uid: 'uid-michele', store: 'Castellanza' },
  'sa-nostore@shift.local': { uid: 'uid-nostore', store: null },
};
const DB_KEY = 'mock-firebase:db';
const AUTH_KEY = 'mock-firebase:auth';
const STATUSES = ['pending', 'accepted', 'refused', 'revoked'];

const err = (code, message = code) => Object.assign(new Error(message), { code });
const split = (path) => String(path).split('/').filter(Boolean);
const clone = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));

// A few requests around today, so the page has something to show (and one past request that must stay hidden)
function seedDb(today = new Date()) {
  const day = (n) => { const d = new Date(today); d.setDate(d.getDate() + n); return dateStr(d); };
  const req = (n, name, originalHours, nextHours, status, createdAt) =>
    ({ day: day(n), name, originalHours, nextHours, status, createdAt, createdBy: 'uid-luca' });
  const users = {};
  for (const u of Object.values(MOCK_USERS)) if (u.store) users[u.uid] = u.store;
  return {
    userStores: users,
    stores: {
      SolbiateArno: { extraHoursRequests: {
        '-Mold': req(-2, 'Old Request', '10-14', '10-16', 'accepted', 1),
        '-Ma': req(0, 'Anna', '10-14', '10-14 / 18-22', 'pending', 2),
        '-Mb': req(0, 'Marco', '', '17-22', 'accepted', 3),
        '-Mc': req(1, 'Giulia', '14-22', '12-22', 'refused', 4),
        '-Md': req(3, 'Paolo', '06-14', '06-16', 'pending', 5),
      } },
      Castellanza: { extraHoursRequests: {
        '-Me': req(0, 'Sara (Castellanza)', '10-14', '10-18', 'pending', 6),
      } },
    },
  };
}

export function createMockBackend({ storage = globalThis.localStorage, delay = 120, seed = seedDb } = {}) {
  const mem = new Map(); // fallback when no storage is given
  const store = storage ?? { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
  const wait = () => new Promise((r) => setTimeout(r, delay));

  let db;
  try { db = JSON.parse(store.getItem(DB_KEY)); } catch { db = null; }
  if (!db) { db = seed(); store.setItem(DB_KEY, JSON.stringify(db)); }
  const persist = () => store.setItem(DB_KEY, JSON.stringify(db));

  let currentUid = store.getItem(AUTH_KEY) || null;
  const userByUid = (uid) => Object.entries(MOCK_USERS).find(([, u]) => u.uid === uid);
  const currentUser = () => { const e = currentUid && userByUid(currentUid); return e ? { uid: e[1].uid, email: e[0] } : null; };
  const authListeners = new Set();
  const watchers = new Set();

  // --- imitation of database.rules.json ---
  const storeOfUser = () => (currentUid ? db.userStores?.[currentUid] ?? null : null);
  function canRead(path) {
    const [a, b] = split(path);
    if (!currentUid) return false;
    if (a === 'userStores') return b === currentUid; // only your own mapping, never the whole list
    if (a === 'stores') return !!b && storeOfUser() === b;
    return false;
  }
  const canWrite = (path) => split(path)[0] === 'stores' && canRead(path) && split(path).length >= 2; // clients never write userStores
  function validWrite(path, value) {
    const p = split(path);
    if (p[2] !== 'extraHoursRequests' || p.length !== 4 || value === null) return true;
    const merged = { ...(getAt(p) ?? {}), ...value };
    return /^\d{4}-\d{2}-\d{2}$/.test(merged.day ?? '') && typeof merged.name === 'string' && merged.name.length > 0 && merged.name.length <= 80
      && typeof merged.nextHours === 'string' && merged.nextHours.length <= 80 && typeof (merged.originalHours ?? '') === 'string'
      && STATUSES.includes(merged.status) && typeof merged.createdAt === 'number' && merged.createdBy === (getAt(p)?.createdBy ?? currentUid)
      && Object.keys(merged).every((k) => ['day', 'name', 'originalHours', 'nextHours', 'status', 'createdAt', 'createdBy', 'updatedAt'].includes(k));
  }

  // --- tree helpers ---
  function getAt(parts) { let n = db; for (const k of parts) { if (n == null || typeof n !== 'object') return null; n = n[k]; } return n ?? null; }
  function setAt(parts, value) {
    if (value === null) { const parent = getAt(parts.slice(0, -1)); if (parent) delete parent[parts.at(-1)]; return; }
    let n = db;
    parts.slice(0, -1).forEach((k) => { if (typeof n[k] !== 'object' || n[k] === null) n[k] = {}; n = n[k]; });
    n[parts.at(-1)] = value;
  }
  function listFor(path, opts) {
    let items = Object.entries(getAt(split(path)) ?? {}).map(([id, v]) => ({ id, ...(typeof v === 'object' ? v : { value: v }) }));
    if (opts?.orderBy) {
      const k = opts.orderBy;
      if (opts.startAt !== undefined) items = items.filter((i) => i[k] !== undefined && i[k] >= opts.startAt);
      items.sort((a, b) => (a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : a.id < b.id ? -1 : 1));
    } else items.sort((a, b) => (a.id < b.id ? -1 : 1));
    return clone(items);
  }
  const notifyWatchers = () => watchers.forEach((w) => w());
  const notifyAuth = () => authListeners.forEach((cb) => cb(currentUser()));

  let counter = 0;
  const pushId = () => `-M${Date.now().toString(36)}${(counter++).toString(36).padStart(3, '0')}`;

  async function write(path, fn) {
    await wait();
    if (!canWrite(path)) throw err('permission-denied', 'PERMISSION_DENIED');
    const next = fn();
    if (!validWrite(path, next.value)) throw err('permission-denied', 'PERMISSION_DENIED (validation)');
    next.apply();
    persist();
    notifyWatchers();
    return next.result;
  }

  return {
    name: 'mock',
    configured: true,
    missingConfig: [],

    onAuthChange(cb) {
      authListeners.add(cb);
      const t = setTimeout(() => cb(currentUser()), 0); // like Firebase: first call with the saved login
      return () => { clearTimeout(t); authListeners.delete(cb); };
    },
    async signIn(email, password) {
      await wait();
      const u = MOCK_USERS[String(email).toLowerCase()];
      if (!u || password !== PASSWORD) throw err('bad-credentials', 'auth/invalid-credential');
      currentUid = u.uid;
      store.setItem(AUTH_KEY, currentUid);
      notifyAuth();
    },
    async signOut() {
      await wait();
      currentUid = null;
      store.removeItem(AUTH_KEY);
      notifyAuth();
    },

    async getValue(path) {
      await wait();
      if (!canRead(path)) throw err('permission-denied', 'PERMISSION_DENIED');
      return clone(getAt(split(path)));
    },
    watchList(path, opts, onData, onError) {
      if (!canRead(path)) { const t = setTimeout(() => onError?.(err('permission-denied', 'PERMISSION_DENIED')), delay); return () => clearTimeout(t); }
      let alive = true;
      const emit = () => { if (alive) onData(listFor(path, opts)); };
      const t = setTimeout(emit, delay);
      watchers.add(emit);
      return () => { alive = false; clearTimeout(t); watchers.delete(emit); };
    },
    push(path, value) {
      const key = pushId();
      return write(`${path}/${key}`, () => ({ value, apply: () => setAt([...split(path), key], clone(value)), result: key }));
    },
    update(path, patch) {
      return write(path, () => ({ value: patch, apply: () => { const p = split(path); setAt(p, { ...(getAt(p) ?? {}), ...clone(patch) }); } }));
    },
    remove(path) {
      return write(path, () => ({ value: null, apply: () => setAt(split(path), null) }));
    },

    // test helper: wipes the fake database back to the seed data
    _reset() { db = seed(); persist(); notifyWatchers(); },
  };
}
