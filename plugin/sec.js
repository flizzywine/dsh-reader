// SEC EDGAR filings for the Agent: list a company's filings and read one as plain text.
//
// www.sec.gov serves filing documents only to automated clients that declare who they are: a
// User-Agent with a name and a contact email (data/sec-contact). Without it the request gets 403
// "Undeclared Automated Tool", which is what DSH's own web reader runs into. SEC also asks for at
// most 10 requests a second; requests here go one at a time, spaced out, and documents are cached.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { decodeEntities } from './epub.js'
import { cleanSymbol } from './stocks.js'

/** Characters returned per sec_read call; long filings are paged with `offset`. */
const PAGE_CHARS = 12000
const SPACING_MS = 150
const FORMS = ['10-K', '10-Q', '8-K', '20-F', '6-K', '40-F', 'DEF 14A', 'S-1', '424B4']

async function contact(dataDir) {
  try {
    const email = (await readFile(join(dataDir, 'sec-contact'), 'utf8')).trim()
    if (email) return email
  } catch { /* none */ }
  throw new Error('读 SEC 文件需要联系邮箱：在 data/sec-contact 里写一个邮箱（SEC 要求自动程序声明身份）')
}

/** One request at a time, at least SPACING_MS apart. */
let queue = Promise.resolve()
function spaced(task) {
  const run = queue.then(task)
  queue = run.catch(() => {}).then(() => new Promise((resolve) => setTimeout(resolve, SPACING_MS)))
  return run
}

async function secFetch(dataDir, url, as) {
  const ua = `dsh-reader ${await contact(dataDir)}`
  return spaced(async () => {
    const res = await fetch(url, { headers: { 'user-agent': ua }, signal: AbortSignal.timeout(30000) })
    if (!res.ok) throw new Error(`SEC：HTTP ${res.status}${res.status === 403 ? '（被拒绝；检查 data/sec-contact 里的邮箱）' : ''}`)
    return as === 'json' ? res.json() : res.text()
  })
}

const BLOCK = /^(p|div|br|tr|li|h[1-6]|table|section|article|ul|ol|title|center|hr)$/i

/**
 * A filing's HTML as readable text: paragraphs on their own lines, table cells joined with " | ",
 * hidden inline-XBRL data (display:none) and scripts/styles dropped.
 */
export function filingText(html) {
  let out = ''
  let skip = 0
  const stack = []
  for (const [whole, close, name, attrs, text] of html.matchAll(/<!--[\s\S]*?-->|<[!?][^>]*>|<(\/?)([a-zA-Z][\w:.-]*)([^>]*)>|([^<]+)/g)) {
    if (text !== undefined) { if (!skip) out += decodeEntities(text.replace(/\s+/g, ' ')); continue }
    if (!name) continue
    const tag = name.toLowerCase()
    const selfClosing = /\/\s*$/.test(attrs ?? '') || /^(br|hr|img|meta|link|input)$/.test(tag)
    if (!close) {
      const hidden = /^(script|style|head|ix:header)$/.test(tag) || /display\s*:\s*none/i.test(attrs ?? '')
      if (!selfClosing) stack.push({ tag, hidden })
      if (hidden && !selfClosing) skip += 1
      if (skip) continue
      if (tag === 'td' || tag === 'th') out += ' | '
      else if (BLOCK.test(tag)) out += '\n'
    } else {
      // Close the nearest matching open tag (HTML in filings is not always well nested).
      const i = stack.findLastIndex((e) => e.tag === tag)
      if (i < 0) continue
      for (const e of stack.splice(i)) if (e.hidden) skip -= 1
      if (!skip && BLOCK.test(tag)) out += '\n'
    }
  }
  return out.split('\n')
    .map((line) => line.replace(/[ \t ]+/g, ' ').replace(/^\s*\|\s*/, '').replace(/(\s*\|\s*)+$/, '').replace(/(\s*\|\s*){2,}/g, ' | ').trim())
    .filter((line) => line && !/^[|\s]*$/.test(line))
    .join('\n')
}

/** `cikOf(symbol)` may come from elsewhere (FMP's profile); SEC's own ticker list is the fallback. */
export function secTools({ dataDir, cikOf }) {
  const cacheDir = join(dataDir, 'sec-cache')
  let tickers = null

  async function cik(symbol) {
    const known = await cikOf?.(symbol).catch(() => null)
    if (known) return Number(known)
    tickers ??= secFetch(dataDir, 'https://www.sec.gov/files/company_tickers.json', 'json').catch((error) => { tickers = null; throw error })
    const row = Object.values(await tickers).find((t) => t.ticker === symbol || t.ticker === symbol.replace('-', '.'))
    if (!row) throw new Error(`SEC 里找不到 ${symbol}`)
    return row.cik_str
  }

  async function cached(name, load) {
    const path = join(cacheDir, name.replace(/[^A-Za-z0-9._-]/g, '_'))
    try { return await readFile(path, 'utf8') } catch { /* not cached */ }
    const value = await load()
    await mkdir(cacheDir, { recursive: true })
    await writeFile(`${path}.tmp`, value)
    await rename(`${path}.tmp`, path)
    return value
  }

  /** Text of a filing document at an https://www.sec.gov/Archives/… address. */
  async function documentText(url) {
    const u = new URL(url)
    if (u.hostname !== 'www.sec.gov' || !u.pathname.startsWith('/Archives/edgar/')) throw new Error('sec_read 只读 https://www.sec.gov/Archives/edgar/ 下的申报文件（用 sec_filings 拿地址）')
    return cached(`${u.pathname.slice('/Archives/edgar/data/'.length)}.txt`, async () => {
      const body = await secFetch(dataDir, u.href, 'text')
      return /\.(htm|html|xml)$/i.test(u.pathname) || /<html|<body/i.test(body.slice(0, 2000)) ? filingText(body) : body
    })
  }

  return [
    {
      name: 'sec_filings',
      description: '列出一家美股公司在 SEC EDGAR 的申报：10-K（年报）、10-Q（季报）、8-K（重大事项，含业绩新闻稿）、20-F/6-K（外国公司）等，给出日期、报告期和文件地址。之后用 sec_read 读正文。不要用网页读取工具打开 sec.gov，它会被 SEC 拒绝（403）。',
      parameters: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: '美股代码，如 INTC、ISRG' },
          form: { type: 'string', description: `只看某一类：${FORMS.join('、')}；不填就列全部` },
          limit: { type: 'integer', minimum: 1, maximum: 40, description: '最多列几份，默认 12' },
        },
        required: ['symbol'],
        additionalProperties: false,
      },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute(args) {
        const symbol = cleanSymbol(args?.symbol)
        const id = await cik(symbol)
        const data = await secFetch(dataDir, `https://data.sec.gov/submissions/CIK${String(id).padStart(10, '0')}.json`, 'json')
        const r = data.filings?.recent ?? {}
        const want = args?.form ? String(args.form).toUpperCase() : null
        const limit = Number.isInteger(args?.limit) ? args.limit : 12
        const rows = []
        for (let i = 0; i < (r.form?.length ?? 0) && rows.length < limit; i += 1) {
          const form = r.form[i]
          if (want ? form !== want && form !== `${want}/A` : /^(4|3|5|144|SC 13G.*|13F.*|N-PX)$/.test(form)) continue
          const url = `https://www.sec.gov/Archives/edgar/data/${Number(id)}/${r.accessionNumber[i].replace(/-/g, '')}/${r.primaryDocument[i]}`
          rows.push(`${r.filingDate[i]}  ${form}${r.reportDate[i] ? `（报告期 ${r.reportDate[i]}）` : ''}${r.primaryDocDescription[i] && r.primaryDocDescription[i] !== form ? ` ${r.primaryDocDescription[i]}` : ''}\n    ${url}`)
        }
        if (rows.length === 0) return `${data.name ?? symbol}（CIK ${id}）没有${want ? ` ${want} ` : ''}申报。`
        return [`${data.name ?? symbol}（CIK ${id}）最近的申报${want ? `（${want}）` : '（不含持股变动等表格）'}：`, ...rows, '用 sec_read 读正文；8-K 的业绩新闻稿常在附件 EX-99.1，可以先读 8-K 主文件找附件地址。'].join('\n')
      },
    },
    {
      name: 'sec_read',
      description: `读一份 SEC 申报文件的正文（sec_filings 给的地址，或正文里提到的附件地址），转成纯文本；表格每行一格一格用 | 隔开。每次最多 ${PAGE_CHARS} 字，用 offset 往后翻；传 query 就在全文里找这个词，返回出现的位置和上下文，再按位置读。`,
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'https://www.sec.gov/Archives/edgar/data/… 的文件地址' },
          offset: { type: 'integer', minimum: 0, description: '从第几个字开始读，默认 0' },
          query: { type: 'string', description: '要找的词（不区分大小写），比如 gross margin、Risk Factors、Data Center' },
        },
        required: ['url'],
        additionalProperties: false,
      },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute(args) {
        const text = await documentText(String(args?.url ?? ''))
        if (args?.query) {
          const q = String(args.query).toLowerCase()
          const hits = []
          const lower = text.toLowerCase()
          for (let at = lower.indexOf(q); at >= 0 && hits.length < 12; at = lower.indexOf(q, at + q.length)) {
            hits.push(`[offset ${Math.max(0, at - 300)}] …${text.slice(Math.max(0, at - 160), at + q.length + 200).replace(/\n/g, ' ⏎ ')}…`)
          }
          return hits.length ? [`「${args.query}」在全文 ${text.length} 字中出现的位置（最多列 12 处），用 offset 读附近全文：`, ...hits].join('\n') : `全文 ${text.length} 字里没有「${args.query}」。`
        }
        const offset = Number.isInteger(args?.offset) ? Math.min(args.offset, text.length) : 0
        const page = text.slice(offset, offset + PAGE_CHARS)
        const end = offset + page.length
        return `${page}\n\n[第 ${offset}–${end} 字，全文 ${text.length} 字${end < text.length ? `；接着读传 offset ${end}` : '；已读完'}]`
      },
    },
  ]
}
