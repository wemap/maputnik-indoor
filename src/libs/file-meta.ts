/** Name of the file the style being edited comes from / was last saved to,
 * and whether it has unsaved changes since. Kept in localStorage per style
 * id (next to the style itself, which the style store already keeps there),
 * so a page reload still knows which file it's working on.
 *
 * This is independent from the style's own "name" field (Style Settings):
 * that one is the style's internal name inside the JSON and is never used
 * to display or derive the file name, except as a last-resort default when
 * no file is known at all.
 */
export type FileMeta = {
  name: string
  dirty: boolean
};

const PREFIX = "maputnik:file-meta:";

export function loadFileMeta(styleId: string | undefined): FileMeta | null {
  if (!styleId) return null;
  try {
    const raw = window.localStorage.getItem(PREFIX + styleId);
    if (!raw) return null;
    const meta = JSON.parse(raw);
    return typeof meta?.name === "string" ? { name: meta.name, dirty: !!meta.dirty } : null;
  } catch {
    return null;
  }
}

export function saveFileMeta(styleId: string | undefined, meta: FileMeta | null) {
  if (!styleId) return;
  try {
    if (meta) {
      window.localStorage.setItem(PREFIX + styleId, JSON.stringify(meta));
    } else {
      window.localStorage.removeItem(PREFIX + styleId);
    }
  } catch {
    // Storage full or unavailable: the name just won't survive a reload.
  }
}

/** Last path segment of a style URL, used as the file name of a style
 * opened by URL (or from the gallery). */
export function fileNameFromUrl(url: string): string | null {
  try {
    const last = new URL(url, window.location.href).pathname.split("/").pop();
    return last ? decodeURIComponent(last) : null;
  } catch {
    return null;
  }
}

/** File name without its ".json" extension. */
export function fileBaseName(fileName: string): string {
  return fileName.replace(/\.json$/i, "");
}

/** Name of the "Indoor" export file for a given base name: "<base>_indoor.json".
 * An existing "_indoor" (or older "_legacy") suffix is dropped first, so
 * re-exporting from an exported file doesn't stack "_indoor_indoor". Only
 * applied to this export - a normal Save keeps the file name as it is. */
export function indoorExportFileName(baseName: string): string {
  return baseName.replace(/_(indoor|legacy)$/i, "") + "_indoor.json";
}

/** Shortens a long name in the middle, keeping its end (which usually
 * carries the version/variant and the extension) visible. */
export function middleTruncate(text: string, max = 34): string {
  if (text.length <= max) return text;
  const tail = 15;
  return text.slice(0, max - tail - 1) + "…" + text.slice(-tail);
}
