// dsh-reader — host half: the library on disk, chapter splitting, which book each session reads,
// and the reading companion's 工作台性格 injected into the system prompt.
import { readdir, readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import { dirname, join, extname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { activePersonaText, managePersona, personaView } from './personas.js'

/** HTTP prefix the browser half posts to: `${ROUTE}/<endpoint>` with a JSON payload. */
const ROUTE = '/api/dsh-reader'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const LIBRARY = join(ROOT, 'library')
const DATA = join(ROOT, 'data')
const BINDINGS = join(DATA, 'sessions.json')
const SETTINGS = join(DATA, 'settings.json')
const IMPORT_LIMIT_BYTES = 64 * 1024 * 1024
/** DSH's identity sections; dropped while a 工作台性格 speaks instead. */
const REPLACED_BY_PERSONA = new Set(['harness:identity', 'deployment:persona-prefix'])

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
    cache.set(id, { id, title: basename(id, extname(id)), chars: text.replace(/\s/g, '').length, chapters })
  }
  return cache.get(id)
}

async function readJsonFile(path) {
  try { return JSON.parse(await readFile(path, 'utf8')) } catch { return {} }
}

async function writeJsonFile(path, value) {
  await mkdir(DATA, { recursive: true })
  await writeFile(path, JSON.stringify(value, null, 2))
}

const readBindings = () => readJsonFile(BINDINGS)

/** Save an uploaded TXT into the library under a free name; returns the new book id. */
async function importBook(name, buffer) {
  const stem = basename(String(name ?? ''), extname(String(name ?? ''))).replace(/[\\/:*?"<>|]/g, '').trim()
  if (!stem) throw new Error('书名不能为空')
  if (extname(String(name)).toLowerCase() !== '.txt') throw new Error('目前只支持 TXT')
  decode(buffer) // reject files that are neither UTF-8 nor GB18030 before they land in the library
  for (let n = 1; ; n += 1) {
    const id = n === 1 ? `${stem}.txt` : `${stem} (${n}).txt`
    try { await stat(join(LIBRARY, id)) } catch {
      await writeFile(join(LIBRARY, id), buffer, { flag: 'wx' })
      return { id, title: basename(id, '.txt') }
    }
  }
}

async function handleCall(endpoint, payload = {}) {
  switch (endpoint) {
    case 'info':
      return { library: LIBRARY }
    case 'library': {
      const names = (await readdir(LIBRARY)).filter((n) => extname(n).toLowerCase() === '.txt')
      return Promise.all(names.map(async (id) => ({ id, title: basename(id, extname(id)), chars: (await loadBook(id)).chars })))
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
    case 'bindings':
      return readBindings()
    case 'bind': {
      const all = await readBindings()
      if (payload.binding === null) delete all[payload.sessionId]
      else all[payload.sessionId] = { ...all[payload.sessionId], ...payload.binding, updatedAt: Date.now() }
      await writeJsonFile(BINDINGS, all)
      return all[payload.sessionId] ?? null
    }
    case 'personas':
      return personaView((await readJsonFile(SETTINGS)).persona ?? {})
    case 'persona': {
      const settings = await readJsonFile(SETTINGS)
      settings.persona = managePersona(settings.persona ?? {}, payload)
      await writeJsonFile(SETTINGS, settings)
      return personaView(settings.persona)
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

async function readBody(req, limit) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('文件太大')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

async function readJson(req) {
  const body = await readBody(req, 1024 * 1024)
  return body.length ? JSON.parse(body.toString('utf8')) : {}
}

/** The book a session reads, as stable system text: it changes only when the book does, so the prompt cache holds. */
function bookSection(book) {
  return [
    '# 正在读的书',
    `用户在这个会话里读《${book.title}》。原文是工作区里的 \`${book.id}\`，共 ${book.chapters.length} 节；需要原文时直接读这个文件或在里面搜索，不要凭记忆复述。`,
    '用户在界面中间读书，你在右侧陪读。',
  ].join('\n')
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
      const url = new URL(req.url ?? '/', 'http://localhost')
      const endpoint = url.pathname.slice(ROUTE.length + 1)
      try {
        // Imports post the raw file; the name rides in the query string.
        if (endpoint === 'import') return send(res, 200, { result: await importBook(url.searchParams.get('name'), await readBody(req, IMPORT_LIMIT_BYTES)) })
        send(res, 200, { result: await handleCall(endpoint, await readJson(req)) })
      } catch (error) {
        send(res, 500, { error: String(error?.message ?? error) })
      }
    },
  }), 'dsh-reader: web route'))

  // Reading sessions get the chosen 工作台性格 and the book they read; other sessions are untouched.
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembly = await next()
    const sessionId = context?.agent?.session?.id
    const binding = sessionId === undefined ? undefined : (await readBindings())[sessionId]
    if (!binding?.bookId) return assembly
    const persona = activePersonaText((await readJsonFile(SETTINGS)).persona ?? {})
    const book = await loadBook(binding.bookId)
    // Like tavern's card mode, a chosen persona replaces DSH's own identity; tool sections stay.
    const inherited = (assembly.sections ?? []).filter((section) => !persona || !REPLACED_BY_PERSONA.has(section.name))
    assembly.sections = [
      ...inherited,
      ...(persona ? [{ name: 'reader:persona', text: persona }] : []),
      { name: 'reader:book', text: bookSection(book) },
    ]
    return assembly
  })
}
