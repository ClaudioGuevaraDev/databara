import { ChevronLeft, ChevronRight, FileCode2, X } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { cn } from "../../../lib/utils";
import { useI18n } from "../../i18n/I18nContext";
import type { SqlTab } from "../../types";
import { IconButton } from "../ui";
import { useTabReorderDrag } from "./useTabReorderDrag";

export function EditorTabs({
  activeTabId,
  onClose,
  onOfficialize,
  onReorder,
  onSelect,
  tabs,
}: {
  activeTabId: string;
  onClose: (tabId: string) => void;
  onOfficialize: (tabId: string) => void;
  onReorder: (tabId: string, toIndex: number) => void;
  onSelect: (tabId: string) => void;
  tabs: SqlTab[];
}) {
  const { t } = useI18n();
  const scrollViewportRef = useRef<HTMLDivElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const { draggingTabId, getTabHandlers } = useTabReorderDrag({
    onOfficialize,
    onReorder,
    onSelect,
    scrollViewportRef,
    tabs,
  });

  function updateScrollButtons() {
    const viewport = scrollViewportRef.current;
    if (!viewport) {
      setCanScrollLeft(false);
      setCanScrollRight(false);
      return;
    }

    setCanScrollLeft(viewport.scrollLeft > 0);
    setCanScrollRight(viewport.scrollLeft + viewport.clientWidth < viewport.scrollWidth - 1);
  }

  function scrollTabs(direction: "left" | "right") {
    const viewport = scrollViewportRef.current;
    if (!viewport) return;

    viewport.scrollBy({
      behavior: "smooth",
      left: direction === "left" ? -240 : 240,
    });
  }

  useEffect(() => {
    updateScrollButtons();

    const viewport = scrollViewportRef.current;
    if (!viewport) return;
    // While reordering, the drag owns the scroll position (it auto-scrolls at
    // the edges); centering the active tab here would fight it.
    if (draggingTabId) return;

    const activeTabElement = viewport.querySelector<HTMLElement>(`[data-tab-id="${activeTabId}"]`);
    activeTabElement?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeTabId, draggingTabId, tabs]);

  return (
    <div className="chrome-panel hairline flex h-9 min-w-0 shrink-0 items-stretch gap-1 border-b border-border px-1">
      <IconButton
        title={t("workspace.scrollTabsLeft")}
        onClick={() => scrollTabs("left")}
        disabled={!canScrollLeft}
      >
        <ChevronLeft size={15} />
      </IconButton>
      <div className="min-w-0 flex-1 overflow-hidden">
        <div
          ref={scrollViewportRef}
          onScroll={updateScrollButtons}
          className="flex h-full overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {tabs.map((tab) => {
            const isDragging = draggingTabId === tab.id;

            return (
              <div
                key={tab.id}
                data-tab-id={tab.id}
                // Two independent variables feed one transform: React owns the
                // skew of preview tabs, the drag loop owns `--tab-dx`. Composing
                // them in a single inline `transform` would make each overwrite
                // the other.
                style={
                  { "--tab-skew": tab.state === "temporary" ? "-6deg" : "0deg" } as CSSProperties
                }
                {...getTabHandlers(tab.id)}
                className={cn(
                  "group relative flex h-9 max-w-56 shrink-0 select-none items-stretch border-r border-border text-[12.5px]",
                  "[transform:translateX(var(--tab-dx,0px))_skewX(var(--tab-skew,0deg))]",
                  isDragging
                    ? "z-10 shadow-[0_10px_24px_-10px_hsl(var(--primary)/0.6)]"
                    : "transition-transform",
                  activeTabId === tab.id
                    ? "bg-background shadow-[inset_0_2px_0_hsl(var(--primary)),0_-1px_12px_-6px_hsl(var(--primary)/0.5)]"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  tab.state === "temporary" && "border-r-primary/20 bg-muted/30",
                )}
              >
                <button
                  type="button"
                  onClick={() => onSelect(tab.id)}
                  onDoubleClick={() => onOfficialize(tab.id)}
                  className={cn(
                    "flex min-w-0 flex-1 items-center gap-2 px-3 text-left",
                    isDragging ? "cursor-grabbing" : "cursor-grab",
                    tab.state === "temporary" && "skew-x-6",
                  )}
                >
                  <FileCode2
                    size={14}
                    className={cn(
                      "shrink-0",
                      activeTabId === tab.id && "text-primary",
                      tab.state === "temporary" && "opacity-75",
                    )}
                  />
                  <span className={cn("truncate", tab.state === "temporary" && "italic")}>
                    {tab.label}
                  </span>
                  {tab.dirty ? <span className="h-1.5 w-1.5 rounded-full bg-primary" /> : null}
                </button>
                <button
                  type="button"
                  title={t("workspace.closeTab", { label: tab.label })}
                  onClick={() => onClose(tab.id)}
                  className={cn(
                    "flex w-8 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-foreground",
                    activeTabId === tab.id ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                    tab.state === "temporary" && "skew-x-6",
                  )}
                >
                  <X size={13} />
                </button>
              </div>
            );
          })}
        </div>
      </div>
      <IconButton
        title={t("workspace.scrollTabsRight")}
        onClick={() => scrollTabs("right")}
        disabled={!canScrollRight}
      >
        <ChevronRight size={15} />
      </IconButton>
    </div>
  );
}
