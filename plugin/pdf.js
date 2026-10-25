// PDF → plain text through poppler's pdftotext, so a PDF becomes the same book folder a TXT does.
//
// A PDF only has positioned lines, so paragraphs are rebuilt from geometry: a line that reaches
// the right edge of the text runs on into the next one, a short or indented line ends or starts
// a paragraph. Page numbers and lines repeated on many pages (running heads, watermarks) are
// dropped. The bookmarks give chapter marks when they look like a real contents list; short
// lines set large, centred or listed in the printed contents are offered as headings for when neither bookmarks nor 第X章 exist.
// A scanned PDF has no text layer; its pages are read by macOS's text recognition (ocr.swift),
// which gives positioned lines too, so the same rules apply.

import { createHash } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { decodeEntities } from './epub.js'

const run = (cmd, args) => new Promise((resolve, reject) => {
  execFile(cmd, args, { maxBuffer: 1 << 30 }, (error, stdout) => {
    if (error?.code === 'ENOENT') reject(new Error('导入 PDF 需要 poppler，先在终端运行：brew install poppler'))
    else if (error) reject(new Error(`PDF 读不出来：${String(error.message).split('\n')[0]}`))
    else resolve(stdout)
  })
})

const num = (tag, name) => Number(tag.match(new RegExp(`${name}="([^"]*)"`))[1])
const CJK = /[⺀-鿿豈-﫿＀-￯　-〿]/

/** Join a wrapped line to the next: a space between Latin words, nothing around CJK, no end-of-line hyphen. */
function glue(a, b) {
  if (!a) return b
  if (/[a-z]-$/i.test(a) && /^[a-z]/.test(b)) return a.slice(0, -1) + b
  return CJK.test(a.at(-1)) || CJK.test(b[0]) ? a + b : `${a} ${b}`
}

/**
 * `[{ width, lines: [{ x0, x1, y0, y1, flow, text }] }]` from `pdftotext -bbox-layout`. A flow is
 * pdftotext's run of text in reading order, a column on a two-column page.
 */
function readPages(xhtml) {
  const pages = []
  let line = null
  let flow = 0
  for (const [tag, word] of xhtml.matchAll(/<page\b[^>]*>|<flow>|<line\b[^>]*>|<\/line>|<word\b[^>]*>([^<]*)<\/word>/g)) {
    if (tag.startsWith('<page')) pages.push({ width: num(tag, 'width'), lines: [] })
    else if (tag === '<flow>') flow += 1
    else if (tag.startsWith('<line')) line = { x0: num(tag, 'xMin'), x1: num(tag, 'xMax'), y0: num(tag, 'yMin'), y1: num(tag, 'yMax'), flow, text: '' }
    else if (tag === '</line>') { if (line.text.trim()) pages.at(-1).lines.push(line); line = null }
    else if (line) line.text = [line.text, decodeEntities(word).trim()].filter(Boolean).join(' ')
  }
  return pages
}

const PAGE_NUMBER = /^[-—–·\s]*(第\s*)?([0-9]+|[ivxlc]+)(\s*页)?[-—–·\s]*$/i
const shape = (text) => text.replace(/\s+/g, '').replace(/[0-9]+/g, '#')

/** Remove page numbers and lines (digits ignored) that repeat on many pages: running heads, footers, watermarks. */
function dropFurniture(pages) {
  const seen = new Map()
  for (const page of pages) for (const s of new Set(page.lines.map((l) => shape(l.text)))) seen.set(s, (seen.get(s) ?? 0) + 1)
  const repeated = (text) => pages.length >= 5 && text.length < 80 && seen.get(shape(text)) >= Math.max(3, pages.length * 0.2)
  for (const page of pages) {
    const edge = (i) => i < 2 || i >= page.lines.length - 2
    page.lines = page.lines.filter((l, i) => !(edge(i) && PAGE_NUMBER.test(l.text)) && !repeated(l.text))
  }
}

const mode = (values) => {
  const count = new Map()
  for (const v of values) count.set(v, (count.get(v) ?? 0) + 1)
  return [...count].sort((x, y) => y[1] - x[1])[0]?.[0]
}

/**
 * Where full lines end: the farthest line end that several lines reach (within half a character),
 * so one line that sticks out past the column (a ►► marker, a wide glyph, a URL) does not move the
 * edge and make every ordinary full line look short.
 */
function rightEdge(lines) {
  const ends = lines.map((l) => l.x1).sort((a, b) => b - a)
  const need = Math.max(2, Math.ceil(lines.length * 0.15))
  const size = mode(lines.map((l) => Math.round(l.y1 - l.y0))) || 10
  // Justified full lines end within about half a character of each other.
  for (const end of ends) if (ends.filter((e) => e <= end && e >= end - size * 0.5).length >= need) return end
  return ends[0]
}

/**
 * Left and right edge of the body text around each line: the most common line start and the
 * common line end (see rightEdge) of its flow, or of its page when the flow is a heading or a few
 * stray lines.
 */
function margins(pages) {
  const edge = (lines) => ({ left: mode(lines.map((l) => Math.round(l.x0))), right: rightEdge(lines) })
  const pageEdges = pages.map((page) => page.lines.length >= 5 ? edge(page.lines) : null)
  const fallback = pageEdges.find(Boolean) ?? { left: 0, right: pages[0]?.width ?? 0 }
  const edges = new Map()
  for (const [i, page] of pages.entries()) {
    const flows = Map.groupBy(page.lines, (l) => l.flow)
    for (const lines of flows.values()) {
      const e = lines.length >= 5 ? edge(lines) : pageEdges[i] ?? fallback
      for (const l of lines) edges.set(l, e)
    }
  }
  return edges
}

/**
 * Whether `line` continues the paragraph `prev` ends: the paragraph runs on when the first word
 * of `line` would not have fit at the end of `prev` (so the typesetter wrapped it), the new line
 * is not indented, and there is no gap or change of type size between them.
 */
function continues(prev, prevEdge, line, edge, samePage, ocr, running) {
  const size = line.y1 - line.y0
  const prevSize = prev.y1 - prev.y0
  // Recognised line boxes vary in height with the letters on them, so OCR gives no type size.
  // Box heights wobble with the glyphs on a line (Latin letters, ►); a heading differs by more.
  if (!ocr && Math.abs(size - prevSize) > prevSize * 0.25) return false
  // A contents line: dot leaders running to the page number at the right edge.
  if (/[.…·．]{4,}\s*\d+$/.test(prev.text)) return false
  if (line.x0 > edge.left + size * 0.8) return false
  if (samePage && line.y0 - prev.y1 > size * 1.2) return false
  // Across a page break, the page's last line may stop short with its sentence still open: when
  // the line above ran on into it (so it is the tail of running text, not a verse or a heading),
  // the paragraph carries on into the next page.
  if (!samePage && running && !/[。！？!?.…”"」』）)：:；;]$/.test(prev.text.trim())) return true
  // A sentence that ends short of the edge ends its paragraph: full lines are justified to the edge.
  if (/[。！？…”」』]$/.test(prev.text.trim()) && prev.x1 < prevEdge.right - size * 0.5) return false
  // The first unbreakable run of the next line: one CJK character (Chinese breaks anywhere), else
  // the leading Latin/symbol run up to a space or the first CJK character (►►所以 breaks after ►►).
  const lead = line.text.match(/^[^\s\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef\u3000-\u303f]+/)?.[0]
  const word = !lead ? size : lead.length * size * 0.5 + size * 0.3
  return prev.x1 + word > prevEdge.right - size * 0.3
}

/** All pages as paragraphs `[{ text, page, size, lines }]`, paragraphs running across page breaks joined. */
function paragraphs(pages, ocr) {
  const edges = margins(pages)
  const out = []
  let prev = null
  for (const [i, page] of pages.entries()) {
    for (const line of page.lines) {
      if (prev && continues(prev.line, edges.get(prev.line), line, edges.get(line), prev.page === i, ocr, out.at(-1).lines > 1)) {
        const last = out.at(-1)
        last.text = glue(last.text, line.text)
        last.lines += 1
      } else {
        const size = line.y1 - line.y0
        const { left, right } = edges.get(line)
        const before = line.x0 - left
        const centered = before > size * 2 && Math.abs(before - (right - line.x1)) < size * 1.5
        out.push({ text: line.text, page: i, size, lines: 1, centered })
      }
      prev = { line, page: i }
    }
  }
  return out
}

/** A contents line or heading reduced to compare: no numbering, spaces, dot leaders or page number. */
const tocKey = (text) => text.replace(/[\s.…·．]+\d*$/, '').replace(/^[\d一二三四五六七八九十]+[、.．]/, '').replace(/\s+/g, '')

/**
 * Headings, for a PDF without usable bookmarks: short one-line paragraphs listed in the book's own
 * printed contents near the front, set larger than the body text, or centred. A kind found more
 * than once every other page is verse or captions, not headings, and is left out.
 */
function headingMarks(paras, starts, pages, ocr) {
  const body = mode(paras.flatMap((p) => Array(p.lines).fill(Math.round(p.size * 2) / 2)))
  const front = new Set(paras.slice(0, Math.ceil(paras.length * 0.2)).map((p) => tocKey(p.text)))
  const seen = new Set()
  const last = new Map(paras.map((p, i) => [tocKey(p.text), i]))
  const kinds = { contents: [], larger: [], centred: [] }
  for (const [i, p] of paras.entries()) {
    const key = tocKey(p.text)
    // The first time a contents line shows up is the contents itself.
    const listed = front.has(key) && seen.has(key)
    seen.add(key)
    // A line of the contents is not a heading, whatever its type size.
    if (p.lines > 1 || p.text.length > 40 || /[。，；,;.]$/.test(p.text) || (front.has(key) && last.get(key) > i)) continue
    const mark = { title: p.text.trim(), at: starts[i] }
    if (listed && key.length >= 2) kinds.contents.push(mark)
    else if (p.size >= body * (ocr ? 1.4 : 1.15)) kinds.larger.push(mark)
    else if (p.centered) kinds.centred.push(mark)
  }
  return Object.values(kinds).filter((marks) => marks.length <= pages / 2).flat().sort((a, b) => a.at - b.at)
}

/** Bookmarks as `[{ title, page }]` (1-based), every level, from `pdftohtml -xml`. */
async function readOutline(file) {
  const xml = await run('pdftohtml', ['-xml', '-i', '-q', '-stdout', '-f', '1', '-l', '1', file]).catch(() => '')
  return [...xml.matchAll(/<item page="(\d+)">([\s\S]*?)<\/item>/g)]
    .map((m) => ({ page: Number(m[1]), title: decodeEntities(m[2].replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim() }))
    .filter((item) => item.title)
}

/**
 * Bookmarks often come from tools, not authors: one per scanned page, or the names of the files
 * merged into the PDF. Those share a long prefix or outnumber the pages; such outlines are ignored.
 */
function usable(outline, pages) {
  if (outline.length < 2 || outline.length > pages) return false
  const prefixes = new Map()
  for (const { title } of outline) if (title.length >= 6) prefixes.set(title.slice(0, 6), (prefixes.get(title.slice(0, 6)) ?? 0) + 1)
  return Math.max(0, ...prefixes.values()) < outline.length * 0.5
}

/** Metadata titles are often a scanner's or a word processor's. */
const realTitle = (title) => title && !/^(KM_|untitled|microsoft|scan|扫描|document)|\.(pdf|docx?|txt)$/i.test(title) ? title : null

const OCR_SOURCE = join(dirname(fileURLToPath(import.meta.url)), 'ocr.swift')

/** The compiled OCR helper, built once per version of ocr.swift into the user's cache. */
async function ocrHelper() {
  if (process.platform !== 'darwin') throw new Error('这个 PDF 是扫描版，识别文字要在 macOS 上导入')
  const source = await readFile(OCR_SOURCE)
  const bin = join(homedir(), 'Library', 'Caches', 'dsh-reader', `ocr-${createHash('sha1').update(source).digest('hex').slice(0, 10)}`)
  try { await access(bin); return bin } catch { /* not built yet */ }
  await mkdir(dirname(bin), { recursive: true })
  await new Promise((resolve, reject) => execFile('swiftc', ['-O', '-o', `${bin}.tmp`, OCR_SOURCE], (error, _, stderr) => {
    if (error?.code === 'ENOENT') reject(new Error('识别扫描版需要 Xcode 命令行工具，先在终端运行：xcode-select --install'))
    else if (error) reject(new Error(`文字识别工具编译失败：${String(stderr || error.message).split('\n')[0]}`))
    else resolve()
  }))
  await rename(`${bin}.tmp`, bin)
  return bin
}

/** Pages of a scanned PDF as pdftotext-like pages, through Vision; `onProgress(done, total)` after each page. */
async function ocrPages(file, onProgress) {
  const child = spawn(await ocrHelper(), [file], { stdio: ['ignore', 'pipe', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += chunk })
  const exited = new Promise((resolve) => child.on('close', resolve))
  const pages = []
  for await (const row of createInterface({ input: child.stdout })) {
    const page = JSON.parse(row)
    // Vision lists lines roughly top to bottom; make it exact, left to right within a row.
    page.lines = page.lines.map((l) => ({ ...l, flow: 0 })).sort((a, b) => Math.abs(a.y0 - b.y0) < (a.y1 - a.y0) / 2 ? a.x0 - b.x0 : a.y0 - b.y0)
    pages[page.page] = page
    onProgress?.(pages.filter(Boolean).length, page.pages)
  }
  if (await exited !== 0) throw new Error(`文字识别失败：${stderr.trim().split('\n')[0] || '未知错误'}`)
  return Array.from(pages, (page) => page ?? { width: 0, lines: [] })
}

const textChars = (pages) => pages.reduce((n, p) => n + p.lines.reduce((m, l) => m + l.text.replace(/\s/g, '').length, 0), 0)

/**
 * `{ title, text, marks, headings }`: `marks` from the bookmarks, `headings` found from the layout.
 * `onProgress(done, total)` reports pages recognised when the PDF is scanned.
 */
export async function readPdf(buffer, { onProgress } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-reader-pdf-'))
  try {
    const file = join(dir, 'book.pdf')
    await writeFile(file, buffer)
    const xhtml = await run('pdftotext', ['-bbox-layout', '-q', file, '-'])
    let pages = readPages(xhtml)
    const enough = (pages) => textChars(pages) >= Math.max(200, pages.length * 30)
    const ocr = !enough(pages)
    if (ocr) {
      pages = await ocrPages(file, onProgress)
      if (!enough(pages)) throw new Error('这个 PDF 是扫描版，但识别不出文字')
    }
    dropFurniture(pages)

    const paras = paragraphs(pages, ocr)
    let text = ''
    const starts = paras.map((p) => { const at = text.length; text += `${p.text}\n`; return at })
    // Where each page's text starts: its first paragraph, or the next page's if it begins none.
    const pageStarts = Array(pages.length + 1).fill(text.length)
    for (let i = paras.length - 1; i >= 0; i -= 1) pageStarts[paras[i].page] = starts[i]
    for (let i = pages.length - 1; i >= 0; i -= 1) pageStarts[i] = Math.min(pageStarts[i], pageStarts[i + 1])

    const outline = await readOutline(file)
    const fromOutline = usable(outline, pages.length)
      ? outline.filter((item) => item.page <= pages.length).map(({ title, page }) => {
        const start = pageStarts[page - 1]
        const end = pageStarts[page]
        // Start at the line with the heading if the page shows it, else at the top of the page.
        const key = title.replace(/\s+/g, '').slice(0, 8)
        let at = start
        for (let i = start; i < end; i = text.indexOf('\n', i) + 1 || end) {
          if (text.slice(i, text.indexOf('\n', i)).replace(/\s+/g, '').startsWith(key)) { at = i; break }
        }
        return { title, at }
      }).sort((a, b) => a.at - b.at).filter((m, i, all) => i === 0 || m.at > all[i - 1].at)
      : []
    const title = realTitle(decodeEntities(xhtml.match(/<title>([^<]*)<\/title>/)?.[1] ?? '').trim())
    return { title, text, marks: fromOutline, headings: headingMarks(paras, starts, pages.length, ocr) }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
