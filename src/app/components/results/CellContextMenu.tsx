import { Copy, Table2, TextSelect } from "lucide-react";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18nContext";
import { formatCombo } from "../../keyboardTokens";

const MENU_MARGIN = 8;

// Right-click menu for the results grid. The app blocks the native context menu
// globally (WorkspaceApp), so this is the only menu the grid can offer. It is
// positioned at the pointer and clamped so it never falls outside the window.
export function CellContextMenu({
  x,
  y,
  onClose,
  onCopy,
  onCopyWithHeaders,
  onSelectAll,
}: {
  x: number;
  y: number;
  onClose: () => void;
  onCopy: () => void;
  onCopyWithHeaders: () => void;
  onSelectAll: () => void;
}) {
  const { t } = useI18n();
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  // Measure once mounted: flip the menu back inside the viewport if the pointer
  // was near the right/bottom edge.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const { width, height } = menu.getBoundingClientRect();
    setPosition({
      left: Math.max(MENU_MARGIN, Math.min(x, window.innerWidth - width - MENU_MARGIN)),
      top: Math.max(MENU_MARGIN, Math.min(y, window.innerHeight - height - MENU_MARGIN)),
    });
  }, [x, y]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  const run = (action: () => void) => () => {
    onClose();
    action();
  };

  return (
    <div
      ref={menuRef}
      role="menu"
      style={{ left: position.left, top: position.top }}
      className="fixed z-30 w-56 rounded-lg border border-border bg-[hsl(var(--panel-soft))] p-1 shadow-[0_12px_28px_hsl(var(--shadow-strong)/0.4)]"
    >
      <MenuItem
        icon={<Copy size={13} className="text-primary" />}
        label={t("results.copyCells")}
        hint={formatCombo(["Mod", "C"])}
        onClick={run(onCopy)}
      />
      <MenuItem
        icon={<Table2 size={13} className="text-primary" />}
        label={t("results.copyCellsWithHeaders")}
        onClick={run(onCopyWithHeaders)}
      />
      <MenuItem
        icon={<TextSelect size={13} className="text-primary" />}
        label={t("results.selectAllCells")}
        hint={formatCombo(["Mod", "A"])}
        onClick={run(onSelectAll)}
      />
    </div>
  );
}

function MenuItem({
  icon,
  label,
  hint,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex h-7 w-full items-center gap-2 rounded px-2 text-left text-[12px] text-foreground transition-colors hover:bg-muted"
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint ? <span className="shrink-0 text-[11px] text-muted-foreground">{hint}</span> : null}
    </button>
  );
}
