"use client";

import { QueryClient, QueryClientProvider, isServer } from "@tanstack/react-query";

/** TanStack Query for the city datasets: cached by data version, retried in place when a fetch fails. */
function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, gcTime: Infinity, retry: 2, refetchOnWindowFocus: false } },
  });
}

// One client for the life of the browser tab (TanStack's pattern for the App Router). Only the explorer uses Query, so the
// provider lives on the city page, not the public layout (P9-12: the city-selection and company pages don't load it); a
// module-level client keeps the datasets cached when a visitor goes to a company page and comes back.
let browserClient: QueryClient | undefined;
function getQueryClient() {
  if (isServer) return makeQueryClient();
  browserClient ??= makeQueryClient();
  return browserClient;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={getQueryClient()}>{children}</QueryClientProvider>;
}
