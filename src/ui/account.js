// Account UI: the Account page (sign in / signed-in details / log out) and the dropdown on the avatar in the top bar.
import { $, esc, toast } from '../util.js';
import { session, onSession, signIn, signOut, friendlyError, missingConfig, backendName } from '../session.js';
import { prettyStore } from '../names.js';

const PERSON = '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7z"/></svg>';

export function initAccount({ go, prefix, getView }) {
  const LAST = `${prefix}lastUser`; // remembered username, only a convenience (never the password)
  const page = $('#account');
  const btn = $('#acctBtn');
  const menu = $('#acctMenu');
  let returnTo = null; // where to go after a successful sign-in
  let shown = ''; // what the page currently shows, so typing is not wiped by unrelated updates

  const lastUser = () => { try { return localStorage.getItem(LAST) || ''; } catch { return ''; } };
  const remember = (u) => { try { localStorage.setItem(LAST, u); } catch { /* private mode: fine */ } };
  const storeName = () => prettyStore(session.storeId);

  // ---------- account page ----------
  function card(inner) { return `<div class="acct-card">${inner}</div>`; }
  function pageHtml() {
    const s = session;
    if (s.status === 'unconfigured') {
      return card(`<h2>Firebase is not set up</h2><p>The shift tracker works, but sign-in and shared data need the Firebase settings.</p>
        <p class="hint">Missing: <code>${esc(missingConfig.join(', '))}</code></p>
        <p class="hint">Copy <code>.env.local.example</code> to <code>.env.local</code>, fill in the values and restart <code>npm run dev</code>. On GitHub, add them as Actions variables.</p>`);
    }
    if (s.status === 'loading') return card('<p class="hint">Checking sign-in&hellip;</p>');
    if (s.status === 'out') {
      return card(`<h2>Sign in</h2>
        <form id="loginForm" autocomplete="on" novalidate>
          <label for="loginUser">Username</label>
          <input id="loginUser" name="username" type="text" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="next" placeholder="e.g. sa-luca" value="${esc(lastUser())}" />
          <label for="loginPass">Password</label>
          <input id="loginPass" name="password" type="password" autocomplete="current-password" enterkeyhint="go" />
          <div class="form-err" id="loginErr" role="alert" hidden></div>
          <button class="primary" id="loginBtn" type="submit">Sign in</button>
        </form>
        <p class="hint">You stay signed in on this device until you log out.${backendName === 'mock' ? ' <b>Mock mode:</b> try sa-luca / test1234.' : ''}</p>`);
    }
    const idBlock = `<div class="kv"><span>Account ID</span><button class="link" data-acct="copyid" title="Copy">${esc(s.uid)}</button></div>`;
    if (s.status === 'nostore') {
      return card(`<h2>${esc(s.name || s.username)}</h2>
        <p class="warn-text">Signed in, but this account is not linked to a store yet.${s.error ? ` (${esc(s.error)})` : ''}</p>
        <p class="hint">Send the account ID below to the administrator, who adds it in the Firebase console under <code>userStores</code>.</p>
        ${idBlock}<button class="primary" data-acct="logout">Log out</button>`);
    }
    return card(`<h2>${esc(s.name || s.username)}</h2>
      <div class="kv"><span>Username</span><b>${esc(s.username)}</b></div>
      <div class="kv"><span>Store</span><b>${esc(storeName())}</b></div>
      ${idBlock}
      <button class="primary" data-acct="extra">Open extra hours</button>
      <button class="secondary" data-acct="logout">Log out</button>`);
  }
  function renderPage() {
    const key = session.status + '|' + session.uid + '|' + session.storeId + '|' + session.error;
    if (key === shown) return;
    shown = key;
    page.innerHTML = pageHtml();
  }

  page.addEventListener('submit', async (e) => {
    if (e.target.id !== 'loginForm') return;
    e.preventDefault();
    const user = $('#loginUser').value, pass = $('#loginPass').value, err = $('#loginErr'), b = $('#loginBtn');
    err.hidden = true;
    if (!user.trim() || !pass) { err.textContent = 'Enter username and password.'; err.hidden = false; return; }
    b.disabled = true; b.textContent = 'Signing in…';
    try {
      await signIn(user, pass);
      remember(user.trim().toLowerCase().split('@')[0]);
      toast('Signed in');
    } catch (ex) {
      err.textContent = friendlyError(ex); err.hidden = false;
      b.disabled = false; b.textContent = 'Sign in';
      $('#loginPass').select();
    }
  });
  page.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-acct]')?.dataset.acct;
    if (a) await act(a);
  });

  async function act(a) {
    if (a === 'logout') { closeMenu(); try { await signOut(); toast('Logged out'); go('account'); } catch (ex) { toast(friendlyError(ex)); } }
    else if (a === 'extra') go('extra');
    else if (a === 'account') go('account');
    else if (a === 'login') openLogin();
    else if (a === 'copyid') {
      try { await navigator.clipboard.writeText(session.uid); toast('Account ID copied'); } catch { toast(session.uid); }
    }
  }

  // Opens the sign-in page; after a successful sign-in the person lands on `back` (default: extra hours)
  function openLogin(back = 'extra') { returnTo = back; closeMenu(); go('account'); }

  // ---------- top bar avatar + dropdown ----------
  function closeMenu() { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); }
  function renderMenu() {
    const s = session;
    btn.className = `acct-btn st-${s.status}`;
    btn.setAttribute('aria-label', s.status === 'in' ? `Account: ${s.username}` : 'Account');
    btn.innerHTML = s.status === 'in' && s.name ? `<span>${esc(s.name[0])}</span>` : PERSON;
    const item = (a, label, cls = '') => `<button class="acct-item ${cls}" data-acct="${a}">${label}</button>`;
    let html;
    if (s.status === 'in') {
      html = `<div class="acct-who"><b>${esc(s.name || s.username)}</b><small>${esc(storeName())}</small></div>${item('extra', 'Extra hours')}${item('account', 'Account')}${item('logout', 'Log out', 'danger')}`;
    } else if (s.status === 'nostore') {
      html = `<div class="acct-who"><b>${esc(s.name || s.username)}</b><small>No store assigned</small></div>${item('account', 'Account')}${item('logout', 'Log out', 'danger')}`;
    } else if (s.status === 'loading') {
      html = '<div class="acct-who"><small>Checking sign-in&hellip;</small></div>';
    } else if (s.status === 'unconfigured') {
      html = `<div class="acct-who"><small>Firebase not set up</small></div>${item('account', 'Details')}`;
    } else {
      html = `<div class="acct-who"><small>Not signed in</small></div>${item('login', 'Sign in')}`;
    }
    menu.innerHTML = html;
  }
  btn.addEventListener('click', (e) => { e.stopPropagation(); const open = menu.hidden; menu.hidden = !open; btn.setAttribute('aria-expanded', String(open)); });
  menu.addEventListener('click', (e) => { const a = e.target.closest('[data-acct]')?.dataset.acct; if (a) { closeMenu(); act(a); } });
  document.addEventListener('pointerdown', (e) => { if (!menu.hidden && !e.target.closest('#acct')) closeMenu(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

  // ---------- reacting to login changes ----------
  let prev = session.status;
  onSession((s) => {
    renderMenu();
    renderPage();
    const justSignedIn = prev !== 'in' && s.status === 'in' && getView() === 'account';
    prev = s.status;
    if (justSignedIn) { const to = returnTo || 'extra'; returnTo = null; go(to); }
  });
  renderMenu();
  renderPage();
  // The drawer entry shows who is signed in
  onSession(updateDrawerLabel); updateDrawerLabel();
  function updateDrawerLabel() {
    const l = $('#acctDrawerLabel');
    if (l) l.textContent = session.status === 'in' ? `Account · ${session.name || session.username}` : session.status === 'out' ? 'Sign in' : 'Account';
  }

  return { openLogin, renderPage: () => { shown = ''; renderPage(); } };
}
