import { describe, it } from 'mocha'
import { expect } from 'chai'

import DCABacktesting from '../src/dca'
import { StrategyContextManager } from '../src/dca/strategy/context'
import { ExchangeEnum, ExchangeIntervals } from '../src/types'
import type {
  DCABacktestingResult,
  DCABotSettings,
  FullBar,
  PeriodicStats,
  Symbols,
} from '../src/types'

/**
 * 1.27.2 — periodic stats (month / year) are % of the same capital as the
 * headline `netProfitTotalPerc`: the bot's whole budget
 * (`maxTheoreticalUsageWithRate`), on a fixed base, so the years add up to the
 * headline. Before the fix the base was `initialBalanceUsd` — the FIRST deal's
 * pair budget only — compounded period over period, so a 4-pair backtest
 * showed each year at ~4× its share of the return.
 */

const HOUR = 3600e3
// spans a year boundary: Oct 2025 → Apr 2026
const FROM = Date.UTC(2025, 9, 1)
const BARS = 24 * 200

const mkSymbol = (pair: string, base: string): Symbols => ({
  pair,
  exchange: ExchangeEnum.binance,
  baseAsset: { name: base, minAmount: 0.0001, maxAmount: 1e9, step: 0.0001 },
  quoteAsset: { name: 'USDT', minAmount: 1 },
  maxOrders: 200,
  priceAssetPrecision: 4,
})

const SYMBOLS = [
  mkSymbol('AAAUSDT', 'AAA'),
  mkSymbol('BBBUSDT', 'BBB'),
  mkSymbol('CCCUSDT', 'CCC'),
  mkSymbol('DDDUSDT', 'DDD'),
]

const flat = () => 1

const wave = (
  pair: string,
  phase: number,
  base: number,
  trend: (k: number) => number = flat,
): FullBar[] =>
  Array.from({ length: BARS }, (_, i) => {
    const p = (k: number) =>
      base *
      trend(k) *
      (1 + 0.08 * Math.sin((k + phase) / 23) + 0.03 * Math.sin(k / 5))
    const open = p(i - 1)
    const close = p(i)
    return {
      time: FROM + i * HOUR,
      open,
      close,
      high: Math.max(open, close) * 1.002,
      low: Math.min(open, close) * 0.998,
      volume: 1000,
      symbol: pair,
    }
  })

const settings = (pairs: Symbols[]) =>
  ({
    pair: pairs.map((s) => s.pair),
    name: 'periodic-stats-budget',
    strategy: 'LONG',
    profitCurrency: 'quote',
    dcaCondition: 'percentage',
    scaleDcaType: 'percentage',
    startCondition: 'ASAP',
    startOrderType: 'MARKET',
    baseOrderSize: '100',
    orderSize: '100',
    orderSizeType: 'quote',
    orderFixedIn: 'quote',
    ordersCount: 0,
    activeOrdersCount: 0,
    step: '1',
    volumeScale: '1',
    stepScale: '1',
    minimumDeviation: '0',
    useDca: false,
    useTp: true,
    tpPerc: '2',
    dealCloseCondition: 'tp',
    useSl: true,
    slPerc: '-6',
    dealCloseConditionSL: 'tp',
    closeDealType: 'closeByMarket',
    closeOrderType: 'MARKET',
    useMulti: true,
    maxNumberOfOpenDeals: String(pairs.length * 2),
    maxDealsPerPair: '2',
    type: 'regular',
    futures: false,
    indicatorGroups: [],
    indicators: [],
  }) as unknown as DCABotSettings

let runNo = 0

const run = async (pairs: Symbols[], trend: (k: number) => number = flat) => {
  StrategyContextManager.setActiveContext(`periodic-stats-${++runNo}`)
  const bars = pairs
    .flatMap((s, i) => wave(s.pair, i * 37, 50 + 30 * i, trend))
    .sort((a, b) => a.time - b.time || a.symbol.localeCompare(b.symbol))
  const backtest = new DCABacktesting({
    exchange: ExchangeEnum.binance,
    symbols: pairs,
    interval: ExchangeIntervals.oneH,
    userFee: 0.001,
    prices: pairs.map((s) => ({ symbol: s.pair, price: 100 })),
    balances: [{ asset: 'USDT', free: '1000000', locked: '0' }] as never,
    from: FROM,
    to: FROM + BARS * HOUR,
    slippage: 0,
    combo: false,
    settings: settings(pairs),
  } as never)
  return (await backtest.test([
    { bar: bars, interval: ExchangeIntervals.oneH },
  ])) as DCABacktestingResult
}

const sumOf = (r: DCABacktestingResult, period: 'year' | 'month') =>
  (r.periodicStats ?? [])
    .filter((p) => p.period === period)
    .reduce((a, p) => a + p.netResult, 0)

/** USD banked by the deals that closed inside a periodic-stats bucket. */
const closedIn = (r: DCABacktestingResult, p: PeriodicStats) => {
  const start = new Date(p.startTime)
  const next =
    p.period === 'year'
      ? new Date(start.getFullYear() + 1, 0, 1)
      : new Date(start.getFullYear(), start.getMonth() + 1, 1)
  const usd = r.deals
    .filter(
      (d) =>
        d.closedTime && d.closedTime >= p.startTime && d.closedTime < +next,
    )
    .map((d) => d.profit.totalUsd)
  return {
    net: usd.reduce((a, v) => a + v, 0),
    gains: usd.filter((v) => v > 0).reduce((a, v) => a + v, 0),
    losses: -usd.filter((v) => v < 0).reduce((a, v) => a + v, 0),
  }
}

for (const pairs of [SYMBOLS, SYMBOLS.slice(0, 1)])
  describe(`periodic stats, ${pairs.length}-pair DCA backtest (1.27.2)`, () => {
    let r: DCABacktestingResult
    before(async () => {
      r = await run(pairs)
    })

    it('every deal closed inside the run, across two calendar years', () => {
      const years = r.periodicStats!.filter((p) => p.period === 'year')
      expect(years.length).to.equal(2)
      expect(r.numerical.closed).to.be.greaterThan(20)
      // the open deals' profit is not in any period nor in the headline
      expect(r.numerical.open).to.be.at.most(pairs.length * 2)
    })

    it('the years add up to the headline netProfitTotalPerc', () => {
      const headline = r.financial.netProfitTotalPerc
      expect(headline).to.not.equal(0)
      // tolerance: per-period rounding to 2 dp
      expect(sumOf(r, 'year')).to.be.closeTo(headline, 0.02)
    })

    it('the months add up to the headline netProfitTotalPerc', () => {
      const months = r.periodicStats!.filter((p) => p.period === 'month')
      expect(months.length).to.be.greaterThan(5)
      expect(sumOf(r, 'month')).to.be.closeTo(
        r.financial.netProfitTotalPerc,
        0.01 * months.length,
      )
    })

    it('a period is its own USD profit as % of the whole budget', () => {
      const budget = r.usage.maxTheoreticalUsageWithRate
      for (const p of r.periodicStats!) {
        const { net } = closedIn(r, p)
        expect(p.netResult, `${p.period} ${p.startTime}`).to.be.closeTo(
          (net / budget) * 100,
          0.01,
        )
      }
    })

    it('drawdown / runup are on the same base, bounded by the losses / gains banked', () => {
      const budget = r.usage.maxTheoreticalUsageWithRate
      for (const p of r.periodicStats!) {
        const { gains, losses } = closedIn(r, p)
        const at = `${p.period} ${p.startTime}`
        expect(p.drawdown, at).to.be.at.most(Math.min(p.netResult, 0))
        expect(p.runup, at).to.be.at.least(Math.max(p.netResult, 0))
        expect(-p.drawdown, at).to.be.at.most((losses / budget) * 100 + 0.01)
        expect(p.runup, at).to.be.at.most((gains / budget) * 100 + 0.01)
      }
    })
  })

/**
 * 1.28.0 — the headline drawdown / run-up and the equity curve start from the
 * same capital: the whole budget. They started from `initialBalanceUsd` — the
 * first deal's pair budget only — so a multi-pair run's equity could go below
 * zero and its drawdown exceed 100%. The headline percentages are also on the
 * fixed budget now (not on the running peak), like `netProfitTotalPerc` and the
 * periods, so no period can show a deeper drawdown than the headline.
 */
const NEW_YEAR_BAR = 92 * 24
/** Rallies to 2.5× through 2025, then gives back 12% early in 2026: a
 * profitable run whose deepest drawdown comes after the profits are banked —
 * the case where a drawdown on the running peak reads smaller than one year's
 * drawdown on the budget. */
const rallyThenDip = (k: number) =>
  k < NEW_YEAR_BAR
    ? 1 + (1.5 * k) / NEW_YEAR_BAR
    : 2.5 * (1 - 0.12 * Math.min(1, (k - NEW_YEAR_BAR) / 150))

for (const pairs of [SYMBOLS, SYMBOLS.slice(0, 1)])
  for (const [market, trend] of [
    ['ranging', flat],
    ['rally then dip', rallyThenDip],
  ] as const)
    describe(`headline drawdown / equity, ${pairs.length}-pair DCA backtest, ${market} (1.28.0)`, () => {
      let r: DCABacktestingResult
      let budget: number
      before(async () => {
        r = await run(pairs, trend)
        budget = r.usage.maxTheoreticalUsageWithRate
      })

      it('starts from the whole budget', () => {
        expect(r.financial.initialBalanceUsd).to.be.closeTo(budget, 0.01)
        const closed = r.deals.filter((d) => d.closedTime)
        const at = (t: number) => closed.filter((d) => d.closedTime === t)
        const first = Math.min(...closed.map((d) => d.closedTime!))
        const last = Math.max(...closed.map((d) => d.closedTime!))
        // deals closing on one bar are banked in engine order: one of the first
        // is the first step off the budget, one of the last ends the chain
        expect(
          at(first).some(
            (d) => Math.abs(d.equity - (budget + d.profit.totalUsd)) < 0.01,
          ),
        ).to.equal(true)
        expect(
          at(last).some(
            (d) =>
              Math.abs(d.equity - (budget + r.financial.netProfitTotalUsd)) <
              0.01,
          ),
        ).to.equal(true)
        // the curve starts at the budget, give or take the first bar's fees
        expect(r.portfolio![0].y).to.be.closeTo(budget, budget * 0.01)
      })

      it('drawdown / run-up are % of the whole budget', () => {
        const f = r.financial
        const perc = (usd: number) => (Math.abs(usd) / budget) * 100
        expect(f.maxDrawDownPerc).to.be.closeTo(perc(f.maxDrawDownUsd), 0.01)
        expect(f.maxRunUpPerc).to.be.closeTo(perc(f.maxRunUpUsd), 0.01)
        expect(f.maxDrawDownEquityPerc).to.be.closeTo(
          perc(f.maxDrawDownEquityUsd ?? 0),
          0.01,
        )
        expect(f.maxDrawDownPerc).to.be.below(100)
      })

      it('no period has a deeper drawdown or a larger run-up than the headline', () => {
        for (const p of r.periodicStats!) {
          const at = `${p.period} ${p.startTime}`
          expect(-p.drawdown, at).to.be.at.most(
            r.financial.maxDrawDownPerc + 0.01,
          )
          expect(p.runup, at).to.be.at.most(r.financial.maxRunUpPerc + 0.01)
        }
      })
    })
