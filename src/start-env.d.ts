// Pulls the TanStack Start type augmentations into the TS program so route files
// (which import `createFileRoute` from @tanstack/react-router only) can see the
// `server` route option. Without this reference tsc reports "'server' does not exist".
import type {} from '@tanstack/react-start'
