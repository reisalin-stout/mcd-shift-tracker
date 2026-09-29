import './style.css';
import structure from './structure.json';

const PREFIX = 'shift:';
const dayparts = Object.keys(structure);
const $ = (s) => document.querySelector(s);
const list = $('#list');

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const label = (dp) => dp.replace('-', ' ').replace(/^./, (c) => c.toUpperCase());

let date = todayStr();
let daypart = localStorage.getItem(PREFIX + 'daypart');
if (!dayparts.includes(daypart)) daypart = dayparts[0];
let state;

const storageKey = () => `${PREFIX}${date}:${daypart}`;
function load() {
  try { state = JSON.parse(localStorage.getItem(storageKey())); } catch { state = null; }
  state ||= { tasks: {}, stock: {} };
}
const save = () => localStorage.setItem(storageKey(), JSON.stringify(state));

// Remove data older than 7 days
function prune() {
  const d = new Date(); d.setDate(d.getDate() - 7);
  const cutoff = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  Object.keys(localStorage).forEach((k) => {
    const m = k.match(/^shift:(\d{4}-\d{2}-\d{2}):/);
    if (m && m[1] < cutoff) localStorage.removeItem(k);
  });
}

// Areas sorted by orderId (stable: ties keep file order)
const areas = () =>
  Object.entries(structure[daypart])
    .map(([id, a]) => ({ id, ...a }))
    .sort((a, b) => a.orderId - b.orderId);
const kid = (a, n) => `${a.id}|${n}`;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const stockOf = (k) => (state.stock[k] ||= { qty: 0, done: false });

function taskRow(a, t) {
  const k = kid(a, t), s = state.tasks[k] || '';
  return `<div class="row task ${s}" data-t="task" data-k="${esc(k)}"><div class="fg">${esc(t)}</div></div>`;
}
function stockRow(a, n) {
  const k = kid(a, n), s = state.stock[k] || { qty: 0, done: false };
  return `<div class="row stock ${s.done ? 'done' : ''}" data-t="stock" data-k="${esc(k)}">
    <button data-a="dec" aria-label="Decrease">&minus;</button>
    <div class="mid"><span class="qty">${s.qty}</span><span>${esc(n)}</span></div>
    <button data-a="inc" aria-label="Increase">+</button></div>`;
}

function render() {
  let open = '', done = '';
  for (const a of areas()) {
    const isTaskDone = (t) => !!state.tasks[kid(a, t)];
    const isStockDone = (n) => !!state.stock[kid(a, n)]?.done;
    const o = a.tasks.filter((t) => !isTaskDone(t)).map((t) => taskRow(a, t)).join('') +
              a.stock.filter((n) => !isStockDone(n)).map((n) => stockRow(a, n)).join('');
    const d = a.tasks.filter(isTaskDone).map((t) => taskRow(a, t)).join('') +
              a.stock.filter(isStockDone).map((n) => stockRow(a, n)).join('');
    if (o) open += `<section><h2>${esc(a.name)}</h2>${o}</section>`;
    if (d) done += `<section><h2>${esc(a.name)}</h2>${d}</section>`;
  }
  list.innerHTML = (open || '<div class="empty">Everything in this daypart is done.</div>') +
    (done ? `<div class="divider">Done</div>${done}` : '');
  $('#title').textContent = label(daypart);
  $('#subtitle').textContent = date;
  $('#dayparts').innerHTML = dayparts
    .map((dp) => `<button class="dp ${dp === daypart ? 'on' : ''}" data-dp="${dp}">${label(dp)}</button>`).join('');
}

function setTask(k, status) { if (status) state.tasks[k] = status; else delete state.tasks[k]; save(); render(); }
function setStockDone(k, v) { stockOf(k).done = v; save(); render(); }

// Stock +/- buttons (update in place, no re-render)
list.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-a]');
  if (!b) return;
  const row = b.closest('.row'), s = stockOf(row.dataset.k);
  s.qty = Math.max(0, s.qty + (b.dataset.a === 'inc' ? 1 : -1));
  save();
  row.querySelector('.qty').textContent = s.qty;
});

// Gestures: swipe tasks, long-press stock, tap done rows to restore
let g = null;
list.addEventListener('contextmenu', (e) => e.preventDefault());
list.addEventListener('pointerdown', (e) => {
  if (e.target.closest('button')) return;
  const row = e.target.closest('.row');
  if (!row) return;
  g = { row, x: e.clientX, y: e.clientY, dx: 0, moved: false, swiping: false,
        k: row.dataset.k, type: row.dataset.t, done: row.classList.contains('done') || row.classList.contains('resolved') };
  if (g.type === 'stock' && !g.done) {
    g.timer = setTimeout(() => {
      const k = g.k; g = null;
      navigator.vibrate?.(30);
      setStockDone(k, true);
    }, 500);
  }
});
list.addEventListener('pointermove', (e) => {
  if (!g) return;
  const dx = e.clientX - g.x, dy = e.clientY - g.y;
  if (!g.moved && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
    g.moved = true;
    clearTimeout(g.timer);
    g.swiping = g.type === 'task' && !g.done && Math.abs(dx) > Math.abs(dy);
  }
  if (g.swiping) {
    g.dx = dx;
    g.row.style.setProperty('--hint', dx > 0 ? 'var(--green)' : 'var(--red)');
    g.row.firstElementChild.style.transform = `translateX(${dx}px)`;
  }
});
function endGesture(e) {
  if (!g) return;
  clearTimeout(g.timer);
  const { row, dx, k, type, done, moved, swiping } = g;
  g = null;
  if (swiping) row.firstElementChild.style.transform = '';
  if (e.type === 'pointercancel') return;
  if (swiping && Math.abs(dx) > 90) setTask(k, dx > 0 ? 'done' : 'resolved'); // right = completed, left = resolved
  else if (!moved && done) type === 'task' ? setTask(k, null) : setStockDone(k, false);
}
list.addEventListener('pointerup', endGesture);
list.addEventListener('pointercancel', endGesture);

// Menu
const toggleMenu = (v) => document.body.classList.toggle('open', v);
$('#menuBtn').onclick = () => toggleMenu(true);
$('#overlay').onclick = () => toggleMenu(false);
$('#dayparts').addEventListener('click', (e) => {
  const b = e.target.closest('[data-dp]');
  if (!b) return;
  daypart = b.dataset.dp;
  localStorage.setItem(PREFIX + 'daypart', daypart);
  load(); render(); toggleMenu(false);
  scrollTo(0, 0);
});

// Export
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 1800);
}
async function copy(text, msg) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const t = document.createElement('textarea');
    t.value = text; document.body.append(t); t.select(); document.execCommand('copy'); t.remove();
  }
  toast(msg); toggleMenu(false);
}
$('#expTasks').onclick = () => {
  const out = areas().map((a) => {
    const open = a.tasks.filter((t) => !state.tasks[kid(a, t)]);
    return open.length ? `${a.name}\n${open.map((t) => `- ${t}`).join('\n')}` : '';
  }).filter(Boolean);
  out.length ? copy(out.join('\n\n'), 'Open tasks copied') : toast('No open tasks');
};
$('#expStock').onclick = () => {
  const out = areas().map((a) => {
    const rows = a.stock.filter((n) => state.stock[kid(a, n)]?.qty > 0).map((n) => `x${state.stock[kid(a, n)].qty} ${n}`);
    return rows.length ? `${a.name}\n${rows.join('\n')}` : '';
  }).filter(Boolean);
  out.length ? copy(out.join('\n\n'), 'Restock list copied') : toast('Nothing to restock');
};

// Re-check the day when the app comes back to the foreground
document.addEventListener('visibilitychange', () => {
  if (document.hidden || todayStr() === date) return;
  date = todayStr(); load(); render();
});

prune();
load();
render();
