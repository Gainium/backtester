import { describe, it } from 'mocha'
import { expect } from 'chai'

import GRIDBacktesting from '../src/grid'
import { ExchangeEnum, ExchangeIntervals } from '../src/types'
import type { FullBar, Settings, Symbols } from '../src/types'

/**
 * spec 015 §4 (grid) — a base-profit grid on a pair not quoted in USDT
 * converts its base profit to USD at its own last-bar price times the quote's
 * USD rate, not at the live BASE/USDT price that findUSDRate finds first.
 *
 * Run: npm test -- --grep 'spec 015'
 */

const T0 = 1789344000000
const MIN = 60000

const series = (pair: string, path: number[]): FullBar[] =>
  path.map((p, i) => {
    const prev = i === 0 ? p : path[i - 1]
    return {
      open: prev,
      high: Math.max(p, prev),
      low: Math.min(p, prev),
      close: p,
      volume: 1000,
      time: T0 + i * MIN,
      symbol: pair,
    } as FullBar
  })

const path = [
  100, 99, 97, 95.5, 94, 95.5, 97, 99, 100, 102, 100, 99, 100, 102, 104, 103,
  101, 99, 98, 97,
]

const mkSymbol = (pair: string, quote: string): Symbols =>
  ({
    pair,
    exchange: ExchangeEnum.binance,
    baseAsset: { minAmount: 0.001, maxAmount: 1e9, step: 0.001, name: 'ETH' },
    quoteAsset: { minAmount: 5, name: quote },
    maxOrders: 200,
    priceAssetPrecision: 2,
  }) as never

const settings = {
  topPrice: 110,
  lowPrice: 90,
  levels: 21,
  gridStep: '1',
  budget: 1000,
  useOrderInAdvance: false,
  prioritize: 'level',
  profitCurrency: 'base',
  orderFixedIn: 'quote',
  sellDisplacement: 0.04,
  gridType: 'arithmetic',
  tpSl: false,
  sl: false,
  useStartPrice: false,
  leverage: 1,
  futures: false,
  coinm: false,
  newProfit: true,
  strategy: 'LONG',
  feeOrder: true,
  ordersInAdvance: 3,
  startPrice: '',
  skipBalanceCheck: true,
}

const run = async (pair: string, quote: string, k: number, stable = true) => {
  const bars = series(pair, path)
  const last = bars[bars.length - 1].close
  const bt = new GRIDBacktesting({
    exchange: ExchangeEnum.binance,
    symbols: [mkSymbol(pair, quote)],
    interval: ExchangeIntervals.oneM,
    userFee: 0.001,
    prices: [
      { symbol: 'ETHUSDT', price: last * k },
      { symbol: 'ETHUSDC', price: last * k },
      ...(stable ? [{ symbol: 'USDCUSDT', price: 1 }] : []),
    ],
    settings: { ...settings, pair, name: 'grid-usd' } as unknown as Settings,
    fullResult: true,
  } as never)
  const r = (await bt.test(bars)) as never as {
    financial: Record<string, string | number>
    transaction: unknown[]
  }
  return r
}

describe('spec 015 §4 — grid base-profit USD on a non-USDT quote', () => {
  it('USD figures do not depend on the live ETH price', async () => {
    const a = await run('ETHUSDC', 'USDC', 1)
    const b = await run('ETHUSDC', 'USDC', 4)
    expect(a.transaction.length, 'needs trades').to.be.greaterThan(0)
    expect(+a.financial.profitTotal).to.be.greaterThan(0)
    expect(b.financial).to.deep.equal(a.financial)
    const c = await run('ETHUSDC', 'USDC', 4, false)
    expect(c.financial).to.deep.equal(a.financial)
  })
})
