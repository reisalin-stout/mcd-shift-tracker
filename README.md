# Shift Tracker

A personal, mobile-first web app used by a single McDonald's shift manager to track progress during a shift. It replaces mental notes and paper: it sorts the restaurant by area, records expiration checks and other recurring tasks, and builds a restock list that can be sent as a message and assigned to staff quickly.

This document is context for anyone (human or AI) developing the project. It describes the goals, every implemented feature, the data model, the conventions, and the planned future work.

---

## 1. Goals

- **Speed during a live shift.** Every interaction should be doable one-handed with a thumb (swipe, tap, long-press), with no typing.
- **Follow the physical layout of the restaurant.** Areas are listed in the exact order the manager walks them (`orderId` in the structure file).
- **Track two kinds of things per area:**
  1. **Tasks**: things to check or do (e.g. expiration checks, fryer shutdown). Each ends up completed or resolved.
  2. **Stock**: items whose quantity is counted and possibly needs restocking.
- **Produce exports** that can be pasted into a message: open tasks, a restock list, and a prep projection.
- **Project prep quantities** from an expected guest count (see 5.8).
- **No data loss in the short term.** All state is persisted in `localStorage`.
- **Single user, single device, no backend (for now).** Hosted as a static site on GitHub Pages.

### Non-goals (for now)
- No accounts, login, or multi-user support.
- No backend or database (planned later, see section 9).
- No editing of the structure from within the UI. The structure is edited in the JSON file.

---

## 2. Tech stack

- **Vite** (vanilla JavaScript, no framework)
- Plain CSS (`src/style.css`), single dark-header / light-body theme
- `localStorage` for persistence
- **GitHub Pages** hosting via a GitHub Actions workflow (`.github/workflows/deploy.yml`)
- `vite.config.js` uses `base: './'` (relative paths) so it works under any repo name

### Project layout

```
shift-tracker/
├── index.html                  # Shell: top bar, drawer menu, list container, toast
├── package.json
├── vite.config.js
├── .github/workflows/deploy.yml
└── src/
    ├── main.js                 # All app logic (state, render, gestures, export)
    ├── style.css
    ├── structure.json          # Source of truth for dayparts, areas, tasks, stock
    └── data.json               # Projection items: default weight (per 1000 GC) and yield
```

### Commands
- `npm install`
- `npm run dev` (dev server, exposed on the network for testing on a phone)
- `npm run build`
- `npm run preview`

---

## 3. Language convention (important)

- **All string data in `structure.json` is Italian and must never be renamed, translated, or "corrected"** without asking the owner first (e.g. `"Scadenza Latte"`, `"Bicchieri Flurry"`).
- **Everything else is English:** UI labels, buttons, toasts, code, comments, CSS classes, this document, commit messages.
- The order of areas, tasks, and stock items must match the order in the JSON.

---

## 4. Data source: `structure.json`

Top-level keys are **dayparts**. Each daypart contains **areas** keyed by an id.

```json
{
  "afternoon-1": {
    "mccafe": {
      "orderId": 1,
      "name": "McCafe",
      "tasks": ["Ordine", "Scadenza Latte"],
      "stock": ["Bicchieri Flurry"]
    }
  },
  "afternoon-2": { "management": { "orderId": 1, "name": "Management", "tasks": ["DFS"], "stock": [] } }
}
```

| Field | Meaning |
|---|---|
| Daypart key (`afternoon-1`, `afternoon-2`) | A part of the day. Different dayparts have different areas/tasks. Displayed as "Afternoon 1" (dash replaced by space, first letter capitalised). |
| Area key (`mccafe`, `side-2`, ...) | Stable id used in stored state. **Do not change keys casually**, as they are part of the storage keys of saved data. |
| `orderId` | Sort order of areas (ascending). Sort is stable, so ties keep file order. |
| `name` | Display name (Italian/brand names, shown as-is). |
| `tasks` | Ordered list of task names. |
| `stock` | Ordered list of stock item names (may be empty). |

Notes:
- Areas with both empty `tasks` and `stock` never render anything.
- Currently `floor` and `management` in `afternoon-1` both have `orderId: 16`. They render in file order (Floor, then Management). This is an open question for the owner (should Management be 17?).
- Task and stock identity is `"<areaKey>|<name>"`. Names must be unique within an area; renaming an item orphans its saved state for the current day.

---

## 5. Features

### 5.1 Layout
- One continuous list occupying the whole screen width, optimised for phone browsers (viewport meta with `viewport-fit=cover`, safe-area insets respected).
- A sticky top bar shows the current daypart and date, with a ☰ button at the left.
- Each area is a **section** with a full-width header bar (the area's `name`).
- Within a section: **tasks first, then stock**.
- Areas with nothing left open are hidden from the top part of the page.

### 5.2 Tasks (swipe interaction)
- Each task is a full-width row.
- **Swipe right** → **completed**. The row turns **green**.
- **Swipe left** → **resolved** (an issue was found and fixed, e.g. an expiration label was missing). The row turns **red**.
- While dragging, the row slides and reveals the colour underneath (green on the left for a right swipe, red on the right for a left swipe).
- The swipe threshold is 90px. Below that the row snaps back with no change.
- Vertical scrolling is preserved (`touch-action: pan-y`). A gesture counts as a swipe only if it is mainly horizontal.
- Once marked, the task moves to the **Done** block at the bottom of the page, still grouped under its area header, keeping its green or red colour.
- **Tap a row in the Done block to undo** it (it returns to the open list). Added so that accidental swipes are recoverable.

### 5.3 Stock (counter interaction)
- Each stock item is a row with **`−` on the left**, **`+` on the right**, and the **amount plus item name** in the middle.
- Amounts start at 0 and cannot go below 0. Tapping `+`/`−` updates the number in place (no re-render, no scroll jump) and saves immediately.
- **Long-press (500ms) on the row (not on the buttons)** sends the item to the Done block at the bottom, **keeping its amount**. The device vibrates briefly if supported.
- Moving a stock item to Done means "I've handled or noted this". It does not zero the quantity.
- In the Done block, stock rows keep working `+`/`−` buttons. **Tap the middle of a done stock row to move it back** to the open list.
- Long-press does not trigger if the finger moves more than 10px (so scrolling is safe). The context menu and text selection are disabled on rows.

### 5.4 Done block
- After all open sections, a yellow "Done" divider precedes a second set of sections (same area order and headers) containing completed/resolved tasks and done stock.
- If everything is done, the top shows "Everything in this daypart is done."

### 5.5 Menu (drawer, left)
Opened with the ☰ button, closed by tapping the overlay. The drawer is an **accordion** with two sections; tapping a section header switches the page and expands its submenu (tapping the active header collapses/expands it).

- **Dayparts** (page: the shift list). Submenu:
  - **Daypart selector.** Lists every daypart in `structure.json`. The selection is remembered in `localStorage` (`shift:daypart`). It defaults to the first daypart on first use. There is currently **no automatic time-based selection** because no time ranges have been defined. Picking one closes the drawer.
  - **Copy open tasks.** Copies to the clipboard every task not yet completed/resolved, grouped by area, in the original order:
    ```
    McCafe
    - Ordine
    - Scadenza Latte

    Fries
    - Spegnimento Fryer
    ```
    Shows a toast "Open tasks copied", or "No open tasks" when there are none.
  - **Copy restock list.** Copies every stock item with an amount above 0 (whether or not it is in the Done block), grouped by area, in the original order, formatted as `x<amount> <item name>`:
    ```
    Beverages
    x3 Bicchieri Bibite G
    x1 Tappi Bibite
    ```
    Shows a toast "Restock list copied", or "Nothing to restock" when empty.
- **Projection** (page: the projection tab, see 5.8). Submenu: **Copy projection**. Tapping the header opens the page and closes the drawer.
- **Clear website data** (bottom of the drawer). Two taps: the first arms the button ("Tap again to confirm", disarms after 4s or when the menu closes), the second deletes every `localStorage` key starting with `shift:` (all shift states, the remembered daypart, projection weights and guest count) and resets the UI. Only the app's own keys are removed, because `localStorage` is shared by every project on the same `github.io` origin.
- Clipboard uses `navigator.clipboard` with a `textarea` + `execCommand('copy')` fallback.

### 5.6 Day and daypart handling
- On load, the app opens on the Dayparts page, takes the **local date** (`YYYY-MM-DD`) and the remembered daypart, and loads that combination's state.
- When the app returns to the foreground (`visibilitychange`) and the date has rolled over, it switches to the new date with a fresh state automatically.
- Each daypart has its **own independent state** per day.

### 5.7 Persistence
- `localStorage` key per shift state: `shift:<YYYY-MM-DD>:<daypart>`.
- Extra key: `shift:daypart` (last selected daypart).
- State shape:
  ```json
  {
    "tasks": { "mccafe|Ordine": "done", "fries|Coperchi Fryer": "resolved" },
    "stock": { "beverages|McFizz": { "qty": 3, "done": true } }
  }
  ```
  - `tasks[key]` is `"done"` or `"resolved"`. A missing key means open.
  - `stock[key]` is `{ qty, done }`. A missing key means qty 0 and open.
- Projection keys:
  - `shift:proj-weights`: `{ "<itemId>": number }`, the edited weights. A missing item means "use the default from `data.json`". Persistent (not pruned).
  - `shift:proj-yields`: same shape, for edited yields.
  - `shift:<YYYY-MM-DD>:proj`: `{ "gc": number | null }`, the guest count for that day (`null` = default 1000). Pruned with the other daily keys.
- **Automatic pruning:** on startup, entries whose date is more than 7 days old are deleted.
- Every user action saves immediately.

### 5.8 Projection tab
A second page, reached from the drawer. It works out how many boxes of each prepared item to ask for, from the expected guest count.

- **Data:** `src/data.json` holds `weights`, an array of single-key objects: `{ "<id>": { "name", "default", "yeld" } }`. `default` is the weight needed for **1000 guests** (`BASE_GC`); `yeld` (spelling kept from the file) is the weight per box; both can be overridden in the UI. Names are Italian and must not be renamed.
- **Guest Count Total:** one big input at the top, default 1000 shown in **grey**. Turns dark once changed. Empty or invalid input falls back to the default.
- **Table** (`Item | Weight | Yield | Target | Boxes`):
  - **Weight** (the `default` from `data.json`) is an editable input, in **grey** while unchanged, dark once edited (to adjust to POS data). Clearing it, or typing the original value, restores the default.
  - **Yield** is also an editable input with the same behaviour (grey until changed, empty restores the default).
  - **Target** = `default × GC ÷ 1000` (e.g. 350 at 200 GC → 70).
  - **Boxes** = `target ÷ yield`, shown with one decimal (truncated, so 2.19999 shows 2.1) plus the rounded ask below it (`→ 3`).
- **Rounding rule (export):** fractional part below 0.2 rounds down (2.1 to 2.19999 → 2), 0.2 or more rounds up (2.2 → 3). Implemented as `floor(round(x, 6) + 0.8 + 1e-9)`.
- **Copy projection** (button under the table, and in the drawer) copies items whose rounded amount is above 0:
  ```
  Projection - 200 GC
  x3 Bacon Cotto
  x1 Pomodori a Fette
  ```
  Toast "Projection copied", or "Nothing to prepare".
- Everything recalculates live on every keystroke; the inputs are patched in place (no re-render) so focus is never lost. Inputs use the decimal keypad and accept `,` or `.`; fields select all on focus.
- This is the one screen that needs typing, by design (it is a planning tool rather than a live-shift interaction).

---

## 6. Interaction details and edge cases (for developers)

- Gestures use **Pointer Events** with event delegation on `#list`. State for the active gesture is held in a single variable `g`.
- Stock `+`/`−` are real `<button>`s handled by a separate `click` listener. The pointer handlers ignore events that start on a button.
- `pointercancel` (e.g. the browser starts vertical scrolling) aborts the gesture and resets the row transform with no state change.
- Rendering is a full `innerHTML` rebuild of the list (`render()`), except for the stock quantity update, which patches the number only. Strings are HTML-escaped before insertion.
- Colour tokens live as CSS variables in `:root` (`--green`, `--red`, `--slate`, `--amber`, etc.).

---

## 7. Deployment (GitHub Pages)

1. Push the project to a GitHub repo on the `main` branch.
2. In the repo settings, go to Pages and set Source to **GitHub Actions**.
3. The workflow installs dependencies, runs `npm run build`, and deploys `dist/`.
4. Open the resulting URL on the phone. Adding it to the home screen gives a full-screen feel (no PWA manifest or service worker yet).

Since data lives in the browser's `localStorage`, it is tied to the device, browser, and site origin. Clearing site data erases it.

---

## 8. Known limitations and open questions

- `floor` and `management` share `orderId: 16` in `afternoon-1` (see section 4).
- No automatic daypart detection by time of day, as time ranges are undefined.
- No offline support (no service worker). The page works only after being loaded once online, and can fail if the browser evicts its cache with no connection.
- No way to reset a single shift's state from the UI. "Clear website data" wipes everything, and data expires automatically after 7 days.
- Projection items can only be edited in `src/data.json`. Only weights and yields can be adjusted in the UI.
- No undo history beyond tapping a done row to restore it.
- Stock amounts are integers with no per-item units or par levels.
- Only the first daypart selection is remembered. Switching dayparts mid-shift is safe because each has separate state.

---

## 9. Roadmap (planned, NOT part of the current scope)

- **External small database** to keep a recap of each day (end-of-day summary of what was completed, resolved, and restocked). The current per-day, per-daypart storage shape is intentionally simple to make syncing or migrating easy. When implemented, `localStorage` should remain the offline-first cache.
- Possible later ideas (only if requested): time-based daypart auto-selection, a "reset shift" action, a PWA manifest and service worker for offline use, per-item par levels.

Do not implement roadmap items unless explicitly asked.

---

## 10. Rules for contributors / AI assistants

1. **Never rename, translate, or reorder** strings or entries in `structure.json` without asking the owner first.
2. Keep all UI text, code, and comments in **English**.
3. Preserve the **mobile-first, one-handed** interaction model. Do not add features that need typing during the shift (the Projection page is the deliberate exception).
4. Keep it lightweight: no heavy frameworks or dependencies unless there is a strong reason.
5. Any change to storage keys or state shape must stay backward compatible or include a migration, since it is live data on the owner's phone during shifts.
6. Ask when in doubt. The owner prefers a question over a guess about restaurant-specific behaviour.
