import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..')
const crateRoot = path.join(repoRoot, 'crates', 'wallet-core')
const artifactPaths = [
  path.join(repoRoot, 'wasm', 'pkg', 'wallet_core.js'),
  path.join(repoRoot, 'wasm', 'pkg', 'wallet_core_bg.wasm'),
]
const rustInputs = [
  path.join(repoRoot, 'Cargo.toml'),
  path.join(crateRoot, 'Cargo.toml'),
  path.join(crateRoot, 'src'),
]
function hasCommand(command) {
  const lookup = process.platform === 'win32' ? 'where' : 'which'
  const result = spawnSync(lookup, [command], {
    cwd: repoRoot,
    stdio: 'ignore',
  })
  return result.status === 0
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: 'inherit',
      ...options,
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

function walkFiles(targetPath) {
  const stats = statSync(targetPath)

  if (stats.isFile()) {
    return [targetPath]
  }

  if (!stats.isDirectory()) {
    return []
  }

  const entries = readdirSync(targetPath, { withFileTypes: true })
  return entries.flatMap((entry) => walkFiles(path.join(targetPath, entry.name)))
}

function getLatestModifiedTime(paths) {
  let latest = 0

  for (const targetPath of paths) {
    if (!existsSync(targetPath)) {
      continue
    }

    for (const filePath of walkFiles(targetPath)) {
      const modified = statSync(filePath).mtimeMs
      if (modified > latest) {
        latest = modified
      }
    }
  }

  return latest
}

function artifactsExist() {
  return artifactPaths.every((artifactPath) => existsSync(artifactPath))
}

function artifactsAreFresh() {
  if (!artifactsExist()) {
    return false
  }

  const newestArtifact = getLatestModifiedTime(artifactPaths)
  const newestInput = getLatestModifiedTime(rustInputs)
  return newestArtifact >= newestInput
}

async function buildWithLocalWasmPack() {
  console.log('[build:wasm] using local wasm-pack')
  return run('pnpm', ['--filter', '@ddex/wallet-core-web', 'build'])
}

async function ensureRustTarget() {
  return run('rustup', ['target', 'add', 'wasm32-unknown-unknown'])
}

async function ensureWasmPack() {
  if (hasCommand('wasm-pack')) {
    return 0
  }

  if (!hasCommand('cargo')) {
    console.error('[build:wasm] cargo is not installed. Run `pnpm run setup:rust` first.')
    return 1
  }

  console.log('[build:wasm] installing local wasm-pack via cargo')
  return run('cargo', ['install', 'wasm-pack', '--locked'])
}

async function main() {
  const hasRustup = hasCommand('rustup')
  const hasCargo = hasCommand('cargo')
  const hasRustc = hasCommand('rustc')

  if (!hasRustup || !hasCargo || !hasRustc) {
    if (artifactsAreFresh()) {
      console.warn('[build:wasm] Rust toolchain is unavailable; reusing existing fresh wasm/pkg artifacts.')
      process.exit(0)
    }

    console.error('[build:wasm] Rust toolchain is missing. Run `pnpm run setup:rust` first.')
    process.exit(1)
  }

  const targetExitCode = await ensureRustTarget()
  if (targetExitCode !== 0) {
    process.exit(targetExitCode)
  }

  const wasmPackExitCode = await ensureWasmPack()
  if (wasmPackExitCode !== 0) {
    process.exit(wasmPackExitCode)
  }

  process.exit(await buildWithLocalWasmPack())
}

main().catch((error) => {
  console.error('[build:wasm]', error instanceof Error ? error.message : String(error))
  process.exit(1)
})
