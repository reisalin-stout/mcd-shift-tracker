// Real backend: Firebase Auth + Realtime Database. Implements the same small interface as backend/mock.js
// (see backend/index.js), so the rest of the app never imports the Firebase SDK directly.
import { onAuthStateChanged, signInWithEmailAndPassword, signOut as fbSignOut } from 'firebase/auth';
import { ref, get, push as fbPush, set, update as fbUpdate, remove as fbRemove, query, orderByChild, startAt, onValue } from 'firebase/database';
import { auth, database, configured, missingConfig } from '../firebase.js';

// Firebase errors -> a small set of app error codes the UI can explain (see session.js friendlyError)
export function normalizeError(err) {
  const raw = String(err?.code ?? err?.message ?? '');
  let code = 'unknown';
  if (/permission[-_ ]denied/i.test(raw)) code = 'permission-denied';
  else if (/invalid-credential|wrong-password|user-not-found|invalid-email|invalid-login/i.test(raw)) code = 'bad-credentials';
  else if (/too-many-requests/i.test(raw)) code = 'too-many-requests';
  else if (/network|unavailable|disconnected/i.test(raw)) code = 'network';
  else if (/user-disabled/i.test(raw)) code = 'user-disabled';
  const e = new Error(err?.message ?? raw);
  e.code = code;
  e.original = err;
  return e;
}
const wrap = async (fn) => { try { return await fn(); } catch (e) { throw normalizeError(e); } };

export default {
  name: 'firebase',
  configured,
  missingConfig,

  // cb(user | null) with user = { uid, email }. Fires once with the saved login (or null) on startup.
  onAuthChange(cb) {
    if (!auth) { cb(null); return () => {}; }
    return onAuthStateChanged(auth, (u) => cb(u ? { uid: u.uid, email: u.email } : null));
  },
  signIn: (email, password) => wrap(() => signInWithEmailAndPassword(auth, email, password)).then(() => {}),
  signOut: () => wrap(() => fbSignOut(auth)),

  // One-time read of a path (null when empty)
  getValue: (path) => wrap(async () => (await get(ref(database, path))).val()),

  // Live list of the children of `path` as [{ id, ...value }], in query order. opts: { orderBy: 'day', startAt: '2026-10-24' }
  // (needs ".indexOn" for that child in database.rules.json, otherwise Firebase filters on the device and warns in the console)
  watchList(path, opts, onData, onError) {
    const r = ref(database, path);
    const q = opts?.orderBy ? query(r, orderByChild(opts.orderBy), ...(opts.startAt !== undefined ? [startAt(opts.startAt)] : [])) : r;
    return onValue(q, (snap) => {
      const out = [];
      snap.forEach((c) => { out.push({ id: c.key, ...c.val() }); });
      onData(out);
    }, (err) => onError?.(normalizeError(err)));
  },

  // Adds a child with a generated key; resolves to the key
  push: (path, value) => wrap(async () => { const r = fbPush(ref(database, path)); await set(r, value); return r.key; }),
  // Changes only the given fields of a node
  update: (path, patch) => wrap(() => fbUpdate(ref(database, path), patch)),
  remove: (path) => wrap(() => fbRemove(ref(database, path))),
};
