// Pure helpers for usernames and store ids (no DOM, no Firebase), so they can be tested in plain Node.
//
// People type a short username ("sa-luca"); Firebase Email/Password needs an email, so the app appends a fixed
// mock domain ("sa-luca@shift.local"). The domain comes from VITE_AUTH_EMAIL_DOMAIN (default shift.local).
export const DEFAULT_DOMAIN = 'shift.local';

// "  SA-Luca " -> "sa-luca@shift.local". A full email is kept as typed (lower-cased).
export function usernameToEmail(input, domain = DEFAULT_DOMAIN) {
  const v = String(input ?? '').trim().toLowerCase().replace(/\s+/g, '');
  if (!v) return '';
  return v.includes('@') ? v : `${v}@${domain || DEFAULT_DOMAIN}`;
}

// "sa-luca@shift.local" -> "sa-luca"
export const emailToUsername = (email) => String(email ?? '').split('@')[0];

// "sa-luca" -> "Luca" (the part after the store prefix, capitalised); names without a prefix are just capitalised
export function displayName(username) {
  const u = String(username ?? '');
  const part = u.includes('-') ? u.slice(u.indexOf('-') + 1) : u;
  return part ? part.charAt(0).toUpperCase() + part.slice(1) : '';
}

// "SolbiateArno" -> "Solbiate Arno" (store ids stay machine-friendly, this is only for display)
export const prettyStore = (storeId) => String(storeId ?? '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').trim();

// Store ids become Firebase keys: letters, digits, "-" and "_" only, so rules, paths and URLs stay predictable
export const isValidStoreId = (id) => /^[A-Za-z0-9_-]{1,40}$/.test(String(id ?? ''));
