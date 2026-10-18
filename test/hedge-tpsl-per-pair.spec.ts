import { describe, it } from 'mocha'
import { expect } from 'chai'

import HedgeBacktesting from '../src/hedge'
import { ExchangeEnum, ExchangeIntervals, StrategyEnum } from '../src/types'
import type {
  DCABacktestingInput,
  DCABotSettings,
  FullBar,
  HedgeBacktestingResult,
  Symbols,
} from '../src/types'
import {
  FROM,
  HOUR,
  base,
  one,
  path,
  two,
} from './helpers/singlePositionHarness'

/**
 * Hedge TP/SL on a multi-pair hedge is judged per pair: a pair's long and
 * short deals are one hedge, and only that pair's deals close.
 */

const N = 60

// AAA climbs ~0.2%/h; BBB stays flat.
const aaa = path(
  one.pair,
  Array.from({ length: N }, (_, i) => 100 * (1 + 0.002 * i)),
)
const bbb = path(
  two.pair,
  Array.from({ length: N }, () => 100),
)

/** Bars of several pairs interleaved by time, as the engine reads them. */
const interleave = (...series: FullBar[][]) =>
  Array.from({ length: N }, (_, i) => series.map((s) => s[i])).flat()

const leg = (strategy: StrategyEnum, symbols: Symbols[]): DCABacktestingInput =>
  ({
    exchange: ExchangeEnum.binance,
    symbols,
    interval: ExchangeIntervals.oneH,
    userFee: 0.001,
    prices: symbols.map((s) => ({ symbol: s.pair, price: 100 })),
    balances: [{ asset: 'USDT', free: '1000000', locked: '0' }],
    from: FROM,
    to: FROM + N * HOUR,
    settings: {
      ...base,
      strategy,
      pair: symbols.map((s) => s.pair),
      // leg-level exits off: only the hedge TP/SL can close a deal
      useTp: false,
      useSl: false,
      useDca: false,
      maxNumberOfOpenDeals: String(symbols.length),
    } as DCABotSettings,
    fullResult: true,
  }) as never

async function runHedge(): Promise<HedgeBacktestingResult> {
  // Long trades AAA and BBB; short trades BBB only, so AAA's hedge is a
  // single leg and BBB's is a flat long+short pair.
  const bt = new HedgeBacktesting({
    longSettings: leg(StrategyEnum.long, [one, two]),
    shortSettings: leg(StrategyEnum.short, [two]),
    sharedSettings: {
      useTp: true,
      tpPerc: '2',
      useSl: true,
      slPerc: '-1.5',
    } as never,
  })
  const r = await bt.test({
    long: [{ bar: interleave(aaa, bbb), interval: ExchangeIntervals.oneH }],
    short: [{ bar: bbb, interval: ExchangeIntervals.oneH }],
  })
  expect(r, 'hedge result').to.not.equal(undefined)
  return r as HedgeBacktestingResult
}

describe('Hedge TP/SL per pair', () => {
  it('closes a pair whose own P&L reaches the hedge TP, leaving other pairs open', async () => {
    const r = await runHedge()
    const longDeals = r.longResult.deals
    const shortDeals = r.shortResult.deals

    const aaaClosed = longDeals.filter(
      (d) => d.symbol.pair === one.pair && d.status === 'closed',
    )
    expect(aaaClosed.length, 'AAA closed by the hedge TP').to.be.greaterThan(0)
    for (const d of aaaClosed) {
      // closed on reaching ~2% on its own, not when a basket did
      const gain = ((d.closePrice ?? 0) - d.avgPrice) / d.avgPrice
      expect(gain).to.be.within(0.02, 0.03)
    }

    // BBB's long+short pair sits at about -fees, inside the -1.5% SL: it must
    // not be closed because AAA hit the TP.
    const bbbDeals = [...longDeals, ...shortDeals].filter(
      (d) => d.symbol.pair === two.pair,
    )
    expect(bbbDeals.length).to.equal(2)
    for (const d of bbbDeals) expect(d.status).to.equal('open')
  })
})
