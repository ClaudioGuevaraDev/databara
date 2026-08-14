import { loader } from "@monaco-editor/react";
// All editor features (find/replace, suggest widget, bracket matching, folding,
// multi-cursor, …) plus the codicon fonts. This is `editor.main` minus the
// language services (TypeScript, JSON, CSS, HTML) and minus the ~90 basic
// languages we don't use.
import "monaco-editor/esm/vs/editor/editor.all.js";
// Command palette / go-to-line / help overlays, which `editor.all` leaves out.
import "monaco-editor/esm/vs/editor/standalone/browser/quickAccess/standaloneCommandsQuickAccess.js";
import "monaco-editor/esm/vs/editor/standalone/browser/quickAccess/standaloneGotoLineQuickAccess.js";
import "monaco-editor/esm/vs/editor/standalone/browser/quickAccess/standaloneHelpQuickAccess.js";
// The only language this app edits.
import "monaco-editor/esm/vs/basic-languages/sql/sql.contribution.js";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";

/**
 * Serves Monaco from the app bundle instead of jsdelivr.
 *
 * `@monaco-editor/react`'s default loader fetches Monaco (and its workers) from
 * `https://cdn.jsdelivr.net` at runtime, which means the SQL editor waited on the
 * network the first time a tab opened — and simply never loaded offline. Passing
 * our own instance to `loader.config` short-circuits that entirely.
 *
 * Importing this module performs the setup; do it before the first `<Editor>`
 * renders.
 */
window.MonacoEnvironment = {
  // Base worker only: no language services are registered, so there is nothing
  // else to route by label.
  getWorker: () => new editorWorker(),
};

loader.config({ monaco });

export { monaco };
