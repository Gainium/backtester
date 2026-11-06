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
 * spec 014 — "Move SL" must fire when price TOUCHES the trigger inside a
 * bar (a wick counts), as the live engine does: it moves the stop the moment
 * a tick reaches avgPrice * (1 ± (trigger + 2·fee)).
 *
 * Before the fix `checkValue` measured the trigger at the bar's ADVERSE
 * extreme (low for a long, high for a short), so a candle that wicked
 * through the trigger but closed back below it never moved the stop.
 *
 * Bars: flat at 100 (the ASAP deal opens there), one "wick" bar whose
 * favourable extreme reaches +1.5% but whose body stays near entry, then a
 * slide of -10%. With the stop moved to +0.1% the first deal closes near
 * ~100.2 (entry + 0.1% + 2·fee); without it, it rides to the -5% stop at ~95.
 */

const PAIR = 'BTC-USDT'
const HOUR = 3600e3
const FROM = Date.UTC(2026, 0, 1)

const bar = (
  i: number,
  open: number,
  high: number,
  low: number,
  close: number,
): FullBar =>
  ({
    time: FROM + i * HOUR,
    open,
    high,
    low,
    close,
    volume: 1000,
    symbol: PAIR,
  }) as FullBar

const flat = (from: number, n: number, p: number) =>
  Array.from({ length: n }, (_, k) => bar(from + k, p, p + 0.01, p - 0.01, p))

/** mirror a long-side price path around 100 for the short-side test */
const mirror = (b: FullBar): FullBar => ({
  ...b,
  open: 200 - b.open,
  close: 200 - b.close,
  high: 200 - b.low,
  low: 200 - b.high,
})

const slide = (from: number) =>
  Array.from({ length: 10 }, (_, k) => {
    const o = 100 - k
    return bar(from + k, o, o + 0.01, o - 1, o - 1)
  })

// long, RED wick candle: open 100.2 > close 99.95, open < trigger(101.1) < high
const longRed = [
  ...flat(0, 5, 100),
  bar(5, 100.2, 101.5, 99.9, 99.95),
  ...slide(6),
]
// long, GREEN wick candle: open 99.95 < close 100.2, low 99.9, high 101.5
const longGreen = [
  ...flat(0, 5, 100),
  bar(5, 99.95, 101.5, 99.9, 100.2),
  ...slide(6),
]

const symbol: Symbols = {
  pair: PAIR,
  exchange: ExchangeEnum.paperBinanceUsdm,
  baseAsset: { name: 'BTC', minAmount: 0, maxAmount: 1e6, step: 0.001 },
  quoteAsset: { name: 'USDT', minAmount: 0 },
  maxOrders: 200,
  priceAssetPrecision: 2,
}

const baseSettings = {
  pair: [PAIR],
  name: 'move-sl-trigger-wick',
  strategy: 'LONG',
  profitCurrency: 'quote',
  dcaCondition: 'percentage',
  scaleDcaType: 'percentage',
  startCondition: 'ASAP',
  startOrderType: 'MARKET',
  baseOrderSize: '1000',
  orderSize: '1000',
  orderSizeType: 'usd',
  orderFixedIn: 'quote',
  ordersCount: 1,
  activeOrdersCount: 1,
  step: '5',
  volumeScale: '1',
  stepScale: '1',
  minimumDeviation: '0',
  useDca: false,
  useTp: true,
  tpPerc: '20',
  dealCloseCondition: 'tp',
  useSl: true,
  slPerc: '-5',
  dealCloseConditionSL: 'tp',
  moveSL: true,
  moveSLTrigger: '1',
  moveSLValue: '0.1',
  closeDealType: 'closeByMarket',
  closeOrderType: 'MARKET',
  maxNumberOfOpenDeals: '1',
  maxDealsPerPair: '1',
  type: 'regular',
  marginType: 'isolated',
  leverage: 1,
  futures: true,
  indicatorGroups: [],
  indicators: [],
} as unknown as DCABotSettings

const run = async (bars: FullBar[], settings: Partial<DCABotSettings>) => {
  const backtest = new DCABacktesting({
    settings: { ...baseSettings, ...settings },
    userFee: 0.0005,
    makerFee: 0.0005,
    takerFee: 0.0005,
    prices: [],
    balances: [],
    interval: ExchangeIntervals.oneH,
    from: FROM,
    to: FROM + bars.length * HOUR,
    slippage: 0,
    exchange: ExchangeEnum.paperBinanceUsdm,
    combo: false,
    symbols: [symbol],
  } as never)
  return (await backtest.test([
    { bar: bars, interval: ExchangeIntervals.oneH },
  ])) as DCABacktestingResult
}

const firstDeal = (r: DCABacktestingResult) => {
  const d = [...r.deals].sort(
    (a, b) => (a.startTime ?? 0) - (b.startTime ?? 0),
  )[0]
  expect(d, 'no deal opened').to.not.equal(undefined)
  return d
}

describe('Move SL trigger reached by a wick (spec 014)', () => {
  it('§3.1 long, red candle: open < trigger < high moves the stop', async () => {
    const d = firstDeal(await run(longRed, {}))
    expect(d.startPrice).to.be.closeTo(100, 0.05)
    // stopped at the moved level (entry + 0.1% + fees), not the -5% stop
    expect(d.closePrice, 'closed at the original -5% stop').to.be.within(
      100,
      100.3,
    )
  })

  it('§3.2 long, green candle: moved stop is not hit inside the same bar', async () => {
    const d = firstDeal(await run(longGreen, {}))
    // the moved stop (~100.2) is only checked on high -> close (close 100.2),
    // so the deal survives the wick bar and is stopped on the slide
    expect(d.closePrice).to.be.within(100, 100.3)
    expect(d.closedTime).to.be.greaterThan(FROM + 5 * HOUR)
  })

  it('§3.3 short, green candle (mirror of §3.1) moves the stop', async () => {
    const d = firstDeal(
      await run(longRed.map(mirror), { strategy: 'SHORT' } as never),
    )
    expect(d.startPrice).to.be.closeTo(100, 0.05)
    expect(d.closePrice).to.be.within(99.7, 100)
  })

  it('§3.4 short, red candle (mirror of §3.2) moves the stop', async () => {
    const d = firstDeal(
      await run(longGreen.map(mirror), { strategy: 'SHORT' } as never),
    )
    expect(d.closePrice).to.be.within(99.7, 100)
    expect(d.closedTime).to.be.greaterThan(FROM + 5 * HOUR)
  })

  it('§3.6 indicator stop (techInd): the moved stop still arms on the wick', async () => {
    const d = firstDeal(
      await run(longRed, { dealCloseConditionSL: 'techInd' } as never),
    )
    expect(d.startPrice).to.be.closeTo(100, 0.05)
    expect(d.closePrice).to.be.within(100, 100.3)
  })

  it('§3.5 control: a wick that stops short of the trigger does not move it', async () => {
    const bars = [
      ...flat(0, 5, 100),
      bar(5, 100.2, 100.9, 99.9, 99.95),
      ...slide(6),
    ]
    const d = firstDeal(await run(bars, {}))
    expect(d.closePrice).to.be.lessThan(96)
  })
})
