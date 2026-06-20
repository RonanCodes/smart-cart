/**
 * One-shot local setup for Smart Cart.
 *
 *   npm run init
 *
 * Idempotent: safe to re-run. It will
 *   1. install dependencies (pnpm)
 *   2. create .dev.vars from .dev.vars.example (auto-filling a BETTER_AUTH_SECRET)
 *   3. apply the D1 migrations to the local database
 *   4. seed the local database with the recipe catalogue
 *
 * After this finishes, `npm run start` boots the app at http://localhost:3000.
 *
 * Optional keys (Resend email, an LLM provider) are left blank in .dev.vars. The
 * app runs without them: sign-in uses the demo skip-login, and meal planning is
 * set-maths. Fill them in later to enable real email + AI replan.
 */
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const step = (n, msg) => console.log(`\n[init ${n}/4] ${msg}`)
const ok = (msg) => console.log(`  + ${msg}`)

function run(cmd, args) {
  execFileSync(cmd, args, { stdio: 'inherit', cwd: root })
}

function hasPnpm() {
  try {
    execFileSync('pnpm', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

// ---- 0. require pnpm -------------------------------------------------------
// The lockfile is pnpm's; installing with npm/yarn would resolve a different
// dependency tree. Keep one source of truth.
if (!hasPnpm()) {
  console.error(
    '\npnpm is required. Install it once with:\n' +
      '  corepack enable && corepack prepare pnpm@latest --activate\n' +
      'or:\n  npm install -g pnpm\n',
  )
  process.exit(1)
}

// ---- 1. dependencies ------------------------------------------------------
step(1, 'Installing dependencies')
if (existsSync(join(root, 'node_modules'))) {
  ok('node_modules present, refreshing to match the lockfile')
}
run('pnpm', ['install'])

// ---- 2. .dev.vars ---------------------------------------------------------
step(2, 'Local secrets (.dev.vars)')
const devVars = join(root, '.dev.vars')
const example = join(root, '.dev.vars.example')
if (existsSync(devVars)) {
  ok('.dev.vars already exists, leaving it untouched')
} else {
  let contents = readFileSync(example, 'utf8')
  const secret = randomBytes(32).toString('base64')
  contents = contents.replace(
    /BETTER_AUTH_SECRET=.*/,
    `BETTER_AUTH_SECRET="${secret}"`,
  )
  writeFileSync(devVars, contents)
  ok('created .dev.vars with a generated BETTER_AUTH_SECRET')
  ok('Resend + LLM keys left blank (optional, the app runs without them)')
}

// ---- 3. migrate local D1 --------------------------------------------------
step(3, 'Applying database migrations (local D1)')
run('pnpm', ['db:migrate:local'])

// ---- 4. seed recipes ------------------------------------------------------
step(4, 'Seeding the recipe catalogue (local D1)')
run('pnpm', ['reseed:d1', '--local'])

console.log(
  '\nSetup complete. Start the app with:\n  npm run start\n  -> http://localhost:3000\n',
)
