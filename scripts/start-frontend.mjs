import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..')

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: 'inherit',
    })

    child.on('error', reject)
    child.on('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`${command} terminated with signal ${signal}`))
        return
      }

      resolve(code ?? 0)
    })
  })
}

async function main() {
  const exitCode = await run('pnpm', ['run', 'build:wasm'])
  if (exitCode !== 0) {
    process.exit(exitCode)
  }

  const viteExitCode = await run('pnpm', ['--filter', './frontend', 'dev'])
  process.exit(viteExitCode)
}

main().catch((error) => {
  console.error('[start:frontend]', error instanceof Error ? error.message : String(error))
  process.exit(1)
})
