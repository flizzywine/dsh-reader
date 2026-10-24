// EPUB → plain text, so an EPUB becomes the same book folder a TXT does.
//
// The book's own table of contents (EPUB 3 nav, else EPUB 2 NCX) gives the chapter
// marks; without one, every spine document is a mark. Pictures and styling are dropped:
// the reader only shows text.

import { inflateRawSync } from 'node:zlib'
import { posix } from 'node:path'

/** Read every file in a ZIP archive: `Map<path, Buffer>`. Stored and deflated entries only, no ZIP64. */
function unzip(buffer) {
  let end = buffer.length - 22
  while (end >= Math.max(0, buffer.length - 65557) && buffer.readUInt32LE(end) !== 0x06054b50) end -= 1
  if (end < 0 || buffer.readUInt32LE(end) !== 0x06054b50) throw new Error('不是有效的 EPUB 文件')
  const files = new Map()
  let at = buffer.readUInt32LE(end + 16)
  for (let n = buffer.readUInt16LE(end + 10); n > 0; n -= 1) {
    if (buffer.readUInt32LE(at) !== 0x02014b50) throw new Error('EPUB 文件损坏')
    const method = buffer.readUInt16LE(at + 10)
    const size = buffer.readUInt32LE(at + 20)
    const nameLength = buffer.readUInt16LE(at + 28)
    const local = buffer.readUInt32LE(at + 42)
    const name = buffer.toString('utf8', at + 46, at + 46 + nameLength)
    at += 46 + nameLength + buffer.readUInt16LE(at + 30) + buffer.readUInt16LE(at + 32)
    if (name.endsWith('/')) continue
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28)
    const data = buffer.subarray(start, start + size)
    if (method === 0) files.set(name, data)
    else if (method === 8) files.set(name, inflateRawSync(data))
  }
  return files
}

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', middot: '·', bull: '•', times: '×', copy: '©' }

function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name) =>
    name[0] === '#' ? String.fromCodePoint(Number.parseInt(name.slice(name[1] === 'x' || name[1] === 'X' ? 2 : 1), name[1] === 'x' || name[1] === 'X' ? 16 : 10))
      : NAMED[name.toLowerCase()] ?? whole)
}

const attr = (tag, name) => {
  const m = tag.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'))
  return m ? decodeEntities(m[2] ?? m[3]) : null
}
const plain = (html) => decodeEntities(html.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim()

/** Resolve an href found in `from` to an archive path, and split off its #fragment. */
function resolve(from, href) {
  const [path, fragment = null] = href.split('#')
  const file = path ? posix.normalize(posix.join(posix.dirname(from), decodeURIComponent(path))) : from
  return { file, fragment: fragment ? decodeURIComponent(fragment) : null }
}

const BLOCK = new Set(['p', 'div', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'ul', 'ol', 'dl', 'dt', 'dd', 'tr', 'table', 'blockquote', 'pre', 'section', 'article', 'aside', 'header', 'footer', 'figure', 'figcaption', 'nav', 'body'])
const SKIP = new Set(['head', 'script', 'style', 'svg', 'rt', 'rp'])
const TOKEN = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<[!?][^>]*>|<(\/?)([a-zA-Z][\w:-]*)([^>]*)>|([^<]+)/g

/** One XHTML document as lines of text, plus where each element id starts in that text. */
function htmlText(html) {
  let out = ''
  const ids = new Map()
  let skip = 0
  const newline = () => {
    out = out.trimEnd()
    if (out && !out.endsWith('\n')) out += '\n'
  }
  for (const [, close, rawName, rest, text] of html.matchAll(TOKEN)) {
    if (text !== undefined) {
      if (skip) continue
      let piece = decodeEntities(text).replace(/\s+/g, ' ')
      if (!out || out.endsWith('\n')) piece = piece.trimStart()
      out += piece
      continue
    }
    if (!rawName) continue
    const name = rawName.toLowerCase().replace(/^.*:/, '')
    const selfClosing = rest.trimEnd().endsWith('/')
    if (SKIP.has(name)) {
      if (!selfClosing) skip += close ? -1 : 1
      skip = Math.max(skip, 0)
      continue
    }
    if (skip) continue
    if (BLOCK.has(name)) newline()
    const id = close ? null : attr(rest, 'id') ?? attr(rest, 'name')
    if (id && !ids.has(id)) ids.set(id, out.length)
  }
  newline()
  return { text: out, ids }
}

/** Chapter entries `{ title, file, fragment }` in reading order from the EPUB 3 nav document. */
function navEntries(path, xml) {
  const nav = [...xml.matchAll(/<nav\b([^>]*)>([\s\S]*?)<\/nav>/gi)].find((m) => /toc/.test(attr(m[1], 'epub:type') ?? ''))
  if (!nav) return []
  return [...nav[2].matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)]
    .filter((m) => attr(m[1], 'href'))
    .map((m) => ({ title: plain(m[2]), ...resolve(path, attr(m[1], 'href')) }))
}

/** Chapter entries from an EPUB 2 NCX: every navPoint in document order, nested ones included. */
function ncxEntries(path, xml) {
  return [...xml.matchAll(/<navPoint\b[^>]*>\s*<navLabel\b[^>]*>([\s\S]*?)<\/navLabel>\s*<content\b([^>]*)>/gi)]
    .filter((m) => attr(m[2], 'src'))
    .map((m) => ({ title: plain(m[1]), ...resolve(path, attr(m[2], 'src')) }))
}

/** True when a book file (not just a font) is encrypted, i.e. DRM. */
function encrypted(files) {
  const xml = files.get('META-INF/encryption.xml')?.toString('utf8')
  if (!xml) return false
  return [...xml.matchAll(/<(?:\w+:)?CipherReference\b([^>]*)>/gi)].some((m) => !/\.(otf|ttf|woff2?)$/i.test(attr(m[1], 'URI') ?? ''))
}

/**
 * Read an EPUB into `{ title, text, marks }`: the whole book as text and the chapter starts
 * `[{ title, at }]` in that text, ready for books.js to cut into chapters.
 */
export function readEpub(buffer) {
  const files = unzip(buffer)
  if (encrypted(files)) throw new Error('这本 EPUB 有 DRM 加密，读不出正文')
  const read = (path) => files.get(path)?.toString('utf8')
  const container = read('META-INF/container.xml') ?? ''
  const opfPath = attr(container.match(/<rootfile\b[^>]*>/i)?.[0] ?? '', 'full-path')
  const opf = opfPath && read(opfPath)
  if (!opf) throw new Error('不是有效的 EPUB 文件')

  const manifest = new Map()
  for (const [tag] of opf.matchAll(/<item\b[^>]*>/gi)) {
    manifest.set(attr(tag, 'id'), { path: resolve(opfPath, attr(tag, 'href') ?? '').file, type: attr(tag, 'media-type') ?? '', props: attr(tag, 'properties') ?? '' })
  }
  const spine = [...opf.matchAll(/<itemref\b[^>]*>/gi)]
    .map(([tag]) => manifest.get(attr(tag, 'idref')))
    .filter((item) => item && /html/.test(item.type) && files.has(item.path))
    .map((item) => item.path)

  let text = ''
  const starts = new Map()
  const ids = new Map()
  for (const path of spine) {
    if (starts.has(path)) continue
    const doc = htmlText(read(path))
    starts.set(path, text.length)
    ids.set(path, doc.ids)
    text += doc.text
  }
  if (!text.trim()) throw new Error('这本 EPUB 里没有读出正文')

  const items = [...manifest.values()]
  const nav = items.find((item) => /\bnav\b/.test(item.props))
  const ncx = manifest.get(attr(opf.match(/<spine\b[^>]*>/i)?.[0] ?? '', 'toc')) ?? items.find((item) => item.type === 'application/x-dtbncx+xml')
  let entries = nav && read(nav.path) ? navEntries(nav.path, read(nav.path)) : []
  if (entries.length === 0 && ncx && read(ncx.path)) entries = ncxEntries(ncx.path, read(ncx.path))

  let marks = entries
    .filter((e) => starts.has(e.file))
    .map((e) => ({ title: e.title, at: starts.get(e.file) + (e.fragment ? ids.get(e.file).get(e.fragment) ?? 0 : 0) }))
  if (marks.length === 0) {
    marks = spine.filter((path, i) => spine.indexOf(path) === i).map((path) => {
      const at = starts.get(path)
      return { title: text.slice(at, text.indexOf('\n', at)).trim().slice(0, 30), at }
    })
  }
  marks = marks.map((m, i) => ({ ...m, title: m.title || `第 ${i + 1} 节` })).sort((a, b) => a.at - b.at)

  const title = plain(opf.match(/<dc:title\b[^>]*>([\s\S]*?)<\/dc:title>/i)?.[1] ?? '') || null
  return { title, text, marks }
}
