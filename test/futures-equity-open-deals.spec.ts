import { describe, it } from 'mocha'
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
 * spec 008 — the equity curve of a futures DCA backtest is the wallet balance
 * plus the unrealized PnL of the deals open at that moment. Before the fix the
 * futures branch of checkPortfolio added the whole per-symbol position's PnL
 * once per open deal (N open deals → N× the loss), and the position's entry is
 * a blended average that drifts away from the open deals' own entries as other
 * deals close, so the curve swung far above and below the real equity.
 */

const PAIR = 'ADAUSDT'
const HOUR = 3600e3
const FROM = Date.UTC(2026, 0, 1)

// a slow trend against the bot with a ripple: some deals hit TP, the rest
// pile up underwater (decline for a long, rise for a short)
const mkBars = (drift: number): FullBar[] =>
  Array.from({ length: 800 }, (_, i) => {
    const time = FROM + i * HOUR
    const px = (k: number) => 1 + drift * k + 0.03 * Math.sin(k / 6)
    const open = px(i - 1)
    const close = px(i)
    return {
      time,
      open,
      close,
      high: Math.max(open, close) + 0.001,
      low: Math.min(open, close) - 0.001,
      volume: 1000,
      symbol: PAIR,
    } as FullBar
  })

const symbol: Symbols = {
  pair: PAIR,
  exchange: ExchangeEnum.binanceUsdm,
  baseAsset: { name: 'ADA', minAmount: 1, maxAmount: 3e7, step: 1 },
  quoteAsset: { name: 'USDT', minAmount: 5 },
  maxOrders: 200,
  priceAssetPrecision: 4,
}

const baseSettings = {
  pair: [PAIR],
  name: 'futures-equity-open-deals',
  strategy: 'LONG',
  profitCurrency: 'quote',
  dcaCondition: 'percentage',
  scaleDcaType: 'percentage',
  // a deal every 6h, so many deals are open at once like the report's 28
  startCondition: 'Timer',
  hodlAt: '00:00',
  hodlHourly: true,
  hodlDay: '6',
  startOrderType: 'MARKET',
  baseOrderSize: '6',
  orderSize: '6',
  orderSizeType: 'quote',
  orderFixedIn: 'quote',
  ordersCount: 1,
  activeOrdersCount: 1,
  step: '5',
  volumeScale: '1',
  stepScale: '1',
  minimumDeviation: '0',
  useDca: false,
  useTp: true,
  tpPerc: '2',
  dealCloseCondition: 'tp',
  useSl: false,
  slPerc: '-50',
  dealCloseConditionSL: 'tp',
  closeDealType: 'closeByMarket',
  closeOrderType: 'MARKET',
  maxNumberOfOpenDeals: '100',
  maxDealsPerPair: '100',
  type: 'regular',
  marginType: 'cross',
  leverage: 1,
  futures: true,
  coinm: false,
  indicatorGroups: [],
  indicators: [],
} as unknown as DCABotSettings

const run = async (strategy: 'LONG' | 'SHORT') => {
  const bars = mkBars(strategy === 'LONG' ? -0.0008 : 0.0006)
  const backtest = new DCABacktesting({
    settings: { ...baseSettings, strategy } as DCABotSettings,
    userFee: 0.0005,
    makerFee: 0.0005,
    takerFee: 0.0005,
    // the open-deal PnL stat values open deals at this price (last close)
    prices: [{ symbol: PAIR, price: bars[bars.length - 1].close }],
    balances: [],
    interval: ExchangeIntervals.oneH,
    from: FROM,
    to: FROM + bars.length * HOUR,
    slippage: 0,
    exchange: ExchangeEnum.binanceUsdm,
    combo: false,
    symbols: [symbol],
  } as never)
  return (await backtest.test([
    { bar: bars, interval: ExchangeIntervals.oneH },
  ])) as DCABacktestingResult
}

for (const strategy of ['LONG', 'SHORT'] as const)
  describe(`futures ${strategy} DCA backtest equity curve (spec 008)`, () => {
    it('§1 last equity point = start balance + closed profit + open-deal PnL', async () => {
      const r = await run(strategy)
      const f = r.financial
      expect(r.numerical.open, 'needs several open deals').to.be.greaterThan(5)
      expect(r.numerical.closed, 'needs closed deals').to.be.greaterThan(5)
      const last = r.portfolio![r.portfolio!.length - 1]
      const expected =
        f.initialBalanceUsd + f.netProfitTotalUsd + f.unrealizedPnLUsd
      // tolerance: rounding + one exit fee on the open deals
      expect(last.y).to.be.closeTo(expected, 0.5)
    })

    it('§2 equity drawdown is bounded by the open notional, never negative equity', async () => {
      const r = await run(strategy)
      const f = r.financial
      const minEquity = Math.min(...r.portfolio!.map((p) => p.y))
      expect(minEquity).to.be.greaterThan(0)
      // a 1x long can lose at most what it holds open plus nothing it already banked
      const maxOpenNotional = (r.numerical.open + 5) * 6
      expect(-(f.maxDrawDownEquityUsd ?? 0)).to.be.lessThan(maxOpenNotional)
    })
  })
