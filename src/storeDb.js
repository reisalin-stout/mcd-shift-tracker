// Store-scoped database access: THE way the app reads and writes shared data.
//
// Every path is built as stores/<storeId>/<path> with the store id from the verified login (session.js), so a
// feature cannot accidentally touch another store or the root. Add new store data (shifts, ...) through these
// helpers, then add its rules to database.rules.json.
import backend from './backend/index.js';
import { session } from './session.js';

function base(path) {
  if (session.status !== 'in' || !session.storeId) throw Object.assign(new Error('Not signed in to a store'), { code: 'permission-denied' });
  const clean = String(path).replace(/^\/+|\/+$/g, '');
  if (clean.split('/').some((p) => p === '..' || p === '')) throw new Error(`Bad path: ${path}`);
  return `stores/${session.storeId}/${clean}`;
}

export const watchList = (path, opts, onData, onError) => backend.watchList(base(path), opts, onData, onError);
export const getValue = (path) => backend.getValue(base(path));
export const push = (path, value) => backend.push(base(path), value);
export const update = (path, patch) => backend.update(base(path), patch);
export const remove = (path) => backend.remove(base(path));
