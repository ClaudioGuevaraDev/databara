import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { flushSync } from "react-dom";
import type { SqlTab } from "../../types";

// Pointer-driven reordering for the editor tab strip, modelled on Chrome's tab
// bar. HTML5 drag & drop is avoided on purpose: its native drag image renders
// inconsistently across the webviews Tauri uses (WebKitGTK, WebView2,
// WKWebView).
//
// Two rules keep the gesture smooth. Offsets are written straight to the DOM as
// a CSS variable from a single rAF loop, so a drag never re-renders React; and
// every workspace action (reorder, officialize, select) is deferred to the drop,
// so the app — Monaco included — never re-renders mid-gesture.

// Pointer travel before a press turns into a drag. Keeps click (select) and
// double-click (officialize) intact.
const DRAG_THRESHOLD_PX = 4;
// Distance from a viewport edge that starts auto-scrolling, and its speed.
const AUTO_SCROLL_EDGE_PX = 32;
const AUTO_SCROLL_STEP_PX = 14;
// How long the released tab takes to glide into its slot.
const SETTLE_MS = 150;

type TabBox = { element: HTMLElement; id: string; left: number; width: number };

type Gesture = {
  active: boolean;
  boxes: TabBox[];
  index: number;
  pointerClientX: number;
  pointerId: number;
  startClientX: number;
  startContentX: number;
  tabId: string;
  targetIndex: number;
  viewportLeft: number;
};

export function useTabReorderDrag({
  onOfficialize,
  onReorder,
  onSelect,
  scrollViewportRef,
  tabs,
}: {
  onOfficialize: (tabId: string) => void;
  onReorder: (tabId: string, toIndex: number) => void;
  onSelect: (tabId: string) => void;
  scrollViewportRef: RefObject<HTMLDivElement | null>;
  tabs: SqlTab[];
}) {
  const gestureRef = useRef<Gesture | null>(null);
  const frameRef = useRef<number | null>(null);
  // Set on release after a real drag so the trailing click doesn't select the
  // tab — or, worse, close it when the pointer lands on the close button.
  const suppressClickRef = useRef(false);
  // Pending landing: the closure that applies the drop, and its timer.
  const settleRef = useRef<(() => void) | null>(null);
  const settleTimerRef = useRef<number | null>(null);
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null);

  // Snapshot of every tab's layout box in the scroller's content coordinates.
  // Widths come from `offsetWidth` and the skew of preview tabs is subtracted
  // from the rect, so a skewed tab measures like an unskewed one.
  const measure = useCallback((): TabBox[] => {
    const viewport = scrollViewportRef.current;
    if (!viewport) return [];

    const viewportLeft = viewport.getBoundingClientRect().left;
    const boxes: TabBox[] = [];
    for (const tab of tabs) {
      const element = viewport.querySelector<HTMLElement>(`[data-tab-id="${tab.id}"]`);
      if (!element) return [];

      const rect = element.getBoundingClientRect();
      const width = element.offsetWidth;
      boxes.push({
        element,
        id: tab.id,
        left: rect.left + (rect.width - width) / 2 - viewportLeft + viewport.scrollLeft,
        width,
      });
    }
    return boxes;
  }, [scrollViewportRef, tabs]);

  // Places the dragged tab under the pointer, decides which slot it now owns,
  // and slides the tabs it displaced. Runs once per frame, never per event.
  const applyOffsets = useCallback(
    (gesture: Gesture) => {
      const viewport = scrollViewportRef.current;
      if (!viewport) return;

      const { boxes, index } = gesture;
      const box = boxes[index];
      const first = boxes[0];
      const last = boxes[boxes.length - 1];
      const contentX = gesture.pointerClientX - gesture.viewportLeft + viewport.scrollLeft;

      // Where the dragged tab sits now, kept inside the strip's bounds.
      const left = Math.min(
        Math.max(box.left + (contentX - gesture.startContentX), first.left),
        last.left + last.width - box.width,
      );

      // Chrome's rule: a neighbour yields as soon as the dragged tab's leading
      // edge crosses its midpoint — half a tab of travel, not a whole one.
      // Evaluated against the original layout, and monotonic in the offset, so
      // tabs can't oscillate at the boundary.
      let targetIndex = index;
      for (let other = index - 1; other >= 0; other -= 1) {
        if (left >= boxes[other].left + boxes[other].width / 2) break;
        targetIndex = other;
      }
      for (let other = index + 1; other < boxes.length; other += 1) {
        if (left + box.width <= boxes[other].left + boxes[other].width / 2) break;
        targetIndex = other;
      }
      gesture.targetIndex = targetIndex;

      for (let position = 0; position < boxes.length; position += 1) {
        let offset = 0;
        if (position === index) offset = left - box.left;
        else if (targetIndex < index && position >= targetIndex && position < index)
          offset = box.width;
        else if (targetIndex > index && position > index && position <= targetIndex)
          offset = -box.width;

        boxes[position].element.style.setProperty("--tab-dx", `${offset}px`);
      }
    },
    [scrollViewportRef],
  );

  const stopLoop = useCallback(() => {
    if (frameRef.current === null) return;
    cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
  }, []);

  // One loop drives the whole drag: edge auto-scroll and the offsets, in the
  // same frame. `pointermove` only records the cursor position.
  const startLoop = useCallback(() => {
    if (frameRef.current !== null) return;

    const tick = () => {
      const gesture = gestureRef.current;
      const viewport = scrollViewportRef.current;
      if (!gesture?.active || !viewport) {
        frameRef.current = null;
        return;
      }

      const rect = viewport.getBoundingClientRect();
      if (gesture.pointerClientX < rect.left + AUTO_SCROLL_EDGE_PX) {
        viewport.scrollLeft -= AUTO_SCROLL_STEP_PX;
      } else if (gesture.pointerClientX > rect.right - AUTO_SCROLL_EDGE_PX) {
        viewport.scrollLeft += AUTO_SCROLL_STEP_PX;
      }

      applyOffsets(gesture);
      frameRef.current = requestAnimationFrame(tick);
    };

    frameRef.current = requestAnimationFrame(tick);
  }, [applyOffsets, scrollViewportRef]);

  // Every workspace update a drag produces, in one batch after the gesture.
  const applyDrop = useCallback(
    (gesture: Gesture) => {
      if (gesture.targetIndex !== gesture.index) {
        onReorder(gesture.tabId, gesture.targetIndex);
      }

      const tab = tabs.find((item) => item.id === gesture.tabId);
      if (!tab) return;

      // Dragging a preview tab pins it, VS Code style — and only then does its
      // new position get persisted, since temporary tabs are never saved. This
      // has to run after the reorder: officializing renames the tab id. The twin
      // check skips the case where officializing would merge this tab into an
      // existing official one and delete it.
      if (tab.state === "temporary") {
        const hasOfficialTwin = tabs.some(
          (other) =>
            other.id !== tab.id &&
            other.state === "official" &&
            other.objectId !== undefined &&
            other.objectId === tab.objectId &&
            other.connectionKey === tab.connectionKey,
        );
        if (!hasOfficialTwin) {
          // Officializing focuses the tab on its own.
          onOfficialize(tab.id);
          return;
        }
      }

      onSelect(tab.id);
    },
    [onOfficialize, onReorder, onSelect, tabs],
  );

  // Applies the drop once the dragged tab has glided into its slot. Because it
  // already sits exactly where the reorder will place it, swapping the array
  // produces no visible movement at all.
  const settle = useCallback(
    (gesture: Gesture, commit: boolean) => {
      if (settleTimerRef.current !== null) {
        clearTimeout(settleTimerRef.current);
        settleTimerRef.current = null;
      }
      settleRef.current = null;

      // Reorder synchronously so the DOM is already in its final order by the
      // time the offsets come off. Left to React's own scheduling, the commit
      // could land a macrotask later and let a frame paint with the tab back in
      // its old slot — the very jump this landing exists to avoid.
      flushSync(() => {
        setDraggingTabId(null);
        if (commit) applyDrop(gesture);
      });

      // Transitions off before the offsets go away: otherwise every displaced
      // tab would animate its transform back to zero on top of the reordered
      // layout — the same double movement, in miniature.
      for (const box of gesture.boxes) {
        box.element.style.transition = "none";
        box.element.style.removeProperty("--tab-dx");
      }
      // Hand the tabs back their normal transitions once that has been painted.
      requestAnimationFrame(() => {
        for (const box of gesture.boxes) box.element.style.removeProperty("transition");
      });
    },
    [applyDrop],
  );

  const endGesture = useCallback(
    (commit: boolean) => {
      const gesture = gestureRef.current;
      gestureRef.current = null;
      stopLoop();
      if (!gesture?.active) return;

      suppressClickRef.current = true;

      // Glide the tab into the slot it won instead of dropping it there: the
      // reorder is applied only once it has landed, so nothing ever jumps.
      const box = gesture.boxes[gesture.index];
      const target = commit ? gesture.targetIndex : gesture.index;
      const finalLeft =
        target > gesture.index
          ? gesture.boxes[target].left + gesture.boxes[target].width - box.width
          : gesture.boxes[target].left;

      // Inline, so it wins over the class that keeps the dragged tab
      // transition-less. Same duration and curve as Tailwind's
      // `transition-transform` on the tabs it displaced.
      box.element.style.transition = `transform ${SETTLE_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`;
      box.element.style.setProperty("--tab-dx", `${finalLeft - box.left}px`);

      // A timer rather than `transitionend`, which never fires when the tab is
      // released exactly on its landing spot.
      settleRef.current = () => settle(gesture, commit);
      settleTimerRef.current = window.setTimeout(() => settle(gesture, commit), SETTLE_MS);
    },
    [settle, stopLoop],
  );

  // Escape aborts the gesture and snaps the tab back to its original slot.
  useEffect(() => {
    if (!draggingTabId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") endGesture(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [draggingTabId, endGesture]);

  useEffect(() => {
    return () => {
      stopLoop();
      // Drop the pending landing without applying it: the component is going
      // away, so there is nothing left to update.
      if (settleTimerRef.current !== null) clearTimeout(settleTimerRef.current);
    };
  }, [stopLoop]);

  const beginDrag = useCallback(
    (element: HTMLElement, pointerId: number) => {
      const gesture = gestureRef.current;
      const viewport = scrollViewportRef.current;
      if (!gesture || !viewport) return;

      const boxes = measure();
      const index = boxes.findIndex((box) => box.id === gesture.tabId);
      if (index === -1 || boxes.length < 2) {
        gestureRef.current = null;
        return;
      }

      gesture.active = true;
      gesture.boxes = boxes;
      gesture.index = index;
      gesture.targetIndex = index;
      gesture.viewportLeft = viewport.getBoundingClientRect().left;
      gesture.startContentX = gesture.startClientX - gesture.viewportLeft + viewport.scrollLeft;
      element.setPointerCapture(pointerId);

      setDraggingTabId(gesture.tabId);
      applyOffsets(gesture);
      startLoop();
    },
    [applyOffsets, measure, scrollViewportRef, startLoop],
  );

  const getTabHandlers = useCallback(
    (tabId: string) => ({
      onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return;
        // Grabbing another tab mid-landing applies the pending drop at once.
        settleRef.current?.();
        // No preventDefault here: it would swallow the click/double-click.
        suppressClickRef.current = false;
        gestureRef.current = {
          active: false,
          boxes: [],
          index: -1,
          pointerClientX: event.clientX,
          pointerId: event.pointerId,
          startClientX: event.clientX,
          startContentX: 0,
          tabId,
          targetIndex: -1,
          viewportLeft: 0,
        };
      },
      onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => {
        const gesture = gestureRef.current;
        if (!gesture || gesture.pointerId !== event.pointerId) return;

        gesture.pointerClientX = event.clientX;
        if (gesture.active) return;
        if (Math.abs(event.clientX - gesture.startClientX) < DRAG_THRESHOLD_PX) return;
        beginDrag(event.currentTarget, event.pointerId);
      },
      onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => {
        const gesture = gestureRef.current;
        if (!gesture || gesture.pointerId !== event.pointerId) return;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        endGesture(true);
      },
      onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => {
        const gesture = gestureRef.current;
        if (!gesture || gesture.pointerId !== event.pointerId) return;
        endGesture(false);
      },
      // Both cleared by the next `pointerdown`, so a later real click is safe.
      onClickCapture: (event: ReactMouseEvent<HTMLDivElement>) => {
        if (!suppressClickRef.current) return;
        event.preventDefault();
        event.stopPropagation();
      },
      onDoubleClickCapture: (event: ReactMouseEvent<HTMLDivElement>) => {
        if (!suppressClickRef.current) return;
        event.preventDefault();
        event.stopPropagation();
      },
    }),
    [beginDrag, endGesture],
  );

  return { draggingTabId, getTabHandlers };
}
