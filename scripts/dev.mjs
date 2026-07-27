// Dev launcher: starts the Express backend and Vite together.
// Extra CLI args (e.g. `npm run dev -- --port 5199 --host`) are forwarded to Vite,
// which npm cannot do through a concurrently-style wrapper.
import { spawn } from 'node:child_process'

const viteArgs = process.argv.slice(2)
const children = []

function run(command, args, name) {
  const child = spawn(command, args, { stdio: 'inherit', shell: true, env: process.env })
  child.on('error', (err) => {
    console.error(`[${name}] failed to start:`, err.message)
    shutdown(1)
  })
  child.on('exit', (code) => {
    if (code && code !== 0 && !shuttingDown) {
      console.error(`[${name}] exited with code ${code}`)
      shutdown(code)
    }
  })
  children.push(child)
  return child
}

let shuttingDown = false
function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) {
    try { child.kill('SIGTERM') } catch { /* already gone */ }
  }
  setTimeout(() => process.exit(code), 500)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

run('npm', ['run', 'dev:server'], 'server')
run('vite', viteArgs, 'web')
