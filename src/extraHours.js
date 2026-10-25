// Extra-hours requests: pure rules and helpers (no DOM, no Firebase), testable in plain Node.
// Data lives at stores/<storeId>/extraHoursRequests/<pushId> (see database.rules.json):
//   { day: "2026-10-25", name, originalHours, nextHours, status, createdAt, createdBy, updatedAt? }
// Hours are free text on purpose, so split shifts ("10-14 / 18-22") fit.
export const COLLECTION = 'extraHoursRequests';

export const STATUSES = ['pending', 'accepted', 'refused', 'revoked'];
export const STATUS_LABEL = { pending: 'Pending', accepted: 'Accepted', refused: 'Refused', revoked: 'Revoked' };

// Buttons shown for each status: [target status, button label, style]
export const TRANSITIONS = {
  pending: [['accepted', 'Accept', 'ok'], ['refused', 'Refuse', 'no']],
  accepted: [['revoked', 'Revoke', 'no']],
  refused: [['accepted', 'Accept', 'ok']],
  revoked: [['accepted', 'Accept', 'ok']],
};

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX = 80; // same limit as database.rules.json

// Trims and checks the add form. Returns { ok, value } or { ok: false, error }.
export function validateRequest(input, today) {
  const v = {
    day: String(input.day ?? '').trim(),
    name: String(input.name ?? '').trim(),
    originalHours: String(input.originalHours ?? '').trim(),
    nextHours: String(input.nextHours ?? '').trim(),
  };
  if (!DAY_RE.test(v.day)) return { ok: false, error: 'Pick a day' };
  if (today && v.day < today) return { ok: false, error: 'That day is in the past' };
  if (!v.name) return { ok: false, error: 'Enter the name' };
  if (!v.nextHours) return { ok: false, error: 'Enter the new hours' };
  for (const k of ['name', 'originalHours', 'nextHours']) if (v[k].length > MAX) return { ok: false, error: `Max ${MAX} characters` };
  return { ok: true, value: v };
}

// What gets written for a new request
export const newRequest = (value, uid, now = Date.now()) => ({ ...value, status: 'pending', createdAt: now, createdBy: uid });

// Only today and later, oldest day first; inside a day, oldest request first (stable, then by name)
export function upcoming(items, today) {
  return items
    .filter((r) => typeof r.day === 'string' && r.day >= today)
    .sort((a, b) => a.day.localeCompare(b.day) || (a.createdAt ?? 0) - (b.createdAt ?? 0) || String(a.name).localeCompare(String(b.name)));
}

// [{ day, items }] in day order (input must already be sorted, see upcoming())
export function groupByDay(items) {
  const groups = [];
  for (const r of items) {
    const last = groups[groups.length - 1];
    if (last && last.day === r.day) last.items.push(r);
    else groups.push({ day: r.day, items: [r] });
  }
  return groups;
}

// "2026-10-25" -> "Sun 25 Oct 2026" (+ "Today" / "Tomorrow" labels). Parsed as local noon so DST never shifts the day.
export function dayLabel(day, today) {
  const [y, m, d] = day.split('-').map(Number);
  const text = new Date(y, m - 1, d, 12).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).replace(/,/g, '');
  const diff = Math.round((new Date(y, m - 1, d, 12) - new Date(...today.split('-').map((n, i) => (i === 1 ? n - 1 : Number(n))), 12)) / 864e5);
  return diff === 0 ? `Today · ${text}` : diff === 1 ? `Tomorrow · ${text}` : text;
}
