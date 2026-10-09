import { describe, it } from 'mocha'
import { expect } from 'chai'

import GRIDBacktesting from '../src/grid'
import { ExchangeEnum, ExchangeIntervals } from '../src/types'
import type {
  FullBar,
  GridBacktestingResult,
  PreparedTransaction,
  Settings,
  Symbols,
} from '../src/types'

/**
 * spec 009 — a linear futures grid with a percentage (`valueChanged`) stop.
 *
 * §1.1 the trigger values the open position as `qty * (price - entry)`, the
 *      same quantity the force close books, so the stop fires at the
 *      configured percentage instead of past it.
 * §1.2 the force close pays the exit fee like any other fill.
 *
 * Bars are synthetic: price walks down in small steps from the middle of the
 * grid so a long position builds and the stop is crossed by a tiny overshoot.
 */

const PAIR = 'BTCUSDT'
const FEE = 0.0025
const SL = -5

const symbol: Symbols = {
  pair: PAIR,
  exchange: ExchangeEnum.binanceUsdm,
  baseAsset: { minAmount: 0.001, maxAmount: 1e9, step: 0.001, name: 'BTC' },
  quoteAsset: { minAmount: 5, name: 'USDT' },
  maxOrders: 200,
  priceAssetPrecision: 1,
}

const settings = {
  topPrice: '90000',
  lowPrice: 70000,
  levels: 10,
  budget: 850,
  useOrderInAdvance: true,
  prioritize: 'level',
  profitCurrency: 'quote',
  orderFixedIn: 'base',
  gridType: 'geometric',
  tpSl: false,
  sl: true,
  slCondition: 'valueChanged',
  slPerc: SL,
  slAction: 'stopAndSell',
  useStartPrice: true,
  startPrice: '80000',
  marginType: 'isolated',
  leverage: 1,
  futures: true,
  coinm: false,
  newProfit: true,
  strategy: 'LONG',
  futuresStrategy: 'NEUTRAL',
  pair: PAIR,
  name: 'BTC neutral',
}

const T0 = 1782950400000
const MIN = 60000

function bars(): FullBar[] {
  const data: FullBar[] = []
  let prev = 80000
  for (let i = 0; prev > 60000; i++) {
    const next = prev - 10
    data.push({
      open: prev,
      high: prev,
      low: next,
      close: next,
      volume: 1000,
      time: T0 + i * MIN,
      symbol: PAIR,
    } as FullBar)
    prev = next
  }
  return data
}

async function run(): Promise<GridBacktestingResult> {
  const data = bars()
  const bt = new GRIDBacktesting({
    exchange: ExchangeEnum.binanceUsdm,
    symbols: [symbol],
    interval: ExchangeIntervals.oneM,
    userFee: FEE,
    prices: [{ symbol: PAIR, price: data[data.length - 1].close }],
    settings: settings as unknown as Settings,
    fullResult: true,
  } as never)
  const result = (await bt.test(data)) as GridBacktestingResult
  expect(result, 'engine returned no result').to.not.equal(undefined)
  return result
}

const closeRow = (r: GridBacktestingResult) =>
  r.transaction.reduce((a: PreparedTransaction, t: PreparedTransaction) =>
    t.index > a.index ? t : a,
  )

describe('grid — linear futures percentage stop loss (spec 009)', () => {
  it('stops at the configured percentage of the initial value (§1.1)', async () => {
    const r = await run()
    expect(r.position.count, 'the stop never fired').to.be.greaterThan(0)
    const lossPerc =
      (+r.financial.profitTotal / +r.financial.initialBalances) * 100
    // the walk overshoots by one 10-USDT step plus the exit fee; the old
    // valuation stopped ~1pp past the threshold on this path
    expect(lossPerc).to.be.at.most(SL)
    expect(lossPerc).to.be.greaterThan(SL - 0.5)
  })

  it('charges the exit fee on the force close (§1.2)', async () => {
    const r = await run()
    const row = closeRow(r)
    // long close: sold `amountBaseSell` at `priceSell`, matched against the
    // position entry in `priceBuy`
    const qty = +row.amountBaseSell
    const exit = +row.priceSell
    const entry = +row.priceBuy
    const expected = qty * (exit - entry) - qty * exit * FEE
    expect(+row.profit).to.be.closeTo(expected, 0.01)
  })
})
