// Shared rendering for key-combination tokens. Modifier tokens ("Mod"/"Alt"/
// "Shift") are shown per-platform; anything else is rendered verbatim.
export const isMac = /mac/i.test(
  (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.platform,
);

export function tokenLabel(token: string): string {
  if (token === "Mod") return isMac ? "⌘" : "Ctrl";
  if (token === "Alt") return isMac ? "⌥" : "Alt";
  if (token === "Shift") return isMac ? "⇧" : "Shift";
  return token;
}

/** Renders a combo as a single inline hint, e.g. "⌘C" or "Ctrl+C". */
export function formatCombo(combo: string[]): string {
  return combo.map(tokenLabel).join(isMac ? "" : "+");
}
