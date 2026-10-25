import './style.css';
import structure from './structure.json';
import database from './database.json';
import config from './config.json';
import { $, esc, toast, todayStr } from './util.js';
import { startSession } from './session.js';
import { initAccount } from './ui/account.js';
import { initExtraHours } from './ui/extraHours.js';

const PROJECTION = config.projection === true; // the Projection page is switched off while it is being reworked (config.json)
const PREFIX = `${config.storageName}:`; // every localStorage key of this app starts with this
const dayparts = Object.keys(structure);
const list = $('#list');

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
    const m = k.match(new RegExp('^' + PREFIX + '(\\d{4}-\\d{2}-\\d{2}):'));
    if (m && m[1] < cutoff) localStorage.removeItem(k);
  });
}

// A daypart in structure.json holds a reserved "info" key ({ name, timeframe }) next to its areas
const dpInfo = (dp) => ({ name: structure[dp].info?.name ?? dp, timeframe: structure[dp].info?.timeframe ?? '' });
const areaEntries = (dp) => Object.entries(structure[dp]).filter(([k]) => k !== 'info');
// Areas sorted by orderId (stable: ties keep file order)
const areas = () =>
  areaEntries(daypart)
    .map(([id, a]) => ({ id, ...a }))
    .sort((a, b) => a.orderId - b.orderId);
const kid = (a, n) => `${a.id}|${n}`; // n = task name or product slug

// Products (database.json) are referenced by slug from the stock lists in structure.json
const products = database.products;
const bySlug = Object.fromEntries(products.map((p) => [p.slug, p]));
const pname = (slug) => bySlug[slug]?.name || slug; // unknown slugs show the raw slug, so the typo is visible
// Restock step of a product (the Increment column): how much one tap of + / - changes the count. Missing or 0 counts by 1.
const isFill = (slug) => bySlug[slug]?.increment < 0; // negative increment (-1) = "fill" product: no count, a Fill button instead of + / -
const pstep = (slug) => { const n = bySlug[slug]?.increment; return n > 0 ? n : 1; };
// Product code shown small under the name. Empty codes and the sheet's MISSING placeholder both show "MISSING" (in red-grey), so they get filled in
const pcode = (slug) => { const p = bySlug[slug]; return !p ? '' : p.code && p.code !== 'MISSING' ? p.code : 'MISSING'; };
const r2 = (n) => Math.round(n * 100) / 100; // counts can be fractional (0.5 steps): avoid 0.1 + 0.2 style noise
// Categories: [{ id, slug, name, macro, adjustment }], in sheet order. Products and saved overrides refer to a
// category by its slug; the name is only for display. id and macro are not used by the app yet.
const categories = database.categories;
const catBySlug = Object.fromEntries(categories.map((c) => [c.slug, c]));
const catName = (slug) => catBySlug[slug]?.name ?? slug; // unknown slugs show the raw slug
const catDef = (slug) => catBySlug[slug]?.adjustment ?? 100; // default Adj % of the category
// Category order: as listed in database.categories, then others by first appearance; '' = no category
const categoryOrder = () => [...new Set([...categories.map((c) => c.slug), ...products.map((p) => p.category).filter(Boolean), ''])];

// Sanity check of the data files; problems are shown in a red banner
function validate() {
  const bad = [], seen = new Set(), slugs = new Set();
  for (const c of categories) {
    if (!c.slug) bad.push(`Category without slug: ${c.name}`);
    else if (slugs.has(c.slug)) bad.push(`Duplicate category slug: ${c.slug}`);
    slugs.add(c.slug);
  }
  for (const p of products) {
    if (!p.slug) bad.push(`Product without slug: ${p.name}`);
    else if (seen.has(p.slug)) bad.push(`Duplicate product slug: ${p.slug}`);
    seen.add(p.slug);
    if (p.category && !catBySlug[p.category]) bad.push(`${p.slug}: unknown category "${p.category}"`);
  }
  for (const dp of Object.keys(structure)) {
    if (!structure[dp].info?.name) bad.push(`${dp}: missing info.name`);
    for (const [ak, a] of areaEntries(dp))
      for (const slug of a.stock) if (!bySlug[slug]) bad.push(`${dp}/${ak}: unknown product slug "${slug}"`);
  }
  const w = $('#warn');
  w.hidden = !bad.length;
  w.innerHTML = bad.map(esc).join('<br>');
  bad.forEach((b) => console.error(b));
}
const stockOf = (k) => (state.stock[k] ||= { qty: 0, done: false });

function taskRow(a, t) {
  const k = kid(a, t), s = state.tasks[k] || '';
  return `<div class="row task ${s}" data-t="task" data-k="${esc(k)}"><div class="fg">${esc(t)}</div></div>`;
}
const fillLabel = (on) => (on ? '&#10003; Fill' : 'Fill');
function stockRow(a, slug) {
  const k = kid(a, slug), s = state.stock[k] || { qty: 0, done: false }, code = pcode(slug);
  const nm = `<span class="nm">${esc(pname(slug))}${code ? `<small${code === 'MISSING' ? ' class="miss"' : ''}>${esc(code)}</small>` : ''}</span>`;
  const attrs = `data-t="stock" data-k="${esc(k)}" data-slug="${esc(slug)}"`;
  if (isFill(slug)) { // refill product: the amount is just "needs a fill" (1) or not (0)
    return `<div class="row stock fill ${s.done ? 'done' : ''} ${s.qty > 0 ? 'need' : ''}" ${attrs}>
    <div class="mid">${nm}</div>
    <button class="fillbtn" data-a="fill" aria-pressed="${s.qty > 0}">${fillLabel(s.qty > 0)}</button></div>`;
  }
  const step = pstep(slug);
  const lbl = (sign) => `${sign}${step !== 1 ? `<small>${step}</small>` : ''}`; // show the step on the buttons when it is not 1
  return `<div class="row stock ${s.done ? 'done' : ''}" ${attrs}>
    <button data-a="dec" aria-label="Decrease">${lbl('&minus;')}</button>
    <div class="mid"><span class="qty">${s.qty}</span>${nm}</div>
    <button data-a="inc" aria-label="Increase">${lbl('+')}</button></div>`;
}
// Restock dropdown of an area (closed by default; open/closed is kept in memory only). The badge counts the items with an amount above 0.
const openRestock = new Set();
const rsId = (a) => `${daypart}|${a.id}`;
const rsCount = (a) => a.stock.filter((n) => !state.stock[kid(a, n)]?.done && state.stock[kid(a, n)]?.qty > 0).length;
function restockBlock(a, rows, total) {
  const on = openRestock.has(rsId(a)), n = rsCount(a);
  return `<div class="rs ${on ? 'open' : ''}" data-area="${esc(a.id)}">
    <button class="rs-h" data-rs="${esc(rsId(a))}" aria-expanded="${on}"><span>Restock</span>
      <span class="rs-r"><span class="rs-n" ${n ? '' : 'hidden'}>${n}</span><span class="rs-t">${total}</span><span class="chev">&rsaquo;</span></span></button>
    <div class="rs-b"><div class="rs-in">${rows}
      <button class="rs-f" data-rs="${esc(rsId(a))}"><span>Close Restock</span><span class="chev">&rsaquo;</span></button></div></div></div>`;
}

let view = 'dayparts';
const PAGE_TITLES = { projection: 'Projection', extra: 'Extra hours', account: 'Account' }; // pages other than the shift list
function renderHeader() {
  const { name, timeframe } = dpInfo(daypart);
  $('#title').textContent = PAGE_TITLES[view] ?? name;
  $('#subtitle').textContent = view === 'dayparts' ? [timeframe, date].filter(Boolean).join(' · ') : view === 'account' ? '' : date;
}

function render() {
  let open = '', done = '';
  for (const a of areas()) {
    const isTaskDone = (t) => !!state.tasks[kid(a, t)];
    const isStockDone = (n) => !!state.stock[kid(a, n)]?.done;
    const openStock = a.stock.filter((n) => !isStockDone(n));
    const o = a.tasks.filter((t) => !isTaskDone(t)).map((t) => taskRow(a, t)).join('') +
              (openStock.length ? restockBlock(a, openStock.map((n) => stockRow(a, n)).join(''), openStock.length) : '');
    const d = a.tasks.filter(isTaskDone).map((t) => taskRow(a, t)).join('') +
              a.stock.filter(isStockDone).map((n) => stockRow(a, n)).join('');
    if (o) open += `<section><h2>${esc(a.name)}</h2>${o}</section>`;
    if (d) done += `<section><h2>${esc(a.name)}</h2>${d}</section>`;
  }
  list.innerHTML = (open || '<div class="empty">Everything in this daypart is done.</div>') +
    (done ? `<div class="divider">Done</div>${done}` : '');
  renderHeader();
  $('#dayparts').innerHTML = dayparts
    .map((dp) => {
      const { name, timeframe } = dpInfo(dp);
      return `<button class="dp ${dp === daypart ? 'on' : ''}" data-dp="${esc(dp)}"><span>${esc(name)}</span>${timeframe ? `<small>${esc(timeframe)}</small>` : ''}</button>`;
    }).join('');
}

function setTask(k, status) { if (status) state.tasks[k] = status; else delete state.tasks[k]; save(); render(); }
function setStockDone(k, v) { stockOf(k).done = v; save(); render(); }

// Restock dropdown: open/close in place (no re-render). The header opens/closes it; the same row at the bottom closes it
// without scrolling back up (and then brings the header into view).
list.addEventListener('click', (e) => {
  const h = e.target.closest('button[data-rs]');
  if (!h) return;
  const box = h.closest('.rs'), on = box.classList.toggle('open');
  box.querySelector('.rs-h').setAttribute('aria-expanded', on);
  if (on) openRestock.add(h.dataset.rs); else openRestock.delete(h.dataset.rs);
  if (!on && h.classList.contains('rs-f')) box.querySelector('.rs-h').scrollIntoView({ block: 'nearest' });
});

// Stock buttons (update in place, no re-render): +/- change the amount by the product's increment, Fill toggles "needs a fill"
list.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-a]');
  if (!b) return;
  const row = b.closest('.row'), s = stockOf(row.dataset.k);
  if (b.dataset.a === 'fill') {
    s.qty = s.qty > 0 ? 0 : 1;
    row.classList.toggle('need', s.qty > 0);
    b.setAttribute('aria-pressed', s.qty > 0);
    b.innerHTML = fillLabel(s.qty > 0);
  } else {
    const step = pstep(row.dataset.slug);
    s.qty = Math.max(0, r2(s.qty + (b.dataset.a === 'inc' ? step : -step)));
    row.querySelector('.qty').textContent = s.qty;
  }
  save();
  const box = row.closest('.rs'); // refresh the badge of the dropdown (open list only)
  if (box) {
    const a = areas().find((x) => x.id === box.dataset.area), n = rsCount(a), badge = box.querySelector('.rs-n');
    badge.textContent = n; badge.hidden = !n;
  }
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
const toggleMenu = (v) => { document.body.classList.toggle('open', v); if (!v) disarmClear(); };
// Pages: the shift list ('dayparts'), 'projection', 'extra' (extra hours, Firebase) and 'account' (sign in / out)
const PAGES = { dayparts: list, projection: $('#proj'), extra: $('#extra'), account: $('#account') };
function setView(v) {
  if (v === 'extra' && view !== 'extra') extraHours.enter();
  if (v !== 'extra' && view === 'extra') extraHours.leave();
  view = v;
  document.body.dataset.view = v;
  for (const [name, el] of Object.entries(PAGES)) el.hidden = name !== v;
  document.querySelectorAll('.grp').forEach((g) => g.classList.toggle('active', g.dataset.g === v));
  document.querySelector(`.grp[data-g="${v}"]`)?.classList.remove('collapsed');
  renderHeader();
  scrollTo(0, 0);
}
const go = (v) => { setView(v); toggleMenu(false); };
$('#drawer').addEventListener('click', (e) => {
  const h = e.target.closest('.grp-h');
  if (!h || (h.dataset.view === 'projection' && !PROJECTION)) return;
  if (view === h.dataset.view) { h.parentElement.classList.toggle('collapsed'); if (h.parentElement.classList.contains('leaf')) toggleMenu(false); return; }
  setView(h.dataset.view);
  if (h.parentElement.classList.contains('leaf') || view === 'projection') toggleMenu(false); // nothing to pick in these submenus
});
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
  // Sum the same product across areas (e.g. Jug in Box), then group by category
  const tot = new Map();
  for (const a of areas())
    for (const slug of a.stock) {
      const q = state.stock[kid(a, slug)]?.qty;
      if (q > 0) tot.set(slug, r2((tot.get(slug) || 0) + q));
    }
  const out = categoryOrder().map((c) => {
    const rows = [...tot].filter(([slug]) => (bySlug[slug]?.category || '') === c).map(([slug, q]) => isFill(slug) ? `Fill ${pname(slug)}` : `x${q} ${pname(slug)}`);
    return rows.length ? (c ? `${catName(c)}\n` : '') + rows.join('\n') : '';
  }).filter(Boolean);
  out.length ? copy(out.join('\n\n'), 'Restock list copied') : toast('Nothing to restock');
};

// Re-check the day when the app comes back to the foreground
document.addEventListener('visibilitychange', () => {
  if (document.hidden || todayStr() === date) return;
  date = todayStr(); load(); loadProj(); render(); renderProj();
  extraHours.refresh(); // new day: the extra-hours page asks for "from today" again
});

// Projection
const BASE_GC = 1000; // default weights are defined for this guest count
// Only products with a weight appear in the projection
const items = products.filter((p) => p.weight > 0).map((p) => ({ slug: p.slug, name: p.name, cat: p.category || '', def: p.weight, yld: p.yield }));
const WKEY = PREFIX + 'proj-weights'; // edited default weights (persistent)
const gcKey = () => `${PREFIX}${date}:proj`; // guest count (per day, pruned with the rest)
const YKEY = PREFIX + 'proj-yields'; // edited yields (persistent)
let custom = {}, customY = {}, gc = null, gadj = null, cadj = {}; // null = use the default
const BASE_ADJ = 100;
const catVal = (c) => cadj[c] ?? catDef(c); // category Adj %: today's override (keyed by slug), else the database.json default

function loadProj() {
  try { custom = JSON.parse(localStorage.getItem(WKEY)) || {}; } catch { custom = {}; }
  try { customY = JSON.parse(localStorage.getItem(YKEY)) || {}; } catch { customY = {}; }
  try {
    const d = JSON.parse(localStorage.getItem(gcKey()));
    gc = d?.gc ?? null; gadj = d?.gadj ?? null; cadj = d?.cadj || {};
  } catch { gc = null; gadj = null; cadj = {}; }
}
function saveProj() {
  localStorage.setItem(WKEY, JSON.stringify(custom));
  localStorage.setItem(YKEY, JSON.stringify(customY));
  localStorage.setItem(gcKey(), JSON.stringify({ gc, gadj, cadj }));
}
const num = (s) => { const n = parseFloat(String(s).replace(',', '.')); return Number.isFinite(n) && n >= 0 ? n : null; };
const fmt = (n) => String(Math.round(n * 10) / 10);
const trunc1 = (n) => String(Math.floor(n * 10 + 1e-9) / 10); // 2.19999 shows 2.1, matching the rounding rule
// x.1 up to x.19999 rounds down, x.2 and above rounds up
const roundBoxes = (x) => Math.floor(Math.round(x * 1e6) / 1e6 + 0.8 + 1e-9);
function calc(it) {
  const w = custom[it.slug] ?? it.def;
  const target = (w * (gc ?? BASE_GC) * catVal(it.cat) * (gadj ?? BASE_ADJ)) / (BASE_GC * 100 * 100);
  const y = customY[it.slug] ?? it.yld;
  const boxes = y > 0 ? target / y : null;
  return { w, target, boxes, ask: boxes === null ? null : roundBoxes(boxes) };
}
function updateProj() {
  for (const it of items) {
    const row = $(`#pbody .prow[data-slug="${it.slug}"]`);
    if (!row) continue;
    const c = calc(it);
    row.querySelector('.pt').textContent = fmt(c.target);
    row.querySelector('.pb').innerHTML = c.boxes === null ? '&ndash;' : `${trunc1(c.boxes)}<small>&rarr; ${c.ask}</small>`;
  }
}
// Items grouped by category (order from database.json); items without a category go last, without a header
function groups() {
  return categoryOrder().map((slug) => ({ slug, items: items.filter((it) => it.cat === slug) })).filter((g) => g.items.length);
}
function projRow(it) {
  const inp = (f, val, isDef, label) => `<input class="pin ${isDef ? 'def' : ''}" data-f="${f}" inputmode="decimal" autocomplete="off" value="${val}" aria-label="${label} ${esc(it.name)}" />`;
  return `<div class="prow" data-slug="${esc(it.slug)}">
    <div class="pn">${esc(it.name)}</div>
    ${inp('w', custom[it.slug] ?? it.def, custom[it.slug] === undefined, 'Weight')}
    ${inp('y', customY[it.slug] ?? it.yld, customY[it.slug] === undefined, 'Yield')}
    <div class="pt"></div><div class="pb"></div></div>`;
}
const catHead = (c) => `<div class="pcat"><span>${esc(catName(c))}</span><label>Adj %<input class="pin ${cadj[c] === undefined ? 'def' : ''}" data-cat="${esc(c)}" inputmode="decimal" autocomplete="off" value="${catVal(c)}" aria-label="Adjustment ${esc(catName(c))}" /></label></div>`;
function renderProj() {
  const g = $('#gcInput'), ga = $('#gAdjInput');
  g.value = gc ?? BASE_GC;
  g.classList.toggle('def', gc === null);
  ga.value = gadj ?? BASE_ADJ;
  ga.classList.toggle('def', gadj === null);
  $('#pbody').innerHTML = groups()
    .map((c) => (c.slug ? catHead(c.slug) : '') + c.items.map(projRow).join('')).join('');
  updateProj();
}
// Editable columns: w = weight, y = yield
const FIELDS = {
  w: { store: () => custom, def: (it) => it.def },
  y: { store: () => customY, def: (it) => it.yld },
};
const proj = $('#proj');
proj.addEventListener('focusin', (e) => { if (e.target.matches('input')) e.target.select(); });
proj.addEventListener('input', (e) => {
  const inp = e.target, v = num(inp.value);
  if (inp.id === 'gcInput') {
    gc = v === null || v === BASE_GC ? null : v;
    inp.classList.toggle('def', gc === null);
  } else if (inp.id === 'gAdjInput') {
    gadj = v === null || v === BASE_ADJ ? null : v;
    inp.classList.toggle('def', gadj === null);
  } else if (inp.dataset.cat !== undefined) {
    const c = inp.dataset.cat;
    if (v === null || v === catDef(c)) delete cadj[c]; else cadj[c] = v;
    inp.classList.toggle('def', cadj[c] === undefined);
  } else {
    const it = items.find((i) => i.slug === inp.closest('.prow').dataset.slug);
    const F = FIELDS[inp.dataset.f], store = F.store(), def = F.def(it);
    if (v === null || v === def) delete store[it.slug]; else store[it.slug] = v;
    inp.classList.toggle('def', store[it.slug] === undefined);
  }
  saveProj(); updateProj();
});
// Empty or invalid input falls back to the default, so show it again when leaving the field
proj.addEventListener('focusout', (e) => {
  const inp = e.target;
  if (!inp.matches('input')) return;
  if (inp.id === 'gcInput') inp.value = gc ?? BASE_GC;
  else if (inp.id === 'gAdjInput') inp.value = gadj ?? BASE_ADJ;
  else if (inp.dataset.cat !== undefined) inp.value = catVal(inp.dataset.cat);
  else {
    const it = items.find((i) => i.slug === inp.closest('.prow').dataset.slug);
    const F = FIELDS[inp.dataset.f];
    inp.value = F.store()[it.slug] ?? F.def(it);
  }
});
// One tap exports every category: header with the guest count (and Adj % when not 100), then each category
function exportProj() {
  const out = groups().map((c) => {
    const lines = c.items.map((it) => ({ it, c: calc(it) })).filter((x) => x.c.ask > 0).map((x) => `x${x.c.ask} ${x.it.name}`);
    if (!lines.length) return '';
    const a = c.slug ? catVal(c.slug) : BASE_ADJ;
    return (c.slug ? `${catName(c.slug)}${a !== BASE_ADJ ? ` (Adj ${fmt(a)}%)` : ''}\n` : '') + lines.join('\n');
  }).filter(Boolean);
  const head = `Projection - ${fmt(gc ?? BASE_GC)} GC${gadj !== null ? ` (Adj ${fmt(gadj)}%)` : ''}`;
  out.length ? copy(`${head}\n\n${out.join('\n\n')}`, 'Projection copied') : toast('Nothing to prepare');
}
$('#expProj').onclick = exportProj;
$('#projCopy').onclick = exportProj;

// Clear website data (two taps to confirm). Only removes this app's own keys, since
// localStorage is shared by every project hosted on the same github.io origin.
const clearBtn = $('#clearData');
let clearTimer;
function disarmClear() {
  clearTimeout(clearTimer);
  clearBtn.classList.remove('armed');
  clearBtn.textContent = 'Clear website data';
}
clearBtn.onclick = () => {
  if (!clearBtn.classList.contains('armed')) {
    clearBtn.classList.add('armed');
    clearBtn.textContent = 'Tap again to confirm';
    clearTimer = setTimeout(disarmClear, 4000);
    return;
  }
  disarmClear();
  wipeAppData();
  localStorage.setItem(VKEY, DATA_VERSION);
  daypart = dayparts[0];
  load(); loadProj(); render(); renderProj();
  toggleMenu(false);
  toast('Website data cleared');
};

// Versions (set in config.json). siteVersion: bump only when major content is introduced or changed (shown in
// the menu). dataVersion: bump only on large updates that change the shape of the saved data; if the data saved
// in the browser has a lower dataVersion (or none), all of this app's saved data is wiped.
const SITE_VERSION = config.siteVersion;
const DATA_VERSION = config.dataVersion;
const VKEY = PREFIX + 'dataVersion';
const vcmp = (a, b) => {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; }
  return 0;
};
const wipeAppData = () => Object.keys(localStorage).filter((k) => k.startsWith(PREFIX)).forEach((k) => localStorage.removeItem(k));
function checkVersion() {
  const saved = localStorage.getItem(VKEY);
  if (!saved || !/^\d+(\.\d+)*$/.test(saved) || vcmp(saved, DATA_VERSION) < 0) {
    wipeAppData();
    localStorage.setItem(VKEY, DATA_VERSION);
  }
  $('#ver').textContent = `v${SITE_VERSION}`;
}

$('.grp[data-g="projection"]').hidden = !PROJECTION; // projection code stays, the page is only hidden
checkVersion();
validate();
prune();
load();
loadProj();
render();
renderProj();
// Firebase features: login (account page + top-bar avatar) and the extra-hours page. They only start working
// once startSession() has checked the saved login; the shift tracker itself never needs them.
const account = initAccount({ go, prefix: PREFIX, getView: () => view });
const extraHours = initExtraHours({ openLogin: account.openLogin });
setView('dayparts');
startSession();
