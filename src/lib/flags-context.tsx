import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import { FLAG_DEFAULTS } from './flags'
import type { FlagSet } from './flags'

/**
 * Client-side feature-flag delivery. The root loader reads the resolved FlagSet
 * once (getFlags, server side) and hands it to FlagsProvider, so every component
 * reads flags from context with NO async work on the render path and NO flicker
 * on first paint (the values are present in the SSR'd HTML). Pure + client-safe:
 * imports only the defaults + types, never the DB-bound flags-server.
 *
 * The default value is FLAG_DEFAULTS, so a component rendered outside a provider
 * (e.g. a unit test) gets the same conservative fallback the server uses rather
 * than crashing on an undefined flag.
 */
const FlagsContext = createContext<FlagSet>(FLAG_DEFAULTS)

export function FlagsProvider({
  flags,
  children,
}: {
  flags: FlagSet
  children: ReactNode
}) {
  return <FlagsContext.Provider value={flags}>{children}</FlagsContext.Provider>
}

/** Read the resolved feature flags from context. */
export function useFlags(): FlagSet {
  return useContext(FlagsContext)
}
