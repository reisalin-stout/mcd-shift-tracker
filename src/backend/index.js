// Picks the backend. Everything else in the app imports THIS file, never the Firebase SDK.
//
// Interface (implemented by backend/firebase.js and backend/mock.js):
//   name, configured, missingConfig
//   onAuthChange(cb(user | null)) -> unsubscribe        user = { uid, email }
//   signIn(email, password), signOut()
//   getValue(path) -> value | null
//   watchList(path, { orderBy?, startAt? }, onData([{ id, ...value }]), onError(err)) -> unsubscribe
//   push(path, value) -> key,   update(path, patch),   remove(path)
// Errors carry a normalised `code`: permission-denied | bad-credentials | too-many-requests | network | user-disabled | unknown.
//
// `npm run dev:mock` (Vite mode "mock") swaps in an in-browser fake so the app can be developed and tested without
// touching the real database. The check is on the build mode, so it is removed from the normal builds
// (`npm run build`, and so GitHub Pages) and cannot be switched on by accident in production.
import real from './firebase.js';

let backend = real;
if (import.meta.env.MODE === 'mock') {
  const { createMockBackend } = await import('./mock.js');
  backend = createMockBackend();
}
export default backend;
