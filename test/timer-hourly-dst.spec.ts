import { afterEach, beforeEach, describe, it } from 'mocha'
import { expect } from 'chai'

import DCABacktesting from '../src/dca'
import { ExchangeEnum, ExchangeIntervals } from '../src/types'
import type {
  DCABacktestingResult,
  DCABotSettings,
  FullBar,
  Symbols,
} from '../src/types'

/**
 * specs/010.hourly-timer-dst-elapsed-hours.md
 *
 * An hourly timer repeats every N elapsed hours, like the live bot does, so
 * the hour the clock repeats at the autumn DST change still gets its entry.
 * A daily timer keeps firing at the chosen local clock time.
 */

const PAIR = 'BTC-USDT'
const HOUR = 3600e3
// 00:00 Europe/Berlin (CEST) on the night clocks go back at 03:00 → 02:00
const FROM = Date.UTC(2026, 9, 24, 22)

const mkBars = (count: number): FullBar[] =>
  Array.from({ length: count }, (_, i) => ({
    time: FROM + i * HOUR,
    open: 100,
    close: 100,
    high: 100,
    low: 100,
    volume: 1000,
    symbol: PAIR,
  })) as FullBar[]

const symbol: Symbols = {
  pair: PAIR,
  exchange: ExchangeEnum.paperBinance,
  baseAsset: { name: 'BTC', minAmount: 0, maxAmount: 1e6, step: 0.001 },
  quoteAsset: { name: 'USDT', minAmount: 0 },
  maxOrders: 200,
  priceAssetPrecision: 2,
}

const baseSettings = {
  pair: [PAIR],
  name: 'timer-hourly-dst',
  strategy: 'LONG',
  profitCurrency: 'quote',
  dcaCondition: 'percentage',
  scaleDcaType: 'percentage',
  startCondition: 'Timer',
  hodlAt: '00:00',
  hodlDay: '1',
  startOrderType: 'MARKET',
  baseOrderSize: '10',
  orderSize: '10',
  orderSizeType: 'quote',
  orderFixedIn: 'quote',
  ordersCount: 1,
  activeOrdersCount: 1,
  step: '5',
  volumeScale: '1',
  stepScale: '1',
  minimumDeviation: '0',
  useDca: false,
  useTp: false,
  tpPerc: '50',
  dealCloseCondition: 'tp',
  useSl: false,
  slPerc: '-50',
  dealCloseConditionSL: 'tp',
  closeDealType: 'closeByMarket',
  closeOrderType: 'MARKET',
  maxNumberOfOpenDeals: '100',
  maxDealsPerPair: '100',
  type: 'regular',
  futures: false,
  indicatorGroups: [],
  indicators: [],
} as unknown as DCABotSettings

const startTimes = async (
  settings: Partial<DCABotSettings>,
  bars: FullBar[],
) => {
  const backtest = new DCABacktesting({
    settings: { ...baseSettings, ...settings },
    userFee: 0.001,
    makerFee: 0.001,
    takerFee: 0.001,
    prices: [{ symbol: PAIR, price: 100 }],
    balances: [],
    interval: ExchangeIntervals.oneH,
    from: FROM,
    to: FROM + bars.length * HOUR,
    slippage: 0,
    exchange: ExchangeEnum.paperBinance,
    combo: false,
    symbols: [symbol],
  } as never)
  const result = (await backtest.test([
    { bar: bars, interval: ExchangeIntervals.oneH },
  ])) as DCABacktestingResult
  return [...result.deals]
    .map((d) => d.startTime)
    .sort((a, b) => a - b)
    .map((t) => new Date(t).toISOString())
}

describe('timer strategy across the autumn DST change (Europe/Berlin)', () => {
  let prevTz: string | undefined
  beforeEach(() => {
    prevTz = process.env.TZ
    process.env.TZ = 'Europe/Berlin'
  })
  afterEach(() => {
    if (prevTz === undefined) delete process.env.TZ
    else process.env.TZ = prevTz
  })

  it('§2.1 hourly timer opens one deal per elapsed hour', async () => {
    const bars = mkBars(8)
    const starts = await startTimes({ hodlHourly: true }, bars)
    expect(starts).to.deep.equal(
      bars.map((b) => new Date(b.time).toISOString()),
    )
  })

  it('§2.2 daily timer still fires at local 00:00 on each calendar day', async () => {
    const starts = await startTimes({ hodlHourly: false }, mkBars(60))
    expect(starts).to.deep.equal([
      '2026-10-24T22:00:00.000Z', // 00:00 CEST
      '2026-10-25T23:00:00.000Z', // 00:00 CET (25-hour day in between)
      '2026-10-26T23:00:00.000Z',
    ])
  })
})
