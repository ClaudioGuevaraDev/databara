import { openUrl } from "@tauri-apps/plugin-opener";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";

// This module is the only place that talks to the Tauri updater/process/opener plugins,
// mirroring the boundary rule that keeps databaraService.ts as the sole `invoke` caller.

export type { Update };

// Where users are sent when an in-app update can't be applied (e.g. Linux deb/rpm
// or an AppImage in a non-writable location).
export const DOWNLOAD_PAGE_URL = "https://www.databara.dev/#download";

// GitHub releases API for the repo behind the updater endpoint. Used to surface
// the latest *published* release version, which can differ from the bundled app
// version (the local version is often bumped ahead of an actual release).
const LATEST_RELEASE_API_URL =
  "https://api.github.com/repos/ClaudioGuevaraDev/databara-app/releases/latest";

// Returns the latest published release version (e.g. "1.1.7"), or null when it
// can't be determined (offline, network/CORS error, malformed response). Works
// both inside the desktop app and in the browser since the GitHub API allows
// cross-origin reads.
export async function fetchLatestReleaseVersion(): Promise<string | null> {
  try {
    const response = await fetch(LATEST_RELEASE_API_URL, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) return null;
    const release = (await response.json()) as { tag_name?: unknown; name?: unknown };
    const raw =
      typeof release.tag_name === "string"
        ? release.tag_name
        : typeof release.name === "string"
          ? release.name
          : "";
    // Tags may be "v1.1.7", "app-v1.1.7", or "1.1.7" — pull the semver out.
    const match = raw.match(/\d+\.\d+\.\d+(?:[-.][0-9A-Za-z.]+)?/);
    return match ? match[0] : null;
  } catch {
    return null;
  }
}

export type DownloadProgress = {
  downloaded: number;
  total: number;
};

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

// Bounds the release-manifest request. Without it a hanging network leaves the
// check pending indefinitely, which used to hold up the whole startup.
const UPDATE_CHECK_TIMEOUT_MS = 8000;

// Returns the pending update, or null when up to date / running outside the
// desktop app (e.g. `pnpm run dev` in a browser, where the plugin is absent).
export async function checkForUpdate(): Promise<Update | null> {
  if (!isTauriRuntime()) return null;
  return check({ timeout: UPDATE_CHECK_TIMEOUT_MS });
}

// Downloads and installs the update, reporting cumulative download progress.
// `total` is 0 until the server advertises a Content-Length.
export async function downloadAndInstallUpdate(
  update: Update,
  onProgress: (progress: DownloadProgress) => void,
): Promise<void> {
  let downloaded = 0;
  let total = 0;

  await update.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        total = event.data.contentLength ?? 0;
        onProgress({ downloaded, total });
        break;
      case "Progress":
        downloaded += event.data.chunkLength;
        onProgress({ downloaded, total });
        break;
      case "Finished":
        onProgress({ downloaded: total || downloaded, total });
        break;
    }
  });
}

export async function relaunchApp(): Promise<void> {
  if (!isTauriRuntime()) return;
  await relaunch();
}

// Opens the download page in the user's default browser.
export async function openDownloadPage(): Promise<void> {
  if (!isTauriRuntime()) {
    window.open(DOWNLOAD_PAGE_URL, "_blank", "noopener");
    return;
  }
  await openUrl(DOWNLOAD_PAGE_URL);
}
