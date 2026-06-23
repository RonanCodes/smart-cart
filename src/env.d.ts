/// <reference types="vite/client" />

// The environment this build targets, baked in by the VITE_SOUSO_ENV Vite define
// (see vite.config.ts). Read it through src/lib/app-env.ts, never directly.
interface ImportMetaEnv {
  readonly VITE_SOUSO_ENV?: 'dev' | 'production' | 'local'
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
