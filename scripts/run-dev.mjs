import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'

const isWindows = process.platform === 'win32'
const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..')
const frontendDir = path.join(repoRoot, 'frontend')
const proxyDir = path.join(repoRoot, 'proxy')
const pnpmCommand = isWindows ? 'pnpm.cmd' : 'pnpm'
const dockerCommand = isWindows ? 'docker.exe' : 'docker'
const viteBinary = path.join(frontendDir, 'node_modules', '.bin', isWindows ? 'vite.cmd' : 'vite')
const supportsColor =
  process.env.NO_COLOR === undefined
  && process.env.FORCE_COLOR !== '0'
  && (process.stdout.isTTY || process.env.FORCE_COLOR !== undefined)
const colors = {
  build: '\u001B[33m',
  dev: '\u001B[36m',
  frontend: '\u001B[35m',
  proxy: '\u001B[34m',
}
const resetColor = '\u001B[0m'

let buildProcess = null
let services = []
let shuttingDown = false
let shutdownPromise = null
let requestedExitCode = 0
let finished = false
let resolveStop

const stopRequested = new Promise((resolve) => {
  resolveStop = resolve
})

function formatLabel(name) {
  const label = `[${name}]`

  if (!supportsColor) {
    return label
  }

  const color = colors[name] ?? colors.dev
  return `${color}${label}${resetColor}`
}

function writePrefixedLine(name, target, line) {
  target.write(`${formatLabel(name)} ${line}\n`)
}

function completeStop(exitCode) {
  if (finished) {
    return
  }

  finished = true
  resolveStop(exitCode)
}

function prefixStream(name, stream, target) {
  if (!stream) {
    return
  }

  const reader = readline.createInterface({ input: stream })
  reader.on('line', (line) => {
    writePrefixedLine(name, target, line)
  })
}

function spawnCommand(name, command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd ?? repoRoot,
    detached: options.detached ?? false,
    env: {
      ...process.env,
      FORCE_COLOR: process.env.FORCE_COLOR ?? '1',
      ...options.env,
    },
    stdio: options.stdio ?? ['inherit', 'pipe', 'pipe'],
  })

  if (options.prefixOutput !== false) {
    prefixStream(name, child.stdout, process.stdout)
    prefixStream(name, child.stderr, process.stderr)
  }

  const result = new Promise((resolve) => {
    child.on('error', (error) => {
      resolve({ code: 1, signal: null, error })
    })

    child.on('exit', (code, signal) => {
      resolve({ code: code ?? 0, signal, error: null })
    })
  })

  return { detached: options.detached ?? false, name, child, result }
}

function describeExit(status) {
  if (status.error) {
    return status.error.message
  }

  if (status.signal) {
    return `signal ${status.signal}`
  }

  return `exit code ${status.code}`
}

function exitCodeFromStatus(status) {
  if (status.signal) {
    return 1
  }

  return status.code === 0 ? 1 : status.code
}

function killProcess(command, signal) {
  if (!command || command.child.exitCode !== null || command.child.signalCode !== null) {
    return
  }

  try {
    if (!isWindows && command.detached && command.child.pid) {
      process.kill(-command.child.pid, signal)
      return
    }

    command.child.kill(signal)
  } catch {
    // Ignore races where the process exits between the status check and kill().
  }
}

function scheduleEscalation(signal, delay) {
  return setTimeout(() => {
    if (!shuttingDown) {
      return
    }

    for (const service of services) {
      killProcess(service, signal)
    }
  }, delay)
}

function requestShutdown(reason, exitCode, signal = 'SIGINT') {
  requestedExitCode = exitCode

  if (shutdownPromise) {
    return shutdownPromise
  }

  shuttingDown = true
  writePrefixedLine('dev', process.stdout, reason)

  if (buildProcess) {
    killProcess(buildProcess, signal)
  }

  for (const service of services) {
    killProcess(service, signal)
  }

  const termTimer = scheduleEscalation('SIGTERM', 10000)
  const killTimer = scheduleEscalation('SIGKILL', 20000)

  shutdownPromise = Promise.allSettled([
    ...(buildProcess ? [buildProcess.result] : []),
    ...services.map((service) => service.result),
  ]).then(() => {
    clearTimeout(termTimer)
    clearTimeout(killTimer)
    return requestedExitCode
  })

  return shutdownPromise
}

function watchService(service) {
  service.result.then((status) => {
    if (shuttingDown) {
      return
    }

    const exitCode = exitCodeFromStatus(status)
    const outcome = describeExit(status)
    completeStop(requestShutdown(`${service.name} stopped unexpectedly (${outcome}); shutting down remaining services...`, exitCode, 'SIGTERM'))
  })
}

async function runBuild() {
  writePrefixedLine('dev', process.stdout, 'Building WASM before starting services...')
  buildProcess = spawnCommand('build', pnpmCommand, ['run', 'build:wasm'], {
    prefixOutput: false,
    stdio: 'inherit',
  })

  const status = await buildProcess.result
  buildProcess = null

  if (shuttingDown) {
    return 0
  }

  if (status.error) {
    console.error(`[dev] Failed to start build: ${status.error.message}`)
    return 1
  }

  if (status.signal) {
    console.error(`[dev] build:wasm terminated with signal ${status.signal}`)
    return 1
  }

  return status.code
}

function startProxy() {
  const proxyService = spawnCommand('proxy', dockerCommand, ['compose', 'up', '--build'], {
    cwd: proxyDir,
    detached: !isWindows,
  })
  services.push(proxyService)
  watchService(proxyService)
}

function startFrontend() {
  const frontendCommand = existsSync(viteBinary)
    ? { command: viteBinary, args: [] }
    : { command: pnpmCommand, args: ['--dir', frontendDir, 'dev'] }

  const frontendService = spawnCommand('frontend', frontendCommand.command, frontendCommand.args, {
    cwd: frontendDir,
    detached: !isWindows,
  })
  services.push(frontendService)
  watchService(frontendService)
}

function installSignalHandlers() {
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      completeStop(requestShutdown(`Received ${signal}; stopping dev services gracefully...`, 0, signal))
    })
  }
}

async function main() {
  installSignalHandlers()

  startProxy()

  if (!process.argv.includes('--skip-wasm')) {
    const buildExitCode = await runBuild()
    if (buildExitCode !== 0) {
      process.exit(buildExitCode)
    }

    if (shuttingDown) {
      process.exit(0)
    }
  }

  startFrontend()
  const finalExitCode = await stopRequested
  process.exit(finalExitCode)
}

main().catch((error) => {
  console.error('[dev]', error instanceof Error ? error.message : String(error))
  process.exit(1)
})
