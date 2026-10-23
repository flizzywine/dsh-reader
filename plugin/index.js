// dsh-reader — host half: the library on disk, chapter splitting, and which book each session reads.
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join, extname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

/** HTTP prefix the browser half posts to: `${ROUTE}/<endpoint>` with a JSON payload. */
const ROUTE = '/api/dsh-reader'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const LIBRARY = join(ROOT, 'library')
const DATA = join(ROOT, 'data')
const BINDINGS = join(DATA, 'sessions.json')

/** Chapter headings common in Chinese web novels: 第X章/回/节/卷, 序章, 楔子, 番外… */
const HEADING = /^[ \t　]*((第[0-9零一二三四五六七八九十百千万两〇]+[章回节卷集部篇][^\n]{0,30})|((序章|序言|楔子|引子|尾声|后记|番外)[^\n]{0,30}))[ \t　]*$/gm

/** Decode UTF-8 (with or without BOM), falling back to GB18030 for older TXT files. */
function decode(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^﻿/, '')
  } catch {
    return new TextDecoder('gb18030').decode(buffer)
  }
}

/** Split text into chapters by heading lines; text before the first heading becomes 「开篇」. */
function splitChapters(text) {
  const marks = [...text.matchAll(HEADING)].map((m) => ({ title: m[1].trim(), at: m.index }))
  if (marks.length === 0) return [{ title: '全文', at: 0 }]
  if (text.slice(0, marks[0].at).trim()) marks.unshift({ title: '开篇', at: 0 })
  return marks
}

const cache = new Map()

async function loadBook(id) {
  if (basename(id) !== id) throw new Error(`invalid book id: ${id}`)
  if (!cache.has(id)) {
    const text = decode(await readFile(join(LIBRARY, id)))
    const marks = splitChapters(text)
    const chapters = marks.map((m, i) => ({ title: m.title, text: text.slice(m.at, marks[i + 1]?.at ?? text.length) }))
    cache.set(id, { id, title: basename(id, extname(id)), chapters })
  }
  return cache.get(id)
}

async function readBindings() {
  try { return JSON.parse(await readFile(BINDINGS, 'utf8')) } catch { return {} }
}

async function handleCall(endpoint, payload = {}) {
  switch (endpoint) {
    case 'library': {
      const names = (await readdir(LIBRARY)).filter((n) => extname(n).toLowerCase() === '.txt')
      return names.map((id) => ({ id, title: basename(id, extname(id)) }))
    }
    case 'toc': {
      const book = await loadBook(payload.bookId)
      return { id: book.id, title: book.title, chapters: book.chapters.map((c) => c.title) }
    }
    case 'chapter': {
      const book = await loadBook(payload.bookId)
      const chapter = book.chapters[payload.index]
      if (!chapter) throw new Error(`no chapter ${payload.index}`)
      return { index: payload.index, title: chapter.title, text: chapter.text }
    }
    case 'binding': {
      return (await readBindings())[payload.sessionId] ?? null
    }
    case 'bind': {
      const all = await readBindings()
      if (payload.binding === null) delete all[payload.sessionId]
      else all[payload.sessionId] = { ...all[payload.sessionId], ...payload.binding }
      await mkdir(DATA, { recursive: true })
      await writeFile(BINDINGS, JSON.stringify(all, null, 2))
      return all[payload.sessionId] ?? null
    }
    default:
      throw new Error(`unknown endpoint: ${endpoint}`)
  }
}

/** Loopback-only unless the Connection service's own trust fence says otherwise. */
function rejection(ctx, req) {
  const verdict = ctx.get('connection')?.requestRejection?.({ headers: req.headers })
  if (verdict !== undefined || typeof ctx.get('connection')?.requestRejection === 'function') return verdict
  const host = String(req.headers.host ?? '').replace(/:\d+$/u, '').replace(/^\[|\]$/gu, '')
  return host === '127.0.0.1' || host === 'localhost' || host === '::1' ? undefined : 403
}

async function readJson(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

export function apply(ctx) {
  // webServer arrives after this plugin activates, so wait for it.
  ctx.inject(['webServer'], (scope) => scope.effect(() => scope.webServer.register({
    kind: 'prefix',
    path: ROUTE,
    handler: async (req, res) => {
      const denied = rejection(ctx, req)
      if (denied !== undefined) return send(res, denied, { error: 'forbidden' })
      if (req.method !== 'POST') return send(res, 405, { error: 'POST only' })
      const endpoint = new URL(req.url ?? '/', 'http://localhost').pathname.slice(ROUTE.length + 1)
      try {
        send(res, 200, { result: await handleCall(endpoint, await readJson(req)) })
      } catch (error) {
        send(res, 500, { error: String(error?.message ?? error) })
      }
    },
  }), 'dsh-reader: web route'))
}
