// Extra-hours page: add a request, see the upcoming ones split by day, change their status.
// Only today and later is ever read from the database (query on "day"), so the page stays short and current.
import { $, esc, toast, todayStr } from '../util.js';
import { session, onSession, friendlyError, missingConfig } from '../session.js';
import { watchList, push, update, remove } from '../storeDb.js';
import { prettyStore } from '../names.js';
import { COLLECTION, STATUS_LABEL, TRANSITIONS, validateRequest, newRequest, upcoming, groupByDay, dayLabel } from '../extraHours.js';

export function initExtraHours({ openLogin }) {
  const root = $('#extra');
  let items = [], loaded = false, loadError = '';
  let unsub = null, subDay = '', subStore = '';
  let active = false; // page is on screen
  let formOpen = false, lastDay = '';
  const busy = new Set(); // request ids with a write in flight
  const armed = new Map(); // request id -> timer, for the two-tap delete

  // ---------- subscription ----------
  function stop() { unsub?.(); unsub = null; subDay = subStore = ''; }
  function sync() { // (re)subscribe when the page is shown, the login changes or the day rolls over
    const ready = active && session.status === 'in';
    if (!ready) { stop(); return; }
    const today = todayStr();
    if (unsub && subDay === today && subStore === session.storeId) return;
    stop();
    items = []; loaded = false; loadError = '';
    subDay = today; subStore = session.storeId;
    unsub = watchList(COLLECTION, { orderBy: 'day', startAt: today },
      (list) => { items = list; loaded = true; loadError = ''; render(); },
      (e) => { loaded = true; loadError = friendlyError(e); render(); });
  }

  // ---------- rendering ----------
  const stateCard = (title, body, button) => `<div class="acct-card"><h2>${title}</h2><p class="hint">${body}</p>${button ?? ''}</div>`;
  function formHtml() {
    const today = todayStr();
    return `<div class="xh-bar"><button class="primary" data-xh="toggle" aria-expanded="${formOpen}">${formOpen ? 'Close' : '+ Add request'}</button></div>
    <form class="xh-form" id="xhForm" autocomplete="off" novalidate ${formOpen ? '' : 'hidden'}>
      <label for="xhDay">Day</label>
      <input id="xhDay" type="date" min="${today}" value="${esc(lastDay >= today ? lastDay : today)}" />
      <label for="xhName">Name</label>
      <input id="xhName" type="text" maxlength="80" autocomplete="off" autocapitalize="words" enterkeyhint="next" />
      <div class="xh-two">
        <div><label for="xhOrig">Original hours</label><input id="xhOrig" type="text" maxlength="80" placeholder="e.g. 10-14" enterkeyhint="next" /></div>
        <div><label for="xhNext">New hours</label><input id="xhNext" type="text" maxlength="80" placeholder="e.g. 10-14 / 18-22" enterkeyhint="done" /></div>
      </div>
      <div class="form-err" id="xhErr" role="alert" hidden></div>
      <button class="primary" id="xhAdd" type="submit">Add request</button>
    </form>`;
  }
  function rowHtml(r) {
    const st = STATUS_LABEL[r.status] ? r.status : 'pending';
    const b = busy.has(r.id) ? 'disabled' : '';
    const acts = (TRANSITIONS[st] || []).map(([to, label, cls]) => `<button class="xh-btn ${cls}" data-xh="status" data-to="${to}" ${b}>${label}</button>`).join('');
    return `<div class="xh-row s-${st}" data-id="${esc(r.id)}">
      <div class="xh-top"><div class="xh-name">${esc(r.name)}</div><span class="xh-status s-${st}">${esc(STATUS_LABEL[st])}</span></div>
      <div class="xh-hours"><span class="xh-orig ${r.originalHours ? '' : 'none'}">${r.originalHours ? esc(r.originalHours) : '&mdash;'}</span><span class="xh-arrow">&rarr;</span><b>${esc(r.nextHours)}</b></div>
      <div class="xh-actions">${acts}<button class="xh-btn del ${armed.has(r.id) ? 'armed' : ''}" data-xh="delete" aria-label="Delete request" ${b}>${armed.has(r.id) ? 'Delete?' : '&times;'}</button></div></div>`;
  }
  function listHtml() {
    if (!loaded) return '<div class="empty">Loading&hellip;</div>';
    if (loadError) return `<div class="form-err">${esc(loadError)}</div>`;
    const today = todayStr();
    const rows = upcoming(items, today); // also drops days that passed while the page was open
    if (!rows.length) return '<div class="empty">No requests from today onwards.</div>';
    return groupByDay(rows).map((g) => `<section><h2><span>${esc(dayLabel(g.day, today))}</span><span class="xh-count">${g.items.length}</span></h2>${g.items.map(rowHtml).join('')}</section>`).join('');
  }

  let shell = ''; // the form is only rebuilt when the login state changes, so half-typed text survives list updates
  function render() {
    if (!active) return;
    const s = session;
    const state = s.status + '|' + s.storeId;
    if (s.status !== 'in') {
      shell = state;
      root.innerHTML =
        s.status === 'loading' ? '<div class="empty">Checking sign-in&hellip;</div>' :
        s.status === 'unconfigured' ? stateCard('Firebase is not set up', `Missing: <code>${esc(missingConfig.join(', '))}</code>. See the Account page.`) :
        s.status === 'nostore' ? stateCard('No store assigned', 'This account is not linked to a store yet. Open the Account page to get the ID the administrator needs.', '<button class="primary" data-xh="account">Account</button>') :
        stateCard('Sign in to see the requests', 'Extra-hours requests are shared with the crew of your store.', '<button class="primary" data-xh="login">Sign in</button>');
      return;
    }
    if (shell !== state) { shell = state; root.innerHTML = `${formHtml()}<div id="xhList"></div>`; }
    $('#xhList').innerHTML = listHtml();
    $('#xhList').dataset.store = prettyStore(s.storeId);
  }

  // ---------- actions ----------
  root.addEventListener('submit', async (e) => {
    if (e.target.id !== 'xhForm') return;
    e.preventDefault();
    const err = $('#xhErr'), addBtn = $('#xhAdd');
    const check = validateRequest({ day: $('#xhDay').value, name: $('#xhName').value, originalHours: $('#xhOrig').value, nextHours: $('#xhNext').value }, todayStr());
    if (!check.ok) { err.textContent = check.error; err.hidden = false; return; }
    err.hidden = true; addBtn.disabled = true;
    try {
      await push(COLLECTION, newRequest(check.value, session.uid));
      lastDay = check.value.day; // adding several people for the same day is the common case
      $('#xhName').value = ''; $('#xhOrig').value = ''; $('#xhNext').value = '';
      $('#xhName').focus();
      toast('Request added');
    } catch (ex) {
      err.textContent = friendlyError(ex); err.hidden = false;
    } finally { addBtn.disabled = false; }
  });

  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-xh]');
    if (!b) return;
    const act = b.dataset.xh;
    if (act === 'login') return openLogin('extra');
    if (act === 'account') return openLogin('extra'); // goes to the Account page
    if (act === 'toggle') { formOpen = !formOpen; shell = ''; render(); if (formOpen) $('#xhName')?.focus(); return; }
    const id = b.closest('.xh-row')?.dataset.id;
    if (!id) return;
    if (act === 'status') {
      busy.add(id); render();
      try { await update(`${COLLECTION}/${id}`, { status: b.dataset.to, updatedAt: Date.now() }); }
      catch (ex) { toast(friendlyError(ex)); }
      finally { busy.delete(id); render(); }
    } else if (act === 'delete') { // two taps, so a stray tap never deletes
      if (!armed.has(id)) { armed.set(id, setTimeout(() => { armed.delete(id); render(); }, 3000)); render(); return; }
      clearTimeout(armed.get(id)); armed.delete(id); busy.add(id); render();
      try { await remove(`${COLLECTION}/${id}`); toast('Request deleted'); }
      catch (ex) { toast(friendlyError(ex)); }
      finally { busy.delete(id); render(); }
    }
  });

  onSession(() => { sync(); render(); });

  return {
    enter() { active = true; shell = ''; sync(); render(); },
    leave() { active = false; stop(); },
    // call when the app returns to the foreground: a new day means a new "from today" query
    refresh() { if (active) { sync(); render(); } },
  };
}
