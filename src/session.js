// Login state for the whole app: who is signed in and which store they belong to.
//
// status:
//   'unconfigured'  Firebase variables are missing (see src/firebase.js)
//   'loading'       checking the saved login (first moments after opening the app)
//   'out'           nobody signed in
//   'nostore'       signed in, but the account has no entry in userStores yet (an admin has to add it)
//   'in'            signed in with a store
// The store id ALWAYS comes from userStores/<uid> in the database, never from anything the person types.
import backend from './backend/index.js';
import { usernameToEmail, emailToUsername, displayName, isValidStoreId, DEFAULT_DOMAIN } from './names.js';

const DOMAIN = import.meta.env.VITE_AUTH_EMAIL_DOMAIN || DEFAULT_DOMAIN;

export const session = { status: backend.configured ? 'loading' : 'unconfigured', uid: null, email: null, username: '', name: '', storeId: null, error: null };
const listeners = new Set();
export const onSession = (cb) => { listeners.add(cb); return () => listeners.delete(cb); };
const emit = () => listeners.forEach((cb) => cb(session));
const set = (patch) => { Object.assign(session, patch); emit(); };

// Error -> sentence for the UI
export function friendlyError(e) {
  switch (e?.code) {
    case 'bad-credentials': return 'Wrong username or password.';
    case 'too-many-requests': return 'Too many attempts. Wait a few minutes and try again.';
    case 'user-disabled': return 'This account has been disabled. Ask the administrator.';
    case 'network': return 'No connection. Check the internet and try again.';
    case 'permission-denied': return 'This account is not allowed to do that.';
    default: return 'Something went wrong. Try again.';
  }
}

let started = false;
let token = 0; // ignores the answer of an older lookup when the login changes in the meantime
export function startSession() {
  if (started) return;
  started = true;
  if (!backend.configured) return; // status stays 'unconfigured'
  backend.onAuthChange(async (user) => {
    const mine = ++token;
    if (!user) return set({ status: 'out', uid: null, email: null, username: '', name: '', storeId: null, error: null });
    const username = emailToUsername(user.email);
    set({ status: 'loading', uid: user.uid, email: user.email, username, name: displayName(username), storeId: null, error: null });
    try {
      const storeId = await backend.getValue(`userStores/${user.uid}`);
      if (mine !== token) return;
      if (typeof storeId === 'string' && isValidStoreId(storeId)) set({ status: 'in', storeId });
      else set({ status: 'nostore', storeId: null });
    } catch (e) {
      if (mine !== token) return;
      set({ status: 'nostore', storeId: null, error: friendlyError(e) });
    }
  });
}

export async function signIn(username, password) {
  const email = usernameToEmail(username, DOMAIN);
  if (!email || !password) throw Object.assign(new Error('missing'), { code: 'bad-credentials' });
  await backend.signIn(email, password); // the auth listener above updates the session
}
export const signOut = () => backend.signOut();
export const missingConfig = backend.missingConfig;
export const backendName = backend.name;
