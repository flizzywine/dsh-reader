// dsh-reader — host half: the library on disk (see books.js), which book each session reads,
// the reading tools, and the reading companion's 工作台性格 injected into the system prompt.
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import { dirname, join, extname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { CHAPTER_DIR, SUMMARY_DIR, addHighlight, listBooks, readBookNotes, readHighlights, updateHighlights, migrateFlatBooks, readChapter, readSummary, readToc, safeName, summarized, summaryFile, writeBook, parseBook, setGroup, BOOK_TYPES } from './books.js'
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

/** Split an uploaded TXT, EPUB or PDF into a new book folder under a free name; returns the new book id. */
async function importBook(name, buffer, { onProgress } = {}) {
  const ext = extname(String(name ?? '')).toLowerCase()
  if (!BOOK_TYPES.includes(ext)) throw new Error('目前只支持 TXT、EPUB 和 PDF')
  const book = await parseBook(ext, buffer, { onProgress })
  // An EPUB or PDF names itself; its file name is often a download site's.
  // Download sites tag their file names: `书名 (z-library.sk, 1lib.sk)`, `书名_z_library_sk,_1lib_sk`.
  const fileStem = basename(String(name), extname(String(name))).replace(/[\s_]*[(（]?z[-_\s]?library[\s\S]*$/i, '')
  const stem = safeName(book.title || fileStem)
  for (let n = 1; ; n += 1) {
    const id = n === 1 ? stem : `${stem} (${n})`
    try { await stat(join(LIBRARY, id)) } catch {
      const toc = await writeBook(LIBRARY, id, buffer, book)
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
    case 'book-group':
      return setGroup(LIBRARY, payload.bookId, payload.group)
    case 'toc': {
      const toc = await readToc(LIBRARY, payload.bookId)
      const done = await summarized(LIBRARY, payload.bookId)
      return { id: payload.bookId, title: toc.title, chapters: toc.chapters.map((c) => ({ title: c.title, chars: c.chars, summarized: done.has(summaryFile(c)) })) }
    }
    case 'summaries': {
      // Every summary of a book, in reading order; small files, so one call is fine.
      const toc = await readToc(LIBRARY, payload.bookId)
      const done = await summarized(LIBRARY, payload.bookId)
      const out = []
      for (const [index, chapter] of toc.chapters.entries()) {
        if (done.has(summaryFile(chapter))) out.push({ index, title: chapter.title, text: await readSummary(LIBRARY, payload.bookId, index) })
      }
      return out
    }
    case 'highlights': {
      // Highlights (with their notes) and the notes about the whole book, for the reader and 书详情.
      const toc = await readToc(LIBRARY, payload.bookId)
      return {
        highlights: (await readHighlights(LIBRARY, payload.bookId)).map((h) => ({ ...h, title: toc.chapters[h.chapter]?.title ?? '' })),
        notes: await readBookNotes(LIBRARY, payload.bookId),
      }
    }
    // A note about the whole book; `chapter` records where the user was reading, if anywhere.
    case 'book-note-save':
      return updateHighlights(LIBRARY, payload.bookId, (_list, newId, notes) => {
        const text = String(payload.note ?? '').trim()
        if (!text) throw new Error('笔记不能为空')
        if (payload.id) {
          const found = notes.find((n) => n.id === payload.id)
          if (!found) throw new Error('这条笔记已经不在了')
          found.note = text
          found.updatedAt = new Date().toISOString()
          return found
        }
        const note = { id: newId('n'), note: text, chapter: Number.isInteger(payload.chapter) ? payload.chapter : null, createdAt: new Date().toISOString() }
        notes.push(note)
        return note
      })
    case 'book-note-remove':
      return updateHighlights(LIBRARY, payload.bookId, (_list, _newId, notes) => {
        const i = notes.findIndex((n) => n.id === payload.id)
        return i < 0 ? null : notes.splice(i, 1)[0]
      })
    // The reader's own highlights: the page sends file offsets, the host cuts the quote.
    case 'highlight-add': {
      const { highlight } = await addHighlight(LIBRARY, payload.bookId, { index: payload.chapter, at: payload.at, end: payload.end, by: 'user', note: payload.note ?? '' })
      return highlight
    }
    case 'highlight-note':
      return updateHighlights(LIBRARY, payload.bookId, (list) => {
        const found = list.find((h) => h.id === payload.id)
        if (!found) throw new Error('这条划线已经不在了')
        found.note = String(payload.note ?? '').trim()
        return found
      })
    case 'highlight-remove':
      return updateHighlights(LIBRARY, payload.bookId, (list) => {
        const i = list.findIndex((h) => h.id === payload.id)
        return i < 0 ? null : list.splice(i, 1)[0]
      })
    case 'reveal': {
      // Show a book's folder (or one of its subfolders) in the file manager on this machine.
      const dir = join(LIBRARY, safeName(payload.bookId), payload.sub === SUMMARY_DIR ? SUMMARY_DIR : '')
      const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open'
      spawn(command, [dir], { detached: true, stdio: 'ignore' }).unref()
      return { dir }
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
    case 'bind':
      return updateBinding(payload.sessionId, payload.binding)
    case 'watch':
      return watchBinding(payload.sessionId, payload.version)
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
/**
 * Apply a binding patch. A session may switch books; each book keeps its own place in
 * `positions`, so switching back resumes where the user left off. A patch without `bookId` or
 * `chapter` is news for the reader, not a page turn, and leaves the reader where it is:
 * `{ agentChapter }` records where the agent last read (per book, in `agentPositions`);
 * `{ marks }` tells the reader the book's highlights changed.
 */
function nextBinding(previous = {}, patch) {
  if (patch.bookId === undefined && patch.chapter === undefined) {
    if (!previous.bookId) return previous
    const next = { ...previous }
    if (patch.agentChapter !== undefined) {
      next.agentPositions = { ...previous.agentPositions, [previous.bookId]: patch.agentChapter }
      next.updatedAt = Date.now()
    }
    if (patch.marks !== undefined) next.marks = patch.marks
    return next
  }
  // Turning pages by hand drops the agent's highlight; only show_passage sets one.
  if (patch.anchor === undefined) patch = { ...patch, anchor: null }
  const positions = { ...previous.positions }
  if (previous.bookId) positions[previous.bookId] = previous.chapter ?? 0
  const bookId = patch.bookId ?? previous.bookId
  const chapter = patch.chapter ?? (patch.bookId && patch.bookId !== previous.bookId ? positions[bookId] ?? 0 : previous.chapter ?? 0)
  positions[bookId] = chapter
  return { ...previous, ...patch, bookId, chapter, positions, updatedAt: Date.now() }
}

/** Change counter per session, so the reader page can long-poll for moves made by the agent. */
const versions = new Map()
const waiters = new Map()

/** The one writer of bindings: the page, the agent's show_passage, and closing a book all go through here. */
let writing = Promise.resolve()
function updateBinding(sessionId, patch) {
  const work = writing.then(async () => {
    const all = await readBindings()
    if (patch === null) delete all[sessionId]
    else all[sessionId] = nextBinding(all[sessionId], patch)
    await writeJsonFile(BINDINGS, all)
    const version = (versions.get(sessionId) ?? 0) + 1
    versions.set(sessionId, version)
    for (const wake of waiters.get(sessionId) ?? []) wake()
    waiters.delete(sessionId)
    return all[sessionId] ?? null
  })
  writing = work.catch(() => {})
  return work
}

/** Resolve once the session's binding moves past `version`, or after 25s with no change. */
async function watchBinding(sessionId, version) {
  const current = versions.get(sessionId) ?? 0
  if (version === undefined || version !== current) return { version: current, binding: (await readBindings())[sessionId] ?? null, changed: version !== undefined }
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 25000)
    const list = waiters.get(sessionId) ?? []
    list.push(() => { clearTimeout(timer); resolve() })
    waiters.set(sessionId, list)
  })
  const latest = versions.get(sessionId) ?? 0
  return { version: latest, binding: (await readBindings())[sessionId] ?? null, changed: latest !== version }
}

/**
 * How reading works, as system text. It names no book or chapter: those change while reading
 * and arrive per turn (positionNote), so this section never breaks the prompt cache.
 */
const READING_SECTION = [
  '# 陪读',
  '用户在界面中间读书，你在右侧陪读。每轮用户消息后会附一条【阅读位置】，写明用户此刻在读哪本书、哪一节；以最新一条为准。一个对话通常只读一本书，也可能换书。',
  '- 读书工具都作用于当前这本书：book_toc 看目录和进度；read_chapter 一节一节读原文，不要一次读整本，也不要凭记忆复述。',
  '- 读完一节可以用 save_summary 写总结；回顾前情先用 read_summaries 读总结，不够再回原文。',
  `- 每本书是工作区里的一个文件夹：\`<书名>/${CHAPTER_DIR}/\` 是分好的章节，\`<书名>/${SUMMARY_DIR}/\` 是总结；跨章搜索可以直接 grep 章节目录。`,
  '- 用户想看某段情节时，先用 grep 或 read_chapter 找到它，再用 show_passage 让阅读区跳过去并高亮。',
  '- 用户要求标记、划重点时，用 add_highlight 划线，只标原文、不写评语，笔记由用户自己记；不要自己主动划。用户问起划过的内容或自己的笔记时，用 find_highlights 检索；笔记只读不写。',
  '- 用户还没读到的部分算剧透：除非用户要求，不要透露当前节之后的情节。',
].join('\n')

/** The per-turn note: which book and section the user is on right now. */
async function positionNote(binding) {
  const toc = await readToc(LIBRARY, binding.bookId)
  const index = Math.min(binding.chapter ?? 0, toc.chapters.length - 1)
  const chapter = toc.chapters[index]
  return `【阅读位置】用户此刻在读《${toc.title}》第 ${index + 1}/${toc.chapters.length} 节「${chapter.title}」（文件 ${binding.bookId}/${CHAPTER_DIR}/${chapter.file}）。`
}

const POSITION_FORM = 'reading-position'

/** Last note sent per session, for when the session's derived context cannot be read. */
const announced = new Map()

/** The session's current model context (after compaction), or [] if this DSH build does not expose it. */
function contextMessages(session) {
  try { return session?.deriveMessages?.() ?? [] } catch { return [] }
}

/** The text of the latest position note still in the request, if compaction has not dropped it. */
function lastPositionNote(messages = []) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (message?.source?.form === POSITION_FORM) return message.content?.[0]?.text
  }
  return undefined
}

/**
 * Imports run in the background, since recognising a scanned PDF takes minutes: `import` answers
 * with a job id at once, `import-status` with `{ done, total }` pages so far, then `result` or `error`.
 */
const imports = new Map()
const IMPORT_JOB_TTL_MS = 10 * 60 * 1000

function startImport(name, buffer) {
  const id = randomUUID()
  const job = { done: 0, total: 0 }
  imports.set(id, job)
  importBook(name, buffer, { onProgress: (done, total) => Object.assign(job, { done, total }) })
    .then((result) => { job.result = result }, (error) => { job.error = String(error?.message ?? error) })
    .finally(() => setTimeout(() => imports.delete(id), IMPORT_JOB_TTL_MS).unref())
  return { job: id }
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
        if (endpoint === 'import') return send(res, 200, { result: startImport(url.searchParams.get('name'), await readBody(req, IMPORT_LIMIT_BYTES)) })
        if (endpoint === 'import-status') {
          const job = imports.get((await readJson(req)).job)
          return job ? send(res, 200, { result: job }) : send(res, 404, { error: '导入任务不见了，可能服务重启过' })
        }
        send(res, 200, { result: await handleCall(endpoint, await readJson(req)) })
      } catch (error) {
        send(res, 500, { error: String(error?.message ?? error) })
      }
    },
  }), 'dsh-reader: web route'))

  // Tools are global (the tool list is part of the cached prefix); each one checks the session's book.
  ctx.inject(['tools'], (scope) => {
    for (const tool of readingTools({ library: LIBRARY, bindingFor: async (sessionId) => (await readBindings())[sessionId] ?? null, updateBinding })) {
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
    // Like tavern's card mode, a chosen persona replaces DSH's own identity; tool sections stay.
    const inherited = (assembly.sections ?? []).filter((section) => !persona || !REPLACED_BY_PERSONA.has(section.name))
    assembly.sections = [
      ...inherited,
      ...(persona ? [{ name: 'reader:persona', text: persona }] : []),
      { name: 'reader:reading', text: READING_SECTION },
    ]
    return assembly
  })

  // At the start of each reply, tell the agent where the user is reading. The note joins the history
  // after the cached prefix (like tavern's variable changes) and is skipped while the latest one still
  // says the same thing, so turning no page costs nothing.
  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    if (decision.kind !== 'enter' || Number(payload.step) !== 1) return decision
    const sessionId = payload.agent?.session?.id
    const binding = sessionId === undefined ? undefined : (await readBindings())[sessionId]
    if (!binding?.bookId) return decision
    let note
    try { note = await positionNote(binding) } catch { return decision }
    const sent = lastPositionNote([...contextMessages(payload.agent.session), ...(payload.messages ?? []), ...decision.messages]) ?? announced.get(sessionId)
    if (sent === note) return decision
    announced.set(sessionId, note)
    const message = { id: randomUUID(), role: 'user', content: [{ type: 'text', text: note }], source: { kind: 'plugin:dsh-reader', form: POSITION_FORM } }
    return { ...decision, messages: [...decision.messages, message] }
  })
}
