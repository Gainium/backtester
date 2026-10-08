import { createHash } from 'crypto'

import DCABacktesting from '../../src/dca'
import { StrategyContextManager } from '../../src/dca/strategy/context'
import {
  CloseConditionEnum,
  DCAConditionEnum,
  ExchangeEnum,
  ExchangeIntervals,
  IndicatorEnum,
  IndicatorSection,
  OrderSizeTypeEnum,
  OrderTypeEnum,
  StartConditionEnum,
  StrategyEnum,
} from '../../src/types'
import type {
  DCABacktestHooks,
  DCABacktestingResult,
  DCABotSettings,
  FullBar,
  IndicatorAction,
  IndicatorStartConditionEnum,
  Symbols,
} from '../../src/types'

/** Shared fixtures for the single-position specs. */

export const HOUR = 3600e3
export const FROM = Date.UTC(2026, 0, 1)

export const mkSymbol = (pair: string, base: string): Symbols => ({
  pair,
  exchange: ExchangeEnum.binance,
  baseAsset: { name: base, minAmount: 0.0001, maxAmount: 1e9, step: 0.0001 },
  quoteAsset: { name: 'USDT', minAmount: 1 },
  maxOrders: 200,
  priceAssetPrecision: 4,
})

export const one = mkSymbol('AAA_USDT', 'AAA')
export const two = mkSymbol('BBB_USDT', 'BBB')

export const wave = (
  pair: string,
  n: number,
  phase = 0,
  base = 100,
): FullBar[] =>
  Array.from({ length: n }, (_, i) => {
    const p = (k: number) =>
      base +
      12 * Math.sin((k + phase) / 23) +
      4 * Math.sin((k + phase) / 5) +
      k * 0.01
    const open = p(i - 1)
    const close = p(i)
    return {
      time: FROM + i * HOUR,
      open,
      close,
      high: Math.max(open, close) + 0.6,
      low: Math.min(open, close) - 0.6,
      volume: 1000,
      symbol: pair,
    }
  })

/** Bars that walk a fixed list of closes (open = previous close, ±0.1 wicks). */
export const path = (pair: string, closes: number[]): FullBar[] =>
  closes.map((close, i) => {
    const open = i === 0 ? close : closes[i - 1]
    return {
      time: FROM + i * HOUR,
      open,
      close,
      high: Math.max(open, close) + 0.1,
      low: Math.min(open, close) - 0.1,
      volume: 1000,
      symbol: pair,
    }
  })

export const base = {
  name: 'single-position',
  strategy: StrategyEnum.long,
  futures: false,
  coinm: false,
  leverage: 1,
  profitCurrency: 'quote',
  orderSizeType: OrderSizeTypeEnum.quote,
  orderFixedIn: 'quote',
  baseOrderSize: '100',
  orderSize: '100',
  startOrderType: OrderTypeEnum.market,
  startCondition: StartConditionEnum.asap,
  dcaCondition: DCAConditionEnum.percentage,
  scaleDcaType: 'percentage',
  useDca: true,
  ordersCount: 4,
  activeOrdersCount: 4,
  step: '1.5',
  stepScale: '1.2',
  volumeScale: '1.3',
  minimumDeviation: '0',
  useTp: true,
  tpPerc: '2',
  useSl: true,
  slPerc: '-12',
  dealCloseCondition: CloseConditionEnum.tp,
  dealCloseConditionSL: CloseConditionEnum.tp,
  closeDealType: 'closeByMarket',
  maxNumberOfOpenDeals: '1',
  maxDealsPerPair: '1',
  indicators: [],
  indicatorGroups: [],
} as unknown as DCABotSettings

export const rsi = (
  id: string,
  action: IndicatorAction,
  condition: IndicatorStartConditionEnum,
  value: string,
  section?: IndicatorSection,
) =>
  ({
    type: IndicatorEnum.rsi,
    indicatorLength: 14,
    indicatorValue: value,
    indicatorCondition: condition,
    indicatorInterval: ExchangeIntervals.oneH,
    indicatorAction: action,
    groupId: `g-${id}`,
    uuid: `u-${id}`,
    ...(section ? { section } : {}),
  }) as never

export type Case = {
  name: string
  settings: Partial<DCABotSettings> & Record<string, unknown>
  symbols: Symbols[]
  bars: FullBar[]
  combo?: boolean
  userFee?: number
  timezone?: string
}

let runNo = 0

export function make(c: Case, hooks?: DCABacktestHooks): DCABacktesting {
  // Engine state is per context; a fresh one per run keeps one run's
  // leftovers out of the next.
  StrategyContextManager.setActiveContext(`single-position-${++runNo}`)
  return new DCABacktesting({
    exchange: ExchangeEnum.binance,
    symbols: c.symbols,
    interval: ExchangeIntervals.oneH,
    userFee: c.userFee ?? 0.001,
    prices: c.symbols.map((s) => ({ symbol: s.pair, price: 100 })),
    balances: [{ asset: 'USDT', free: '1000000', locked: '0' }] as never,
    from: FROM,
    to: FROM + c.bars.length * HOUR,
    combo: !!c.combo,
    timezone: c.timezone,
    settings: {
      ...base,
      pair: c.symbols.map((s) => s.pair),
      ...c.settings,
    } as DCABotSettings,
    fullResult: true,
    ...(hooks ? { hooks } : {}),
  } as never)
}

export async function run(
  c: Case,
  hooks?: DCABacktestHooks,
): Promise<DCABacktestingResult> {
  const bt = make(c, hooks)
  const r = (await bt.test([
    { bar: c.bars, interval: ExchangeIntervals.oneH },
  ])) as DCABacktestingResult
  r.deals.sort((a, b) => a.startTime - b.startTime)
  return r
}

const STRIP = new Set([
  'id',
  'dealId',
  '_id',
  'minigridId',
  'relatedTo',
  'dcaOrderId',
  'loadingDataTime',
  'processingDataTime',
])

export function normalise(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(normalise)
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      if (STRIP.has(k)) continue
      out[k] = normalise((v as Record<string, unknown>)[k])
    }
    return out
  }
  if (typeof v === 'number' && !Number.isFinite(v)) return String(v)
  return v
}

export type Fingerprint = {
  sha256: string
  deals: number
  closed: number
  netProfitTotal: number
  maxDrawDownPerc: number
}

/** A compact, exact fingerprint of a whole result (random ids stripped). */
export function fingerprint(result: DCABacktestingResult): Fingerprint {
  const r = normalise(JSON.parse(JSON.stringify(result))) as {
    deals: { status: string }[]
    financial: { netProfitTotal: number; maxDrawDownPerc: number }
  }
  return {
    sha256: createHash('sha256').update(JSON.stringify(r)).digest('hex'),
    deals: r.deals.length,
    closed: r.deals.filter((d) => d.status === 'closed').length,
    netProfitTotal: r.financial.netProfitTotal,
    maxDrawDownPerc: r.financial.maxDrawDownPerc,
  }
}
