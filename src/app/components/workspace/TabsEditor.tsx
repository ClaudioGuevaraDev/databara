import { type EditorProps, type Monaco, type OnMount } from "@monaco-editor/react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { resolveEditorTheme } from "../../editor/databaraTheme";
import { registerSqlCompletionProvider } from "../../editor/sqlCompletion";
import type { DatabaseObjectDetails } from "../../types";
import { useSettings, useSqlEditor } from "../../workspace/workspaceCore";
import { EditorTabs } from "./EditorTabs";
import { EmptyEditor } from "./EmptyEditor";
import { QueryToolbar } from "./QueryToolbar";

// Monaco and its editor contributions are ~3.6 MB: loaded as a separate chunk so
// the workspace paints without waiting for them to be parsed.
const MonacoSqlEditor = lazy(() => import("./MonacoSqlEditor"));

// Same blank surface Monaco itself shows while it initialises, so the hand-off
// between the chunk loading and the editor mounting isn't visible.
const editorFallback = <div className="h-full w-full bg-background" />;

// Hoisted: an inline object literal makes the wrapper call
// `editor.updateOptions(...)` on every render — i.e. on every keystroke, since
// typing updates workspace state — which re-validates every option.
const BASE_EDITOR_OPTIONS: NonNullable<EditorProps["options"]> = {
  automaticLayout: true,
  bracketPairColorization: { enabled: true },
  contextmenu: false,
  cursorBlinking: "smooth",
  cursorSmoothCaretAnimation: "on",
  fontFamily: "JetBrains Mono, Cascadia Code, Consolas, monospace",
  fontLigatures: true,
  glyphMargin: false,
  guides: { bracketPairs: "active", indentation: true },
  lineNumbersMinChars: 3,
  minimap: { enabled: false },
  overviewRulerBorder: false,
  overviewRulerLanes: 0,
  padding: { bottom: 18, top: 18 },
  renderLineHighlight: "all",
  roundedSelection: true,
  scrollBeyondLastLine: false,
  scrollbar: {
    horizontalScrollbarSize: 14,
    useShadows: false,
    verticalScrollbarSize: 14,
  },
  smoothScrolling: true,
  wordWrap: "on",
};

export function TabsEditor() {
  const editor = useSqlEditor();
  const { settings } = useSettings();
  const editorFontSize = settings.editorFontSize.size;
  const themePreference = settings.theme.preference;

  // Match the editor theme to the app's effective theme. For "system" we track
  // the OS `prefers-color-scheme` so the editor re-themes live with the app.
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  useEffect(() => {
    if (themePreference !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystemDark(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [themePreference]);
  const isDark = themePreference === "dark" || (themePreference === "system" && systemDark);
  const editorTheme = resolveEditorTheme(isDark);
  const selectedObjectRef = useRef<DatabaseObjectDetails | null>(editor.completionObject);
  const runQueryRef = useRef(editor.runQuery);
  const saveActiveSqlTabRef = useRef(editor.saveActiveSqlTab);
  const monacoRef = useRef<Monaco | null>(null);
  const completionProviderRef = useRef<ReturnType<
    Monaco["languages"]["registerCompletionItemProvider"]
  > | null>(null);

  const editorOptions = useMemo(
    () => ({
      ...BASE_EDITOR_OPTIONS,
      fontSize: editorFontSize,
      lineHeight: Math.round(editorFontSize * 1.6),
    }),
    [editorFontSize],
  );

  useEffect(() => {
    selectedObjectRef.current = editor.completionObject;
  }, [editor.completionObject]);

  useEffect(() => {
    runQueryRef.current = editor.runQuery;
    saveActiveSqlTabRef.current = editor.saveActiveSqlTab;
  }, [editor.runQuery, editor.saveActiveSqlTab]);

  useEffect(() => {
    return () => {
      completionProviderRef.current?.dispose();
    };
  }, []);

  const handleEditorMount = useCallback<OnMount>((monacoEditor, monaco) => {
    monacoRef.current = monaco;
    completionProviderRef.current?.dispose();
    completionProviderRef.current = registerSqlCompletionProvider(monaco, () => ({
      selectedObject: selectedObjectRef.current,
    }));

    monacoEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      runQueryRef.current();
    });
    monacoEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      void saveActiveSqlTabRef.current();
    });
  }, []);

  const { updateActiveSql } = editor;
  const handleChange = useCallback(
    (value: string | undefined) => {
      updateActiveSql(value ?? "");
    },
    [updateActiveSql],
  );

  // One model per tab (see the `path` prop) means a closed tab's model would
  // otherwise stay in Monaco's registry for the rest of the session: the wrapper
  // only ever disposes the one currently attached.
  const openTabIds = editor.sqlTabs.map((tab) => tab.id).join("\n");
  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco) return;
    const openUris = new Set(
      openTabIds ? openTabIds.split("\n").map((id) => monaco.Uri.parse(id).toString()) : [],
    );
    for (const model of monaco.editor.getModels()) {
      if (!openUris.has(model.uri.toString())) model.dispose();
    }
  }, [openTabIds]);

  return (
    <>
      <EditorTabs
        activeTabId={editor.activeTabId}
        onClose={editor.closeSqlTab}
        onOfficialize={editor.officializeSqlTab}
        onReorder={editor.reorderSqlTabs}
        onSelect={editor.selectSqlTab}
        tabs={editor.sqlTabs}
      />
      <QueryToolbar
        canSave={Boolean(
          editor.activeTab && (editor.activeTab.state === "temporary" || editor.activeTab.dirty),
        )}
        isRunning={editor.isRunning}
        onRun={editor.runQuery}
        onSave={() => void editor.saveActiveSqlTab()}
      />
      <section className="min-h-0 flex-1 bg-background">
        {editor.activeTab ? (
          <Suspense fallback={editorFallback}>
            <MonacoSqlEditor
              path={editor.activeTab.id}
              value={editor.activeTab.sql}
              theme={editorTheme}
              onChange={handleChange}
              onMount={handleEditorMount}
              options={editorOptions}
            />
          </Suspense>
        ) : (
          <EmptyEditor />
        )}
      </section>
    </>
  );
}
