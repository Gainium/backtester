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
 * A short spot bot (DCA or combo) budgets in the BASE asset. When the host's
 * live price list has no entry for that base (a tokenised stock such as
 * RAAPL on Bitget is not in it), findUSDRate returns 0 and every USD/% figure
 * built on the base rate collapses: net/avg-daily/drawdown % read 0.00 and
 * the equity curve is shifted to -initialBalance.
 *
 * Run: npm test -- --grep 'missing base rate'
 */

const HOUR = 3600e3
const FROM = Date.UTC(2025, 10, 28)

const mkBars = (pair: string): FullBar[] =>
  Array.from({ length: 600 }, (_, i) => {
    const time = FROM + i * HOUR
    const px = (k: number) => 250 * (1 - 0.0002 * k + 0.03 * Math.sin(k / 8))
    const open = px(i - 1)
    const close = px(i)
    return {
      time,
      open,
      close,
      high: Math.max(open, close) * 1.0005,
      low: Math.min(open, close) * 0.9995,
      volume: 1000,
      symbol: pair,
    } as FullBar
  })

const mkSymbol = (pair: string): Symbols => ({
  pair,
  exchange: ExchangeEnum.bitget,
  baseAsset: {
    name: 'RAAPL',
    minAmount: 0.0001,
    maxAmount: 9000,
    step: 0.0001,
  },
  quoteAsset: { name: 'USDT', minAmount: 1 },
  maxOrders: 200,
  priceAssetPrecision: 2,
})

const settings = {
  name: 'short-missing-base-rate',
  strategy: 'SHORT',
  profitCurrency: 'quote',
  dcaCondition: 'percentage',
  scaleDcaType: 'percentage',
  startCondition: 'ASAP',
  startOrderType: 'MARKET',
  baseOrderSize: '0.28',
  orderSize: '0.27',
  orderSizeType: 'base',
  orderFixedIn: 'base',
  ordersCount: 5,
  activeOrdersCount: 5,
  step: '5',
  volumeScale: '1',
  stepScale: '1',
  minimumDeviation: '0',
  useDca: true,
  useTp: true,
  tpPerc: '2',
  dealCloseCondition: 'tp',
  useSl: false,
  slPerc: '-50',
  dealCloseConditionSL: 'tp',
  closeDealType: 'closeByMarket',
  closeOrderType: 'MARKET',
  maxNumberOfOpenDeals: '1',
  maxDealsPerPair: '1',
  type: 'regular',
  futures: false,
  coinm: false,
  indicatorGroups: [],
  indicators: [],
  gridLevel: '5',
  comboTpBase: 'full',
} as unknown as DCABotSettings

const run = async (
  combo: boolean,
  prices: { symbol: string; price: number }[],
) => {
  const pair = 'RAAPLUSDT'
  const bars = mkBars(pair)
  const bt = new DCABacktesting({
    settings: { ...settings, pair: [pair] } as DCABotSettings,
    userFee: 0.001,
    makerFee: 0.001,
    takerFee: 0.001,
    prices,
    balances: [],
    interval: ExchangeIntervals.oneH,
    from: FROM,
    to: FROM + bars.length * HOUR,
    slippage: 0,
    exchange: ExchangeEnum.bitget,
    combo,
    symbols: [mkSymbol(pair)],
  } as never)
  return (await bt.test([
    { bar: bars, interval: ExchangeIntervals.oneH },
  ])) as DCABacktestingResult
}

const pick = (r: DCABacktestingResult) => ({
  net: r.financial.netProfitTotalPerc,
  daily: r.financial.avgNetDailyPerc,
  dd: r.financial.maxDrawDownEquityPerc,
  init: r.financial.initialBalanceUsd,
  portfolio: r.portfolio,
})

for (const combo of [false, true]) {
  describe(`short ${combo ? 'combo' : 'DCA'} with missing base rate`, () => {
    it('prices the base from its own candles: % figures are not 0', async () => {
      const r = await run(combo, [])
      const f = r.financial
      expect(f.netProfitTotalUsd).to.be.greaterThan(0)
      expect(f.netProfitTotalPerc).to.be.greaterThan(0)
      expect(f.avgNetDailyPerc).to.be.greaterThan(0)
      expect(f.maxDrawDownEquityPerc).to.be.greaterThan(0)
      expect(f.initialBalanceUsd).to.be.greaterThan(0)
    })

    it('gives the same result with or without a live base price', async () => {
      const without = await run(combo, [])
      // a live price far from the run's: must not move the capital
      const withPrice = await run(combo, [{ symbol: 'RAAPLUSDT', price: 900 }])
      expect(pick(withPrice)).to.deep.equal(pick(without))
    })

    it('starts the equity curve with buy & hold (capital at the first bar)', async () => {
      const r = await run(combo, [{ symbol: 'RAAPLUSDT', price: 900 }])
      const pf0 = r.portfolio?.[0]?.y ?? 0
      const bh0 = r.buyAndHoldEquity?.[0]?.value ?? 0
      expect(bh0).to.be.greaterThan(0)
      expect(Math.abs(pf0 - bh0) / bh0).to.be.lessThan(0.01)
    })
  })
}
