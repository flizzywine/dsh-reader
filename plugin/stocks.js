// US stock data for the stock tools: daily candles from Yahoo's chart API (Nasdaq.com's history
// when Yahoo fails, then FMP's daily prices for the stocks FMP covers), the company profile and
// (for the stocks FMP's free plan covers) clean quarterly statements from Financial Modeling Prep,
// and otherwise the same statements rebuilt from SEC EDGAR's XBRL company facts.
//
// Every answer is cached under data/stock-cache/ for a few hours; when a source fails (Yahoo
// rate-limits, say) the last cached answer is used and marked stale rather than nothing at all.
// Nothing here guesses: a figure a source does not give stays null and shows as —.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const HOUR = 3600 * 1000
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36'
// data.sec.gov asks for a descriptive agent; it does not need an email for the company-facts API.
const SEC_UA = 'dsh-reader/0.1 (personal research tool)'

const RANGE_DAYS = { '1m': 31, '3m': 92, '6m': 183, '1y': 366, '2y': 731, '5y': 1827 }

/** Daily candles folded into weeks (Monday to Friday): first open, highest high, lowest low, last close, summed volume. */
function weekly(days) {
  const weeks = new Map()
  for (const [t, o, hi, lo, c, v] of days) {
    const monday = t - ((new Date(t).getUTCDay() + 6) % 7) * 86400000
    const w = weeks.get(monday)
    if (!w) weeks.set(monday, [t, o, hi, lo, c, v])
    else { w[2] = Math.max(w[2], hi); w[3] = Math.min(w[3], lo); w[4] = c; w[5] += v }
  }
  return [...weeks.values()]
}

export const RANGES = { '1m': ['1mo', '1d'], '3m': ['3mo', '1d'], '6m': ['6mo', '1d'], '1y': ['1y', '1d'], '2y': ['2y', '1d'], '5y': ['5y', '1wk'] }

export function cleanSymbol(symbol) {
  const s = String(symbol ?? '').trim().toUpperCase().replace(/^\$/, '')
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(s)) throw new Error(`股票代码不对：${symbol}（用美股代码，比如 AAPL、ISRG、BRK-B）`)
  return s
}

/** A small JSON cache: `cached(key, ttl, load)` returns `{ value, stale, at }`. */
function makeCache(dir) {
  const path = (key) => join(dir, `${key.replace(/[^A-Za-z0-9._-]/g, '_')}.json`)
  return async function cached(key, ttl, load) {
    let entry = null
    try { entry = JSON.parse(await readFile(path(key), 'utf8')) } catch { /* not cached */ }
    if (entry && Date.now() - entry.at < ttl) return { value: entry.value, stale: false, at: entry.at }
    try {
      const value = await load()
      await mkdir(dir, { recursive: true })
      await writeFile(`${path(key)}.tmp`, JSON.stringify({ at: Date.now(), value }))
      await rename(`${path(key)}.tmp`, path(key))
      return { value, stale: false, at: Date.now() }
    } catch (error) {
      if (entry) return { value: entry.value, stale: true, at: entry.at, error: String(error?.message ?? error) }
      throw error
    }
  }
}

async function getJson(url, { headers = {}, what }) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(20000) })
  if (res.status === 429) throw new Error(`${what}：请求太频繁，被限流了，过几分钟再试`)
  if (!res.ok) {
    const error = new Error(`${what}：HTTP ${res.status}`)
    error.status = res.status
    throw error
  }
  return res.json()
}

/** Daily (or weekly) candles: `{ symbol, name, currency, exchange, candles: [[t, o, h, l, c, v]] }`, t in ms. */
async function yahooChart(symbol, range) {
  const [r, interval] = RANGES[range]
  let lastError
  // query1 and query2 are rate-limited separately.
  for (const host of ['query1', 'query2']) {
    try {
      const data = await getJson(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${r}&interval=${interval}&includePrePost=false`, { headers: { 'user-agent': BROWSER_UA }, what: 'Yahoo 行情' })
      const result = data?.chart?.result?.[0]
      if (!result) throw new Error(`Yahoo 行情：找不到 ${symbol}${data?.chart?.error?.description ? `（${data.chart.error.description}）` : ''}`)
      const q = result.indicators?.quote?.[0] ?? {}
      const candles = (result.timestamp ?? []).map((t, i) => [t * 1000, q.open?.[i], q.high?.[i], q.low?.[i], q.close?.[i], q.volume?.[i] ?? 0])
        .filter((c) => [c[1], c[2], c[3], c[4]].every((v) => typeof v === 'number'))
        .map(([t, ...rest]) => [t, ...rest.map((v, i) => i < 4 ? Math.round(v * 10000) / 10000 : v)])
      if (candles.length === 0) throw new Error(`Yahoo 行情：${symbol} 没有数据`)
      const meta = result.meta ?? {}
      return { symbol, name: meta.longName ?? meta.shortName ?? symbol, currency: meta.currency ?? 'USD', exchange: meta.fullExchangeName ?? meta.exchangeName ?? '', interval, candles, source: 'Yahoo Finance' }
    } catch (error) {
      lastError = error
      if (!/限流/.test(error.message)) throw error
    }
  }
  throw lastError
}

/** The FMP key the user saved in data/fmp-key, or null. */
async function fmpKey(dataDir) {
  try { return (await readFile(join(dataDir, 'fmp-key'), 'utf8')).trim() || null } catch { return null }
}

async function fmp(key, path, params) {
  const query = new URLSearchParams({ ...params, apikey: key })
  const data = await getJson(`https://financialmodelingprep.com/stable/${path}?${query}`, { what: 'FMP' })
  if (!Array.isArray(data)) throw new Error(`FMP：${data?.['Error Message'] ?? '返回格式不对'}`)
  return data
}

// ---- SEC company facts → quarterly statements ----

const day = (iso) => Date.parse(`${iso}T00:00:00Z`) / 86400000
const FORMS = /^(10-Q|10-K|20-F|40-F)(\/A)?$/

/** XBRL concepts per figure, in order of preference; US GAAP filers first, then IFRS (foreign filers). */
const CONCEPTS = {
  revenue: ['us-gaap:Revenues', 'us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax', 'us-gaap:RevenueFromContractWithCustomerIncludingAssessedTax', 'us-gaap:SalesRevenueNet', 'us-gaap:SalesRevenueGoodsNet', 'ifrs-full:Revenue', 'ifrs-full:RevenueFromContractsWithCustomers'],
  costOfRevenue: ['us-gaap:CostOfRevenue', 'us-gaap:CostOfGoodsAndServicesSold', 'us-gaap:CostOfGoodsSold', 'ifrs-full:CostOfSales'],
  grossProfit: ['us-gaap:GrossProfit', 'ifrs-full:GrossProfit'],
  operatingIncome: ['us-gaap:OperatingIncomeLoss', 'ifrs-full:ProfitLossFromOperatingActivities'],
  netIncome: ['us-gaap:NetIncomeLoss', 'us-gaap:NetIncomeLossAvailableToCommonStockholdersBasic', 'us-gaap:ProfitLoss', 'ifrs-full:ProfitLossAttributableToOwnersOfParent', 'ifrs-full:ProfitLoss'],
  epsDiluted: ['us-gaap:EarningsPerShareDiluted', 'us-gaap:EarningsPerShareBasicAndDiluted', 'ifrs-full:DilutedEarningsLossPerShare'],
  operatingCashFlow: ['us-gaap:NetCashProvidedByUsedInOperatingActivities', 'us-gaap:NetCashProvidedByUsedInOperatingActivitiesContinuingOperations', 'ifrs-full:CashFlowsFromUsedInOperatingActivities'],
  capex: ['us-gaap:PaymentsToAcquirePropertyPlantAndEquipment', 'us-gaap:PaymentsToAcquireProductiveAssets', 'ifrs-full:PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities'],
}
const EQUITY = ['us-gaap:StockholdersEquity', 'us-gaap:StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest', 'ifrs-full:EquityAttributableToOwnersOfParent', 'ifrs-full:Equity']

/** Facts of the first-listed concepts that report a period, keyed `start|end`; preference, then latest filing, wins. */
function durationFacts(facts, concepts) {
  const byPeriod = new Map()
  let currency = null
  for (const [rank, name] of concepts.entries()) {
    const [ns, concept] = name.split(':')
    const units = facts[ns]?.[concept]?.units
    if (!units) continue
    const [unit, list] = Object.entries(units)[0]
    currency ??= unit.split('/')[0]
    for (const f of list) {
      if (!f.start || !FORMS.test(f.form ?? '')) continue
      const key = `${f.start}|${f.end}`
      const old = byPeriod.get(key)
      if (!old || rank < old.rank || (rank === old.rank && f.filed > old.filed)) byPeriod.set(key, { start: f.start, end: f.end, val: f.val, filed: f.filed, rank })
    }
  }
  return { facts: [...byPeriod.values()], currency }
}

/**
 * Single quarters by end date. A 10-Q states its quarter directly (about 91 days) and often only
 * the year to date too; the quarter a filing states only as part of a year to date (and every
 * fourth quarter, which only the 10-K's full year carries) is the difference of two cumulative
 * figures with the same start.
 */
function quarters(list) {
  const out = new Map()
  for (const f of list) {
    const span = day(f.end) - day(f.start)
    if (span >= 80 && span <= 100) out.set(f.end, f.val)
  }
  const byStart = Map.groupBy(list, (f) => f.start)
  for (const group of byStart.values()) {
    group.sort((a, b) => a.end.localeCompare(b.end))
    for (let i = 1; i < group.length; i += 1) {
      const a = group[i - 1]
      const b = group[i]
      const span = day(b.end) - day(a.end)
      if (span >= 80 && span <= 100 && !out.has(b.end)) out.set(b.end, b.val - a.val)
    }
  }
  return out
}

function annuals(list) {
  const out = new Map()
  for (const f of list) {
    const span = day(f.end) - day(f.start)
    if (span >= 350 && span <= 380) out.set(f.end, f.val)
  }
  return out
}

function latestInstant(facts, concepts) {
  let best = null
  for (const name of concepts) {
    const [ns, concept] = name.split(':')
    const units = facts[ns]?.[concept]?.units
    if (!units) continue
    for (const f of Object.values(units)[0]) {
      if (!FORMS.test(f.form ?? '')) continue
      if (!best || f.end > best.end || (f.end === best.end && f.filed > best.filed)) best = f
    }
    if (best) break
  }
  return best ? { value: best.val, end: best.end } : null
}

const FIGURES = Object.keys(CONCEPTS)

/** Rows `{ end, revenue, … }` (ascending) from per-figure maps of end date → value. */
function rows(maps, ends) {
  return ends.map((end) => {
    const row = { end }
    for (const k of FIGURES) row[k] = maps[k].get(end) ?? null
    if (row.grossProfit === null && row.revenue !== null && row.costOfRevenue !== null) row.grossProfit = row.revenue - row.costOfRevenue
    row.freeCashFlow = row.operatingCashFlow !== null && row.capex !== null ? row.operatingCashFlow - row.capex : null
    // A fourth-quarter EPS is the year's less nine months': round off the subtraction's float noise.
    if (row.epsDiluted !== null) row.epsDiluted = Math.round(row.epsDiluted * 100) / 100
    delete row.costOfRevenue
    return row
  })
}

/** Statements from SEC EDGAR: the last 8 quarters, or the last 4 years for filers without quarterly XBRL. */
export async function secStatements(cik) {
  const id = String(cik).replace(/\D/g, '').padStart(10, '0')
  const data = await getJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${id}.json`, { headers: { 'user-agent': SEC_UA }, what: 'SEC EDGAR' })
  const facts = data.facts ?? {}
  let currency = null
  const q = {}
  const a = {}
  for (const k of FIGURES) {
    const found = durationFacts(facts, CONCEPTS[k])
    if (k === 'revenue' || (!currency && found.currency)) currency ??= found.currency
    q[k] = quarters(found.facts)
    a[k] = annuals(found.facts)
  }
  // Quarters the revenue line reports, newest 8; old ones from years the company stopped filing don't count.
  const recent = [...q.revenue.keys(), ...q.netIncome.keys()].sort()
  const latest = recent.at(-1)
  const quarterEnds = [...new Set(recent)].filter((end) => latest && day(latest) - day(end) < 800).slice(-8)
  const equity = latestInstant(facts, EQUITY)
  if (quarterEnds.length >= 2) return { period: 'quarter', currency: currency ?? 'USD', rows: rows(q, quarterEnds), equity: equity?.value ?? null }
  const yearEnds = [...new Set([...a.revenue.keys(), ...a.netIncome.keys()])].sort().slice(-4)
  if (yearEnds.length === 0) throw new Error('SEC EDGAR：这家公司没有可用的 XBRL 财务数据')
  return { period: 'annual', currency: currency ?? 'USD', rows: rows(a, yearEnds), equity: equity?.value ?? null }
}

/** The free plan's most quarters per request: enough for TTM and year-over-year growth. */
const FMP_QUARTERS = 5

/** Statements from FMP (free plan: some large caps only); throws with status 402 when not covered. */
export async function fmpStatements(key, symbol) {
  const [income, cash, balance] = await Promise.all([
    fmp(key, 'income-statement', { symbol, period: 'quarter', limit: FMP_QUARTERS }),
    fmp(key, 'cash-flow-statement', { symbol, period: 'quarter', limit: FMP_QUARTERS }),
    fmp(key, 'balance-sheet-statement', { symbol, period: 'quarter', limit: 1 }),
  ])
  if (income.length === 0) throw new Error('FMP：没有季度报表')
  const cashByDate = new Map(cash.map((c) => [c.date, c]))
  const num = (v) => typeof v === 'number' ? v : null
  const list = income.map((i) => {
    const c = cashByDate.get(i.date) ?? {}
    return {
      end: i.date,
      revenue: num(i.revenue), grossProfit: num(i.grossProfit), operatingIncome: num(i.operatingIncome), netIncome: num(i.netIncome), epsDiluted: num(i.epsDiluted),
      operatingCashFlow: num(c.operatingCashFlow), capex: typeof c.capitalExpenditure === 'number' ? -c.capitalExpenditure : null, freeCashFlow: num(c.freeCashFlow),
    }
  }).sort((x, y) => x.end.localeCompare(y.end))
  return { period: 'quarter', currency: income[0].reportedCurrency ?? 'USD', rows: list, equity: num(balance[0]?.totalStockholdersEquity) }
}

/** Sum of the last four quarters when they are consecutive, else null. */
function ttm(list, key) {
  const last = list.slice(-4)
  if (last.length < 4 || last.some((r) => r[key] === null)) return null
  for (let i = 1; i < 4; i += 1) if (day(last[i].end) - day(last[i - 1].end) > 100) return null
  return last.reduce((n, r) => n + r[key], 0)
}

export function stockData({ dataDir }) {
  const cached = makeCache(join(dataDir, 'stock-cache'))

  async function profile(symbol) {
    const key = await fmpKey(dataDir)
    if (!key) return null
    const { value } = await cached(`profile-${symbol}`, 12 * HOUR, async () => (await fmp(key, 'profile', { symbol }))[0] ?? null)
    return value
  }

  /** Price per unit of `from` in `to` (e.g. EUR → USD): the ECB reference rate, via frankfurter.dev. */
  async function fx(from, to) {
    if (!from || !to || from === to) return 1
    const { value } = await cached(`fx-${from}${to}`, 12 * HOUR, async () => {
      const data = await getJson(`https://api.frankfurter.dev/v1/latest?base=${encodeURIComponent(from)}&symbols=${encodeURIComponent(to)}`, { what: '汇率' })
      const rate = data?.rates?.[to]
      if (typeof rate !== 'number') throw new Error(`汇率：没有 ${from}→${to}`)
      return rate
    })
    return value
  }

  /** Candles from Nasdaq.com's price history (daily; weeks are folded here for 5y). */
  async function nasdaqChart(symbol, range) {
    const days = RANGE_DAYS[range]
    const to = new Date().toISOString().slice(0, 10)
    const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)
    // Nasdaq writes share classes with a dot: BRK.B.
    const data = await getJson(`https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol.replace('-', '.'))}/historical?assetclass=stocks&fromdate=${from}&todate=${to}&limit=9999`, { headers: { 'user-agent': BROWSER_UA, accept: 'application/json' }, what: 'Nasdaq 行情' })
    const rows = data?.data?.tradesTable?.rows
    if (!Array.isArray(rows) || rows.length === 0) throw new Error(`Nasdaq 行情：找不到 ${symbol}`)
    const n = (v) => Number(String(v).replace(/[$,]/g, ''))
    let candles = rows.map((r) => {
      const [m, d, y] = r.date.split('/')
      return [Date.parse(`${y}-${m}-${d}T00:00:00Z`), n(r.open), n(r.high), n(r.low), n(r.close), n(r.volume) || 0]
    }).filter((c) => c.slice(1, 5).every(Number.isFinite)).sort((a, b) => a[0] - b[0])
    const interval = RANGES[range][1]
    if (interval === '1wk') candles = weekly(candles)
    const p = await profile(symbol).catch(() => null)
    return { symbol, name: p?.companyName ?? symbol, currency: p?.currency ?? 'USD', exchange: p?.exchange ?? '', interval, candles, source: 'Nasdaq.com' }
  }

  /** Candles from FMP's daily prices, the last resort; only for the stocks FMP's plan covers. */
  async function fmpChart(symbol, range) {
    const key = await fmpKey(dataDir)
    if (!key) throw new Error('没有 FMP key')
    const days = RANGE_DAYS[range]
    const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)
    const list = await fmp(key, 'historical-price-eod/full', { symbol, from })
    const candles = list.map((d) => [Date.parse(`${d.date}T00:00:00Z`), d.open, d.high, d.low, d.close, d.volume ?? 0])
      .filter((c) => c.slice(1, 5).every((v) => typeof v === 'number')).sort((a, b) => a[0] - b[0])
    if (candles.length === 0) throw new Error(`FMP：${symbol} 没有行情`)
    const p = await profile(symbol).catch(() => null)
    return { symbol, name: p?.companyName ?? symbol, currency: p?.currency ?? 'USD', exchange: p?.exchange ?? '', interval: '1d', candles, source: 'FMP' }
  }

  return {
    async chart(symbol, range) {
      // Yahoo first; it is unofficial and rate-limits without warning, so then Nasdaq, then FMP.
      const result = await cached(`chart-${symbol}-${range}`, 4 * HOUR, () => yahooChart(symbol, range)
        .catch((error) => nasdaqChart(symbol, range).catch(() => { throw error }))
        .catch((error) => fmpChart(symbol, range).catch(() => { throw error })))
      return { ...result.value, range, stale: result.stale, at: result.at }
    },

    async fundamentals(symbol) {
      const p = await profile(symbol).catch(() => null)
      const key = await fmpKey(dataDir)
      const load = async () => {
        if (key) {
          try { return { source: 'FMP', ...await fmpStatements(key, symbol) } } catch (error) {
            if (error.status !== 402 && error.status !== 403) throw error
          }
        }
        if (!p?.cik) throw new Error(`找不到 ${symbol} 在 SEC 的公司编号${key ? '' : '（没配置 FMP key：在 data/fmp-key 里放一个）'}`)
        return { source: 'SEC EDGAR', ...await secStatements(p.cik) }
      }
      const result = await cached(`fundamentals-${symbol}`, 24 * HOUR, load)
      const st = result.value
      const price = p?.price ?? null
      const marketCap = p?.marketCap ?? null
      // Statements may be in another currency than the share price (foreign filers report in EUR, say).
      const rate = await fx(st.currency, p?.currency ?? 'USD').catch(() => null)
      const inPrice = (v) => v === null || rate === null ? null : v * rate
      const quarterly = st.period === 'quarter'
      const sum = (k) => quarterly ? ttm(st.rows, k) : st.rows.at(-1)?.[k] ?? null
      const revenue = sum('revenue')
      const netIncome = sum('netIncome')
      const fcf = sum('freeCashFlow')
      const gross = sum('grossProfit')
      const ratio = (a, b) => a === null || b === null || b === 0 ? null : a / b
      const last = st.rows.at(-1)
      const yearAgo = quarterly ? st.rows.find((r) => Math.abs(day(last.end) - day(r.end) - 365) < 20) : st.rows.at(-2)
      const valuation = {
        price, marketCap,
        pe: netIncome !== null && netIncome > 0 ? ratio(marketCap, inPrice(netIncome)) : null,
        ps: ratio(marketCap, inPrice(revenue)),
        pb: st.equity !== null && st.equity > 0 ? ratio(marketCap, inPrice(st.equity)) : null,
        fcfYield: ratio(inPrice(fcf), marketCap),
        grossMargin: ratio(gross, revenue),
        netMargin: ratio(netIncome, revenue),
        revenueGrowth: yearAgo && last.revenue !== null && yearAgo.revenue ? last.revenue / yearAgo.revenue - 1 : null,
        basis: quarterly ? 'TTM' : `FY ${last.end.slice(0, 4)}`,
      }
      return {
        symbol, name: p?.companyName ?? symbol, sector: p?.sector ?? null, industry: p?.industry ?? null, exchange: p?.exchange ?? null,
        priceCurrency: p?.currency ?? 'USD', ...st, valuation, stale: result.stale, at: result.at,
      }
    },
  }
}

// ---- Agent tools ----

const money = (v, currency = 'USD') => {
  if (v === null || v === undefined) return '—'
  const sign = v < 0 ? '-' : ''
  const a = Math.abs(v)
  const unit = currency === 'USD' ? '$' : `${currency} `
  return a >= 1e12 ? `${sign}${unit}${(a / 1e12).toFixed(2)}T` : a >= 1e9 ? `${sign}${unit}${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `${sign}${unit}${(a / 1e6).toFixed(1)}M` : `${sign}${unit}${a.toFixed(2)}`
}
const pct = (v) => v === null || v === undefined ? '—' : `${(v * 100).toFixed(1)}%`
const times = (v) => v === null || v === undefined ? '—' : v.toFixed(1)
const date = (t) => new Date(t).toISOString().slice(0, 10)
const staleNote = (r) => r.stale ? `\n（数据源暂时取不到，这是 ${new Date(r.at).toLocaleString('zh-CN')} 的缓存）` : ''

/** Close-to-close summary of a candle series, for the model. */
function chartSummary(c) {
  const first = c.candles[0]
  const last = c.candles.at(-1)
  const highs = c.candles.map((k) => k[2])
  const lows = c.candles.map((k) => k[3])
  const hi = Math.max(...highs)
  const lo = Math.min(...lows)
  const avgVol = c.candles.reduce((n, k) => n + k[5], 0) / c.candles.length
  const ma = (n) => c.candles.length >= n ? c.candles.slice(-n).reduce((s, k) => s + k[4], 0) / n : null
  const line = (n) => ma(n) === null ? null : `MA${n} ${ma(n).toFixed(2)}`
  return [
    `${c.name}（${c.symbol}，${c.exchange}）${c.range} ${c.interval === '1wk' ? '周' : '日'}K，${date(first[0])} 至 ${date(last[0])}，${c.candles.length} 根。图已经画在对话里给用户看了，不用再描述图形。`,
    `最新收盘 ${last[4]} ${c.currency}（${date(last[0])}），区间涨跌 ${pct(last[4] / first[4] - 1)}`,
    `区间最高 ${hi}（${date(c.candles[highs.indexOf(hi)][0])}），最低 ${lo}（${date(c.candles[lows.indexOf(lo)][0])}），距最高 ${pct(last[4] / hi - 1)}`,
    `平均成交量 ${Math.round(avgVol).toLocaleString('en-US')}`,
    [line(5), line(20), line(60)].filter(Boolean).join('，'),
  ].join('\n') + staleNote(c)
}

function fundamentalsSummary(f) {
  const v = f.valuation
  const cur = f.currency
  const head = [
    `${f.name}（${f.symbol}）${[f.sector, f.industry].filter(Boolean).join(' / ')}。卡片已经画在对话里给用户看了。`,
    `股价 ${v.price ?? '—'} ${f.priceCurrency}，市值 ${money(v.marketCap, f.priceCurrency)}`,
    `估值（${v.basis}）：PE ${times(v.pe)}，PS ${times(v.ps)}，PB ${times(v.pb)}，自由现金流收益率 ${pct(v.fcfYield)}；毛利率 ${pct(v.grossMargin)}，净利率 ${pct(v.netMargin)}，营收同比 ${pct(v.revenueGrowth)}`,
    `${f.period === 'quarter' ? '季度' : '年度'}数据（${f.source}，报表货币 ${cur}）：`,
  ]
  const table = f.rows.map((r) => `${r.end}：营收 ${money(r.revenue, cur)}，毛利 ${money(r.grossProfit, cur)}，营业利润 ${money(r.operatingIncome, cur)}，净利润 ${money(r.netIncome, cur)}，摊薄 EPS ${r.epsDiluted ?? '—'}，经营现金流 ${money(r.operatingCashFlow, cur)}，资本开支 ${money(r.capex, cur)}，自由现金流 ${money(r.freeCashFlow, cur)}`)
  return [...head, ...table, '— 表示数据源没有这一项，不要自己估。'].join('\n') + staleNote(f)
}

/** How the Agent puts a card into its reply: a one-line `stock` code block the page swaps for the card. */
const fence = (body) => `要让这张图出现在你的回复正文里，在讲到它的地方单独写一个代码块（语言写 stock），内容只有一行：${body}`

/** The two US stock tools; their results carry the data the page draws (presentationMeta). */
export function stockTools({ data }) {
  const symbolParam = { type: 'string', description: '美股代码，如 AAPL、ISRG、BRK-B（ADR 也行，如 NVO、NOK）' }
  return [
    {
      name: 'stock_chart',
      description: '取一只美股的真实行情，给用户画 K 线图（带成交量和 5/20/60 日均线，可缩放）。你会收到行情摘要；图由界面画，不要自己编价格或画图。用户想看走势、K 线、涨跌时用。拿到结果后，在回复里讲到这张图的地方放一个 stock 代码块，内容是一行 `chart 代码 范围`（如 chart ISRG 6m），界面会把它换成图。',
      parameters: {
        type: 'object',
        properties: { symbol: symbolParam, range: { type: 'string', enum: Object.keys(RANGES), description: '时间范围，默认 6m；5y 用周 K' } },
        required: ['symbol'],
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object' },
        render: (_args, value) => [{ type: 'text', text: value.summary }],
        presentationMeta: (_args, value) => value.chart,
      },
      async execute(args) {
        const symbol = cleanSymbol(args?.symbol)
        const range = RANGES[args?.range] ? args.range : '6m'
        const chart = await data.chart(symbol, range)
        return { summary: `${chartSummary(chart)}\n${fence(`chart ${symbol} ${range}`)}`, chart }
      },
    },
    {
      name: 'stock_fundamentals',
      description: '取一只美股的估值和基本财务：市值、PE/PS/PB、自由现金流收益率、毛利率、净利率、营收同比，以及最近几个季度（外国公司是最近几年）的营收、利润、现金流，给用户画成卡片。数据来自 FMP 或 SEC 原始申报，你会收到同样的数字；缺的项是 —，不要自己补。拿到结果后，在回复里讲到它的地方放一个 stock 代码块，内容是一行 `fundamentals 代码`（如 fundamentals ISRG），界面会把它换成卡片。',
      parameters: { type: 'object', properties: { symbol: symbolParam }, required: ['symbol'], additionalProperties: false },
      output: {
        schema: { type: 'object' },
        render: (_args, value) => [{ type: 'text', text: value.summary }],
        presentationMeta: (_args, value) => value.card,
      },
      async execute(args) {
        const symbol = cleanSymbol(args?.symbol)
        const card = await data.fundamentals(symbol)
        return { summary: `${fundamentalsSummary(card)}\n${fence(`fundamentals ${symbol}`)}`, card }
      },
    },
  ]
}
