import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle/neon',
  dbCredentials: {
    url: process.env.NEON_DATABASE_URL!,
  },
})
