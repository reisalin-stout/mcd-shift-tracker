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
- **Project prep quantities** from an expected guest count, grouped by category with adjustable multipliers (see 5.8).
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
- **Content and settings live in JSON files** (`structure.json`, `database.json`, `config.json`). Changing them does not require touching `main.js`.

### Project layout

```
shift-tracker/
├── index.html                  # Shell: top bar, drawer menu, shift list, projection page, warning banner, toast
├── package.json                # npm scripts + Vite (its own "version" is unrelated to siteVersion)
├── package-lock.json
├── vite.config.js
├── .gitignore / .gitattributes
├── .github/workflows/deploy.yml
└── src/
    ├── main.js                 # All app logic (state, render, gestures, export)
    ├── style.css
    ├── structure.json          # Dayparts, areas, tasks, and stock lists (as product ids), see section 4
    ├── database.json           # Central product catalogue + category list, see section 4b
    └── config.json             # Site version, data version, storage name, see section 4c
```

### Commands
- `npm install`
- `npm run dev` (dev server, exposed on the network for testing on a phone)
- `npm run build`
- `npm run preview`

---

## 3. Language convention (important)

- **All string data in `structure.json` and the product `name` values in `database.json` are Italian and must never be renamed, translated, or "corrected"** without asking the owner first (e.g. `"Scadenza Latte"`, `"Bicchieri Flurry"`). Category names (`Paper`, `Bread`, ...) are English.
- **Everything else is English:** UI labels, buttons, toasts, code, comments, CSS classes, this document, commit messages.
- The order of areas, tasks, and stock items must match the order in the JSON. Ids (in `database.json`) are technical, lowercase, and never shown in the UI.

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
      "stock": ["bicchieri-flurry"]
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
| `stock` | Ordered list of **product ids** from `database.json` (may be empty). The display name comes from the database. The same product may appear in several areas (e.g. `jug-in-box-stock`); each area keeps its own count. |

Notes:
- Areas with both empty `tasks` and `stock` never render anything.
- Currently `floor` and `management` in `afternoon-1` both have `orderId: 16`. They render in file order (Floor, then Management). This is an open question for the owner (should Management be 17?).
- Task identity is `"<areaKey>|<task name>"` (renaming a task orphans its saved state for the day; tasks are planned to move to ids later). Stock identity is `"<areaKey>|<productId>"`, so renaming a product's `name` is safe, but changing its `id` is not.

## 4b. Data source: `database.json`

The single catalogue of products, referenced by id from `structure.json` (stock lists) and used by the projection tab.

```json
{
  "categories": { "Paper": 100, "Bread": 100 },
  "products": [
    { "id": "bicchieri-flurry", "code": "", "name": "Bicchieri Flurry", "category": "Paper", "weight": 0, "yield": 0 }
  ]
}
```

- **`categories`**: `{ "<category>": defaultAdj% }`. The key order is the **category order** used by the projection and the restock export; the number is the default Adj % of the whole category (see 5.8). Categories used by a product but not listed here are flagged by the startup check.
- **`products`** (every product has every field):
  | Field | Meaning |
  |---|---|
  | `id` | Unique, lowercase string (e.g. `bacon-cotto`). Referenced from `structure.json`. **Never change an id once in use** (saved counts and projection overrides are keyed by it). Do not use a hash of the data: it would change whenever a weight or yield is edited. |
  | `code` | Product code as printed on the box (string, e.g. `"19565 - 013"`). Empty for now; reserved for later features. |
  | `name` | Italian display name. |
  | `category` | One of the `categories` keys (may be empty). |
  | `weight` | Quantity needed per **1000 guests** (`BASE_GC`). `0` = not part of the projection. |
  | `yield` | How many units one box/package contains. `0` = unknown. Used by the projection to compute boxes. |
- **Projection membership:** only products with `weight > 0` appear in the projection tab. Stock-only products (cups, sauces, ...) keep `weight: 0`.
- **Startup check (`validate()`):** a red banner under the top bar lists products without an id, duplicate ids, products with a category missing from `categories`, and stock ids in `structure.json` that do not exist in the database (also logged with `console.error`). Unknown ids are shown with the raw id so the typo is visible; in the restock export they land at the end without a category header.
- **Products not referenced by any stock list** (currently `bacon-cotto` and `pomodori-a-fette`) are valid: they only appear in the projection.
- **Adding a product:** add one entry to `products`, then put its id in the `stock` list of the relevant area(s).

## 4c. Settings: `config.json`

```json
{
  "siteVersion": "1.0.0",
  "dataVersion": "1.0.0",
  "storageName": "mcd-shift-companion"
}
```

| Key | Meaning |
|---|---|
| `siteVersion` | Shown at the bottom of the drawer (`v1.0.0`), to check which version is running on the phone. Bump it only when major content is introduced or changed, not on every update. It has no effect on saved data. |
| `dataVersion` | Version of the saved-data format. Bump it only on large updates that change the shape of the saved data (like the move to product ids). If the data saved in the browser has a **lower** version, or none, all of the app's saved data is wiped on startup (see 5.7). |
| `storageName` | Name that prefixes every `localStorage` key of the app (`<storageName>:...`). `localStorage` is shared by every project on the same `github.io` origin, so this keeps the app's data separate. **Changing it makes the app ignore all data saved under the old name** (the old keys are left in the browser, never read or deleted by the app). |

The `"version"` field in `package.json` is a separate npm field and is not used by the app.

Versions are dotted numbers (`"1.0.0"`), compared part by part (`0.9.0` < `1.0.0` < `1.10.0`). All three keys are required.

---

## 5. Features

### 5.1 Layout
- One continuous list occupying the whole screen width, optimised for phone browsers (viewport meta with `viewport-fit=cover`, safe-area insets respected).
- A sticky top bar shows the current daypart (or "Projection" on the projection page) and the date, with a ☰ button at the left.
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
  - **Daypart selector.** Lists every daypart in `structure.json`. The selection is remembered in `localStorage` (`<storageName>:daypart`). It defaults to the first daypart on first use. There is currently **no automatic time-based selection** because no time ranges have been defined. Picking one closes the drawer.
  - **Copy open tasks.** Copies to the clipboard every task not yet completed/resolved, grouped by area, in the original order:
    ```
    McCafe
    - Ordine
    - Scadenza Latte

    Fries
    - Spegnimento Fryer
    ```
    Shows a toast "Open tasks copied", or "No open tasks" when there are none.
  - **Copy restock list.** Copies every stock item with an amount above 0 (whether or not it is in the Done block), formatted as `x<amount> <item name>`. **Amounts of the same product id are summed across areas** (e.g. `jug-in-box-stock` counted in Fries and MFY Side 4 becomes one line). Lines are grouped by **category** (order from `database.json`), products in order of first appearance in the area walk:
    ```
    Paper
    x3 Bicchieri Bibite G
    x1 Tappi Bibite

    Other
    x5 Jug in Box Stock
    ```
    Shows a toast "Restock list copied", or "Nothing to restock" when empty.
- **Projection** (page: the projection tab, see 5.8). Submenu: **Copy projection**. Tapping the header opens the page and closes the drawer. Tapping the **Dayparts** header while on the projection page switches back to the shift list and keeps the drawer open.
- A successful copy (tasks, restock, projection) closes the drawer and shows a toast; the "nothing to export" toasts leave it open.
- **Clear website data** (bottom of the drawer). Two taps: the first arms the button ("Tap again to confirm", disarms after 4s or when the menu closes), the second deletes every `localStorage` key starting with `<storageName>:` (all shift states, the remembered daypart, projection weights and guest count), writes the current `dataVersion` again, and resets the UI (the selected daypart goes back to the first one). Only the app's own keys are removed, because `localStorage` is shared by every project on the same `github.io` origin. The site version (`vX.Y.Z`) is shown under this button.
- Clipboard uses `navigator.clipboard` with a `textarea` + `execCommand('copy')` fallback.

### 5.6 Day and daypart handling
- On load, the app opens on the Dayparts page, takes the **local date** (`YYYY-MM-DD`) and the remembered daypart, and loads that combination's state.
- When the app returns to the foreground (`visibilitychange`) and the date has rolled over, it switches to the new date with a fresh state automatically.
- Each daypart has its **own independent state** per day.

### 5.7 Persistence
- All keys start with `<storageName>:` (from `config.json`, currently `mcd-shift-companion`). Below, `<storageName>:` stands for that prefix.
- `localStorage` key per shift state: `<storageName>:<YYYY-MM-DD>:<daypart>`.
- Extra keys: `<storageName>:daypart` (last selected daypart) and `<storageName>:dataVersion` (see data versioning below).
- State shape:
  ```json
  {
    "tasks": { "mccafe|Ordine": "done", "fries|Coperchi Fryer": "resolved" },
    "stock": { "beverages|mcfizz": { "qty": 3, "done": true } }
  }
  ```
  - `tasks[key]` is `"done"` or `"resolved"`. A missing key means open.
  - `stock[key]` is `{ qty, done }`, keyed by `"<areaKey>|<productId>"`. A missing key means qty 0 and open.
- Projection keys:
  - `<storageName>:proj-weights`: `{ "<itemId>": number }`, the edited weights. A missing item means "use the default from `database.json`". Persistent (not pruned).
  - `<storageName>:proj-yields`: same shape, for edited yields.
  - `<storageName>:<YYYY-MM-DD>:proj`: `{ "gc": number | null, "gadj": number | null, "cadj": { "<category>": number } }`: the guest count (`null` = 1000), the global Adj % (`null` = 100) and today's category Adj % overrides (missing = the `database.json` default). Pruned with the other daily keys.
- **Data versioning (no migrations):** the saved data version is stored in `<storageName>:dataVersion`. On startup `main.js` compares it with `dataVersion` from `config.json`: if it is missing, malformed, or **lower**, all keys starting with `<storageName>:` are wiped and the current `dataVersion` is written. An equal or higher saved version is left untouched. Keys without the prefix (other projects on the same `github.io` origin) are never touched. There is deliberately no migration code: old data is dropped, not converted. See 4c for how `siteVersion` and `dataVersion` are used.
- **Automatic pruning:** on startup, entries whose date is more than 7 days old are deleted (only keys with the `<storageName>:` prefix and a date in the name).
- Every user action saves immediately.

### 5.8 Projection tab
A second page, reached from the drawer. It works out how many boxes of each prepared item to ask for, from the expected guest count.

- **Data:** products come from `src/database.json` (section 4b). Only products with `weight > 0` are listed; `weight` is the quantity for **1000 guests** and `yield` the units per box, both overridable in the UI. Categories and their default Adj % come from the `categories` object, whose key order is the category order on the page.
- **Top fields** (side by side, default value in **grey**, dark once changed, empty or invalid input falls back to the default):
  - **Guest Count Total**: expected guests, default 1000.
  - **Adj %** (global): a quick multiplier applied to *every* category, default 100. For testing a higher or lower prep without touching the defaults.
- **Table** (`Item | Weight | Yield | Target | Boxes`), split into **categories**. Each category has a dark header row with its name and its own editable **Adj %** input:
  - **Category Adj %** starts at the `categories` default in `database.json` (grey) and can be overridden for today (dark). Clearing it, or typing the default again, restores the default. Applies to all items in the category.
  - **Weight** (the `weight` from `database.json`) is an editable input, in **grey** while unchanged, dark once edited (to adjust to POS data). Clearing it, or typing the original value, restores the default.
  - **Yield** is also an editable input with the same behaviour (grey until changed, empty restores the default).
  - **Target** = `weight × GC ÷ 1000 × category Adj ÷ 100 × global Adj ÷ 100` (e.g. 400 at 300 GC with category Adj 120 → 144).
  - **Boxes** = `target ÷ yield`, shown with one decimal (truncated, so 2.19999 shows 2.1) plus the rounded ask below it (`→ 3`). With a yield of 0 it shows `–` and the item is left out of the export.
- **Rounding rule (export):** fractional part below 0.2 rounds down (2.1 to 2.19999 → 2), 0.2 or more rounds up (2.2 → 3). Implemented as `floor(round(x, 6) + 0.8 + 1e-9)`.
- **Copy projection** (button under the table, and in the drawer) exports **everything in one tap** (all categories), listing items whose rounded amount is above 0, grouped by category with a blank line between groups (categories with nothing to prepare are skipped). The header shows the guest count, and the global Adj % or a category's Adj % are added in brackets only when they differ from 100:
  ```
  Projection - 200 GC (Adj 110%)

  Fillings (Adj 120%)
  x6 Farciture Toast
  x7 Bacon Cotto

  Vegetables
  x30 Insalate Finite
  x30 Pomodori a Fette
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

### Code map of `main.js` (top to bottom)
1. Imports (`structure.json`, `database.json`, `config.json`), `PREFIX`, date helpers.
2. Shift state: `load()` / `save()` / `prune()` (key `<storageName>:<date>:<daypart>`).
3. Data helpers: `areas()` (sorted by `orderId`), `kid()`, `products` / `byId` / `pname()`, `categoryOrder()`, `validate()`, `esc()`.
4. Shift list: `taskRow()`, `stockRow()`, `render()`, `setTask()`, `setStockDone()`, the `+`/`−` click handler, and the pointer gesture handlers.
5. Menu: `toggleMenu()`, `setView()`, drawer and daypart click handlers.
6. Exports: `toast()`, `copy()`, tasks export, restock export; `visibilitychange` day roll-over.
7. Projection: `calc()`, `groups()`, `projRow()`, `catHead()`, `renderProj()`, `updateProj()`, input/focusout handlers, `exportProj()`.
8. Clear website data, versioning (`checkVersion()`), and the **startup sequence**: `checkVersion()` → `validate()` → `prune()` → `load()` → `loadProj()` → `render()` → `renderProj()` → `setView('dayparts')`. Keep `checkVersion()` first, so incompatible data is wiped before anything reads it.

Pitfalls: every user-facing string goes through `esc()` before `innerHTML`; every `localStorage` key must start with `PREFIX` (shared origin); stock keys use product ids, task keys use task names; do not break `touch-action: pan-y` on rows (it keeps vertical scrolling working during swipes).

## 6b. Common changes (recipes)

| I want to... | Do this |
|---|---|
| Add a product | Add an entry with all six fields to `database.json` (new unique `id`), then add the id to the `stock` list of the area(s) that count it. Give it `weight > 0` and a `yield` to include it in the projection. |
| Rename a product on screen | Change only its `name` (never its `id`). |
| Add a task | Append the (Italian) string to the area's `tasks` in `structure.json`. |
| Add an area | Add a key under the daypart with `orderId`, `name`, `tasks`, `stock`. |
| Add a daypart | Add a top-level key in `structure.json`; it shows up in the menu automatically (label derived from the key). |
| Add or reorder a category, or set its default Adj % | Edit `categories` in `database.json` (key order = display order). |
| Force everyone's saved data to reset after a breaking change | Raise `dataVersion` in `config.json`. |
| Show a new version in the menu | Change `siteVersion` in `config.json` (major content changes only). |

Before finishing any change: run `npm run build`; open the app (`npm run dev`, reachable from the phone on the same network) and check that no red banner appears and that swipe, long-press, `+`/`−` and both exports still work; update this README if behaviour, data formats, or storage keys changed. There are no automated tests.

---

## 7. Deployment (GitHub Pages)

1. Push the project to a GitHub repo on the `main` branch.
2. In the repo settings, go to Pages and set Source to **GitHub Actions** (without this the deploy step fails with a 404).
3. `.github/workflows/deploy.yml` (a single job, with pinned action versions) runs on every push to `main` and can be run manually. It installs dependencies with `npm install`, runs `npm run build`, configures Pages, uploads `./dist` and deploys it.
4. Open the resulting URL on the phone. Adding it to the home screen gives a full-screen feel (no PWA manifest or service worker yet).

Since data lives in the browser's `localStorage`, it is tied to the device, browser, and site origin. Clearing site data erases it.

---

## 8. Known limitations and open questions

- `floor` and `management` share `orderId: 16` in `afternoon-1` (see section 4).
- No automatic daypart detection by time of day, as time ranges are undefined.
- No offline support (no service worker). The page works only after being loaded once online, and can fail if the browser evicts its cache with no connection.
- No way to reset a single shift's state from the UI. "Clear website data" wipes everything, and data expires automatically after 7 days.
- Products can only be edited in `src/database.json`. Only weights, yields, the guest count and Adj % (global and per category) can be adjusted in the UI. Default Adj % per category can only be changed in `categories` in `database.json`.
- No undo history beyond tapping a done row to restore it.
- Stock amounts are integers with no per-item units or par levels. Tasks are still plain strings (not ids yet; planned next).
- Most `yield` values and all `code` values are placeholders (`0` / `""`) until filled in by the owner. Category assignments of products were chosen as a first guess and may need correcting.
- The last selected daypart is remembered. Switching dayparts mid-shift is safe because each has separate state.

---

## 9. Roadmap (planned, NOT part of the current scope)

- **External small database** to keep a recap of each day (end-of-day summary of what was completed, resolved, and restocked). The current per-day, per-daypart storage shape is intentionally simple to make syncing or migrating easy. When implemented, `localStorage` should remain the offline-first cache.
- Possible later ideas (only if requested): time-based daypart auto-selection, a "reset shift" action, a PWA manifest and service worker for offline use, per-item par levels.

- **Project rename** (planned by the owner, not done yet): the repo/package name (`mcd-shift-tracker`), the page `<title>` and the README heading still say "Shift Tracker", while `storageName` is already `mcd-shift-companion`. Renaming is done by the owner at another time; do not change `storageName` as part of it (that would orphan the saved data).

Do not implement roadmap items unless explicitly asked.

---

## 10. Rules for contributors / AI assistants

1. **Never rename, translate, or reorder** strings or entries in `structure.json`, or product names in `database.json`, without asking the owner first. Never change a product `id` already in use.
2. Keep all UI text, code, and comments in **English**.
3. Preserve the **mobile-first, one-handed** interaction model. Do not add features that need typing during the shift (the Projection page is the deliberate exception).
4. Keep it lightweight: no heavy frameworks or dependencies unless there is a strong reason.
5. **No legacy or migration code.** When the shape of saved data (or the meaning of a storage key) changes in a breaking way, raise `dataVersion` in `config.json` so old data is wiped, instead of converting it. Raise `siteVersion` only for major content changes. Versions and the storage name live in `config.json`; never hard-code them in `main.js`.
6. **Keep this README in sync** with the code and data files whenever behaviour, data formats, or storage keys change.
7. Ask when in doubt. The owner prefers a question over a guess about restaurant-specific behaviour.
