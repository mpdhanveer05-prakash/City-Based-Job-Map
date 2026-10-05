// "Back to map (keeps filters)" (design-system.md §5): the explorer remembers its last URL for the tab, and the
// company pages link back to it. Session storage can be missing or blocked, so every call is guarded and the pages
// fall back to the city's own explorer.

const KEY = "company-map:last-explorer";

/** Only a path into one of the explorers, with a query string: never another site, never a script. */
const EXPLORER_PATH = /^\/(bangalore|chennai)(\?[A-Za-z0-9%+,._~=&:-]*)?$/;

export const isExplorerPath = (value: string | null | undefined): value is string => !!value && EXPLORER_PATH.test(value);

export function rememberExplorer(path: string, storage: Pick<Storage, "setItem"> | undefined = safeStorage()): void {
  if (!storage || !isExplorerPath(path)) return;
  try {
    storage.setItem(KEY, path);
  } catch {
    // A full or blocked store: the back link falls back to the city page.
  }
}

export function recallExplorer(storage: Pick<Storage, "getItem"> | undefined = safeStorage()): string | null {
  if (!storage) return null;
  try {
    const value = storage.getItem(KEY);
    return isExplorerPath(value) ? value : null;
  } catch {
    return null;
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof sessionStorage === "undefined" ? undefined : sessionStorage;
  } catch {
    return undefined;
  }
}
