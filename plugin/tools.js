// Agent tools for reading sessions. Each resolves the book from the calling session's binding,
// so the agent never names files; sessions without a book get a plain error.
import { readChapter, readHighlights, readSummary, readToc, summarized, summaryFile, updateHighlights, writeSummary } from './books.js'

/** Characters returned per read_chapter call; longer chapters are paged with `offset`. */
const PAGE_CHARS = 12000

function text(value) {
  return {
    schema: { type: 'string' },
    render: (_args, result) => [{ type: 'text', text: result }],
  }
}

/** Where `quote` sits in the chapter; quotes must be copied verbatim so the reader can find them again. */
function locate(chapter, rawQuote) {
  const quote = String(rawQuote ?? '').trim()
  const at = quote ? chapter.text.indexOf(quote) : -1
  if (at < 0) throw new Error(`第 ${chapter.index + 1} 节里找不到这段原文。请从 read_chapter 的结果里逐字复制一小段再试（不要改字、不要跨段落）。`)
  return { quote, at }
}

/** Highlight results cap, so a broad search never floods the context. */
const HIGHLIGHT_LIMIT = 100

function formatHighlight(h, toc) {
  const title = toc.chapters[h.chapter]?.title ?? ''
  return `[${h.id}] 第 ${h.chapter + 1} 节「${title}」：${h.quote}${h.note ? `\n    用户批注：${h.note}` : ''}`
}

function integer(args, name, fallback) {
  const value = args?.[name] ?? fallback
  if (!Number.isInteger(value)) throw new Error(`${name} 必须是整数`)
  return value
}

/**
 * @param {object} deps
 * @param {string} deps.library - library root.
 * @param {(sessionId: string) => Promise<{ bookId: string, chapter?: number } | null>} deps.bindingFor
 * @param {(sessionId: string, patch: object) => Promise<object>} deps.updateBinding - moves the reader, or records the agent's place.
 */
export function readingTools({ library, bindingFor, updateBinding }) {
  async function bookOf(exec) {
    const sessionId = exec?.agent?.session?.id
    const binding = sessionId ? await bindingFor(sessionId) : null
    if (!binding?.bookId) throw new Error('当前对话没有打开书，读书工具不可用')
    return { ...binding, sessionId }
  }

  return [
    {
      name: 'book_toc',
      description: '列出当前这本书的目录：每节的序号、标题、字数、是否已有总结，以及用户读到第几节。先看目录再决定读哪一节。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: text(),
      async execute(_args, exec) {
        const { bookId, chapter = 0, agentPositions } = await bookOf(exec)
        const toc = await readToc(library, bookId)
        const done = await summarized(library, bookId)
        const mine = agentPositions?.[bookId]
        const lines = toc.chapters.map((c, i) => `${i + 1}. ${c.title}（${c.chars} 字）${done.has(summaryFile(c)) ? ' ✓总结' : ''}${i === chapter ? ' ← 用户正在读' : ''}${i === mine ? ' ← 你上次读到' : ''}`)
        return [`《${toc.title}》共 ${toc.chapters.length} 节，${toc.chars} 字。用户正在读第 ${chapter + 1} 节。`, ...lines].join('\n')
      },
    },
    {
      name: 'read_chapter',
      description: `读第 n 节原文（n 从 1 开始，对应目录序号）。一次最多返回 ${PAGE_CHARS} 字；没读完时结果末尾会给出下一次的 offset。`,
      parameters: {
        type: 'object',
        properties: {
          n: { type: 'integer', minimum: 1, description: '节序号，从 1 开始' },
          offset: { type: 'integer', minimum: 0, description: '从第几个字开始读，默认 0' },
        },
        required: ['n'],
        additionalProperties: false,
      },
      output: text(),
      async execute(args, exec) {
        const { bookId, sessionId } = await bookOf(exec)
        const chapter = await readChapter(library, bookId, integer(args, 'n') - 1)
        // The reader shows this as the agent's place, so the user can jump to it.
        await updateBinding(sessionId, { agentChapter: chapter.index })
        const offset = integer(args, 'offset', 0)
        const page = chapter.text.slice(offset, offset + PAGE_CHARS)
        const next = offset + page.length
        const tail = next < chapter.text.length
          ? `\n\n[本节共 ${chapter.text.length} 字，已读到 ${next}；继续读用 offset=${next}]`
          : '\n\n[本节已读完]'
        return `第 ${chapter.index + 1} 节 ${chapter.title}\n\n${page}${tail}`
      },
    },
    {
      name: 'show_passage',
      description: '让用户的阅读区跳到第 n 节，并高亮、滚动到 quote 那一段。用户说想看某段情节时用：先用 grep 或 read_chapter 找到原文，再调用本工具。quote 必须从原文逐字照抄一小段（10～80 字，不跨段落），找不到会报错且不跳转。',
      parameters: {
        type: 'object',
        properties: {
          n: { type: 'integer', minimum: 1, description: '节序号，从 1 开始' },
          quote: { type: 'string', minLength: 2, maxLength: 200, description: '要高亮的原文片段，逐字照抄' },
        },
        required: ['n', 'quote'],
        additionalProperties: false,
      },
      output: text(),
      async execute(args, exec) {
        const { bookId, sessionId } = await bookOf(exec)
        const chapter = await readChapter(library, bookId, integer(args, 'n') - 1)
        const { quote, at } = locate(chapter, args?.quote)
        await updateBinding(sessionId, { chapter: chapter.index, anchor: { quote, at, nonce: Date.now() } })
        return `已在阅读区打开第 ${chapter.index + 1} 节「${chapter.title}」，并高亮：${quote}`
      },
    },
    {
      name: 'save_summary',
      description: '把第 n 节的总结写进这本书的「总结」文件夹（覆盖旧总结），供以后查阅。读完一节原文后再写；写人物、事件、伏笔和关键对白，不要照抄原文。',
      parameters: {
        type: 'object',
        properties: {
          n: { type: 'integer', minimum: 1, description: '节序号，从 1 开始' },
          summary: { type: 'string', minLength: 1, description: '总结正文（Markdown）' },
        },
        required: ['n', 'summary'],
        additionalProperties: false,
      },
      output: text(),
      async execute(args, exec) {
        const { bookId } = await bookOf(exec)
        if (typeof args?.summary !== 'string' || !args.summary.trim()) throw new Error('summary 不能为空')
        const { file } = await writeSummary(library, bookId, integer(args, 'n') - 1, args.summary)
        return `已写入 ${file}`
      },
    },
    {
      name: 'add_highlight',
      description: '在第 n 节给一段原文划线（划重点）。只在用户要求标记、划线时调用，不要自己主动划。划线只是标出原文，不写评语或笔记；笔记由用户自己记。quote 必须逐字照抄原文（不跨段落）。划线按书保存，换个对话也能查到。',
      parameters: {
        type: 'object',
        properties: {
          n: { type: 'integer', minimum: 1, description: '节序号，从 1 开始' },
          quote: { type: 'string', minLength: 2, maxLength: 500, description: '要划线的原文，逐字照抄' },
        },
        required: ['n', 'quote'],
        additionalProperties: false,
      },
      output: text(),
      async execute(args, exec) {
        const { bookId } = await bookOf(exec)
        const chapter = await readChapter(library, bookId, integer(args, 'n') - 1)
        const { quote, at } = locate(chapter, args?.quote)
        const toc = await readToc(library, bookId)
        const saved = await updateHighlights(library, bookId, (list, newId) => {
          const same = list.find((h) => h.chapter === chapter.index && h.quote === quote)
          if (same) return { highlight: same, updated: true }
          const highlight = { id: newId(), chapter: chapter.index, quote, at, note: '', by: 'agent', createdAt: new Date().toISOString() }
          list.push(highlight)
          return { highlight, updated: false }
        })
        return `${saved.updated ? '这段已经划过了' : '已划线'}：\n${formatHighlight(saved.highlight, toc)}`
      },
    },
    {
      name: 'find_highlights',
      description: `检索这本书的划线（重点）。query 匹配原文或用户批注里的文字；from/to 限定节的范围；都不填就列出全部。最多返回 ${HIGHLIGHT_LIMIT} 条，按书中顺序。用户问「我标过/划过哪些」「之前记的那段」时用。`,
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '关键词，可不填' },
          from: { type: 'integer', minimum: 1, description: '起始节，可不填' },
          to: { type: 'integer', minimum: 1, description: '结束节（含），可不填' },
        },
        additionalProperties: false,
      },
      output: text(),
      async execute(args, exec) {
        const { bookId } = await bookOf(exec)
        const query = String(args?.query ?? '').trim()
        const from = integer(args, 'from', 1) - 1
        const to = integer(args, 'to', Number.MAX_SAFE_INTEGER) - 1
        const all = await readHighlights(library, bookId)
        const hits = all.filter((h) => h.chapter >= from && h.chapter <= to && (!query || h.quote.includes(query) || h.note?.includes(query)))
        if (hits.length === 0) return all.length === 0 ? '这本书还没有划线。' : `没有符合条件的划线（全书共 ${all.length} 条）。`
        const toc = await readToc(library, bookId)
        const shown = hits.slice(0, HIGHLIGHT_LIMIT).map((h) => formatHighlight(h, toc))
        const more = hits.length > HIGHLIGHT_LIMIT ? `\n\n[还有 ${hits.length - HIGHLIGHT_LIMIT} 条没列出，请缩小范围或换关键词]` : ''
        return `找到 ${hits.length} 条划线（全书共 ${all.length} 条）：\n\n${shown.join('\n')}${more}`
      },
    },
    {
      name: 'remove_highlight',
      description: '删除一条划线。id 来自 find_highlights 或 add_highlight 的结果（形如 h12）。只在用户要求时删除。',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: '划线 id' } },
        required: ['id'],
        additionalProperties: false,
      },
      output: text(),
      async execute(args, exec) {
        const { bookId } = await bookOf(exec)
        const id = String(args?.id ?? '').trim()
        const toc = await readToc(library, bookId)
        const removed = await updateHighlights(library, bookId, (list) => {
          const i = list.findIndex((h) => h.id === id)
          return i < 0 ? null : list.splice(i, 1)[0]
        })
        if (!removed) throw new Error(`没有 id 为 ${id} 的划线`)
        return `已删除：\n${formatHighlight(removed, toc)}`
      },
    },
    {
      name: 'read_summaries',
      description: '读第 from 到 to 节已有的总结（含两端），用来回顾前情而不必重读原文。没有总结的节会标出来。',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'integer', minimum: 1 },
          to: { type: 'integer', minimum: 1 },
        },
        required: ['from', 'to'],
        additionalProperties: false,
      },
      output: text(),
      async execute(args, exec) {
        const { bookId } = await bookOf(exec)
        const from = integer(args, 'from')
        const to = integer(args, 'to')
        if (to < from) throw new Error('to 不能小于 from')
        if (to - from > 200) throw new Error('一次最多读 200 节的总结')
        const parts = []
        for (let n = from; n <= to; n += 1) {
          const summary = await readSummary(library, bookId, n - 1)
          parts.push(summary ?? `# 第 ${n} 节\n\n（还没有总结）`)
        }
        return parts.join('\n\n---\n\n')
      },
    },
  ]
}
