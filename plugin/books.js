// Book storage: every book is a visible folder under library/, split once by this program so the
// agent reads one chapter file at a time instead of the whole novel.
//
//   library/<书名>/原文.txt / 原文.epub      the imported file, untouched
//   library/<书名>/目录.json                 { title, chapters: [{ title, file, chars }] }
//   library/<书名>/章节/0001 第一章 xxx.txt
//   library/<书名>/总结/0001 第一章 xxx.md    written by the agent through save_summary
//   library/<书名>/划线.json                 { next, highlights: [{ id, chapter, at, quote, prefix, suffix, note, by, createdAt }],
//                                              notes: [{ id, note, chapter, createdAt }] }
//                                            The user's 笔记 are the notes on highlights plus `notes`, the
//                                            ones about the whole book; their `chapter` is only where the
//                                            user was reading when writing, not an anchor.
//                                            `at` is the quote's offset in the chapter file; prefix/suffix
//                                            (after W3C's TextQuoteSelector) find it again if the text moves.
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { readEpub } from './epub.js'

export const SOURCE_FILE = '原文.txt'
export const SOURCE_EPUB = '原文.epub'
export const TOC_FILE = '目录.json'
export const CHAPTER_DIR = '章节'
export const SUMMARY_DIR = '总结'
export const HIGHLIGHT_FILE = '划线.json'

/** A chapter longer than this is cut into parts; a book without headings is cut into chunks of PART_CHARS. */
const MAX_CHAPTER_CHARS = 20000
const PART_CHARS = 8000
/** A heading whose body is shorter than this (a 卷 title right before its first 章) merges into the next. */
const MIN_BODY_CHARS = 50

/** Chapter headings common in Chinese web novels: 第X章/回/节/卷, 序章, 楔子, 番外… */
const HEADING = /^[ \t　]*((第[0-9零一二三四五六七八九十百千万两〇]+[章回节卷集部篇][^\n]{0,30})|((序章|序言|楔子|引子|尾声|后记|番外)[^\n]{0,30}))[ \t　]*$/gm
const CHINESE_DIGITS = '一二三四五六七八九十'

/** Decode UTF-8 (with or without BOM), falling back to GB18030 for older TXT files. */
export function decode(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^﻿/, '')
  } catch {
    return new TextDecoder('gb18030').decode(buffer)
  }
}

const countChars = (text) => text.replace(/\s/g, '').length

/** Cut text at paragraph breaks into pieces of about `size` characters. */
function chunk(text, size) {
  const pieces = []
  let rest = text
  while (rest.length > size * 1.5) {
    const cut = rest.lastIndexOf('\n', size) > size / 2 ? rest.lastIndexOf('\n', size) : size
    pieces.push(rest.slice(0, cut))
    rest = rest.slice(cut)
  }
  if (rest.trim()) pieces.push(rest)
  return pieces
}

const partName = (i) => i < CHINESE_DIGITS.length ? CHINESE_DIGITS[i] : String(i + 1)

/** Split a whole book into `[{ title, text }]`, text including its heading line. */
export function splitBook(text) {
  const marks = [...text.matchAll(HEADING)].map((m) => ({ title: m[1].trim(), at: m.index }))
  if (marks.length === 0) return chunk(text, PART_CHARS).map((piece, i) => ({ title: `第 ${i + 1} 节`, text: piece }))
  return cutAtMarks(text, marks)
}

/**
 * Cut text at chapter starts `[{ title, at }]` (sorted): text before the first one becomes 开篇,
 * a near-empty part (a 卷 title) merges into the next, and an overlong one is cut into parts.
 */
function cutAtMarks(text, marks) {
  marks = [...marks]
  if (countChars(text.slice(0, marks[0].at)) > 0) marks.unshift({ title: '开篇', at: 0 })
  const raw = marks.map((m, i) => ({ title: m.title, text: text.slice(m.at, marks[i + 1]?.at ?? text.length) }))
  const merged = []
  let carry = null
  for (const part of raw) {
    const body = part.text.slice(part.text.indexOf('\n') + 1)
    if (carry) {
      if (carry.title !== '开篇') part.title = `${carry.title} · ${part.title}`
      part.text = carry.text + part.text
      carry = null
    }
    if (countChars(body) < MIN_BODY_CHARS && part !== raw.at(-1)) { carry = part; continue }
    merged.push(part)
  }
  return merged.flatMap((part) => countChars(part.text) <= MAX_CHAPTER_CHARS ? [part]
    : chunk(part.text, PART_CHARS).map((piece, i) => ({ title: `${part.title}（${partName(i)}）`, text: piece })))
}

/** File types a book can be imported from. */
export const BOOK_TYPES = ['.txt', '.epub']

/**
 * Read an imported file into `{ title, text, parts, source }`: `title` is the book's own
 * (EPUB metadata) or null, `source` the file name the original is kept under.
 */
export function parseBook(ext, buffer) {
  if (ext === '.epub') {
    const { title, text, marks } = readEpub(buffer)
    // A one-entry contents list says nothing about chapters; look for headings as in a TXT.
    return { title, text, parts: marks.length > 1 ? cutAtMarks(text, marks) : splitBook(text), source: SOURCE_EPUB }
  }
  const text = decode(buffer)
  return { title: null, text, parts: splitBook(text), source: SOURCE_FILE }
}

/** File-system safe chapter file stem: `0001 第一章 标题`. */
function chapterStem(index, title) {
  const clean = title.replace(/[\\/:*?"<>|\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40)
  return `${String(index + 1).padStart(4, '0')} ${clean}`.trim()
}

export function safeName(name) {
  const clean = String(name ?? '').replace(/[\\/:*?"<>|]/g, '').trim()
  if (!clean || clean.startsWith('.')) throw new Error('书名不能为空')
  return clean
}

/** Write 原文 + 章节 + 目录 for a new book folder from `parseBook`. Existing chapter files are replaced. */
export async function writeBook(library, id, buffer, { text, parts, source }) {
  const dir = join(library, id)
  await mkdir(join(dir, CHAPTER_DIR), { recursive: true })
  await mkdir(join(dir, SUMMARY_DIR), { recursive: true })
  await writeFile(join(dir, source), buffer)
  const chapters = []
  for (const [i, part] of parts.entries()) {
    const file = `${chapterStem(i, part.title)}.txt`
    await writeFile(join(dir, CHAPTER_DIR, file), part.text)
    chapters.push({ title: part.title, file, chars: countChars(part.text) })
  }
  const toc = { title: id, chars: countChars(text), chapters }
  await writeFile(join(dir, TOC_FILE), JSON.stringify(toc, null, 2))
  return toc
}

/**
 * Move books still lying flat in library/ (`书名.txt`, `书名.epub`) into their folders.
 * @returns a map from the old id (`书名.txt`) to the new folder id, for rewriting bindings.
 */
export async function migrateFlatBooks(library) {
  const moved = new Map()
  for (const name of await readdir(library)) {
    const ext = extname(name).toLowerCase()
    if (!BOOK_TYPES.includes(ext)) continue
    const id = safeName(basename(name, extname(name)))
    try { await stat(join(library, id)); continue } catch { /* folder is free */ }
    const buffer = await readFile(join(library, name))
    await writeBook(library, id, buffer, parseBook(ext, buffer))
    await rm(join(library, name))
    moved.set(name, id)
  }
  return moved
}

export async function listBooks(library) {
  const books = []
  for (const entry of await readdir(library, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    try {
      const toc = await readToc(library, entry.name)
      books.push({ id: entry.name, title: toc.title, chars: toc.chars, chapters: toc.chapters.length })
    } catch { /* not a book folder */ }
  }
  return books.sort((a, b) => a.title.localeCompare(b.title, 'zh'))
}

export async function readToc(library, id) {
  return JSON.parse(await readFile(join(library, safeName(id), TOC_FILE), 'utf8'))
}

function chapterAt(toc, index) {
  const chapter = toc.chapters[index]
  if (!Number.isInteger(index) || chapter === undefined) throw new Error(`没有第 ${index + 1} 节（共 ${toc.chapters.length} 节）`)
  return chapter
}

/**
 * A chapter's text with line endings made \n. Offsets everywhere (read_chapter paging, highlights,
 * the reader's selection) count in this text, so CRLF files and the page agree.
 */
export async function readChapter(library, id, index) {
  const toc = await readToc(library, id)
  const chapter = chapterAt(toc, index)
  const text = await readFile(join(library, id, CHAPTER_DIR, chapter.file), 'utf8')
  return { ...chapter, index, text: text.replace(/\r\n?/g, '\n') }
}

const summaryFile = (chapter) => chapter.file.replace(/\.txt$/, '.md')

export async function readSummary(library, id, index) {
  const chapter = chapterAt(await readToc(library, id), index)
  try { return await readFile(join(library, id, SUMMARY_DIR, summaryFile(chapter)), 'utf8') } catch { return null }
}

export async function writeSummary(library, id, index, text) {
  const chapter = chapterAt(await readToc(library, id), index)
  const path = join(library, id, SUMMARY_DIR, summaryFile(chapter))
  await mkdir(join(library, id, SUMMARY_DIR), { recursive: true })
  // Write beside, then rename: a crash never leaves half a summary.
  const body = String(text).trim()
  await writeFile(`${path}.tmp`, `${body.startsWith('# ') ? '' : `# ${chapter.title}\n\n`}${body}\n`)
  await rename(`${path}.tmp`, path)
  return { file: `${id}/${SUMMARY_DIR}/${summaryFile(chapter)}` }
}

/** Which chapters already have a summary file. */
export async function summarized(library, id) {
  try { return new Set(await readdir(join(library, id, SUMMARY_DIR))) } catch { return new Set() }
}

export { summaryFile }

async function readHighlightFile(library, id) {
  try { return JSON.parse(await readFile(join(library, safeName(id), HIGHLIGHT_FILE), 'utf8')) } catch { return {} }
}

export async function readHighlights(library, id) {
  return (await readHighlightFile(library, id)).highlights ?? []
}

/** Notes about the whole book, newest first. */
export async function readBookNotes(library, id) {
  return ((await readHighlightFile(library, id)).notes ?? []).slice().reverse()
}

/** One write at a time per process, so parallel tool calls never drop each other's highlights. */
let highlightWrites = Promise.resolve()

/**
 * Read-modify-write a book's highlights and notes. `change` gets the highlight list (sorted by place
 * in the book afterwards), a `newId(prefix)` that never reuses a deleted id, and the whole-book notes
 * list; it returns whatever the caller wants back.
 */
export function updateHighlights(library, id, change) {
  const work = highlightWrites.then(async () => {
    const file = await readHighlightFile(library, id)
    const list = file.highlights ?? []
    const notes = file.notes ?? []
    let next = file.next ?? [...list, ...notes].reduce((max, h) => Math.max(max, Number(String(h.id).slice(1)) || 0), 0) + 1
    const result = await change(list, (prefix = 'h') => `${prefix}${next++}`, notes)
    list.sort((a, b) => a.chapter - b.chapter || a.at - b.at)
    const path = join(library, safeName(id), HIGHLIGHT_FILE)
    await writeFile(`${path}.tmp`, JSON.stringify({ next, highlights: list, notes }, null, 2))
    await rename(`${path}.tmp`, path)
    return result
  })
  highlightWrites = work.catch(() => {})
  return work
}

/** Characters of context kept on each side of a highlight. */
const CONTEXT_CHARS = 16

/**
 * Highlight chapter `index` from `at` to `end` (file offsets; may span paragraphs). Marking the same
 * span again returns the existing highlight. `by` is 'user' or 'agent'; only the user writes notes.
 */
export async function addHighlight(library, id, { index, at, end, by, note = '' }) {
  const chapter = await readChapter(library, id, index)
  if (!Number.isInteger(at) || !Number.isInteger(end) || at < 0 || end > chapter.text.length || end <= at) throw new Error('划线范围不对')
  const quote = chapter.text.slice(at, end)
  if (!quote.trim()) throw new Error('不能给空白划线')
  return updateHighlights(library, id, (list, newId) => {
    const same = list.find((h) => h.chapter === index && h.at === at && h.quote === quote)
    if (same) return { highlight: same, existed: true }
    const highlight = {
      id: newId(), chapter: index, at, quote,
      prefix: chapter.text.slice(Math.max(0, at - CONTEXT_CHARS), at), suffix: chapter.text.slice(end, end + CONTEXT_CHARS),
      note: String(note).trim(), by, createdAt: new Date().toISOString(),
    }
    list.push(highlight)
    return { highlight, existed: false }
  })
}
