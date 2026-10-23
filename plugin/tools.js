// Agent tools for reading sessions. Each resolves the book from the calling session's binding,
// so the agent never names files; sessions without a book get a plain error.
import { readChapter, readSummary, readToc, summarized, summaryFile, writeSummary } from './books.js'

/** Characters returned per read_chapter call; longer chapters are paged with `offset`. */
const PAGE_CHARS = 12000

function text(value) {
  return {
    schema: { type: 'string' },
    render: (_args, result) => [{ type: 'text', text: result }],
  }
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
 */
export function readingTools({ library, bindingFor }) {
  async function bookOf(exec) {
    const sessionId = exec?.agent?.session?.id
    const binding = sessionId ? await bindingFor(sessionId) : null
    if (!binding?.bookId) throw new Error('当前对话没有打开书，读书工具不可用')
    return binding
  }

  return [
    {
      name: 'book_toc',
      description: '列出当前这本书的目录：每节的序号、标题、字数、是否已有总结，以及用户读到第几节。先看目录再决定读哪一节。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: text(),
      async execute(_args, exec) {
        const { bookId, chapter = 0 } = await bookOf(exec)
        const toc = await readToc(library, bookId)
        const done = await summarized(library, bookId)
        const lines = toc.chapters.map((c, i) => `${i + 1}. ${c.title}（${c.chars} 字）${done.has(summaryFile(c)) ? ' ✓总结' : ''}${i === chapter ? ' ← 用户正在读' : ''}`)
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
        const { bookId } = await bookOf(exec)
        const chapter = await readChapter(library, bookId, integer(args, 'n') - 1)
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
