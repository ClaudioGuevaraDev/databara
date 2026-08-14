# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Databara is a Tauri v2 desktop database client: a React 19 + TypeScript frontend (Vite, Tailwind, Monaco editor) over a Rust backend that talks to PostgreSQL (`tokio-postgres`), MySQL/MariaDB, SQL Server (`tiberius`) and SQLite (`rusqlite`).

> `AGENTS.md` is the source of truth for contribution rules; the key points are summarized below. Use **pnpm only**, and keep dependency versions in `package.json` **exact** (no `^`/`~` ranges).

## Commands

```bash
pnpm run dev          # Vite frontend only, port 1420 (browser; no Tauri/DB access)
pnpm run tauri:dev    # full desktop app (frontend + Rust backend) — needed to exercise DB features
pnpm run build        # tsc typecheck + vite build (produces dist/)
pnpm run lint         # tsc --noEmit + eslint .
pnpm run format:check # prettier verification
```

There is **no test framework**. The validation gate for any change is: `pnpm run lint`, `pnpm run format:check`, `pnpm run build`, and `cargo check` (run inside `src-tauri/`).

`scripts/seed-postgres.sql` seeds a local database for manual testing.

## Coding conventions

- **TypeScript strict mode.** Use explicit types for shared/cross-boundary data structures. Avoid `any` unless there is a narrow, documented reason.
- **React function components only.** One component per `.tsx` file — if a file grows a second component, extract it to its own file.
- **Layering:** keep UI, domain logic, and data access separated. Components and the workspace context must **not** call database drivers or `invoke` directly — all data access goes through `databaraService.ts` → Tauri commands → Rust services (see Architecture below).
- **Naming:** `PascalCase` for components and component files (`PascalCase.tsx`); `camelCase` for hooks, utilities, and helper files (`camelCase.ts`).
- **Formatting is Prettier-controlled:** 2 spaces, semicolons, double quotes, 100-char print width, Tailwind class sorting. Run `pnpm run format` before large UI changes.

## Commits & security

- Use Conventional Commit messages (e.g. `feat: add connection dialog layout`, `fix: ignore tauri target in vite watcher`, `chore: configure prettier`). PRs should include a short summary, screenshots for UI changes, and the validation commands run.
- **Bump the app version on every `/conventional-commit`.** When the user asks to run `/conventional-commit`, bump the version `A.B.C` as part of that commit (stage the bumped files together with the change so it ships in the same commit). **Never increase `A`** (major stays fixed). Increase `B` (minor) — resetting `C` to `0` — for `feat` commits; otherwise increase `C` (patch). Use judgment for mixed changes. Keep the version byte-for-byte identical across all declaration sites: `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and the `name = "databara"` entry in `src-tauri/Cargo.lock`. There are no hardcoded version strings in the frontend (the StatusBar reads the latest GitHub release at runtime), so no UI edits are needed. See `RELEASING.md` for the release checklist.
- Never commit credentials, local database URLs, build output, or logs. Connection passwords live only in transient frontend state and are never persisted (the long-term plan is the OS keychain, never plain text — see Persistence below).

## Architecture

### Frontend ↔ backend boundary

All communication with the Rust backend funnels through **`src/app/databaraService.ts`** — the only file that calls Tauri's `invoke`. Components and the workspace context never invoke commands directly. This service also normalizes types crossing the boundary: the backend reports `engine: "PostgreSQL"`, which is normalized to the frontend's `"postgresql"` `DatabaseEngine`, and server tree-node IDs are rewritten to embed the engine.

The Rust side exposes these commands (registered in `src-tauri/src/lib.rs` via `generate_handler!`): `test_postgres_connection`, `connect_postgres`, `store_connection_password`, `get_connection_password`, `delete_connection_password`, `list_postgres_tree`, `get_postgres_object_details`, `run_postgres_query`, `set_unsaved_sql_tabs`, `close_main_window_after_unsaved_resolution`, `updates_supported`, `complete_startup`, `write_text_file`, `read_text_file`, `backup_database`.

### Rust backend (`src-tauri/src/`)

- `lib.rs` is a thin layer: the `#[tauri::command]` functions plus the `tauri::Builder`. All database work lives in `engine/`.
- `engine/mod.rs` owns the dispatch. `DbSession` is an enum over the four drivers (`Postgres`, `Sqlite`, `MySql`, `Mssql`) and its `list_tree` / `object_details` / `run_query` / `backup` methods `match self` into the per-engine module. `engine::connect` resolves a draft into the right config and opens the session.
- `AppState` (a `Mutex<AppState>` managed by Tauri) holds `sessions: HashMap<String, Session>` keyed by connection ID, plus the unsaved-tabs flag and a close-override flag. `engine::session()` clones the handle out and releases the lock, so no query runs while the mutex is held.
- Each engine module builds its tree from its own catalog in **one query** (`postgres.rs` from `pg_catalog`, `mysql.rs` from `information_schema`, `mssql.rs` from `sys.tables`/`sys.views`, `sqlite.rs` from `sqlite_master`) and returns a single root `server:` node → database → schemas → objects, with `children: None` on the leaves. Columns, indexes and the row count are _not_ in the tree — they are loaded per object by `object_details`, whose three queries run concurrently (`futures_util::try_join!` in `postgres.rs`).
- Row counts are catalog estimates (`reltuples`, `information_schema.table_rows`, `sys.partitions`); SQLite has no such statistic and does a real `COUNT(*)` (measured: ~55 ms for 5M rows).
- Object IDs are strings like `table:schema.name` / `view:schema.name`, parsed by `parse_object_id` in `engine/types.rs`.

### Frontend state: the Workspace context

Nearly all app state lives in one provider, **`src/app/workspace/workspaceContext.tsx`** (`WorkspaceProvider`). It is split deliberately across three files:

- `workspaceCore.ts` — context type definitions plus the per-area hooks (`useExplorer`, `useSqlEditor`, `useResults`, `useObjectDetailsPanel`, `useDialogs`, etc.). Components read through these, not the raw context.
- `workspaceContext.tsx` — the provider implementation (all `useState`/`useCallback` logic).
- `workspaceContext.utils.ts` / `workspaceSqlTabs.ts` — pure helpers for tree merging, connection keys, and SQL-tab persistence.

**There are two contexts.** `WorkspaceContext` carries `state` + `meta`, which change on nearly every interaction; `WorkspaceActionsContext` carries the actions as a set of forwarders built once, so its identity never changes. The per-area hooks above are _shaping conveniences_ — they read the whole state context and return a fresh object, so they do **not** narrow re-renders. Anything rendered once per row must take its callbacks from `useWorkspaceActions()` instead (see Rendering performance below).

When adding an action, add it to the `WorkspaceActions` type, implement it in `actionsImpl`, and add a matching forwarder in the `actions` `useMemo`. TypeScript enforces that the forwarder object is complete.

When adding state or actions, extend the `WorkspaceState`/`WorkspaceActions` types in `workspaceCore.ts`, implement in the provider, and expose via the relevant selector hook.

### Persistence (localStorage, not the backend)

Saved connection drafts and per-connection SQL tabs are persisted in **`window.localStorage`** under versioned keys (`databara.connections.v1`, `databara.sqlTabs.v1:<connectionKey>`). Both loaders include migration paths from legacy keys. Tab writes are **debounced** (500 ms) and skipped when the serialized payload is unchanged — only _saved_ SQL is persisted, so typing produces identical bytes; explicit saves and the close flow flush immediately (`flushSqlTabsPersistence`). **Passwords are never persisted** — `StoredConnectionDraft` omits `password`, and reconnecting a saved connection prompts for it (`PasswordConnectionDialog`).

### SQL tabs: temporary vs official

Tabs have a `state` of `"temporary"` or `"official"` (VS Code "preview tab" pattern). Single-clicking an object opens/reuses a temporary tab; confirming (double-click) "officializes" it. Only official tabs are persisted. The officialize/merge logic lives in `workspaceSqlTabs.ts` (`officializeSqlTab`).

> **SQL execution is implemented.** `runQuery` runs the active tab's SQL via the `run_postgres_query` command (which uses `query_raw` to also report `rowsAffected`/`commandTag`) and renders rows in the results grid — for SELECT/WITH and for any statement that returns rows (e.g. `RETURNING`); non-row statements show a status message like "DELETE · 3 rows affected" (`formatCommandMessage`). Read queries are paginated at the SQL level: the helpers in `workspaceContext.utils.ts` (`isReadQuery`, `normalizeBaseSql`, `buildCountSql`, `buildPageSql`) wrap the query as a subquery and fetch each page with `LIMIT`/`OFFSET` (default 50; footer `ResultsFooter.tsx`). The `COUNT(*)` that produces the exact total runs **concurrently with the first page, never before it** — on a large table it scans the whole result set, and making the rows wait for it was the single slowest thing about running a query. Until it lands, `QueryPagination.totalRows` is `null`, the footer shows the totals as pending and disables the controls that need bounds; `applyTotalRows` then fills it in, guarded by a per-tab run token so a late count can't overwrite a newer run. A first page shorter than the page size _is_ the whole result, so the total is exact without waiting. **Query results are per-tab**: the provider keeps a `resultsByTab` map keyed by SQL-tab id (in-memory, never persisted); `useResults` exposes the active tab's `queryState`/`queryResult`/`queryPagination`/`queryError`. Errors render inline in the Results section; all `notify(...)` calls surface through the `Toaster` (`components/ui/Toaster.tsx`, mounted in `WorkspaceShell`) reading `state.toast`. Cell values cross the boundary as strings, converted per engine (`format_cell` in `postgres.rs`, `value_to_string` in `mysql.rs`/`sqlite.rs`, `cell_to_string` in `mssql.rs`; NULL → `None`). `previewObject` is still a stub.

### Multi-engine abstraction

Five engines ship: `postgresql`, `mysql`, `mariadb`, `sqlite`, `mssql` (MariaDB reuses the MySQL driver). The `connectionEngines.ts` registry holds each one's connection kind, default port, SSL modes and form placeholders; `ensureSupportedConnectionEngine` throws for anything absent from it. The `postgres`-flavoured command names (`connect_postgres`, `run_postgres_query`, …) are historical — they dispatch on the engine, so don't read them as PostgreSQL-only.

### Unsaved-tabs-on-close flow

Closing the window with dirty tabs is intercepted in Rust (`on_window_event` → `prevent_close`), which dispatches a `databara-unsaved-tabs-close-requested` DOM event. The frontend listens for it (and Tauri's `onCloseRequested`) to show `UnsavedTabsDialog`; resolving calls `close_main_window_after_unsaved_resolution`, which sets the close-override flag and closes the window.

### Startup / splash window

There are two windows declared in `tauri.conf.json`: `main` (the app, started with `"visible": false`) and `splash` (`splash.html` + `src/splash/main.ts`, a self-contained loading screen where the Databara logo doubles as the loader — it fills bottom-up with the real startup percentage while rings spin around it). On launch the splash shows while the hidden main window does its slow startup work: saved connections reconnect **in parallel** (concurrency 4 — serially, the splash lasted the _sum_ of every connection's latency and one unreachable host blocked the rest), with focus and tab restoring applied afterwards in list order so the end state stays deterministic. The update check runs alongside but does **not** gate the reveal (it is a request to GitHub, bounded by an 8 s timeout); if an update turns up, its dialog opens over the already-visible window. The main window emits real progress (`emitStartupProgress` → `databara://startup-progress` event); the splash listens and eases its meter toward it (its own capability `src-tauri/capabilities/splash.json` grants `core:event:default`). When that work settles — or an update is found, or a safety timeout fires — `WorkspaceProvider` calls `completeStartup()` (→ `complete_startup` command), which closes the splash and shows/focuses the main window, so it appears already populated instead of painting in connections one by one. The splash is a second Vite entry point (`vite.config.ts` `rollupOptions.input`); its logo lives at `public/databara-logo.png`.

### Component layout

`src/app/components/` groups UI by area: `explorer/` (DB tree sidebar), `workspace/` (editor + tabs + Monaco), `results/` (data grid, schema/columns views), `object-details/`, `dialogs/`, `layout/`, and reusable primitives in `ui/`. Tailwind theming uses CSS-variable tokens (`background`, `foreground`, `primary`, `muted`, `destructive`) defined in `src/styles/globals.css`.

`src/app/editor/` holds the Monaco pieces: `monacoSetup.ts` (bundles Monaco locally and registers its worker), `sqlCompletion.ts` (SQL autocompletion) and `databaraTheme.ts`.

### Rendering performance (invariants worth preserving)

Render cost was deliberately decoupled from the size of the schema and of the result page. These invariants are what make that hold — each one is easy to undo by accident, and undoing any of them brings the jank back:

- **Rows come from a flat list, not recursion.** `explorerRows.ts` walks the tree once and emits `ExplorerRow[]` with everything resolved (depth, owning connection, collapsed, …), carrying the ancestor server/connection down with it. No row may search the tree for its own context — that was an O(databases × nodes) cost per render.
- **`React.memo` on anything rendered per row** (`ExplorerRow`, `DataGridRow`), with primitive props only. A fresh object or an inline callback per row defeats it. Row-level selection state is passed as booleans/indices, never as the shared `Set`/range object.
- **Callbacks for those rows come from `useWorkspaceActions()`**, never from the state context.
- **No `cn()` in per-row or per-cell code.** `cn` is `twMerge(clsx(...))`, and tailwind-merge tokenizes and conflict-resolves the entire class string. Rows use precomputed constants (`ExplorerRow.tsx`, `DataGridRow.tsx`) whose variants don't overlap, so there is nothing to merge. Keep `cn` for components that accept `className` from props.
- **Cell events are delegated on `<tbody>`** and resolved from `data-cell`, instead of three handlers per cell.
- **Both long lists are virtualized** with `@tanstack/react-virtual`: the explorer over its flat list, and the grid rows via spacer `<tr>`s that keep the sticky `<thead>` working. Both override `measureElement` to use **`offsetHeight`**, not `getBoundingClientRect()`: the app scales the whole webview with CSS `zoom` (50–200%, `ZOOM_MIN`/`ZOOM_MAX`), which makes rects report visual pixels while `scrollTop` stays in layout pixels — mixing the two spaces makes the list drift as you scroll. Columns are _not_ virtualized on purpose (measured ~40 ms for 200 columns, against losing content-based column widths in the common case).
- **Monaco is bundled, not fetched from a CDN, and code-split.** `monacoSetup.ts` calls `loader.config({ monaco })`; without it `@monaco-editor/react` downloads Monaco from jsdelivr at runtime and the editor simply doesn't work offline. It is imported only from `MonacoSqlEditor.tsx`, which `TabsEditor` loads through `React.lazy` — importing it from an eagerly-loaded module puts 3.7 MB back into the main chunk.
- **Editor options are a hoisted constant**, not an inline literal: the wrapper calls `editor.updateOptions()` whenever the `options` prop changes identity, i.e. on every keystroke.
- **Tabs are switched with the `path` prop, not `key`.** `key` tears down and recreates the editor (losing the model, undo history and scroll); `path` keeps one model per tab and restores its view state. Models of closed tabs are disposed explicitly in `TabsEditor`.

React DevTools' "Highlight updates" is the quickest check: typing in the SQL editor must not flash the sidebar rows or the grid. Measure on a release build — `React.StrictMode` doubles renders in development, and `@tanstack/react-virtual` logs a `flushSync` warning that only exists in React's development build.
