/**
 * Read a secret/env var in a way that works in both vite dev (process.env, populated
 * from .dev.vars by the Cloudflare plugin) and the deployed Worker (cloudflare:workers
 * env binding). Returns undefined if unset anywhere.
 */
export async function readEnv(key: string): Promise<string | undefined> {
  const fromProcess =
    typeof process !== 'undefined' ? process.env[key] : undefined
  if (fromProcess) return fromProcess
  try {
    const { env } = await import('cloudflare:workers')
    return (env as Record<string, string | undefined>)[key]
  } catch {
    return undefined
  }
}
