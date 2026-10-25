// Small shared helpers (DOM shortcuts, escaping, local dates, toast). No app state in here.
export const $ = (s) => document.querySelector(s);

// Escapes a value before it goes into innerHTML / an attribute
export const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const pad = (n) => String(n).padStart(2, '0');
// Local date as YYYY-MM-DD (the format used for every "day" in the app and in Firebase)
export const dateStr = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayStr = () => dateStr(new Date());

export function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 1800);
}
