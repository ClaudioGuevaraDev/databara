<div align="center">

<img src="src-tauri/icons/128x128@2x.png" width="128" alt="databara logo" />

# Databara

**A modern, lightweight desktop database client for PostgreSQL, MySQL/MariaDB, SQL Server and SQLite.**

Built with [Tauri](https://tauri.app), [React](https://react.dev) and [Rust](https://www.rust-lang.org) — fast, native, and easy on the eyes.

[![Download](https://img.shields.io/github/v/release/ClaudioGuevaraDev/databara?include_prereleases&label=download&color=0DC6D3)](https://github.com/ClaudioGuevaraDev/databara/releases)
[![Platforms](https://img.shields.io/badge/platforms-Windows%20%7C%20macOS%20%7C%20Linux-0DC6D3)](https://github.com/ClaudioGuevaraDev/databara/releases)
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%20v2-24C8DB)](https://tauri.app)

</div>

---

## ✨ Features

- 🗄️ **Five engines, one client** — PostgreSQL, MySQL, MariaDB and SQL Server over plain, Prefer or Require TLS; SQLite by picking a file.
- 🌲 **Schema explorer** — browse server → database → schema → tables and views, filter the tree by name, and inspect an object's columns, indexes and estimated row count. Each engine is read from its own catalog (`pg_catalog`, `information_schema`, `sys.tables`, `sqlite_master`).
- 📝 **SQL editor with autocompletion** — Monaco, completing keywords, types, functions and the selected object's columns. Unquoted camelCase identifiers that the server folds to lowercase are re-run quoted, automatically.
- 🔢 **Paginated results, four ways** — a spreadsheet-style grid with range selection and TSV copy, plus JSON, Columns and Schema (DDL) views. Run `SELECT`/`WITH` (and `RETURNING`) and page through the rows; other statements report the rows affected.
- 📤 **Get data out** — export the current page or the whole result set as CSV or JSON, or copy cells, JSON and DDL straight to the clipboard.
- 🗂️ **Per-tab, multi-connection workspace** — every query tab keeps its own results, across all your connected databases at once.
- 💾 **Saved connections** — connections and settings persist locally; passwords are handled explicitly (see the note below).
- 🧰 **Backups and portable settings** — write a `.sql` dump of a database with live progress (PostgreSQL and SQLite), and export or import your whole configuration as a single JSON file.
- 🎨 **Yours to adjust** — dark, light or system theme; 9 interface languages (English, Spanish, French, German, Brazilian Portuguese, Italian, Simplified Chinese, Japanese, Russian); 50–200% zoom, editor font size, notification placement, and resizable panels.
- ⌨️ **Keyboard-first** — shortcuts for running and saving queries, switching tabs, paging results, copying and zooming, all listed in-app.
- ⚡ **Built for big schemas** — the tree and the results grid are virtualized, and the row-count query no longer blocks the first page from rendering.
- 🔄 **Updates in-app** — Databara checks for new releases on launch and installs them with a progress dialog.

> [!IMPORTANT]
> **Where passwords live.** By default they are **not** persisted: they stay in memory for the session and are prompted again when you reconnect. Two opt-ins change that — enabling **"keep connections active"** stores them in your OS keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service) so saved connections reconnect on startup, and enabling **"include passwords"** when exporting your configuration writes them **in plaintext** into that JSON file. Both are off unless you turn them on.

## ⬇️ Download

Grab the latest installer for your OS from the [**Releases page**](https://github.com/ClaudioGuevaraDev/databara/releases):

| OS          | File                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------ |
| **Windows** | `Databara_x.y.z_x64-setup.exe`                                                             |
| **macOS**   | `Databara_x.y.z_universal.dmg` (Intel + Apple Silicon)                                     |
| **Linux**   | `Databara_x.y.z_amd64.AppImage`, `Databara_x.y.z_amd64.deb`, `Databara-x.y.z-1.x86_64.rpm` |

> [!NOTE]
> The installers are currently **unsigned**. On first launch:
>
> - **macOS** → right-click the app → **Open** (or run `xattr -dr com.apple.quarantine /Applications/Databara.app`).
> - **Windows** → SmartScreen → **More info → Run anyway**.
>
> On Linux, in-app updates only work from the **AppImage** — `.deb` and `.rpm` installs live in root-owned system paths, so Databara points you to the release page instead.

## 🛠️ Tech stack

| Layer    | Technology                                                                               |
| -------- | ---------------------------------------------------------------------------------------- |
| Frontend | React 19 · TypeScript · Vite · Tailwind CSS · Monaco Editor · TanStack Virtual           |
| Backend  | Rust · Tauri v2 · `tokio-postgres` · `mysql_async` · `tiberius` · `rusqlite` · `keyring` |
| Tooling  | pnpm · ESLint · Prettier                                                                 |

## 🚀 Development

> Requires [Node.js](https://nodejs.org), [pnpm](https://pnpm.io) and the [Rust toolchain](https://rustup.rs) + your platform's [Tauri prerequisites](https://tauri.app/start/prerequisites/).

```bash
# Install dependencies
pnpm install

# Run the full desktop app (frontend + Rust backend)
pnpm run tauri:dev

# Frontend only, in the browser (no DB access)
pnpm run dev
```

`scripts/seed-postgres.sql` seeds a local PostgreSQL database for manual testing.

### Validation gate

```bash
pnpm run lint          # tsc --noEmit + eslint
pnpm run format:check  # prettier
pnpm run build         # tsc typecheck + vite build
cd src-tauri && cargo check
```

## 📦 Building installers

```bash
pnpm tauri build             # native installers for the current OS
pnpm tauri build --no-bundle # just the executable, no installers
```

Cross-platform installers are produced automatically by GitHub Actions when a `v*` tag is pushed — see [`RELEASING.md`](RELEASING.md) for the full release flow.

## 🏗️ Architecture

All frontend ↔ backend communication funnels through a single service (`src/app/databaraService.ts`) into a small set of Rust commands, and app state lives in one workspace context provider. On the Rust side, `src-tauri/src/lib.rs` is a thin command layer over `src-tauri/src/engine/`, where an enum dispatches every operation to the matching driver. For the full picture — including the invariants that keep rendering fast — see [`AGENTS.md`](AGENTS.md) and [`CLAUDE.md`](CLAUDE.md).

## 🤝 Contributing

Use **pnpm only** and keep dependency versions **exact** (no `^`/`~`). Commits follow [Conventional Commits](https://www.conventionalcommits.org). Run the validation gate above before opening a PR.

## 📄 License

Released under the [MIT License](LICENSE) © 2026 Claudio Guevara.
