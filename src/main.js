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

// Names: every displayed name is a translation of a slug, from the Dictionary (database.dictionary), in config.language.
// A slug with no translation yet shows the raw slug, so it is easy to spot.
const translations = Object.fromEntries(database.dictionary.map((e) => [e.slug, e.translations]));
const tr = (slug) => translations[slug]?.[config.language] || slug;

// Products (database.json) are referenced by slug from the stock lists in structure.json
const products = database.products;
const bySlug = Object.fromEntries(products.map((p) => [p.slug, p]));
const pname = tr;
// Restock step of a product (the Unit column): how much one tap of + / - changes the count. Missing or 0 counts by 1.
const isFill = (slug) => bySlug[slug]?.unit < 0; // negative unit (-1) = "fill" product: no count, a Fill button instead of + / -
const pstep = (slug) => { const n = bySlug[slug]?.unit; return n > 0 ? n : 1; };
// Product code shown small under the name: "<id>/<extension>". Without an id it shows "MISSING" (in red-grey), so it gets filled in
const pcode = (slug) => { const p = bySlug[slug]; return !p ? '' : p.id ? (p.extension ? `${p.id}/${p.extension}` : p.id) : 'MISSING'; };
const r2 = (n) => Math.round(n * 100) / 100; // counts can be fractional (0.5 steps): avoid 0.1 + 0.2 style noise
// Categories: [{ slug, id }], sorted by id (the priority). Products and saved overrides refer to a category by its slug;
// the display name is its translation. id is not used by the app yet.
const categories = [...database.categories].sort((a, b) => a.id - b.id); // id = priority: grouped and listed in this order
const catBySlug = Object.fromEntries(categories.map((c) => [c.slug, c]));
const catName = tr; // unknown slugs show the raw slug
const catDef = () => 100; // default Adj % of every category (the sheet no longer has an adjustment)
// Category order: as listed in database.categories, then others by first appearance; '' = no category
const categoryOrder = () => [...new Set([...categories.map((c) => c.slug), ...products.map((p) => p.category).filter(Boolean), ''])];

// Sanity check of the data files; problems are shown in a red banner
function validate() {
  const bad = [], seen = new Set(), slugs = new Set();
  for (const c of categories) {
    if (!c.slug) bad.push(`Category without slug: id ${c.id}`);
    else if (slugs.has(c.slug)) bad.push(`Duplicate category slug: ${c.slug}`);
    slugs.add(c.slug);
  }
  for (const p of products) {
    if (!p.slug) bad.push(`Product without slug: id ${p.id}`);
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
const PAGE_TITLES = { projection: 'Projection', extra: 'Extra hours', account: 'Account', restock: 'Restock' }; // pages other than the shift list
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

function renderRestock() {
  // Collect all stock items with qty > 0 and not done for current daypart
  const items = [];
  for (const a of areas()) {
    for (const slug of a.stock) {
      const k = kid(a, slug);
      const s = state.stock[k];
      if (s && s.qty > 0 && !s.done) {
        const p = bySlug[slug];
        const catSlug = p?.category || '';
        const catOrder = categories.findIndex((c) => c.slug === catSlug);
        items.push({
          area: a,
          slug,
          k,
          name: pname(slug),
          code: pcode(slug),
          qty: s.qty,
          isFill: isFill(slug),
          step: pstep(slug),
          catSlug,
          catOrder: catOrder === -1 ? 999 : catOrder,
        });
      }
    }
  }

  if (items.length === 0) {
    $('#restock').innerHTML = `
      <div class="restock-header">
        <h2>Restock</h2>
        <div class="restock-controls">
          <select id="restockView" class="restock-select" disabled>
            <option value="area">Usage Area</option>
            <option value="storage">Storage Area</option>
            <option value="delegation">Delegation</option>
            <option value="category">Category</option>
            <option value="front">Front Only</option>
            <option value="kitchen">Kitchen Only</option>
            <option value="mccafe">McCafé Only</option>
            <option value="prep">Prep Only</option>
          </select>
        </div>
        <div class="restock-actions">
          <button id="restockExport" class="menu-btn" disabled>Export</button>
        </div>
      </div>
      <div class="restock-empty">No items to restock in this daypart.</div>
    `;
    return;
  }

  // Get current view mode (persisted)
  const viewMode = localStorage.getItem(PREFIX + 'restockView') || 'area';

  // Build groups based on mode
  const groups = buildRestockGroups(items, viewMode);

  // Build HTML
  let html = `
    <div class="restock-header">
      <h2>Restock</h2>
      <div class="restock-controls">
        <select id="restockView" class="restock-select">
          <option value="area" ${viewMode === 'area' ? 'selected' : ''}>Usage Area</option>
          <option value="storage" ${viewMode === 'storage' ? 'selected' : ''}>Storage Area</option>
          <option value="delegation" ${viewMode === 'delegation' ? 'selected' : ''}>Delegation</option>
          <option value="category" ${viewMode === 'category' ? 'selected' : ''}>Category</option>
          <optgroup label="— Area Filters —">
            <option value="front" ${viewMode === 'front' ? 'selected' : ''}>Front Only</option>
            <option value="kitchen" ${viewMode === 'kitchen' ? 'selected' : ''}>Kitchen Only</option>
            <option value="mccafe" ${viewMode === 'mccafe' ? 'selected' : ''}>McCafé Only</option>
            <option value="prep" ${viewMode === 'prep' ? 'selected' : ''}>Prep Only</option>
          </optgroup>
        </select>
      </div>
      <div class="restock-actions">
        <button id="restockExport" class="menu-btn">Export</button>
      </div>
    </div>
    <div class="restock-table-wrapper">
  `;

  for (const group of groups) {
    html += `
      <div class="restock-group" data-group="${esc(group.id)}">
        <div class="restock-group-header">
          <h3>${esc(group.label)} <span class="restock-count">${group.items.length}</span></h3>
          <button class="restock-clear-btn" data-group="${esc(group.id)}" title="Mark all in this group as done">Clear</button>
        </div>
        <table class="restock-table">
          <thead><tr><th>Item</th><th>Qty</th><th>Actions</th></tr></thead>
          <tbody>
    `;
    for (const item of group.items) {
      const qtyDisplay = item.isFill ? 'Fill' : `x${item.qty}`;
      html += `
        <tr data-k="${esc(item.k)}" data-slug="${esc(item.slug)}">
          <td class="restock-name">${esc(item.name)}${item.code ? `<small${item.code === 'MISSING' ? ' class="miss"' : ''}>${esc(item.code)}</small>` : ''}</td>
          <td class="restock-qty">${esc(qtyDisplay)}</td>
          <td class="restock-actions">
            <button class="restock-done-btn" data-action="done" title="Mark Done">✓</button>
          </td>
        </tr>
      `;
    }
    html += '</tbody></table></div>';
  }
  html += '</div>'; // close wrapper

  $('#restock').innerHTML = html;
}

// Build groups based on grouping mode
function buildRestockGroups(items, mode) {
  // Delegation mapping: area.id -> delegation group
  const delegationMap = {
    'mccafe': 'mccafe',
    'beverages': 'front', 'drive': 'front', 'front': 'front', 'floor': 'front', 'management': 'front',
    'fries': 'kitchen', 'grill': 'kitchen', 'cart': 'kitchen', 'side-4': 'kitchen',
    'side-1': 'prep', 'side-2': 'prep', 'side-3': 'prep', 'rear': 'prep', 'walk-in': 'prep', 'storeroom': 'prep', 'dishwashing': 'prep',
  };
  const delegationLabels = {
    'mccafe': 'McCafé',
    'front': 'Front',
    'kitchen': 'Kitchen',
    'prep': 'Prep',
  };
  const delegationOrder = ['mccafe', 'front', 'kitchen', 'prep'];

  // Filter modes - filter items first, then group by delegation
  const filterModes = ['front', 'kitchen', 'mccafe', 'prep'];
  const isFilterMode = filterModes.includes(mode);

  // Filter items if in filter mode
  let filteredItems = items;
  if (isFilterMode) {
    filteredItems = items.filter(item => delegationMap[item.area.id] === mode);
  }

  // Determine grouping mode for filtered items
  const groupMode = isFilterMode ? 'delegation' : mode;

  // Group items
  const groupMap = new Map();

  for (const item of filteredItems) {
    let groupId, groupLabel, groupOrder;

    switch (groupMode) {
      case 'storage': {
        // Group by product category (storage area)
        groupId = item.catSlug || 'uncategorized';
        groupLabel = catName(groupId);
        groupOrder = item.catOrder;
        break;
      }
      case 'delegation': {
        // Group by delegation area
        groupId = delegationMap[item.area.id] || 'other';
        groupLabel = delegationLabels[groupId] || groupId;
        groupOrder = delegationOrder.indexOf(groupId);
        if (groupOrder === -1) groupOrder = 999;
        break;
      }
      case 'category': {
        // Group by category priority (same as storage but sorted by priority)
        groupId = item.catSlug || 'uncategorized';
        groupLabel = catName(groupId);
        groupOrder = item.catOrder;
        break;
      }
      case 'area':
      default: {
        // Group by usage area (current behavior)
        groupId = item.area.id;
        groupLabel = item.area.name;
        groupOrder = item.area.orderId;
        break;
      }
    }

    if (!groupMap.has(groupId)) {
      groupMap.set(groupId, { id: groupId, label: groupLabel, order: groupOrder, items: [] });
    }
    groupMap.get(groupId).items.push(item);
  }

  // Sort items within each group by category priority
  for (const group of groupMap.values()) {
    group.items.sort((a, b) => a.catOrder - b.catOrder);
  }

  // Convert to array and sort groups by their order
  return [...groupMap.values()].sort((a, b) => a.order - b.order);
}

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

// Restock page event handlers (event delegation on #restock)
$('#restock').addEventListener('click', (e) => {
  // View selector change
  const viewSelect = e.target.closest('#restockView');
  if (viewSelect) {
    localStorage.setItem(PREFIX + 'restockView', viewSelect.value);
    renderRestock();
    return;
  }

  // Clear group button
  const clearBtn = e.target.closest('.restock-clear-btn');
  if (clearBtn) {
    const groupId = clearBtn.dataset.group;
    const viewMode = localStorage.getItem(PREFIX + 'restockView') || 'area';

    // Find all items in this group and mark as done
    for (const a of areas()) {
      for (const slug of a.stock) {
        const k = kid(a, slug);
        const s = state.stock[k];
        if (s && s.qty > 0 && !s.done) {
          const p = bySlug[slug];
          const catSlug = p?.category || '';
          let itemGroupId;

          const delegationMap = {
            'mccafe': 'mccafe',
            'beverages': 'front', 'drive': 'front', 'front': 'front', 'floor': 'front', 'management': 'front',
            'fries': 'kitchen', 'grill': 'kitchen', 'cart': 'kitchen', 'side-4': 'kitchen',
            'side-1': 'prep', 'side-2': 'prep', 'side-3': 'prep', 'rear': 'prep', 'walk-in': 'prep', 'storeroom': 'prep', 'dishwashing': 'prep',
          };

          switch (viewMode) {
            case 'storage':
            case 'category':
              itemGroupId = catSlug || 'uncategorized';
              break;
            case 'delegation':
            case 'front':
            case 'kitchen':
            case 'mccafe':
            case 'prep':
              itemGroupId = delegationMap[a.id] || 'other';
              break;
            case 'area':
            default:
              itemGroupId = a.id;
          }

          if (itemGroupId === groupId) {
            s.done = true;
          }
        }
      }
    }
    save();
    renderRestock();
    render(); // update dropdown badges
    toast('Group marked done');
    return;
  }

  const doneBtn = e.target.closest('.restock-done-btn');
  if (doneBtn) {
    const row = doneBtn.closest('tr');
    const k = row.dataset.k;
    const s = state.stock[k];
    if (!s) return;

    s.done = true;
    save();
    renderRestock();
    render(); // update dropdown badges
    toast('Marked done');
    return;
  }
});

// Export Modal handlers
const exportModal = $('#restockExportModal');
const exportModalText = $('#exportModalText');

function openExportModal() {
  const viewMode = localStorage.getItem(PREFIX + 'restockView') || 'area';
  const items = [];
  for (const a of areas()) {
    for (const slug of a.stock) {
      const k = kid(a, slug);
      const s = state.stock[k];
      if (s && s.qty > 0 && !s.done) {
        items.push({ area: a, slug, k, s });
      }
    }
  }
  if (items.length === 0) return;

  const groups = buildRestockGroups(items, viewMode);
  const out = groups.map(group => {
    const rows = group.items.map(item =>
      isFill(item.slug) ? `Fill ${pname(item.slug)}` : `x${item.s.qty} ${pname(item.slug)}`
    );
    return rows.length ? `${group.label}\n${rows.join('\n')}` : '';
  }).filter(Boolean);

  const text = out.join('\n\n');
  exportModalText.textContent = text;
  exportModal.hidden = false;
  setTimeout(() => $('#exportModalClose').focus(), 0);
}

function closeExportModal() {
  exportModal.hidden = true;
  exportModalText.textContent = '';
}

// Export button in restock header
$('#restock').addEventListener('click', (e) => {
  const exportBtn = e.target.closest('#restockExport');
  if (exportBtn) {
    openExportModal();
    return;
  }
});

// Modal event handlers (on document for overlay clicks)
document.addEventListener('click', (e) => {
  if (e.target.closest('#exportModalCopy')) {
    const text = exportModalText.textContent;
    if (text) copy(text, 'Export copied');
    return;
  }
  if (e.target.closest('#exportModalClose') || e.target.closest('.modal-close') || e.target.closest('.modal-overlay')) {
    closeExportModal();
    return;
  }
});

// ESC key to close modal
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !exportModal.hidden) {
    closeExportModal();
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
const PAGES = { dayparts: list, projection: $('#proj'), extra: $('#extra'), account: $('#account'), restock: $('#restock') };
function setView(v) {
  if (v === 'extra' && view !== 'extra') extraHours.enter();
  if (v !== 'extra' && view === 'extra') extraHours.leave();
  if (v === 'restock') renderRestock();
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

// Re-check the day when the app comes back to the foreground
document.addEventListener('visibilitychange', () => {
  if (document.hidden || todayStr() === date) return;
  date = todayStr(); load(); loadProj(); render(); renderProj();
  extraHours.refresh(); // new day: the extra-hours page asks for "from today" again
});

// Projection
const BASE_GC = 1000; // default weights are defined for this guest count
// Only products with a weight appear in the projection
const items = products.filter((p) => p.weight > 0).map((p) => ({ slug: p.slug, name: pname(p.slug), cat: p.category || '', def: p.weight, yld: p.yield }));
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
