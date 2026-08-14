import Editor, { type EditorProps, type OnMount } from "@monaco-editor/react";
import { defineDatabaraTheme } from "../../editor/databaraTheme";
// Side effect: points Monaco at the bundled copy instead of the jsdelivr CDN.
// Importing it from here (rather than from `TabsEditor`) is what keeps Monaco out
// of the main bundle — this module is the lazy boundary.
import "../../editor/monacoSetup";

/**
 * The Monaco surface, isolated so it can be code-split.
 *
 * Monaco plus its editor contributions is ~3.6 MB of JavaScript. Kept in the main
 * chunk it had to be parsed before the window could paint; behind `React.lazy` it
 * loads as its own chunk while the rest of the workspace is already interactive.
 *
 * The tab strip and toolbar deliberately stay in `TabsEditor` (eager) so they
 * don't pop in a moment later than the rest of the UI.
 */
export default function MonacoSqlEditor({
  onChange,
  onMount,
  options,
  path,
  theme,
  value,
}: {
  onChange: (value: string | undefined) => void;
  onMount: OnMount;
  options: EditorProps["options"];
  path: string;
  theme: string;
  value: string;
}) {
  return (
    <Editor
      // `path` (instead of `key`) switches models without tearing the editor
      // down: the wrapper keeps one model per path and saves/restores each one's
      // view state, so undo history, cursor and scroll survive a tab switch.
      path={path}
      defaultLanguage="sql"
      loading={<div className="h-full w-full bg-background" />}
      value={value}
      theme={theme}
      beforeMount={defineDatabaraTheme}
      onChange={onChange}
      onMount={onMount}
      options={options}
    />
  );
}
