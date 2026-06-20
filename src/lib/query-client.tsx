import { useState } from 'react'
import type { ReactNode } from 'react'
import {
  QueryClient,
  QueryClientProvider as TanStackQueryClientProvider,
} from '@tanstack/react-query'

/**
 * Shared TanStack Query defaults (#226). The goal is a snappy feel: once a page's
 * client read is cached it stays fresh for 30s, so flicking between tabs and
 * navigating back is instant with no refetch. We do not refetch on window focus
 * (mobile app foregrounding would otherwise spam the server fns) and retry once
 * on a transient failure.
 *
 * SSR is untouched: route loaders still run on the server and hydrate first
 * paint. React Query layers on top for client-cached reads, it does not replace
 * the loaders.
 */
function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  })
}

/**
 * QueryClientProvider — wraps the app with a single QueryClient.
 *
 * On the server every render gets a fresh client so requests never share cache.
 * On the client we create the client once via `useState` (its initialiser runs
 * a single time per mount), giving a stable module-lifetime singleton without a
 * top-level `new QueryClient()` that would also run during SSR module eval.
 */
export function QueryClientProvider({ children }: { children: ReactNode }) {
  const [client] = useState(makeQueryClient)
  return (
    <TanStackQueryClientProvider client={client}>
      {children}
    </TanStackQueryClientProvider>
  )
}
