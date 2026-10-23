// dsh-reader — host half: the library on disk (see books.js), which book each session reads,
// the reading tools, and the reading companion's 工作台性格 injected into the system prompt.
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import { dirname, join, extname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CHAPTER_DIR, SUMMARY_DIR, listBooks, migrateFlatBooks, readChapter, readToc, safeName, writeBook } from './books.js'
import { activePersonaText, managePersona, personaView } from './personas.js'
import { readingTools } from './tools.js'

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

async function readJsonFile(path) {
  try { return JSON.parse(await readFile(path, 'utf8')) } catch { return {} }
}

async function writeJsonFile(path, value) {
  await mkdir(DATA, { recursive: true })
  await writeFile(path, JSON.stringify(value, null, 2))
}

const readBindings = () => readJsonFile(BINDINGS)

/** Split an uploaded TXT into a new book folder under a free name; returns the new book id. */
async function importBook(name, buffer) {
  if (extname(String(name ?? '')).toLowerCase() !== '.txt') throw new Error('目前只支持 TXT')
  const stem = safeName(basename(String(name), extname(String(name))))
  for (let n = 1; ; n += 1) {
    const id = n === 1 ? stem : `${stem} (${n})`
    try { await stat(join(LIBRARY, id)) } catch {
      const toc = await writeBook(LIBRARY, id, buffer)
      return { id, title: toc.title, chapters: toc.chapters.length }
    }
  }
}

/** Books dropped into library/ as plain TXT become folders; bindings follow them to the new id. */
let migration = null
function migrateLibrary() {
  migration ??= (async () => {
    await mkdir(LIBRARY, { recursive: true })
    const moved = await migrateFlatBooks(LIBRARY)
    if (moved.size === 0) return
    const all = await readBindings()
    for (const binding of Object.values(all)) if (moved.has(binding?.bookId)) binding.bookId = moved.get(binding.bookId)
    await writeJsonFile(BINDINGS, all)
  })().finally(() => { migration = null })
  return migration
}

async function handleCall(endpoint, payload = {}) {
  switch (endpoint) {
    case 'info':
      return { library: LIBRARY }
    case 'library':
      await migrateLibrary()
      return listBooks(LIBRARY)
    case 'toc': {
      const toc = await readToc(LIBRARY, payload.bookId)
      return { id: payload.bookId, title: toc.title, chapters: toc.chapters.map((c) => c.title) }
    }
    case 'chapter': {
      const chapter = await readChapter(LIBRARY, payload.bookId, payload.index)
      return { index: chapter.index, title: chapter.title, text: chapter.text }
    }
    case 'binding':
      await migrateLibrary()
      return (await readBindings())[payload.sessionId] ?? null
    case 'bindings':
      await migrateLibrary()
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
function bookSection(id, toc) {
  return [
    '# 正在读的书',
    `用户在这个会话里读《${toc.title}》，共 ${toc.chapters.length} 节。用户在界面中间读书，你在右侧陪读。`,
    '- 用 book_toc 看目录和用户读到哪一节；用 read_chapter 一节一节读原文，不要一次读整本，也不要凭记忆复述。',
    '- 读完一节可以用 save_summary 写总结；回顾前情先用 read_summaries 读总结，不够再回原文。',
    `- 文件都在工作区的 \`${id}/\` 下：\`${CHAPTER_DIR}/\` 是分好的章节，\`${SUMMARY_DIR}/\` 是总结，需要跨章搜索时可以直接 grep \`${id}/${CHAPTER_DIR}/\`。`,
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

  // Tools are global (the tool list is part of the cached prefix); each one checks the session's book.
  ctx.inject(['tools'], (scope) => {
    for (const tool of readingTools({ library: LIBRARY, bindingFor: async (sessionId) => (await readBindings())[sessionId] ?? null })) {
      scope.effect(() => scope.tools.register(tool), `dsh-reader: ${tool.name} tool`)
    }
  })

  // Reading sessions get the chosen 工作台性格 and the book they read; other sessions are untouched.
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembly = await next()
    const sessionId = context?.agent?.session?.id
    const binding = sessionId === undefined ? undefined : (await readBindings())[sessionId]
    if (!binding?.bookId) return assembly
    const persona = activePersonaText((await readJsonFile(SETTINGS)).persona ?? {})
    const toc = await readToc(LIBRARY, binding.bookId)
    // Like tavern's card mode, a chosen persona replaces DSH's own identity; tool sections stay.
    const inherited = (assembly.sections ?? []).filter((section) => !persona || !REPLACED_BY_PERSONA.has(section.name))
    assembly.sections = [
      ...inherited,
      ...(persona ? [{ name: 'reader:persona', text: persona }] : []),
      { name: 'reader:book', text: bookSection(binding.bookId, toc) },
    ]
    return assembly
  })
}
