#!/usr/bin/env node
// dsh-reader start | stop | restart | status | open — the service commands, after dsh-tavern's.
//
// The service is `dsh --profile reader` on a fixed port, detached, with its output in a log file and
// its PID in a record beside it. `start` and `restart` wait until the page answers, print the full
// address (it carries the access token) and open it in the browser, so the page always comes back
// after a restart.
import { spawn, spawnSync } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import net from 'node:net'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const PROFILE = 'reader'
const STATE_DIR = join(DSH_HOME, 'profile-data', PROFILE)
const PID_FILE = join(STATE_DIR, 'service.json')
const LOG_FILE = join(STATE_DIR, 'service.log')
const PORT = Number(process.env.DSH_READER_PORT || 30160)
const HOST = '127.0.0.1'
const START_TIMEOUT_MS = 90_000

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: HOST })
    socket.setTimeout(300)
    socket.once('connect', () => { socket.destroy(); resolve(true) })
    socket.once('timeout', () => { socket.destroy(); resolve(false) })
    socket.once('error', () => resolve(false))
  })
}

function alive(pid) {
  try { process.kill(pid, 0); return true } catch (error) { return error.code === 'EPERM' }
}

function readRecord() {
  try { return JSON.parse(readFileSync(PID_FILE, 'utf8')) } catch { return null }
}

/** `dsh --profile reader` processes not started through this script (a manual run, an old launch). */
function strayPids() {
  const result = spawnSync('pgrep', ['-f', `dsh --profile ${PROFILE}( |$)`], { encoding: 'utf8' })
  return result.stdout.split('\n').map(Number).filter((pid) => pid && pid !== process.pid)
}

/** The last `dsh web: <url>` this run printed. */
function webUrl(record) {
  try {
    const log = readFileSync(LOG_FILE).subarray(record?.logOffset ?? 0).toString('utf8')
    const matches = [...log.matchAll(/^dsh web: (https?:\/\/\S+)$/gm)]
    return matches.at(-1)?.[1] ?? ''
  } catch { return '' }
}

function openBrowser(url) {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
  spawn(command, args, { detached: true, stdio: 'ignore' }).unref()
}

function printUrl(url) {
  console.log(`打开网页（复制完整地址）：${url}`)
  console.log('地址里带访问凭证，别分享。关掉页面后运行 dsh-reader open 重新打开。')
}

async function running() {
  const record = readRecord()
  if (record && alive(record.pid)) return { record, ready: await isPortOpen(record.port) }
  return { record: null, ready: false }
}

async function start({ open = true } = {}) {
  const state = await running()
  if (state.record && state.ready) {
    console.log(`DSH 阅读器已经在运行：PID ${state.record.pid}，端口 ${state.record.port}。`)
    const url = webUrl(state.record)
    if (url) { printUrl(url); if (open) openBrowser(url) }
    return
  }
  if (!state.record && await isPortOpen(PORT)) {
    const strays = strayPids()
    if (strays.length === 0) throw new Error(`端口 ${PORT} 被别的程序占用了。换个端口：DSH_READER_PORT=30161 dsh-reader start`)
    console.log(`发现不是用本命令启动的阅读器进程（PID ${strays.join(', ')}），先停掉它。`)
    await stop({ quiet: true })
  }

  mkdirSync(STATE_DIR, { recursive: true })
  const logOffset = existsSync(LOG_FILE) ? statSync(LOG_FILE).size : 0
  const out = openSync(LOG_FILE, 'a')
  const child = spawn('dsh', ['--profile', PROFILE, '--host', HOST, '--port', String(PORT), '--no-open'], {
    cwd: ROOT, detached: true, stdio: ['ignore', out, out],
  })
  closeSync(out)
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject) })
  child.unref()
  const record = { pid: child.pid, port: PORT, logOffset, startedAt: new Date().toISOString() }
  writeFileSync(PID_FILE, JSON.stringify(record, null, 2))
  console.log(`正在启动 DSH 阅读器：PID ${child.pid}，端口 ${PORT}…`)

  const deadline = Date.now() + START_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (!alive(child.pid)) {
      rmSync(PID_FILE, { force: true })
      throw new Error(`启动失败，进程已退出。看日志：${LOG_FILE}`)
    }
    const url = webUrl(record)
    if (url && await isPortOpen(PORT)) {
      console.log('已启动。')
      printUrl(url)
      if (open) openBrowser(url)
      return
    }
    await sleep(500)
  }
  throw new Error(`${START_TIMEOUT_MS / 1000} 秒内没有就绪。看日志：${LOG_FILE}`)
}

async function stop({ quiet = false } = {}) {
  const record = readRecord()
  const pids = [...new Set([...(record && alive(record.pid) ? [record.pid] : []), ...strayPids()])]
  if (pids.length === 0) {
    rmSync(PID_FILE, { force: true })
    if (!quiet) console.log('DSH 阅读器没有在运行。')
    return
  }
  for (const pid of pids) { try { process.kill(pid, 'SIGTERM') } catch {} }
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline && pids.some(alive)) await sleep(200)
  for (const pid of pids.filter(alive)) { try { process.kill(pid, 'SIGKILL') } catch {} }
  rmSync(PID_FILE, { force: true })
  if (!quiet) console.log(`已停止 DSH 阅读器（PID ${pids.join(', ')}）。`)
}

async function status() {
  const state = await running()
  if (state.record && state.ready) {
    console.log(`DSH 阅读器正在运行：PID ${state.record.pid}，端口 ${state.record.port}。`)
    const url = webUrl(state.record)
    if (url) printUrl(url)
  } else if (state.record) {
    console.log(`DSH 阅读器正在启动：PID ${state.record.pid}（端口 ${state.record.port} 还没就绪）。`)
  } else if (strayPids().length) {
    console.log(`有阅读器进程在跑，但不是用本命令启动的（PID ${strayPids().join(', ')}）。运行 dsh-reader restart 接管。`)
  } else {
    console.log(`DSH 阅读器没有在运行（端口 ${PORT}）。运行 dsh-reader start 启动。`)
    process.exitCode = 1
  }
}

async function openPage() {
  const state = await running()
  if (!state.record || !state.ready) throw new Error('DSH 阅读器没有在运行，先运行 dsh-reader start。')
  const url = webUrl(state.record)
  if (!url) throw new Error(`没找到访问地址。运行 dsh-reader restart 重启。日志：${LOG_FILE}`)
  printUrl(url)
  openBrowser(url)
}

function usage() {
  console.log(`用法：dsh-reader <命令> [--no-open]

  start     启动（已在运行就直接给地址），并在浏览器打开
  stop      停止
  restart   重启，并在浏览器打开新地址
  status    看是否在运行、访问地址
  open      在浏览器打开阅读器
  logs      显示最近 60 行日志

  --no-open 不自动打开浏览器
  端口默认 ${PORT}，可用 DSH_READER_PORT 改；日志在 ${LOG_FILE}`)
}

const [action, ...flags] = process.argv.slice(2)
const open = !flags.includes('--no-open')
try {
  switch (action) {
    case 'start': await start({ open }); break
    case 'stop': await stop(); break
    case 'restart': await stop({ quiet: true }); await start({ open }); break
    case 'status': await status(); break
    case 'open': await openPage(); break
    case 'logs': console.log(readFileSync(LOG_FILE, 'utf8').split('\n').slice(-60).join('\n')); break
    default: usage(); if (action && !['-h', '--help', 'help'].includes(action)) process.exitCode = 2
  }
} catch (error) {
  console.error(String(error?.message ?? error))
  process.exitCode = 1
}
