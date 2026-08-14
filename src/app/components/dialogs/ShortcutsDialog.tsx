import { Keyboard } from "lucide-react";
import { useI18n } from "../../i18n/I18nContext";
import type { TranslationKey } from "../../i18n/translate";
import { tokenLabel } from "../../keyboardTokens";
import { DialogBody, DialogCloseButton, DialogFrame, DialogHeader } from "../ui";

// A key combination is a list of tokens. Modifier tokens ("Mod"/"Alt"/"Shift")
// are rendered per-platform; anything else is shown verbatim.
type Combo = string[];
type ShortcutItem = { labelKey: TranslationKey; combos: Combo[] };
type ShortcutGroup = { titleKey: TranslationKey; items: ShortcutItem[] };

const GROUPS: ShortcutGroup[] = [
  {
    titleKey: "shortcuts.groups.general",
    items: [
      { labelKey: "shortcuts.newConnection", combos: [["Mod", "N"]] },
      { labelKey: "shortcuts.importConfig", combos: [["Mod", "O"]] },
      { labelKey: "shortcuts.settings", combos: [["Mod", ","]] },
      { labelKey: "shortcuts.showShortcuts", combos: [["Mod", "/"]] },
    ],
  },
  {
    titleKey: "shortcuts.groups.editor",
    items: [
      { labelKey: "shortcuts.runQuery", combos: [["Mod", "Enter"], ["F5"]] },
      { labelKey: "shortcuts.save", combos: [["Mod", "S"]] },
      { labelKey: "shortcuts.closeTab", combos: [["Mod", "W"]] },
      { labelKey: "shortcuts.nextTab", combos: [["Mod", "Alt", "→"]] },
      { labelKey: "shortcuts.prevTab", combos: [["Mod", "Alt", "←"]] },
    ],
  },
  {
    titleKey: "shortcuts.groups.results",
    items: [
      { labelKey: "shortcuts.nextPage", combos: [["Mod", "Alt", "↓"]] },
      { labelKey: "shortcuts.prevPage", combos: [["Mod", "Alt", "↑"]] },
      { labelKey: "shortcuts.copyCells", combos: [["Mod", "C"]] },
      { labelKey: "shortcuts.copyResults", combos: [["Mod", "Shift", "C"]] },
    ],
  },
  {
    titleKey: "shortcuts.groups.explorer",
    items: [{ labelKey: "shortcuts.refresh", combos: [["Mod", "Shift", "R"]] }],
  },
  {
    titleKey: "shortcuts.groups.view",
    items: [
      { labelKey: "shortcuts.zoomIn", combos: [["Mod", "+"]] },
      { labelKey: "shortcuts.zoomOut", combos: [["Mod", "-"]] },
      { labelKey: "shortcuts.zoomReset", combos: [["Mod", "0"]] },
    ],
  },
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  return (
    <DialogFrame maxWidth="max-w-[520px]">
      <DialogHeader
        title={
          <>
            <Keyboard size={16} className="text-primary" />
            {t("shortcuts.title")}
          </>
        }
      >
        <DialogCloseButton onClick={onClose} />
      </DialogHeader>
      <DialogBody className="scroll-overlay max-h-[420px] space-y-4 overflow-y-auto">
        {GROUPS.map((group) => (
          <section key={group.titleKey}>
            <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              {t(group.titleKey)}
            </h3>
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li
                  key={item.labelKey}
                  className="flex items-center justify-between gap-3 rounded px-2 py-1.5 hover:bg-muted"
                >
                  <span className="text-[13px] text-foreground">{t(item.labelKey)}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    {item.combos.map((combo, comboIndex) => (
                      <span key={comboIndex} className="flex items-center gap-1">
                        {comboIndex > 0 ? (
                          <span className="px-0.5 text-[11px] text-muted-foreground">/</span>
                        ) : null}
                        {combo.map((token, tokenIndex) => (
                          <kbd
                            key={tokenIndex}
                            className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-[hsl(var(--panel-soft)/0.82)] px-1.5 text-[11px] font-medium text-muted-foreground"
                          >
                            {tokenLabel(token)}
                          </kbd>
                        ))}
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </DialogBody>
    </DialogFrame>
  );
}
