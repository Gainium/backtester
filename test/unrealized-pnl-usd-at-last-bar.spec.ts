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
 * spec 015 — the unrealized PnL of the deals still open at the end of a
 * backtest is converted to USD at the price of the last bar of the test, the
 * same price the open deals are valued at. Before the fix it was converted at
 * the host's live price list (the price on the day the backtest ran), so a
 * base-profit spot long on a market that fell over the test showed a USD loss
 * larger than the coins it held.
 *
 * Run: npm test -- --grep 'spec 015'
 */

const PAIR = 'BTCUSDT'
const HOUR = 3600e3
const FROM = Date.UTC(2022, 0, 1)

// a slow trend against the bot with a ripple, so some deals close in profit
// and the rest stay open underwater at the end of the test
const mkBars = (drift: number): FullBar[] =>
  Array.from({ length: 800 }, (_, i) => {
    const time = FROM + i * HOUR
    const px = (k: number) => 40000 * (1 + drift * k + 0.03 * Math.sin(k / 6))
    const open = px(i - 1)
    const close = px(i)
    return {
      time,
      open,
      close,
      high: Math.max(open, close) * 1.0005,
      low: Math.min(open, close) * 0.9995,
      volume: 1000,
      symbol: PAIR,
    } as FullBar
  })

const symbol: Symbols = {
  pair: PAIR,
  exchange: ExchangeEnum.binance,
  baseAsset: {
    name: 'BTC',
    minAmount: 0.00001,
    maxAmount: 9000,
    step: 0.00001,
  },
  quoteAsset: { name: 'USDT', minAmount: 5 },
  maxOrders: 200,
  priceAssetPrecision: 2,
}

const baseSettings = {
  pair: [PAIR],
  name: 'unrealized-pnl-usd-at-last-bar',
  strategy: 'LONG',
  profitCurrency: 'base',
  dcaCondition: 'percentage',
  scaleDcaType: 'percentage',
  startCondition: 'Timer',
  hodlAt: '00:00',
  hodlHourly: true,
  hodlDay: '6',
  startOrderType: 'MARKET',
  baseOrderSize: '33',
  orderSize: '33',
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
  futures: false,
  coinm: false,
  indicatorGroups: [],
  indicators: [],
} as unknown as DCABotSettings

const run = async (
  strategy: 'LONG' | 'SHORT',
  livePrice: (lastClose: number) => number,
) => {
  const bars = mkBars(strategy === 'LONG' ? -0.0006 : 0.0006)
  const lastClose = bars[bars.length - 1].close
  const backtest = new DCABacktesting({
    settings: { ...baseSettings, strategy } as DCABotSettings,
    userFee: 0.001,
    makerFee: 0.001,
    takerFee: 0.001,
    // the host's live price list — the price today, not during the test
    prices: [{ symbol: PAIR, price: livePrice(lastClose) }],
    balances: [],
    interval: ExchangeIntervals.oneH,
    from: FROM,
    to: FROM + bars.length * HOUR,
    slippage: 0,
    exchange: ExchangeEnum.binance,
    combo: false,
    symbols: [symbol],
  } as never)
  const r = (await backtest.test([
    { bar: bars, interval: ExchangeIntervals.oneH },
  ])) as DCABacktestingResult
  return { r, lastClose }
}

for (const strategy of ['LONG', 'SHORT'] as const)
  describe(`spot ${strategy} base-profit unrealized PnL in USD (spec 015)`, () => {
    it('§1 open-deal PnL in USD is the base PnL at the last bar price', async () => {
      // today's price is 4x the price at the end of the test
      const { r, lastClose } = await run(strategy, (c) => c * 4)
      const f = r.financial
      expect(r.numerical.open, 'needs open deals').to.be.greaterThan(3)
      expect(f.unrealizedPnL).to.be.lessThan(0)
      expect(f.unrealizedPnLUsd).to.be.closeTo(
        f.unrealizedPnL * lastClose,
        Math.abs(f.unrealizedPnL * lastClose) * 0.001 + 0.02,
      )
    })

    it('§2 unrealized PnL (total, USD, %) does not depend on the live price', async () => {
      const atLast = await run(strategy, (c) => c)
      const live = await run(strategy, (c) => c * 4)
      const pick = (x: DCABacktestingResult) => ({
        unrealizedPnL: x.financial.unrealizedPnL,
        unrealizedPnLUsd: x.financial.unrealizedPnLUsd,
        unrealizedPnLPerc: x.financial.unrealizedPnLPerc,
        unrealizedUsage: x.financial.unrealizedUsage,
        perDeal: x
          .deals!.filter((d) => d.status === 'open')
          .map((d) => d.unrealized),
      })
      expect(pick(live.r)).to.deep.equal(pick(atLast.r))
    })

    it('§3 trades, deals and realized profit are unchanged by the live price', async () => {
      const atLast = await run(strategy, (c) => c)
      const live = await run(strategy, (c) => c * 4)
      expect(live.r.numerical).to.deep.equal(atLast.r.numerical)
      expect(live.r.financial.netProfitTotal).to.equal(
        atLast.r.financial.netProfitTotal,
      )
      expect(live.r.financial.netProfitTotalUsd).to.equal(
        atLast.r.financial.netProfitTotalUsd,
      )
    })
  })
