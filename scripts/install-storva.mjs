import { spawnSync } from 'node:child_process'
import process from 'node:process'
import path from 'node:path'

const pnpmCli = process.env.npm_execpath
const fallbackPnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

// During pnpm lifecycle scripts, npm_execpath usually points to pnpm's JS
// entrypoint, which needs to be run through the current Node executable to
// avoid Windows spawnSync EINVAL issues caused by spawning pnpm.cmd directly.
// However, newer pnpm releases (installed as a standalone compiled binary,
// e.g. via corepack) set npm_execpath to a native executable instead
// (pnpm.exe on Windows). That binary must be spawned directly — running it
// through `node <path-to.exe>` makes Node try to load the .exe as an ESM
// module and crash with ERR_UNKNOWN_FILE_EXTENSION. Only route through Node
// when npm_execpath actually looks like a JS file.
const JS_ENTRYPOINT_EXTS = new Set(['.js', '.cjs', '.mjs'])
const pnpmCliIsJs = pnpmCli && JS_ENTRYPOINT_EXTS.has(path.extname(pnpmCli).toLowerCase())

function run(label, args) {
  console.log(`[STORVA] ${label}`)

  let command
  let commandArgs
  if (pnpmCliIsJs) {
    command = process.execPath
    commandArgs = [pnpmCli, ...args]
  } else if (pnpmCli) {
    command = pnpmCli
    commandArgs = args
  } else {
    command = fallbackPnpm
    commandArgs = args
  }

  const result = spawnSync(command, commandArgs, {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: process.env,
    shell: false,
  })

  if (result.error) throw result.error
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

// Keep installation deterministic: first generate the Prisma client from the
// web workspace where the Prisma CLI is declared, then initialize/check the
// persistent local data store. Never run database migrations automatically.
run('Generating Prisma Client...', [
  '--filter', '@storva/web', 'exec', 'prisma', 'generate',
])

run('Initializing persistent STORVA data (safe/no-overwrite mode)...', [
  'storva:data:init',
])

run('Checking persistent STORVA data...', [
  'storva:data:check',
])

console.log('[STORVA] Installation setup completed.')
console.log('[STORVA] PostgreSQL migrations are intentionally manual: pnpm prisma:migrate')
