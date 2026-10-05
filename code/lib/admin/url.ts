// The query string of an admin list page: set some parameters, drop the empty ones. Pure, so it is unit-tested.

/** `current` with each of `next` applied. An empty value, or "0" (the first page), removes the parameter. */
export function withParams(current: URLSearchParams | string, next: Record<string, string>): string {
  const sp = new URLSearchParams(current.toString());
  for (const [key, value] of Object.entries(next)) {
    if (value === "" || value === "0") sp.delete(key);
    else sp.set(key, value);
  }
  return sp.toString();
}

/** The path with its query string, or just the path when there is none. */
export const pathWith = (path: string, query: string): string => (query ? `${path}?${query}` : path);
