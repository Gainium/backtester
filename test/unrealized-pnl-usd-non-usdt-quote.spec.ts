import { describe, it } from 'mocha'
import { expect } from 'chai'

import DCABacktesting from '../src/dca'
import { Strategy } from '../src/dca/strategy/main'
import { ExchangeEnum, ExchangeIntervals } from '../src/types'
import type {
  DCABacktestingResult,
  DCABotSettings,
  FullBar,
  Symbols,
} from '../src/types'

/**
 * spec 015 §4 — on a pair not quoted in USDT (e.g. BTC/USDC) a base-currency
 * amount is converted to USD through the pair's own price at the bar, times
 * the quote's USD rate. findUSDRate looks up BASE/USDT before BASE/USDC, so
 * without this the live BTC/USDT price (today's) wins over the test's own
 * last-bar BTC/USDC price.
 *
 * Run: npm test -- --grep 'spec 015'
 */

const HOUR = 3600e3
const FROM = Date.UTC(2022, 0, 1)

const mkBars = (pair: string, drift: number): FullBar[] =>
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
      symbol: pair,
    } as FullBar
  })

const mkSymbol = (pair: string, quote: string): Symbols => ({
  pair,
  exchange: ExchangeEnum.binance,
  baseAsset: {
    name: 'BTC',
    minAmount: 0.00001,
    maxAmount: 9000,
    step: 0.00001,
  },
  quoteAsset: { name: quote, minAmount: 5 },
  maxOrders: 200,
  priceAssetPrecision: 2,
})

const dcaSettings = {
  name: 'unrealized-pnl-usd-non-usdt-quote',
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

const runDca = async (
  pair: string,
  quote: string,
  live: (lastClose: number) => { symbol: string; price: number }[],
) => {
  const bars = mkBars(pair, -0.0006)
  const lastClose = bars[bars.length - 1].close
  const backtest = new DCABacktesting({
    settings: { ...dcaSettings, pair: [pair] } as DCABotSettings,
    userFee: 0.001,
    makerFee: 0.001,
    takerFee: 0.001,
    prices: live(lastClose),
    balances: [],
    interval: ExchangeIntervals.oneH,
    from: FROM,
    to: FROM + bars.length * HOUR,
    slippage: 0,
    exchange: ExchangeEnum.binance,
    combo: false,
    symbols: [mkSymbol(pair, quote)],
  } as never)
  const r = (await backtest.test([
    { bar: bars, interval: ExchangeIntervals.oneH },
  ])) as DCABacktestingResult
  return { r, lastClose }
}

describe('BTC/USDC base-profit unrealized PnL in USD (spec 015 §4)', () => {
  it('§4a uses the BTC/USDC last-bar price, not a live BTC/USDT price', async () => {
    // live list as the host sends it: today's BTC/USDT and BTC/USDC, a
    // USDC/USDT near 1
    const { r, lastClose } = await runDca('BTCUSDC', 'USDC', (c) => [
      { symbol: 'BTCUSDT', price: c * 4 },
      { symbol: 'BTCUSDC', price: c * 4 },
      { symbol: 'USDCUSDT', price: 1 },
    ])
    const f = r.financial
    expect(r.numerical.open, 'needs open deals').to.be.greaterThan(3)
    expect(f.unrealizedPnL).to.be.lessThan(0)
    expect(f.unrealizedPnLUsd).to.be.closeTo(
      f.unrealizedPnL * lastClose,
      Math.abs(f.unrealizedPnL * lastClose) * 0.001 + 0.02,
    )
  })

  it('§4a without a USDC/USDT price in the live list', async () => {
    const { r, lastClose } = await runDca('BTCUSDC', 'USDC', (c) => [
      { symbol: 'BTCUSDT', price: c * 4 },
      { symbol: 'BTCUSDC', price: c * 4 },
    ])
    const f = r.financial
    expect(f.unrealizedPnLUsd).to.be.closeTo(
      f.unrealizedPnL * lastClose,
      Math.abs(f.unrealizedPnL * lastClose) * 0.001 + 0.02,
    )
  })

  it('§4b unrealized and realized USD do not depend on the live BTC price', async () => {
    const mk = (k: number) => (c: number) => [
      { symbol: 'BTCUSDT', price: c * k },
      { symbol: 'BTCUSDC', price: c * k },
      { symbol: 'USDCUSDT', price: 1 },
    ]
    const a = await runDca('BTCUSDC', 'USDC', mk(1))
    const b = await runDca('BTCUSDC', 'USDC', mk(4))
    const pick = (x: DCABacktestingResult) => ({
      unrealizedPnLUsd: x.financial.unrealizedPnLUsd,
      unrealizedUsage: x.financial.unrealizedUsage,
      netProfitTotalUsd: x.financial.netProfitTotalUsd,
    })
    expect(pick(b.r)).to.deep.equal(pick(a.r))
  })
})

describe('getUsdRate on BTC/USDC (spec 015 §4)', () => {
  const getUsdRate = (
    Strategy.prototype as unknown as {
      getUsdRate: (s: string, p: number, t?: 'base' | 'quote') => number
    }
  ).getUsdRate
  const self = (pair: string, quote: string) => ({
    profitBase: true,
    symbols: new Map([[pair, mkSymbol(pair, quote)]]),
    // today's live list from the host
    prices: [
      { symbol: 'BTCUSDT', price: 60674 },
      { symbol: 'BTCUSDC', price: 60700 },
    ],
  })

  it('values the base at the BTC/USDC mark, not the live BTC/USDT', () => {
    const rate = getUsdRate.call(self('BTCUSDC', 'USDC'), 'BTCUSDC', 63802.1)
    expect(rate).to.equal(63802.1)
    expect(-0.00067228 * rate).to.be.closeTo(-42.89, 0.005)
  })

  it('keeps the USDT-pair rate as before (the mark itself)', () => {
    const rate = getUsdRate.call(self('BTCUSDT', 'USDT'), 'BTCUSDT', 63802.1)
    expect(rate).to.equal(63802.1)
  })
})
